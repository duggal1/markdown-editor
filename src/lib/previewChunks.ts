/**
 * Split large Markdown into manageable rendering windows.
 *
 * Preserve source bytes and never split fenced code, HTML blocks or nested
 * list items. Prefer blank paragraphs; when a plan has thousands of adjacent
 * list items or headings without blank lines, split at TOP-LEVEL block
 * boundaries instead of rendering the entire document as one React tree.
 *
 * A continuation marker lets the preview eliminate artificial list margins
 * where a single long list spans multiple virtual windows.
 */
export type PreviewPart = { markdown: string; continuesList: boolean };

export function previewParts(markdown: string, target = 3600): PreviewPart[] {
  if (markdown.length <= 18000) return [{ markdown, continuesList: false }];
  const output: PreviewPart[] = [];
  let start = 0;
  let position = 0;
  let continuesList = false;
  let lastListContext = false;
  let fence: { char: string; length: number } | null = null;
  let inHtmlBlock = false;

  function flush(end: number, nextList: boolean) {
    if (end > start) {
      output.push({ markdown: markdown.slice(start, end), continuesList });
      start = end;
      continuesList = nextList;
    }
  }

  while (position < markdown.length) {
    const end = markdown.indexOf('\n', position);
    const lineEnd = end < 0 ? markdown.length : end;
    const line = markdown.slice(position, lineEnd);
    const trimmed = line.trim();
    const match = /^( {0,3})(`{3,}|~{3,})/.exec(line);
    const listItem = /^(?:[-+*]\s+|\d+[.)]\s+)/.test(line);
    const heading = /^ {0,3}#{1,6}[ \t]+\S/.test(line);
    const newFence = Boolean(match && !fence && match[1].length === 0);
    const canBreakBefore = !fence && !inHtmlBlock &&
      position - start >= target && (heading || listItem || newFence);

    // ReactMarkdown handles each window as its own tree; these are complete
    // block boundaries, not arbitrary N-character substring cuts.
    if (canBreakBefore) flush(position, listItem && lastListContext);

    if (match) {
      const char = match[2][0];
      if (!fence) fence = { char, length: match[2].length };
      else if (fence.char === char && match[2].length >= fence.length &&
        !trimmed.slice(match[0].length).trim()) fence = null;
    }
    if (!fence && /^<(?:div|table|details|section|article|pre|script|style)(?:\s|>)/i.test(trimmed)) inHtmlBlock = true;
    if (inHtmlBlock && /^<\/(?:div|table|details|section|article|pre|script|style)>/i.test(trimmed)) inHtmlBlock = false;

    const nextStart = end < 0 ? markdown.length : end + 1;
    // A blank line can belong to the same list item when followed by an
    // indented paragraph/sublist. Keep that block intact.
    const followingEnd = markdown.indexOf('\n', nextStart);
    const followingLine = markdown.slice(nextStart, followingEnd < 0 ? markdown.length : followingEnd);
    const continuesNestedList = !trimmed && lastListContext &&
      /^(?: {2,}|\t)\S/.test(followingLine);
    if (!fence && !inHtmlBlock && !trimmed && !continuesNestedList &&
      nextStart - start >= target && nextStart < markdown.length) {
      flush(nextStart, false);
    }

    // Keep indented continuation lines within their parent list. Blank lines
    // between separate list blocks terminate the continuation context.
    if ((!trimmed && !continuesNestedList) || heading || match) lastListContext = false;
    else if (listItem) lastListContext = true;
    else if (!/^(?: {2,}|\t)/.test(line)) lastListContext = false;

    position = nextStart;
  }
  flush(markdown.length, false);
  return output.length ? output : [{ markdown, continuesList: false }];
}

/** Compatibility API used by callers that only need source slices. */
export function previewChunks(markdown: string, target = 3600): string[] {
  return previewParts(markdown, target).map(part => part.markdown);
}
