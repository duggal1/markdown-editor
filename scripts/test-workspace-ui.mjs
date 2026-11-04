import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const tree = read('src/components/WorkspaceTree.tsx');
const treeCss = read('src/components/workspace-tree.css');
const app = read('src/App.tsx');
const style = read('src/styles.css');

// Quick-create belongs to the workspace, not to a hidden global bottom action.
assert.match(tree, /className="filetree-add-page"/);
assert.match(tree, /aria-label=\{'Add page to ' \+ ws\.name\}/);
assert.match(tree, /onClick=\{event => \{ event\.stopPropagation\(\); onNewDocument\(ws\.id\); \}\}/);
assert.match(tree, /\{more\('workspace', ws\.id, ws\.name\)\}/);
assert.ok(tree.indexOf('className="filetree-add-page"') < tree.indexOf("{more('workspace', ws.id, ws.name)}"));
assert.match(tree, /New folder/);
assert.doesNotMatch(tree, /New document/);

// The new page must become visible even when its workspace is collapsed
// or when a search filter was active.
assert.match(app, /setExpandedIds\(ids => ids\.includes\(target\) \? ids : \[\.\.\.ids, target\]\)/);
assert.match(app, /setQuery\(''\);\s*selectDocument\(doc\.id\)/);
assert.match(app, /Add page<\/button>/);
assert.match(treeCss, /\.filetree-root:hover \.filetree-add-page/);
assert.match(treeCss, /\.filetree-root:focus-within \.filetree-add-page/);
assert.match(treeCss, /@media \(hover:none\)[^\n]*\.filetree-add-page/);

// Toast has a neutral surface, accessible close action, and a reduced-motion
// exit, without the previous inverted white panel / artificial drop shadow.
assert.match(style, /\.notice \{[\s\S]*?background:#1b1b1b; color:#ededed;/);
assert.match(style, /\.notice \{[\s\S]*?border:0; border-radius:10px; box-shadow:none;/);
assert.match(style, /:root\[data-theme='light'\] \.notice \{ background:#e6e6e6;/);
assert.match(app, /<AnimatePresence initial=\{false\}>\s*\{notice && <motion\.div/);
assert.match(app, /aria-label="Dismiss message"/);
console.log('Workspace quick-add and neutral toast regression checks passed.');
