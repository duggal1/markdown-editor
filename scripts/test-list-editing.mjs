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
assert.match(src, /formatPlainTextAsMarkdown\(text, options\)/,
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


// Real CodeMirror transactions exercise contextual formatting without a browser.
const { EditorState } = await import('@codemirror/state');
const { selectionEdit } = await import('../src/lib/selectionFormat.ts');
function formatSelection(source, from, to, kind) {
  const state = EditorState.create({ doc: source, selection: { anchor: from, head: to } });
  const edit = selectionEdit(state.doc, from, to, kind);
  assert.ok(edit);
  return state.update(edit).state;
}
let passage = 'Before\nFirst sentence. Second sentence. Third sentence.\nAfter';
let from = passage.indexOf('First'), to = passage.indexOf('\nAfter');
let bold = formatSelection(passage, from, to, 'bold');
assert.equal(bold.doc.toString(), 'Before\n**First sentence. Second sentence. Third sentence.**\nAfter');
assert.equal(bold.sliceDoc(bold.selection.main.from, bold.selection.main.to), passage.slice(from, to));
assert.equal(formatSelection(bold.doc.toString(), bold.selection.main.from, bold.selection.main.to, 'bold').doc.toString(), passage);
let multiline = 'Before\nOne\nTwo\nThree\nAfter';
let list = formatSelection(multiline, 7, multiline.indexOf('\nAfter'), 'number');
assert.equal(list.doc.toString(), 'Before\n1. One\n2. Two\n3. Three\nAfter');
assert.equal(formatSelection(list.doc.toString(), list.selection.main.from, list.selection.main.to, 'number').doc.toString(), multiline);
assert.equal(formatSelection('One\n\nTwo', 0, 8, 'italic').doc.toString(), '*One*\n\n*Two*');
assert.equal(formatSelection('One\nTwo\nAfter', 0, 8, 'quote').doc.toString(), '> One\n> Two\nAfter');
let linked = formatSelection('go here', 3, 7, 'link');
assert.equal(linked.doc.toString(), 'go [here](https://)');
assert.equal(linked.sliceDoc(linked.selection.main.from, linked.selection.main.to), 'https://');
assert.equal(selectionEdit(EditorState.create({doc:'One\nTwo'}).doc, 0, 7, 'link'), null);
const blockCommandsSource = readFileSync(new URL('../src/lib/blockCommands.ts', import.meta.url), 'utf8');
assert.match(blockCommandsSource, /update\.selectionSet.*this\.scheduleSelection\(\)/);
assert.match(blockCommandsSource, /window\.visualViewport\?\.addEventListener\('resize'/);
assert.match(blockCommandsSource, /snapshot\.doc !== this\.view\.state\.doc/);
assert.match(blockCommandsSource, /this\.toolbar\.remove\(\)/);
console.log('Contextual selection format transactions passed.');
