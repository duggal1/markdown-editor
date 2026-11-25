import { get, list } from '@vercel/blob';
import { migrate, importObject } from '../server/postgres-storage.js';
// Run only with legacy writes stopped. Never deletes source data.
try {
  if (process.env.FLOW_MIGRATION_FROZEN !== '1') throw Error('Stop legacy writes before importing; set FLOW_MIGRATION_FROZEN=1');
  await migrate();
  let total = 0;
  for (const prefix of ['backups/', 'shares/', 'html-sites/']) {
    let cursor;
    do {
      const page = await list({ prefix, limit: 100, ...(cursor ? { cursor } : {}) });
      for (const item of page.blobs) {
        const source = await get(item.pathname, { access: 'private', useCache: false });
        if (!source || source.statusCode !== 200 || !source.stream) throw Error('Missing legacy object: ' + item.pathname);
        const body = Buffer.from(await new Response(source.stream).arrayBuffer());
        if (body.length !== item.size) throw Error('Legacy size mismatch: ' + item.pathname);
        const isSession = item.pathname.includes('/sessions/');
        await importObject(item.pathname, body, { contentType: source.blob?.contentType || 'application/octet-stream', ...(isSession ? { ttlDays: 2 } : {}) });
        total++;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
  console.log('Imported and SHA-256 verified ' + total + ' legacy objects. Do not cut over before staging recovery/share tests.');
  process.exit(0);
} catch (error) { console.error(error.message); process.exit(1); }
