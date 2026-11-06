import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// The formatter is pure; run its actual TypeScript implementation in Node.
const original = readFileSync(new URL('../src/lib/autoMarkdown.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(original, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
runInNewContext(js, {
  module, exports: module.exports,
  require: (name) => {
    if (name === './code') return { detectRawCode: () => null };
    throw new Error('Unexpected module: ' + name);
  },
});
const { formatPlainTextAsMarkdown: format, formatMarkdownDocument } = module.exports;

const example = [
  '## Screen Studio Core Features',
  '',
  'These are essential professional features for product demos.',
  '',
  'Focus & Zoom',
  '',
  'Automatic Zoom — Detects clicks and important actions during recording.',
  '',
  'Manual Zoom — Ability to add and precisely position custom zooms on the timeline.',
  '',
  'Smart Framing — Keeps the webcam clear of the cursor.',
  '',
  '6.5× Real-time Upscaler — Local AI preserves text sharpness.',
  '',
  'Camera & Layouts',
  '',
  'Multiple Layouts — Fullscreen camera, split screen, or camera overlay.',
].join('\n');

const formatted = format(example);
assert.ok(formatted.startsWith('## Screen Studio Core Features'));
assert.match(formatted, /### Focus & Zoom/);
assert.match(formatted, /### Camera & Layouts/);
assert.match(formatted, /- \*\*Automatic Zoom\*\* — Detects clicks/);
assert.match(formatted, /- \*\*Manual Zoom\*\* — Ability to add/);
assert.match(formatted, /- \*\*6\.5× Real-time Upscaler\*\* — Local AI/);
assert.match(formatted, /- \*\*Multiple Layouts\*\* — Fullscreen/);
assert.doesNotMatch(formatted, /Zoom\.\n\n- \*\*Smart Framing/);
assert.equal(format(formatted), formatted, 'Formatting twice must not rewrite its own output');

const code = '## Example\n\n```swift\nAutomatic Zoom — Do not format inside a code block.\nManual Zoom — Keep the exact code.\n```';
assert.ok(format(code).includes('Automatic Zoom — Do not format inside a code block.'));
assert.ok(!format(code).includes('**Automatic Zoom**'));
const ordinary = 'A description — not necessarily a feature.\n\nAnother sentence.';
assert.ok(!format(ordinary).includes('- **A description**'));

const composed = [
  '## Architecture',
  'The first paragraph explains the implementation.',
  '',
  '| Parameter | Default |',
  '| --- | --- |',
  '| latency | low |',
  '',
  '```swift',
  '# This is code, not a Markdown heading',
  'print("Ready")',
  '```',
].join('\n');
const polished = formatMarkdownDocument(composed);
assert.match(polished, /^## Architecture\n\nThe first paragraph/);
assert.ok(polished.includes('| Parameter | Default |\n| --- | --- |\n| latency | low |'),
  'Manual formatting must not change GFM table cells.');
assert.ok(polished.includes('```swift\n# This is code, not a Markdown heading\nprint("Ready")\n```'),
  'Manual formatting must preserve fenced code byte-for-byte.');
assert.equal(formatMarkdownDocument(polished), polished, 'Manual action must be idempotent.');
assert.ok(!formatMarkdownDocument('### Head\nParagraph', { atDocumentStart: false }).startsWith('# #'),
  'Formatting a selection must not promote its heading to a document title.');

// The screenshot failure: selected long requirements previously produced no Markdown.
const selectedParagraph = [
  'So that must include motion blur, smooth cursor, and click effects. We need to use Apple Swift for this, because we are already using Swift. Apple latest Swift UI component, like liquid glass, and smooth motion blur.',
  '',
  'We need to have a little component for this and extremely smooth. Right? Yeah. The motion blur, smooth cursor, and click effects.',
].join('\n');
const selectedFormatted = formatMarkdownDocument(selectedParagraph, { atDocumentStart: false, selection: true });
assert.match(selectedFormatted, /^- So that must include motion blur/m,
  'Selected requirements must become Markdown bullets rather than reporting no changes.');
assert.match(selectedFormatted, /^- We need to use Apple Swift/m);
assert.ok(selectedFormatted.includes('Right? Yeah.'), 'Formatting must not delete short sentences.');
assert.equal(formatMarkdownDocument(selectedFormatted, { atDocumentStart: false, selection: true }), selectedFormatted,
  'Selected prose formatting must be idempotent.');

const sections = formatMarkdownDocument('Feature Request 2\n\n2/ Glass Loupe or Motion Blur\n\nCursor & Motion\n\nSmooth Cursor — Raw paths are smoothed for natural movement.', { atDocumentStart: false, selection: true });
assert.match(sections, /^## Feature Request 2/m);
assert.match(sections, /^### 2\/ Glass Loupe or Motion Blur/m);
assert.match(sections, /^### Cursor & Motion/m);
assert.match(sections, /- \*\*Smooth Cursor\*\* — Raw paths/);
assert.equal(formatMarkdownDocument(sections, { atDocumentStart: false, selection: true }), sections);

const hardWrapped = formatMarkdownDocument('We need a stable pipeline that processes the complete document correctly.\nIt should always preserve every single sentence in its original wording.', { atDocumentStart: false, selection: true });
assert.match(hardWrapped, /correctly\.\n\nIt should/, 'Independent long lines should become distinct paragraphs.');
const protectedText = formatMarkdownDocument('## Notes\n\n| A | B |\n| - | - |\n\n- Existing bullet\n\n```swift\nlet x = 1\n```', { atDocumentStart: false, selection: true });
assert.match(protectedText, /\| A \| B \|\n\| - \| - \|/);
assert.match(protectedText, /- Existing bullet/);
assert.match(protectedText, /```swift\nlet x = 1\n```/);

const long = 'Long plan\n\n' + Array.from({ length: 3600 }, (_, i) =>
  'Feature ' + i + ' — Explain the important production behavior and required acceptance test for this step.'
).join('\n');
assert.ok(long.length > 180_000, 'Large-document regression must exceed the old action limit.');
assert.equal(format(long), long, 'Automatic paste formatting retains its 180 KB safety guard.');
const longFormatted = formatMarkdownDocument(long);
assert.ok(longFormatted.startsWith('# Long plan'), 'Manual action should work on larger plans.');
assert.ok(longFormatted.includes('- **Feature 3599** — Explain the important production behavior'),
  'Manual action must reach the end of a large document.');
assert.equal(formatMarkdownDocument(longFormatted), longFormatted);

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const action = readFileSync(new URL('../src/lib/autoMarkdownAction.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/workers/autoMarkdown.ts', import.meta.url), 'utf8');
assert.match(app, /await formatMarkdownAction\(source, \{ atDocumentStart: !selected && from === 0, selection: selected \}\)/);
assert.match(app, /onMouseDown=\{event => event.preventDefault\(\)\}/, 'Toolbar must preserve editor selection when clicked.');
assert.match(app, /lineAt\(range.from\).from/, 'Selection formatting must work on complete Markdown lines.');
assert.match(app, /range.to === endLineStart/, 'A selection ending at the next line start must not alter that line.');
assert.match(app, /view\.state\.doc !== originalDocument/, 'Async results must not overwrite newer typing.');
assert.match(app, /onClick=\{\(\) => \{ void autoFormatDocument\(\); \}\}/);
assert.match(app, /aria-busy=\{autoFormatting\}/, 'Formatting must show a visible loading state.');
assert.match(action, /WORKER_THRESHOLD = 50_000/);
assert.match(action, /new Worker\(/, 'Long document formatting should not block the editor.');
assert.match(worker, /formatMarkdownDocument\(event\.data\.source, event\.data\.options\)/);

console.log('Auto Markdown regression cases passed.');
