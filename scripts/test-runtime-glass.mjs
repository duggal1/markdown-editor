import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/htmlPreview.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = { exports: {} };
runInNewContext(compiled, { module: mod, exports: mod.exports });
const html = mod.exports.htmlPreviewDocument(
  '<!doctype html><html><head><title>Contrast</title></head><body><main>Hello</main></body></html>',
);
assert.ok(html && html.includes('flow-runtime-theme'), 'Color sampling bridge must be injected.');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'Injected runtime script must remain executable.');

const body = { tag: 'body' };
const documentElement = { tag: 'html', dataset: {} };
const messages = [];
const observers = [];
const panels = ['/', '/history', '/meetings'].map(path => ({ hidden: false, getAttribute: () => path }));
const routeEvents = [];
const history = { pushState() {}, replaceState() {} };
let background = '#08080e';

const context2d = {
  fillStyle: 'transparent',
  clearRect() {},
  fillRect() {},
  getImageData() {
    const color = String(this.fillStyle).toLowerCase().trim();
    if (color === 'transparent' || color === '#00000000') return { data: [0, 0, 0, 0] };
    const hex = color.match(/^#([0-9a-f]{6})$/);
    if (!hex) throw Error('Unexpected test color ' + color);
    return { data: [parseInt(hex[1].slice(0, 2), 16),
      parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), 255] };
  },
};
const doc = {
  readyState: 'complete', body, documentElement, head: {},
  createElement(name) {
    assert.equal(name, 'canvas');
    return { width: 0, height: 0, getContext: () => context2d };
  },
  querySelector: () => null,
  querySelectorAll: () => panels,
  elementFromPoint: () => body,
  addEventListener() {},
};
const listeners = new Map();
const win = {
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
  dispatchEvent(event) { routeEvents.push(event); },
  addEventListener(type, listener) { listeners.set(type, listener); },
};
const parentWindow = { postMessage: data => messages.push(data) };
const fakeObserver = class {
  constructor(callback) { observers.push(callback); }
  observe() {}
};
runInNewContext(script, {
  document: doc, window: win, parent: parentWindow,
  performance: { now: () => 0 },
  getComputedStyle(element) {
    return {
      backgroundColor: element === body ? background : '#00000000',
      color: '#f8f8f8',
    };
  },
  MutationObserver: fakeObserver,
  history, URL, location: { hash: '' },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  HashChangeEvent: class {},
  matchMedia: () => ({ addEventListener() {} }),
  setTimeout: callback => { callback(); return 1; },
  clearTimeout() {},
  PopStateEvent: class {},
});
assert.deepEqual({ ...messages.at(-1) }, { type: 'flow-runtime-theme', theme: 'dark' },
  'A dark HTML background requires dark glass.');
assert.equal(documentElement.dataset.flowTone, 'dark',
  'The iframe root must expose dark tone for native scrollbars.');
background = '#f8f8fb';
for (const callback of observers) callback();
assert.deepEqual({ ...messages.at(-1) }, { type: 'flow-runtime-theme', theme: 'light' },
  'A light HTML background requires light glass after a dynamic style change.');
assert.equal(documentElement.dataset.flowTone, 'light',
  'The iframe root must update scrollbar tone dynamically.');
background = '#08080e';
for (const callback of observers) callback();
assert.equal(messages.at(-1).theme, 'dark', 'Dark mode must be restorable without a reload.');

// Verify actual message-driven phone toggles and style injection. The iframe
// remains scrollable; only scrollbar chrome is hidden when phone mode is active.
const onMessage = listeners.get('message');
assert.equal(typeof onMessage, 'function', 'Runtime must accept isolated iframe settings.');
onMessage({ source: parentWindow, data: { type: 'flow-runtime-settings', fps: 60, phone: true } });
assert.equal(documentElement.dataset.flowPhone, 'true',
  'Phone preview must suppress iframe scrollbar chrome.');
onMessage({ source: parentWindow, data: { type: 'flow-runtime-settings', fps: 0, phone: false } });
assert.equal(documentElement.dataset.flowPhone, 'false',
  'Returning to desktop must restore themed scrollbar chrome.');
onMessage({ source: parentWindow, data: { type: 'flow-runtime-settings', fps: 60, phone: false, device: 'tablet' } });
assert.equal(documentElement.dataset.flowPhone, 'true', 'Tablet must hide only scrollbar chrome.');
onMessage({ source: parentWindow, data: { type: 'flow-runtime-settings', fps: 0, phone: false, device: 'desktop' } });
assert.equal(documentElement.dataset.flowPhone, 'false');

