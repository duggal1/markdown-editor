import { PageSearchIndex, type SearchDocument } from '../lib/searchIndex';

type Incoming =
  | { type: 'index'; documents: SearchDocument[] }
  | { type: 'upsert'; document: SearchDocument }
  | { type: 'remove'; id: string }
  | { type: 'metrics'; document: { id: string; markdown: string; updatedAt: number } }
  | { type: 'query'; query: string; requestId: number };

const index = new PageSearchIndex();

function countWords(value: string): number {
  let words = 0;
  let previousWhitespace = true;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const whitespace = c === 32 || (c >= 9 && c <= 13) || c === 160 ||
      c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
      c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
    if (!whitespace && previousWhitespace) words++;
    previousWhitespace = whitespace;
  }
  return words;
}
function postMetrics(doc: { id: string; markdown: string; updatedAt: number }) {
  self.postMessage({ type: 'metrics', id: doc.id, updatedAt: doc.updatedAt,
    words: countWords(doc.markdown) });
}
self.onmessage = (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if (message.type === 'index') index.reset(message.documents);
  else if (message.type === 'upsert') {
    index.upsert(message.document);
    postMetrics(message.document);
  } else if (message.type === 'metrics') postMetrics(message.document);
  else if (message.type === 'remove') index.remove(message.id);
  else self.postMessage({
    type: 'result', requestId: message.requestId,
    hits: index.search(message.query),
  });
};
