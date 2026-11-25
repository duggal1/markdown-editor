/** Local, navigation-only metadata; never changes document content or cloud revisions. */
export function touchRecent(ids: string[], id: string): string[] {
  return ids[0] === id ? ids : [id, ...ids.filter(item => item !== id)];
}
export function restoreRecent(ids: unknown, activeId: string, existing: ReadonlySet<string>): string[] {
  const valid = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && existing.has(id)) : [];
  return touchRecent([...new Set(valid)], activeId);
}
export function rankDocuments<T extends { id: string; updatedAt: number }>(documents: readonly T[], recentIds: readonly string[]): T[] {
  const ranks = new Map(recentIds.map((id, index) => [id, index]));
  return [...documents].sort((a, b) =>
    (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) ||
    b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
