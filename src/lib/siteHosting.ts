import { detectRawCode } from './code';
import type { FlowDocument } from './store';

export type SiteRecord = { id: string; secret: string; syncedVersion: number };
export type SiteStatus = 'syncing' | 'synced' | 'error';
const PREFIX = 'flow.html-site.v1.';
const LEGACY_PREFIX = 'flow.html-site.legacy.v1.';
const ID = /^(?:[A-Za-z0-9_-]{12}|html-[a-z0-9]{5})$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const MAX_BYTES = 10 * 1024 * 1024;
const FAST_PUBLISH_BYTES = 256 * 1024;
const CHARS_PER_CHUNK = 210_000;
const jobs = new Map<string, {
  latest: FlowDocument; timer: number | null; work: Promise<void>;
}>();
const pendingCreates = new Map<string, Promise<SiteRecord>>();

export function isHtmlPage(doc: FlowDocument | null | undefined): boolean {
  return Boolean(doc && !doc.asset &&
    (doc.language === 'html' || detectRawCode(doc.markdown) === 'html'));
}
export function siteUrl(id: string): string {
  return window.location.origin + (id.startsWith('html-') ? '/play/' : '/slug/') + encodeURIComponent(id);
}
export function localHtmlUrl(id: string): string {
  return window.location.origin + '/play/local/' + encodeURIComponent(id);
}
export function readSiteRecord(documentId: string): SiteRecord | null {
  try {
    const raw = localStorage.getItem(PREFIX + documentId);
    if (!raw) return null;
    const value: Partial<SiteRecord> = JSON.parse(raw);
    return value && typeof value.id === 'string' && ID.test(value.id) &&
      typeof value.secret === 'string' && SECRET.test(value.secret) &&
      typeof value.syncedVersion === 'number' ? value as SiteRecord : null;
  } catch { return null; }
}
function saveSiteRecord(documentId: string, record: SiteRecord): void {
  localStorage.setItem(PREFIX + documentId, JSON.stringify(record));
}
function signal(documentId: string, status: SiteStatus, error?: string) {
  window.dispatchEvent(new CustomEvent('flow-site-sync', {
    detail: { documentId, status, error },
  }));
}
async function send(method: 'POST' | 'PUT' | 'DELETE', body: object) {
  const response = await fetch('/api/site', {
    method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store',
  });
  const json = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(json?.error || 'HTML publishing failed (' + response.status + ')');
  return json;
}
/** Verify that the actual public player route exists on this deployment.
 * Blob metadata alone cannot detect a missing Vercel SPA rewrite. */
async function verifyPublicRoute(id: string, signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(siteUrl(id), {
    method: 'HEAD', signal, cache: 'no-store',
  });
  return response.ok && (response.headers.get('content-type') || '').includes('text/html');
}

/** Never claim "Live" merely because a Blob was committed. */
export async function verifyHostedHtml(id: string, signal?: AbortSignal): Promise<boolean> {
  if (!ID.test(id)) return false;
  const response = await fetch('/api/site?id=' + encodeURIComponent(id) + '&status=1', {
    method: 'GET', signal, cache: 'no-store',
  });
  if (!response.ok) return false;
  const value = await response.json().catch(() => null) as { published?: boolean } | null;
  if (value?.published !== true) return false;
  return verifyPublicRoute(id, signal);
}

