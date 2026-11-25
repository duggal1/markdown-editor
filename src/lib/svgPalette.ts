import { normalizeHex } from './hexColor';

type ColorRange = { from: number; to: number; value: string };
export type SvgColor = { hex: string; count: number; ranges: ColorRange[] };
const paint = /^(?:fill|stroke|color|stop-color|flood-color|lighting-color|solid-color|background-color|outline-color|border-color|--[\w-]+)$/i;
let context: CanvasRenderingContext2D | null | undefined;
function browserColor(value: string): string | null {
  if (!globalThis.CSS?.supports('color', value)) return null;
  if (/^(?:none|transparent|currentcolor|inherit|initial|unset|revert(?:-layer)?|var\(|url\(|context-fill|context-stroke)/i.test(value)) return null;
  context ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.canvas.width = 1; context.canvas.height = 1;
  context.fillStyle = '#000';
  context.fillStyle = value;
  const direct = normalizeHex(context.fillStyle);
  if (direct) return direct;
  context.fillRect(0, 0, 1, 1);
  const [r,g,b,alpha] = context.getImageData(0, 0, 1, 1).data;
  return '#' + [r,g,b,...(alpha === 255 ? [] : [alpha])].map(n => n.toString(16).padStart(2, '0')).join('');
}

/** Scan authored paint declarations, never selectors, ids, URL fragments or path data. */
export function svgPalette(source: string, resolve = browserColor): SvgColor[] {
  const colors = new Map<string, SvgColor>();
  const add = (value: string, offset: number) => {
    const trimmed = value.trim().replace(/\s*!important\s*$/i, '').trimEnd();
    if (!trimmed || /^(?:none|transparent|currentcolor|inherit|initial|unset|revert(?:-layer)?|var\(|url\(|context-fill|context-stroke)/i.test(trimmed)) return;
    const hex = normalizeHex(trimmed) || resolve(trimmed);
    if (!hex) return;
    const from = offset + value.indexOf(trimmed);
    const range = { from, to: from + trimmed.length, value: trimmed };
    const existing = colors.get(hex);
    if (existing) { existing.ranges.push(range); existing.count++; }
    else colors.set(hex, { hex, count: 1, ranges: [range] });
  };
  const declarations = (value: string, offset: number) => {
    // Mask comments and quoted strings without shifting source offsets.
    const masked = value.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, m => ' '.repeat(m.length));
    const pattern = /(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]+)/g;
    for (const match of masked.matchAll(pattern)) {
      if (!paint.test(match[1])) continue;
      const start = match.index! + match[0].length - match[2].length;
      add(value.slice(start, start + match[2].length), offset + start);
    }
  };
  // Skip comments, CDATA and scripts; style blocks are inspected as CSS, not XML.
  const tags = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/style\s*>|<!\[CDATA\[[\s\S]*?\]\]>|<[A-Za-z][\w:-]*(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  for (const match of source.matchAll(tags)) {
    const tag = match[0], base = match.index!;
    if (match[1] !== undefined) {
      const start = tag.indexOf('>') + 1;
      const content = match[1].replace(/<!\[CDATA\[|\]\]>/g, m => ' '.repeat(m.length));
      declarations(content, base + start);
      continue;
    }
    if (/^<!|^<script\b/i.test(tag)) continue;
    const attrs = /\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (const attr of tag.matchAll(attrs)) {
      const value = attr[2] ?? attr[3];
      const start = base + attr.index! + attr[0].length - value.length - 1;
      if (attr[1].toLowerCase() === 'style') declarations(value, start);
      else if (paint.test(attr[1])) add(value, start);
    }
  }
  return Array.from(colors.values());
}

/** Patch only verified paint literals, preserving every unrelated source byte. */
export function replaceSvgColor(source: string, color: SvgColor, replacement: string): string {
  const hex = normalizeHex(replacement);
  if (!hex || color.hex === hex || !color.ranges.length) return source;
  const ranges = [...color.ranges].sort((a,b) => a.from - b.from);
  if (ranges.some((r,i) => source.slice(r.from,r.to) !== r.value || (i > 0 && ranges[i-1].to > r.from))) return source;
  const pieces: string[] = [];
  let cursor = 0;
  for (const range of ranges) { pieces.push(source.slice(cursor, range.from), hex); cursor = range.to; }
  pieces.push(source.slice(cursor));
  return pieces.join('');
}

/** Exact block matching protects edits against a stale virtual preview. */
export function locateSvgSource(document: string, source: string, line: number): number {
  if (document === source) return 0;
  if (!source || line < 1) return -1;
  let start = 0;
  for (let n = 1; n < line; n++) { const end = document.indexOf('\n', start); if (end < 0) return -1; start = end + 1; }
  const end = document.indexOf('\n', start);
  const after = end < 0 ? document.length : end + 1;
  // Inline SVG begins on the reported line; a fenced block starts one line later.
  for (const candidate of [start, after]) {
    const whitespace = /^[ \t]*/.exec(document.slice(candidate))?.[0].length ?? 0;
    for (const at of [candidate, candidate + whitespace]) {
      if (document.slice(at, at + source.length) === source && /^(?:[ \t]*(?:\r?\n|$))/.test(document.slice(at + source.length))) return at;
    }
  }
  return -1;
}
