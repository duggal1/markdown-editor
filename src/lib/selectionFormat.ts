import type { Text } from '@codemirror/state';

export type SelectionFormat = 'text' | 'h1' | 'h2' | 'h3' | 'h4' | 'bullet' | 'number' | 'todo' | 'quote' | 'bold' | 'italic' | 'link' | 'code';
type Edit = { changes: { from: number; to: number; insert: string }; selection: { anchor: number; head: number } };
const prefixes: Partial<Record<SelectionFormat, string>> = {
  text: '', h1: '# ', h2: '## ', h3: '### ', h4: '#### ', bullet: '- ', number: '1. ', todo: '- [ ] ', quote: '> ',
};
const marker = /^(#{1,6}[ \t]+|[-+*][ \t]+\[[ xX]\][ \t]+|[-+*][ \t]+|\d+[.)][ \t]+|>[ \t]?)/;
const tick = String.fromCharCode(96);

export function selectionEdit(doc: Text, from: number, to: number, kind: SelectionFormat): Edit | null {
  if (from >= to) return null;
  const selected = doc.sliceString(from, to);
  if (!selected.trim()) return null;
  const edit = (start: number, end: number, insert: string, anchor = start, head = start + insert.length): Edit =>
    ({ changes: { from: start, to: end, insert }, selection: { anchor, head } });
  const prefix = prefixes[kind];
  if (prefix !== undefined) {
    const first = doc.lineAt(from);
    const last = doc.lineAt(to - 1);
    const lines = doc.sliceString(first.from, last.to).split('\n');
    const matching = (line: string) => {
      const existing = line.trimStart().match(marker)?.[0] || '';
      return kind === 'number' ? /^\d+[.)]\s/.test(existing)
        : kind === 'todo' ? /^[-+*]\s+\[[ xX]\]\s/.test(existing)
        : kind === 'bullet' ? /^[-+*]\s+$/.test(existing) : existing === prefix;
    };
    const remove = kind === 'text' || lines.filter(line => line.trim()).every(matching);
    let number = 0;
    const result = lines.map(line => {
      if (!line.trim()) return line;
      const indent = line.match(/^[ \t]*/)?.[0] || '';
      const body = line.slice(indent.length).replace(marker, '');
      return indent + (remove ? '' : kind === 'number' ? (++number) + '. ' : prefix) + body;
    }).join('\n');
    return edit(first.from, last.to, result);
  }
  if (kind === 'link') {
    if (selected.includes('\n')) return null;
    const url = 'https://';
    const insert = '[' + selected + '](' + url + ')';
    const anchor = from + selected.length + 3;
    return edit(from, to, insert, anchor, anchor + url.length);
  }
  if (kind === 'code' && selected.includes('\n')) {
    const first = doc.lineAt(from), last = doc.lineAt(to - 1);
    const body = doc.sliceString(first.from, last.to);
    const fence = tick.repeat(Math.max(3, ...Array.from(body.matchAll(/\x60+/g), m => m[0].length + 1)));
    return edit(first.from, last.to, fence + '\n' + body + '\n' + fence,
      first.from + fence.length + 1, first.from + fence.length + 1 + body.length);
  }
  const delim = kind === 'bold' ? '**' : kind === 'italic' ? '*' :
    tick.repeat(Math.max(1, ...Array.from(selected.matchAll(/\x60+/g), m => m[0].length + 1)));
  if (kind !== 'code' && doc.sliceString(Math.max(0, from - delim.length), from) === delim &&
      doc.sliceString(to, Math.min(doc.length, to + delim.length)) === delim &&
      !(kind === 'italic' && (doc.sliceString(Math.max(0, from - 2), from) === '**' ||
        doc.sliceString(to, Math.min(doc.length, to + 2)) === '**'))) {
    return edit(from - delim.length, to + delim.length, selected);
  }
  if (kind === 'code') {
    const padded = selected.startsWith(tick) || selected.endsWith(tick) ? ' ' + selected + ' ' : selected;
    const insert = delim + padded + delim;
    const anchor = from + delim.length + (padded === selected ? 0 : 1);
    return edit(from, to, insert, anchor, anchor + selected.length);
  }
  // Blank lines delimit Markdown paragraphs: never wrap several paragraphs in
  // one emphasis span. Preserve whitespace and every selected character.
  const parts = selected.split(/(\n[ \t]*\n+)/);
  const insert = parts.map(part => {
    if (!part.trim()) return part;
    const leading = part.match(/^\s*/)?.[0] || '';
    const trailing = part.match(/\s*$/)?.[0] || '';
    const body = part.slice(leading.length, part.length - trailing.length);
    return leading + (body.startsWith(delim) && body.endsWith(delim) && body.length > delim.length * 2 &&
      !(kind === 'italic' && body.startsWith('**') && body.endsWith('**'))
      ? body.slice(delim.length, -delim.length) : delim + body + delim) + trailing;
  }).join('');
  // Keep the exact text selected for subsequent commands when possible.
  if (parts.length === 1 && insert === delim + selected + delim)
    return edit(from, to, insert, from + delim.length, from + delim.length + selected.length);
  return edit(from, to, insert);
}