function chunkText(source: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < source.length;) {
    let end = Math.min(source.length, start + CHARS_PER_CHUNK);
    // Do not bisect a UTF-16 surrogate pair. The server validates the exact
    // UTF-8 byte count before making a new version public.
    if (end < source.length && source.charCodeAt(end - 1) >= 0xD800 &&
        source.charCodeAt(end - 1) <= 0xDBFF) end--;
    chunks.push(source.slice(start, end));
    start = end;
  }
  return chunks;
}
async function uploadSnapshot(doc: FlowDocument, record: SiteRecord) {
  const size = new Blob([doc.markdown]).size;
  if (size > MAX_BYTES) throw new Error('Cloud hosting supports HTML up to 10 MB. The local preview remains available.');
  const chunks = chunkText(doc.markdown);
  if (chunks.length < 1 || chunks.length > 80) throw new Error('HTML document is too large to publish.');
  const version = crypto.randomUUID().replaceAll('-', '');
  let index = 0;
  // Bounded parallel requests avoid a single 10 MB Vercel request and avoid
  // opening dozens of uploads at once on unreliable connections.
  await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, async () => {
    while (index < chunks.length) {
      const current = index++;
      await send('PUT', { action: 'chunk', id: record.id, secret: record.secret,
        version, index: current, text: chunks[current] });
    }
  }));
  await send('PUT', { action: 'commit', id: record.id, secret: record.secret,
    version, chunks: chunks.length, size });
  if (!await verifyHostedHtml(record.id)) {
    throw new Error('Published HTML is not available yet. Retry publishing.');
  }
}
export function queueSiteSync(doc: FlowDocument, immediate = false, force = false): void {
  if (!readSiteRecord(doc.id) || !isHtmlPage(doc)) return;
  let job = jobs.get(doc.id);
  if (!job) {
    job = { latest: doc, timer: null, work: Promise.resolve() };
    jobs.set(doc.id, job);
  }
  job.latest = doc;
  if (job.timer !== null) clearTimeout(job.timer);
  const current = job;
  current.timer = window.setTimeout(() => {
    current.timer = null;
    current.work = current.work.catch(() => {}).then(async () => {
      const snapshot = current.latest;
      const record = readSiteRecord(doc.id);
      if (!record || (!force && record.syncedVersion === snapshot.updatedAt)) return;
      signal(doc.id, 'syncing');
      try {
        await uploadSnapshot(snapshot, record);
        const latestRecord = readSiteRecord(doc.id);
        if (latestRecord?.id === record.id) {
          saveSiteRecord(doc.id, { ...latestRecord, syncedVersion: snapshot.updatedAt });
          signal(doc.id, 'synced');
          if (current.latest.updatedAt !== snapshot.updatedAt) {
            queueSiteSync(current.latest);
          }
        }
      } catch (error) {
        signal(doc.id, 'error', error instanceof Error ? error.message : 'Cloud upload failed');
      }
    });
  }, immediate ? 0 : 2200);
}
export async function publishHtml(doc: FlowDocument): Promise<SiteRecord> {
  if (!isHtmlPage(doc)) throw new Error('Only HTML pages can be hosted as interactive sites.');
  const creating = pendingCreates.get(doc.id);
  if (creating) return creating;
  const existing = readSiteRecord(doc.id);
  // Existing 12-character links are upgraded on publish, but retained as
  // aliases so links already shared with other people do not suddenly die.
  if (existing?.id.startsWith('html-')) {
    const ready = await verifyHostedHtml(existing.id).catch(() => false);
    queueSiteSync(doc, true, !ready);
    // Never report an old local timestamp as live after the public route
    // fails its actual HTTP health check.
    return ready ? existing : { ...existing, syncedVersion: 0 };
  }
  const promise = (async () => {
    signal(doc.id, 'syncing');
    try {
      if (new Blob([doc.markdown]).size > MAX_BYTES) throw new Error('HTML exceeds the 10 MB publishing limit.');
      // Small HTML pages use one API request. Bigger pages keep the same
      // bounded chunk upload path, including the existing 10 MiB limit.
      const size = new Blob([doc.markdown]).size;
      const created = await send('POST', size <= FAST_PUBLISH_BYTES
        ? { html: doc.markdown } : {}) as {
          id?: string; secret?: string; published?: boolean;
        };
      if (!created || typeof created.id !== 'string' || !ID.test(created.id) ||
          typeof created.secret !== 'string' || !SECRET.test(created.secret)) {
        throw new Error('Cloud returned an invalid site ID.');
      }
      const ready = Boolean(created.published) &&
        await verifyPublicRoute(created.id).catch(() => false);
      const record = { id: created.id, secret: created.secret,
        syncedVersion: ready ? doc.updatedAt : 0 };
      if (existing) {
        // Preserve the old publishing credentials for eventual revocation.
        localStorage.setItem(LEGACY_PREFIX + doc.id, JSON.stringify(existing));
      }
      saveSiteRecord(doc.id, record);
      if (ready) signal(doc.id, 'synced');
      else if (created.published) {
        signal(doc.id, 'error', 'HTML was saved, but the public page could not be opened.');
      } else queueSiteSync(doc, true);
      return record;
    } catch (error) {
      signal(doc.id, 'error', error instanceof Error ? error.message : 'Cloud hosting failed');
      throw error;
    } finally {
      pendingCreates.delete(doc.id);
    }
  })();
  pendingCreates.set(doc.id, promise);
  return promise;
}
export async function revokeHtml(documentId: string): Promise<void> {
  await pendingCreates.get(documentId)?.catch(() => {});
  const job = jobs.get(documentId);
  if (job) {
    if (job.timer !== null) clearTimeout(job.timer);
    job.timer = null;
    await job.work.catch(() => {});
  }
  const record = readSiteRecord(documentId);
  let previous: SiteRecord | null = null;
  try {
    const raw = localStorage.getItem(LEGACY_PREFIX + documentId);
    if (raw) previous = JSON.parse(raw) as SiteRecord;
  } catch { /* Keep the primary site revocation available. */ }
  for (const current of [record, previous]) {
    if (!current) continue;
    try {
      await send('DELETE', { id: current.id, secret: current.secret });
    } catch (error) {
      // Already-deleted remote sites must not block local revocation.
      if (!String(error).includes('(404)') && !String(error).includes('Site not found')) throw error;
    }
  }
  localStorage.removeItem(PREFIX + documentId);
  localStorage.removeItem(LEGACY_PREFIX + documentId);
  jobs.delete(documentId);
}
