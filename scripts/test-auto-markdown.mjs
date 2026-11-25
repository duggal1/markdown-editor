import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// The formatter is pure; run its actual TypeScript implementation in Node.
const original = readFileSync(new URL('../src/lib/autoMarkdown.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(original, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const codeModule = { exports: {} };
const codeSource = readFileSync(new URL('../src/lib/code.ts', import.meta.url), 'utf8');
runInNewContext(ts.transpileModule(codeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  module: codeModule, exports: codeModule.exports,
  require: name => { if (name === './htmlPreview') return { looksLikeHtml: () => false }; throw new Error(name); },
});
const module = { exports: {} };
runInNewContext(js, {
  module, exports: module.exports,
  require: (name) => {
    if (name === './code') return codeModule.exports;
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
assert.doesNotMatch(app, /className="auto-markdown-button"/);
assert.match(readFileSync(new URL('../src/components/MarkdownEditor.tsx', import.meta.url), 'utf8'), /shouldAutoFormatPaste\(text\)/);
assert.match(app, /onMouseDown=\{event => event.preventDefault\(\)\}/, 'Toolbar must preserve editor selection when clicked.');
assert.match(app, /lineAt\(range.from\).from/, 'Selection formatting must work on complete Markdown lines.');
assert.match(app, /range.to === endLineStart/, 'A selection ending at the next line start must not alter that line.');
assert.match(app, /view\.state\.doc !== originalDocument/, 'Async results must not overwrite newer typing.');
assert.match(app, /onClick=\{\(\) => \{ void autoFormatDocument\(\); \}\}/);
assert.match(app, /aria-busy=\{autoFormatting\}/, 'Formatting must show a visible loading state.');
assert.match(action, /WORKER_THRESHOLD = 50_000/);
assert.match(action, /new Worker\(/, 'Long document formatting should not block the editor.');
assert.match(worker, /formatMarkdownDocument\(event\.data\.source, event\.data\.options\)/);


const drizzle = [
  'Batch API',
  'These methods are available on the Drizzle Postgres driver (drizzle-orm/postgres).',
  '',
  'Method\tUse it to\tOn failure',
  'batch\tCommit together\tRolls back the batch',
  'pipeline\tSend queries on one connection\tOther queries can commit',
  'Batch',
  'db.batch() runs all statements in one transaction. If the insert fails, PostgreSQL rolls back the stock update.',
  '',
  "const sku = 'usb-c-cable';",
  'const quantity = 20;',
  'const response = await db.batch([',
  '  db.update(products)',
  '    .set({ stock: 20 })',
  '    .where(eq(products.sku, sku))',
  '    .returning({ stock: products.stock }),',
  '  db.insert(stockReceipts).values({ id: "receipt-1042", sku, quantity }),',
  ']);',
  'console.log(response[0]); // result',
  '',
  'The driver sends the batch in one round trip and returns results in input order.',
  '',
  'Pipeline',
  'db.pipeline() sends queries back-to-back on one connection.',
  '',
  'const [usb, hdmi] = await db.pipeline([',
  '  db.$count(products),',
  ']);',
  "if (usb.status === 'rejected') console.error(usb.reason);",
  '',
  'Each query returns a settled result in input order.',
].join('\n');
const { detectRawCode } = codeModule.exports;
const { shouldAutoFormatPaste } = module.exports;
assert.equal(detectRawCode(drizzle), null, 'Mixed docs are not standalone JavaScript');
assert.equal(shouldAutoFormatPaste(drizzle), true);
const converted = format(drizzle);
assert.match(converted, /^# Batch API\n/);
assert.match(converted, /\| Method \| Use it to \| On failure \|\n\| --- \| --- \| --- \|/);
assert.match(converted, /^## Pipeline$/m);
const snippets = [...converted.matchAll(/\x60{3}javascript\n([\s\S]*?)\n\x60{3}/g)].map(match => match[1]);
assert.equal(snippets.length, 2, 'Only two code blocks, not surrounding documentation');
assert.equal(snippets[0], drizzle.slice(drizzle.indexOf('const sku'), drizzle.indexOf('\n\nThe driver')));
assert.equal(snippets[1], drizzle.slice(drizzle.indexOf('const [usb'), drizzle.indexOf('\n\nEach query')));
assert.equal(detectRawCode(converted), null);
assert.equal(format(converted), converted, 'Mixed-document normalization is idempotent');
const standalone = 'const quantity = 20;\nconsole.log(quantity);';
assert.equal(detectRawCode(standalone), 'javascript');
assert.equal(format(standalone), standalone);
assert.equal(shouldAutoFormatPaste(standalone), false);
assert.equal(detectRawCode('import SwiftUI\nstruct Home: View {\n var body: some View { Text("Hello") }\n}'), 'swift');
assert.equal(detectRawCode('def hello():\n    print("Hi")\n'), 'python');
assert.equal(detectRawCode('SELECT id FROM products;'), 'sql');

console.log('Auto Markdown regression cases passed.');
const { repairMixedCode } = codeModule.exports;
const fence = '\x60\x60\x60';
const isolation = [ 'const [page, total] = await db.batch([', '  db.select().from(products).orderBy(products.sku).limit(25),', '  db.$count(products),', "], { isolation: 'repeatable read', readOnly: true });" ];
const metrics = [ 'const response = await db.batch([', 'db.$count(products),', 'db.$count(stockReceipts),', "], { metrics: 'us' });", 'console.log(response.metrics.total, response.metrics.roundTrips);' ];
const bulk = [ 'const updated = await db.bulkUpdate(products, [', "  { sku: 'usb-c-hub', name: 'USB-C Hub', stock: 40 },", "  { sku: 'usb-c-adapter', name: 'USB-C Adapter', stock: 75 },", "  { sku: 'usb-c-charger', name: 'USB-C Charger', stock: 12 },", '], { by: products.sku });', 'console.log(updated.rowCount); // 2 when the charger SKU is missing' ];
const broken = ['# Batch API','','## Isolation','','Use isolation to control which changes from other transactions each query can see.','',fence+'sql',...isolation.slice(0,-1),fence,'',isolation.at(-1),'','Set readOnly: true to run a read-only transaction.','','## Metrics','','Set metrics to measure the batch.','',...metrics,'','Use metrics: true for fractional milliseconds.','','## bulkUpdate','',fence+'javascript',...bulk.slice(0,4),fence,'',...bulk.slice(4),'','Unmatched keys are skipped.'].join('\n');
const normalized = repairMixedCode(broken).markdown;
const actualBlocks = [...normalized.matchAll(/\x60{3}javascript\n([\s\S]*?)\n\x60{3}/g)].map(m=>m[1]);
assert.equal(actualBlocks.length,3);
assert.equal(actualBlocks[0],isolation.join('\n'));
assert.equal(actualBlocks[1],metrics.join('\n'));
assert.equal(actualBlocks[2],bulk.join('\n'));
assert.ok(normalized.includes('Set readOnly: true to run a read-only transaction.'));
assert.ok(normalized.includes('Unmatched keys are skipped.'));
assert.equal(repairMixedCode(normalized).markdown,normalized);
const correctSql = '# SQL\n\n'+fence+'sql\nSELECT id FROM products;\n'+fence+'\n\nUse the result.';
assert.equal(repairMixedCode(correctSql).markdown,correctSql);
const intentionalPartial = '# Example\n\n'+fence+'javascript\nconst data = [\n'+fence+'\n\nThis is intentionally incomplete.';
assert.equal(repairMixedCode(intentionalPartial).markdown,intentionalPartial);
const ordinary = '# Docs\n\nUse db.batch() to run statements.\n\n- const example = 42;\n\nA normal sentence.';
assert.equal(repairMixedCode(ordinary).markdown,ordinary);
assert.equal(repairMixedCode('# Prose\n\nconst text is a reserved word in this explanation.').markdown,'# Prose\n\nconst text is a reserved word in this explanation.');
