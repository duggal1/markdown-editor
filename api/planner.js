import { plannerAccess, createPlannerLimiter } from '../server/plannerAccess.js';
import { generatePlanner, MAX_INPUT, MAX_CONTEXT } from '../server/planner.js';

const admit = createPlannerLimiter();
const reply = (res, status, body) => res.status(status).json(body);
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed' });
  const config = plannerAccess(process.env, req.headers['x-flow-planner-key']);
  if (config.status) return reply(res, config.status, { error: config.error });
  const { apiKey } = config;
  let release;
  try {
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && (!host || new URL(origin).host !== host)) return reply(res, 403, { error: 'Invalid origin' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body.input !== 'string' || !body.input.trim() || body.input.length > MAX_INPUT ||
        !['todo', 'memory'].includes(body.kind) ||
        (body.memory !== undefined && (typeof body.memory !== 'string' || body.memory.length > MAX_CONTEXT)) ||
        (body.existing !== undefined && (typeof body.existing !== 'string' || body.existing.length > MAX_CONTEXT)) ||
        (body.repositories !== undefined && (typeof body.repositories !== 'string' || body.repositories.length > MAX_CONTEXT)))
      return reply(res, 400, { error: 'Invalid planner request.' });
    // Vercel overwrites its platform forwarding header; do not trust arbitrary X-Forwarded-For.
    const forwarded = process.env.VERCEL === '1' ? req.headers['x-vercel-forwarded-for'] : undefined;
    const client = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress) || 'unknown';
    release = admit(client);
    if (!release) { res.setHeader('Retry-After', '60'); return reply(res, 429, { error: 'Planner is busy or the request limit was reached. Retry shortly.' }); }
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    res.on('close', disconnect);
    const timer = setTimeout(disconnect, 75000);
    const send = event => { if (!controller.signal.aborted && !res.destroyed) res.write(JSON.stringify(event) + '\n'); };
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    // Keep idle connections alive during inference; blank NDJSON lines are ignored.
    const heartbeat = setInterval(() => { if (!controller.signal.aborted && !res.destroyed) res.write('\n'); }, 10000);
    try {
      const result = await generatePlanner({ input: body.input.trim(), kind: body.kind,
        memory: body.memory || '', existing: body.existing || '', repositories: body.repositories || '', apiKey, signal: controller.signal, onDelta: send });
      send({ type: 'done', ...result });
    } catch (cause) {
      const message = cause?.providerStatus === 401 || cause?.providerStatus === 403 ? 'Reflection rejected the configured API key or model access. Check the server key.' :
        cause?.providerStatus === 429 ? 'Reflection rate limit reached. Retry shortly.' :
        controller.signal.aborted ? 'Generation timed out. No items were saved.' :
        'Could not generate a complete plan. Your existing items were not changed.';
      if (!res.destroyed) res.write(JSON.stringify({ type: 'error', error: message }) + '\n');
    } finally {
      clearTimeout(timer);
      clearInterval(heartbeat);
      res.off('close', disconnect);
      if (!res.destroyed) res.end();
    }
    return;
  } catch {
    // Do not log prompts, memory, provider responses or credentials.
    if (res.headersSent) { if (!res.destroyed) res.end(); return; }
    return reply(res, 502, { error: 'Could not generate a complete plan. Your existing items were not changed.' });
  } finally { release?.(); }
}
