export type OutlineEntry = { line: number; level: number; title: string };
/** Read only headings outside fenced code. Called on demand, not on scroll. */
export function documentOutline(source: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  let offset = 0, number = 1;
  let fence: { char: string; count: number } | undefined;
  while (offset < source.length) {
    const end = source.indexOf('\n', offset);
    const line = source.slice(offset, end === -1 ? source.length : end).replace(/\r$/, '');
    const marker = /^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], count: marker[1].length };
      else if (fence.char === marker[1][0] && marker[1].length >= fence.count && !marker[2].trim()) fence = undefined;
    } else if (!fence) {
      const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line);
      if (heading) entries.push({ line: number, level: heading[1].length, title: heading[2].trim().slice(0, 180) });
    }
    if (end === -1) break;
    offset = end + 1; number++;
  }
  return entries;
}
