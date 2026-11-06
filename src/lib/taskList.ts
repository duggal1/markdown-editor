/**
 * Set a GFM checkbox on a known Markdown source line without rewriting its
 * label, indentation, line endings or surrounding content.
 */
export type TaskMarkerEdit = { from: number; to: number; insert: ' ' | 'x' };
const MARKER = /^([ \t]*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+)\[([ xX])\](?=[ \t]|$)/;

export function taskMarkerEdit(line: string, checked: boolean): TaskMarkerEdit | null {
  const match = MARKER.exec(line);
  if (!match || (match[2] !== ' ') === checked) return null;
  const from = match[1].length + 1;
  return { from, to: from + 1, insert: checked ? 'x' : ' ' };
}

export function setTaskChecked(markdown: string, lineNumber: number, checked: boolean): string {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return markdown;
  let start = 0;
  for (let line = 1; line < lineNumber; line++) {
    const newline = markdown.indexOf('\n', start);
    if (newline < 0) return markdown;
    start = newline + 1;
  }
  const newline = markdown.indexOf('\n', start);
  const end = newline < 0 ? markdown.length : newline;
  const edit = taskMarkerEdit(markdown.slice(start, end), checked);
  if (!edit) return markdown;
  return markdown.slice(0, start + edit.from) + edit.insert +
    markdown.slice(start + edit.to);
}
