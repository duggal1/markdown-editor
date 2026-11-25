const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Render authored SVG only in image mode inside an opaque, script-disabled
 * iframe. Never mount user SVG/CSS into Flow's own DOM. Browser image mode
 * disables scripts and external resources while preserving local CSS,
 * gradients, masks, filters and internal references.
 */
export function svgPreviewDocument(code: string, theme: 'light' | 'dark'): string {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(code, 'image/svg+xml');
  const root = parsed.documentElement;
  const roots: Element[] = !parsed.querySelector('parsererror') &&
    root.localName === 'svg' && root.namespaceURI === SVG_NS ? [root] : [];
  if (!roots.length) {
    // Supply the namespace for pasted fragments and allow adjacent SVGs.
    const wrapped = parser.parseFromString('<flow-root xmlns="' + SVG_NS + '">' +
      code.replace(/^\s*<\?xml[^>]*\?>/i, '') + '</flow-root>', 'image/svg+xml');
    if (!wrapped.querySelector('parsererror')) {
      const wrapper = wrapped.documentElement;
      const elements = Array.from(wrapper.children);
      if (elements.every(element => element.localName === 'svg' && element.namespaceURI === SVG_NS) &&
          Array.from(wrapper.childNodes).every(node => node.nodeType !== 3 || !node.textContent?.trim())) {
        roots.push(...elements);
      }
    }
  }
  const foreground = theme === 'dark' ? '#fafafa' : '#0a0a0a';
  const images = roots.map(element => {
    // A presentation attribute is a low-priority fallback for currentColor.
    // Explicit color attributes, inline styles and authored CSS still win.
    if (!element.hasAttribute('color')) element.setAttribute('color', foreground);
    const source = new XMLSerializer().serializeToString(element);
    return '<img alt="SVG artwork" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source) + '">';
  }).join('');
  const css = 'html,body{margin:0;min-height:100%;background:transparent}' +
    'html{color-scheme:' + theme + '}' +
    'body{box-sizing:border-box;min-height:100vh;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:safe center;gap:16px;}' +
    'img{display:block;flex:none;width:min(100%,320px);height:min(320px,100vh);object-fit:contain;background:transparent}';
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' +
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" +
    '"><style>' + css + '</style></head><body>' + images + '</body></html>';
}
