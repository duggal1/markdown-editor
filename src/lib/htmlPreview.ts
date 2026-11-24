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

// Scrollbars belong to the isolated HTML document, not to the outer
// iframe. In the phone mockup hide their chrome but retain normal scrolling;
// on desktop, match thumb color to the page rather than drawing a grey bar.
const RUNTIME_SCROLLBARS = '<style id="flow-runtime-scrollbars">' + [
  'html[data-flow-phone="true"],html[data-flow-phone="true"] *{scrollbar-width:none!important;-ms-overflow-style:none!important;}',
  'html[data-flow-phone="true"]::-webkit-scrollbar,html[data-flow-phone="true"] *::-webkit-scrollbar{display:none!important;width:0!important;height:0!important;}',
  'html[data-flow-tone="dark"]:not([data-flow-phone="true"]),html[data-flow-tone="dark"]:not([data-flow-phone="true"]) body{scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.46) transparent;}',
  'html[data-flow-tone="light"]:not([data-flow-phone="true"]),html[data-flow-tone="light"]:not([data-flow-phone="true"]) body{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.56) transparent;}',
  'html[data-flow-tone="dark"]::-webkit-scrollbar-thumb,html[data-flow-tone="dark"] body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.46);border-radius:999px;}',
  'html[data-flow-tone="light"]::-webkit-scrollbar-thumb,html[data-flow-tone="light"] body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.56);border-radius:999px;}',
  'html[data-flow-tone]::-webkit-scrollbar-track,html[data-flow-tone] body::-webkit-scrollbar-track{background:transparent;}',
].join('') + '</style>';

