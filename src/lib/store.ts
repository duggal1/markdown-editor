import { needsBackupRecovery, queueBackup, queueBackupDeletion, restoreBackup, resumeBackup } from './backup';
import { restoreDocument } from './document';
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
async function getAll<T>(store: 'documents' | 'workspaces' | 'folders'): Promise<T[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
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
export function saveRecovery(doc: FlowDocument): void {
  // localStorage is synchronous; huge recovery snapshots can freeze the page.
  // IndexedDB remains primary for large documents and binary assets.
  if (doc.markdown.length > 240_000 || doc.asset) {
    clearRecovery(doc.id);
    return;
  }
  try {
    localStorage.setItem(RECOVERY, JSON.stringify(doc));
    localStorage.setItem(RECOVERY_ID, doc.id);
  } catch { /* IndexedDB remains primary. */ }
}
export function clearRecovery(id: string): void {
  // The marker avoids reparsing megabytes of recovery JSON after every save.
  try {
    const marker = localStorage.getItem(RECOVERY_ID);
    if (marker ? marker !== id : readJson<FlowDocument>(RECOVERY)?.id !== id) return;
    localStorage.removeItem(RECOVERY);
    localStorage.removeItem(RECOVERY_ID);
  } catch { /* no-op */ }
}
/** Load exactly one document, without reading a workspace of potentially huge files. */
export async function loadDoc(id: string): Promise<FlowDocument | null> {
  try {
    const db = await database();
    const stored = await new Promise<FlowDocument | null>((resolve, reject) => {
      const request = db.transaction('documents', 'readonly').objectStore('documents').get(id);
      request.onsuccess = () => resolve((request.result as FlowDocument | undefined) || null);
      request.onerror = () => reject(request.error);
    });
    if (stored) return stored;
  } catch { /* Emergency fallback after an IndexedDB failure. */ }
  return readJson<FlowDocument>(FALLBACK + id) ||
    (readJson<FlowDocument>(RECOVERY)?.id === id ? readJson<FlowDocument>(RECOVERY) : null);
}

export async function saveDoc(doc: FlowDocument): Promise<void> {
  try { await put('documents', doc); }
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

export async function loadWorkspace(): Promise<{ workspaces: Workspace[]; folders: Folder[]; documents: FlowDocument[] }> {
  let workspaces: Workspace[] = [];
  let folders: Folder[] = [];
  let documents: FlowDocument[] = [];
  let readError: unknown = null;
  try {
    [workspaces, folders, documents] = await Promise.all([
      getAll<Workspace>('workspaces'), getAll<Folder>('folders'), getAll<FlowDocument>('documents'),
    ]);
  } catch (error) {
    // Never interpret an unreadable IndexedDB as an empty workspace: it may
    // contain every document the user has ever created.
    readError = error;
  }

  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(FALLBACK)) continue;
      const saved = readJson<FlowDocument>(key);
      if (saved && typeof saved.id === 'string' && typeof saved.markdown === 'string') {
        const existing = documents.findIndex(doc => doc.id === saved.id);
        if (existing < 0) documents.push(saved);
        else if (saved.updatedAt > documents[existing].updatedAt) documents[existing] = saved;
      }
    }
  } catch { /* Local storage disabled. */ }
  const recovered = readJson<FlowDocument>(RECOVERY);
  if (recovered && typeof recovered.id === 'string' && typeof recovered.markdown === 'string') {
    const existing = documents.findIndex(doc => doc.id === recovered.id);
    if (existing < 0) documents.push(recovered);
    else if (recovered.updatedAt > documents[existing].updatedAt) documents[existing] = recovered;
  }

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
export function wordCount(value: string): number {
  let words = 0;
  let whitespace = true;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const blank = c === 32 || (c >= 9 && c <= 13) || c === 160 ||
      c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
      c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
    if (!blank && whitespace) words++;
    whitespace = blank;
  }
  return words;
}
