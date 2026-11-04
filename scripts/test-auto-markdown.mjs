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
const { formatPlainTextAsMarkdown: format } = module.exports;

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
console.log('Auto Markdown regression cases passed.');
