import { createHash, randomBytes } from 'node:crypto';
import { del, get, head, issueSignedToken, list, presignUrl, put, setTtl } from '@vercel/blob';

const LIMIT = 100 * 1024 * 1024;
const PART = 5 * 1024 * 1024;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const VERSION = /^[A-Za-z0-9_-]{16}$/;
const HASH = /^[a-f0-9]{64}$/;
const kinds = new Set(['documents', 'workspaces', 'folders']);
const digest = value => createHash('sha256').update(value).digest('hex');
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(s => s.trim())
  .find(s => s.startsWith(name + '='))?.slice(name.length + 1);
const reply = (res, status, value) => res.status(status).json(value);
const count = bytes => Math.ceil(bytes / PART);
const partPaths = (root, version, bytes) => Array.from({ length: count(bytes) },
  (_, i) => root + '/parts/' + version + '/' + i + '.bin');

async function read(path) {
  const result = await get(path, { access: 'private', useCache: false });
  return result?.statusCode === 200 && result.stream ? new Response(result.stream).json() : null;
}
function write(path, value, options = {}) {
  return put(path, JSON.stringify(value), { access: 'private', addRandomSuffix: false,
    contentType: 'application/json', cacheControlMaxAge: 60, ...options });
}
async function urls(paths, operation) {
  if (!paths.length) return [];
  const validUntil = Date.now() + 3600000;
  const limits = operation === 'put' ? {
    allowedContentTypes: ['application/octet-stream'], maximumSizeInBytes: PART,
  } : {};
  const token = await issueSignedToken({ pathname: '*', operations: [operation], validUntil, ...limits });
  return Promise.all(paths.map(async pathname => (await presignUrl(token, {
    operation, pathname, access: 'private', validUntil,
    ...(operation === 'put' ? { ...limits, addRandomSuffix: false, allowOverwrite: false, ttlDays: 30 } : {}),
  })).presignedUrl));
}
async function retire(root, item) {
  if (!item?.version) return;
  await Promise.allSettled(partPaths(root, item.version, item.bytes).map(path => setTtl(path, { ttlDays: 1 })));
}
function validMeta(kind, id, meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || meta.id !== id ||
      !Number.isFinite(meta.createdAt)) return false;
  if (kind === 'workspaces') return typeof meta.name === 'string';
  if (!ID.test(meta.workspaceId || '')) return false;
  if (kind === 'folders') return typeof meta.name === 'string';
  return typeof meta.title === 'string' && typeof meta.titleAuto === 'boolean' &&
    Number.isFinite(meta.updatedAt) && (meta.folderId === undefined || ID.test(meta.folderId)) &&
    (meta.assetType === undefined || typeof meta.assetType === 'string') &&
    !('markdown' in meta) && !('asset' in meta);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return reply(res, 405, { error: 'Method not allowed' });
  if (!process.env.BLOB_READ_WRITE_TOKEN && !(process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID))
    return reply(res, 503, { error: 'Cloud backup unavailable' });
  try {
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && (!host || new URL(origin).host !== host)) return reply(res, 403, { error: 'Invalid origin' });
    const body = req.method === 'GET' ? req.query || {} :
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Buffer.byteLength(JSON.stringify(body)) > 200000) return reply(res, 400, { error: 'Invalid request' });

    let token = cookie(req, 'flow_backup_key');
    if (req.method === 'POST' && ['session', 'recover'].includes(body.action)) {
      if (body.action === 'recover') {
        if (typeof body.key !== 'string' || !KEY.test(body.key))
          return reply(res, 400, { error: 'Invalid recovery key' });
        const page = await list({ prefix: 'backups/' + digest(body.key) + '/records/', limit: 1 });
        if (!page.blobs.length) return reply(res, 404, { error: 'No backup found for that key' });
        token = body.key;
      } else if (!KEY.test(token || '')) token = randomBytes(32).toString('base64url');
      res.setHeader('Set-Cookie', [
        'flow_backup_key=' + token + '; Path=/; Max-Age=34560000; Secure; HttpOnly; SameSite=Strict',
        'flow_backup=1; Path=/; Max-Age=34560000; Secure; SameSite=Strict',
      ]);
      return reply(res, 200, { enabled: true });
    }
    if (!KEY.test(token || '')) return reply(res, 401, { error: 'Backup session missing' });
    const prefix = 'backups/' + digest(token) + '/';
    if (req.method === 'POST' && body.action === 'recovery-key') return reply(res, 200, { key: token });
    if (req.method === 'GET' && body.action === 'list') {
      const entries = [];
      let cursor;
      do {
        const page = await list({ prefix: prefix + 'records/', limit: 1000, ...(cursor ? { cursor } : {}) });
        for (const blob of page.blobs) {
          const match = blob.pathname.slice((prefix + 'records/').length)
            .match(/^(documents|workspaces|folders)\/([A-Za-z0-9_-]{1,128})\.json$/);
          if (match) entries.push({ kind: match[1], id: match[2] });
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return reply(res, 200, { entries });
    }
    const { kind, id } = body;
    if (!kinds.has(kind) || typeof id !== 'string' || !ID.test(id)) return reply(res, 400, { error: 'Invalid record' });
    const root = prefix + 'data/' + kind + '/' + id;
    const path = prefix + 'records/' + kind + '/' + id + '.json';
    const aliasId = createHash('sha256').update('flow-link:' + token + ':' + id).digest('base64url').slice(0, 16);
    const alias = 'shares/' + aliasId + '.json';
    // Read the ETag before the value. An intervening write makes the CAS fail, never overwrite it.
    const etag = await head(path).then(item => item?.etag).catch(() => undefined);
    const current = await read(path);
    const cas = current ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false };
    if (current && !etag) return reply(res, 409, { error: 'Backup changed; retry' });

    if (req.method === 'GET') {
      if (!current || current.deleted) return reply(res, 404, { error: 'Backup not found' });
      return reply(res, 200, { ...current, urls: await urls(partPaths(root, current.version, current.bytes), 'get') });
    }
    if (req.method === 'DELETE' && body.action === 'unpublish' && kind === 'documents') {
      await del(alias);
      return reply(res, 200, { revoked: true });
    }
    if (req.method === 'POST' && body.action === 'publish' && kind === 'documents') {
      if (!current || current.deleted || current.meta.assetType !== undefined)
        return reply(res, 404, { error: 'Text backup not ready' });
      // The alias contains no content and only exists after an explicit Share action.
      await write(alias, { backupPath: path, backupRoot: root }, { allowOverwrite: true });
      return reply(res, 200, { id: aliasId });
    }
    if (req.method === 'DELETE' && body.action === 'delete') {
      if (kind === 'documents') await del(alias);
      if (!current?.deleted) {
        await write(path, { deleted: true, version: randomBytes(12).toString('base64url') }, cas);
        await retire(root, current);
      }
      return reply(res, 200, { deleted: true });
    }
    if (current?.deleted) return reply(res, 409, { error: 'Record was deleted' });
    if (req.method === 'POST' && body.action === 'begin') {
      const { meta, bytes, checksum } = body;
      if (!validMeta(kind, id, meta) || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > LIMIT ||
          (kind !== 'documents' && bytes !== 0) || typeof checksum !== 'string' || !HASH.test(checksum))
        return reply(res, 400, { error: 'Invalid backup or file exceeds 100 MB' });
      if (kind === 'documents' && current?.meta.updatedAt > meta.updatedAt)
        return reply(res, 409, { error: 'A newer backup exists' });
      if (current && current.checksum === checksum && JSON.stringify(current.meta) === JSON.stringify(meta))
        return reply(res, 200, { unchanged: true });
      const version = randomBytes(12).toString('base64url');
      const session = { meta, bytes, checksum, version, base: current?.version || null };
      await write(root + '/sessions/' + version + '.json', session, { ttlDays: 2 });
      return reply(res, 200, { version, urls: await urls(partPaths(root, version, bytes), 'put') });
    }
    if (req.method === 'PUT' && body.action === 'commit' && VERSION.test(body.version || '')) {
      if (current?.version === body.version) return reply(res, 200, { committed: true });
      const sessionPath = root + '/sessions/' + body.version + '.json';
      const session = await read(sessionPath);
      if (!session || session.base !== (current?.version || null))
        return reply(res, 409, { error: 'Backup changed; retry' });
      const paths = partPaths(root, session.version, session.bytes);
      for (let offset = 0; offset < paths.length; offset += 4) {
        const batch = await Promise.all(paths.slice(offset, offset + 4).map(p => head(p).catch(() => null)));
        if (batch.some((part, i) => !part || part.size !== Math.min(PART, session.bytes - (offset + i) * PART)))
          return reply(res, 409, { error: 'Backup upload incomplete' });
      }
      for (let offset = 0; offset < paths.length; offset += 4)
        await Promise.all(paths.slice(offset, offset + 4).map(p => setTtl(p, { ttlDays: null })));
      const { base, ...record } = session;
      await write(path, record, cas);
      await del(sessionPath).catch(() => {});
      await retire(root, current);
      return reply(res, 200, { committed: true });
    }
    return reply(res, 400, { error: 'Invalid backup action' });
  } catch (error) {
    console.error('Flow backup request failed:', error);
    return reply(res, 503, { error: 'Cloud backup failed; retry' });
  }
}
