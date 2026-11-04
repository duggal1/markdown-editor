import { detectRawCode } from './code';

export type MarkdownFormatOptions = { atDocumentStart?: boolean };

/**
 * Small deterministic formatting pass for plain text. No network, inference or
 * destructive rewrite of existing Markdown, code, tables or indented blocks.
 * It is intentionally conservative: headings are inferred only from short
 * standalone label-like lines, not from normal sentences.
 */
export function formatPlainTextAsMarkdown(
  source: string,
  options: MarkdownFormatOptions = {},
): string {
  if (!source.trim() || source.length > 180_000) return source;
  if (detectRawCode(source)) return source;

  const normalized = source.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  const lines = normalized.split('\n');
  const output: string[] = [];
  const meaningful = lines.map(value => value.trim()).filter(Boolean);
  if (!meaningful.length) return source;

  // Existing Markdown and fenced code are already structured. Only reduce
  // redundant exterior blank lines; leave the content of fences unchanged.
  const alreadyMarkdown = lines.some(line =>
    /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+|`{3,}|~{3,}|\|\s*:?[-]+)/.test(line),
  );
  let inFence = false;
  const compact = (line: string) => line.replace(/[ \t]+$/g, '');
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const fence = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      inFence = !inFence;
      output.push(raw);
      continue;
    }
    if (inFence) { output.push(raw); continue; }
    if (!trimmed) {
      if (output.length && output[output.length - 1] !== '') output.push('');
      continue;
    }
    if (alreadyMarkdown || /^ {4}|^\t/.test(raw)) {
      output.push(compact(raw));
      continue;
    }

    let text = trimmed.replace(/[ \t]{2,}/g, ' ');
    // Plain-text bullet marks and common numbered-list notation.
    if (/^[•◦▪]\s*/.test(text)) {
      output.push('- ' + text.replace(/^[•◦▪]\s*/, ''));
      continue;
    }
    if (/^\d+[)]\s+/.test(text)) {
      output.push(text.replace(/^(\d+)[)]\s+/, '$1. '));
      continue;
    }
    if (/^(?:[-–—])\s+\S/.test(text)) {
      output.push('- ' + text.replace(/^(?:[-–—])\s+/, ''));
      continue;
    }

    const next = lines.slice(index + 1).find(value => value.trim())?.trim() || '';
    const previousWasBlank = index === 0 || !lines[index - 1].trim();
    const short = text.length <= 66 && text.split(/\s+/).length <= 10;
    const notSentence = !/[.!?;:,]$/.test(text);
    const label = short && notSentence && !/^(?:https?:\/\/|\d+|\w+\s*=)/.test(text) &&
      !/[{}<>]/.test(text) && Boolean(next);
    const first = output.every(line => !line.trim());
    const suitableFirst = first && label && text.split(/\s+/).length >= 2;
    const section = !first && label && previousWasBlank &&
      (index + 1 < lines.length && lines[index + 1].trim().length > 0);
    if (suitableFirst || section) {
      if (output.length && output[output.length - 1] !== '') output.push('');
      text = (suitableFirst && options.atDocumentStart !== false ? '# ' : '## ') + text;
      output.push(text);
      output.push('');
      continue;
    }
    output.push(text);
  }

  // Keep one blank line between paragraphs, remove leading/trailing gaps.
  while (output[0] === '') output.shift();
  while (output[output.length - 1] === '') output.pop();
  return output.join('\n');
}

/** Used by paste handling to avoid reformatting a single ordinary line. */
export function shouldAutoFormatPaste(value: string): boolean {
  return value.length < 180_000 && value.includes('\n') &&
    value.trim().length > 0 && !detectRawCode(value);
}
