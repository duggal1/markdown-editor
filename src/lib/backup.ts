import type { FlowDocument, Folder, Workspace } from './store';

export type BackupKind = 'documents' | 'workspaces' | 'folders';
type Value = FlowDocument | Folder | Workspace;
type Entry = { kind: BackupKind; id: string };
type Job = Entry & { value: Value | null };
type BackupState = 'off' | 'pending' | 'synced' | 'error';
type Restored = { documents: FlowDocument[]; workspaces: Workspace[]; folders: Folder[] };
const PART = 5 * 1024 * 1024;
const LIMIT = 100 * 1024 * 1024;
const RECORD_CONCURRENCY = 6;
const PART_CONCURRENCY = 6;
const INLINE_BYTES = 128 * 1024;
const INDEX = 'flow.backup.index.v1';
const TOMBSTONES = 'flow.backup.deletions.v1';
const FORCE_RESTORE = 'flow.backup.restore.v1';
const synced = new Map<string, Value>();
const pending = new Map<string, Job>();
const running = new Map<string, Promise<void>>();
const runningValues = new Map<string, Value | null>();
let timer: number | undefined;
let draining = false;
let state: BackupState = 'off';
const key = (entry: Entry) => entry.kind + '/' + entry.id;
const pause = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

export function backupEnabled() {
  return typeof document !== 'undefined' && document.cookie.split(';').some(item => item.trim() === 'flow_backup=1');
}
export function backupStatus(): BackupState { return backupEnabled() ? (state === 'off' ? 'pending' : state) : 'off'; }
function announce(next: BackupState) {
  if (state === next) return;
  state = next;
  window.dispatchEvent(new CustomEvent('flow-backup-status', { detail: next }));
}
function readEntries(storageKey: string): Entry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(value) ? value.filter((item): item is Entry =>
      item && ['documents', 'folders', 'workspaces'].includes(item.kind) && typeof item.id === 'string') : [];
  } catch { return []; }
}
function updateEntries(storageKey: string, entry: Entry, add: boolean) {
  const entries = readEntries(storageKey).filter(item => key(item) !== key(entry));
  if (add) entries.push({ kind: entry.kind, id: entry.id });
  try { localStorage.setItem(storageKey, JSON.stringify(entries)); } catch { /* Cookie survives local database eviction. */ }
}
async function request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', action: string,
  entry?: Entry, extra: object = {}, signal?: AbortSignal): Promise<Response> {
  const body = { action, ...(entry ? { kind: entry.kind, id: entry.id } : {}), ...extra };
  const response = await fetch(method === 'GET' ? '/api/backup?' +
    new URLSearchParams({ action, ...(entry ? { kind: entry.kind, id: entry.id } : {}) }) : '/api/backup', {
    method, cache: 'no-store', credentials: 'same-origin', signal: signal || AbortSignal.timeout(30000),
    ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return response;
}
async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || 'Cloud backup failed (' + response.status + ')');
  }
  return response.json() as Promise<T>;
}
export async function enableBackup() {
  await json(await request('POST', 'session'));
  if (!backupEnabled()) throw new Error('Browser blocked the backup cookie');
  announce('pending');
}
export async function getRecoveryKey(): Promise<string> {
  return (await json<{ key: string }>(await request('POST', 'recovery-key'))).key;
}
export async function recoverWithKey(recoveryKey: string) {
  await json(await request('POST', 'recover', undefined, { key: recoveryKey.trim() }));
  sessionStorage.setItem(FORCE_RESTORE, '1');
}
async function checksum(blob: Blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
    byte => byte.toString(16).padStart(2, '0')).join('');
}
async function uploadPart(url: string, blob: Blob) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { method: 'PUT', body: blob,
        headers: { 'Content-Type': 'application/octet-stream' }, signal: AbortSignal.timeout(120000) });
      if (response.ok || response.status === 409) return;
    } catch { /* Retry interrupted uploads. */ }
    if (attempt < 3) await pause(350 * 2 ** attempt);
  }
  throw new Error('Backup part upload failed');
}
async function sync(job: Job) {
  if (!job.value) {
    synced.delete(key(job));
    await json(await request('DELETE', 'delete', job));
    updateEntries(INDEX, job, false);
    updateEntries(TOMBSTONES, job, false);
    return;
  }
  if (synced.get(key(job)) === job.value) return;
  let meta: object = job.value;
  let blob = new Blob();
  if (job.kind === 'documents') {
    const { markdown, asset, ...fields } = job.value as FlowDocument;
    meta = { ...fields, ...(asset ? { assetType: asset.type } : {}) };
    blob = asset || new Blob([markdown]);
  }
  if (blob.size > LIMIT) throw new Error('Backup files must be 100 MB or smaller');
  const hash = await checksum(blob);
  // Short text and metadata avoid signing, a direct-upload request and a
  // separate commit request. Large files keep the immutable multipart path.
  if (blob.size <= INLINE_BYTES && (job.kind !== 'documents' || !(job.value as FlowDocument).asset)) {
    const markdown = job.kind === 'documents' ? (job.value as FlowDocument).markdown : '';
    const payload = { meta, markdown, bytes: blob.size, checksum: hash };
    if (new Blob([JSON.stringify(payload)]).size <= 180_000) {
      await json(await request('POST', 'inline', job, payload));
      updateEntries(INDEX, job, true);
      synced.set(key(job), job.value);
      return;
    }
  }
  const ticket = await json<{ unchanged?: boolean; version?: string; urls?: string[]; chunkBytes?: number }>(
    await request('POST', 'begin', job, { meta, bytes: blob.size, checksum: hash }));
  if (!ticket.unchanged) {
    const urls = ticket.urls;
    const partBytes = ticket.chunkBytes ?? PART;
    if (![PART, 2 * 1024 * 1024].includes(partBytes) || !ticket.version || !urls || urls.length !== Math.ceil(blob.size / partBytes) ||
        !urls.every(url => typeof url === 'string' && (url.startsWith('https://') || url.startsWith('/api/storage?ticket=')))) throw new Error('Invalid backup upload session');
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, urls.length) }, async () => {
      while (cursor < urls.length) {
        const i = cursor++;
        await uploadPart(urls[i], blob.slice(i * partBytes, (i + 1) * partBytes));
      }
    }));
    await json(await request('PUT', 'commit', job, { version: ticket.version }));
  }
  updateEntries(INDEX, job, true);
  synced.set(key(job), job.value);
}
function run(job: Job): Promise<void> {
  const id = key(job);
  const active = running.get(id);
  if (active && runningValues.get(id) === job.value) return active;
  const previous = active || Promise.resolve();
  const next = previous.catch(() => {}).then(() => sync(job));
  running.set(id, next);
  runningValues.set(id, job.value);
  void next.finally(() => { if (running.get(id) === next) { running.delete(id); runningValues.delete(id); } }).catch(() => {});
  return next;
}
function schedule(delay = 250) {
  if (timer !== undefined || draining) return;
  timer = window.setTimeout(() => { timer = undefined; void drain(); }, delay);
}
async function drain() {
  if (draining || !backupEnabled()) return;
  draining = true;
  let failed = false;
  // Take a bounded batch. Edits arriving during upload remain queued.
  const batch = [...pending.values()];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(RECORD_CONCURRENCY, batch.length) }, async () => {
    while (cursor < batch.length) {
      const job = batch[cursor++];
      const id = key(job);
      if (pending.get(id) !== job) continue;
      pending.delete(id);
      try { await run(job); }
      catch {
        failed = true;
        if (!pending.has(id)) pending.set(id, job);
      }
    }
  }));
  draining = false;
  announce(failed ? 'error' : pending.size || running.size ? 'pending' : 'synced');
  if (pending.size) schedule(failed ? 30000 : 250);
}
export function queueBackup(kind: BackupKind, value: Value) {
  if (!backupEnabled()) return;
  const job = { kind, id: value.id, value };
  if (readEntries(TOMBSTONES).some(item => key(item) === key(job))) return;
  pending.set(key(job), job);
  announce('pending');
  schedule();
}
export function queueBackupDeletion(kind: BackupKind, id: string) {
  if (!backupEnabled()) return;
  const job = { kind, id, value: null };
  updateEntries(TOMBSTONES, job, true);
  updateEntries(INDEX, job, false);
  pending.set(key(job), job);
  announce('pending');
  schedule();
}
export function resumeBackup(data: Restored) {
  if (!backupEnabled()) return;
  // Read the durable deletion journal once, not once per document.
  // Avoid rewriting the journal for tombstones already persisted.
  const tombstones = readEntries(TOMBSTONES);
  const deleted = new Set(tombstones.map(key));
  for (const entry of tombstones) pending.set(key(entry), { ...entry, value: null });
  for (const kind of ['workspaces', 'folders', 'documents'] as const) {
    for (const value of data[kind]) {
      const job = { kind, id: value.id, value };
      const id = key(job);
      if (!deleted.has(id) && !pending.has(id) && synced.get(id) !== value) pending.set(id, job);
    }
  }
  if (pending.size) { announce('pending'); schedule(); }
}
export function needsBackupRecovery(data: Restored) {
  if (!backupEnabled()) return false;
  if (!data.documents.length || !data.workspaces.length) return true;
  try { if (sessionStorage.getItem(FORCE_RESTORE)) return true; } catch { /* Ignore blocked session storage. */ }
  const local = new Set(['workspaces', 'folders', 'documents'].flatMap(kind =>
    data[kind as BackupKind].map(item => kind + '/' + item.id)));
  return readEntries(INDEX).some(entry => !local.has(key(entry)));
}
type CloudRecord = { meta: Omit<FlowDocument, 'markdown' | 'asset'> & { assetType?: string };
  bytes: number; checksum: string; urls: string[] };
