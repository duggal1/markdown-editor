import { createHash, randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres';
import { pgTable, text, integer, timestamp, customType } from 'drizzle-orm/pg-core';
import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';

const bytea = customType({ dataType: () => 'bytea' });
export const objects = pgTable('flow_cloud_objects', {
  path: text('path').primaryKey(),
  body: bytea('body').notNull(),
  size: integer('size').notNull(),
  etag: text('etag').notNull(),
  contentType: text('content_type').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
});
let client;
export function database() {
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is missing');
  return client ||= drizzle(process.env.DATABASE_URL);
}
export async function migrate() {
  const db = database();
  // Serialize concurrent migration invocations; DDL is not run on request paths.
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(609501327)`);
    await tx.execute(sql`create table if not exists flow_cloud_objects (
      path text primary key, body bytea not null, size integer not null check (size >= 0),
      etag text not null, content_type text not null, expires_at timestamptz,
      check (octet_length(body) = size))`);
    await tx.execute(sql`create index if not exists flow_cloud_objects_path_prefix on flow_cloud_objects (path text_pattern_ops)`);
    await tx.execute(sql`create index if not exists flow_cloud_objects_path_c on flow_cloud_objects (path collate "C")`);
    await tx.execute(sql`create index if not exists flow_cloud_objects_expiry on flow_cloud_objects (expires_at) where expires_at is not null`);
  });
}
const live = () => or(isNull(objects.expiresAt), gt(objects.expiresAt, new Date()));
const byPath = path => and(eq(objects.path, path), live());
const fields = { pathname: objects.path, size: objects.size, etag: objects.etag, contentType: objects.contentType };
const bytes = body => Buffer.isBuffer(body) ? body : Buffer.from(body);
const sha = body => createHash('sha256').update(body).digest('hex');
function conflict() { const error = Error('Conditional storage write failed'); error.statusCode = 409; error.code = '409'; return error; }
function expiry(days) { return days == null ? null : new Date(Date.now() + days * 86400000); }
export async function put(path, body, options = {}) {
  const data = bytes(body);
  const value = { path, body: sql`decode(${data.toString('base64')}, 'base64')`, size: data.length,
    etag: randomBytes(16).toString('hex'), contentType: options.contentType || 'application/octet-stream',
    expiresAt: expiry(options.ttlDays) };
  const db = database();
  let rows;
  if (options.ifMatch) {
    const { path: ignored, ...changes } = value;
    rows = await db.update(objects).set(changes).where(and(byPath(path), eq(objects.etag, options.ifMatch))).returning(fields);
  } else {
    const insert = db.insert(objects).values(value);
    if (options.allowOverwrite === true) {
      const { path: ignored, ...changes } = value;
      rows = await insert.onConflictDoUpdate({ target: objects.path, set: changes }).returning(fields);
    } else rows = await insert.onConflictDoNothing().returning(fields);
  }
  if (!rows.length) throw conflict();
  return rows[0];
}
let preparedHead;
const headQuery = () => preparedHead ||= database().select(fields).from(objects)
  .where(and(eq(objects.path, sql.placeholder('path')), or(isNull(objects.expiresAt), sql`${objects.expiresAt} > now()`))).limit(1).prepare('flow_object_head_v1');
export async function head(path) {
  const [row] = await headQuery().execute({ path });
  return row || null;
}
export async function get(path, options = {}) {
  const start = options.start ?? 0;
  const length = options.length;
  const expression = length === undefined ? objects.body : sql`substring(${objects.body} from ${start + 1} for ${length})`;
  const [row] = await database().select({ ...fields, data: sql`encode(${expression}, 'base64')` })
    .from(objects).where(byPath(path)).limit(1);
  if (!row) return null;
  const buffer = Buffer.from(row.data, 'base64');
  return { ...row, statusCode: 200, stream: new Blob([buffer]).stream() };
}
export async function del(paths) {
  const values = Array.isArray(paths) ? paths : [paths];
  if (values.length) await database().delete(objects).where(inArray(objects.path, values));
}
export async function setTtl(path, options) { await setTtlMany([path], options); }
export async function setTtlMany(paths, options) {
  if (paths.length) await database().update(objects).set({ expiresAt: expiry(options.ttlDays) }).where(inArray(objects.path, paths));
}
export async function list({ prefix, limit = 1000, cursor }) {
  const orderedPath = sql`${objects.path} collate "C"`;
  const predicate = and(live(), sql`left(${objects.path}, ${prefix.length}) = ${prefix}`,
    // All existing Flow storage paths are ASCII. A prefix range uses the primary-key index.
    sql`${objects.path} collate "C" >= ${prefix} and ${objects.path} collate "C" < ${prefix + '\uffff'}`,
    cursor ? sql`${orderedPath} > ${cursor}` : undefined);
  const rows = await database().select(fields).from(objects).where(predicate).orderBy(orderedPath).limit(limit + 1);
  const hasMore = rows.length > limit;
  const blobs = rows.slice(0, limit);
  return { blobs, hasMore, cursor: hasMore ? blobs.at(-1).pathname : undefined };
}
/** Batch metadata checks on one consistent snapshot, without transferring bodies. */
export async function heads(paths) {
  if (!paths.length) return [];
  const db = database();
  const result = await db.batch(paths.map(path => headQuery().bind({ path })),
    { readOnly: true, isolation: 'repeatable read', ...(process.env.FLOW_DB_METRICS === '1' ? { metrics: 'us' } : {}) });
  if (result.metrics) console.info('Flow storage head batch', { total: result.metrics.total, roundTrips: result.metrics.roundTrips });
  return result.map(rows => rows[0] || null);
}
let preparedVersioned;
const versionedQuery = () => preparedVersioned ||= database().select({
  etag: objects.etag, data: sql`convert_from(${objects.body}, 'UTF8')`,
}).from(objects).where(and(eq(objects.path, sql.placeholder('path')),
  or(isNull(objects.expiresAt), sql`${objects.expiresAt} > now()`))).limit(1).prepare('flow_versioned_json_v1');
/** Batch independent manifest reads; do not fetch note bodies or lose CAS tokens. */
export async function readVersionedMany(paths) {
  if (!paths.length) return [];
  const results = await database().batch(paths.map(path => versionedQuery().bind({ path })),
    { readOnly: true, isolation: 'repeatable read' });
  return results.map(rows => rows[0] ? { etag: rows[0].etag, value: JSON.parse(rows[0].data) } : { etag: undefined, value: null });
}
/** Import immutable legacy objects; reject differing data rather than overwriting. */
export async function importObject(path, data, options = {}) {
  const body = bytes(data);
  try { await put(path, body, { ...options, allowOverwrite: false }); }
  catch (error) { if (error.statusCode !== 409) throw error; }
  const saved = await get(path);
  if (!saved || sha(Buffer.from(await new Response(saved.stream).arrayBuffer())) !== sha(body))
    throw Error('Legacy object verification failed: ' + path);
}
export async function purgeExpired() {
  await database().delete(objects).where(lt(objects.expiresAt, new Date()));
}
