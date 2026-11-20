import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import ts from 'typescript';

const apiSource = readFileSync(new URL('../api/site.js', import.meta.url), 'utf8');
const blobs = new Map();
const blobOps = {
  async put(path, data) {
    blobs.set(path, typeof data === 'string' ? data : String(data));
    return { pathname: path };
  },
  async get(path) {
    if (!blobs.has(path)) return null;
    return { statusCode: 200, stream: new Blob([blobs.get(path)]).stream() };
  },
  async head(path) {
    const data = blobs.get(path);
    return data === undefined ? null : { size: Buffer.byteLength(data) };
  },
  async del(path) { blobs.delete(path); },
};
const handler = runInNewContext(
  apiSource
    .replace(/^import .+;$/gm, '')
    .replace('export default async function handler', 'async function handler') +
    '\nhandler',
  {
    ...blobOps, createHash, randomBytes, timingSafeEqual, once,
    Buffer, Response, Blob, URL,
    process: { env: { BLOB_READ_WRITE_TOKEN: 'test-token' } },
    console,
  },
);

function mockRequest(method, body = {}, query = {}) {
  const req = { method, body, query, headers: {
    host: 'example.test', origin: 'https://example.test',
    'content-length': Buffer.byteLength(JSON.stringify(body)),
  } };
  let result = '';
  let json = null;
  const headers = new Map();
  const res = {
    req, statusCode: 200, headersSent: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { headers.set(name.toLowerCase(), value); return this; },
    json(value) { json = value; this.headersSent = true; return this; },
    write(chunk) { result += chunk; this.headersSent = true; return true; },
    end() { this.headersSent = true; },
    destroy(error) { throw error; },
  };
  return handler(req, res).then(() => ({
    status: res.statusCode, body: json, html: result, headers,
  }));
}

const created = await mockRequest('POST');
assert.equal(created.status, 201);
const { id, secret } = created.body;
assert.match(id, /^[\w-]{12}$/);
const source = '<!doctype html><html><head><title>Game</title></head><body><a href="/engine">Engine</a>';
const extra = '<script>const a = "3D";</script></body></html>';
const version = 'abcdefgh1234';
const credentials = { id, secret };
assert.equal((await mockRequest('PUT', { ...credentials, action: 'commit',
  version, chunks: 2, size: Buffer.byteLength(source + extra) })).status, 409,
'Cannot publish incomplete content');
assert.equal((await mockRequest('PUT', { ...credentials, action: 'chunk',
  version, index: 0, text: source })).status, 200);
assert.equal((await mockRequest('PUT', { ...credentials, action: 'chunk',
  version, index: 1, text: extra })).status, 200);
assert.equal((await mockRequest('PUT', { ...credentials, action: 'commit',
  version, chunks: 2, size: Buffer.byteLength(source + extra) })).status, 200);
const shared = await mockRequest('GET', {}, { id, raw: '1' });
assert.equal(shared.status, 200);
assert.equal(shared.html, source + extra, 'Raw loads must not rewrite source');
assert.match(shared.headers.get('content-security-policy'), /sandbox/);
const hosted = await mockRequest('GET', {}, { id });
assert.match(hosted.html, /__FLOW_SITE_BASE__/, 'Hosted route bootstrap is installed');
assert.match(hosted.html, /href="\/engine"/, 'Source links are preserved');
assert.equal((await mockRequest('DELETE', { id, secret: 'invalid' })).status, 403);
assert.equal((await mockRequest('DELETE', credentials)).status, 200);
assert.equal((await mockRequest('GET', {}, { id })).status, 404);

// Verify 10MB is an explicit bound rather than an assumed browser capability.
const createdLarge = await mockRequest('POST');
const creds = createdLarge.body;
const large = 'x'.repeat(209_000);
const version2 = 'abcdefgh12345678';
for (let i = 0; i < 49; i++) {
  const response = await mockRequest('PUT', {
    ...creds, action: 'chunk', version: version2, index: i, text: large,
  });
  assert.equal(response.status, 200);
}
const size = 49 * large.length;
assert.equal(size, 10_241_000);
const committed = await mockRequest('PUT', {
  ...creds, action: 'commit', version: version2, chunks: 49, size,
});
assert.equal(committed.status, 200, '49 chunks totaling almost 10MB must publish');
assert.equal((await mockRequest('PUT', {
  ...creds, action: 'commit', version: version2, chunks: 49, size: 11_000_000,
})).status, 413, 'Oversized site must fail');

const htmlSource = readFileSync(new URL('../src/lib/htmlPreview.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(htmlSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
runInNewContext(compiled, { module: mod, exports: mod.exports });
const { htmlPreviewDocument, looksLikeHtml } = mod.exports;
assert.equal(looksLikeHtml('<html><head></head><body></body></html>'), true);
const hugeSource = '<html><head></head><body>' + 'x'.repeat(10_000_000) + '</body></html>';
const transformed = htmlPreviewDocument(hugeSource, { route: '/engine' });
assert.ok(transformed.length > 10_000_000);
assert.match(transformed.slice(0, 8000), /flow-runtime-route/);
assert.ok(transformed.endsWith('x'.repeat(10_000_000) + '</body></html>'),
  'Heavy HTML should preserve source bytes without DOM parsing');
assert.equal(htmlPreviewDocument('## markdown'), null);

const player = readFileSync(new URL('../src/components/HtmlPlayPage.tsx', import.meta.url), 'utf8');
const phone = readFileSync(new URL('../src/components/IPhoneFrame.tsx', import.meta.url), 'utf8');
for (const pair of ['<IPhoneFrame', 'width: 306, height: 623',
  'width: 340 * phoneScale, height: 700 * phoneScale',
  'setControlsVisible(current => !current)']) {
  assert.ok(player.includes(pair), 'Missing exact device viewport or player control: ' + pair);
}
for (const pair of ['height={681}', 'width={322}', 'x={9}', 'y={9.5}',
  'rx={63}', 'ry={63}', 'strokeWidth={5}', 'width={96}',
  'height={28}', 'x={122}', 'y={24}', 'cx={186}', 'cy={38}',
  'r={2.8}', 'fill="#07e00a"']) {
  assert.ok(phone.includes(pair), 'The supplied SVG geometry changed: ' + pair);
}
assert.equal((phone.match(/<svg/g) || []).length, 2,
  'The supplied iPhone has exactly two original SVG layers.');
assert.doesNotMatch(player, /<div className="html-play-device"|html-play-device-island|const IPHONES/,
  'Do not introduce a synthetic bezel, island or mislabeled iOS model.');
assert.doesNotMatch(phone, /boxShadow|linear-gradient|backgroundImage/,
  'The raw SVG frame must not acquire decorative effects.');
const rewrites = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.ok(rewrites.rewrites.some(rule => rule.source === '/slug/:id/:path*'));
assert.ok(rewrites.rewrites.some(rule => rule.source === '/play/local/:id/:path*'));
console.log('HTML hosting, 10MB chunking, route reload, safety, runtime, and exact iPhone SVG tests passed.');
