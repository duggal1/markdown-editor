import type { EditorState, Transaction, TransactionSpec } from '@codemirror/state';
import { bulkInsertionBoundary, finishBulkInsertion, formatPlainTextAsMarkdown, shouldAutoFormatPaste } from './autoMarkdown';
import { WORKER_THRESHOLD } from './autoMarkdownAction';
import { repairLanguage } from './codeRepair';

/** A real CodeMirror transaction filter for user-originated bulk input.
 * Do not reinterpret undo, remote sync, programmatic edits or active composition. */
export function formatBulkTransaction(
  tr: Transaction,
  proseContext: (state: EditorState, from: number, to: number) => boolean,
  fileLanguage?: string | null,
): TransactionSpec | readonly TransactionSpec[] {
  if (!tr.docChanged || !tr.isUserEvent('input') ||
      tr.isUserEvent('input.paste.autoMarkdown') || tr.isUserEvent('input.compose') ||
      tr.isUserEvent('input.type.compose') || tr.isUserEvent('input.format') ||
      tr.startState.selection.ranges.length !== 1) return tr;
  const edits: { fromA: number; toA: number; fromB: number; toB: number; text: string }[] = [];
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    edits.push({ fromA, toA, fromB, toB,
      text: inserted.length >= 80 && inserted.length < WORKER_THRESHOLD ? inserted.toString() : '' });
  });
  if (edits.length !== 1) return tr;
  const edit = edits[0];
  const doc = tr.startState.doc;
  if (!edit.text || !proseContext(tr.startState, edit.fromA, edit.toA) ||
      repairLanguage(edit.text, fileLanguage) || !shouldAutoFormatPaste(edit.text)) return tr;
  const boundary = bulkInsertionBoundary(doc.sliceString(doc.lineAt(edit.fromA).from, edit.fromA),
    doc.sliceString(edit.toA, doc.lineAt(edit.toA).to));
  if (!boundary) return tr;
  const formatted = finishBulkInsertion(edit.text,
    formatPlainTextAsMarkdown(edit.text, { atDocumentStart: edit.fromA === 0 }), boundary);
  if (formatted === edit.text) return tr;
  return [tr, { changes: { from: edit.fromB, to: edit.toB, insert: formatted },
    selection: { anchor: edit.fromB + formatted.length }, sequential: true }];
}