function injectedBridge(route: string): string {
  // Literal JSON protects quoted paths and avoids inserting user input as JS.
  return '<script>' + [
    '(function(){',
    'var currentRoute=' + JSON.stringify(route).replace(/</g, '\\u003c') + ';',
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
    // Read computed page colors inside the opaque-origin iframe; the parent
    // cannot inspect them directly. Sample only on load/style changes, never
    // in the FPS loop. Canvas converts modern CSS colors (incl. oklch) to sRGB.
    'var previousTone="", colorProbe=document.createElement("canvas");',
    'colorProbe.width=colorProbe.height=1;',
    'var colorContext=colorProbe.getContext("2d",{willReadFrequently:true});',
    'function luminance(css){',
    ' if(!colorContext||!css||css==="transparent")return null;',
    ' try{',
    '  colorContext.clearRect(0,0,1,1);',
    '  colorContext.fillStyle=css;colorContext.fillRect(0,0,1,1);',
    '  var p=colorContext.getImageData(0,0,1,1).data;',
    '  if(p[3]<32)return null;',
    '  function linear(x){x/=255;return x<=0.04045?x/12.92:Math.pow((x+0.055)/1.055,2.4);}',
    '  return 0.2126*linear(p[0])+0.7152*linear(p[1])+0.0722*linear(p[2]);',
    ' }catch(_){return null;}',
    '}',
    'function pageTone(){',
    ' var root=document.documentElement,body=document.body;',
    ' for(var el of [body,root]){',
    '  if(!el)continue;',
    '  var n=luminance(getComputedStyle(el).backgroundColor);',
    '  if(n!==null)return n<0.23?"dark":"light";',
    ' }',
    ' var meta=document.querySelector("meta[name=theme-color]");',
    ' var m=meta&&luminance(meta.content);',
    ' if(m!==null)return m<0.23?"dark":"light";',
    ' var center=document.elementFromPoint(innerWidth/2,Math.min(innerHeight/3,250));',
    ' for(var node=center;node&&node!==body&&node!==root;node=node.parentElement){',
    '  var b=luminance(getComputedStyle(node).backgroundColor);',
    '  if(b!==null)return b<0.23?"dark":"light";',
    ' }',
    ' var text=luminance(getComputedStyle(body||root).color);',
    ' return text!==null&&text>0.55?"dark":"light";',
    '}',
    'function announceTone(){',
    ' var next=pageTone();',
    ' if(document.documentElement.dataset)document.documentElement.dataset.flowTone=next;',
    ' if(previousTone!==next){previousTone=next;parent.postMessage({type:"flow-runtime-theme",theme:next},"*");}',
    '}',
    'var colorTimer;',
    'function scheduleTone(){clearTimeout(colorTimer);colorTimer=setTimeout(announceTone,90);}',
    'function watchTone(){',
    ' announceTone();',
    ' var changes=new MutationObserver(scheduleTone);',
    ' changes.observe(document.documentElement,{attributes:true,attributeFilter:["class","style","data-theme"]});',
    ' if(document.body)changes.observe(document.body,{attributes:true,attributeFilter:["class","style","data-theme"]});',
    ' if(document.head)changes.observe(document.head,{subtree:true,childList:true,characterData:true});',
    '}',
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",watchTone,{once:true});',
    'else watchTone();',
    'window.addEventListener("load",scheduleTone);',
    'try{matchMedia("(prefers-color-scheme:dark)").addEventListener("change",scheduleTone);}catch(_){}',
    // Keep the document opaque-origin; emulate app-relative history without
    // navigating the frame into Flow itself. Hash routers remain native.
    'var push=history.pushState.bind(history), replace=history.replaceState.bind(history);',
    'var virtualState=null, applyingRoute=false;',
    'function resolveRoute(url){',
    ' if(typeof url!=="string"||!url||url.startsWith("#")||url.startsWith("//")||/^[a-z][a-z0-9+.-]*:/i.test(url))return null;',
    ' try{var parsed=new URL(url,"https://flow-preview.invalid"+currentRoute);',
    ' if(parsed.origin!=="https://flow-preview.invalid")return null;',
    ' return parsed.pathname+parsed.search+parsed.hash;}catch(_){return null;}',
    '}',
    'function showRoute(path, state, pop){',
    ' currentRoute=path;virtualState=state;window.__FLOW_SITE_ROUTE__=path;',
    ' var name=path.split(/[?#]/)[0], nodes=document.querySelectorAll("[data-flow-route]");',
    ' var matching=Array.from(nodes).some(function(n){return n.getAttribute("data-flow-route")===name;});',
    ' if(matching)Array.from(nodes).forEach(function(n){n.hidden=n.getAttribute("data-flow-route")!==name;});',
    ' window.dispatchEvent(new CustomEvent("flow:route",{detail:{path:path,state:state}}));',
    ' if(pop)window.dispatchEvent(new PopStateEvent("popstate",{state:state}));',
    '}',
    'function routeTo(url, soft, mode, state){',
    ' var path=resolveRoute(url);if(path===null)return false;',
    ' showRoute(path,state,false);',
    ' if(!applyingRoute)parent.postMessage({type:"flow-runtime-route",path:path,soft:soft,mode:mode},"*");return true;',
    '}',
    'history.pushState=function(s,t,u){if(routeTo(u,true,"push",s))return;return push(s,t,u);};',
    'history.replaceState=function(s,t,u){if(routeTo(u,true,"replace",s))return;return replace(s,t,u);};',
    'try{Object.defineProperty(history,"state",{get:function(){return virtualState;},configurable:true});}catch(_){}',
    'document.addEventListener("click",function(e){',
    ' if(e.defaultPrevented||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;',
    ' var a=e.target&&e.target.closest&&e.target.closest("a[href]");',
    ' if(!a||(a.target&&a.target!=="_self")||a.hasAttribute("download"))return;',
    ' var href=a.getAttribute("href"), path=resolveRoute(href);if(path===null)return;',
    ' e.preventDefault();routeTo(href,true,"push",null);',
    '});',
    'function initialRoute(){showRoute(currentRoute,virtualState,false);}',
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initialRoute,{once:true});else initialRoute();',
    'window.addEventListener("hashchange",function(){',
    ' if(applyingRoute)return;var path=currentRoute.split("#")[0]+location.hash;',
    ' currentRoute=path;window.__FLOW_SITE_ROUTE__=path;',
    ' parent.postMessage({type:"flow-runtime-route",path:path,soft:true,mode:"replace"},"*");',
    '});',
    'window.addEventListener("message",function(e){if(e.source!==parent||!e.data)return;',
    ' if(e.data.type==="flow-html-scroll"){',
    '  var progress=Math.max(0,Math.min(1,Number(e.data.progress)||0));',
    '  var root=document.scrollingElement||document.documentElement;',
    '  scrollTo(0,Math.max(0,root.scrollHeight-innerHeight)*progress);',
    ' }',
    ' if(e.data.type==="flow-runtime-settings"){',
    '  var fps=Number(e.data.fps);target=[30,60,120].includes(fps)?fps:0;',
    '  if(document.documentElement.dataset)document.documentElement.dataset.flowPhone=e.data.phone===true?"true":"false";',
    ' }',
    ' if(e.data.type==="flow-runtime-popstate"){',
    '  applyingRoute=true;',
    '  try{var path=String(e.data.path||"/"), hash=path.indexOf("#");',
    '   if(hash>=0&&location.hash!==path.slice(hash))replace(null,"",path.slice(hash));',
    '   else if(hash<0&&location.hash)replace(null,"","#");',
    '   showRoute(path,e.data.state||null,true);',
    '   window.dispatchEvent(new HashChangeEvent("hashchange"));',
    '  }finally{applyingRoute=false;}',
    ' }',
    '});',
    '})();',
  ].join('') + '</script>';
}

export function htmlPreviewDocument(source: string, options: HtmlPreviewOptions = {}): string | null {
  if (!looksLikeHtml(source)) return null;
  const csp = '<meta http-equiv="Content-Security-Policy" content="' + CSP.replace(/"/g, '&quot;') + '">';
  const injected = csp + (options.runtime ? RUNTIME_SCROLLBARS : '') + injectedBridge(options.route || '/');
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
