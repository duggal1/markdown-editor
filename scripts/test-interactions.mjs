import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
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
assert.match(css, /\.save-prefix\s*\{[\s\S]*?border-radius:1px; background:var\(--flow-accent\);/);
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
assert.match(css, /\.export-button\[aria-busy='true'\] \{ opacity:1; cursor:progress; color:#ffffff; \}/,
  'Exporting text must turn white during PDF generation.');
assert.match(css, /\.export-button\[aria-busy='true'\] \.pixel-save-loader i \{ background:#ffffff; \}/,
  'The Exporting animation must use white pixels rather than the orange Save indicator.');
assert.match(app, /className="export-button"\s*title="Export page" aria-label="Export page"/,
  'The mobile icon-only Export button needs an accessible name');
assert.match(css, /\.topbar \.draw-entry > \.pixel-huge-icon,\s*\.topbar \.export-button > \.pixel-huge-icon\s*\{\s*display:inline-flex!important;/,
  'Mobile must not hide native Hugeicons wrappers inside Draw and Export');
assert.match(css, /\.save-indicator\[data-save-state='saving'\]\s*\{\s*flex:0 0 48px;/,
  'A mobile Saving indicator must not displace the page title');
assert.match(css, /:root:not\(\[data-theme='light'\]\) ::selection \{ background:#56565652; \}/,
  'Native text selection in dark mode should have a quieter contrast.');
assert.match(css, /:root:not\(\[data-theme='light'\]\) \.cm-focused \.cm-selectionBackground \{ background:#62626255 !important; \}/,
  'CodeMirror text selection should be visibly darker without changing light mode.');

const main = read('src/main.tsx');
const store = read('src/lib/store.ts');
const accentSource = read('src/lib/accentTheme.ts');
const accentModule = { exports: {} };
runInNewContext(ts.transpileModule(accentSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module: accentModule,
  exports: accentModule.exports,
  document: { documentElement: { dataset: {} } },
});
const { ACCENT_THEMES, DEFAULT_ACCENT, parseAccentTheme, applyAccentTheme } = accentModule.exports;
assert.equal(ACCENT_THEMES.length, 8, 'Accent picker should expose eight curated options.');
assert.equal(DEFAULT_ACCENT, 'orange', 'Orange remains the default theme.');
assert.equal(parseAccentTheme('sky'), 'sky');
assert.equal(parseAccentTheme('purple'), 'purple');
assert.equal(parseAccentTheme('unknown'), 'orange', 'Invalid preferences must fall back safely.');
assert.equal(parseAccentTheme(null), 'orange');
assert.equal(applyAccentTheme('teal'), 'teal');

assert.match(store, /accentTheme\?: AccentTheme/, 'Existing saved preferences must allow the accent key.');
assert.match(main, /applyAccentTheme\(savedAppearance\.accentTheme\)/,
  'Draw and Flow must restore the same palette before mounting.');
assert.match(app, /setAccentTheme\(parseAccentTheme\(prefs\.accentTheme\)\)/,
  'The editor must restore the chosen accent.');
assert.match(app, /savePrefs\(\{ theme, accentTheme, mode/,
  'The palette must survive reloads.');
assert.match(app, /className="accent-theme-trigger"/,
  'A theme picker belongs in the top navigation.');
assert.match(app, /role="menuitemradio" aria-checked=\{option\.id === accentTheme\}/,
  'Palette choices must expose the selected state to assistive technology.');
assert.match(app, /onKeyDown=\{onAccentMenuKeyDown\}/,
  'The theme menu must support arrow-key navigation.');
assert.match(app, /setAccentTheme\(option\.id\)/,
  'Selecting a palette must actually update app state.');
assert.match(css, /:root\[data-theme='light'\] \{ --accent:var\(--accent-500\); \}/,
  'Light mode should use shade 500.');
assert.match(css, /--accent:var\(--accent-600\);/,
  'Dark mode should use shade 600.');
for (const { id } of ACCENT_THEMES) {
  assert.match(css, new RegExp('--palette-' + id + '-600: oklch\\('));
  assert.match(css, new RegExp('--palette-' + id + '-500: oklch\\('));
}
assert.match(css, /--flow-accent: var\(--accent\)/,
  'Buttons and branding must use the active palette.');
assert.match(css, /--blue: var\(--accent\)/,
  'Editor links must use the active palette.');
assert.match(css, /background:var\(--flow-accent\); opacity:\.18;/,
  'Save progress pixels must follow the active palette.');
assert.match(drawCss, /--draw-accent: var\(--flow-accent\)/,
  'Draw should share the same accent preference.');
assert.match(css, /\.topbar \.accent-theme-trigger\s*\{\s*grid-row:1; grid-column:5;/,
  'The mobile header must reserve a real accent trigger, not overflow.');
assert.match(css, /\.accent-theme-menu \{/,
  'Theme menu must have a dedicated styled surface.');
console.log('Motion, five-second save status, iOS geometry and preview cache checks passed.');
