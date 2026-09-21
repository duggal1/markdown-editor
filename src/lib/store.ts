import { restoreDocument } from './document';
import { detectRawCode } from './code';

export type Theme = 'light' | 'dark';
export type Mode = 'write' | 'split' | 'preview';
export type Workspace = { id: string; name: string; createdAt: number };
export type FlowDocument = {
  id: string; workspaceId: string; title: string; titleAuto: boolean;
  markdown: string; createdAt: number; updatedAt: number;
  fileName?: string; fileType?: 'text' | 'image' | 'binary'; language?: string; asset?: Blob;
};
export type Preferences = {
  theme: Theme; mode: Mode; sidebarOpen: boolean;
  activeWorkspaceId: string; activeDocumentId: string; recentIds: string[];
};

const DATABASE = 'flow.workspace.v1';
const PREFS = 'flow.preferences.v1';
const RECOVERY = 'flow.last-edit.v1';
const FALLBACK = 'flow.document.';
let dbPromise: Promise<IDBDatabase> | undefined;

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
}
function database(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('workspaces')) db.createObjectStore('workspaces', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('IndexedDB unavailable'));
    request.onblocked = () => reject(Error('Another tab is blocking the document database'));
  }).catch(error => { dbPromise = undefined; throw error; });
  return dbPromise!;
}
async function getAll<T>(store: 'documents' | 'workspaces'): Promise<T[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}
async function put(store: 'documents' | 'workspaces', value: FlowDocument | Workspace): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function remove(store: 'documents' | 'workspaces', id: string): Promise<void> {
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
  try { localStorage.setItem(RECOVERY, JSON.stringify(doc)); } catch { /* IndexedDB remains primary. */ }
}
export function clearRecovery(id: string): void {
  const saved = readJson<FlowDocument>(RECOVERY);
  if (saved && saved.id === id) {
    try { localStorage.removeItem(RECOVERY); } catch { /* no-op */ }
  }
}
export async function saveDoc(doc: FlowDocument): Promise<void> {
  try { await put('documents', doc); }
  catch (error) {
    try { localStorage.setItem(FALLBACK + doc.id, JSON.stringify(doc)); }
    catch { throw error; }
  }
}
export async function saveWorkspace(ws: Workspace): Promise<void> {
  await put('workspaces', ws);
}
export async function removeDoc(id: string): Promise<void> {
  await remove('documents', id);
  try { localStorage.removeItem(FALLBACK + id); } catch { /* no-op */ }
  clearRecovery(id);
}
export async function removeWorkspace(id: string): Promise<void> {
  await remove('workspaces', id);
}
export async function loadWorkspace(): Promise<{ workspaces: Workspace[]; documents: FlowDocument[] }> {
  let workspaces: Workspace[] = [];
  let documents: FlowDocument[] = [];
  try {
    [workspaces, documents] = await Promise.all([
      getAll<Workspace>('workspaces'), getAll<FlowDocument>('documents'),
    ]);
  } catch { /* Continue with emergency local fallback. */ }

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

  if (!workspaces.length) {
    const ws = { id: uid(), name: 'My workspace', createdAt: Date.now() };
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
  return { workspaces, documents };
}
export function inferTitle(markdown: string): string {
  const head = markdown.slice(0, 8000);
  const heading = /^\s*#\s+(.+)$/m.exec(head);
  if (heading) return heading[1].replace(/[*_~\x60]/g, '').trim().slice(0, 76) || 'Untitled';
  const language = detectRawCode(head);
  if (language) {
    const symbol = language === 'swift'
      ? /\b(?:struct|class|enum|protocol)\s+([A-Za-z_$][\w$]*)/.exec(head)
      : /\b(?:class|function|fn|def|interface)\s+([A-Za-z_$][\w$]*)/.exec(head);
    if (symbol) return symbol[1];
    return language === 'typescript' ? 'TypeScript code' : language.charAt(0).toUpperCase() + language.slice(1) + ' code';
  }
  const fence = /^\s*\x60{3,}([^\s\x60]*)/.exec(head);
  if (fence) {
    const lang = fence[1].toLowerCase();
    return lang ? lang === 'ts' ? 'TypeScript code' : lang === 'js' ? 'JavaScript code'
      : lang.charAt(0).toUpperCase() + lang.slice(1) + ' code' : 'Code';
  }
  const first = head.split('\n').find(line => line.trim() && !/^\s*[-*_]{3,}\s*$/.test(line));
  return first
    ? first.replace(/^[#>*\-\s]+/, '').replace(/[*_~\x60]/g, '').trim().slice(0, 76) || 'Untitled'
    : 'Untitled';
}
export function wordCount(value: string): number {
  const words = value.trim().match(/\S+/g);
  return words?.length || 0;
}
