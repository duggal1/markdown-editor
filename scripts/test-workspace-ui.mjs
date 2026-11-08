import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const tree = read('src/components/WorkspaceTree.tsx');
const treeCss = read('src/components/workspace-tree.css');
const app = read('src/App.tsx');
const style = read('src/styles.css');
const dialog = read('src/components/DialogFrame.tsx');
const share = read('src/components/ShareDialog.tsx');

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
assert.match(style, /\.notice \{[\s\S]*?background:#121212; color:#f0f0f0;/);
assert.match(style, /\.notice \{[\s\S]*?border:0; border-radius:10px; box-shadow:none;/);
assert.match(style, /:root\[data-theme='light'\] \.notice \{ background:#ffffff;/);
assert.match(app, /<AnimatePresence initial=\{false\}>\s*\{notice && <motion\.div/);
assert.match(app, /aria-label="Dismiss message"/);
// Both modals share the same native top-layer dialog, avoiding editor clipping
// and handling focus, Escape, and close controls without manual focus traps.
assert.match(dialog, /<dialog ref=\{ref\} className="flow-dialog"/);
assert.match(dialog, /dialog\.showModal\(\)/);
assert.match(dialog, /dialog\.querySelector<HTMLElement>/);
assert.match(dialog, /onCancel=\{event =>/);
assert.match(dialog, /if \(!busy\) onClose\(\)/);
assert.match(dialog, /createPortal\(/);
assert.match(share, /<DialogFrame id="share-dialog" title="Share page"/);
assert.match(share, /data-dialog-initial-focus/);
assert.match(share, /Upload to cloud/);
assert.match(share, /Stop sharing/);
assert.match(share, /void revoke\(\)/);
assert.match(app, /<DialogFrame id="delete-dialog"/);
assert.match(app, /void confirmDelete\(\)/);
assert.doesNotMatch(app, /className="delete-dialog"/);
assert.doesNotMatch(share, /className="share-dialog"/);
assert.match(style, /\.flow-dialog \{[\s\S]*?background:#0e0e10;/);
assert.match(style, /\.flow-dialog::backdrop/);
assert.match(style, /\.flow-dialog-footer \{/);
assert.doesNotMatch(style, /\.(?:dialog-backdrop|share-dialog|delete-dialog)\b/);

console.log('Workspace controls, toast and dark native dialogs passed.');
