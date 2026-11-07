import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { del, get, put } from '@vercel/blob';

// Links are public-read capabilities. Only the private, browser-held secret can update or revoke.
const ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const MAX_MARKDOWN_BYTES = 240_000;
const MAX_REQUEST_BYTES = 300_000;
const pathFor = id => 'shares/' + id + '.json';

function reply(res, code, body) {
  res.status(code).json(body);
}
function secureEqual(key, expected) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key) ||
      typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) return false;
  const actual = createHash('sha256').update(key).digest();
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
function payload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.title !== 'string' || typeof value.markdown !== 'string' ||
      value.title.length > 160 || Buffer.byteLength(value.markdown, 'utf8') > MAX_MARKDOWN_BYTES ||
      (value.language !== undefined && (typeof value.language !== 'string' || value.language.length > 48))) {
    return null;
  }
  return {
    title: value.title.trim().slice(0, 160) || 'Untitled',
    markdown: value.markdown,
    language: value.language || undefined,
    updatedAt: Date.now(),
  };
}
async function load(id) {
  const result = await get(pathFor(id), { access: 'private' });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return new Response(result.stream).json();
}
function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return req.body;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return reply(res, 405, { error: 'Method not allowed' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return reply(res, 503, { error: 'Cloud sharing is unavailable' });
  }
  try {
    if (req.method === 'GET') {
      const id = req.query?.id;
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        return reply(res, 404, { error: 'Share not found' });
      }
      const shared = await load(id);
      if (!shared) return reply(res, 404, { error: 'Share not found' });
      // Never expose the SHA-256 editing capability or other internal metadata.
      return reply(res, 200, {
        title: shared.title, markdown: shared.markdown,
        language: shared.language, updatedAt: shared.updatedAt,
      });
    }
    // No cross-site browser uploads. This does not substitute for a full abuse-prevention system.
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && (!host || new URL(origin).host !== host)) {
      return reply(res, 403, { error: 'Invalid origin' });
    }
    if (Number(req.headers['content-length'] || 0) > MAX_REQUEST_BYTES) {
      return reply(res, 413, { error: 'Page is too large to share' });
    }
    const body = parseBody(req);
    if (!body || Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_REQUEST_BYTES) {
      return reply(res, 413, { error: 'Invalid or oversized request' });
    }
    if (req.method === 'POST') {
      const document = payload(body);
      if (!document) return reply(res, 400, { error: 'Share a text or Markdown page under 240 KB' });
      const id = randomBytes(12).toString('base64url');
      const secret = randomBytes(32).toString('base64url');
      const ownerHash = createHash('sha256').update(secret).digest('hex');
      await put(pathFor(id), JSON.stringify({ ...document, ownerHash }), {
        access: 'private', addRandomSuffix: false,
        contentType: 'application/json', cacheControlMaxAge: 60,
      });
      return reply(res, 201, { id, secret, updatedAt: document.updatedAt });
    }
    const id = body.id;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      return reply(res, 404, { error: 'Share not found' });
    }
    const current = await load(id);
    if (!current) return reply(res, 404, { error: 'Share not found' });
    if (!secureEqual(body.secret, current.ownerHash)) {
      return reply(res, 403, { error: 'Only the creator can change this link' });
    }
    if (req.method === 'DELETE') {
      await del(pathFor(id));
      return reply(res, 200, { revoked: true });
    }
    const document = payload(body);
    if (!document) return reply(res, 400, { error: 'Share a text or Markdown page under 240 KB' });
    await put(pathFor(id), JSON.stringify({ ...document, ownerHash: current.ownerHash }), {
      access: 'private', addRandomSuffix: false, allowOverwrite: true,
      contentType: 'application/json', cacheControlMaxAge: 60,
    });
    return reply(res, 200, { updatedAt: document.updatedAt });
  } catch (error) {
    console.error('Flow sharing request failed:', error);
    return reply(res, 500, { error: 'Could not access cloud storage. Please retry.' });
  }
}
