import { PDF_PAGE_MARGINS, type PdfDensity } from './pdfDocument';

export type PdfTail = { pages: number; lines: number; sparse: boolean };

/** Inspect the actual rendered PDF, not a character-count estimate.
 * Running title and page numbers fall outside the body margins. PDF text
 * positions use bottom-left coordinates. Group syntax spans on one baseline.
 */
export async function inspectPdfTail(blob: Blob, density: PdfDensity): Promise<PdfTail> {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
  try {
    if (pdf.numPages < 2) return { pages: pdf.numPages, lines: 0, sparse: false };
    const page = await pdf.getPage(pdf.numPages);
    const { height } = page.getViewport({ scale: 1 });
    const [,top,,bottom] = PDF_PAGE_MARGINS[density];
    const content = await page.getTextContent();
    const baselines = content.items.flatMap(item => {
      if (!('str' in item) || !item.str.trim()) return [];
      const y = item.transform[5];
      return Number.isFinite(y) && y >= bottom - 1 && y <= height - top + 1 ? [y] : [];
    }).sort((a,b) => b-a);
    const rows: number[] = [];
    for (const y of baselines) if (!rows.length || Math.abs(rows[rows.length-1]-y)>2) rows.push(y);
    const sparse = rows.length > 0 && rows.length <= 3 && height - top - rows[rows.length-1] <= 96;
    return { pages: pdf.numPages, lines: rows.length, sparse };
  } finally { await pdf.destroy(); }
}

/** One optional retry. All content is re-typeset from the original tree.
 * A failed inspection or candidate must not prevent a normal download.
 */
export async function optimizePdfPagination(
  render: (density: PdfDensity) => Promise<Blob>, onRetry?: () => void,
): Promise<Blob> {
  const original = await render('balanced');
  // Avoid loading the parser for enormous exports; balanced spacing still applies.
  if (original.size > 16 * 1024 * 1024) return original;
  try {
    const first = await inspectPdfTail(original, 'balanced');
    if (!first.sparse) return original;
    onRetry?.();
    const candidate = await render('compact');
    if (await candidate.slice(0,5).text() !== '%PDF-') return original;
    const next = await inspectPdfTail(candidate, 'compact');
    return next.pages > 0 && next.pages < first.pages ? candidate : original;
  } catch { return original; }
}
