import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import backup from '../api/backup.js';
import share from '../api/share.js';
import storage from '../api/storage.js';
import site from '../api/site.js';
import { migrate, put, get, head, heads, list, del, setTtl, importObject } from '../server/postgres-storage.js';
import { issueSignedToken, presignUrl, verifyTicket } from '../server/storage.js';
process.env.FLOW_STORAGE_BACKEND = 'postgres';
const path = 'shares/abcdefghijklmnop/versions/abcdefghijklmnop/00.bin';
try {
  await migrate();
  await del([path, path + '2']);
  const input = Buffer.alloc(5 * 1024 * 1024, 17);
  const first = await put(path, input, { allowOverwrite: false });
  assert.equal(first.size, input.length);
  await assert.rejects(put(path, Buffer.from('different'), { allowOverwrite: false }), /Conditional/);
  await assert.rejects(put(path, Buffer.from('different'), { ifMatch: 'stale' }), /Conditional/);
  assert.equal((await heads([path, path + '2']))[0].size, input.length);
  assert.equal((await heads([path, path + '2']))[1], null);
  const until = Date.now() + 60000;
  const token = await issueSignedToken({ operations: ['get'], validUntil: until });
  const signed = await presignUrl(token, { operation: 'get', pathname: path, validUntil: until });
  assert.equal(signed.presignedUrls.length, 3);
  const chunks = [];
  for (const url of signed.presignedUrls) {
    const ticket = new URL(url, 'https://flow.example').searchParams.get('ticket');
    const verified = verifyTicket(ticket, 'GET');
    assert.ok(verified);
    assert.equal(verifyTicket(ticket, 'PUT'), null);
    assert.equal(verifyTicket(ticket + 'a', 'GET'), null);
    const result = await get(verified.path, verified);
    chunks.push(Buffer.from(await new Response(result.stream).arrayBuffer()));
  }
  assert.deepEqual(Buffer.concat(chunks), input);
  await importObject(path, input);
  await assert.rejects(importObject(path, Buffer.from('wrong')), /verification failed/);
  await put(path + '2', 'hello', { allowOverwrite: false });
  const page = await list({ prefix: 'shares/abcdefghijklmnop/', limit: 1 });
  assert.equal(page.blobs.length, 1);
  assert.equal(page.hasMore, true);
  assert.equal((await list({ prefix: 'shares/abcdefghijklmnop/', limit: 1, cursor: page.cursor })).blobs.length, 1);
  await put(path, 'updated', { ifMatch: first.etag });
  assert.equal(await new Response((await get(path)).stream).text(), 'updated');
  await setTtl(path, { ttlDays: -1 });
  assert.equal(await head(path), null);
  await del([path, path + '2']);
  // Exercise the actual handlers, not just the database adapter. The CI job
  // sets DATABASE_URL with no legacy token before importing these modules.
  async function call(handler, method, body = {}, query = {}, cookie = '', extraHeaders = {}) {
    let status = 0, data;
    const headers = {};
    const req = { method, body, query, headers: { host: 'flow.example', origin: 'https://flow.example', cookie, ...extraHeaders } };
    const res = { req, setHeader(k,v) { headers[k] = v; }, status(n) { status = n; return this; },
      json(v) { data = v; return this; }, send(v) { data = v; return this; }, end() { return this; } };
    await handler(req, res);
    return { status, data, headers };
  }
  const session = await call(backup, 'POST', { action: 'session' });
  assert.equal(session.status, 200);
  const owner = session.headers['Set-Cookie'].map(v => v.split(';')[0]).join('; ');
  const doc = { kind: 'documents', id: 'postgres-ci-doc' };
  const meta = { id: doc.id, workspaceId: 'postgres-ci-workspace', title: 'Private', titleAuto: false, createdAt: 1, updatedAt: 2 };
  const data = Buffer.alloc(3 * 1024 * 1024, 65);
  const checksum = createHash('sha256').update(data).digest('hex');
  const begin = await call(backup, 'POST', { ...doc, action: 'begin', meta, bytes: data.length, checksum }, {}, owner);
  assert.equal(begin.status, 200);
  assert.equal(begin.data.chunkBytes, 2 * 1024 * 1024);
  assert.equal(begin.data.urls.length, 2);
  const commit = () => call(backup, 'PUT', { ...doc, action: 'commit', version: begin.data.version }, {}, owner);
  assert.equal((await commit()).status, 409);
  for (const [index, url] of begin.data.urls.entries()) {
    const ticket = new URL(url, 'https://flow.example').searchParams.get('ticket');
    const part = data.subarray(index * begin.data.chunkBytes, (index + 1) * begin.data.chunkBytes);
    const result = await call(storage, 'PUT', part, { ticket }, '', { 'content-type': 'application/octet-stream' });
    assert.equal(result.status, 201);
    assert.equal((await call(storage, 'PUT', part, { ticket }, '', { 'content-type': 'application/octet-stream' })).status, 409);
  }
  assert.equal((await commit()).status, 200);
  assert.equal((await commit()).status, 200);
  assert.equal((await call(backup, 'GET', {}, { ...doc, action: 'read' })).status, 401);
  const manifest = await call(backup, 'GET', {}, { ...doc, action: 'read' }, owner);
  assert.equal(manifest.status, 200);
  const downloaded = [];
  for (const url of manifest.data.urls) {
    const ticket = new URL(url, 'https://flow.example').searchParams.get('ticket');
    const result = await call(storage, 'GET', {}, { ticket });
    assert.equal(result.status, 200);
    downloaded.push(result.data);
  }
  assert.deepEqual(Buffer.concat(downloaded), data);
  const publish = await call(backup, 'POST', { ...doc, action: 'publish', updatedAt: 2 }, {}, owner);
  assert.equal(publish.status, 200);
  assert.equal((await call(share, 'GET', {}, { id: publish.data.id })).status, 200);
  assert.equal((await call(backup, 'DELETE', { ...doc, action: 'unpublish' }, {}, owner)).status, 200);
  assert.equal((await call(share, 'GET', {}, { id: publish.data.id })).status, 404);
  const html = await call(site, 'POST', { html: '<html><body>Flow</body></html>' });
  assert.equal(html.status, 201);
  assert.equal((await call(site, 'GET', {}, { id: html.data.id, status: '1' })).status, 200);
  assert.equal((await call(site, 'DELETE', { id: html.data.id, secret: html.data.secret })).status, 200);
  console.log('PostgreSQL storage, batch reads, immutable chunks, conditional updates, signed ranges, migration verification and API round trips passed');
  process.exit(0);
} catch (error) { console.error(error); process.exit(1); }
