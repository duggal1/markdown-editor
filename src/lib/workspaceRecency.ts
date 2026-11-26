/** Local navigation metadata; selecting/typing must not promote the current page. */
export function touchRecent(ids: string[], id: string): string[] {
  return ids[0] === id ? ids : [id, ...ids.filter(item => item !== id)];
}
export function finishVisit(ids: string[], previous: string, next: string, previousExists: boolean): string[] {
  return previous && previous !== next && previousExists ? touchRecent(ids, previous) : ids;
}
type Rankable = { id: string; updatedAt: number; createdAt?: number };
export function restoreRecent(ids: unknown, documents: readonly Rankable[]): string[] {
  const existing = new Set(documents.map(doc => doc.id));
  const valid = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && existing.has(id)) : [];
  const unique = [...new Set(valid)];
  const seen = new Set(unique);
  // Freeze the initial order for older documents without navigation history.
  return [...unique, ...[...documents].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .filter(doc => !seen.has(doc.id)).map(doc => doc.id)];
}
/** Navigation history is for Previous page only, never sidebar placement. */
export function sortWorkspaceDocuments<T extends Rankable>(documents: readonly T[]): T[] {
  return [...documents].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id));
}
