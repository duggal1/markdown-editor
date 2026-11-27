import type { FlowDocument } from './store';

export type PlannerKind = 'todo' | 'memory';
export type PlannerItem = { text: string; category: string };
export type PlannerRow = PlannerItem & { line: number; done: boolean };
export function plannerId(kind: PlannerKind, workspaceId: string, folderId?: string): string {
  return 'flow-planner-' + kind + '-' + (folderId || workspaceId);
}
export function isScopedPlanner(doc: FlowDocument): boolean {
  return !!doc.plannerKind && doc.id === plannerId(doc.plannerKind, doc.workspaceId, doc.folderId);
}
const lineText = (value: string) => value.replace(/[\r\n\t]+/g, ' ').trim();
const normalized = (value: string) => value.trim().toLocaleLowerCase();
export function plannerRows(markdown: string, kind: PlannerKind): PlannerRow[] {
  const rows: PlannerRow[] = [];
  let category = 'Inbox';
  let fence = '';
  markdown.split('\n').forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
      return;
    }
    if (fence) return;
    const heading = /^#{1,6} +(.+?)\s*$/.exec(line);
    if (heading) { category = heading[1]; return; }
    const match = kind === 'todo' ? /^[-*+] \[([ xX])\] (.+?)\s*$/.exec(line) : /^[-*+] (?!\[[ xX]\] )(.+?)\s*$/.exec(line);
    if (match) rows.push({ line: index + 1, category, text: match[kind === 'todo' ? 2 : 1], done: kind === 'todo' && match[1] !== ' ' });
  });
  return rows;
}
export function appendPlannerItems(markdown: string, kind: PlannerKind, items: readonly PlannerItem[]): string {
  const lines = markdown ? markdown.split('\n') : [];
  const existing = new Set(plannerRows(markdown, kind).map(row => normalized(row.category) + '\u0000' + normalized(row.text)));
  const groups = new Map<string, { category: string; entries: string[] }>();
  for (const item of items) {
    const category = lineText(item.category) || 'Inbox';
    const text = lineText(item.text);
    const key = normalized(category) + '\u0000' + normalized(text);
    if (!text || existing.has(key)) continue;
    existing.add(key);
    const group = groups.get(normalized(category)) || { category, entries: [] };
    group.entries.push((kind === 'todo' ? '- [ ] ' : '- ') + text);
    groups.set(normalized(category), group);
  }
  if (!groups.size) return markdown;
  // Add to a section only if its header is outside a code fence. A new
  // section is safer than accidentally writing inside arbitrary Markdown.
  for (const [key, group] of groups) {
    let section = -1, end = lines.length, fence = '';
    for (let i = 0; i < lines.length; i++) {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
        continue;
      }
      if (fence) continue;
      const heading = /^#{1,6} +(.+?)\s*$/.exec(lines[i]);
      if (!heading) continue;
      if (section >= 0) { end = i; break; }
      if (normalized(heading[1]) === key) section = i;
    }
    if (section >= 0 && !fence) {
      while (end > section + 1 && !lines[end - 1].trim()) end--;
      lines.splice(end, 0, ...group.entries);
    } else {
      if (lines.length && lines[lines.length - 1].trim()) lines.push('');
      if (fence) lines.push(fence, '');
      lines.push('## ' + group.category, '', ...group.entries);
    }
  }
  return lines.join('\n');
}
export function editPlannerRow(markdown: string, kind: PlannerKind, row: PlannerRow, value: string | null): string {
  const current = plannerRows(markdown, kind).find(item => item.line === row.line);
  // An async operation or concurrent edit must not overwrite a different row.
  if (!current || current.text !== row.text || current.category !== row.category || current.done !== row.done) return markdown;
  const text = value === null ? '' : lineText(value);
  if (value !== null && !text) return markdown;
  const lines = markdown.split('\n');
  if (value === null) lines.splice(row.line - 1, 1);
  else lines[row.line - 1] = (kind === 'todo' ? '- [' + (current.done ? 'x' : ' ') + '] ' : '- ') + text;
  return lines.join('\n');
}

/** Retrieve relevant entries from the whole document, not an arbitrary tail.
 * Deterministic lexical ranking avoids a second model call and caps disclosure. */
export function selectPlannerContext(markdown: string, kind: PlannerKind, input: string, limit = 6000): string {
  const tokens = new Set((input.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(word => !['the','and','for','with','this','that','from','have','want','need','make','add'].includes(word)));
  const candidates = plannerRows(markdown, kind).map((row, index) => {
    const words = new Set((row.category + ' ' + row.text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
    let score = 0; for (const token of tokens) if (words.has(token)) score++;
    return { row, index, score };
  }).sort((a, b) => b.score - a.score || b.index - a.index);
  const result: string[] = []; let remaining = limit;
  for (const { row } of candidates) {
    const line = row.category + ': ' + (kind === 'todo' ? (row.done ? '[x] ' : '[ ] ') : '') + row.text;
    if (line.length + 1 > remaining) continue;
    result.push(line); remaining -= line.length + 1;
  }
  return result.join('\n');
}
