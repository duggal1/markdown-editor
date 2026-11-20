import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  detectRepairLanguage, repairCode, MAX_CODE_REPAIR_CHARS,
} from '../src/lib/codeRepair.ts';

const tick = String.fromCharCode(96);
const fence = tick.repeat(3);
const html = '<!DOCTYPE html>\n<html lang="en">\n<head><title>Game</title></head>\n<body><script>const a = 2;</script></body>\n</html>';
const link = 'https://markdown-editor.opalhq.fun/play/html-fe40h';

// Exact corruption patterns from screenshots: a Flow link, quote/fence
// fragments, the word "code" and a second fence stuck to the doctype.
const damagedHtml = [
  link, '> ' + fence, 'code', fence + html, fence,
].join('\n');
assert.equal(detectRepairLanguage(damagedHtml), 'html');
const cleaned = repairCode(damagedHtml, 'html');
assert.equal(cleaned.text, html, 'Do not remove or rewrite actual HTML source.');
assert.deepEqual(repairCode(cleaned.text, 'html').fixes, [],
  'HTML repair must be idempotent.');
assert.equal(detectRepairLanguage(cleaned.text), 'html');

const codeFence = [fence + 'html', html, fence].join('\n');
assert.equal(repairCode(codeFence, 'html').text, html);
assert.equal(detectRepairLanguage(codeFence), 'html');
assert.equal(repairCode('  \n' + html, 'html').text, html);
assert.equal(repairCode(html, 'html').text, html,
  'Clean HTML, inline scripts, CSS and attributes must remain unchanged.');
const styledHtml = [
  '<!DOCTYPE html>', '<html><head><style>',
  '.x { color: red; } /* preserve CSS exactly */',
  '</style></head><body><script>',
  'const t = ' + tick + 'literal ' + fence + ' inside JS' + tick + ';',
  '</script><main title="HTML &amp; Python">Hello</main></body></html>',
].join('\n');
assert.equal(repairCode(styledHtml, 'html').text, styledHtml);
assert.equal(repairCode(link + '\n' + html, 'html').text, html,
  'The Flow URL alone is a recognized paste artifact.');
assert.equal(repairCode('Random description\n' + html, 'html').text,
  'Random description\n' + html,
  'Do not silently delete arbitrary prose that may be meaningful.');
const markdownDoc = '# Guide\n\nHere is an example:\n' + fence +
  'html\n' + html + '\n' + fence;
assert.equal(detectRepairLanguage(markdownDoc), null,
  'Documentation containing a fenced HTML example stays Markdown.');
assert.equal(repairCode(markdownDoc, 'html').text, markdownDoc,
  'Even an explicitly triggered repair must not delete the documentation.');
const literalHtmlFence = '<!DOCTYPE html>\n<html><script>const x = ' +
  tick + fence + tick + ';</script></html>\n' + fence;
assert.equal(repairCode(literalHtmlFence, 'html').text, literalHtmlFence,
  'A closing-fence-looking line without an opening wrapper is not removable.');

const python = 'def greet(name):\n    return "Hello, " + name\n\nprint(greet("Flow"))';
assert.equal(detectRepairLanguage(python), 'python');
assert.equal(detectRepairLanguage(python, 'html'), 'html',
  'Imported filename language is authoritative.');
assert.equal(repairCode(python, 'python').text, python,
  'Do not change Python indentation, strings or logic.');
const fencedPython = fence + 'python\n' + python + '\n' + fence;
assert.equal(detectRepairLanguage(fencedPython), 'python');
assert.equal(repairCode(fencedPython, 'python').text, python);
assert.equal(repairCode(repairCode(fencedPython, 'python').text, 'python').text, python,
  'Python cleanup must be idempotent.');
const repl = '>>> def greet():\n...     return "Hello"\n>>> print(greet())';
assert.equal(detectRepairLanguage(repl), 'python');
assert.equal(repairCode(repl, 'python').text,
  'def greet():\n    return "Hello"\nprint(greet())');
assert.equal(repairCode('>>> print(123)\n123', 'python').text, '>>> print(123)\n123',
  'REPL output must not be removed by guessing which lines are code.');
assert.equal(repairCode('print("not done")\n' + fence, 'python').text,
  'print("not done")\n' + fence,
  'Unpaired Python fences must not be removed.');
assert.equal(repairCode(link + '\n' + python, 'python').text, python);
assert.equal(repairCode('https://example.com/keep-this\n' + python, 'python').text,
  'https://example.com/keep-this\n' + python,
  'URLs from unknown domains are not safe to delete.');
assert.equal(repairCode('x = ' + tick + 'triple' + tick, 'python').text,
  'x = ' + tick + 'triple' + tick);

const large = 'x'.repeat(MAX_CODE_REPAIR_CHARS + 1);
assert.equal(repairCode(large, 'html').text, large,
  'A too-large repair must not modify source in the background.');

// Actual app integration must use a single undoable editor transaction and
// discard stale worker results when another edit or page change occurs.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/workers/codeRepair.ts', import.meta.url), 'utf8');
const action = readFileSync(new URL('../src/lib/codeRepairAction.ts', import.meta.url), 'utf8');
assert.match(app, /codeRepairLanguage === 'html' \? 'Auto HTML Fix'/);
assert.match(app, /codeRepairLanguage === 'python' \? 'Auto Python Fix'/);
assert.match(app, /detectRepairLanguage\(\s*originalDocument\.sliceString\(0, 12000\), current\.language/);
assert.match(app, /const result = repairLanguage\s*\? await repairCodeAction\(source, repairLanguage\)/);
assert.match(app, /view\.state\.doc !== originalDocument/,
  'Background work must not overwrite a newer edit.');
assert.match(app, /changes: \{ from, to, insert: formatted \}/,
  'One CodeMirror transaction ensures full undo.');
assert.match(app, /formatMarkdownAction\(source, \{/,
  'Markdown formatting remains available for prose.');
assert.match(action, /new Worker\(new URL\('\.\.\/workers\/codeRepair\.ts'/,
  'Large repairs should not block the editor thread.');
assert.match(worker, /repairCode\(source, language\)/);
console.log('HTML/Python code repair, screenshot artifacts, preservation and undo integration passed.');
