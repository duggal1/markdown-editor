import type { FlowDocument } from './store';

export type ShareRecord = { id: string; secret: string; syncedVersion: number };
export type ShareStatus = 'syncing' | 'synced' | 'error';
const PREFIX = 'flow.cloud-share.v1.';
const ID = /^[A-Za-z0-9_-]{16}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const jobs = new Map<string, {
  latest: FlowDocument;
  timer: number | null;
  work: Promise<void>;
}>();

function announce(documentId: string, status: ShareStatus) {
  window.dispatchEvent(new CustomEvent('flow-share-sync', { detail: { documentId, status } }));
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
async function send(method: 'POST' | 'PUT' | 'DELETE', body: object) {
  const response = await fetch('/api/share', {
    method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store',
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = result as { error?: string } | null;
    throw new Error(error?.error || 'Cloud sharing failed (' + response.status + ')');
  }
  return result;
}
function content(doc: FlowDocument) {
  return { title: doc.title, markdown: doc.markdown, language: doc.language };
}
export async function createCloudShare(doc: FlowDocument): Promise<ShareRecord> {
  if (doc.asset) throw new Error('Only text and Markdown pages can be shared');
  const result = await send('POST', content(doc)) as { id?: string; secret?: string };
  if (!result || typeof result.id !== 'string' || !ID.test(result.id) ||
      typeof result.secret !== 'string' || !KEY.test(result.secret)) {
    throw new Error('Cloud returned an invalid link');
  }
  const record = { id: result.id, secret: result.secret, syncedVersion: doc.updatedAt };
  saveShareRecord(doc.id, record);
  return record;
}
export function queueSharedSync(doc: FlowDocument) {
  if (doc.asset || !readShareRecord(doc.id)) return;
  let job = jobs.get(doc.id);
  if (!job) {
    job = { latest: doc, timer: null, work: Promise.resolve() };
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
      announce(doc.id, 'syncing');
      try {
        await send('PUT', { id: record.id, secret: record.secret, ...content(snapshot) });
        const latestRecord = readShareRecord(doc.id);
        if (latestRecord && latestRecord.id === record.id) {
          saveShareRecord(doc.id, { ...latestRecord, syncedVersion: snapshot.updatedAt });
          announce(doc.id, 'synced');
          // Changes during an in-flight request must not be dropped.
          if (currentJob.latest.updatedAt !== snapshot.updatedAt) {
            queueSharedSync(currentJob.latest);
          }
        }
      } catch {
        announce(doc.id, 'error');
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
