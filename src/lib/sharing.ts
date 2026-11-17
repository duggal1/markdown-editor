import type { FlowDocument } from './store';

export type ShareRecord = { id: string; secret: string; syncedVersion: number };
export type ShareStatus = 'syncing' | 'synced' | 'error';
export const MAX_CLOUD_BYTES = 100 * 1024 * 1024;
const PREFIX = 'flow.cloud-share.v1.';
const ID = /^[A-Za-z0-9_-]{16}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const PART_BYTES = 5 * 1024 * 1024;
const PARALLEL_UPLOADS = 4;
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
        typeof value.secret !== 'string' || !KEY.test(value.secret) ||
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
      body: JSON.stringify(body), cache: 'no-store',
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
      data.chunkBytes !== PART_BYTES || !Array.isArray(data.urls) ||
      data.urls.length !== Math.max(1, Math.ceil(expectedBytes / PART_BYTES)) ||
      !data.urls.every(url => typeof url === 'string' && url.startsWith('https://'))) {
    throw new Error('Cloud returned an invalid upload session');
  }
  return data as { id: string; secret?: string; version: string; urls: string[]; chunkBytes: number };
}
async function uploadChunk(url: string, body: Blob, index: number): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { method: 'PUT', body,
        headers: { 'Content-Type': 'application/octet-stream' } });
      if (response.ok) return;
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
      const start = index * PART_BYTES;
      const end = Math.min(bytes.byteLength, start + PART_BYTES);
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
  const record = await uploadVersion(doc, null, onProgress);
  saveShareRecord(doc.id, record);
  return record;
}
export function queueSharedSync(doc: FlowDocument) {
  if (doc.asset || !readShareRecord(doc.id)) return;
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
      if (!record || record.syncedVersion === currentJob.latest.updatedAt) return;
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
  }, 1500);
}
export async function revokeCloudShare(documentId: string, record: ShareRecord) {
  const job = jobs.get(documentId);
  if (job) {
    if (job.timer !== null) window.clearTimeout(job.timer);
    job.timer = null;
    await job.work.catch(() => {});
  }
  await send('DELETE', { id: record.id, secret: record.secret });
  clearShareRecord(documentId);
  jobs.delete(documentId);
}
