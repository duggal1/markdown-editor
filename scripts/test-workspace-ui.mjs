import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

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
assert.doesNotMatch(app, /className="private-page-title"/);
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
assert.doesNotMatch(app, /<DialogFrame id="delete-dialog"/);
assert.match(app, /void deleteTarget\(\{ kind: 'document', id \}\)/);
assert.match(app, /<DialogFrame id="settings-dialog"/);
assert.doesNotMatch(app, /className="delete-dialog"/);
assert.doesNotMatch(share, /className="share-dialog"/);
assert.match(style, /\.flow-dialog \{[\s\S]*?background:#0e0e10;/);
assert.match(style, /\.flow-dialog::backdrop/);
assert.match(style, /\.flow-dialog-footer \{/);
assert.doesNotMatch(style, /\.(?:dialog-backdrop|share-dialog|delete-dialog)\b/);

console.log('Workspace controls, toast and dark native dialogs passed.');

// Exercise the actual ranking helper, including legacy preferences and >30 files.
const js = ts.transpileModule(read('src/lib/workspaceRecency.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { touchRecent, restoreRecent, rankDocuments } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const docs = Array.from({ length: 45 }, (_, i) => ({ id: String(i), updatedAt: i }));
let history = [];
for (const doc of docs) history = touchRecent(history, doc.id);
assert.equal(history.length, 45);
history = touchRecent(history, '0');
assert.equal(rankDocuments(docs, history)[0].id, '0');
assert.equal(touchRecent(history, '0'), history);
assert.deepEqual(restoreRecent(['4', '4', 'missing', 2], '0', new Set(['0', '4'])), ['0', '4']);
assert.deepEqual(rankDocuments(docs.slice(0, 3), []).map(doc => doc.id), ['2', '1', '0']);
assert.match(tree, /className="workspace-root" role="treeitem"/);
assert.match(tree, /tree\.entries\.map/);
assert.match(tree, /branchRank\(child\.id\)/);
assert.match(app, /rankDocuments\(docs, recentIds\)/);
assert.match(app, /setRecentIds\(ids => touchRecent\(ids, id\)\)/);
assert.doesNotMatch(app, /setRecentIds[^\n]*slice\(0, 30\)/);
console.log('Global workspace root and durable recency ranking passed.');
