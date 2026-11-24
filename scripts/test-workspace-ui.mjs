import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const tree = read('src/components/WorkspaceTree.tsx');
const treeCss = read('src/components/workspace-tree.css');
const app = read('src/App.tsx');
const style = read('src/styles.css');
const dialog = read('src/components/DialogFrame.tsx');
const share = read('src/components/ShareDialog.tsx');

// One private tree; workspace IDs remain a persistence detail.
assert.match(tree, /'Private'/);
assert.match(tree, /aria-label="New page"/);
assert.match(tree, /Add subpage/);
assert.match(tree, /Move to root/);
assert.doesNotMatch(tree, /New workspace/);
assert.match(tree, /onMovePage\(id, parentId, folderId\)/);
assert.match(tree, /seen\.has\(ancestor\.id\)/);
assert.match(app, /setQuery\(''\);\s*selectDocument\(doc\.id\)/);
assert.match(app, /A page cannot contain itself or its ancestors/);
assert.match(treeCss, /\.private-page-row:hover \.private-add-child/);
assert.match(treeCss, /\.private-tree > \* \{ flex:0 0 auto;/);
assert.match(app, /className="private-page-title"/);
assert.match(app, /className="private-visibility"/);
const slash = read('src/lib/blockCommands.ts');
assert.match(slash, /Heading /);
assert.match(slash, /To-do list/);
assert.match(slash, /key: 'ArrowDown'/);
assert.match(slash, /key: 'Escape'/);
assert.match(slash, /userEvent: 'move.drop'/);
assert.match(slash, /drag.doc !== this.view.state.doc/);
assert.doesNotMatch(app, /className="auto-markdown-button"/);
assert.match(app, /className="copy-all-button"/);
assert.match(app, /setSidebarOpen\(!window\.matchMedia/);

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
