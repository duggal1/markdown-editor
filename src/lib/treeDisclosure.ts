// Disclosure preferences are independent of document and navigation state.
export const WORKSPACE_ROOT = 'workspace-root';
export const TREE_DISCLOSURE_KEY = 'flow.tree.disclosure.v1';
type TreeStorage = Pick<Storage, 'getItem' | 'setItem'>;
type Page = { id: string; parentId?: string; folderId?: string };

export function readClosedTree(storage?: TreeStorage): Set<string> {
  try {
    const value: unknown = JSON.parse((storage ?? localStorage).getItem(TREE_DISCLOSURE_KEY) || '[]');
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length > 0) : []);
  } catch { return new Set(); }
}
export function writeClosedTree(closed: ReadonlySet<string>, storage?: TreeStorage): void {
  try { (storage ?? localStorage).setItem(TREE_DISCLOSURE_KEY, JSON.stringify([...closed])); }
  catch { /* The in-memory tree remains usable if storage is unavailable. */ }
}
export function toggleTreeNode(closed: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(closed);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
export function expandTreeNodes(closed: Set<string>, ids: Iterable<string>): Set<string> {
  let next = closed;
  for (const id of ids) {
    if (!next.has(id)) continue;
    if (next === closed) next = new Set(closed);
    next.delete(id);
  }
  return next;
}
// Only called on an explicit page selection, not when restoring the editor.
export function pageRevealPath(id: string, pages: ReadonlyMap<string, Page>, folders: ReadonlySet<string>): string[] | undefined {
  const selected = pages.get(id);
  if (!selected) return;
  const seen = new Set([id]);
  const parents: string[] = [];
  let root = selected;
  while (root.parentId) {
    const parent = pages.get(root.parentId);
    if (!parent) break;
    if (seen.has(parent.id)) {
      return [selected.folderId && folders.has(selected.folderId) ? selected.folderId : WORKSPACE_ROOT];
    }
    seen.add(parent.id);
    parents.push(parent.id);
    root = parent;
  }
  parents.push(root.folderId && folders.has(root.folderId) ? root.folderId : WORKSPACE_ROOT);
  return parents;
}
