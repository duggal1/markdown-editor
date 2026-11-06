import { detectRawCode } from './code';

export type MarkdownFormatOptions = { atDocumentStart?: boolean; manual?: boolean; selection?: boolean };
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

/** A section label is not necessarily followed by a feature list. */
function likelySectionLabel(line: string): boolean {
  const text = line.replace(/^\d{1,3}\s*[/.)-]\s*/, '').trim();
  if (!plainSectionTitle(text) || text.length > 58) return false;
  if (/^(?:feature|section|chapter|part|phase|step|request)\b/i.test(text)) return true;
  const words = text.split(/\s+/);
  return words.length >= 2 && words.length <= 8
    && words.every(word => /^(?:and|or|of|the|a|an|to|for|in|with|on|vs\.?|&)$/i.test(word)
      || /^[A-Z0-9][\w.+/×-]*$/.test(word));
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
  // Explicit formatting can recognize a single titled feature; pastes stay conservative.
  const count = lines.reduce((n, line) => n + (featureParts(line) ? 1 : 0), 0);
  const hasFeatureSeries = count >= 2 || Boolean(options.manual && lines.some(line => {
    const feature = featureParts(line);
    return feature && likelySectionLabel(feature.label);
  }));
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
    const isolatedSection = Boolean(options.manual && likelySectionLabel(trimmed)
      && (preceding || !lines[i - 1].trim())
      && (i === lines.length - 1 || !lines[i + 1].trim() || Boolean(featureParts(next))));
    if (startTitle || sectionBeforeFeatures || isolatedSection) {
      const level = startTitle ? '# ' :
        /^(?:feature request|section|chapter|part)\b/i.test(trimmed) ? '## ' : '### ';
      result.push({ value: level + trimmed, type: 'heading' });
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
      const separateProse = Boolean(options.manual && last.type === 'text' && item.type === 'text'
        && !alreadyStructured(last.value.trim()) && !alreadyStructured(item.value.trim())
        && last.value.length > 70 && item.value.length > 70
        && /[.!?]["')\]]?$/.test(last.value) && /^[A-Z]/.test(item.value));
      if (item.type === 'heading' || (item.type === 'feature' && last.type !== 'feature')
        || (last.type === 'feature' && item.type !== 'feature') || separateProse) {
        output.push({ value: '', type: 'blank' });
      }
    }
    output.push(item);
  }
  while (output.length && output[output.length - 1].type === 'blank') output.pop();
  return output.map(line => line.value).join('\n');
}

/**
 * Split explicit, dense requirement prose into scannable Markdown without
 * inventing/rephrasing content. Tiny interjections stay with their sentence.
 * Pasted prose is intentionally left alone by this manual-only step.
 */
function requirementBullets(raw: string, selection: boolean): string[] | null {
  const trimmed = raw.trim();
  if (trimmed.length < (selection ? 110 : 155)
    || alreadyStructured(trimmed) || /^\s{4}|^\t/.test(raw)
    || /[`]/.test(trimmed) || /!?\[[^\]]+\]\([^)]+\)/.test(trimmed)
    || !/\b(?:must|should|need|needs|require|requires|include|includes|support|supports|want|feature|capability|ensure|provide)\b/i.test(trimmed)) {
    return null;
  }
  const sentences = trimmed.split(/(?<=[.!?])\s+(?=["'(]?[A-Z])/);
  if (sentences.length < 2) return null;
  const groups: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length < 40 && groups.length) groups[groups.length - 1] += ' ' + sentence;
    else groups.push(sentence);
  }
  if (groups.length < 2 || groups.filter(group => group.length >= 38).length < 2) return null;
  return groups.map(group => '- ' + group);
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
    const bullets = !fence ? requirementBullets(raw, Boolean(options.selection)) : null;
    if (bullets) {
      if (output.length && output[output.length - 1] !== '') output.push('');
      output.push(...bullets);
      if (lines[i + 1]?.trim()) output.push('');
      continue;
    }
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
