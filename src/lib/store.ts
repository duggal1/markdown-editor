import { needsBackupRecovery, queueBackup, queueBackupDeletion, restoreBackup, resumeBackup } from './backup';
import { restoreDocument } from './document';
import { sameEmptyDraft } from './emptyDraft';
import type { AccentTheme } from './accentTheme';

export type Theme = 'light' | 'dark';
export type Mode = 'write' | 'split' | 'preview';
export type Workspace = { id: string; name: string; createdAt: number };
export type Folder = { id: string; workspaceId: string; name: string; createdAt: number };
export type FlowDocument = {
  id: string; workspaceId: string; folderId?: string; parentId?: string; title: string; titleAuto: boolean;
  markdown: string; createdAt: number; updatedAt: number;
  fileName?: string; fileType?: 'text' | 'image' | 'binary'; language?: string; asset?: Blob;
};
export type Preferences = {
  theme: Theme; accentTheme?: AccentTheme; mode: Mode; sidebarOpen: boolean;
  activeWorkspaceId: string; activeDocumentId: string; recentIds: string[];
  expandedWorkspaceIds?: string[];
  splitPercent?: number;
};

const DATABASE = 'flow.workspace.v1';
const PREFS = 'flow.preferences.v1';
const RECOVERY = 'flow.last-edit.v1';
const RECOVERY_ID = 'flow.last-edit.id.v1';
const RECOVERY_PREFIX = 'flow.recovery.document.v2.';
const FALLBACK = 'flow.document.';
let dbPromise: Promise<IDBDatabase> | undefined;

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
}
function database(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('workspaces')) db.createObjectStore('workspaces', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('IndexedDB unavailable'));
    request.onblocked = () => reject(Error('Another tab is blocking the document database'));
  }).catch(error => { dbPromise = undefined; throw error; });
  return dbPromise!;
}
type WorkspaceSnapshot = { workspaces: Workspace[]; folders: Folder[]; documents: FlowDocument[] };
/** All three stores are read from one consistent IndexedDB transaction. */
async function readWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['workspaces', 'folders', 'documents'], 'readonly');
    const workspaces = tx.objectStore('workspaces').getAll();
    const folders = tx.objectStore('folders').getAll();
    const documents = tx.objectStore('documents').getAll();
    tx.oncomplete = () => resolve({ workspaces: workspaces.result, folders: folders.result, documents: documents.result });
    tx.onerror = () => reject(tx.error || Error('Workspace read failed'));
    tx.onabort = () => reject(tx.error || Error('Workspace read aborted'));
  });
}
async function put(store: 'documents' | 'workspaces' | 'folders', value: FlowDocument | Workspace | Folder): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function remove(store: 'documents' | 'workspaces' | 'folders', id: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function readJson<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch { return null; }
}
export function readPrefs(): Partial<Preferences> {
  return readJson<Partial<Preferences>>(PREFS) || {};
}
export function savePrefs(prefs: Preferences): void {
  try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* Storage blocked. */ }
}
function newestDocument(...candidates: (FlowDocument | null)[]): FlowDocument | null {
  return candidates.reduce<FlowDocument | null>((best, candidate) =>
    candidate && (!best || candidate.updatedAt > best.updatedAt) ? candidate : best, null);
}
function readRecoveryFor(id: string): FlowDocument | null {
  const current = readJson<FlowDocument>(RECOVERY_PREFIX + id);
  const legacy = readJson<FlowDocument>(RECOVERY);
  return newestDocument(current, legacy?.id === id ? legacy : null);
}
export function saveRecovery(doc: FlowDocument): void {
  // Large sources use the asynchronous primary IndexedDB commit. Never stringify
  // megabytes on the UI thread just to write a redundant emergency snapshot.
  if (doc.markdown.length > 240_000 || doc.asset) return;
  try {
    const previous = readRecoveryFor(doc.id);
    if (previous && previous.updatedAt > doc.updatedAt) return;
    localStorage.setItem(RECOVERY_PREFIX + doc.id, JSON.stringify(doc));
  } catch { /* IndexedDB remains primary. */ }
}
export function clearRecovery(id: string, throughUpdatedAt = Infinity): void {
  try {
    const current = readJson<FlowDocument>(RECOVERY_PREFIX + id);
    if (current && current.updatedAt <= throughUpdatedAt) localStorage.removeItem(RECOVERY_PREFIX + id);
    const marker = localStorage.getItem(RECOVERY_ID);
    if (marker && marker !== id) return;
    const legacy = readJson<FlowDocument>(RECOVERY);
    if (legacy?.id === id && legacy.updatedAt <= throughUpdatedAt) {
      localStorage.removeItem(RECOVERY);
      localStorage.removeItem(RECOVERY_ID);
    }
  } catch { /* no-op */ }
}
/** Read the newest available revision without loading all workspace contents. */
export async function loadDoc(id: string): Promise<FlowDocument | null> {
  let stored: FlowDocument | null = null;
  try {
    const db = await database();
    stored = await new Promise<FlowDocument | null>((resolve, reject) => {
      const request = db.transaction('documents', 'readonly').objectStore('documents').get(id);
      request.onsuccess = () => resolve((request.result as FlowDocument | undefined) || null);
      request.onerror = () => reject(request.error);
    });
  } catch { /* Emergency fallback after an IndexedDB failure. */ }
  return newestDocument(stored, readJson<FlowDocument>(FALLBACK + id), readRecoveryFor(id));
}

