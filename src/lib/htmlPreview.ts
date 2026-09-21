/**
 * An isolated live browser preview for standalone HTML and HTML code fences.
 * The source remains untouched. The iframe has an opaque origin, and the CSP
 * allows self-contained HTML/CSS/inline JS without exposing Flow's storage.
 */
const HTML_OPEN = /^\s*(?:<!doctype\s+html\b[^>]*>\s*|<!--[\s\S]*?-->\s*)*(?:<html(?:\s|>)|<head(?:\s|>)|<body(?:\s|>)|<(?:main|div|section|article|header|footer|nav|form|input|button|p|h[1-6]|ul|ol|table|style|script|link|meta|span|a|img|canvas|video|svg)\b)/i;

export function looksLikeHtml(source: string): boolean {
  return HTML_OPEN.test(source.slice(0, 12000)) ||
    /^\s*<!doctype\s+html(?:\s|>)/i.test(source.slice(0, 200));
}

export function htmlPreviewDocument(source: string): string | null {
  if (!looksLikeHtml(source)) return null;
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  if (!parsed.documentElement || parsed.documentElement.localName !== 'html') return null;
  const head = parsed.head;
  if (!head) return null;

  // Apply security restrictions before user-authored styles/scripts.
  const csp = parsed.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
    "img-src data: blob:; font-src data:; media-src data: blob:; " +
    "connect-src 'none'; object-src 'none'; frame-src 'none'; " +
    "form-action 'none'; base-uri 'none'";
  head.prepend(csp);

  // No meta-refresh redirects or <base> URL changes in user-pasted documents.
  head.querySelectorAll('base, meta[http-equiv]').forEach(node => {
    if (node !== csp) node.remove();
  });
  // Approximate source-to-preview scroll mapping across the iframe's opaque
  // origin. The editor never gets access to the document's script or storage.
  const sync = parsed.createElement('script');
  sync.textContent = [
    "window.addEventListener('message', function(event) {",
    "  if (event.source !== window.parent || !event.data || event.data.type !== 'flow-html-scroll') return;",
    "  var fraction = Math.max(0, Math.min(1, Number(event.data.progress) || 0));",
    "  var root = document.scrollingElement || document.documentElement;",
    "  window.scrollTo(0, Math.max(0, root.scrollHeight - window.innerHeight) * fraction);",
    "});",
  ].join('\n');
  parsed.body.append(sync);
  // DOMParser treats <script> as inert here; scripts run only inside the iframe.
  const doctype = parsed.doctype ? '<!doctype html>\n' : '';
  return doctype + parsed.documentElement.outerHTML;
}
