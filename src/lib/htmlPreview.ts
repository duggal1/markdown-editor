/**
 * HTML remains an isolated, opaque-origin document. Inject policy and bridge
 * scripts as strings instead of DOMParser + serialize: the latter duplicates
 * multi-megabyte documents and blocks the editor's main thread.
 */
const HTML_OPEN = /^\s*(?:<!doctype\s+html\b[^>]*>\s*|<!--[\s\S]*?-->\s*)*(?:<html(?:\s|>)|<head(?:\s|>)|<body(?:\s|>)|<(?:main|div|section|article|header|footer|nav|form|input|button|p|h[1-6]|ul|ol|table|style|script|link|meta|span|a|img|canvas|video|svg)\b)/i;

export function looksLikeHtml(source: string): boolean {
  return HTML_OPEN.test(source.slice(0, 12000)) ||
    /^\s*<!doctype\s+html(?:\s|>)/i.test(source.slice(0, 200));
}

export type HtmlPreviewOptions = { runtime?: boolean; route?: string };

// An opaque origin means no access to Flow's cookies or local storage. HTTPS
// modules, shaders, GLB assets, and workers can load when their host allows CORS.
// CSP does not grant GPU scheduling priority; browsers control that.
const CSP = [
  "default-src https: data: blob:",
  "script-src 'unsafe-inline' 'unsafe-eval' https: blob:",
  "style-src 'unsafe-inline' https:",
  "connect-src https: wss:",
  "img-src https: data: blob:",
  "font-src https: data:",
  "media-src https: data: blob:",
  "worker-src https: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action https:",
].join('; ');

function injectedBridge(route: string): string {
  // Literal JSON protects quoted paths and avoids inserting user input as JS.
  return '<script>' + [
    '(function(){',
    'var currentRoute=' + JSON.stringify(route) + ';',
    'window.__FLOW_SITE_ROUTE__=currentRoute;',
    'var target=0, frames=0, tick=performance.now();',
    'var nativeFrame=window.requestAnimationFrame.bind(window);',
    'var nativeCancel=window.cancelAnimationFrame.bind(window);',
    'var callbacks=new Map(), nextId=1, last=0;',
    'window.requestAnimationFrame=function(callback){',
    ' var id=nextId++;',
    ' function run(ts){',
    '  if(!callbacks.has(id))return;',
    '  if(target>0&&ts-last<1000/target-0.8){callbacks.set(id,nativeFrame(run));return;}',
    '  if(target>0)last=ts;',
    '  callbacks.delete(id);callback(ts);',
    ' }',
    ' callbacks.set(id,nativeFrame(run));return id;',
    '};',
    'window.cancelAnimationFrame=function(id){var handle=callbacks.get(id);',
    ' if(handle!==undefined){nativeCancel(handle);callbacks.delete(id);}};',
    'function meter(ts){frames++;',
    ' if(ts-tick>=1000){parent.postMessage({type:"flow-runtime-fps",fps:Math.round(frames*1000/(ts-tick))},"*");frames=0;tick=ts;}',
    ' nativeFrame(meter);}',
    'nativeFrame(meter);',
    'var push=history.pushState, replace=history.replaceState;',
    'function routeTo(url, soft){',
    ' if(typeof url!=="string"||!url.startsWith("/")||url.startsWith("//"))return false;',
    ' parent.postMessage({type:"flow-runtime-route",path:url,soft:soft},"*");return true;',
    '}',
    'history.pushState=function(s,t,u){if(routeTo(u,true))return;',
    ' try{return push.call(this,s,t,u);}catch(e){return;}};',
    'history.replaceState=function(s,t,u){if(routeTo(u,true))return;',
    ' try{return replace.call(this,s,t,u);}catch(e){return;}};',
    'document.addEventListener("click",function(e){',
    ' if(e.defaultPrevented||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;',
    ' var a=e.target&&e.target.closest&&e.target.closest("a[href]");',
    ' if(!a||(a.target&&a.target!=="_self")||a.hasAttribute("download"))return;',
    ' var href=a.getAttribute("href");',
    ' if(routeTo(href,false))e.preventDefault();',
    '});',
    'window.addEventListener("message",function(e){if(e.source!==parent||!e.data)return;',
    ' if(e.data.type==="flow-html-scroll"){',
    '  var progress=Math.max(0,Math.min(1,Number(e.data.progress)||0));',
    '  var root=document.scrollingElement||document.documentElement;',
    '  scrollTo(0,Math.max(0,root.scrollHeight-innerHeight)*progress);',
    ' }',
    ' if(e.data.type==="flow-runtime-settings"){',
    '  var fps=Number(e.data.fps);target=[30,60,120].includes(fps)?fps:0;',
    ' }',
    ' if(e.data.type==="flow-runtime-popstate"){',
    '  window.__FLOW_SITE_ROUTE__=String(e.data.path||"/");',
    '  window.dispatchEvent(new PopStateEvent("popstate"));',
    ' }',
    '});',
    '})();',
  ].join('') + '</script>';
}

export function htmlPreviewDocument(source: string, options: HtmlPreviewOptions = {}): string | null {
  if (!looksLikeHtml(source)) return null;
  const csp = '<meta http-equiv="Content-Security-Policy" content="' + CSP.replace(/"/g, '&quot;') + '">';
  const injected = csp + injectedBridge(options.route || '/');
  // Inject before user-authored scripts. Do not parse/serialize 10 MB of HTML.
  if (/<head\b[^>]*>/i.test(source)) {
    return source.replace(/<head\b[^>]*>/i, head => head + injected);
  }
  if (/<html\b[^>]*>/i.test(source)) {
    return source.replace(/<html\b[^>]*>/i, html => html + '<head>' + injected + '</head>');
  }
  const doctype = source.match(/^\s*<!doctype\s+html\b[^>]*>/i);
  if (doctype) return source.slice(0, doctype[0].length) + injected + source.slice(doctype[0].length);
  return injected + source;
}
