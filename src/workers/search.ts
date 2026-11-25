import { PageSearchIndex, type SearchDocument } from '../lib/searchIndex';

type Incoming =
  | { type: 'index'; documents: SearchDocument[] }
  | { type: 'upsert'; document: SearchDocument }
  | { type: 'remove'; id: string }
  | { type: 'query'; query: string; requestId: number };

const index = new PageSearchIndex();

self.onmessage = (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if (message.type === 'index') index.reset(message.documents);
  else if (message.type === 'upsert') {
    index.upsert(message.document);
  } else if (message.type === 'remove') index.remove(message.id);
  else self.postMessage({
    type: 'result', requestId: message.requestId,
    hits: index.search(message.query),
  });
};
