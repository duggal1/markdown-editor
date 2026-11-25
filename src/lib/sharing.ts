import type { FlowDocument } from './store';
import { backupEnabled, publishBackup, unpublishBackup } from './backup';

export type ShareRecord = { id: string; syncedVersion: number } &
  ({ secret: string; backup?: false } | { backup: true; secret?: never });
export type ShareStatus = 'syncing' | 'synced' | 'error';
export const MAX_CLOUD_BYTES = 100 * 1024 * 1024;
const PREFIX = 'flow.cloud-share.v1.';
const ID = /^[A-Za-z0-9_-]{16}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const PART_BYTES = 5 * 1024 * 1024;
const PARALLEL_UPLOADS = 6;
const creating = new Map<string, Promise<ShareRecord>>();
const jobs = new Map<string, {
  latest: FlowDocument;
  timer: number | null;
  work: Promise<void>;
  retries: number;
}>();

function announce(documentId: string, status: ShareStatus, progress?: number) {
  window.dispatchEvent(new CustomEvent('flow-share-sync', {
    detail: { documentId, status, progress },
  }));
}
export function readShareRecord(documentId: string): ShareRecord | null {
  try {
    const raw = localStorage.getItem(PREFIX + documentId);
    if (!raw) return null;
    const item: unknown = JSON.parse(raw);
    if (!item || typeof item !== 'object') return null;
    const value = item as Partial<ShareRecord>;
    if (typeof value.id !== 'string' || !ID.test(value.id) ||
        (value.backup !== true && (typeof value.secret !== 'string' || !KEY.test(value.secret))) ||
        typeof value.syncedVersion !== 'number') return null;
    return value as ShareRecord;
  } catch { return null; }
}
export function saveShareRecord(documentId: string, record: ShareRecord): void {
  localStorage.setItem(PREFIX + documentId, JSON.stringify(record));
}
export function clearShareRecord(documentId: string): void {
  localStorage.removeItem(PREFIX + documentId);
}
export function shareUrl(id: string): string {
  return window.location.origin + '/s/' + id;
}
async function send(method: 'POST' | 'PUT' | 'DELETE', body: object): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch('/api/share', {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Network unavailable. Your local document is safe.');
  }
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = result as { error?: string } | null;
    throw new Error(error?.error || 'Cloud sharing failed (' + response.status + ')');
  }
  return result;
}
function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function uploadTicket(value: unknown, expectedBytes: number) {
  const data = value as { id?: string; secret?: string; version?: string;
    urls?: unknown; chunkBytes?: number } | null;
  if (!data || typeof data.id !== 'string' || !ID.test(data.id) ||
      typeof data.version !== 'string' || !ID.test(data.version) ||
      typeof data.chunkBytes !== 'number' || ![PART_BYTES, 2 * 1024 * 1024].includes(data.chunkBytes) || !Array.isArray(data.urls) ||
      data.urls.length !== Math.max(1, Math.ceil(expectedBytes / data.chunkBytes)) ||
      !data.urls.every(url => typeof url === 'string' && (url.startsWith('https://') || url.startsWith('/api/storage?ticket=')))) {
    throw new Error('Cloud returned an invalid upload session');
  }
  return data as { id: string; secret?: string; version: string; urls: string[]; chunkBytes: number };
}
async function uploadChunk(url: string, body: Blob, index: number): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { method: 'PUT', body,
        headers: { 'Content-Type': 'application/octet-stream' }, signal: AbortSignal.timeout(90_000) });
      if (response.ok || response.status === 409) return;
      // A retry can receive 409 if the first attempt completed but its
      // response was lost. Immutable parts are never overwritten.
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
        throw new Error('Upload rejected for part ' + (index + 1) + ' (HTTP ' + response.status + ')');
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Upload rejected')) throw error;
    }
    if (attempt < 3) {
      await new Promise(resolve => window.setTimeout(resolve, 350 * 2 ** attempt));
    }
  }
  throw new Error('Cloud upload failed for part ' + (index + 1) + ' after retries');
}
async function uploadVersion(
  doc: FlowDocument, existing: ShareRecord | null, onProgress?: (percent: number) => void,
): Promise<ShareRecord> {
  if (doc.asset) throw new Error('Only text and Markdown pages can be shared');
  const bytes = new TextEncoder().encode(doc.markdown);
  if (bytes.byteLength > MAX_CLOUD_BYTES) {
    throw new Error('Cloud pages must be 100 MB or smaller (UTF-8).');
  }
  // The existing single-request API handles small new text shares without
  // allocating a multipart session. Updates retain the versioned protocol.
  if (!existing && bytes.byteLength <= 128 * 1024) {
    const payload = { title: doc.title, language: doc.language, markdown: doc.markdown };
    if (new Blob([JSON.stringify(payload)]).size <= 280_000) {
      const created = await send('POST', payload) as { id?: string; secret?: string };
      if (!created || typeof created.id !== 'string' || !ID.test(created.id) ||
          typeof created.secret !== 'string' || !KEY.test(created.secret))
        throw new Error('Cloud returned an invalid editing capability');
      onProgress?.(100);
      return { id: created.id, secret: created.secret, syncedVersion: doc.updatedAt };
    }
  }
  const checksum = hex(await crypto.subtle.digest('SHA-256', bytes));
  const ticket = uploadTicket(await send(existing ? 'PUT' : 'POST', {
    action: 'begin', ...(existing ? { id: existing.id, secret: existing.secret } : {}),
    title: doc.title, language: doc.language, bytes: bytes.byteLength, checksum,
  }), bytes.byteLength);
  const secret = existing?.secret || ticket.secret;
  if (!secret || !KEY.test(secret) || (existing && ticket.id !== existing.id)) {
    throw new Error('Cloud returned an invalid editing capability');
  }

  let cursor = 0;
  let finished = 0;
  onProgress?.(0);
  await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, ticket.urls.length) }, async () => {
    while (cursor < ticket.urls.length) {
      const index = cursor++;
      const start = index * ticket.chunkBytes;
      const end = Math.min(bytes.byteLength, start + ticket.chunkBytes);
      const body = new Blob([bytes.slice(start, end).buffer], { type: 'application/octet-stream' });
      await uploadChunk(ticket.urls[index], body, index);
      finished++;
      onProgress?.(Math.round(finished / ticket.urls.length * 100));
    }
  }));
  await send('PUT', { action: 'commit', id: ticket.id, secret, version: ticket.version });
  return { id: ticket.id, secret, syncedVersion: doc.updatedAt };
}
export async function createCloudShare(
  doc: FlowDocument, onProgress?: (percent: number) => void,
): Promise<ShareRecord> {
  const existing = creating.get(doc.id);
  if (existing) return existing;
  const task = (async () => {
    const record: ShareRecord = backupEnabled()
      ? { id: await publishBackup(doc, onProgress), backup: true, syncedVersion: doc.updatedAt }
      : await uploadVersion(doc, null, onProgress);
    saveShareRecord(doc.id, record);
    return record;
  })();
  creating.set(doc.id, task);
  try { return await task; }
  finally { if (creating.get(doc.id) === task) creating.delete(doc.id); }
}
export function queueSharedSync(doc: FlowDocument) {
  const existing = readShareRecord(doc.id);
  if (doc.asset || !existing || existing.backup) return;
  let job = jobs.get(doc.id);
  if (!job) {
    job = { latest: doc, timer: null, work: Promise.resolve(), retries: 0 };
    jobs.set(doc.id, job);
  }
  job.latest = doc;
  if (job.timer !== null) window.clearTimeout(job.timer);
  const currentJob = job;
  currentJob.timer = window.setTimeout(() => {
    currentJob.timer = null;
    currentJob.work = currentJob.work.catch(() => {}).then(async () => {
      const record = readShareRecord(doc.id);
      if (!record || record.backup || record.syncedVersion === currentJob.latest.updatedAt) return;
      const snapshot = currentJob.latest;
      announce(doc.id, 'syncing', 0);
      try {
        const updated = await uploadVersion(snapshot, record,
          progress => announce(doc.id, 'syncing', progress));
        const latestRecord = readShareRecord(doc.id);
        if (latestRecord && latestRecord.id === record.id &&
            latestRecord.secret === record.secret) {
          saveShareRecord(doc.id, updated);
          currentJob.retries = 0;
          announce(doc.id, 'synced', 100);
          // A user can edit while 100 MB is uploading; do not lose that edit.
          if (currentJob.latest.updatedAt !== snapshot.updatedAt) {
            queueSharedSync(currentJob.latest);
          }
        }
      } catch {
        announce(doc.id, 'error');
        // Keep the previous published version intact; retry failed edits online.
        currentJob.retries = Math.min(currentJob.retries + 1, 6);
        currentJob.timer = window.setTimeout(() => {
          currentJob.timer = null;
          queueSharedSync(currentJob.latest);
        }, Math.min(15_000 * 2 ** (currentJob.retries - 1), 300_000));
      }
    });
  }, currentJob.latest.markdown.length > 20 * 1024 * 1024 ? 30_000
    : currentJob.latest.markdown.length > 5 * 1024 * 1024 ? 15_000 : 1500);
}
export async function revokeCloudShare(documentId: string, record: ShareRecord) {
  const job = jobs.get(documentId);
  if (job) {
    if (job.timer !== null) window.clearTimeout(job.timer);
    job.timer = null;
    await job.work.catch(() => {});
  }
  if (record.backup) await unpublishBackup(documentId);
  else await send('DELETE', { id: record.id, secret: record.secret });
  clearShareRecord(documentId);
  jobs.delete(documentId);
}
