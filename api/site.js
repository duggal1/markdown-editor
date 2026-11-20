import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { del, get, head, put } from '@vercel/blob';

// HTML sites are intentionally separate from Markdown shares. A 10 MB site is
// uploaded in bounded chunks so Vercel's request body limit is never exceeded.
const ID = /^[A-Za-z0-9_-]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const VERSION = /^[A-Za-z0-9_-]{8,48}$/;
const MAX_SITE_BYTES = 10 * 1024 * 1024;
const MAX_CHUNK_BYTES = 950_000;
const MAX_CHUNKS = 80;
const metaPath = id => 'html-sites/' + id + '/meta.json';
const chunkPath = (id, version, index) => 'html-sites/' + id + '/' + version + '/' + index + '.txt';

function respond(res, status, data) {
  res.status(status).json(data);
}
function parseBody(req) {
  if (typeof req.body !== 'string') return req.body;
  try { return JSON.parse(req.body); } catch { return null; }
}
function authorized(secret, hash) {
  if (typeof secret !== 'string' || !SECRET.test(secret) ||
      typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(createHash('sha256').update(secret).digest(), Buffer.from(hash, 'hex'));
}
async function readMeta(id) {
  const blob = await get(metaPath(id), { access: 'private', useCache: false });
  return blob?.statusCode === 200 && blob.stream
    ? new Response(blob.stream).json() : null;
}
async function writeMeta(id, metadata, overwrite = false) {
  await put(metaPath(id), JSON.stringify(metadata), {
    access: 'private', addRandomSuffix: false, allowOverwrite: overwrite,
    contentType: 'application/json', cacheControlMaxAge: 60,
  });
}
const SITE_CSP = [
  "sandbox allow-scripts allow-forms allow-pointer-lock allow-downloads allow-modals allow-top-navigation-by-user-activation",
  "default-src https: data: blob:",
  "script-src 'unsafe-inline' 'unsafe-eval' https: blob:",
  "style-src 'unsafe-inline' https:",
  "connect-src https: wss:",
  "img-src https: data: blob:",
  "font-src https: data:",
  "media-src https: data: blob:",
  "worker-src blob: https:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

function routeBootstrap(id) {
  const prefix = '/slug/' + id;
  return '<script>' + [
    '(function(){',
    'var prefix=' + JSON.stringify(prefix) + ';',
    'function scoped(url){',
    ' if(typeof url!=="string"||!url.startsWith("/")||url.startsWith("//")||url===prefix||url.startsWith(prefix+"/"))return url;',
    ' return prefix+url;',
    '}',
    'var push=history.pushState, replace=history.replaceState;',
    'history.pushState=function(s,t,u){return push.call(this,s,t,scoped(u));};',
    'history.replaceState=function(s,t,u){return replace.call(this,s,t,scoped(u));};',
    'window.__FLOW_SITE_BASE__=prefix;',
    'window.__FLOW_SITE_ROUTE__=location.pathname.slice(prefix.length)||"/";',
    'document.addEventListener("click",function(e){',
    ' if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;',
    ' var a=e.target&&e.target.closest&&e.target.closest("a[href]");',
    ' if(!a||a.hasAttribute("download")||(a.target&&a.target!=="_self"))return;',
    ' var raw=a.getAttribute("href");',
    ' if(!raw||!raw.startsWith("/")||raw.startsWith("//"))return;',
    ' e.preventDefault();location.assign(scoped(raw));',
    '});',
    '})();',
  ].join('') + '</script>';
}
function injectBootstrap(html, id) {
  const bootstrap = routeBootstrap(id);
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, match => match + bootstrap);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, match => match + '<head>' + bootstrap + '</head>');
  if (/<!doctype[^>]*>/i.test(html)) return html.replace(/<!doctype[^>]*>/i, match => match + bootstrap);
  return bootstrap + html;
}
async function streamSite(res, id, metadata, raw = false) {
  if (!metadata?.version || !VERSION.test(metadata.version) ||
      !Number.isInteger(metadata.chunks) || metadata.chunks < 1 || metadata.chunks > MAX_CHUNKS) {
    return respond(res, 404, { error: 'Site not yet published' });
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', SITE_CSP);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=15');
  res.setHeader('ETag', '"' + metadata.version + '"');
  if (res.req.headers['if-none-match'] === '"' + metadata.version + '"') {
    res.status(304).end();
    return;
  }
  // Stream chunks rather than buffering a 10 MB response in a serverless
  // function, preserving both peak memory and hosted response-size limits.
  for (let index = 0; index < metadata.chunks; index++) {
    const blob = await get(chunkPath(id, metadata.version, index), { access: 'private', useCache: false });
    if (!blob?.stream || blob.statusCode !== 200) {
      if (!res.headersSent) return respond(res, 503, { error: 'Site content unavailable' });
      throw new Error('Published site missing chunk ' + index);
    }
    let part = await new Response(blob.stream).text();
    if (index === 0 && !raw) part = injectBootstrap(part, id);
    if (!res.write(part)) await once(res, 'drain');
  }
  res.end();
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return respond(res, 405, { error: 'Method not allowed' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return respond(res, 503, { error: 'Cloud storage is not configured' });
  }
  try {
    if (req.method === 'GET') {
      const id = req.query?.id;
      if (typeof id !== 'string' || !ID.test(id)) return respond(res, 404, { error: 'Site not found' });
      const meta = await readMeta(id);
      if (!meta) return respond(res, 404, { error: 'Site not found' });
      return await streamSite(res, id, meta, req.query?.raw === '1');
    }
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && (!host || new URL(origin).host !== host)) {
      return respond(res, 403, { error: 'Invalid origin' });
    }
    if (Number(req.headers['content-length'] || 0) > 1_600_000) {
      return respond(res, 413, { error: 'Chunk too large' });
    }
    const body = parseBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return respond(res, 400, { error: 'Invalid JSON request' });
    }
    if (req.method === 'POST') {
      const id = randomBytes(9).toString('base64url');
      const secret = randomBytes(32).toString('base64url');
      await writeMeta(id, {
        ownerHash: createHash('sha256').update(secret).digest('hex'),
        createdAt: Date.now(),
      });
      return respond(res, 201, { id, secret });
    }
    const { id, secret } = body;
    if (typeof id !== 'string' || !ID.test(id)) {
      return respond(res, 404, { error: 'Site not found' });
    }
    const meta = await readMeta(id);
    if (!meta) return respond(res, 404, { error: 'Site not found' });
    if (!authorized(secret, meta.ownerHash)) {
      return respond(res, 403, { error: 'Only the publisher can change this site' });
    }
    if (req.method === 'DELETE') {
      // Prior versions are not referenced by the public URL. Deleting them is
      // best-effort cleanup; the metadata must be removed to revoke access.
      await del(metaPath(id));
      return respond(res, 200, { revoked: true });
    }
    if (body.action === 'chunk') {
      const { version, index, text } = body;
      if (typeof version !== 'string' || !VERSION.test(version) ||
          !Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS ||
          typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_CHUNK_BYTES) {
        return respond(res, 413, { error: 'Invalid site chunk' });
      }
      await put(chunkPath(id, version, index), text, {
        access: 'private', addRandomSuffix: false, allowOverwrite: true,
        contentType: 'text/plain; charset=utf-8', cacheControlMaxAge: 60,
      });
      return respond(res, 200, { received: index });
    }
    if (body.action === 'commit') {
      const { version, chunks, size } = body;
      if (typeof version !== 'string' || !VERSION.test(version) ||
          !Number.isInteger(chunks) || chunks < 1 || chunks > MAX_CHUNKS ||
          !Number.isInteger(size) || size < 1 || size > MAX_SITE_BYTES) {
        return respond(res, 413, { error: 'Invalid site version' });
      }
      // Never promote an incomplete upload. Count actual Blob bytes instead of
      // trusting the browser's declared size.
      let actual = 0;
      for (let index = 0; index < chunks; index++) {
        const blob = await head(chunkPath(id, version, index), { access: 'private' });
        if (!blob) return respond(res, 409, { error: 'Upload is incomplete' });
        actual += blob.size;
        if (actual > MAX_SITE_BYTES) return respond(res, 413, { error: 'Site exceeds 10 MB' });
      }
      if (actual !== size) return respond(res, 409, { error: 'Uploaded byte count mismatch' });
      await writeMeta(id, { ...meta, version, chunks, size, updatedAt: Date.now() }, true);
      return respond(res, 200, { published: true, version });
    }
    return respond(res, 400, { error: 'Unknown update action' });
  } catch (error) {
    console.error('HTML site request failed', error);
    if (res.headersSent) { res.destroy(error); return; }
    return respond(res, 500, { error: 'Cloud site request failed. Retry the upload.' });
  }
}
