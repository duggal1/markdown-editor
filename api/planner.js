import { createHash, timingSafeEqual } from 'node:crypto';
import { generatePlanner, MAX_INPUT, MAX_CONTEXT } from '../server/planner.js';

const digest = value => createHash('sha256').update(value).digest();
const reply = (res, status, body) => res.status(status).json(body);
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed' });
  const apiKey = process.env.REFLECTION_API_KEY;
  const access = process.env.FLOW_PLANNER_ACCESS_KEY;
  // This app has no authenticated account. Never expose an anonymous paid API proxy.
  if (!apiKey || !access || access.length < 24) return reply(res, 503, { error: 'Planner AI is not configured on this deployment.' });
  const supplied = req.headers['x-flow-planner-key'];
  if (typeof supplied !== 'string' || supplied.length > 512 || !timingSafeEqual(digest(supplied), digest(access)))
    return reply(res, 401, { error: 'Enter your private planner access key.' });
  try {
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && (!host || new URL(origin).host !== host)) return reply(res, 403, { error: 'Invalid origin' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body.input !== 'string' || !body.input.trim() || body.input.length > MAX_INPUT ||
        !['todo', 'memory'].includes(body.kind) ||
        (body.memory !== undefined && (typeof body.memory !== 'string' || body.memory.length > MAX_CONTEXT)) ||
        (body.existing !== undefined && (typeof body.existing !== 'string' || body.existing.length > MAX_CONTEXT)))
      return reply(res, 400, { error: 'Invalid planner request.' });
    const result = await generatePlanner({ input: body.input.trim(), kind: body.kind,
      memory: body.memory || '', existing: body.existing || '', apiKey, signal: AbortSignal.timeout(45000) });
    return reply(res, 200, result);
  } catch {
    // Do not log prompts, memory, provider responses or credentials.
    return reply(res, 502, { error: 'Could not generate a complete plan. Your existing items were not changed.' });
  }
}
