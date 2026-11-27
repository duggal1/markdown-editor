import type { PlannerItem } from './planner';
export type PlannerEvent =
  | { type: 'reasoning' | 'content'; text: string }
  | { type: 'done'; items: PlannerItem[]; effort: string }
  | { type: 'error'; error: string };

export async function consumePlannerStream(response: Response, onEvent: (event: PlannerEvent) => void) {
  if (!response.body) throw Error('No response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', finished = false;
  function consume(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as PlannerEvent;
    if (event.type === 'error') throw Error(event.error);
    if (finished) throw Error('Unexpected data after completion.');
    if (event.type === 'done') {
      if (!Array.isArray(event.items) || !event.items.length || !event.items.every(item => typeof item?.text === 'string' && typeof item.category === 'string')) throw Error('No usable items returned.');
      finished = true;
    } else if ((event.type !== 'reasoning' && event.type !== 'content') || typeof event.text !== 'string') throw Error('Invalid stream event.');
    onEvent(event);
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      }
      if (buffer.length > 200000) throw Error('Response frame too large.');
      if (done) { if (buffer.trim()) consume(buffer); break; }
    }
    if (!finished) throw Error('Generation interrupted. No items were saved.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Display only item text, never raw JSON. Complete strings decode normally;
 * an unfinished string decodes its valid prefix without flashing escape bytes. */
export function streamedItems(source: string): string[] {
  const values: string[] = [];
  const pattern = /"text"\s*:\s*"/g;
  while (pattern.exec(source) !== null) {
    let end = pattern.lastIndex, escaped = false;
    for (; end < source.length; end++) {
      const char = source[end];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') break;
    }
    const raw = source.slice(pattern.lastIndex, end);
    let decoded = '';
    for (let length = raw.length; length >= Math.max(0, raw.length - 6); length--) {
      try { decoded = JSON.parse('"' + raw.slice(0, length) + '"'); break; } catch { /* incomplete escape */ }
    }
    if (decoded) values.push(decoded);
    pattern.lastIndex = end + 1;
  }
  return values;
}
