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
const { touchRecent, finishVisit, restoreRecent, sortWorkspaceDocuments } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const docs = Array.from({ length: 45 }, (_, i) => ({ id: String(i), updatedAt: i }));
let history = [];
for (const doc of docs) history = touchRecent(history, doc.id);
assert.equal(history.length, 45);
history = touchRecent(history, '0');
assert.deepEqual(sortWorkspaceDocuments(docs.map(doc => ({...doc, createdAt:doc.updatedAt}))).map(doc => doc.id), docs.map(doc => doc.id));
assert.equal(touchRecent(history, '0'), history);
assert.deepEqual(restoreRecent(['4', '4', 'missing', 2], [docs[0], docs[4]]), ['4', '0']);
assert.deepEqual(sortWorkspaceDocuments(docs.slice(0, 3)).map(doc => doc.id), ['0', '1', '2']);
assert.match(tree, /className="workspace-root" role="treeitem"/);
assert.match(tree, /tree\.roots\.map\(doc => row\(doc, 1\)\)/);
assert.match(tree, /tree\.topLevelFolders\.map\(folder =>/);
assert.doesNotMatch(tree, /branchRank/);
assert.match(app, /sortWorkspaceDocuments\(docs\)/);
assert.match(app, /finishVisit\(ids, previous, id, live.current.has\(previous\)\)/);
assert.doesNotMatch(app, /touchRecent\(/);
assert.doesNotMatch(app, /setRecentIds[^\n]*slice\(0, 30\)/);
console.log('Global workspace root and stable creation order passed.');

const stable = ['2', '1', '0'];
assert.equal(finishVisit(stable, '0', '0', true), stable);
assert.equal(finishVisit(stable, '0', '2', false), stable);
assert.deepEqual(finishVisit(stable, '0', '2', true), ['0', '2', '1']);
assert.deepEqual(sortWorkspaceDocuments([{...docs[0], createdAt:0, updatedAt:999}, {...docs[1],createdAt:1}, {...docs[2],createdAt:2}]).map(doc => doc.id), ['0','1','2']);
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
console.log('Previous-page history and protected empty-draft eligibility passed.');

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

assert.match(tree, /className="workspace-sibling-folder" role="treeitem" aria-level=\{1\}/);
assert.match(tree, /className="workspace-root" role="treeitem" aria-level=\{1\}/);
assert.match(tree, /filetree-result-path/);
assert.doesNotMatch(app, /rankDocuments\(/);

// Recovery snapshots are per document and do not supersede a newer revision.
const persistence = read('src/lib/store.ts');
assert.match(persistence, /RECOVERY_PREFIX \+ doc\.id/);
assert.match(persistence, /newestDocument\(stored, readJson<FlowDocument>\(FALLBACK \+ id\), readRecoveryFor\(id\)\)/);
assert.match(persistence, /current\.updatedAt <= throughUpdatedAt/);
assert.match(app, /clearRecovery\(id, doc\.updatedAt\)/);

// Exercise disclosure persistence using the actual helper and an isolated storage.
const disclosureJs = ts.transpileModule(read('src/lib/treeDisclosure.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { WORKSPACE_ROOT, TREE_DISCLOSURE_KEY, readClosedTree, writeClosedTree, toggleTreeNode, expandTreeNodes, pageRevealPath } = await import('data:text/javascript;base64,' + Buffer.from(disclosureJs).toString('base64'));
const storageData = new Map();
const storage = { getItem: k => storageData.get(k) ?? null, setItem: (k,v) => storageData.set(k,v) };
assert.equal(readClosedTree(storage).size, 0);
let closed = toggleTreeNode(readClosedTree(storage), WORKSPACE_ROOT);
closed = toggleTreeNode(closed, 'html-folder');
closed = toggleTreeNode(closed, 'parent-page');
writeClosedTree(closed, storage);
assert.deepEqual([...readClosedTree(storage)], [WORKSPACE_ROOT, 'html-folder', 'parent-page']);
const pages = new Map([['root-page',{id:'root-page'}],['parent-page',{id:'parent-page',folderId:'html-folder'}],['child-page',{id:'child-page',parentId:'parent-page'}]]);
const folders = new Set(['html-folder']);
assert.deepEqual(pageRevealPath('child-page', pages, folders), ['parent-page','html-folder']);
assert.deepEqual([...expandTreeNodes(closed, pageRevealPath('child-page', pages, folders))], [WORKSPACE_ROOT]);
assert.deepEqual([...expandTreeNodes(closed, pageRevealPath('root-page', pages, folders))], ['html-folder','parent-page']);
assert.equal(expandTreeNodes(closed, ['unrelated']), closed);
assert.equal(pageRevealPath('missing', pages, folders), undefined);
writeClosedTree(toggleTreeNode(readClosedTree(storage), WORKSPACE_ROOT), storage);
assert.equal(readClosedTree(storage).has(WORKSPACE_ROOT), false);
storage.setItem(TREE_DISCLOSURE_KEY, '{broken');
assert.equal(readClosedTree(storage).size, 0);
storage.setItem(TREE_DISCLOSURE_KEY, JSON.stringify([null, 1, '', 'a', 'a']));
assert.deepEqual([...readClosedTree(storage)], ['a']);
assert.equal(readClosedTree({getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}}).size,0);
assert.doesNotThrow(() => writeClosedTree(closed,{getItem(){return null},setItem(){throw Error('blocked')}}));
assert.match(tree, /useState<Set<string>>\(\(\) => readClosedTree\(\)\)/);
assert.match(tree, /writeClosedTree\(next\);\s*setClosed\(next\)/);
assert.match(tree, /if \(!reveal \|\| lastReveal\.current === reveal\) return/);
assert.doesNotMatch(tree, /\}, \[activeId(?:, byId)?\]\)/);
assert.match(app, /setActiveId\(first\.id\);\s*setWorkspaceId/);
assert.match(app, /setActiveId\(id\);\s*setTreeReveal\(\{ id \}\)/);
assert.match(app, /reveal=\{treeReveal\}/);
console.log('Persistent workspace, folder and subpage disclosure passed.');

assert.match(app, /const \[selectedFolderId, setSelectedFolderId\] = useState<string \| null>\(null\)/);
assert.match(app, /makeDocument\(folder\?\.workspaceId \|\| workspaceId, folder\?\.id\)/);
assert.match(app, /className="private-new-page" onClick=\{createPageInSelection\}/);
assert.match(tree, /onClick=\{onNewPageInSelection\}/);
assert.match(tree, /onSelectFolder\(folder\.id\); toggle\(folder\.id\)/);
assert.match(tree, /onSelectFolder\(null\); toggle\(ROOT\)/);
assert.match(app, /setSelectedFolderId\(doc\.folderId \|\| null\)/);
assert.match(app, /<LivePageTitle key=\{active\.id\} title=\{active\.title/);
assert.match(app, /if \(value\.trim\(\)\) onRename\(value\.trim\(\)\)/);
assert.match(treeCss, /--tree-menu-hover:#171717/);
assert.match(treeCss, /transition:background-color 65ms ease-out/);

assert.match(style, /\.private-visibility:has\(\.private-visibility-label\) \{ color:var\(--palette-blue-600\); \}/);
assert.match(style, /\.private-visibility-label \{ color:inherit; text-decoration:none; \}/);
assert.match(style, /\.private-workspace \.private-visibility \{ position:absolute; left:50%; top:50%; transform:translate\(-50%,-50%\)/);
assert.match(treeCss, /\.private-menu-label \{ color:var\(--palette-blue-600\); \}/);
assert.match(treeCss, /\.private-menu-label > span:last-child \{ color:inherit; text-decoration:none; \}/);

const startupJs = ts.transpileModule(read('src/lib/startupRecovery.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { startupRecoveryMode } = await import('data:text/javascript;base64,' + Buffer.from(startupJs).toString('base64'));
assert.equal(startupRecoveryMode(12, 1, false, false, false), 'none');
assert.equal(startupRecoveryMode(12, 1, true, false, false), 'background', 'One missing backup entry must not block opening local pages');
assert.equal(startupRecoveryMode(12, 1, true, true, false), 'blocking', 'Explicit key recovery must finish before editing');
assert.equal(startupRecoveryMode(0, 1, true, false, false), 'blocking');
assert.equal(startupRecoveryMode(12, 0, true, false, false), 'blocking');
assert.equal(startupRecoveryMode(12, 1, true, false, true), 'blocking');
assert.match(persistence, /if \(recovery === 'blocking'\) \{\s*try \{\s*const cloud = await restoreBackup\(\)/);
assert.match(persistence, /recoverMissing: recovery === 'background'/);
assert.match(persistence, /if \(request.result \|\| !canRecoverBackupEntry\(\{ kind, id: value.id \}\)\) return;/);
assert.match(persistence, /store.add\(value\)/, 'Background restore cannot overwrite a newer local record');
assert.match(app, /requestAnimationFrame\(\(\) => \{[\s\S]*?recoverMissingBackup\(/);
assert.match(app, /if \(!alive\) return;\s*if \(recovered.workspaces.length\)/);
assert.match(app, /recovered.documents.filter\(doc => !live.current.has\(doc.id\)\)/);
console.log('Local-first startup and non-destructive background recovery policy passed.');

assert.match(app, /const normalized = normalizeStartupDocument\(selected\)/);
assert.match(app, /const restored = data\.documents\.map\(doc => doc\.id === selected\.id \? normalized : doc\)/);
assert.match(app, /const deadline = performance\.now\(\) \+ 6/);
assert.match(app, /startupPending\.current\.delete\(id\)\) \{/);
assert.match(app, /if \(startupPending\.current\.size\) maintenanceTimer = window\.setTimeout\(repairInactive, 32\)/);