assert.deepEqual(panels.map(p => p.hidden), [false, true, true]);
history.pushState({ test: true }, '', '/history');
assert.deepEqual(panels.map(p => p.hidden), [true, false, true]);
assert.equal(messages.at(-1).path, '/history');
assert.equal(messages.at(-1).mode, 'push');
history.replaceState(null, '', 'meetings');
assert.deepEqual(panels.map(p => p.hidden), [true, true, false]);
assert.equal(messages.at(-1).mode, 'replace');
onMessage({ source: parentWindow, data: { type: 'flow-runtime-popstate', path: '/' } });
assert.deepEqual(panels.map(p => p.hidden), [false, true, true]);
assert.equal(win.__FLOW_SITE_ROUTE__, '/');
assert.ok(routeEvents.some(event => event.type === 'flow:route'));

const runtimeHtml = mod.exports.htmlPreviewDocument(
  '<!doctype html><html><head></head><body>Phone</body></html>', { runtime: true });
const runtimeScrollbarStyle = runtimeHtml.match(/<style id="flow-runtime-scrollbars">([\s\S]*?)<\/style>/)?.[1];
assert.ok(runtimeScrollbarStyle, 'Runtime must inject sandbox-local scrollbar styles.');
assert.match(runtimeScrollbarStyle, /data-flow-phone="true"/);
assert.match(runtimeScrollbarStyle, /scrollbar-width:none!important/);
assert.match(runtimeScrollbarStyle, /::-webkit-scrollbar\{display:none!important;width:0!important;height:0!important;/);
assert.doesNotMatch(runtimeScrollbarStyle, /overflow:\s*hidden/,
  'Mobile scrollbar hiding must not disable vertical or nested scrolling.');
assert.match(runtimeScrollbarStyle, /data-flow-tone="dark"/);
assert.match(runtimeScrollbarStyle, /data-flow-tone="light"/);
assert.doesNotMatch(html, /flow-runtime-scrollbars/,
  'Normal embedded Markdown preview must not inherit player-only scrollbar overrides.');

const runtime = readFileSync(new URL('../src/components/HtmlPlayPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const select = readFileSync(new URL('../src/components/RuntimeSelect.tsx', import.meta.url), 'utf8');
assert.match(runtime, /data-glass=\{glass\}/, 'Player chrome must use iframe tone state.');
assert.match(runtime, /event\.data\.type === 'flow-runtime-theme'/, 'Player must consume iframe messages.');
assert.match(app, /data-glass=\{activeHtml \? htmlSurfaceTone : undefined\}/,
  'Editor popout should follow the HTML tone too.');
assert.doesNotMatch(app, /className="share-button html-view-button"/,
  'Duplicate topbar full HTML control must not return.');
assert.match(select, /role="listbox"/);
assert.match(select, /role="option"/);
assert.match(select, /ArrowDown/);
assert.match(select, /Escape/);
assert.doesNotMatch(runtime, /<select(?:\s|>)/, 'Runtime must use custom dropdowns.');
assert.match(css, /\.html-play-page\[data-glass='light'\]/);
assert.match(css, /\.preview-pane\[data-glass='light'\] \.html-preview-popout/);
assert.match(css, /\/\* HTML Runtime\. This is the only CSS definition/);
assert.doesNotMatch(css, /\/\* Adaptive HTML runtime\./,
  'Legacy competing HTML player CSS rules must be removed.');
assert.match(css, /--glass-panel: linear-gradient\(90deg,rgba\(0,0,0,\.12\),rgba\(0,0,0,\.07\)/);
assert.match(css, /--glass-panel: linear-gradient\(90deg,rgba\(255,255,255,\.42\),rgba\(255,255,255,\.28\)/);
assert.match(css, /--glass-menu: linear-gradient/);
assert.equal((css.match(/--glass-blur: blur\(15px\)/g) || []).length, 2);
assert.match(css, /backdrop-filter: var\(--glass-blur\)/,
  'Pill, panel, and dropdown must use actual backdrop-filter.');
assert.match(css, /\.html-runtime-field\[data-open='true'\] \{ z-index: 20; \}/,
  'Open dropdown must layer above neighboring action controls.');
assert.match(select, /data-open=\{open\}/,
  'Dropdown must expose the stacking state.');
assert.match(select, /createPortal\(menu, host\)/,
  'The dropdown must escape the panel backdrop root so it blurs the real HTML scene.');
assert.match(select, /querySelector<HTMLElement>\('\.html-play-page'\)/,
  'Portaled dropdowns must inherit the HTML page dark\/light glass theme.');
assert.match(css, /\.html-runtime-options \{\s*position: fixed; z-index: 250;/,
  'The dropdown must float over controls instead of clipping within its trigger.');
assert.match(css, /\.html-iphone-content \{[\s\S]*?width: 306px; height: 667px;[\s\S]*?padding-top: 44px;/,
  'Original SVG interior dimensions and top inset must be preserved.');
const cssRuntimeStart = css.indexOf('/* HTML Runtime. This is the only CSS definition');
const cssRuntimeEnd = css.indexOf('/* Share and Publish modals:', cssRuntimeStart);
assert.ok(cssRuntimeStart >= 0 && cssRuntimeEnd > cssRuntimeStart);
const runtimeRules = css.slice(cssRuntimeStart, cssRuntimeEnd);
assert.match(runtimeRules, /border: 1px solid var\(--glass-edge\)/);
assert.match(runtimeRules, /--glass-edge: rgba\(255,255,255,\.20\)/);
assert.match(runtimeRules, /--glass-edge: rgba\(0,0,0,\.12\)/);
assert.match(runtimeRules, /--glass-shadow: 0 2px 6px rgba\(0,0,0,\.15\)/);
assert.doesNotMatch(runtimeRules, /box-shadow:\s*inset|outline:\s*[1-9]/);
assert.match(runtimeRules, /\.html-play-panel \{[\s\S]*?border-radius: 10px/);
assert.match(runtimeRules, /\.html-ipad-screen \{ overflow:hidden; border-radius:18px/);
assert.match(runtimeRules, /--glass-option-hover: rgba\(0,0,0,\.26\)/);
assert.match(runtimeRules, /--glass-option-selected: rgba\(0,0,0,\.33\)/);
assert.match(runtimeRules, /--glass-option-hover: rgba\(255,255,255,\.30\)/);
assert.match(runtimeRules, /--glass-option-selected: rgba\(255,255,255,\.41\)/);
assert.match(runtimeRules, /\.html-runtime-option\[aria-selected='true'\] \{[\s\S]*?background: var\(--glass-option-selected\);/);
assert.match(runtime, /type: 'flow-runtime-settings', fps: fpsLimit, phone/,
  'Phone mode must be delivered into the isolated HTML iframe.');

assert.match(runtime, /data-preview-device=\{device\}/,
  'Phone-only CSS must be tied to the device toggle.');
assert.match(runtime, /<IPhoneFrame isDark=\{glass === 'dark'\}>/,
  'The existing HTML tone must control the original iPhone frame colors.');
assert.match(runtimeRules,
  /\.html-play-page\[data-preview-device='phone'\]\[data-glass='light'\] \{\s*background: #fafafa;/,
  'Only light HTML in phone mode gets the neutral-50 background.');
assert.match(runtimeRules,
  /\.html-play-page\[data-preview-device='phone'\]\[data-glass='light'\] \.html-iphone-frame \{[\s\S]*?background: #f5f5f5;/,
  'The light iPhone frame uses neutral-100.');
assert.match(runtimeRules,
  /\.html-play-page\[data-preview-device='phone'\]\[data-glass='light'\] \.html-iphone-content \{[\s\S]*?background: #f5f5f5;/,
  'The light iPhone screen uses neutral-100.');
assert.doesNotMatch(runtimeRules,
  /\.html-play-page\[data-preview-device='phone'\](?!\[data-glass='light'\])\s*\{/,
  'Selecting iPhone alone must not force a white canvas.');
assert.doesNotMatch(runtimeRules, /refraction|::before/,
  'Refracted pseudo-element effects must not come back.');
assert.match(runtimeRules, /box-shadow: var\(--glass-shadow\)/, 'Reference glass uses a shallow outer shadow.');
assert.match(runtimeRules, /background: #101114;/,
  'Dark mode must keep its original dark outer background.');
assert.match(runtime, /const spring = \{ type: 'spring'/,
  'The original top-left animation settings must stay untouched.');
assert.match(select, /type: 'spring', stiffness: 420, damping: 32/,
  'The FPS control dropdown must retain its original implementation.');

console.log('Theme-correct phone/tablet, reference glass, translucent selected states, scrollbars and original iPhone geometry passed.');
