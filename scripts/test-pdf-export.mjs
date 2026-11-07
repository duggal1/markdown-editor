import { strict as assert } from 'node:assert';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const { buildPdfDefinition, pdfImageUrls, parsePdfMarkdown, highlightedCode, buildPdfDefinitionFromTree } = await import('../src/lib/pdfDocument.ts');

const plan = [
  '# Lumen: Master Build Plan',
  '',
  'A precise, readable document with **strong emphasis**, _italics_, and a [source](https://example.com).',
  '',
  '## Architecture',
  '',
  '- Fast local rendering',
  '- Markdown **structure** retained',
  '  - Nested constraints',
  '- [x] Export is vector PDF',
  '- [ ] Verify print spacing',
  '',
  '### Implementation',
  '',
  '```swift',
  'import SwiftUI',
  'struct Example: View { var body: some View { Text("Hello") } }',
  '```',
  '',
  '| Phase | State | Notes |',
  '| :--- | :---: | ---: |',
  '| Design | Done | 100% |',
  '| Build | Active | 82% |',
  '',
  '> Evidence belongs with the conclusion.',
  '',
  '---',
  '',
  '![Reference](https://images.example.org/reference.png)',
].join('\n');

const definition = buildPdfDefinition(plan, 'Lumen: Master Build Plan');
assert.equal(definition.pageSize, 'A4');
assert.deepEqual([...definition.pageMargins], [58, 68, 58, 64]);
assert.equal(definition.info.title, 'Lumen: Master Build Plan');
assert.equal(definition.defaultStyle.color, '#303030');
assert.equal(definition.styles.h1.fontSize, 25);
assert.equal(definition.styles.h2.fontSize, 16);
assert.equal(definition.styles.body.lineHeight, 1.48);
const content = definition.content;
assert.ok(Array.isArray(content));
assert.ok(content.some(x => x.style === 'h1'));
assert.ok(content.some(x => x.style === 'h2'));
assert.ok(content.some(x => 'ul' in x));
assert.ok(content.some(x => x.table && x.table.headerRows === 1));
assert.ok(content.some(x => x.table && x.table.body?.[0]?.[0]?.stack?.some(y => y.style === 'code')));
assert.ok(content.some(x => x.canvas), 'Horizontal rule must be a vector line.');
assert.ok(content.some(x => x.table && x.layout && !x.table.headerRows),
  'Blockquote should use an inset, unobtrusive column.');
assert.ok(content.some(x => x.text && Array.isArray(x.text) &&
  x.text.some(y => y.link === 'https://images.example.org/reference.png')),
  'Unavailable external images must remain labeled links, not disappear.');
assert.equal(pdfImageUrls(plan)[0], 'https://images.example.org/reference.png');
assert.equal(parsePdfMarkdown('## Real heading').children[0].type, 'heading');
assert.ok(definition.footer(2, 12).stack[1].columns[1].text.includes('2 / 12'));
assert.ok(!JSON.stringify(content).includes('#ea580c'), 'The PDF should not inherit the orange UI accent.');

const many = '# Long Plan\n\n' + Array.from({length: 2100}, (_, i) =>
  '- **Task ' + (i+1) + '** Validate implementation, tests, data integrity and release notes.').join('\n');
const begin = performance.now();
const hugeDef = buildPdfDefinition(many, 'Long Plan');
const prepTime = performance.now() - begin;
assert.ok(Array.isArray(hugeDef.content) && hugeDef.content.length >= 2);
assert.equal(hugeDef.content[0].text?.[0]?.text || hugeDef.content[0].text?.[0], 'Long Plan');
assert.ok(hugeDef.content.some(x => 'ul' in x));
assert.equal(JSON.stringify(hugeDef).length > 0, true);

const codeDoc = buildPdfDefinition('```rust\nfn main() { println!("ready"); }\n```', 'Rust code');
assert.ok(codeDoc.content.some(x => x.table && x.table.body?.[0]?.[0]?.stack?.some(y=>y.style==='code')));
const rawSwift = buildPdfDefinition(
  'import SwiftUI\nstruct Sample: View { var body: some View { Text("Ready") } }', 'Swift code');
