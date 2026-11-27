import { detectRawCode, normalizeMixedContent } from './code';

export type MarkdownFormatOptions = { atDocumentStart?: boolean; manual?: boolean; selection?: boolean };
export const MAX_MANUAL_FORMAT_CHARS = 1_000_000;
const MAX_CHARS = MAX_MANUAL_FORMAT_CHARS;
type Kind = 'blank' | 'protected' | 'heading' | 'list' | 'prose';
type Block = { kind: Kind; text: string; generated?: boolean };

const fenceMarker = /^ {0,3}(\x60{3,}|~{3,})(.*)$/;
const headingMarker = /^ {0,3}#{1,6}\s+\S/;
const listMarker = /^ {0,3}(?:[-+*]\s+|\d{1,9}[.)]\s+)\S/;
const markup = /^(?: {0,3}(?:#{1,6}\s|[-+*]\s|\d{1,9}[.)]\s|>|<|\||\[[^\]]+\]:|(?:-{3,}|\*{3,}|_{3,})\s*$)| {4}|\t)/;
const inlineMarkup = /[\x60]|\[[^\]]+\]\(|\*\*|__|\\[\\*#_]|<[^>]+>|\s{2}$/;
const requirement = /^(?:["'(]?\s*)(?:so\s+)?(?:we (?:also )?(?:need|must|should|want|have to|can|will)|(?:i|you) (?:also )?(?:need|want|must|should|have to)|(?:it|this|that|they|the .{1,45}?) (?:must|should|needs? to|has to)|(?:make sure|ensure|add|remove|keep|fix|build|implement|preserve|support|include|avoid|do not|don't|use|replace|reduce|improve|create|test|enable|disable)\b)/i;
const sequence = /^(?:first(?:ly| of all)?|second(?:ly)?|third(?:ly)?|fourth(?:ly)?|fifth(?:ly)?|finally|lastly|next)(?:[,:]\s*|\s+)/i;

function feature(line: string): { label: string; description: string } | null {
  const match = /^(.{2,68}?)\s+(?:—|–|-{1,2})\s+(.{10,})$/.exec(line.trim());
  if (!match) return null;
  const label = match[1];
  if (markup.test(label) || /[.!?;:,]$|[<>={}]/.test(label) || label.split(/\s+/).length > 10 || /^https?:\/\//i.test(label)) return null;
  return { label, description: match[2] };
}

function shortTitle(line: string): boolean {
  return !!line && line.length <= 72 && line.split(/\s+/).length <= 10 &&
    !markup.test(line) && !/[.!?;,=:(){}<>]/.test(line) && /[a-z]/i.test(line) &&
    !/^(?:https?:|www\.|(?:i|we|you|it|this|that|they|there)\b)/i.test(line);
}

function sectionTitle(line: string): boolean {
  const label = line.replace(/^\d{1,3}\s*[/.)-]\s*/, '').trim();
  if (!shortTitle(label)) return false;
  if (/^(?:feature|section|chapter|part|phase|step|request)\b/i.test(label)) return true;
  const words = label.split(/\s+/);
  return words.length >= 2 && words.every(word => /^(?:and|or|of|the|a|an|to|for|in|with|on|vs\.?|&)$/i.test(word) || /^[A-Z0-9][\w.+/×-]*$/.test(word));
}

/** Sentence boundaries are conservative: do not split versions, initials, abbreviations or URLs. */
function sentences(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (const match of value.matchAll(/[.!?]["')\]]*\s+(?=["'(]?[A-Z])/g)) {
    const end = match.index! + match[0].trimEnd().length;
    const tail = value.slice(Math.max(start, end - 12), end);
    if (/(?:\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|No|Fig|St|Inc|Ltd)|\b[A-Z])\.$/i.test(tail) &&
        (/\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|No|Fig|St|Inc|Ltd)\.$/i.test(tail) || /\b[A-Z]\.$/.test(tail))) continue;
    parts.push(value.slice(start, end));
    start = match.index! + match[0].length;
  }
  parts.push(value.slice(start));
  return parts;
}

/** Inline enumeration requires a list introduction and at least two consecutive items. */
function inlineList(value: string): string | null {
  const matches = [...value.matchAll(/(?:^|\s)(\d{1,2})[.)]\s+(?=\S)/g)];
  if (matches.length < 2 || matches[0][1] !== '1' ||
      matches.some((m, i) => Number(m[1]) !== i + 1)) return null;
  const start = matches[0].index!;
  const intro = value.slice(0, start).trimEnd();
  if (intro && !/[:?]$|\b(?:following|things|steps|reasons|features|requirements|points)\b/i.test(intro)) return null;
  const items = matches.map((m, i) => value.slice(m.index! + m[0].length, matches[i + 1]?.index ?? value.length).trim());
  if (items.some(item => !item || /^\d/.test(item))) return null;
  return (intro ? intro + '\n\n' : '') + items.map((item, i) => (i + 1) + '. ' + item).join('\n');
}

/** Keep every sentence and its original order. Only infer a list from independent requirements. */
function structureProse(value: string): string {
  if (inlineMarkup.test(value) || /https?:\/\//i.test(value)) return value;
  const explicit = inlineList(value);
  if (explicit) return explicit;
  if (value.length < 80) return value;
  const units = sentences(value);
  if (units.length < 2) return value;
  const groups: string[] = [];
  let lead = '';
  let last = '';
  const flush = () => { if (last) groups.push(last); last = ''; };
  for (const unit of units) {
    const action = requirement.test(unit) || sequence.test(unit);
    if (action && unit.length >= 28) {
      flush(); last = unit;
    } else if (last) last += ' ' + unit;
    else lead += (lead ? ' ' : '') + unit;
  }
  flush();
  const ordered = groups.length >= 2 && groups.every(g => sequence.test(g)) && /^(?:first|firstly)\b/i.test(groups[0]);
  if (groups.length >= 2 && groups.every(g => g.length >= 35)) {
    return (lead ? lead + '\n\n' : '') + groups.map((g, i) => (ordered ? (i + 1) + '. ' : '- ') + g).join('\n');
  }
  // Long unstructured speech gets breathing room, not a bullet per sentence.
  if (value.length < 420 || units.length < 4) return value;
  const paragraphs: string[] = [];
  let paragraph = '';
  for (const unit of units) {
    if (paragraph.length >= 180 && paragraph.length + unit.length > 360) {
      paragraphs.push(paragraph); paragraph = '';
    }
    paragraph += (paragraph ? ' ' : '') + unit;
  }
  if (paragraph) paragraphs.push(paragraph);
  return paragraphs.join('\n\n');
}

export function shouldAutoFormatPaste(value: string): boolean {
  return value.length <= MAX_CHARS && (value.includes('\n') || value.length >= 110) &&
    !!value.trim() && !detectRawCode(value);
}

/** One bounded local block pipeline, shared by paste, dictation, imports and worker. */
export function formatPlainTextAsMarkdown(source: string, options: MarkdownFormatOptions = {}): string {
  if (!source.trim() || source.length > MAX_CHARS || detectRawCode(source)) return source;
  // Preserve authored HTML and frontmatter as whole documents rather than guessing their boundaries.
  if (/^\s*---\s*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.test(source) ||
      /(?:^|\n)\s*<(?:[a-z][\w:-]*(?:\s|>|\/)|!--|\?xml)/i.test(source)) return source;
  const normalized = normalizeMixedContent(source);
  const recovered = normalized !== source;
  const lines = normalized.split(/\r\n|\r|\n/);
  const blocks: Block[] = [];
  let fence: { char: string; width: number } | null = null;
  let insideList = false;
  let insideQuote = false;
  let featureCount = 0;
  // Classify first, including protected islands. Their contents never influence prose inference.
  for (const raw of lines) {
    const marker = fenceMarker.exec(raw);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], width: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.width && !marker[2].trim()) fence = null;
      blocks.push({ kind: 'protected', text: raw }); continue;
    }
    if (fence) { blocks.push({ kind: 'protected', text: raw }); continue; }
    if (!raw.trim()) { blocks.push({ kind: 'blank', text: raw }); insideQuote = false; continue; }
    if (headingMarker.test(raw)) {
      insideList = false; insideQuote = false; blocks.push({ kind: 'heading', text: raw }); continue;
    }
    if (listMarker.test(raw)) { insideList = true; insideQuote = false; blocks.push({ kind: 'list', text: raw }); continue; }
    if (/^ {0,3}>/.test(raw)) insideQuote = true;
    if (markup.test(raw) || insideQuote || (insideList && (/^\s/.test(raw) || blocks.at(-1)?.kind !== 'blank')) ||
        /^(?:=+|-{2,})\s*$/.test(raw) || /^(?:=+|-{2,})\s*$/.test(lines[blocks.length + 1] || '') ||
        raw.includes('|') || inlineMarkup.test(raw)) {
      blocks.push({ kind: 'protected', text: raw }); continue;
    }
    insideList = false;
    if (feature(raw)) featureCount++;
    blocks.push({ kind: 'prose', text: raw });
  }
  const next: (Block | undefined)[] = new Array(blocks.length);
  let following: Block | undefined;
  for (let i = blocks.length - 1; i >= 0; i--) {
    next[i] = following;
    if (blocks[i].kind !== 'blank') following = blocks[i];
  }
  const first = blocks.findIndex(b => b.kind !== 'blank');
  let previousContent: Block | undefined;
  const output: Block[] = [];
  let level = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const precedingContent = previousContent;
    if (b.kind !== 'blank') previousContent = b;
    if (b.kind !== 'prose') {
      if (b.kind === 'heading') level = b.text.trimStart().match(/^#+/)![0].length;
      output.push(b); continue;
    }
    const value = b.text.trim();
    // Common copy/paste bullets which are not valid Markdown.
    const bullet = /^(?:[•●▪◦‣]|\(-\))\s*(\S.*)$/.exec(value);
    if (bullet) { output.push({ kind: 'list', text: '- ' + bullet[1], generated: true }); continue; }
    const label = feature(value);
    const after = next[i];
    const before = blocks[i - 1];
    if (label && (featureCount >= 2 || (options.manual && sectionTitle(label.label)))) {
      output.push({ kind: 'list', text: '- **' + label.label + '** — ' + label.description, generated: true }); continue;
    }
    const title = i === first && options.atDocumentStart !== false && !!after && shortTitle(value);
    const featureSection = shortTitle(value) && after?.kind === 'prose' && !!feature(after.text) && featureCount >= 2;
    const isolated = (i === first || before?.kind === 'blank') &&
      (blocks[i + 1]?.kind === 'blank' || !blocks[i + 1] || !!(after && feature(after.text)));
    const section = isolated && sectionTitle(value) && !!after &&
      (options.manual || featureCount > 0 || blocks.length >= 5);
    const recoveredTitle = recovered && shortTitle(value) && !!after &&
      (i === first || before?.kind === 'blank' || (before?.kind === 'prose' && shortTitle(before.text))) &&
      (after.kind !== 'prose' || !shortTitle(after.text.trim()));
    if (title || featureSection || section || recoveredTitle) {
      const depth = title ? 1 : recoveredTitle || /^(?:feature request|section|chapter|part)\b/i.test(value) ? 2 :
        level === 1 ? 2 : 3;
      level = depth;
      output.push({ kind: 'heading', text: '#'.repeat(depth) + ' ' + value, generated: true }); continue;
    }
    // Spoken topic transitions are useful headings when the transcript itself
    // supplies a short, explicit question or signpost. Never invent a summary.
    const firstSentence = value.length >= 140 ? sentences(value)[0] : '';
    const topic = firstSentence.length >= 15 && firstSentence.length <= 95 &&
      ((i === first && options.atDocumentStart !== false && /^(?:what (?:is|are)|how (?:can|do|does|should)|why (?:is|are|do))\b.*\?$/i.test(firstSentence)) ||
       ((i === first || (before?.kind === 'blank' && precedingContent?.kind !== 'heading')) && /^(?:now,\s+what|let me talk about|let's talk about)\b/i.test(firstSentence)));
    if (topic && firstSentence.length < value.length) {
      const depth = i === first && options.atDocumentStart !== false ? 1 : 2;
      level = depth;
      output.push({ kind: 'heading', text: '#'.repeat(depth) + ' ' + firstSentence, generated: true });
      const rest = value.slice(firstSentence.length).trimStart();
      output.push({ kind: 'prose', text: structureProse(rest), generated: true });
      continue;
    }
    const structured = structureProse(value);
    output.push({ kind: 'prose', text: structured === value ? b.text : structured, generated: structured !== value });
  }
  const result: string[] = [];
  let previous: Block | undefined;
  let pending: Block[] = [];
  for (const b of output) {
    if (b.kind === 'blank') { pending.push(b); continue; }
    const generatedPair = previous?.kind === 'list' && b.kind === 'list' && previous.generated && b.generated;
    if (!generatedPair) {
      if (pending.length) { for (const p of pending) result.push(p.text); }
      else if (previous && (
        ((b.kind === 'heading' || previous.kind === 'heading') && (b.generated || previous.generated || options.manual)) ||
        ((b.kind === 'list' || previous.kind === 'list') && (b.generated || previous.generated)) ||
        (previous.kind === 'prose' && b.kind === 'prose' && previous.text.length > 70 && b.text.length > 70 &&
          /[.!?]["')\]]?$/.test(previous.text) && /^[A-Z]/.test(b.text))
      )) result.push('');
    }
    pending = [];
    result.push(b.text); previous = b;
  }
  for (const p of pending) result.push(p.text);
  const formatted = result.join('\n');
  return formatted === lines.join('\n') && !recovered ? source : formatted;
}

/** Compatibility for worker and existing callers; no second formatting engine. */
export function formatMarkdownDocument(source: string, options: MarkdownFormatOptions = {}): string {
  return formatPlainTextAsMarkdown(source, { ...options, manual: options.manual ?? true });
}