export async function saveDoc(doc: FlowDocument): Promise<void> {
  try {
    await put('documents', doc);
    // A successful primary commit supersedes any older emergency fallback.
    try {
      const fallback = readJson<FlowDocument>(FALLBACK + doc.id);
      if (!fallback || fallback.updatedAt <= doc.updatedAt) localStorage.removeItem(FALLBACK + doc.id);
    } catch { /* IndexedDB is authoritative. */ }
  }
  catch (error) {
    if (doc.asset) throw error; // Browser storage cannot safely JSON-serialize file data.
    try { localStorage.setItem(FALLBACK + doc.id, JSON.stringify(doc)); }
    catch { throw error; }
  }
  queueBackup('documents', doc);
}
export async function saveWorkspace(ws: Workspace): Promise<void> {
  await put('workspaces', ws);
  queueBackup('workspaces', ws);
}
export async function saveFolder(folder: Folder): Promise<void> {
  await put('folders', folder);
  queueBackup('folders', folder);
}
export async function removeFolder(id: string): Promise<void> {
  await remove('folders', id);
  queueBackupDeletion('folders', id);
}
export async function removeDoc(id: string): Promise<void> {
  await remove('documents', id);
  try { localStorage.removeItem(FALLBACK + id); } catch { /* no-op */ }
  clearRecovery(id);
  queueBackupDeletion('documents', id);
}
/** Compare and delete inside one transaction, so an independently saved edit
 * cannot be silently removed by an obsolete automatic-cleanup timer. */
export async function removeEmptyDraft(expected: FlowDocument): Promise<boolean> {
  const id = expected.id;
  if (readPrefs().activeDocumentId === id || readJson<FlowDocument>(FALLBACK + id) ||
    readRecoveryFor(id)) return false;
  const db = await database();
  const removed = await new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction('documents', 'readwrite');
    const docs = tx.objectStore('documents');
    let deleted = false;
    const request = docs.get(id);
    request.onsuccess = () => {
      const current = request.result as FlowDocument | undefined;
      if (!current || !sameEmptyDraft(current, expected) || readPrefs().activeDocumentId === id) return;
      // Also protect a subpage created in another tab after the UI snapshot.
      const cursor = docs.openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (entry) {
          if ((entry.value as FlowDocument).parentId === id) return;
          entry.continue();
        } else if (readPrefs().activeDocumentId !== id && !readJson<FlowDocument>(FALLBACK + id) &&
          !readRecoveryFor(id)) {
          docs.delete(id);
          deleted = true;
        }
      };
    };
    tx.oncomplete = () => resolve(deleted);
    tx.onerror = () => reject(tx.error || Error('Draft cleanup failed'));
    tx.onabort = () => reject(tx.error || Error('Draft cleanup aborted'));
  });
  if (removed) queueBackupDeletion('documents', id);
  return removed;
}
export async function removeWorkspace(id: string): Promise<void> {
  await remove('workspaces', id);
  queueBackupDeletion('workspaces', id);
}

/** Delete an entire workspace atomically in one IndexedDB transaction.
 * Sequential per-file transactions were extremely slow for large workspaces
 * and could leave half a workspace deleted after an error.
 */
export async function removeWorkspaceTree(
  workspaceId: string, documentIds: string[], folderIds: string[],
): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['documents', 'folders', 'workspaces'], 'readwrite');
    const docs = tx.objectStore('documents');
    const dirs = tx.objectStore('folders');
    for (const id of documentIds) docs.delete(id);
    for (const id of folderIds) dirs.delete(id);
    tx.objectStore('workspaces').delete(workspaceId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || Error('Workspace deletion failed'));
    tx.onabort = () => reject(tx.error || Error('Workspace deletion was rolled back'));
  });
  for (const id of documentIds) {
    try { localStorage.removeItem(FALLBACK + id); } catch { /* IndexedDB is primary. */ }
    clearRecovery(id);
    queueBackupDeletion('documents', id);
  }
  for (const id of folderIds) queueBackupDeletion('folders', id);
  queueBackupDeletion('workspaces', workspaceId);
}

let workspaceLoad: Promise<WorkspaceSnapshot> | undefined;
/** Deduplicate simultaneous startup reads, including React StrictMode remounts.
 * Do not retain a stale snapshot after completion: IndexedDB remains authoritative.
 */
