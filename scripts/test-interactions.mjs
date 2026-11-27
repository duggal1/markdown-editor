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
assert.match(tree, /className="private-add-child"/);
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
const faviconLink = { rel: 'icon', href: '', type: '' };
const faviconDocument = { documentElement: { dataset: {} }, querySelector: () => faviconLink };
runInNewContext(ts.transpileModule(accentSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module: accentModule,
  exports: accentModule.exports,
  document: faviconDocument,
});
const { ACCENT_THEMES, DEFAULT_ACCENT, parseAccentTheme, applyAccentTheme } = accentModule.exports;
assert.equal(ACCENT_THEMES.length, 9, 'Accent picker includes true blue alongside sky and indigo.');
assert.equal(parseAccentTheme('blue'), 'blue');
assert.equal(applyAccentTheme('blue'), 'blue');
assert.match(decodeURIComponent(faviconLink.href), /#2563eb/);
assert.doesNotMatch(css, /data-background='blue'/);
assert.match(app, /\(\['dark', 'light'\] as const\)\.map/);
const previewColors = read('src/lib/previewColors.ts');
assert.match(preview, /rehypePlugins=\{\[rehypeRaw, \[rehypeSanitize, safeMarkdownHtml\], rehypePreviewColors, rehypeTaskRows\]\}/);
assert.doesNotMatch(preview, /attachPreviewColorPicker|onEditColor/);
assert.doesNotMatch(app, /onEditColor/);
const hexMapping = { exports: {} };
runInNewContext(ts.transpileModule(read('src/lib/hexColor.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: hexMapping, exports: hexMapping.exports });
const previewColorModule = { exports: {} };
runInNewContext(ts.transpileModule(previewColors, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module: previewColorModule, exports: previewColorModule.exports,
  require: () => hexMapping.exports,
});
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { default: ReactMarkdown } = await import('react-markdown');
const { default: remarkGfm } = await import('remark-gfm');
const { default: rehypeRaw } = await import('rehype-raw');
const { default: rehypeSanitize } = await import('rehype-sanitize');
const colorDocument = '# Colors\n\nOrange #FF8A30, repeat #FF8A30.\n\n| Ink | Shade | Base | Hot |\n| --- | --- | --- | --- |\n| Orange | #C2410C | #EA580C | #FB923C |\n| Sky | #0369A1 | #0284C7 | #38BDF8 |\n| Black | ' + String.fromCharCode(96) + '#000000' + String.fromCharCode(96) + ' | #abcd | #12345678 |\n';
const renderedColors = renderToStaticMarkup(createElement(ReactMarkdown, {
  remarkPlugins: [remarkGfm],
  rehypePlugins: [rehypeRaw, rehypeSanitize, previewColorModule.exports.rehypePreviewColors],
  children: colorDocument,
}));
for (const literal of ['#FF8A30', '#C2410C', '#EA580C', '#FB923C', '#0369A1', '#0284C7', '#38BDF8', '#000000', '#abcd', '#12345678']) {
  assert.ok(renderedColors.includes('background-color:' + literal), 'Actual inline background required: ' + literal);
}
assert.equal((renderedColors.match(/class="flow-preview-swatch"/g) || []).length, 11);
assert.equal((renderedColors.match(/background-color:#FF8A30/g) || []).length, 2);
assert.doesNotMatch(renderedColors, /data-flow-from|role="button"|type="color"/);
const outline = read('src/components/PageOutline.tsx');
assert.doesNotMatch(app, /id="outline-dialog"|onClick=\{openOutline\}/);
assert.doesNotMatch(css, /#outline-dialog/);
assert.match(app, /<PageOutline[\s\S]*?onJump=\{jumpToHeading\}/);
assert.match(css, /\.page-outline-rail\s*\{[\s\S]*?left:5px; top:50%; transform:translateY\(-50%\)/);
assert.match(outline, /onPointerEnter=/);
assert.match(outline, /onPointerLeave=\{leave\}/);
assert.match(outline, /\{mounted && <div[\s\S]*?inert=\{!open\}/);
assert.match(css, /\.page-outline-panel\[data-open='true'\]/);
assert.match(css, /\.page-outline-hover\s*\{[\s\S]*?transition:transform 210ms/);
assert.match(app, /cancelHeadingMotion\(\)/);
const scrollModule = { exports: {} };
let frameId = 0, time = 0;
const frames = new Map();
const scroll = { scrollTop: 0, scrollHeight: 10000, clientHeight: 500 };
let reduced = false;
runInNewContext(ts.transpileModule(read('src/lib/scrollMotion.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module: scrollModule, exports: scrollModule.exports,
  performance: { now: () => time },
  window: { matchMedia: () => ({ matches: reduced }) },
  requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
  cancelAnimationFrame: id => frames.delete(id),
});
const { navigationEase, navigationDuration, navigateScroll, cancelNavigation } = scrollModule.exports;
assert.equal(navigationEase(0), 0);
assert.equal(navigationEase(1), 1);
assert.equal(navigationEase(.5), .5);
assert.ok(navigationDuration(10000, 500) <= 980);
function advance(dt) {
  time += dt;
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach(cb => cb(time));
}
navigateScroll(scroll, 450, true);
assert.equal(frames.size, 1);
navigateScroll(scroll, 450, true);
assert.equal(frames.size, 1);
advance(100);
assert.ok(scroll.scrollTop > 0 && scroll.scrollTop < 450);
cancelNavigation(scroll);
const stopped = scroll.scrollTop;
advance(500);
assert.equal(scroll.scrollTop, stopped);
navigateScroll(scroll, 900, true);
for (let i = 0; i < 100; i++) advance(1000 / 90);
assert.equal(scroll.scrollTop, 900);
assert.equal(frames.size, 0);
navigateScroll(scroll, 9000, true, true);
assert.equal(scroll.scrollTop, 8375);
for (let i = 0; i < 100; i++) advance(1000 / 60);
assert.equal(scroll.scrollTop, 9000);
navigateScroll(scroll, 0, true);
advance(16);
navigateScroll(scroll, 300, false);
assert.equal(scroll.scrollTop, 300);
assert.equal(frames.size, 0);
reduced = true;
navigateScroll(scroll, 500, true);
assert.equal(scroll.scrollTop, 500);
assert.equal(frames.size, 0);
assert.match(outline, /onJump\(item\.line\)/);
assert.match(outline, /if \(!entries\.length\) return null/);
const outlineModule = { exports: {} };
runInNewContext(ts.transpileModule(read('src/lib/outline.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: outlineModule, exports: outlineModule.exports });
const { documentOutline, activeOutlineIndex, outlineMarkers } = outlineModule.exports;
const headings = documentOutline('# Title\n\n## Second\n\n~~~js\n# not a heading\n~~~\n### Third');
assert.equal(headings.length, 3);
assert.equal(headings[2].line, 8);
assert.equal(activeOutlineIndex(headings, 5), 1);
assert.equal(activeOutlineIndex(headings, 0), -1);
const long = documentOutline(Array.from({ length: 400 }, (_, i) => '## Heading ' + i).join('\n'));
assert.equal(long.length, 400);
assert.equal(outlineMarkers(long).length, 12);
assert.equal(outlineMarkers(long)[11].line, 400);
assert.equal(DEFAULT_ACCENT, 'blue', 'Blue is the default accent for new workspaces.');
assert.equal(parseAccentTheme('sky'), 'sky');
assert.equal(parseAccentTheme('purple'), 'purple');
assert.equal(parseAccentTheme('unknown'), 'blue', 'Invalid preferences must fall back to blue safely.');
assert.equal(parseAccentTheme(null), 'blue');
assert.equal(applyAccentTheme('teal'), 'teal');
assert.match(decodeURIComponent(faviconLink.href), /#0d9488/, 'The favicon must follow the selected accent.');
assert.equal(faviconDocument.documentElement.dataset.accent, 'teal');

assert.match(store, /accentTheme\?: AccentTheme/, 'Existing saved preferences must allow the accent key.');
assert.match(main, /applyAccentTheme\(savedAppearance\.accentTheme\)/,
  'Draw and Flow must restore the same palette before mounting.');
assert.match(app, /setAccentTheme\(parseAccentTheme\(prefs\.accentTheme\)\)/,
  'The editor must restore the chosen accent.');
assert.match(app, /savePrefs\(\{ theme, accentTheme, mode/,
  'The palette must survive reloads.');
assert.doesNotMatch(app, /className="accent-theme-trigger"/);
assert.match(app, /<DialogFrame id="settings-dialog"/);
assert.match(app, /aria-pressed=\{option.id === accentTheme\}/);
assert.match(app, /setAccentTheme\(option\.id\)/);
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
assert.match(tree, /export default memo\(WorkspaceTree\)/, 'The file tree must not re-render on unrelated editor state');
assert.match(app, /useTreeActions\(/, 'Tree events use stable callback identities');
assert.match(app, /localSaveDelay\(doc\.markdown\.length, now - firstDirty\)/, 'Continuous editing has a bounded local save delay');
const shareDialogSource = read('src/components/ShareDialog.tsx');
assert.match(shareDialogSource, /className="share-copy-idle">Copy link/);
assert.match(shareDialogSource, /className="share-copy-success"><Icon name="check"/);
assert.match(css, /\.share-access \{[^}]*align-items:start/);
assert.match(css, /\.share-revoke:is\(:hover,:focus-visible\):not\(:disabled\) \{[^}]*text-decoration:underline dotted/);
assert.match(app, /setSettingsOpen\(true\)\}><Icon name="sliders"/);
assert.match(css, /\.share-url-row input \{[^}]*color:var\(--share-url\)[^}]*'Geist Variable',sans-serif[^}]*-webkit-font-smoothing:antialiased/);
assert.doesNotMatch(css, /\.share-url-row input \{[^}]*var\(--mono\)/);
assert.match(shareDialogSource, /className="share-consent-control"[\s\S]*?type="checkbox"[\s\S]*?className="share-consent-mark"[\s\S]*?name="check"/);
assert.match(css, /\.share-consent-control input:focus-visible \+ \.share-consent-mark/);
assert.match(css, /--share-control:#202020;\s*--share-control-hover:#151515/);
assert.match(css, /--share-control:#e8e8e8;\s*--share-control-hover:#f5f5f5/);
// Reconciled clipboard fallback from the original sharing PR. Keep the
// current compact layout and require an actual successful copy before feedback.
assert.match(shareDialogSource, /if \(!link \|\| busy\) return/);
assert.match(shareDialogSource, /navigator\.clipboard\?\.writeText/);
assert.match(shareDialogSource, /input\.select\(\);\s*try \{ successful = document\.execCommand\('copy'\); \}/);
assert.match(shareDialogSource, /if \(!successful\) \{[\s\S]*?return;\s*\}[\s\S]*?setCopied\(true\)/);
assert.match(shareDialogSource, /ref=\{linkInputRef\} data-dialog-initial-focus/);

// A clean page visit must not trigger another write; recovered/edited copies are not committed by identity.
const perfStore = read('src/lib/store.ts');
assert.match(perfStore, /const committedDocuments = new WeakSet<object>\(\)/);
assert.match(perfStore, /tx\.oncomplete = \(\) => \{\s*if \(store === 'documents'\) committedDocuments\.add\(value\)/);
assert.match(app, /if \(isLocallyCommitted\(doc\) && !saveQueue\.current\.has\(id\)\) return;/);
assert.match(app, /if \(doc && !isLocallyCommitted\(doc\)\) saveRecovery\(doc\)/);
assert.match(read('src/workers/search.ts'), /const batchSize = 4;[\s\S]*?await Promise\.all\(documents\.slice/);
