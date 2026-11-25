import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const app = read('src/App.tsx');
const store = read('src/lib/store.ts');
const css = read('src/styles.css');
const player = read('src/components/HtmlPlayPage.tsx');
const host = read('src/lib/siteHosting.ts');
const htmlDialog = read('src/components/HtmlSiteDialog.tsx');
const design = read('design.md');

// Deleting a page directly uses the existing guarded removal path.
assert.doesNotMatch(app, /<DialogFrame id="delete-dialog"/);
assert.match(app, /void deleteTarget\(\{ kind: 'document', id \}\)/);
assert.match(app, /deletionsInFlight\.current\.has\(operationKey\)/);
assert.match(app, /setDocs\(remaining\);[\s\S]*?await Promise\.all\(\[[\s\S]*?revokeCloudShare/,
  'Page deletion should update the UI before cloud revocation.');
assert.match(app, /setWorkspaces\(remainingWorkspaces\);[\s\S]*?await Promise\.all\(pendingWrites\)/,
  'Workspace should disappear before queued saves finish.');
assert.match(app, /await removeWorkspaceTree\(id, deletedDocs\.map/,
  'Workspace deletion should use a batch atomic transaction.');
assert.match(store, /db\.transaction\(\['documents', 'folders', 'workspaces'\], 'readwrite'\)/,
  'All workspace keys must be removed in one IndexedDB transaction.');
assert.match(store, /tx\.onabort = \(\) => reject/,
  'Failed atomic deletes must reject, not silently remove half a workspace.');
assert.match(app, /setWorkspaces\(previousWorkspaces\);[\s\S]*?setFolders\(previousFolders\)/,
  'A failed workspace deletion must visibly restore the original workspace.');
assert.match(app, /live\.current\.set\(doc\.id, doc\);[\s\S]*?setDocs\(\[\.\.\.live\.current\.values\(\)\]\)/,
  'A failed page deletion must restore the original data.');

// Native fullscreen requires user activation on refresh. Persist intent and
// show an accurate restore action rather than claiming to be fullscreen.
assert.match(player, /FULLSCREEN_INTENT = 'flow\.html-player\.fullscreen\.v1'/);
assert.match(player, /document\.addEventListener\('fullscreenchange', onFullscreenChange\)/);
assert.match(player, /await document\.exitFullscreen\(\)/,
  'The fullscreen button must support exit.');
assert.match(player, /await document\.documentElement\.requestFullscreen\(\)/,
  'The fullscreen button must support re-entry from a user gesture.');
assert.match(player, /nativeFullscreen \? 'Exit fullscreen' : resumeFullscreen \? 'Resume fullscreen' : 'Fullscreen'/);
assert.match(player, /sessionStorage\.setItem\(FULLSCREEN_INTENT, '1'\)/);
assert.match(player, /window\.addEventListener\('beforeunload', onLeaving\)/);

// All dialog edits must be ID-scoped, not applied to the HTML/FPS player.
const idx = css.indexOf('/* Delete and share dialogs: one deep-neutral');
assert.ok(idx >= 0, 'Delete/share styling must have one identifiable dedicated section.');
const scoped = css.slice(idx);
assert.match(scoped, /#delete-dialog\.flow-dialog \{[\s\S]*?background:#080809;[\s\S]*?border:0;/);
assert.match(scoped, /#delete-dialog \.flow-dialog-header \{[\s\S]*?border:0;/);
assert.match(scoped, /#delete-dialog \.flow-dialog-footer \{[\s\S]*?border:0;/);
assert.match(scoped, /#delete-dialog \.flow-dialog-file \{[\s\S]*?background:#121214;[\s\S]*?border:0;/);
assert.match(scoped, /#share-dialog \.flow-dialog-link \.flow-dialog-button,[\s\S]*?padding-inline:20px/);
assert.match(scoped, /#share-dialog \.flow-dialog-footer \.flow-dialog-neutral,[\s\S]*?padding-inline:22px/);
assert.doesNotMatch(scoped, /\.html-play-(?:panel|compact|chrome|page|toggle)/,
  'Delete/share styling must not modify the FPS controller.');

// Cached client state is not evidence that the remote site actually exists.
assert.match(host, /export async function verifyHostedHtml/);
assert.match(host, /'&status=1'/);
assert.match(htmlDialog, /setVerified\(false\)/);
assert.match(htmlDialog, /publishHtml\(latest!\)/,
  'Preexisting legacy links should upgrade even when user shares from Write mode.');
assert.match(design, /A globally sequential/);
// Normal-weight, borderless controls should win the final cascade.
const polished = css.slice(css.indexOf('/* Hosted/share modal polish:'));
assert.ok(polished.startsWith('/* Hosted/share modal polish:'),
  'Share-dialog polish must be placed after legacy dialog rules.');
assert.match(polished, /#html-site-dialog \.flow-dialog-heading h2,[\s\S]*?font-weight:450;/);
assert.match(polished, /#html-site-dialog \.flow-dialog-file-text strong,[\s\S]*?font-weight:450;/);
assert.match(polished, /#html-site-dialog \.flow-dialog-button,[\s\S]*?font-weight:450;/);
assert.match(polished, /#html-site-dialog \.flow-dialog-link \.flow-dialog-button,[\s\S]*?padding:0 20px;/);
assert.match(polished, /#html-site-dialog \.flow-dialog-footer \.flow-dialog-neutral,[\s\S]*?padding:0 21px;/);
assert.doesNotMatch(polished, /\.html-play-(?:panel|compact|chrome|page|toggle)/,
  'Share dialog polish must never style runtime FPS controls.');
assert.match(htmlDialog, /if \(next\.syncedVersion === doc!\.updatedAt\)/,
  'A committed small page must immediately transition to Live.');
assert.doesNotMatch(htmlDialog, /queueSiteSync\(doc!, true, true\)/,
  'A completed small publish must not trigger an immediate second upload.');
assert.match(host, /return ready \? existing : \{ \.\.\.existing, syncedVersion: 0 \};/,
  'A broken public route cannot be treated as Live by an old cached timestamp.');

console.log('Delete batching, rollback, dialogs, server readiness and fullscreen state checks passed.');
