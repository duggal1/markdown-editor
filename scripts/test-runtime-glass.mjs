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
const documentElement = { tag: 'html' };
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
const win = {
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
  addEventListener() {},
};
const fakeObserver = class {
  constructor(callback) { observers.push(callback); }
  observe() {}
};
runInNewContext(script, {
  document: doc, window: win, parent: { postMessage: data => messages.push(data) },
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
background = '#f8f8fb';
for (const callback of observers) callback();
assert.deepEqual({ ...messages.at(-1) }, { type: 'flow-runtime-theme', theme: 'light' },
  'A light HTML background requires light glass after a dynamic style change.');
background = '#08080e';
for (const callback of observers) callback();
assert.equal(messages.at(-1).theme, 'dark', 'Dark mode must be restorable without a reload.');

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
assert.match(css, /\.preview-pane\[data-glass='dark'\] \.html-preview-popout/);
console.log('HTML dynamic contrast, custom controls, popout and keyboard behavior tests passed.');
