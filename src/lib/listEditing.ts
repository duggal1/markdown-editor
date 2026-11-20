/**
 * List input is explicit: pressing Enter never invents the next Markdown
 * marker. A blank item exits the list, so tables and fences can start cleanly.
 * Kept pure for deterministic tests; CodeMirror owns the actual transaction.
 */
export type ListEnterIntent = 'plain-newline' | 'exit-list' | null;

export function listEnterIntent(line: string, cursorColumn: number): ListEnterIntent {
  // Bullets, numbered items, and nested items, but not "---" thematic
  // breaks, "-word" prose, or arbitrary code with no Markdown marker.
  const marker = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/.exec(line);
  if (!marker || cursorColumn < marker[0].length) return null;

  const remainder = line.slice(marker[0].length);
  // Treat unchecked/checked task markers with no description as empty, too.
  if (!remainder.trim() || /^\[[ xX]\][ \t]*$/.test(remainder)) return 'exit-list';
  return 'plain-newline';
}
