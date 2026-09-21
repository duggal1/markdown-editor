/**
 * Split enormous Markdown at blank paragraph boundaries outside fenced code.
 * Source bytes are preserved; normal documents still render as one tree.
 */
export function previewChunks(markdown: string, target = 7200): string[] {
  if (markdown.length <= 18000) return [markdown];
  const output: string[] = [];
  let start = 0;
  let position = 0;
  let fence: { char: string; length: number } | null = null;
  let inHtmlBlock = false;
  while (position < markdown.length) {
    const end = markdown.indexOf('\n', position);
    const lineEnd = end < 0 ? markdown.length : end;
    const line = markdown.slice(position, lineEnd);
    const trimmed = line.trim();
    const match = /^( {0,3})(\x60{3,}|~{3,})/.exec(line);
    if (match) {
      const char = match[2][0];
      if (!fence) fence = { char, length: match[2].length };
      else if (fence.char === char && match[2].length >= fence.length &&
        !trimmed.slice(match[0].length).trim()) fence = null;
    }
    if (!fence && /^<(?:div|table|details|section|article|pre|script|style)(?:\s|>)/i.test(trimmed)) inHtmlBlock = true;
    if (inHtmlBlock && /^<\/(?:div|table|details|section|article|pre|script|style)>/i.test(trimmed)) inHtmlBlock = false;
    const blank = !trimmed;
    const nextStart = end < 0 ? markdown.length : end + 1;
    if (!fence && !inHtmlBlock && blank &&
      nextStart - start >= target && nextStart < markdown.length) {
      output.push(markdown.slice(start, nextStart));
      start = nextStart;
    }
    position = nextStart;
  }
  if (start < markdown.length) output.push(markdown.slice(start));
  return output.length ? output : [markdown];
}
