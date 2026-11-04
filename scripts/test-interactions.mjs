import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const app = read('src/App.tsx');
const draw = read('src/draw/DrawPage.tsx');
const tree = read('src/components/WorkspaceTree.tsx');
const css = read('src/styles.css');
const drawCss = read('src/draw/draw.css');
const preview = read('src/components/MarkdownPreview.tsx');
const pipeline = read('src/lib/previewPipeline.ts');

assert.match(app, /<NumberFlow value=\{saveDuration\}/, 'Saving should animate measured times');
assert.match(app, /performance\.now\(\) - started/, 'Saving should use real elapsed time');
assert.match(app, /\}, 5000\)/, 'Successful save should disappear after five seconds');
assert.match(app, /whileHover: compact \? undefined : \{ y: -1 \}/, 'No synthetic iOS hover');
assert.match(app, /filter: motionOff \|\| compact/, 'iOS sidebar must not run an expensive blur');
assert.match(app, /window\.requestAnimationFrame\(measure\)/, 'Viewport resize should be batched');
assert.match(draw, /hoverCapable = window\.matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)/);
assert.match(draw, /<motion\.button \{\.\.\.hoverMotion\} type="button" className="draw-button"/);
assert.match(tree, /<motion\.button \{\.\.\.interaction\} type="button" className="filetree-add-page"/);
assert.match(css, /\.save-prefix\s*\{[\s\S]*?border-radius:1px; background:#ea580c;/);
assert.match(css, /\.save-indicator\[data-save-state='saving'\] \.save-label/);
assert.match(css, /@media \(max-width:800px\)\s*\{\s*\.sidebar-inner \{ will-change:opacity,transform;/);
assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 38px 38px;/);
assert.match(css, /grid-template-rows: 51px 43px;/);
assert.match(drawCss, /\.draw-rail, \.draw-workspace \{ border-radius:11px;/);
assert.match(preview, /preparePreview\(markdown\)/);
assert.match(preview, /MAX_HIGHLIGHTS = 96/);
assert.match(pipeline, /const MAX_ENTRIES = 4/);
assert.match(css, /:root\[data-theme='light'\] \.notice \{ background:#ffffff; color:#181818; \}/);
assert.match(css, /background:#121212; color:#f0f0f0;/);
assert.match(css, /\.topbar\s*\{\s*grid-template-columns:minmax\(0,1fr\) 38px 38px 38px;/,
  'Mobile header must explicitly reserve Draw, Export and theme actions');
assert.match(css, /\.topbar \.draw-entry\s*\{[\s\S]*?grid-row:1; grid-column:2;/,
  'Draw must have an explicit mobile header grid position');
assert.match(css, /\.topbar \.export-button\s*\{[\s\S]*?grid-row:1; grid-column:3;/,
  'Export must have an explicit mobile header grid position');
assert.match(css, /\.topbar \.export-button\s*\{[\s\S]*?border-radius:7px;/,
  'Export must not inherit desktop pill rounding');
assert.match(css, /\.topbar \.theme-toggle\s*\{\s*grid-row:1; grid-column:4;/,
  'Theme must stay in the first row');
assert.match(app, /className="export-button"\s*title="Export page" aria-label="Export page"/,
  'The mobile icon-only Export button needs an accessible name');
console.log('Motion, five-second save status, iOS geometry and preview cache checks passed.');
