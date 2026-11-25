/**
 * SVG image mode inside an opaque, script-disabled iframe. No inline active
 * content, network requests or access to the application. Authored CSS,
 * fills, strokes and color declarations are preserved.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
export function adaptSvgForTheme(code: string, _theme: 'light' | 'dark'): string {
  return code;
}
export type SvgBackground = 'auto' | 'white' | 'black' | 'transparent';
export type SvgArtwork = { uri: string; width: number; height: number };
export function svgDimensions(width: string | null, height: string | null, viewBox: string | null): { width: number; height: number } {
  const length = (v: string | null) => {
    const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(px|in|cm|mm|pt|pc)?\s*$/i.exec(v || '');
    if (!m) return 0;
    const units: Record<string, number> = { px: 1, in: 96, cm: 96/2.54, mm: 96/25.4, pt: 96/72, pc: 16 };
    const value = Number(m[1]) * (units[(m[2] || 'px').toLowerCase()] || 1);
    return Number.isFinite(value) ? value : 0;
  };
  const box = (viewBox || '').trim().split(/[\s,]+/).map(Number);
  const ratio = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 ? box[2] / box[3] : 0;
  let w = length(width), h = length(height);
  if (!w && !h) { w = ratio ? box[2] : 300; h = ratio ? box[3] : 150; }
  else if (!w) w = ratio ? h * ratio : 300;
  else if (!h) h = ratio ? w / ratio : 150;
  return { width: Number.isFinite(w) ? Math.max(1, Math.round(w)) : 300, height: Number.isFinite(h) ? Math.max(1, Math.round(h)) : 150 };
}
export function svgArtworks(code: string, theme: 'light' | 'dark'): SvgArtwork[] {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(adaptSvgForTheme(code, theme), 'image/svg+xml');
  const valid = !parsed.querySelector('parsererror') && parsed.documentElement.localName === 'svg' &&
    parsed.documentElement.namespaceURI === SVG_NS;
  const roots: Element[] = valid ? [parsed.documentElement] : [];
  if (!valid) {
    // Reparse fragments with a real SVG namespace (setting xmlns on an
    // already-parsed null-namespace element does not change its namespace).
    const wrapped = parser.parseFromString('<flow-root xmlns="' + SVG_NS + '">' +
      code.replace(/<\?xml[^>]*\?>/gi, '') + '</flow-root>', 'image/svg+xml');
    if (!wrapped.querySelector('parsererror')) {
      const root = wrapped.documentElement;
      const children = Array.from(root.children);
      if (children.every(node => node.localName === 'svg' && node.namespaceURI === SVG_NS) &&
          Array.from(root.childNodes).every(node => node.nodeType !== 3 || !node.textContent?.trim())) {
        roots.push(...children);
      }
    }
  }
  return roots.map(root => {
    // Image documents cannot inherit currentColor from the embedding editor.
    // A presentation attribute supplies a default; explicit color attributes,
    // inline styles and CSS rules inside the SVG remain authoritative.
    if (!root.hasAttribute('color')) root.setAttribute('color', theme === 'dark' ? '#f5f5f5' : '#171717');
    const source = new XMLSerializer().serializeToString(root);
    return { uri: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source).replace(/'/g, '%27'),
      ...svgDimensions(root.getAttribute('width'), root.getAttribute('height'), root.getAttribute('viewBox')) };
  });
}
export function svgPreviewDocument(code: string, theme: 'light' | 'dark', zoom = 100): string {
  const scale = Math.max(.25, Math.min(4, zoom / 100));
  const images = svgArtworks(code, theme).map(art => {
    const ratio = art.width / art.height;
    const width = 'min(' + art.width * scale + 'px, calc((100vw - 24px) * ' + scale + '), calc((100vh - 24px) * ' + ratio * scale + '))';
    return '<img alt="SVG artwork" style="width:' + width + ';aspect-ratio:' + art.width + '/' + art.height + '" src="' + art.uri + '">';
  }).join('');
  const css = 'html,body{margin:0;min-height:100%;background:transparent;color-scheme:' + theme + '}html{height:100%}' +
    'body{box-sizing:border-box;display:flex;flex-direction:column;align-items:safe center;justify-content:safe center;gap:16px;padding:12px;' +
    'font:12px system-ui;color:' + (theme === 'dark' ? '#a3a3a3' : '#666') + '}' +
    'img{display:block;flex:none;max-width:none;max-height:none;height:auto;object-fit:contain;background:transparent}';
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' +
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" +
    '"><style>' + css + '</style></head><body>' + (images || '<span>SVG is incomplete or invalid.</span>') + '</body></html>';
}


/** Real local rasterization. Image-mode SVG cannot execute scripts or load external resources. */
export async function exportSvgPng(code: string, theme: 'light' | 'dark', background: SvgBackground, scale: number): Promise<Blob> {
  const arts = svgArtworks(code, theme);
  if (!arts.length) throw new Error('Invalid or incomplete SVG.');
  if (![1, 2, 3].includes(scale)) throw new Error('Unsupported export scale.');
  const width = arts.reduce((max,a) => Math.max(max,a.width), 0) * scale;
  const height = arts.reduce((n,a) => n + a.height, 0) * scale;
  if (width > 8192 || height > 8192 || width * height > 32_000_000) throw new Error('PNG exceeds the 8192px / 32 megapixel limit. Choose a smaller scale.');
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('PNG rendering is unavailable.');
  if (background === 'white' || background === 'black') { ctx.fillStyle = background; ctx.fillRect(0,0,width,height); }
  let y = 0;
  try {
    for (const art of arts) {
      const image = new Image();
      await new Promise<void>((resolve,reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Could not rasterize SVG.'));
        image.src = art.uri;
      });
      ctx.drawImage(image, (width - art.width * scale) / 2, y, art.width * scale, art.height * scale);
      y += art.height * scale;
    }
    return await new Promise<Blob>((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png'));
  } finally { canvas.width = 0; canvas.height = 0; }
}
