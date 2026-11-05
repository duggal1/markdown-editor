import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
runInNewContext(compile(read('src/lib/previewChunks.ts')), { module: mod, exports: mod.exports });
const { previewParts, previewChunks } = mod.exports;

const dense = Array.from({ length: 5000 }, (_, i) =>
  '- **Step ' + (i + 1) + '** Explain the implementation detail, acceptance criteria and test.' +
  ' This is a continuous list with no empty line between items.').join('\n') + '\n';
const start = performance.now();
const sections = previewParts(dense);
const elapsed = performance.now() - start;
assert.ok(dense.length > 200_000, 'Test must represent a genuinely long document');
assert.ok(sections.length > 40, 'Thousands of adjacent bullets must be windowed');
assert.equal(sections.map(x => x.markdown).join(''), dense, 'Source must be byte-for-byte identical');
assert.equal(previewChunks(dense).join(''), dense, 'Legacy API must preserve exact source');
assert.ok(sections.every(x => x.markdown.length <= 5_000), 'Dense lists must have bounded chunk sizes');
assert.ok(sections.filter(x => x.continuesList).length > 30, 'Continuation metadata should identify split list fragments');
assert.equal(sections[0].continuesList, false);

const grouped = Array.from({ length: 1100 }, (_, i) =>
  '## Area ' + i + '\nA short explanation followed by supporting context.\n').join('');
const headings = previewParts(grouped);
assert.equal(headings.map(x => x.markdown).join(''), grouped);
assert.ok(headings.length > 10, 'Long plans with no blank lines must split on headings');

const nested = ('- Parent\n  - Child one\n  - Child two\n').repeat(1400);
const nestedParts = previewParts(nested);
assert.equal(nestedParts.map(x => x.markdown).join(''), nested);
assert.ok(nestedParts.every(x => !/^  - Child/.test(x.markdown)), 'Never split at nested list items');

const nestedParagraphs = ('- A parent item with a moderately long description.\n\n  - Its child must stay attached.\n  - Another child.\n').repeat(500);
const nestedParagraphParts = previewParts(nestedParagraphs);
assert.equal(nestedParagraphParts.map(x => x.markdown).join(''), nestedParagraphs);
assert.ok(nestedParagraphParts.every(x => !/^  - Its child/.test(x.markdown)),
  'Blank paragraphs inside list items must not become orphaned windows');

const code = '```swift\n' + 'func example() { print("hello") }\n'.repeat(4000) + '```\n';
const mixed = '# Plan\n\n' + ('Intro paragraph.\n\n').repeat(300) + code +
  ('\n## Next section\nDetails that should stay readable.').repeat(250);
const codeParts = previewParts(mixed);
assert.equal(codeParts.map(x => x.markdown).join(''), mixed);
const codeStart = codeParts.findIndex(x => x.markdown.includes('```swift'));
const codeEnd = codeParts.findIndex(x => x.markdown.includes('func example()'));
assert.ok(codeStart >= 0);
assert.equal(codeStart, codeEnd, 'Huge fenced code must stay in one valid Markdown block');
assert.ok(codeParts[codeStart].markdown.includes('```\n'), 'Code fence close must be preserved');

const html = ('## Before\nDetails\n').repeat(350) +
  '<table>\n' + '<tr><td>A cell</td></tr>\n'.repeat(600) + '</table>\n' +
  ('## After\nDetails\n').repeat(350);
const htmlParts = previewParts(html);
assert.equal(htmlParts.map(x => x.markdown).join(''), html);
const htmlChunk = htmlParts.find(x => x.markdown.includes('<table>'));
assert.ok(htmlChunk?.markdown.includes('</table>'), 'Do not split raw HTML blocks');

const preview = read('src/components/MarkdownPreview.tsx');
const styles = read('src/styles.css');
const pipeline = read('src/lib/previewPipeline.ts');
const worker = read('src/workers/preview.ts');
assert.match(preview, /visible\.map\(item =>/, 'Render only the virtual window');
assert.match(preview, /className="virtual-markdown-window"/, 'Translate one grouped window');
assert.match(preview, /locatePreview\(scroll, line, kind, section\)/, 'Sync only within the selected section');
assert.match(preview, /overscan:\s*3/, 'Keep nearby sections available for fast scrolling');
assert.match(preview, /useFlushSync:\s*false/, 'Avoid synchronous React updates on every scroll event');
assert.match(styles, /\.virtual-markdown-window\s*\{/, 'Window must have its own CSS position');
assert.match(styles, /\.virtual-markdown-section\.continues-list/, 'Preserve list visual continuity');
assert.match(pipeline, /continuations: boolean\[\]/);
assert.match(worker, /firstLines, continuations/);
const editor = read('src/components/MarkdownEditor.tsx');
const app = read('src/App.tsx');
assert.match(editor, /view\.lineBlockAtHeight\(height\)/,
  'Scroll positions must use the physical viewport rather than the overscanned document range.');
assert.match(editor, /block\.from\)\.number \+ fraction/,
  'Wrapped logical lines need fractional progress for continuous scroll syncing.');
assert.doesNotMatch(editor, /view\.viewport\.from/,
  'Overscanned viewport positions must not determine the visible top line.');
assert.match(app, /if \(kind === 'scroll'\) \{[\s\S]*?dispatchPreviewPosition\(\)/,
  'Editor scroll is already frame-throttled and should not incur a second frame.');
assert.match(preview, /if \(latest\.kind === 'scroll'\) \{/,
  'Virtualized preview must process pre-throttled scroll events without an extra frame.');
assert.match(preview, /settleWhenMounted/,
  'Off-screen virtual chunks need a mount retry before precise anchor alignment.');
assert.match(styles, /\.editor-area:not\(\.compact\) \.cm-sizer \{ flex:1 1 0%; width:100%; min-width:0; \}/,
  'The desktop CodeMirror sizer must fill the writing pane for a centered column.');
assert.match(styles, /\.editor-area:not\(\.compact\) \.cm-content \{ width:100%; max-width:880px; margin-inline:auto; \}/,
  'Text must use a centered, bounded writing measure on desktop.');
console.log('Long-document scrolling tests passed:', {
  sourceChars: dense.length, windows: sections.length,
  splitMilliseconds: Number(elapsed.toFixed(2)),
  sourcePreserved: true,
});
