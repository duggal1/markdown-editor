import assert from 'node:assert/strict';
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
  console.log('PostgreSQL storage, batch reads, immutable chunks, conditional updates, signed ranges, migration verification passed');
  process.exit(0);
} catch (error) { console.error(error); process.exit(1); }
