type IndexedDoc = { id: string; workspaceId: string; title: string; markdown: string; updatedAt: number };
type Incoming =
  | { type: 'index'; documents: IndexedDoc[] }
  | { type: 'upsert'; document: IndexedDoc }
  | { type: 'remove'; id: string }
  | { type: 'query'; query: string; requestId: number };
const docs = new Map<string, IndexedDoc>();
self.onmessage = (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if (message.type === 'index') {
    docs.clear();
    for (const doc of message.documents) docs.set(doc.id, doc);
  } else if (message.type === 'upsert') {
    docs.set(message.document.id, message.document);
  } else if (message.type === 'remove') {
    docs.delete(message.id);
  } else {
    const query = message.query.trim().toLocaleLowerCase();
    if (!query) {
      self.postMessage({ type: 'result', requestId: message.requestId, ids: [] });
      return;
    }
    const matches = [...docs.values()].filter(doc =>
      doc.title.toLocaleLowerCase().includes(query) ||
      doc.markdown.toLocaleLowerCase().includes(query),
    ).sort((a, b) => b.updatedAt - a.updatedAt).map(doc => doc.id);
    self.postMessage({ type: 'result', requestId: message.requestId, ids: matches });
  }
};
