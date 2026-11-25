import type { FlowDocument } from './store';
export const EMPTY_DRAFT_IDLE_MS = 30_000;
/** Only automatically named, zero-byte editor drafts. Never imported files, assets,
 * whitespace content, explicitly named pages or pages containing children. */
export function isEmptyDraft(doc: FlowDocument): boolean {
  return doc.title === 'Untitled' && doc.titleAuto === true && doc.markdown === '' &&
    !doc.asset && !doc.fileName && !doc.fileType && !doc.language;
}
export function canExpireDraft(doc: FlowDocument, activeId: string, documents: Iterable<FlowDocument>, hasPublicLink: boolean): boolean {
  if (doc.id === activeId || hasPublicLink || !isEmptyDraft(doc)) return false;
  for (const child of documents) if (child.parentId === doc.id) return false;
  return true;
}
export function sameEmptyDraft(current: FlowDocument, expected: FlowDocument): boolean {
  return isEmptyDraft(current) && current.id === expected.id && current.updatedAt === expected.updatedAt &&
    current.createdAt === expected.createdAt && current.workspaceId === expected.workspaceId &&
    current.folderId === expected.folderId && current.parentId === expected.parentId;
}
