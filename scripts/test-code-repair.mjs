import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repairCodeSource, repairLanguage } from '../src/lib/codeRepair.ts';
import { repairCodeAction } from '../src/lib/codeRepairAction.ts';

const fence = String.fromCharCode(96).repeat(3);
const html = '<!DOCTYPE html>\n<html lang="en">\n<head><title>Test</title></head>\n<body><div>Keep source exact</div></body>\n</html>';
const rawHtml = '<!DOCTYPE html>\n<html><body>Ready</body></html>';
const python = 'import math\n\ndef square(value):\n    return value * value\n';

assert.equal(repairLanguage(html), 'html');
assert.equal(repairCodeSource(html, 'html'), html, 'Working HTML is byte-for-byte unchanged.');
assert.equal(repairCodeSource(rawHtml, 'html'), rawHtml);
assert.equal(repairCodeSource(python, 'python'), python, 'Working Python is byte-for-byte unchanged.');

const brokenHtml = [
  'https://markdown-editor.opalhq.fun/play/html-fe40h',
  '> ' + fence,
  'code',
  fence + '<!DOCTYPE html>',
  '<html lang="en"><head><title>Test</title></head><body>OK</body></html>',
  fence,
].join('\n');
const expectedHtml = '<!DOCTYPE html>\n<html lang="en"><head><title>Test</title></head><body>OK</body></html>';
assert.equal(repairLanguage(brokenHtml), 'html', 'Screenshot corruption must still classify as HTML.');
assert.equal(repairCodeSource(brokenHtml, 'html'), expectedHtml,
  'Remove URL, quote, fence, code label and dangling fence without generating any HTML.');
assert.equal(repairCodeSource(expectedHtml, 'html'), expectedHtml,
  'Repair is idempotent.');
assert.equal(repairCodeSource(
  'https://markdown-editor.opalhq.fun/play/html-fe40h' + rawHtml, 'html'
), rawHtml, 'URL attached directly to a DOCTYPE should be removable.');
assert.equal(repairCodeSource(fence + 'html\n' + rawHtml + '\n' + fence, 'html'), rawHtml,
  'Pasted fenced HTML must unwrap cleanly.');

const inlineLink = '<html><body><a href="https://example.com">Keep link</a></body></html>';
assert.equal(repairCodeSource(inlineLink, 'html'), inlineLink,
  'Never remove real links inside an HTML document.');
const commentBefore = '<!-- important -->\n' + rawHtml;
assert.equal(repairCodeSource(commentBefore, 'html'), commentBefore,
  'Never remove valid preceding HTML comments.');
const legitimateMarkdown = '# Documentation\n\nSome prose about HTML.\n\n' + fence + 'html\n' + rawHtml + '\n' + fence;
assert.equal(repairCodeSource(legitimateMarkdown, 'html'), legitimateMarkdown,
  'Never discard a Markdown document surrounding a code example.');
assert.equal(repairLanguage(legitimateMarkdown), null,
  'A prose document containing an HTML example is not automatically an HTML file.');
assert.equal(repairCodeSource('let template = "<html>keep me</html>";', 'html'),
  'let template = "<html>keep me</html>";', 'Never strip source containing an HTML literal.');

const pyWrapped = ['code', fence + 'python', 'def greet(name):', '    return f"Hi {name}"', fence].join('\n');
const pyExpected = 'def greet(name):\n    return f"Hi {name}"';
assert.equal(repairLanguage(pyWrapped), 'python');
assert.equal(repairCodeSource(pyWrapped, 'python'), pyExpected,
  'Fenced Python should unwrap without changing indentation or code.');
assert.equal(repairCodeSource(pyExpected, 'python'), pyExpected);
assert.equal(repairCodeSource('>>> import math\n>>> print(math.pi)\n', 'python'),
  'import math\nprint(math.pi)\n', 'An all-input Python REPL transcript can lose its prompts.');
assert.equal(repairCodeSource('>>> print(2)\n2\n', 'python'), '>>> print(2)\n2\n',
  'Mixed REPL output is ambiguous and must be preserved.');
assert.equal(repairLanguage('def foo():\n    return 1\n', 'python'), 'python',
  'An explicitly imported Python file should always get Python Fix.');
assert.equal(repairLanguage('not code at all', 'python'), 'python',
  'Explicit file language wins when damaged content no longer detects cleanly.');
assert.equal(repairLanguage('export interface A { x: string }', 'typescript'), null,
  'Unsupported languages must not be passed to speculative repair.');
assert.equal(repairCodeSource('print("hello")', 'python'), 'print("hello")');

// Large input is repaired without blocking the editor thread in supported
// browsers; Node without Worker uses the same pure implementation.
const heavy = rawHtml.replace('</body>', '<p>' + 'x'.repeat(120_000) + '</p></body>');
assert.equal(await repairCodeAction(heavy, 'html'), heavy);

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../src/components/MarkdownEditor.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const action = readFileSync(new URL('../src/lib/codeRepairAction.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/workers/codeRepair.ts', import.meta.url), 'utf8');

assert.match(app, /'Auto HTML Fix'/);
assert.match(app, /'Auto Python Fix'/);
assert.match(app, /await repairCodeAction\(source, currentLanguage\)/);
assert.match(app, /await formatMarkdownAction\(source, \{ atDocumentStart: !selected && from === 0, selection: selected \}\)/,
  'Markdown formatting must remain available for prose.');
assert.match(app, /view\.state\.doc !== originalDocument/,
  'Repairs must not overwrite a newer edit or another document.');
assert.match(app, /Undo to revert/,
  'One CodeMirror change must remain undoable.');
assert.match(editor, /repairLanguage\(text, fileLanguage\) \|\| !shouldAutoFormatPaste\(text\)/,
  'Pasted HTML/Python must not be reformatted into Markdown.');
assert.match(editor, /gutterSlot\.reconfigure\(lineNumbers\(\)\)/,
  'Use CodeMirror native line numbers, not custom drifting overlay counters.');
assert.match(editor, /gutterSlot\.reconfigure\(\[\]\)/,
  'Markdown pages should not show source gutter numbers.');
assert.equal((editor.match(/gutterSlot\.reconfigure\(lineNumbers\(\)\)/g) || []).length, 1,
  'Exactly one code gutter must be configured.');
assert.match(css, /\.cm-editor\.raw-code \.cm-content \{[\s\S]*?max-width: none;[\s\S]*?padding: 0 28px 80px 12px !important;/,
  'Raw code must no longer inherit the centered Markdown writing inset.');
assert.match(css, /\.cm-editor\.raw-code \.cm-lineNumbers \.cm-gutterElement \{[\s\S]*?font-variant-numeric: tabular-nums;/,
  'Digits should have fixed width and right alignment.');
assert.match(css, /\.cm-editor\.raw-code \.cm-gutters \{[\s\S]*?position: sticky;/,
  'Native line gutter must remain correctly positioned on scroll.');
assert.match(editor, /EditorView\.lineWrapping/,
  'Wrapped code should keep native CodeMirror measurements.');
assert.match(action, /WORKER_THRESHOLD = 50_000/);
assert.match(action, /new Worker\(/, 'Large repairs must not block typing.');
assert.match(worker, /repairCodeSource\(source, language\)/);
console.log('Deterministic HTML/Python source repairs, untouched code, and native gutter checks passed.');