assert.ok(rawSwift.content.some(x => x.table && x.table.body?.[0]?.[0]?.stack?.some(y =>
  y.style === 'code' && (typeof y.text === 'string' ? y.text : y.text.map(part => typeof part === 'string' ? part : part.text).join('')).includes('import SwiftUI'))),
  'Raw Swift input must be rendered as an intact code block.');
assert.equal(definition.styles.code.fontSize, 8.8);
const imageData = new Map([['https://example.com/test.png', 'data:image/png;base64,aGVsbG8=']]);
const imageDoc = buildPdfDefinition('![Diagram](https://example.com/test.png)', 'Diagram', imageData);
assert.ok(imageDoc.content.some(x => x.image), 'Embedded PNG data should become a PDF image.');


const highlighted = highlightedCode('let answer = 42 // a note\nprint("hello")', 'swift');
assert.equal(highlighted.map(part => typeof part === 'string' ? part : part.text).join(''),
  'let answer = 42 // a note\nprint("hello")');
assert.ok(highlighted.some(part => part.color), 'PDF syntax highlight must contain colored text.');
const rawTree = parsePdfMarkdown('```swift\nlet answer = 42\n```');
const fromTree = buildPdfDefinitionFromTree(rawTree, 'Swift');
assert.ok(fromTree.content.some(block => block.table?.body?.[0]?.[0]?.stack?.some(x =>
  x.style === 'code' && x.text.some(y => y.color))), 'PDF must render token colors.');
assert.ok(JSON.stringify(buildPdfDefinition('[Home](https://example.com)', 'Link').content).includes('#B45309'));
const sourceApp = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const exportCode = readFileSync(new URL('../src/lib/pdfExport.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.match(sourceApp, /role="menu" aria-label="Export page as"/);
assert.match(sourceApp, /Export as PDF/);
assert.match(sourceApp, /void exportPdf\(current\)/);
assert.match(sourceApp, /await import\('\.\/lib\/pdfExport'\)/);
// Browser output must use unmodified, same-origin PDFMake UMD assets rather
// than Vite's transformed ESM wrappers. The latter can break in production.
assert.match(exportCode, /pdfmake\/build\/pdfmake\.js\?url/);
assert.match(exportCode, /pdfmake\/build\/vfs_fonts\.js\?url/);
assert.match(exportCode, /await loadClassicScript\(pdfMakeScriptUrl/);
assert.match(exportCode, /await loadClassicScript\(pdfFontsScriptUrl/);
assert.doesNotMatch(exportCode, /import\('pdfmake\/build\/pdfmake'\)/);
assert.match(exportCode, /pdfMake\.createPdf\(doc\)\.getBlob/);
assert.match(css, /\.flow-export-menu/);

// pdfmake smoke test: actually generate a real searchable-text PDF buffer.
const lib = (await import('pdfmake/build/pdfmake.js')).default;
const fonts = (await import('pdfmake/build/vfs_fonts.js')).default;
lib.addVirtualFileSystem(fonts);

const actual = await new Promise((resolve, reject) => {
  try {
    lib.createPdf(definition).getBuffer(buffer => resolve(buffer));
  } catch (error) { reject(error); }
});
assert.equal(Buffer.from(actual).subarray(0, 5).toString('ascii'), '%PDF-');
assert.ok(actual.length > 4000, 'PDF output must not be empty');
if (process.env.CI) {
  mkdirSync('test-artifacts', { recursive: true });
  writeFileSync('test-artifacts/pdf-style-review.pdf', Buffer.from(actual));
}
console.log('Styled PDF generation and page-spacing regression checks passed.', {
  samplePdfBytes: actual.length, longPlanCharacters: many.length,
  longPlanPreparationMs: +prepTime.toFixed(1),
});
