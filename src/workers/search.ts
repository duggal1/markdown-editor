import { PageSearchIndex, type SearchDocument } from '../lib/searchIndex';

type Incoming =
  | { type: 'index'; documents: SearchDocument[] }
  | { type: 'upsert'; document: SearchDocument }
  | { type: 'remove'; id: string }
  | { type: 'query'; query: string; requestId: number };

const index = new PageSearchIndex();
let lastQuery: { query: string; requestId: number } | undefined;
function refresh() {
  if (lastQuery) self.postMessage({ type: 'result', requestId: lastQuery.requestId, hits: index.search(lastQuery.query) });
}

self.onmessage = (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if (message.type === 'index') { index.reset(message.documents); refresh(); }
  else if (message.type === 'upsert') {
    index.upsert(message.document); refresh();
  } else if (message.type === 'remove') { index.remove(message.id); refresh(); }
  else {
    lastQuery = { query: message.query, requestId: message.requestId };
    self.postMessage({
      type: 'result', requestId: message.requestId,
      hits: index.search(message.query),
    });
  }
};
