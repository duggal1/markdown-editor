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

const codeModule = { exports: {} };
runInNewContext(transpile('src/lib/code.ts'), {
  module: codeModule, exports: codeModule.exports,
  require: () => ({ looksLikeHtml: () => false }),
});

const pipeline = { exports: {} };
runInNewContext(transpile('src/lib/previewPipeline.ts'), {
  module: pipeline, exports: pipeline.exports,
  require: (name) => {
    if (name === './previewChunks') return chunks.exports;
    if (name === './code') return codeModule.exports;
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
  'Preview accents and table surfaces must have a separate light theme.');
// Approved borderless table direction: one set of table rules, no grid strokes.
assert.doesNotMatch(css, /--preview-table-border/);
const tableRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([,selector]) => /\.markdown-preview\s+(?:\.table-scroll|table\b|thead\b|tbody\b|th\b|td\b|tr\b)/.test(selector));
for (const [, selector, declarations] of tableRules) {
  assert.doesNotMatch(declarations, /(?:^|;)\s*border(?:-(?:top|right|bottom|left|width|color|style)(?:-\w+)?)?\s*:\s*(?!0(?:\s|;|$)|none(?:\s|;|$))[^;]+/, 'No decorative table border: ' + selector.trim());
}
assert.match(css, /\.markdown-preview \.table-scroll \{[^}]*border:0;[^}]*box-shadow:none;[^}]*border-radius:10px/);
assert.match(css, /\.markdown-preview th, \.markdown-preview td \{[^}]*border:0;[^}]*box-shadow:none/);
assert.match(css, /\.markdown-preview tbody tr:nth-child\(even\) \{ background:var\(--preview-table-stripe\); \}/);
assert.match(css, /\.markdown-preview tbody tr:hover \{ background:var\(--preview-table-hover\); \}/);
const darkTable = css.match(/\.markdown-preview \{\s*--preview-orange:[^}]+\}/)[0];
const lightTable = css.match(/:root\[data-theme='light'\] \.markdown-preview \{\s*--preview-orange:[^}]+\}/)[0];
const tone = (block, name) => parseInt(block.match(new RegExp('--preview-table-' + name + ':#([a-f0-9]{6})'))[1], 16);
for (const resting of ['surface', 'stripe']) {
  assert.ok(tone(darkTable, 'hover') < tone(darkTable, resting), 'Dark hover must darken resting rows');
  assert.ok(tone(lightTable, 'hover') > tone(lightTable, resting), 'Light hover must lighten resting rows');
}
assert.match(css, /@media\(prefers-reduced-motion:reduce\) \{\s*\.markdown-preview tbody tr \{ transition:none; \}/);

console.log('Preview worker preparation, line indexes and bounded cache tests passed.');


const hexModule = { exports: {} };
runInNewContext(transpile('src/lib/hexColor.ts'), { module: hexModule, exports: hexModule.exports });
const { hexPattern, normalizeHex, hexToHsv, hsvToHex } = hexModule.exports;
assert.equal(normalizeHex('#AbC'), '#aabbcc');
assert.equal(normalizeHex('#1234'), '#11223344');
assert.equal(normalizeHex('#12345'), null);
assert.deepEqual(Array.from('fill="#abc" stroke="#11223344" #12345 #abcdefghi'.matchAll(hexPattern), m => m[0]), ['#abc', '#11223344']);
for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#123456', '#000000', '#ffffff', '#bbaacc80']) {
  const { h, s, v, a } = hexToHsv(hex);
  assert.equal(hsvToHex(h, s, v, hex.length === 9 ? a : undefined), hex);
}
assert.equal(codeModule.exports.detectRawCode('<svg/>'), 'svg');
assert.equal(codeModule.exports.detectRawCode('<?xml version="1.0"?><svg><style>rect{fill:#abc}</style></svg>'), 'svg');
const svgMarkdown = ('Paragraph\n\n').repeat(1800) + '<svg>\n\n' + '  <rect fill="#123456"/>\n\n'.repeat(300) + '</svg>\n\nAfter.';
const svgSections = buildPreviewSections(svgMarkdown).chunks;
assert.equal(svgSections.join(''), svgMarkdown);
assert.equal(svgSections.findIndex(c => c.includes('<svg>')), svgSections.findIndex(c => c.includes('</svg>')));
console.log('SVG classification, chunk integrity, hex validation and HSV round trips passed.');
const previewSource = readFileSync(new URL('../src/components/MarkdownPreview.tsx', import.meta.url), 'utf8');
const svgSource = readFileSync(new URL('../src/lib/svgPreview.ts', import.meta.url), 'utf8');
assert.match(previewSource, /if \(isSvgCode\(code, rawLanguage\)\) return <SvgCanvas source=\{code\} line=\{line\} \/>/);
assert.match(previewSource, /: svg\s*\? <article className="markdown-preview preview-is-svg"><SvgCanvas source=\{value\} \/>/);
assert.doesNotMatch(previewSource, /svgDocument &&/);
const inspector = readFileSync(new URL('../src/components/SvgInspector.tsx', import.meta.url), 'utf8');
assert.match(inspector, /title="SVG preview" sandbox=""/);
assert.match(inspector, /exportSvgPng\(actual, effectiveTheme, background, scale\)/);
assert.match(inspector, /onEdit\(next\)/);
assert.match(svgSource, /root\.hasAttribute\('color'\)/);
assert.match(svgSource, /namespaceURI === SVG_NS/);
assert.doesNotMatch(svgSource, /repeating-conic-gradient/);

