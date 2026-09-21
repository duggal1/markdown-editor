/**
 * Render SVG in a script-disabled, network-disabled iframe.
 * Adapt only dark monochrome paint for Flow's dark canvas; preserve the original file.
 */
function darkInk(color: string): boolean {
  const value = color.trim().toLowerCase().replace(/\s+/g, '');
  if (value === 'black') return true;
  if (!value || value === 'none' || value === 'transparent' ||
    value === 'currentcolor' || value.startsWith('url(')) return false;
  let parts: number[] | null = null;
  if (/^#[0-9a-f]{3,8}$/i.test(value)) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = hex.slice(0, 3).split('').map(c => c + c).join('');
    if (hex.length >= 6) parts = [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16));
  } else {
    const match = /^rgba?\((\d+),(\d+),(\d+)/.exec(value);
    if (match) parts = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  if (!parts) return false;
  const [r, g, b] = parts;
  return Math.max(r, g, b) < 125 && Math.max(r, g, b) - Math.min(r, g, b) < 35;
}
export function svgPreviewDocument(code: string, theme: 'light' | 'dark'): string {
  let svg = code;
  if (theme === 'dark') {
    const parsed = new DOMParser().parseFromString(code, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root.localName.toLowerCase() === 'svg' && !parsed.querySelector('parsererror')) {
      const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
      for (const node of nodes) {
        for (const attribute of ['fill', 'stroke', 'color']) {
          const value = node.getAttribute(attribute);
          if (value && darkInk(value)) node.setAttribute(attribute, '#fafaf9');
        }
        const element = node as SVGElement;
        for (const property of ['fill', 'stroke', 'color'] as const) {
          const value = element.style?.getPropertyValue(property);
          if (value && darkInk(value)) element.style.setProperty(property, '#fafaf9');
        }
      }
      // A dark SVG with no explicit fill inherits black from the root.
      if (!root.hasAttribute('fill') && !root.hasAttribute('style') &&
        !root.querySelector('[fill], [style]')) root.setAttribute('fill', '#fafaf9');
      svg = new XMLSerializer().serializeToString(root);
    }
  }
  const css = 'html,body{margin:0;height:100%;display:grid;place-items:center;background:transparent;color:' +
    (theme === 'dark' ? '#fafaf9' : '#1c1917') +
    '}svg{display:block;max-width:100%;max-height:100%;width:auto;height:auto}';
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' +
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" +
    '"><style>' + css + '</style></head><body>' + svg + '</body></html>';
}
