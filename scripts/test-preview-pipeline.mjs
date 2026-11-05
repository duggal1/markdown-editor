import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const transpile = (path) => ts.transpileModule(
  readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    .replace("new URL('../workers/preview.ts', import.meta.url)", "'test-worker'"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const chunks = { exports: {} };
runInNewContext(transpile('src/lib/previewChunks.ts'), {
  module: chunks, exports: chunks.exports,
});

const pipeline = { exports: {} };
runInNewContext(transpile('src/lib/previewPipeline.ts'), {
  module: pipeline, exports: pipeline.exports,
  require: (name) => {
    if (name === './previewChunks') return chunks.exports;
    throw new Error('Unexpected import ' + name);
  },
});
const { immediatePreview, cachedPreview, buildPreviewSections, preparePreview } = pipeline.exports;

const text = ('# Heading\n\nA small paragraph with enough text to test chunk boundaries.\n\n').repeat(470)
  + '\n```typescript\n' + 'const x = 123;\n'.repeat(900) + '```\n\nEnd.';
const prepared = immediatePreview(text);
assert.ok(prepared.chunks.length > 2, 'Large Markdown should be sectioned');
assert.equal(prepared.chunks.join(''), text, 'No source bytes lost between sections');
assert.equal(prepared.firstLines[0], 1);
assert.equal(prepared.chunks.length, prepared.firstLines.length);
assert.ok(prepared.firstLines.every((n, i) => i === 0 || n > prepared.firstLines[i - 1]));
assert.equal(cachedPreview(text), prepared, 'Second render must hit the section cache');
assert.equal(immediatePreview(text), prepared, 'Cached sections must reuse identity');
assert.equal(buildPreviewSections(text).chunks.join(''), text);
const startFence = prepared.chunks.findIndex(c => c.includes('```typescript'));
const endFence = prepared.chunks.findIndex(c => c.includes('const x = 123;'));
assert.equal(startFence, endFence, 'Fenced code must not be split from its opening fence');

for (let i = 0; i < 5; i++) immediatePreview('small-' + i);
assert.equal(cachedPreview(text), null, 'LRU entries must be evicted');
assert.equal((await preparePreview('hello\n\nworld')).chunks.join(''), 'hello\n\nworld');

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.match(css, /--preview-orange:var\(--accent-600\)/,
  'Dark preview should use the selected palette at shade 600.');
assert.match(css, /--preview-orange:var\(--accent-500\)/,
  'Light preview should use the selected palette at shade 500.');
assert.match(css, /--palette-orange-600: oklch\(64\.6% 0\.222 41\.116\)/,
  'Default dark mode must use Tailwind orange-600.');
assert.match(css, /--palette-orange-500: oklch\(70\.5% 0\.213 47\.604\)/,
  'Default light mode must use Tailwind orange-500.');
assert.match(css, /\.markdown-preview a,[\s\S]*?color:var\(--preview-orange\)/,
  'Preview links and badges must share the theme-specific orange.');
assert.match(css, /\.markdown-preview :not\(pre\) > code,[\s\S]*?\.markdown-preview \.hljs-number,[\s\S]*?color:var\(--preview-orange\)/,
  'Inline-code badges and orange syntax tokens must use the same Tailwind shade.');
assert.match(css, /:root\[data-theme='light'\] \.markdown-preview \{/,
  'Preview accents and table borders must have a separate light theme.');
assert.match(css, /--preview-table-border:#303030/,
  'Dark-mode table grid must be subtle but complete.');
assert.match(css, /--preview-table-border:#dedede/,
  'Light-mode table grid must remain visible and neutral.');
assert.match(css, /\.markdown-preview \.table-scroll \{[\s\S]*?border:1px solid var\(--preview-table-border\)/,
  'Tables require a complete outer border.');
assert.match(css, /\.markdown-preview th,\s*\.markdown-preview td \{[\s\S]*?border-right:1px solid var\(--preview-table-border\);[\s\S]*?border-bottom:1px solid var\(--preview-table-border\)/,
  'Table cells require vertical and horizontal dividers.');
assert.match(css, /\.markdown-preview table > :last-child > tr:last-child > :is\(th,td\) \{ border-bottom:0; \}/,
  'The outer border must not double up on the last row.');

console.log('Preview worker preparation, line indexes and bounded cache tests passed.');
