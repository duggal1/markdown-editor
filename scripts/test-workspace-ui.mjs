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
const { touchRecent, finishVisit, restoreRecent, rankDocuments } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const docs = Array.from({ length: 45 }, (_, i) => ({ id: String(i), updatedAt: i }));
let history = [];
for (const doc of docs) history = touchRecent(history, doc.id);
assert.equal(history.length, 45);
history = touchRecent(history, '0');
assert.equal(rankDocuments(docs, history)[0].id, '0');
assert.equal(touchRecent(history, '0'), history);
assert.deepEqual(restoreRecent(['4', '4', 'missing', 2], [docs[0], docs[4]]), ['4', '0']);
assert.deepEqual(rankDocuments(docs.slice(0, 3), []).map(doc => doc.id), ['2', '1', '0']);
assert.match(tree, /className="workspace-root" role="treeitem"/);
assert.match(tree, /tree\.roots\.map\(doc => row\(doc, 1\)\)/);
assert.match(tree, /tree\.topLevelFolders\.map\(folder =>/);
assert.match(tree, /branchRank\(child\.id\)/);
assert.match(app, /rankDocuments\(docs, recentIds\)/);
assert.match(app, /finishVisit\(ids, previous, id, live.current.has\(previous\)\)/);
assert.doesNotMatch(app, /touchRecent\(/);
assert.doesNotMatch(app, /setRecentIds[^\n]*slice\(0, 30\)/);
console.log('Global workspace root and durable recency ranking passed.');

const stable = ['2', '1', '0'];
assert.equal(finishVisit(stable, '0', '0', true), stable);
assert.equal(finishVisit(stable, '0', '2', false), stable);
assert.deepEqual(finishVisit(stable, '0', '2', true), ['0', '2', '1']);
assert.deepEqual(rankDocuments([{...docs[0], updatedAt: 999}, docs[1], docs[2]], stable).map(doc => doc.id), stable);
const draftJs = ts.transpileModule(read('src/lib/emptyDraft.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { canExpireDraft, sameEmptyDraft, EMPTY_DRAFT_IDLE_MS } = await import('data:text/javascript;base64,' + Buffer.from(draftJs).toString('base64'));
const draft = { id: 'draft', title: 'Untitled', titleAuto: true, markdown: '', workspaceId: 'w', createdAt: 1, updatedAt: 1 };
assert.equal(EMPTY_DRAFT_IDLE_MS, 30000);
assert.equal(canExpireDraft(draft, 'other', [draft], false), true);
assert.equal(canExpireDraft(draft, 'draft', [draft], false), false);
assert.equal(canExpireDraft(draft, 'other', [draft], true), false);
assert.equal(canExpireDraft(draft, 'other', [draft, {...draft, id: 'child', parentId: 'draft'}], false), false);
for (const patch of [{markdown:' '}, {markdown:'a'}, {titleAuto:false}, {title:'Notes'}, {fileName:'Untitled.md'}, {asset:new Blob(['x'])}, {fileType:'text'}]) {
  assert.equal(canExpireDraft({...draft,...patch}, 'other', [draft], false), false);
}
assert.equal(sameEmptyDraft(draft, draft), true);
assert.equal(sameEmptyDraft({...draft, updatedAt: 2}, draft), false);
assert.equal(sameEmptyDraft({...draft, markdown: 'saved elsewhere'}, draft), false);
assert.match(app, /Date.now\(\) \+ EMPTY_DRAFT_IDLE_MS/);
assert.match(app, /removeEmptyDraft\(doc\)/);
assert.match(read('src/lib/store.ts'), /sameEmptyDraft\(current, expected\)/);
console.log('Departure-only recency and protected empty-draft eligibility passed.');

 // Verify sibling folder rendering is outside the protected root, while
 // documents stay scoped to their persisted folder ID.
const rootStart = tree.indexOf('<div className="workspace-root"');
const folderStart = tree.indexOf('tree.topLevelFolders.map(folder =>');
assert.ok(folderStart > 0 && folderStart < rootStart);
assert.match(tree.slice(folderStart, rootStart), /workspace-sibling-folder/);
assert.match(tree.slice(folderStart, rootStart), /tree\.children\.get\('folder:' \+ folder\.id\)/);
assert.match(tree.slice(folderStart, rootStart), /row\(doc, 1\)/);
assert.doesNotMatch(tree.slice(rootStart), /topLevelFolders\.map/);
assert.match(tree.slice(rootStart), /tree\.roots\.map/);
assert.match(tree, /onNewDocument\(folder\.workspaceId, folder\.id\)/);
assert.match(tree, /onDrop=\{e => dropped\(e, undefined, folder\.id\)\}/);
assert.match(app, /const targetFolder = parent \? parent\.folderId : folder\?\.id/);
assert.match(app, /setFolders\(items => \[\.\.\.items, folder\]\);\s*setQuery\(''\);\s*setNewFolderId\(folder\.id\)/);
console.log('Top-level sibling folder hierarchy and explicit destination routing passed.');
