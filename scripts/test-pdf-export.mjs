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
assert.deepEqual([...definition.pageMargins], [48, 48, 48, 42]);
assert.equal(definition.info.title, 'Lumen: Master Build Plan');
assert.equal(definition.defaultStyle.color, '#252525');
assert.equal(definition.styles.h1.fontSize, 27);
assert.equal(definition.styles.h2.fontSize, 16);
assert.equal(definition.styles.body.lineHeight, 1.36);
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
assert.equal(definition.styles.code.fontSize, 9);
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
assert.ok(JSON.stringify(buildPdfDefinition('[Home](https://example.com)', 'Link').content).includes('#205D9B'));
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
// Exercise the real browser font script registration path: the module
// must register against window.pdfMake without a public .vfs property.
const { runInNewContext } = await import('node:vm');
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
let registered = false;
runInNewContext(readFileSync(require.resolve('pdfmake/build/vfs_fonts.js'), 'utf8'), {
  window: { pdfMake: { addVirtualFileSystem(fonts) {
    assert.ok(fonts['Roboto-Regular.ttf']);
    lib.addVirtualFileSystem(fonts);
    registered = true;
  } } },
});
assert.equal(registered, true);
assert.doesNotMatch(exportCode, /pdfMake\.vfs\?/);

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

// Real PDF pagination regression: find the first spill into page two, then
// run the same bounded optimization path that production exports use.
const { inspectPdfTail, optimizePdfPagination } = await import('../src/lib/pdfPagination.ts');
const { getDocumentProxy } = await import('unpdf');
const fixture = count => '# Pagination fixture\n\n' + Array.from({length:count}, (_,i) => 'Section item ' + String(i+1).padStart(3,'0') + ' retains its content.').join('\n\n');
const render = async (source, density) => new Blob([await new Promise(resolve =>
  lib.createPdf(buildPdfDefinition(source,'Pagination fixture',new Map(),density)).getBuffer(resolve))], {type:'application/pdf'});
let lo = 2, hi = 100;
while (hi - lo > 1) {
  const mid = (lo + hi) >> 1;
  const stats = await inspectPdfTail(await render(fixture(mid),'balanced'),'balanced');
  if (stats.pages > 1) hi = mid; else lo = mid;
}
const overflowSource = fixture(hi);
const overflow = await render(overflowSource,'balanced');
const overflowStats = await inspectPdfTail(overflow,'balanced');
assert.equal(overflowStats.pages,2);
assert.ok(overflowStats.sparse, 'Boundary fixture must end on a sparse extra page');
let attempts = 0;
const compact = await optimizePdfPagination(async density => { attempts++; return density === 'balanced' ? overflow : render(overflowSource,density); });
assert.equal(attempts,2);
assert.equal((await inspectPdfTail(compact,'compact')).pages,1,'Compaction must eliminate the avoidable final page');
const readBody = async blob => {
  const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
  try {
    const pages = [];
    for(let page=1;page<=pdf.numPages;page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      pages.push(content.items.filter(x=>'str' in x).map(x=>x.str).join(' '));
    }
    return pages.join(' ');
  } finally { if (typeof pdf.destroy === 'function') await pdf.destroy(); else await pdf.cleanup?.(); }
};
const compactText = await readBody(compact);
for(let i=1;i<=hi;i++) assert.ok(compactText.includes('Section item ' + String(i).padStart(3,'0') + ' retains its content.'),'Missing item '+i);
const regular = await render(fixture(2),'balanced');
let ordinaryAttempts=0;
assert.equal(await optimizePdfPagination(async()=>{ ordinaryAttempts++; return regular; }),regular);
assert.equal(ordinaryAttempts,1);
assert.equal(await optimizePdfPagination(async density=>{if(density==='compact')throw Error('retry failure');return overflow;}),overflow);
console.log('Real PDF page count reduced from 2 to 1; every fixture item retained.');
{
const messy = '# Example\n\n\x60\x60\x60sql\nconst [a, b] = await db.batch([\n  db.$count(products),\n\x60\x60\x60\n\n], { readOnly: true });\n\nKeep this prose.';
const repairedTree = parsePdfMarkdown(messy);
const repairedBlock = repairedTree.children.find(node => node.type === 'code');
assert.equal(repairedBlock.lang,'javascript');
assert.ok(repairedBlock.value.endsWith('], { readOnly: true });'));
assert.ok(repairedTree.children.some(node=>node.type==='paragraph'&&node.children[0].value==='Keep this prose.'));
}
