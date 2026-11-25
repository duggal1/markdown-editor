import { get, put, postgresMode, verifyTicket } from '../server/storage.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!postgresMode()) return res.status(404).end();
  try {
    const t = verifyTicket(req.query?.ticket, req.method);
    if (!t) return res.status(403).end();
    if (req.method === 'GET') {
      const object = await get(t.path, { start: t.start, length: t.length });
      if (!object) return res.status(404).end();
      const body = Buffer.from(await new Response(object.stream).arrayBuffer());
      if (body.length !== t.length) return res.status(409).end();
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.status(200).send(body);
    }
    if (req.headers['content-type']?.split(';')[0] !== 'application/octet-stream' ||
        Number(req.headers['content-length'] || 0) > t.length) return res.status(413).end();
    let body = req.body;
    if (body === undefined) {
      const parts = []; let size = 0;
      for await (const part of req) {
        size += part.length;
        if (size > t.length) return res.status(413).end();
        parts.push(part);
      }
      body = Buffer.concat(parts);
    }
    if (!Buffer.isBuffer(body) || body.length > t.length) return res.status(400).end();
    await put(t.path, body, { allowOverwrite: false, contentType: 'application/octet-stream', ttlDays: 30 });
    return res.status(201).end();
  } catch (error) {
    if (error.statusCode === 409) return res.status(409).end();
    console.error('Flow storage request failed:', error.message);
    return res.status(503).end();
  }
}
