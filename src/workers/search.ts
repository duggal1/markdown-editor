import { PageSearchIndex, type SearchDocument } from '../lib/searchIndex';
import { documentDigest, readDerivedTerms, storeDerivedTerms, forgetDerivedTerms, pruneDerivedTerms } from './searchCache';

type Incoming =
  | { type: 'index'; documents: SearchDocument[] }
  | { type: 'upsert'; document: SearchDocument }
  | { type: 'remove'; id: string }
  | { type: 'cancel' }
  | { type: 'query'; query: string; requestId: number };

const index = new PageSearchIndex();
let lastQuery: { query: string; requestId: number } | undefined;
let writes = Promise.resolve();
let generation = 0;
const changed = new Set<string>();

function refresh() {
  if (lastQuery) self.postMessage({ type: 'result', requestId: lastQuery.requestId, hits: index.search(lastQuery.query) });
}
function cacheWrite(action: () => Promise<void>) {
  writes = writes.then(action, action);
}
async function populate(doc: SearchDocument, epoch: number) {
  const digest = await documentDigest(doc);
  const cached = await readDerivedTerms(doc.id, digest);
  // A newer edit/delete or a replacement snapshot wins over startup work.
  if (epoch !== generation || changed.has(doc.id)) return;
  index.upsert(doc, cached);
  if (!cached) {
    const terms = index.preparedTerms(doc.id);
    cacheWrite(() => storeDerivedTerms(doc.id, digest, terms));
  }
}
async function rebuild(documents: SearchDocument[]) {
  const epoch = ++generation;
  changed.clear();
  index.reset([]);
  const ids = new Set(documents.map(doc => doc.id));
  cacheWrite(() => pruneDerivedTerms(ids));
  // Show title/content matches from completed batches, without waiting for every
  // large page. All expensive tokenization remains outside the UI thread.
  const batchSize = 4;
  for (let i = 0; i < documents.length; i += batchSize) {
    // Overlap digest and IndexedDB reads, but bound the amount of source data
    // in flight. populate checks the epoch and edit/delete guard after I/O.
    await Promise.all(documents.slice(i, i + batchSize).map(doc => populate(doc, epoch)));
    if (epoch !== generation) return;
    if ((i + batchSize) % 16 === 0) refresh();
  }
  refresh();
}

self.onmessage = (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if (message.type === 'index') { void rebuild(message.documents); }
  else if (message.type === 'upsert') {
    changed.add(message.document.id);
    index.upsert(message.document);
    const document = message.document;
    const terms = index.preparedTerms(document.id);
    cacheWrite(async () => storeDerivedTerms(document.id, await documentDigest(document), terms));
    refresh();
  } else if (message.type === 'remove') {
    changed.add(message.id);
    index.remove(message.id);
    cacheWrite(() => forgetDerivedTerms(message.id));
    refresh();
  } else if (message.type === 'cancel') {
    lastQuery = undefined;
  } else {
    lastQuery = { query: message.query, requestId: message.requestId };
    self.postMessage({
      type: 'result', requestId: message.requestId,
      hits: index.search(message.query),
    });
  }
};