export async function restoreBackup(): Promise<Restored> {
  const signal = AbortSignal.timeout(120000);
  const { entries } = await json<{ entries: Entry[] }>(await request('GET', 'list', undefined, {}, signal));
  const result: Restored = { documents: [], workspaces: [], folders: [] };
  const deleted = new Set(readEntries(TOMBSTONES).map(key));
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      if (deleted.has(key(entry))) continue;
      const response = await request('GET', 'read', entry, {}, signal);
      if (response.status === 404) continue; // Committed tombstone.
      const record = await json<CloudRecord>(response);
      if (record.meta.id !== entry.id) throw new Error('Invalid backup record');
      if (entry.kind === 'workspaces') result.workspaces.push(record.meta as unknown as Workspace);
      else if (entry.kind === 'folders') result.folders.push(record.meta as unknown as Folder);
      else {
        if (!Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > LIMIT ||
            !Array.isArray(record.urls) || record.urls.length > 100 || (record.bytes > 0 && record.urls.length === 0) ||
            !record.urls.every(url => (url.startsWith('https://') || url.startsWith('/api/storage?ticket=')))) throw new Error('Invalid backup manifest');
        const parts = await Promise.all(record.urls.map(async url => {
          const part = await fetch(url, { signal, cache: 'no-store' });
          if (!part.ok) throw new Error('Backup download failed');
          return part.blob();
        }));
        const { assetType, ...fields } = record.meta;
        const blob = new Blob(parts, { type: assetType });
        if (blob.size !== record.bytes || await checksum(blob) !== record.checksum)
          throw new Error('Backup integrity check failed');
        result.documents.push({ ...fields, markdown: assetType === undefined ? await blob.text() : '',
          ...(assetType === undefined ? {} : { asset: blob }) });
      }
      updateEntries(INDEX, entry, true);
    }
  }));
  try { sessionStorage.removeItem(FORCE_RESTORE); } catch { /* Restore already succeeded. */ }
  return result;
}
export async function publishBackup(doc: FlowDocument, onProgress?: (percent: number) => void): Promise<string> {
  if (doc.asset) throw new Error('Only text pages can be shared');
  const job: Job = { kind: 'documents', id: doc.id, value: doc };
  const id = key(job);
  if (readEntries(TOMBSTONES).some(entry => key(entry) === id))
    throw new Error('This page has been deleted.');
  const publish = () => request('POST', 'publish', job, { updatedAt: doc.updatedAt });
  // Most shares are already backed up, including after a browser reload.
  // A revision check on the server is authoritative; never expose stale data.
  if (synced.has(id) || running.has(id) || readEntries(INDEX).some(entry => key(entry) === id)) {
    const response = await publish();
    if (response.ok) {
      onProgress?.(100);
      return (await json<{ id: string }>(response)).id;
    }
    if (response.status !== 404 && response.status !== 409) await json(response);
  }
  const queued = pending.get(id);
  if (queued?.value && (queued.value as FlowDocument).updatedAt <= doc.updatedAt) pending.delete(id);
  try { await run(job); }
  catch (error) { if (!pending.has(id)) pending.set(id, job); schedule(30000); throw error; }
  const result = await json<{ id: string }>(await publish());
  onProgress?.(100);
  return result.id;
}
export async function unpublishBackup(documentId: string) {
  await json(await request('DELETE', 'unpublish', { kind: 'documents', id: documentId }));
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    if (pending.size) schedule(0);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pending.size && !draining) {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      void drain();
    }
  });
}
