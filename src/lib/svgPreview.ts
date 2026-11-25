/**
 * SVG image mode inside an opaque, script-disabled iframe. No inline active
 * content, network requests or access to the application. Authored CSS,
 * fills, strokes and color declarations are preserved.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
export function adaptSvgForTheme(code: string, _theme: 'light' | 'dark'): string {
  return code;
}
export function svgPreviewDocument(code: string, theme: 'light' | 'dark'): string {
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
  const images = roots.map(root => {
    // Image documents cannot inherit currentColor from the embedding editor.
    // A presentation attribute supplies a default; explicit color attributes,
    // inline styles and CSS rules inside the SVG remain authoritative.
    if (!root.hasAttribute('color')) root.setAttribute('color', theme === 'dark' ? '#f5f5f5' : '#171717');
    const source = new XMLSerializer().serializeToString(root);
    return '<img alt="SVG artwork" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source).replace(/'/g, '%27') + '">';
  }).join('');
  const css = 'html,body{margin:0;min-height:100%;background:transparent;color-scheme:' + theme + '}' +
    'body{box-sizing:border-box;display:grid;place-items:center;gap:16px;padding:12px;' +
    'font:12px system-ui;color:' + (theme === 'dark' ? '#a3a3a3' : '#666') + '}' +
    'img{display:block;max-width:100%;max-height:calc(100vh - 24px);width:auto;height:auto;object-fit:contain;background:transparent}';
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' +
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" +
    '"><style>' + css + '</style></head><body>' + (images || '<span>SVG is incomplete or invalid.</span>') + '</body></html>';
}
