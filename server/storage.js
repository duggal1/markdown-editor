// Backend choice is explicit when an existing Blob installation is present.
import * as legacy from '@vercel/blob';
import { createHmac, timingSafeEqual } from 'node:crypto';
export const postgresMode = () => process.env.FLOW_STORAGE_BACKEND === 'postgres' ||
  (Boolean(process.env.DATABASE_URL) && !process.env.BLOB_READ_WRITE_TOKEN &&
   !(process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID));
const backend = async () => postgresMode() ? import('./postgres-storage.js') : legacy;
export const put = async (...args) => (await backend()).put(...args);
export const get = async (...args) => (await backend()).get(...args);
export const head = async (...args) => (await backend()).head(...args);
export const headMany = async paths => postgresMode() ? (await backend()).heads(paths) : Promise.all(paths.map(path => legacy.head(path).catch(() => null)));
export const del = async (...args) => (await backend()).del(...args);
export const list = async (...args) => (await backend()).list(...args);
export const setTtl = async (...args) => (await backend()).setTtl(...args);
export const setTtlMany = async (paths, options) => postgresMode() ? (await backend()).setTtlMany(paths, options) : Promise.all(paths.map(path => legacy.setTtl(path, options)));
// PostgreSQL returns bytes and ETag in one snapshot. Legacy Blob retains
// HEAD-before-GET ordering for compare-and-swap safety.
export async function readVersioned(path) {
  if (postgresMode()) {
    const object = await get(path, { access: 'private', useCache: false });
    return { etag: object?.etag, value: object?.stream ? await new Response(object.stream).json() : null };
  }
  const etag = await head(path).then(item => item?.etag).catch(() => undefined);
  const object = await get(path, { access: 'private', useCache: false });
  return { etag, value: object?.statusCode === 200 && object.stream ? await new Response(object.stream).json() : null };
}
const MAX_PART = 2 * 1024 * 1024;
const pathPattern = /^(?:shares|backups|html-sites)\/[A-Za-z0-9_./-]+$/;
function validPath(path) { return typeof path === 'string' && path.length <= 512 && pathPattern.test(path) && !path.split('/').some(p => p === '..' || p === '.'); }
function sign(payload) {
  const secret = process.env.FLOW_STORAGE_SIGNING_SECRET || process.env.DATABASE_URL;
  if (!secret) throw Error('Storage signing unavailable');
  return createHmac('sha256', secret).update('flow-storage-v1:' + payload).digest('base64url');
}
function ticketUrl(value) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return '/api/storage?ticket=' + payload + '.' + sign(payload);
}
export function verifyTicket(ticket, method) {
  if (typeof ticket !== 'string' || ticket.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket)) return null;
  const [payload, signature] = ticket.split('.');
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!validPath(t.path) || !Number.isFinite(t.until) || t.until < Date.now() ||
        t.op !== (method === 'GET' ? 'get' : method === 'PUT' ? 'put' : '') ||
        !Number.isSafeInteger(t.start) || t.start < 0 || !Number.isSafeInteger(t.length) ||
        t.length < 0 || t.length > MAX_PART) return null;
    return t;
  } catch { return null; }
}
export async function issueSignedToken(options) {
  return postgresMode() ? { operations: options.operations, until: options.validUntil } : legacy.issueSignedToken(options);
}
export async function presignUrl(token, options) {
  if (!postgresMode()) return legacy.presignUrl(token, options);
  const { pathname: path, operation: op } = options;
  if (!validPath(path) || !token.operations.includes(op)) throw Error('Invalid storage capability');
  const until = Math.min(token.until, options.validUntil, Date.now() + 3600000);
  if (op === 'put') return { presignedUrl: ticketUrl({ path, op, until, start: 0, length: Math.min(MAX_PART, options.maximumSizeInBytes || MAX_PART) }) };
  const object = await head(path);
  if (!object) throw Error('Storage object missing');
  // Imported legacy 5 MiB Blob parts remain readable through bounded HTTP ranges.
  const presignedUrls = Array.from({ length: Math.max(1, Math.ceil(object.size / MAX_PART)) }, (_, i) =>
    ticketUrl({ path, op, until, start: i * MAX_PART, length: Math.min(MAX_PART, Math.max(0, object.size - i * MAX_PART)) }));
  return { presignedUrl: presignedUrls[0], presignedUrls };
}
