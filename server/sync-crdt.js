import * as Y from 'yjs';

// A single authoritative seed is encoded and distributed to every replica.
// Never initialize the same legacy text independently on each device.
export function seedDocument(markdown) {
  const doc = new Y.Doc();
  try { if (markdown) doc.getText('markdown').insert(0, markdown); return Y.encodeStateAsUpdate(doc); }
  finally { doc.destroy(); }
}
export function mergeDocument(state, updates, vector) {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    for (const update of updates) Y.applyUpdate(doc, update);
    const markdown = doc.getText('markdown').toString();
    if (Buffer.byteLength(markdown) > 10 * 1024 * 1024) throw Error('Document exceeds collaboration limit');
    const pending = doc.store.pendingStructs || doc.store.pendingDs;
    // A full state snapshot cannot safely discard unresolved dependencies.
    // Clients must retry using a complete state-vector delta.
    if (pending) throw Error('Update depends on missing history');
    return { state: Y.encodeStateAsUpdate(doc), delta: Y.encodeStateAsUpdate(doc, vector),
      vector: Y.encodeStateVector(doc), markdown };
  } finally { doc.destroy(); }
}