export function loadWorkspace(): Promise<WorkspaceSnapshot> {
  if (!workspaceLoad) {
    workspaceLoad = loadWorkspaceOnce().finally(() => { workspaceLoad = undefined; });
  }
  return workspaceLoad;
}
async function loadWorkspaceOnce(): Promise<WorkspaceSnapshot> {
  let workspaces: Workspace[] = [];
  let folders: Folder[] = [];
  let documents: FlowDocument[] = [];
  let readError: unknown = null;
  try {
    ({ workspaces, folders, documents } = await readWorkspaceSnapshot());
  } catch (error) {
    // Never interpret an unreadable IndexedDB as an empty workspace: it may
    // contain every document the user has ever created.
    readError = error;
  }

  // Merge emergency records by ID and revision in linear time. A crash while
  // switching pages can leave multiple drafts; never let one overwrite another.
  const byId = new Map(documents.map(doc => [doc.id, doc]));
  const mergeRecovery = (saved: FlowDocument | null) => {
    if (!saved || typeof saved.id !== 'string' || typeof saved.markdown !== 'string' || !Number.isFinite(saved.updatedAt)) return;
    const current = byId.get(saved.id);
    if (!current || saved.updatedAt > current.updatedAt) byId.set(saved.id, saved);
  };
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key && (key.startsWith(FALLBACK) || key.startsWith(RECOVERY_PREFIX))) mergeRecovery(readJson<FlowDocument>(key));
    }
  } catch { /* Local storage disabled. */ }
  mergeRecovery(readJson<FlowDocument>(RECOVERY));
  documents = [...byId.values()];

  // Recover before creating any defaults. Healthy local loads never wait for the cloud.
  if (needsBackupRecovery({ workspaces, folders, documents })) {
    try {
      const cloud = await restoreBackup();
      for (const ws of cloud.workspaces) if (!workspaces.some(item => item.id === ws.id)) {
        workspaces.push(ws);
        try { await put('workspaces', ws); } catch { /* Keep recovered data visible. */ }
      }
      for (const folder of cloud.folders) if (!folders.some(item => item.id === folder.id)) {
        folders.push(folder);
        try { await put('folders', folder); } catch { /* Keep recovered data visible. */ }
      }
      for (const doc of cloud.documents) {
        const index = documents.findIndex(item => item.id === doc.id);
        if (index >= 0 && documents[index].updatedAt >= doc.updatedAt) continue;
        if (index < 0) documents.push(doc);
        else documents[index] = doc;
        try { await put('documents', doc); } catch { /* Keep recovered data visible. */ }
      }
    } catch (error) {
      // A failed remote read is not an empty backup. Do not initialize a new
      // blank workspace over a potentially recoverable one.
      if (!documents.length) throw error;
    }
  }

  // A missing workspace row must not hide documents whose workspaceId still
  // exists in the document store. Restore the original ID, not a replacement.
  const knownWorkspaces = new Set(workspaces.map(ws => ws.id));
  const missingWorkspaces = new Map<string, number>();
  for (const item of [...documents, ...folders]) {
    if (!item.workspaceId || knownWorkspaces.has(item.workspaceId)) continue;
    const createdAt = Number.isFinite(item.createdAt) ? item.createdAt : Date.now();
    missingWorkspaces.set(item.workspaceId,
      Math.min(missingWorkspaces.get(item.workspaceId) ?? createdAt, createdAt));
  }
  for (const [id, createdAt] of missingWorkspaces) {
    const recovered: Workspace = { id, name: 'Recovered workspace', createdAt };
    workspaces.push(recovered);
    knownWorkspaces.add(id);
    if (!readError) {
      try { await saveWorkspace(recovered); } catch { /* Keep the files visible. */ }
    }
  }

  // If IndexedDB failed and no recovery snapshot exists, do not fabricate a
  // blank document. Nothing is deleted, and a later reload can still recover.
  if (readError && !documents.length) {
    throw new Error('Document database could not be read. Existing data was not changed.');
  }
  if (!workspaces.length) {
    const ws: Workspace = { id: uid(), name: 'My workspace', createdAt: Date.now() };
    workspaces = [ws];
    try { await saveWorkspace(ws); } catch { /* Still usable in memory. */ }
  }
  if (!documents.length) {
    const legacy = restoreDocument();
    const isUntitled = legacy.title === 'Untitled' || legacy.title === 'Untitled document';
    const doc: FlowDocument = {
      id: uid(), workspaceId: workspaces[0].id, title: isUntitled ? 'Untitled' : legacy.title,
      titleAuto: isUntitled, markdown: legacy.markdown,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    documents = [doc];
    await saveDoc(doc);
  }
  resumeBackup({ workspaces, folders, documents });
  return { workspaces, folders, documents };
}
export { inferTitle } from './title';

