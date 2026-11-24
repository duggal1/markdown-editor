import { strict as assert } from 'node:assert';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const blobs = new Map();
let sequence = 0;
const ttl = [];
const put = async (path, body, options = {}) => {
  const old = blobs.get(path);
  if ((options.ifMatch && old?.etag !== options.ifMatch) ||
      (options.allowOverwrite === false && old)) throw Error('Conditional write failed');
  const entry = { body: String(body), size: Buffer.byteLength(String(body)), etag: 'etag-' + ++sequence };
  blobs.set(path, entry);
  return entry;
};
const get = async path => blobs.has(path)
  ? { statusCode: 200, stream: new Response(blobs.get(path).body).body } : null;
const head = async path => blobs.get(path) || null;
const del = async paths => { for (const path of Array.isArray(paths) ? paths : [paths]) blobs.delete(path); };
const list = async ({ prefix, limit = 1000 }) => ({
  blobs: [...blobs.keys()].filter(path => path.startsWith(prefix)).slice(0, limit).map(pathname => ({ pathname })),
  hasMore: false,
});
const issueSignedToken = async () => ({ clientSigningToken: 'test' });
const presignUrl = async (_, options) => ({ presignedUrl: 'https://blob.example/' + options.pathname });
const setTtl = async (path, options) => { assert.ok(blobs.has(path)); ttl.push({ path, ...options }); };
const deps = { createHash, randomBytes, timingSafeEqual, del, get, head, issueSignedToken, list, presignUrl, put, setTtl };
function loadHandler(file) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace('export default async function handler', 'async function handler');
  return new Function('deps', 'Response', 'Buffer', 'process', 'console',
    'const { createHash, randomBytes, timingSafeEqual, del, get, head, issueSignedToken, list, presignUrl, put, setTtl } = deps;\n' +
    source + '\nreturn handler;')(deps, Response, Buffer, { env: { BLOB_READ_WRITE_TOKEN: 'test' } }, console);
}
const backup = loadHandler('../api/backup.js');
const share = loadHandler('../api/share.js');
async function request(handler, method, body = {}, cookie = '', query = {}, origin = 'https://flow.example') {
  let status, data;
  const headers = {};
  const res = {
    setHeader(key, value) { headers[key] = value; },
    status(value) { status = value; return this; },
    json(value) { data = value; },
  };
  await handler({ method, body, query, headers: { host: 'flow.example', origin, cookie } }, res);
  return { status, data, headers };
}
const req = (method, body, cookie, query) => request(backup, method, body, cookie, query);
const session = async () => {
  const result = await req('POST', { action: 'session' });
  assert.equal(result.status, 200);
  assert.match(result.headers['Set-Cookie'][0], /HttpOnly; SameSite=Strict/);
  return result.headers['Set-Cookie'].map(item => item.split(';')[0]).join('; ');
};
const owner = await session();
const stranger = await session();
const doc = { kind: 'documents', id: 'doc-1' };
const meta = { id: doc.id, workspaceId: 'ws-1', folderId: 'folder-1', title: 'Private page',
  titleAuto: false, createdAt: 1, updatedAt: 2, fileType: 'text' };
const hash = 'a'.repeat(64);
const max = 100 * 1024 * 1024;
const begin = (bytes, m = meta) => req('POST', { ...doc, action: 'begin', bytes, meta: m, checksum: hash }, owner);
const commit = ticket => req('PUT', { ...doc, action: 'commit', version: ticket.version }, owner);
const read = cookie => req('GET', {}, cookie, { ...doc, action: 'read' });
assert.equal((await read('')).status, 401);
assert.equal((await read(stranger)).status, 404);
assert.equal((await begin(max + 1)).status, 400);
const ticket = (await begin(max)).data;
assert.equal(ticket.urls.length, 20);
assert.equal((await commit(ticket)).status, 409);
assert.equal((await read(owner)).status, 404);
for (const url of ticket.urls) blobs.set(new URL(url).pathname.slice(1),
  { body: '', size: 5 * 1024 * 1024, etag: 'part' });
assert.equal((await commit(ticket)).status, 200);
assert.equal((await commit(ticket)).status, 200);
assert.equal((await read(owner)).data.meta.folderId, 'folder-1');
assert.equal((await read(stranger)).status, 404);
assert.equal((await begin(max)).data.unchanged, true);
assert.equal((await begin(max, { ...meta, updatedAt: 1 })).status, 409);
assert.equal((await req('GET', {}, owner, { action: 'list' })).data.entries.length, 1);
assert.equal((await req('GET', {}, stranger, { action: 'list' })).data.entries.length, 0);
const recovery = (await req('POST', { action: 'recovery-key' }, owner)).data.key;
assert.equal(recovery.length, 43);
const recovered = await req('POST', { action: 'recover', key: recovery });
assert.equal(recovered.status, 200);
assert.equal(recovered.headers['Set-Cookie'][0].split(';')[0], owner.split(';')[0]);
const aliasId = createHash('sha256').update('flow-link:' + recovery + ':' + doc.id).digest('base64url').slice(0, 16);
const publicRead = () => request(share, 'GET', {}, '', { id: aliasId });
assert.equal((await publicRead()).status, 404, 'Private backup must not create public access');
const published = await req('POST', { ...doc, action: 'publish' }, owner);
assert.equal(published.data.id, aliasId);
assert.equal((await publicRead()).data.bytes, max);
const next = (await begin(0, { ...meta, updatedAt: 3 })).data;
assert.equal((await publicRead()).data.bytes, max, 'Incomplete revision must not overwrite existing content');
assert.equal((await commit(next)).status, 200);
assert.equal((await publicRead()).data.markdown, '', 'Published alias follows the latest committed backup');
assert.equal((await req('DELETE', { ...doc, action: 'unpublish' }, owner)).status, 200);
assert.equal((await publicRead()).status, 404);
assert.equal((await read(owner)).status, 200, 'Revoking public access must preserve the private copy');
assert.equal((await req('DELETE', { ...doc, action: 'delete' }, owner)).status, 200);
assert.equal((await read(owner)).status, 404);
assert.equal((await begin(0, { ...meta, updatedAt: 4 })).status, 409, 'Deleted records cannot be resurrected by stale tabs');
assert.equal((await request(backup, 'POST', { action: 'session' }, '', {}, 'https://evil.example')).status, 403);
assert.ok(ttl.some(item => item.ttlDays === 1), 'Old parts should be retired');
for (const kind of ['workspaces', 'folders']) {
  const id = kind === 'workspaces' ? 'ws-1' : 'folder-1';
  const entry = { kind, id };
  const info = { id, name: 'Original name', createdAt: 1, ...(kind === 'folders' ? { workspaceId: 'ws-1' } : {}) };
  const result = await req('POST', { ...entry, action: 'begin', meta: info, bytes: 0, checksum: hash }, owner);
  assert.equal(result.status, 200);
  assert.equal((await req('PUT', { ...entry, action: 'commit', version: result.data.version }, owner)).status, 200);
  assert.equal((await req('GET', {}, owner, { ...entry, action: 'read' })).data.meta.name, 'Original name');
}
console.log('Private backup isolation, recovery, 100 MB uploads, stable share aliases, revocation and deletion passed.');
