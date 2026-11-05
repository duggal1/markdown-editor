import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { buildPdfDefinitionFromTree, parsePdfMarkdown, pdfImageUrlsFromTree, type PdfImageAssets } from './pdfDocument';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
let rendererReady = false;
let enginePromise: ReturnType<typeof loadPdfEngine> | null = null;

/**
 * On-demand only. The ~MB-sized PDF engine and embedded typeface are NOT
 * included in the editor's initial bundle or its scrolling/rendering path.
 * All generation happens locally in the browser; no upload of page content.
 */
async function loadPdfEngine() {
  const [module, vfsModule] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  const pdfMake = module.default;
  if (!rendererReady) {
    (pdfMake as typeof pdfMake & { addVirtualFileSystem: (files: unknown) => void })
      .addVirtualFileSystem(vfsModule.default);
    rendererReady = true;
  }
  return pdfMake;
}
function pdfEngine() {
  if (!enginePromise) enginePromise = loadPdfEngine().catch(error => {
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

function imageData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const file = new FileReader();
    file.onload = () => resolve(String(file.result || ''));
    file.onerror = () => reject(new Error('Image could not be read.'));
    file.readAsDataURL(blob);
  });
}

async function loadImage(url: string): Promise<string | undefined> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5500);
    let response: Response;
    try {
      response = await fetch(url, {
        mode: 'cors', credentials: 'omit', signal: controller.signal,
      });
    } finally { clearTimeout(timeout); }
    if (!response.ok || !/^image\/(?:png|jpeg)$/i.test(response.headers.get('content-type')?.split(';')[0] || '')) {
      return undefined;
    }
    const length = Number(response.headers.get('content-length') || '0');
    if (length > MAX_IMAGE_BYTES) return undefined;
    const blob = await response.blob();
    if (blob.size > MAX_IMAGE_BYTES) return undefined;
    return imageData(blob);
  } catch {
    // Remote image may disallow CORS or fail. Preserve its caption/link
    // rather than failing the whole PDF export.
    return undefined;
  }
}

async function prepareImages(urls: string[]): Promise<PdfImageAssets> {
  const images = new Map<string, string>();
  const parallelism = 6; // bounded parallel image fetches
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(parallelism, urls.length) }, async () => {
    while (next < urls.length) {
      const url = urls[next++];
      const result = await loadImage(url);
      if (result) images.set(url, result);
    }
  }));
  return images;
}
function filenameForPdf(title: string): string {
  const base = (title.trim() || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\.+$/, '').slice(0, 80).trim() || 'Untitled';
  return base + '.pdf';
}

export async function downloadStyledPdf(markdown: string, title: string, onProgress?: (message: string) => void): Promise<void> {
  onProgress?.('Preparing PDF…');
  const tree = parsePdfMarkdown(markdown);
  const [pdfMake, images] = await Promise.all([pdfEngine(), prepareImages(pdfImageUrlsFromTree(tree))]);
  onProgress?.('Typesetting PDF…');
  const doc = buildPdfDefinitionFromTree(tree, title, images) as TDocumentDefinitions;
  const blob: Blob = await new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(doc).getBlob(result => {
        if (!result || result.size === 0) reject(new Error('Empty PDF output.'));
        else resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
  if (blob.type !== 'application/pdf') {
    // Browsers can omit the MIME type. Its signature is verified in tests.
    if (blob.size < 8) throw new Error('Invalid PDF output.');
  }
  onProgress?.('Downloading PDF…');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameForPdf(title);
  link.style.display = 'none';
  document.body.appendChild(link);
  try { link.click(); }
  finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
