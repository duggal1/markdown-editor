import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import pdfMakeScriptUrl from 'pdfmake/build/pdfmake.js?url';
import pdfFontsScriptUrl from 'pdfmake/build/vfs_fonts.js?url';
import { buildPdfDefinitionFromTree, parsePdfMarkdown, pdfImageUrlsFromTree, type PdfImageAssets, type PdfDensity } from './pdfDocument';
import { optimizePdfPagination } from './pdfPagination';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

type BrowserPdfMake = {
  addVirtualFileSystem?: (fonts: Record<string, string>) => void;
  createPdf: (definition: TDocumentDefinitions) => {
    getBlob: (callback: (blob: Blob) => void) => unknown;
  };
};
let enginePromise: Promise<BrowserPdfMake> | null = null;

/**
 * Keep PDFMake's UMD builds intact. When Vite rewrites these CommonJS bundles
 * into ESM chunks, the font VFS and parts of the PDF layout engine can break
 * in production despite passing the Node PDF test. ?url emits same-origin,
 * versioned assets without executing or transforming their source.
 * These scripts load only after Export as PDF is selected.
 */
function loadClassicScript(src: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    let settled = false;
    const timeout = window.setTimeout(
      () => finish(new Error(`${name} took too long to load.`)), 45000,
    );
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      script.remove();
      if (error) reject(error);
      else resolve();
    }
    script.onload = () => finish();
    script.onerror = () => finish(new Error(`${name} could not be loaded.`));
    document.head.appendChild(script);
  });
}

async function loadPdfEngine(): Promise<BrowserPdfMake> {
  // The font script registers its VFS against window.pdfMake.
  // Loading in sequence is essential; parallel scripts can race.
  await loadClassicScript(pdfMakeScriptUrl, 'PDF engine');
  await loadClassicScript(pdfFontsScriptUrl, 'PDF fonts');
  const pdfMake = (window as Window & { pdfMake?: BrowserPdfMake }).pdfMake;
  if (typeof pdfMake?.createPdf !== 'function') {
    throw new Error('PDF engine failed to initialize.');
  }
  // PDFMake 0.2 registers vfs_fonts.js through addVirtualFileSystem.
  // Its VFS is private; absence of a public .vfs is not a font failure.
  // The real document generation below validates the registered fonts.
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
  const render = (density: PdfDensity): Promise<Blob> => {
    const doc = buildPdfDefinitionFromTree(tree, title, images, density);
    return new Promise<Blob>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('PDF generation timed out. Try exporting a smaller page.')), 120000);
    const fail = (error: unknown) => { clearTimeout(timeout); reject(error); };
    try {
      const pending = pdfMake.createPdf(doc).getBlob(result => {
        clearTimeout(timeout);
        if (!result || result.size === 0) reject(new Error('Empty PDF output.'));
        else resolve(result);
      });
      // pdfmake versions that return a Promise may reject asynchronously.
      if (pending && typeof (pending as Promise<unknown>).then === 'function') {
        void (pending as Promise<unknown>).catch(fail);
      }
    } catch (error) {
      fail(error);
    }
    });
  };
  const blob = await optimizePdfPagination(render, () => onProgress?.('Optimizing page layout…'));
  // A non-empty Blob is not necessarily a PDF, particularly after a failed
  // renderer initialization. Check the actual file header before downloading.
  if (await blob.slice(0, 5).text() !== '%PDF-') {
    throw new Error('PDF renderer produced an invalid file.');
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
