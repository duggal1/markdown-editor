type IndexedDoc = { id: string; workspaceId: string; title: string; markdown: string; updatedAt: number };
type Incoming =
  | { type: 'index'; documents: IndexedDoc[] }
  | { type: 'upsert'; document: IndexedDoc }
  | { type: 'remove'; id: string }
  | { type: 'metrics'; document: { id: string; markdown: string; updatedAt: number } }
  | { type: 'query'; query: string; requestId: number };
const docs = new Map<string, IndexedDoc>();
const titleIndex = new Map<string, string>();
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
  if (message.type === 'index') {
    docs.clear();
    titleIndex.clear();
    for (const doc of message.documents) { docs.set(doc.id, doc); titleIndex.set(doc.id, doc.title.toLowerCase()); }
  } else if (message.type === 'upsert') {
    docs.set(message.document.id, message.document);
    titleIndex.set(message.document.id, message.document.title.toLowerCase());
    postMetrics(message.document);
  } else if (message.type === 'metrics') {
    postMetrics(message.document);
  } else if (message.type === 'remove') {
    docs.delete(message.id);
    titleIndex.delete(message.id);
  } else {
    const query = message.query.trim().toLowerCase();
    if (!query) {
      self.postMessage({ type: 'result', requestId: message.requestId, ids: [] });
      return;
    }
    const matches = [...docs.values()].filter(doc =>
      titleIndex.get(doc.id)?.includes(query) || doc.markdown.toLowerCase().includes(query),
    ).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 500).map(doc => doc.id);
    self.postMessage({ type: 'result', requestId: message.requestId, ids: matches });
  }
};