const paletteModule = { exports: {} };
runInNewContext(transpile('src/lib/svgPalette.ts'), { module: paletteModule, exports: paletteModule.exports,
  require: name => { if (name === './hexColor') return hexModule.exports; throw new Error(name); } });
const { svgPalette, replaceSvgColor, locateSvgSource } = paletteModule.exports;
const art = '<svg viewBox="0 0 100 50"><style>#abc { fill: #abc; stroke: red !important; --paint: #abc; }</style><path id="abc" fill="#aabbcc" stroke="url(#abc)" d="M 0 0"/><rect style="fill:#abc;stroke:none"/><stop stop-color="#1234"/><!-- fill="#abc" --></svg>';
const palette = svgPalette(art, v => v === 'red' ? '#ff0000' : null);
assert.equal(palette.length, 3);
assert.equal(palette[0].hex, '#aabbcc');
assert.equal(palette[0].count, 4);
const recolored = replaceSvgColor(art, palette[0], '#123456');
assert.ok(recolored.includes('#abc { fill: #123456; stroke: red !important; --paint: #123456; }'));
assert.ok(recolored.includes('id="abc" fill="#123456" stroke="url(#abc)"'));
assert.ok(recolored.includes('<!-- fill="#abc" -->'));
assert.equal(replaceSvgColor(art.replace('fill: #abc','fill: #999'), palette[0], '#123456'), art.replace('fill: #abc','fill: #999'));
const fenced = 'Title\n\n' + '\x60\x60\x60svg\n' + art + '\n' + '\x60\x60\x60';
assert.equal(locateSvgSource(fenced, art, 3), fenced.indexOf(art));
assert.equal(locateSvgSource(fenced, art, 1), -1);
assert.equal(locateSvgSource(art, art, 1), 0);
const svgModule = { exports: {} };
runInNewContext(transpile('src/lib/svgPreview.ts'), { module: svgModule, exports: svgModule.exports });
const { svgDimensions } = svgModule.exports;
assert.equal(svgDimensions(null,null,'0 0 100 50').width, 100);
assert.equal(svgDimensions('200',null,'0 0 100 50').height, 100);
assert.equal(svgDimensions('1in','2in',null).width, 96);
assert.equal(svgDimensions('100%','100%','0 0 24 24').height, 24);
assert.match(svgSource, /canvas\.toBlob/);
assert.match(svgSource, /32_000_000/);
console.log('SVG palette source ranges, dimensions and PNG export wiring passed.');

const dynamicArt = '<svg fill="currentColor"><path stroke="currentColor" fill="#171717"/><style>path { color: currentColor; fill: var(--paint); }</style></svg>';
const dynamicColors = svgPalette(dynamicArt, () => null);
assert.equal(dynamicColors.length, 2, 'Inherited references must not merge with identical literal colors');
assert.equal(dynamicColors[0].token, 'currentColor');
assert.equal(dynamicColors[0].count, 3);
assert.equal(replaceSvgColor(dynamicArt, dynamicColors[0], '#112233'), '<svg fill="#112233"><path stroke="#112233" fill="#171717"/><style>path { color: #112233; fill: var(--paint); }</style></svg>');
{
const mixed = '# Batch API\n\n'+ '\x60\x60\x60sql\nconst [page, total] = await db.batch([\n  db.$count(products),\n\x60\x60\x60\n\n], { isolation: "repeatable read" });\n\n## Metrics\n\nconst response = await db.batch([\ndb.$count(products),\n], { metrics: "us" });\nconsole.log(response.metrics.total);\n\n- [ ] Task stays mapped';
const fixed = buildPreviewSections(mixed);
assert.match(fixed.chunks.join(''), /\x60{3}javascript\nconst \[page, total\][\s\S]*?\], \{ isolation: "repeatable read" \}\);\n\x60{3}/);
assert.ok(fixed.sourceLineMaps);
const taskIndex = fixed.chunks[0].split('\n').findIndex(line=>line.includes('Task stays mapped'));
assert.equal(fixed.sourceLineMaps[0][taskIndex],mixed.split('\n').length);
assert.equal(buildPreviewSections(fixed.chunks.join('')).sourceLineMaps,undefined,'Repair is idempotent');
const longMixed = ('## Intro\n\nA normal paragraph remains untouched.\n\n').repeat(600)+mixed;
const longFixed=buildPreviewSections(longMixed);
assert.ok(longFixed.chunks.length>1);
const repairedChunk=longFixed.chunks.find(chunk=>chunk.includes('const [page, total]'));
assert.ok(repairedChunk.includes('isolation: "repeatable read"'));
assert.match(css,/--code-bg:#111111/);
assert.doesNotMatch(css,/\.markdown-preview \.code-language,/);
assert.match(previewSource,/function CodeLanguageLabel/);
assert.match(previewSource,/label: 'JavaScript', icon: 'fileJs'/);
assert.match(previewSource,/label: 'TypeScript', icon: 'fileTs'/);
}
