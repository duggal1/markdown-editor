import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { listEnterIntent } from '../src/lib/listEditing.ts';
import { formatPlainTextAsMarkdown } from '../src/lib/autoMarkdown.ts';

const fence = String.fromCharCode(96).repeat(3);
const check = (line, expected, cursor = line.length) =>
  assert.equal(listEnterIntent(line, cursor), expected, JSON.stringify({ line, cursor }));

check('- one', 'plain-newline');
check('- two', 'plain-newline');
check('* apple', 'plain-newline');
check('+ apple', 'plain-newline');
check('1. first', 'plain-newline');
check('12) next', 'plain-newline');
check('  - child', 'plain-newline');
check('- [ ] todo', 'plain-newline');
check('- [x] completed', 'plain-newline');
check('- ', 'exit-list');
check('* ', 'exit-list');
check('12. ', 'exit-list');
check('  - ', 'exit-list');
check('- [ ] ', 'exit-list');
check('- [x] ', 'exit-list');
check('', null);
check('just text', null);
check('---', null);
check('-word', null);
check(fence + 'javascript', null);
check('| Item | Value |', null);
check('> - quote', null);
check('- one', null, 1); // Cursor before list content must use native editing.

const src = readFileSync(new URL('../src/components/MarkdownEditor.tsx', import.meta.url), 'utf8');
assert.equal((src.match(/markdown\(\{ codeLanguages: languages, addKeymap: false \}\)/g) || []).length, 2,
  'Both initial Markdown mode and async language reconfiguration must disable implicit list continuation.');
assert.match(src, /Prec\.highest\(keymap\.of\(\[/,
  'Explicit list Enter must take precedence over the generic CodeMirror Enter command.');
assert.match(src, /key: 'Enter', run: target => !activeLanguage && enterExplicitMarkdownList\(target\)/,
  'Do not intercept raw code editing or install implicit auto-list continuation.');
assert.match(src, /markdownKeymap\.filter\(binding => binding\.key === 'Backspace'\)/,
  'Retain Markdown list Backspace behavior without retaining its Enter binding.');
assert.match(src, /return insertNewline\(view\);/,
  'Enter within a nonempty list must insert a plain line break, without another bullet.');
assert.match(src, /insert: '\\n' \},\s*selection: \{ anchor: line\.from \+ 1 \}/,
  'Leaving an empty list must create a blank separator for tables and code.');
assert.match(src, /node\.name === 'FencedCode' \|\| node\.name === 'CodeBlock'/,
  'List-shaped text inside code fences must preserve code editing behavior.');
assert.match(src, /keymap\.of\(\[indentWithTab\]\)/,
  'Tab indentation support must remain installed.');
assert.match(src, /formatPlainTextAsMarkdown\(text, \{ atDocumentStart: atStart \}\)/,
  'Paste formatting must not be replaced by the list typing fix.');
assert.match(src, /change\.current\(update\.state\.doc\.toString\(\), documentId\)/,
  'Small edits must still reach the regular save and preview pipeline unchanged.');

// Model actual keystrokes, preserving the pure Enter intent used by CodeMirror.
function enterAtEnd(source) {
  const line = source.slice(source.lastIndexOf('\n') + 1);
  const intent = listEnterIntent(line, line.length);
  if (intent === 'exit-list') {
    return source.slice(0, source.length - line.length) + '\n';
  }
  return source + '\n';
}

let manuallyTyped = '- one';
manuallyTyped = enterAtEnd(manuallyTyped);
manuallyTyped += '- two'; // Person types their own marker. Never "- - two".
assert.equal(manuallyTyped, '- one\n- two');
manuallyTyped = enterAtEnd(manuallyTyped);
manuallyTyped = enterAtEnd(manuallyTyped); // A genuinely empty line exits the list.
manuallyTyped += '| Name | Value |\n| --- | --- |\n| Flow | 1 |';
manuallyTyped = enterAtEnd(manuallyTyped);
manuallyTyped = enterAtEnd(manuallyTyped);
manuallyTyped += fence + 'js\nconst n = 1;\n' + fence;
assert.doesNotMatch(manuallyTyped, /- - two/);
assert.deepEqual(
  unified().use(remarkParse).use(remarkGfm).parse(manuallyTyped).children.map(node => node.type),
  ['list', 'table', 'code'],
  'List, GFM table and fenced code must be three separate blocks.'
);
assert.equal(formatPlainTextAsMarkdown(manuallyTyped), manuallyTyped,
  'Paste formatter must preserve manually typed Markdown lists, tables and code.');

// An empty marker exits on the next Enter, instead of trapping all following
// lines inside a repeatedly continued list.
const emptyMarker = '- one\n- ';
const exited = enterAtEnd(emptyMarker);
assert.equal(exited, '- one\n\n');
const withTable = exited + '| Item | Count |\n| --- | --- |\n| A | 2 |';
assert.deepEqual(
  unified().use(remarkParse).use(remarkGfm).parse(withTable).children.map(node => node.type),
  ['list', 'table'],
  'Exiting an empty bullet must not swallow the next table.'
);
assert.equal(enterAtEnd('1. one\n2. '), '1. one\n\n',
  'Ordered lists must exit cleanly.');
assert.equal(enterAtEnd('- [ ] '), '\n', 'Empty task list items must exit cleanly.');

console.log('List typing, empty-line exit, table/fence parsing, and save wiring regressions passed.');
