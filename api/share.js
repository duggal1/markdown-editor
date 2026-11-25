import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { del, get, head, issueSignedToken, presignUrl, put, setTtl } from '../server/storage.js';

// Vercel Functions have a 4.5 MB body limit. Large pages go directly from
// browser to private Blob storage using individually signed, retryable parts.
const ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_MARKDOWN_BYTES = 100 * 1024 * 1024;
const LEGACY_PART = 5 * 1024 * 1024;
const PART_BYTES = (process.env.FLOW_STORAGE_BACKEND === 'postgres' || (process.env.DATABASE_URL && !process.env.BLOB_READ_WRITE_TOKEN && !(process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID))) ? 2 * 1024 * 1024 : LEGACY_PART;
const LEGACY_MARKDOWN_BYTES = 240_000;
const MAX_REQUEST_BYTES = 300_000;
const pathFor = id => 'shares/' + id + '.json';
const sessionFor = (id, version) => 'shares/' + id + '/sessions/' + version + '.json';
const partFor = (id, version, index) =>
  'shares/' + id + '/versions/' + version + '/' + String(index).padStart(2, '0') + '.bin';
const partCount = (bytes, partBytes = PART_BYTES) => Math.max(1, Math.ceil(bytes / partBytes));

function reply(res, code, body) {
  res.status(code).json(body);
}
function secureEqual(key, expected) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key) ||
      typeof expected !== 'string' || !HASH_PATTERN.test(expected)) return false;
  const actual = createHash('sha256').update(key).digest();
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
function metadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.title !== 'string' || value.title.length > 160 ||
      (value.language !== undefined && (typeof value.language !== 'string' || value.language.length > 48)) ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > MAX_MARKDOWN_BYTES ||
      typeof value.checksum !== 'string' || !HASH_PATTERN.test(value.checksum)) return null;
  return { title: value.title.trim() || 'Untitled', language: value.language || undefined,
    bytes: value.bytes, checksum: value.checksum, count: partCount(value.bytes), partBytes: PART_BYTES };
}
function legacyPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.title !== 'string' || typeof value.markdown !== 'string' ||
      value.title.length > 160 || Buffer.byteLength(value.markdown, 'utf8') > LEGACY_MARKDOWN_BYTES ||
      (value.language !== undefined && (typeof value.language !== 'string' || value.language.length > 48))) return null;
  return { title: value.title.trim() || 'Untitled', markdown: value.markdown,
    language: value.language || undefined, updatedAt: Date.now() };
}
async function load(path) {
  const result = await get(path, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return new Response(result.stream).json();
}
async function save(path, value, options = {}) {
  return put(path, JSON.stringify(value), {
    access: 'private', addRandomSuffix: false, contentType: 'application/json',
    cacheControlMaxAge: 60, ...options,
  });
}
function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return req.body;
}
function partPaths(id, version, count) {
  return Array.from({ length: count }, (_, index) => partFor(id, version, index));
}
async function signedUrls(paths, operation) {
  // The wildcard signing secret NEVER leaves the server. The browser receives
  // only path-bound, time-bound URLs with the upload size/type restrictions.
  const options = operation === 'put'
    ? { allowedContentTypes: ['application/octet-stream'],
        maximumSizeInBytes: PART_BYTES }
    : {};
  const until = Date.now() + 60 * 60 * 1000;
  const token = await issueSignedToken({
    pathname: '*', operations: [operation], validUntil: until, ...options,
  });
  return (await Promise.all(paths.map(async pathname => {
    const signed = await presignUrl(token, {
      operation, pathname, access: 'private', validUntil: until,
      ...(operation === 'put' ? {
        ...options, addRandomSuffix: false, allowOverwrite: false, ttlDays: 30,
      } : {}),
    });
    return signed.presignedUrls || [signed.presignedUrl];
  }))).flat();
}
async function startUpload(id, ownerHash, info, baseRevision) {
  const version = randomBytes(12).toString('base64url');
  const session = { ...info, baseRevision, version };
  const [urls] = await Promise.all([
    signedUrls(partPaths(id, version, info.count), 'put'),
    save(sessionFor(id, version), session, { ttlDays: 2 }),
  ]);
  return { id, version, urls, chunkBytes: PART_BYTES };
}
async function verifiedParts(id, version, bytes, count, partBytes) {
  const paths = partPaths(id, version, count);
  const parts = await Promise.all(paths.map(path => head(path).catch(() => null)));
  if (parts.some((part, index) => !part || part.size !== Math.min(partBytes, Math.max(0, bytes - index * partBytes)))) return null;
  return paths;
}
async function clearUploadTtl(paths) {
  await Promise.all(paths.map(path => setTtl(path, { ttlDays: null })));
}
async function retireVersion(id, version, count) {
  if (!ID_PATTERN.test(version) || !Number.isSafeInteger(count) || count < 1 || count > 50) return;
  // Keep the previous revision available for in-flight readers, but reclaim it.
  await Promise.allSettled(partPaths(id, version, count).map(path =>
    setTtl(path, { ttlDays: 1 })));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return reply(res, 405, { error: 'Method not allowed' });
  }
  if (!process.env.DATABASE_URL && !process.env.BLOB_READ_WRITE_TOKEN && !(process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID)) {
    return reply(res, 503, { error: 'Cloud sharing is unavailable' });
  }
  try {
    if (req.method === 'GET') {
      const id = req.query?.id;
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        return reply(res, 404, { error: 'Share not found' });
      }
      const shared = await load(pathFor(id));
      if (!shared || shared.status === 'pending') return reply(res, 404, { error: 'Share not found' });
      if (shared.backupPath) {
        // Only explicit public aliases reach this branch. Backups themselves
        // are never addressable through the public sharing endpoint.
        const backup = await load(shared.backupPath);
        if (!backup || backup.deleted || backup.meta.assetType !== undefined)
          return reply(res, 404, { error: 'Share not found' });
        const { title, language, updatedAt } = backup.meta;
        if (!backup.bytes) return reply(res, 200, { title, language, updatedAt, markdown: '' });
        const paths = Array.from({ length: Math.ceil(backup.bytes / (backup.partBytes || LEGACY_PART)) },
          (_, i) => shared.backupRoot + '/parts/' + backup.version + '/' + i + '.bin');
        return reply(res, 200, { title, language, updatedAt, bytes: backup.bytes,
          checksum: backup.checksum, urls: await signedUrls(paths, 'get') });
      }
      if (shared.format === 2) {
        if (!ID_PATTERN.test(shared.version) || !Number.isSafeInteger(shared.count) ||
            shared.count !== partCount(shared.bytes, shared.partBytes || LEGACY_PART) || shared.bytes > MAX_MARKDOWN_BYTES) {
          return reply(res, 500, { error: 'Invalid cloud document' });
        }
        const urls = await signedUrls(partPaths(id, shared.version, shared.count), 'get');
        return reply(res, 200, { title: shared.title, language: shared.language,
          updatedAt: shared.updatedAt, bytes: shared.bytes, checksum: shared.checksum, urls });
      }
      // Existing links made before the chunked protocol keep working.
      return reply(res, 200, { title: shared.title, markdown: shared.markdown,
        language: shared.language, updatedAt: shared.updatedAt });
    }

    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && (!host || new URL(origin).host !== host)) {
      return reply(res, 403, { error: 'Invalid origin' });
    }
    if (Number(req.headers['content-length'] || 0) > MAX_REQUEST_BYTES) {
      return reply(res, 413, { error: 'Request is too large' });
    }
    const body = parseBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_REQUEST_BYTES) {
      return reply(res, 413, { error: 'Invalid or oversized request' });
    }

    if (req.method === 'POST' && body.action === 'begin') {
      const info = metadata(body);
      if (!info) return reply(res, 413, { error: 'Text pages must be at most 100 MB' });
      const id = randomBytes(12).toString('base64url');
      const secret = randomBytes(32).toString('base64url');
      const ownerHash = createHash('sha256').update(secret).digest('hex');
      // Both writes must complete before a ticket is returned.
      const [session] = await Promise.all([
        startUpload(id, ownerHash, info, null),
        save(pathFor(id), { status: 'pending', ownerHash }, { ttlDays: 2 }),
      ]);
      return reply(res, 201, { ...session, secret });
    }
    if (req.method === 'POST') {
      const document = legacyPayload(body);
      if (!document) return reply(res, 400, { error: 'Use chunked upload for pages above 240 KB' });
      const id = randomBytes(12).toString('base64url');
      const secret = randomBytes(32).toString('base64url');
      const ownerHash = createHash('sha256').update(secret).digest('hex');
      await save(pathFor(id), { ...document, ownerHash });
      return reply(res, 201, { id, secret, updatedAt: document.updatedAt });
    }

    const id = body.id;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      return reply(res, 404, { error: 'Share not found' });
    }
    const current = await load(pathFor(id));
    if (!current) return reply(res, 404, { error: 'Share not found' });
    if (current.backupPath) return reply(res, 403, { error: 'Use the backup owner session to change this link' });
    if (!secureEqual(body.secret, current.ownerHash)) {
      return reply(res, 403, { error: 'Only the creator can change this link' });
    }

    if (req.method === 'DELETE') {
      // Revoke the public capability first; orphan cleanup must not re-expose it.
      await del(pathFor(id));
      if (current.format === 2 && ID_PATTERN.test(current.version)) {
        await del(partPaths(id, current.version, current.count)).catch(error =>
          console.error('Could not clean revoked share parts:', error));
      }
      return reply(res, 200, { revoked: true });
    }

    if (body.action === 'begin') {
      if (current.status === 'pending') {
        return reply(res, 409, { error: 'Finish the existing upload first' });
      }
      const info = metadata(body);
      if (!info) return reply(res, 413, { error: 'Text pages must be at most 100 MB' });
      return reply(res, 200, await startUpload(id, current.ownerHash, info, current.version || null));
    }
    if (body.action === 'commit') {
      const version = body.version;
      if (typeof version !== 'string' || !ID_PATTERN.test(version)) {
        return reply(res, 400, { error: 'Invalid upload version' });
      }
      if (current.version === version && current.format === 2) {
        return reply(res, 200, { updatedAt: current.updatedAt });
      }
      const session = await load(sessionFor(id, version));
      if (!session || session.version !== version ||
          (current.version || null) !== session.baseRevision) {
        return reply(res, 409, { error: 'Upload expired or page changed; retry the upload' });
      }
      const paths = await verifiedParts(id, version, session.bytes, session.count, session.partBytes || LEGACY_PART);
      if (!paths) return reply(res, 409, { error: 'Upload incomplete; retry missing chunks' });
      await clearUploadTtl(paths);
      const metadataBlob = await head(pathFor(id));
      const updatedAt = Date.now();
      await save(pathFor(id), {
        format: 2, status: 'active', ownerHash: current.ownerHash,
        title: session.title, language: session.language, bytes: session.bytes,
        checksum: session.checksum, count: session.count, partBytes: session.partBytes || LEGACY_PART, version, updatedAt,
      }, { allowOverwrite: true, ifMatch: metadataBlob.etag });
      await del(sessionFor(id, version)).catch(() => {});
      if (current.format === 2 && current.version && current.version !== version) {
        await retireVersion(id, current.version, current.count);
      }
      return reply(res, 200, { updatedAt });
    }

    // Backward-compatible edit requests from old cached browser clients.
    const document = legacyPayload(body);
    if (!document) return reply(res, 400, { error: 'Use chunked upload for pages above 240 KB' });
    await save(pathFor(id), { ...document, ownerHash: current.ownerHash }, { allowOverwrite: true });
    if (current.format === 2) await retireVersion(id, current.version, current.count);
    return reply(res, 200, { updatedAt: document.updatedAt });
  } catch (error) {
    console.error('Flow sharing request failed:', error);
    return reply(res, 500, { error: 'Could not access cloud storage. Please retry.' });
  }
}
