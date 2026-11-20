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
  elementFromPoint: () => body,
  addEventListener() {},
};
const listeners = new Map();
const win = {
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
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
  history: { pushState() {}, replaceState() {} },
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
assert.match(css, /--glass-panel: rgba\(9,12,19,\.30\)/,
  'Dark glass must be translucent, not solid charcoal.');
assert.match(css, /--glass-panel: rgba\(250,250,253,\.39\)/,
  'Light glass must remain translucent.');
assert.match(css, /--glass-menu: rgba\(10,13,20,\.36\)/,
  'Dark dropdown must be actual glass, not a solid menu.');
assert.match(css, /--glass-menu: rgba\(252,252,254,\.42\)/,
  'Light dropdown must be actual glass.');
assert.match(css, /--glass-blur: blur\(36px\)/,
  'Both glass themes must use a substantial optical blur.');
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
assert.doesNotMatch(runtimeRules, /border:\s*[1-9]/,
  'No player, phone, dropdown or selector may draw a positive-width border.');
assert.doesNotMatch(runtimeRules, /--glass-(?:inner-)?edge|border-color:|box-shadow:\s*inset/,
  'No hidden stroke tokens or inset simulated borders are permitted.');
assert.doesNotMatch(runtimeRules, /outline:\s*[1-9]/,
  'Focus feedback must not introduce another hard border.');
assert.match(runtimeRules, /--glass-refraction-top: rgba\(223,236,255,\.21\)/,
  'Dark glass must contain a subtle soft edge refraction.');
assert.match(runtimeRules, /--glass-refraction-top: rgba\(255,255,255,\.40\)/,
  'Light glass must contain its own optical edge treatment.');
assert.match(runtimeRules, /--glass-refraction-blur: blur\(44px\)/,
  'Refraction must use stronger backdrop blur than the interior.');
assert.match(runtimeRules, /\.html-play-compact::before,[\s\S]*?\.html-play-panel::before,[\s\S]*?\.html-runtime-options::before,[\s\S]*?\.html-runtime-select-trigger::before,[\s\S]*?\.html-play-device-switch::before \{/,
  'All major runtime surfaces must get optical edge refraction.');
assert.match(runtimeRules, /-webkit-backdrop-filter: var\(--glass-refraction-blur\)/);
assert.match(runtimeRules, /backdrop-filter: var\(--glass-refraction-blur\)/);
assert.match(runtimeRules, /-webkit-mask-composite: xor;[\s\S]*?mask-composite: exclude;/,
  'Refracted edge must be a masked perimeter with transparent center.');
assert.match(runtimeRules, /filter: blur\(1\.6px\)/,
  'The edge must be feathered rather than a hard stroke.');
assert.doesNotMatch(runtimeRules, /box-shadow:\s*inset/,
  'Refraction must not reintroduce an inset border.');

assert.match(runtimeRules, /--glass-option-hover: rgba\(0,0,0,\.26\)/);
assert.match(runtimeRules, /--glass-option-selected: rgba\(0,0,0,\.33\)/);
assert.match(runtimeRules, /--glass-option-hover: rgba\(255,255,255,\.30\)/);
assert.match(runtimeRules, /--glass-option-selected: rgba\(255,255,255,\.41\)/);
assert.match(runtimeRules, /\.html-runtime-option\[aria-selected='true'\] \{[\s\S]*?background: var\(--glass-option-selected\);[\s\S]*?backdrop-filter: blur\(14px\)/);
assert.match(runtime, /type: 'flow-runtime-settings', fps: fpsLimit, phone/,
  'Phone mode must be delivered into the isolated HTML iframe.');

assert.match(runtimeRules,
  /\.html-play-page\[data-glass='light'\] \{[\s\S]*?background: #fafafa; \/\* neutral-50 \*\//,
  'Light HTML must set the entire outer player canvas to neutral-50.');
assert.match(runtimeRules,
  /\.html-play-page\[data-glass='light'\] \.html-play-phone \{[\s\S]*?background: #fafafa;/,
  'The phone stage must inherit the neutral-50 light canvas.');
assert.match(runtimeRules,
  /\.html-play-page\[data-glass='light'\] \.html-iphone-frame \{[\s\S]*?background: #f5f5f5;/,
  'The original iPhone SVG needs a neutral-100 light-mode backing.');
assert.match(runtimeRules,
  /\.html-play-page\[data-glass='light'\] \.html-iphone-content \{[\s\S]*?background: #f5f5f5;/,
  'Phone clipped screen backing must be neutral-100.');
assert.match(runtimeRules,
  /\.html-play-page \{[\s\S]*?background: #101114;/,
  'Dark-mode player canvas must remain dark.');
assert.match(runtimeRules, /\.html-play-desktop \{ position: absolute; inset: 0; \}/,
  'The desktop iframe must fill its new crossfade wrapper.');
assert.match(runtimeRules, /background-color \.2s cubic-bezier\(\.22,1,\.36,1\)/,
  'Hovered options and device selection need smooth non-bouncy easing.');
assert.doesNotMatch(runtimeRules, /transition:[^;]*spring/,
  'CSS states must never bounce.');
assert.doesNotMatch(runtime + select, /type:\s*['"]spring['"]|stiffness:|damping:/,
  'No spring physics allowed in the HTML runtime controls or dropdown.');
assert.match(runtime, /const smoothEase = \[0\.22, 1, 0\.36, 1\]/);
assert.match(runtime, /type: 'tween'/,
  'Device switching must fade with tween easing rather than bounce.');
assert.match(select, /type: 'tween'/,
  'Dropdown selection must ease with a tween, not spring physics.');
assert.match(runtime, /<motion\.div className="html-iphone-stage"/,
  'Switching to iPhone must animate without spring overshoot.');
assert.match(runtime, /<motion\.div className="html-play-desktop"/,
  'Switching to desktop must animate without spring overshoot.');

console.log('Dynamic contrast, neutral-50/100 canvas, smooth tweens, glass, scrollbars and iPhone geometry passed.');
