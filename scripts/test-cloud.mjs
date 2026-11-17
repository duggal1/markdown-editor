import { strict as assert } from 'node:assert';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Exercise the real API module with an in-memory private Blob adapter. No
// credentials or network access are needed in CI.
const source = readFileSync(new URL('../api/share.js', import.meta.url), 'utf8')
  .replace(/^import .*;\s*$/gm, '')
  .replace('export default async function handler', 'async function handler');
const blobs = new Map();
let sequence = 0;
const ttlChanges = [];
const put = async (path, body, options = {}) => {
  const previous = blobs.get(path);
  if (options.ifMatch && previous?.etag !== options.ifMatch) {
    throw Error('Blob version changed');
  }
  const value = String(body);
  const entry = { body: value, size: Buffer.byteLength(value), etag: 'etag-' + ++sequence };
  blobs.set(path, entry);
  return entry;
};
const get = async path => {
  const entry = blobs.get(path);
  return entry ? { statusCode: 200, stream: new Response(entry.body).body } : null;
};
const head = async path => blobs.get(path) || null;
const del = async paths => {
  for (const path of Array.isArray(paths) ? paths : [paths]) blobs.delete(path);
};
const issueSignedToken = async () => ({
  delegationToken: 'delegation', clientSigningToken: 'private-server-only', validUntil: Date.now() + 3600000,
});
const presignUrl = async (_, options) => ({
  presignedUrl: 'https://blob.example/' + options.pathname + '?operation=' + options.operation,
});
const setTtl = async (path, options) => {
  if (!blobs.has(path)) throw Error('Blob not found');
  ttlChanges.push({ path, ttlDays: options.ttlDays });
};
const handler = new Function('deps', 'Response', 'Buffer', 'process', 'console',
  'const { createHash, randomBytes, timingSafeEqual, del, get, head, issueSignedToken, presignUrl, put, setTtl } = deps;\n' +
    source + '\nreturn handler;')({
      createHash, randomBytes, timingSafeEqual, del, get, head, issueSignedToken,
      presignUrl, put, setTtl,
    }, Response, Buffer, { env: { BLOB_READ_WRITE_TOKEN: 'test' } }, console);

async function request(method, body = {}, query = {}, headers = {}) {
  let status = 0;
  let data;
  const res = {
    setHeader() {},
    status(value) { status = value; return this; },
    json(value) { data = value; return this; },
  };
  await handler({ method, body, query,
    headers: { host: 'flow.example', origin: 'https://flow.example', ...headers } }, res);
  return { status, data };
}
const mb100 = 100 * 1024 * 1024;
const digest = 'a'.repeat(64);
const details = bytes => ({ action: 'begin', title: 'Large code file',
  language: 'markdown', bytes, checksum: digest });
const partPath = (id, version, index) =>
  'shares/' + id + '/versions/' + version + '/' + String(index).padStart(2, '0') + '.bin';
function completeParts(session, bytes) {
  const perPart = session.chunkBytes;
  for (let index = 0; index < session.urls.length; index++) {
    const size = Math.min(perPart, Math.max(0, bytes - index * perPart));
    blobs.set(partPath(session.id, session.version, index),
      { body: '', size, etag: 'part-' + index });
  }
}

const huge = await request('POST', details(mb100));
assert.equal(huge.status, 201, 'Exactly 100 MiB must be accepted');
assert.equal(huge.data.urls.length, 20);
assert.equal(huge.data.chunkBytes, 5 * 1024 * 1024);
assert.ok(huge.data.urls.every(url => url.includes('/versions/')));
assert.equal((await request('GET', {}, { id: huge.data.id })).status, 404,
  'Incomplete uploads must never be visible publicly');
assert.equal((await request('POST', details(mb100 + 1))).status, 413);
assert.equal((await request('POST', details(-1))).status, 413);
assert.equal((await request('POST', details(1.5))).status, 413);

const missing = await request('PUT', { action: 'commit', id: huge.data.id,
  secret: huge.data.secret, version: huge.data.version });
assert.equal(missing.status, 409, 'Incomplete upload cannot commit');
completeParts(huge.data, mb100);
const committed = await request('PUT', { action: 'commit', id: huge.data.id,
  secret: huge.data.secret, version: huge.data.version });
assert.equal(committed.status, 200);
const published = await request('GET', {}, { id: huge.data.id });
assert.equal(published.status, 200);
assert.equal(published.data.urls.length, 20);
assert.equal(published.data.bytes, mb100);
assert.equal(published.data.checksum, digest);
assert.equal(published.data.markdown, undefined, '100 MB never crosses the function response');
assert.equal(ttlChanges.filter(change => change.ttlDays === null).length, 20);
assert.equal((await request('PUT', { action: 'commit', id: huge.data.id,
  secret: huge.data.secret, version: huge.data.version })).status, 200,
  'Retrying an already published commit is idempotent');

const forbidden = await request('PUT', { ...details(3), id: huge.data.id, secret: 'x'.repeat(43) });
assert.equal(forbidden.status, 403);
const updating = await request('PUT', { ...details(7), id: huge.data.id, secret: huge.data.secret });
assert.equal(updating.status, 200);
assert.equal(updating.data.urls.length, 1);
const premature = await request('PUT', { action: 'commit', id: huge.data.id,
  secret: huge.data.secret, version: updating.data.version });
assert.equal(premature.status, 409);
assert.equal((await request('GET', {}, { id: huge.data.id })).data.bytes, mb100,
  'Failed update must preserve the previous published share');
completeParts(updating.data, 7);
assert.equal((await request('PUT', { action: 'commit', id: huge.data.id,
  secret: huge.data.secret, version: updating.data.version })).status, 200);
assert.equal((await request('GET', {}, { id: huge.data.id })).data.bytes, 7);
assert.equal(ttlChanges.filter(change => change.ttlDays === 1).length, 20,
  'Previous version must be scheduled for cleanup');

const legacy = await request('POST', { title: 'Old page', markdown: 'Hello legacy' });
assert.equal(legacy.status, 201);
assert.equal((await request('GET', {}, { id: legacy.data.id })).data.markdown, 'Hello legacy');
assert.equal((await request('DELETE', { id: legacy.data.id, secret: legacy.data.secret })).status, 200);
assert.equal((await request('GET', {}, { id: legacy.data.id })).status, 404);
assert.equal((await request('DELETE', { id: huge.data.id, secret: huge.data.secret })).status, 200);
assert.equal((await request('GET', {}, { id: huge.data.id })).status, 404);
assert.equal((await request('POST', details(123), {}, { origin: 'https://evil.example' })).status, 403);
assert.equal((await request('POST', details(123), {}, { 'content-length': '500000' })).status, 413);

const client = readFileSync(new URL('../src/lib/sharing.ts', import.meta.url), 'utf8');
const reader = readFileSync(new URL('../src/components/SharedPage.tsx', import.meta.url), 'utf8');
assert.match(client, /bytes\.byteLength > MAX_CLOUD_BYTES/);
assert.match(client, /PARALLEL_UPLOADS = 4/);
assert.match(client, /attempt < 4/);
assert.match(client, /action: 'commit'/);
assert.match(reader, /Cloud document failed integrity verification/);
console.log('100 MB signed private sharing, publish safety, retries, legacy and revocation checks passed.');
