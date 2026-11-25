/**
 * Render authored SVG as an image inside a script-disabled opaque iframe.
 * Image mode prevents active SVG content and external resources from running.
 * Never recolor authored fills, strokes, gradients, or currentColor.
 */
export function adaptSvgForTheme(code: string, _theme: 'light' | 'dark'): string {
  return code;
}

export function svgPreviewDocument(code: string, theme: 'light' | 'dark'): string {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(code, 'image/svg+xml');
  const valid = !parsed.querySelector('parsererror') && parsed.documentElement.localName === 'svg';
  const roots: Element[] = valid ? [parsed.documentElement] : [];
  if (!valid) {
    const wrapped = parser.parseFromString('<flow-root xmlns="http://www.w3.org/2000/svg">' +
      code.replace(/<\?xml[^>]*\?>/gi, '') + '</flow-root>', 'image/svg+xml');
    if (!wrapped.querySelector('parsererror')) {
      const root = wrapped.documentElement;
      if (Array.from(root.childNodes).every(node => node.nodeType !== 3 || !node.textContent?.trim())) {
        roots.push(...Array.from(root.children).filter(node => node.localName === 'svg'));
      }
    }
  }
  const images = roots.map(root => {
    // Standalone fragments commonly omit the SVG namespace.
    if (!root.namespaceURI) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const source = new XMLSerializer().serializeToString(root);
    const encoded = encodeURIComponent(source);
    return '<img alt="SVG artwork" src="data:image/svg+xml;charset=utf-8,' + encoded + '">';
  }).join('');
  const css = 'html,body{margin:0;min-height:100%;background:transparent}' +
    'body{box-sizing:border-box;display:grid;place-items:center;gap:12px;padding:8px;' +
    'font:12px system-ui;color:' + (theme === 'dark' ? '#a3a3a3' : '#666') + '}' +
    'img{display:block;max-width:100%;max-height:250px;width:auto;height:auto;' +
    'background:repeating-conic-gradient(#b8b8b8 0% 25%,#d2d2d2 0% 50%) 0 0/12px 12px;border-radius:3px}';
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' +
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" +
    '"><style>' + css + '</style></head><body>' + (images || '<span>SVG is incomplete or invalid.</span>') + '</body></html>';
}
