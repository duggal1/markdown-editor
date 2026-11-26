import type { PreparedSearchTerms, SearchDocument } from '../lib/searchIndex';

// Derived cache only. The document database remains authoritative.
// Store no raw Markdown or excerpts. The content digest prevents stale reuse.
type CacheRow = PreparedSearchTerms & { id: string; digest: string };
const DB = 'flow.search-derived.v1';
const MAX_TERMS = 25_000;
const MAX_ROWS = 256;
let connection: Promise<IDBDatabase | null> | undefined;

function database(): Promise<IDBDatabase | null> {
  return connection ??= new Promise(resolve => {
    if (!('indexedDB' in globalThis)) { resolve(null); return; }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('terms', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => resolve(null);
  });
}

export async function documentDigest(doc: SearchDocument): Promise<string | null> {
  try {
    // JSON array preserves field boundaries; SHA-256 runs in the worker.
    const bytes = new TextEncoder().encode(JSON.stringify([doc.title, doc.markdown]));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

export async function readDerivedTerms(id: string, digest: string | null): Promise<PreparedSearchTerms | undefined> {
  if (!digest) return;
  try {
    const db = await database();
    if (!db) return;
    return await new Promise(resolve => {
      const request = db.transaction('terms', 'readonly').objectStore('terms').get(id);
      request.onsuccess = () => {
        const row = request.result as CacheRow | undefined;
        resolve(row?.digest === digest && row.terms instanceof Map && Number.isSafeInteger(row.wordCount) && row.wordCount >= 0 ? row : undefined);
      };
      request.onerror = () => resolve(undefined);
    });
  } catch { return undefined; }
}

async function write(action: (store: IDBObjectStore) => void): Promise<void> {
  try {
    const db = await database();
    if (!db) return;
    await new Promise<void>(resolve => {
      const tx = db.transaction('terms', 'readwrite');
      tx.oncomplete = tx.onabort = tx.onerror = () => resolve();
      action(tx.objectStore('terms'));
    });
  } catch { /* Cache unavailable or full: search still works from source. */ }
}
export function storeDerivedTerms(id: string, digest: string | null, prepared: PreparedSearchTerms | undefined): Promise<void> {
  if (!digest || !prepared || prepared.terms.size > MAX_TERMS) return forgetDerivedTerms(id);
  return write(store => {
    store.put({ id, digest, ...prepared } satisfies CacheRow);
    const count = store.count();
    count.onsuccess = () => {
      let excess = count.result - MAX_ROWS;
      if (excess <= 0) return;
      const cursor = store.openKeyCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current || excess <= 0) return;
        if (current.primaryKey !== id) { store.delete(current.primaryKey); excess--; }
        current.continue();
      };
    };
  });
}
export function forgetDerivedTerms(id: string): Promise<void> {
  return write(store => { store.delete(id); });
}
export function pruneDerivedTerms(ids: ReadonlySet<string>): Promise<void> {
  return write(store => {
    const cursor = store.openKeyCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      if (!ids.has(String(current.primaryKey))) store.delete(current.primaryKey);
      current.continue();
    };
  });
}
