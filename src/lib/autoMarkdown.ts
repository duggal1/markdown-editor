import { detectRawCode } from './code';

export type MarkdownFormatOptions = { atDocumentStart?: boolean; manual?: boolean };
export const MAX_MANUAL_FORMAT_CHARS = 1_000_000;

type Line = { value: string; type: 'blank' | 'feature' | 'heading' | 'text' | 'protected' };

function featureParts(line: string): { label: string; description: string } | null {
  // Short feature label + meaningful explanation. A dash in prose or a
  // negative number is not a feature.
  const match = /^(.{2,68}?)\s+(?:—|–|-{1,2})\s+(.{10,})$/.exec(line.trim());
  if (!match) return null;
  const label = match[1].trim();
  const description = match[2].trim();
  if (!label || /[.!?;:,]$/.test(label) || /[<>={}]/.test(label)
    || /^(?:[-*+>]\s|\d+[.)]\s)/.test(label) || label.split(/\s+/).length > 10
    || /^https?:\/\//i.test(label) || !/[a-z]/i.test(description)) return null;
  return { label, description };
}

function alreadyStructured(line: string): boolean {
  return /^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+|\|\s*|<|~~~|\x60{3,})/.test(line);
}

function plainSectionTitle(line: string): boolean {
  if (!line || line.length > 66 || line.split(/\s+/).length > 9) return false;
  if (/^(?:[-*+>\d]|https?:|www\.)/i.test(line) || /[.!?;,]$/.test(line)
    || /[:=(){}<>]/.test(line) || alreadyStructured(line)) return false;
  return /[a-z]/i.test(line);
}

/** Fast local, undoable formatting. Never send text to a service. */
export function formatPlainTextAsMarkdown(
  source: string,
  options: MarkdownFormatOptions = {},
): string {
  if (!source.trim() || source.length > (options.manual ? MAX_MANUAL_FORMAT_CHARS : 180_000) || detectRawCode(source)) return source;
  const lines = source.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').split('\n');
  const count = lines.reduce((n, line) => n + (featureParts(line) ? 1 : 0), 0);
  const hasFeatureSeries = count >= 2;
  const result: Line[] = [];
  let fence: '`' | '~' | null = null;
  // One backwards pass replaces repeated scans over the whole document.
  // Long imported plans must remain linear, not quadratic in line count.
  const following: string[] = new Array(lines.length);
  let nextNonblank = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    following[i] = nextNonblank;
    if (lines[i].trim()) nextNonblank = lines[i].trim();
  }
  const firstContentIndex = lines.findIndex(line => Boolean(line.trim()));
  const isFence = (line: string) => /^\s*(`{3,}|~{3,})/.exec(line);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const delimiter = isFence(raw);
    if (delimiter) {
      const token = delimiter[1].charAt(0) as '`' | '~';
      if (!fence) fence = token;
      else if (fence === token) fence = null;
      result.push({ value: raw, type: 'protected' });
      continue;
    }
    if (fence || /^ {4}|^\t/.test(raw)) {
      result.push({ value: raw, type: 'protected' });
      continue;
    }
    if (!trimmed) {
      result.push({ value: '', type: 'blank' });
      continue;
    }
    const next = following[i];
    const feature = hasFeatureSeries && !alreadyStructured(trimmed) ? featureParts(trimmed) : null;
    if (feature) {
      result.push({ value: '- **' + feature.label + '** — ' + feature.description, type: 'feature' });
      continue;
    }
    if (alreadyStructured(trimmed)) {
      result.push({ value: raw.replace(/[ \t]+$/g, ''), type: /^(?:#{1,6})\s/.test(trimmed) ? 'heading' : 'text' });
      continue;
    }

    const preceding = i === firstContentIndex;
    const sectionBeforeFeatures = hasFeatureSeries && plainSectionTitle(trimmed)
      && Boolean(featureParts(next));
    const startTitle = options.atDocumentStart !== false && preceding
      && plainSectionTitle(trimmed) && next.length > 0;
    if (startTitle || sectionBeforeFeatures) {
      result.push({ value: (startTitle ? '# ' : '### ') + trimmed, type: 'heading' });
      continue;
    }
    result.push({ value: trimmed.replace(/[ \t]{2,}/g, ' '), type: 'text' });
  }

  // Remove blank lines between members of a feature list, but keep paragraph
  // separation before and after lists and headings. Do not touch fenced code.
  const output: Line[] = [];
  for (let i = 0; i < result.length; i++) {
    const item = result[i];
    if (item.type === 'blank') {
      if (!output.length || output[output.length - 1].type === 'blank') continue;
      let next = i + 1;
      while (next < result.length && result[next].type === 'blank') next++;
      if (next >= result.length) continue;
      if (output[output.length - 1].type === 'feature' && result[next].type === 'feature') continue;
      output.push(item);
      continue;
    }
    const last = output[output.length - 1];
    if (last && last.type !== 'blank') {
      if (item.type === 'heading' || (item.type === 'feature' && last.type !== 'feature')
        || (last.type === 'feature' && item.type !== 'feature')) {
        output.push({ value: '', type: 'blank' });
      }
    }
    output.push(item);
  }
  while (output.length && output[output.length - 1].type === 'blank') output.pop();
  return output.map(line => line.value).join('\n');
}

/** Single-line typing is never reinterpreted. */
export function shouldAutoFormatPaste(value: string): boolean {
  return value.length < 180_000 && value.includes('\n')
    && value.trim().length > 0 && !detectRawCode(value);
}

/**
 * Explicit toolbar action: format prose and normalize heading spacing.
 * Preserve fenced code, tables, nested lists, and all source content.
 * The text replacement is committed as one undoable CodeMirror transaction.
 */
export function formatMarkdownDocument(
  source: string,
  options: MarkdownFormatOptions = {},
): string {
  const formatted = formatPlainTextAsMarkdown(source, { ...options, manual: true });
  if (formatted === source && (source.length > MAX_MANUAL_FORMAT_CHARS || detectRawCode(source))) {
    return source;
  }
  const lines = formatted.split('\n');
  const output: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (match) {
      const marker = match[1];
      if (!fence) fence = { char: marker[0], length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length &&
        !raw.slice(match[0].length).trim()) fence = null;
      output.push(raw);
      continue;
    }
    const heading = !fence && /^ {0,3}#{1,6}[ \t]+\S/.test(raw);
    if (heading) {
      if (output.length && output[output.length - 1] !== '') output.push('');
      output.push(raw);
      if (lines[i + 1]?.trim()) output.push('');
      continue;
    }
    output.push(raw);
  }
  return output.join('\n');
}
