import { extractTextItems, getDocumentProxy } from 'unpdf';

// Text PDFs are converted locally, away from the editor's render thread.
// PDF text extraction cannot reconstruct every layout and is not OCR.
type Item = { str: string; x: number; y: number; fontSize: number; height: number; width: number };
type Line = { text: string; x: number; y: number; size: number; gap: number };
const MAX_PAGES = 250;
const readable = (value: string) => value.replace(/\s+/g, ' ').trim();

function formatPage(items: Item[]): string {
  const visible = items.filter(item => readable(item.str) && Number.isFinite(item.x) && Number.isFinite(item.y));
  if (!visible.length) return '';
  const sizes = visible.map(item => Math.max(1, item.fontSize || item.height || 10)).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 11;
  const rows: { y: number; parts: Item[] }[] = [];
  for (const item of visible) {
    const row = rows.find(line => Math.abs(line.y - item.y) < Math.min(3, Math.max(1.4, body * 0.22)));
    if (row) row.parts.push(item);
    else rows.push({ y: item.y, parts: [item] });
  }
  rows.sort((a, b) => b.y - a.y);
  const lines: Line[] = rows.map(row => {
    row.parts.sort((a, b) => a.x - b.x);
    let text = '';
    let prev: Item | undefined;
    for (const part of row.parts) {
      const chunk = part.str.replace(/\s+/g, ' ');
      const separated = prev && part.x > prev.x + prev.width + body * 0.15;
      if (separated && text && !text.endsWith(' ') && !chunk.startsWith(' ')) text += ' ';
      text += chunk;
      prev = part;
    }
    return {
      text: readable(text), x: row.parts[0]?.x || 0,
      y: row.y, size: Math.max(...row.parts.map(x => x.fontSize || x.height || body)),
      gap: 0,
    };
  }).filter(line => line.text);
  const output: string[] = [];
  let paragraph = '';
  let previous: Line | undefined;
  const flush = () => { if (paragraph) { output.push(paragraph.trim()); paragraph = ''; } };
  for (const line of lines) {
    const value = line.text;
    const gap = previous ? previous.y - line.y : 0;
    const heading = line.size >= body * 1.36 && value.length < 140 && !/[.!?,;:]$/.test(value);
    const bullet = /^([•●◦▪–-])\s+(.+)/.exec(value);
    const numbered = /^\d{1,3}[.)]\s+/.test(value);
    const sectionBreak = previous && (gap > body * 1.85 || Math.abs(line.x - previous.x) > body * 3.5);
    if (heading) {
      flush();
      output.push((line.size > body * 1.75 ? '# ' : '## ') + value);
    } else if (bullet || numbered) {
      flush();
      output.push(bullet ? '- ' + bullet[2] : value.replace(/^(\d{1,3})\)\s+/, '$1. '));
    } else {
      if (sectionBreak) flush();
      const previousEnds = /[-\u2010-\u2015]$/.test(paragraph);
      if (previousEnds && /^[a-z]/.test(value)) paragraph = paragraph.slice(0, -1) + value;
      else paragraph += (paragraph ? ' ' : '') + value;
    }
    previous = line;
  }
  flush();
  return output.join('\n\n');
}

self.onmessage = async (event: MessageEvent<{ buffer: ArrayBuffer }>) => {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    const bytes = new Uint8Array(event.data.buffer);
    if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
      throw new Error('Not a valid PDF file.');
    }
    pdf = await getDocumentProxy(bytes, { maxImageSize: 16_777_216 });
    if (pdf.numPages > MAX_PAGES) throw new Error('PDF exceeds the 250-page import limit.');
    const { items } = await extractTextItems(pdf);
    const markdown = items.map(page => formatPage(page as Item[])).filter(Boolean).join('\n\n');
    if (!markdown.trim()) throw new Error('This PDF has no selectable text. Scanned PDFs require OCR.');
    self.postMessage({ ok: true, markdown });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'PDF import failed.' });
  } finally {
    await pdf?.destroy().catch(() => undefined);
  }
};
