import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ChangeEvent, type DragEvent, type PointerEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { createPortal } from 'react-dom';
import NumberFlow from '@number-flow/react';
import type { EditorView } from '@codemirror/view';
import MarkdownEditor, { formatEditor } from './components/MarkdownEditor';
import { setTaskChecked, taskMarkerEdit } from './lib/taskList';
import WorkspaceTree from './components/WorkspaceTree';
import { finishVisit, sortWorkspaceDocuments, restoreRecent } from './lib/workspaceRecency';
import { canExpireDraft, EMPTY_DRAFT_IDLE_MS } from './lib/emptyDraft';
import { FlowMark, Icon, SuppliedIcon } from './components/Icons';
import { ACCENT_THEMES, applyAccentTheme, parseAccentTheme, type AccentTheme } from './lib/accentTheme';
import { downloadMarkdown } from './lib/document';
import ShareDialog from './components/ShareDialog';
import HtmlSiteDialog from './components/HtmlSiteDialog';
import DialogFrame from './components/DialogFrame';
import { backupStatus, backupScope, enableBackup, getRecoveryKey, recoverWithKey, resumeBackup, queueImportedHtmlBackup } from './lib/backup';
import { queueSharedSync, readShareRecord, revokeCloudShare } from './lib/sharing';
import { isHtmlPage, localHtmlUrl, queueSiteSync, readSiteRecord, revokeHtml } from './lib/siteHosting';
import { detectRawCode, isMarkdownFile, languageForFile, normalizeMixedContent } from './lib/code';
import { svgPreviewDocument } from './lib/svgPreview';
import { locateSvgSource } from './lib/svgPalette';
import { readTextImport } from './lib/textImport';
import { formatPlainTextAsMarkdown, MAX_MANUAL_FORMAT_CHARS } from './lib/autoMarkdown';
import { repairLanguage } from './lib/codeRepair';
import { repairCodeAction } from './lib/codeRepairAction';
import { inferTitle, isUntitledTitle } from './lib/title';
import { editorPosition, previewPosition, restoreEditorPosition } from './lib/scrollPosition';
import { cancelNavigation } from './lib/scrollMotion';
import PageOutline from './components/PageOutline';
import BootShell from './components/BootShell';
import TokenCounter from './components/TokenCounter';
import { localSaveDelay } from './lib/saveSchedule';
import type { SearchHit } from './lib/searchIndex';
import {
  clearRecovery, isLocallyCommitted, loadDoc, loadWorkspace, readPrefs, removeDoc, removeEmptyDraft, removeFolder, removeWorkspaceTree,
  saveDoc, saveFolder, savePrefs, saveRecovery, uid,
  type FlowDocument, type Folder, type Mode, type Theme, type Workspace,
} from './lib/store';

const MarkdownPreview = lazy(() => import('./components/MarkdownPreview'));

type TreeActions = Pick<ComponentProps<typeof WorkspaceTree>,
  'onOpen' | 'onNewDocument' | 'onNewFolder' | 'onRenameFolder' | 'onRenameDocument' |
  'onDuplicateDocument' | 'onMovePage' | 'onDeleteFolder' | 'onDeleteDocument'>;
// Keep callback identities stable for the memoized tree, but dispatch to the
// latest committed closures (workspace, folders and delete state can change).
function useTreeActions(actions: TreeActions): TreeActions {
  const latest = useRef(actions);
  useLayoutEffect(() => { latest.current = actions; }, [actions]);
  return useMemo<TreeActions>(() => ({
    onOpen: (...args) => latest.current.onOpen(...args),
    onNewDocument: (...args) => latest.current.onNewDocument(...args),
    onNewFolder: (...args) => latest.current.onNewFolder(...args),
    onRenameFolder: (...args) => latest.current.onRenameFolder(...args),
    onRenameDocument: (...args) => latest.current.onRenameDocument(...args),
    onDuplicateDocument: (...args) => latest.current.onDuplicateDocument(...args),
    onMovePage: (...args) => latest.current.onMovePage(...args),
    onDeleteFolder: (...args) => latest.current.onDeleteFolder(...args),
    onDeleteDocument: (...args) => latest.current.onDeleteDocument(...args),
  }), []);
}

// Warm the preview's module on idle without blocking the editor or changing
// mobile layout. This removes a cold-import pause on the first preview.
function warmPreviewModule() {
  void import('./components/MarkdownPreview');
}

function TerminalLoader({ loading }: { loading: boolean }) {
  return loading ? <span className="pixel-save-loader" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span> : null;
}
function AssetPreview({ document: doc, src, onExport, theme }: {
  document: FlowDocument; src: string | null; onExport: () => void; theme: Theme;
}) {
  const [svgText, setSvgText] = useState<string | null>(null);
  const isSvg = doc.fileType === 'image' &&
    (doc.fileName?.toLowerCase().endsWith('.svg') || doc.asset?.type === 'image/svg+xml');
  useEffect(() => {
    if (!isSvg || !doc.asset) { setSvgText(null); return; }
    let alive = true;
    if (doc.asset.size > 2 * 1024 * 1024) { setSvgText(null); return; }
    void doc.asset.text().then(value => { if (alive) setSvgText(value); });
    return () => { alive = false; };
  }, [doc.asset, isSvg]);
  const svgDocument = useMemo(() => svgText ? svgPreviewDocument(svgText, theme) : '', [svgText, theme]);
  return <div className="asset-preview">
    {isSvg && svgDocument
      ? <iframe className="asset-svg-frame" title={doc.fileName || doc.title}
          sandbox="" srcDoc={svgDocument} />
      : doc.fileType === 'image' && src
        ? <img src={src} alt={doc.fileName || doc.title} draggable={false} />
        : doc.fileType === 'image'
          ? <span className="asset-loading">Loading image…</span>
          : <div className="asset-file">
              <Icon name="file" size={22} />
              <span>{doc.fileName || doc.title}</span>
              <button type="button" onClick={onExport}><Icon name="download" size={15} /> Download</button>
            </div>}
  </div>;
}
export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [newFolderId, setNewFolderId] = useState<string | null>(null);
  const [docs, setDocs] = useState<FlowDocument[]>([]);
  const live = useRef(new Map<string, FlowDocument>());
  const [activeId, setActiveId] = useState('');
  const [treeReveal, setTreeReveal] = useState<{ id: string } | null>(null);
  const activeIdRef = useRef('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [theme, setTheme] = useState<Theme>('dark');
  const [accentTheme, setAccentTheme] = useState<AccentTheme>(() => parseAccentTheme(readPrefs().accentTheme));
  const [mode, setMode] = useState<Mode>('write');
  const [splitPercent, setSplitPercent] = useState(50);
  const [storedSplitPercent, setStoredSplitPercent] = useState(50);
  const [resizingSplit, setResizingSplit] = useState(false);
  const modeRef = useRef<Mode>('write');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 800px)').matches);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const draftDeadlines = useRef(new Map<string, number>());
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searchPending, setSearchPending] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const readTokenSource = useCallback((id: string) => live.current.get(id), []);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveDuration, setSaveDuration] = useState(0);
  const saveStarted = useRef(new Map<string, number>());
  const [notice, setNotice] = useState('');
  const [cloudState, setCloudState] = useState(backupStatus);
  useEffect(() => {
    const listener = () => setCloudState(backupStatus());
    window.addEventListener('flow-backup-status', listener);
    return () => window.removeEventListener('flow-backup-status', listener);
  }, []);
  const [exportMenu, setExportMenu] = useState<{ top: number; right: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [htmlSurfaceTone, setHtmlSurfaceTone] = useState<'dark' | 'light'>('dark');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [autoFormatting, setAutoFormatting] = useState(false);
  const autoFormatInFlight = useRef(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const deletionsInFlight = useRef(new Set<string>());
  const importInFlight = useRef(false);
  const [assetView, setAssetView] = useState<{ id: string; url: string } | null>(null);
  const editorRef = useRef<EditorView | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  // The isolated HTML iframe sends only a contrast hint. Never read DOM across
  // origins or let unrelated frames override the preview pop-out appearance.
  useEffect(() => {
    const onTone = (event: MessageEvent) => {
      if (event.data?.type !== 'flow-runtime-theme') return;
      if (event.data.theme !== 'dark' && event.data.theme !== 'light') return;
      const frame = previewScrollRef.current?.querySelector<HTMLIFrameElement>('.html-document-preview iframe');
      if (event.source === frame?.contentWindow) setHtmlSurfaceTone(event.data.theme);
    };
    window.addEventListener('message', onTone);
    return () => window.removeEventListener('message', onTone);
  }, []);
  const editorAreaRef = useRef<HTMLElement>(null);
  const targetLine = useRef<{ line: number; total: number; kind: 'scroll' | 'cursor' | 'jump'; id: string } | null>(null);
  const syncFrame = useRef<number | null>(null);
  const splitFrame = useRef<number | null>(null);
  const splitNext = useRef<number>(50);
  const lastSyncLine = useRef(-1);
  const scrollOwner = useRef<'editor' | 'preview' | 'transition'>('editor');
  const modeRestore = useRef<{ id: string; line: number; total: number; smooth?: boolean } | null>(null);
  const cancelHeadingMotion = useCallback(() => {
    cancelNavigation(editorRef.current?.scrollDOM);
    cancelNavigation(previewScrollRef.current);
  }, []);
  const workerRef = useRef<Worker | null>(null);
  const searchRequest = useRef(0);
  const saveTimers = useRef(new Map<string, number>());
  const dirtySince = useRef(new Map<string, number>());
  const saveQueue = useRef(new Map<string, Promise<void>>());
  const visualTimers = useRef(new Map<string, number>());
  const previewFrame = useRef<number | null>(null);
  const previewTimer = useRef<number | null>(null);
  const pendingPreview = useRef<{ id: string; markdown: string } | null>(null);
  const motionOff = useReducedMotion();

  // Normal messages dismiss after five seconds; progress notices remain until finished.
  useEffect(() => {
    if (!notice || pdfExporting || importProgress) return;
    const timer = window.setTimeout(() => setNotice(current => current === notice ? '' : current), 5000);
    return () => window.clearTimeout(timer);
  }, [notice, pdfExporting, importProgress]);

  // No progress UI is permanently pinned in the toolbar. A real successful
  // IndexedDB write is shown for five seconds, then the reserved slot clears.
  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = window.setTimeout(() => {
      setSaveState(current => current === 'saved' ? 'idle' : current);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [saveState, saveDuration]);

  useEffect(() => {
    const start = () => {
      if (document.visibilityState !== 'visible') return;
      warmPreviewModule();
    };
    const timeout = window.setTimeout(start, 950);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    let alive = true;
    let worker: Worker | null = null;
    let startupFrame = 0;
    let startupTimer = 0;
    try {
      worker = new Worker(new URL('./workers/search.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ type: 'result'; requestId: number; hits: SearchHit[] }>) => {
        if (event.data.type === 'result' && event.data.requestId === searchRequest.current) {
          setSearchResults(event.data.hits);
          setSearchPending(false);
        }
      };
      workerRef.current = worker;
    } catch { /* Title-only fallback is available without workers. */ }
    void loadWorkspace().then(data => {
      if (!alive) return;
      // Upgrade older default "Untitled" pages once. Named pages and
      // imported filenames are never silently renamed.
      const restored = data.documents.map(original => {
        let doc = original;
        // Recover old inferred-code pages, never explicit source-file imports.
        if (!doc.asset && doc.markdown.length < 180_000 &&
          (!doc.fileName || isMarkdownFile(doc.fileName) || !languageForFile(doc.fileName)) &&
          normalizeMixedContent(doc.markdown) !== doc.markdown) {
          const markdown = formatPlainTextAsMarkdown(doc.markdown, { atDocumentStart: true });
          if (markdown !== doc.markdown) {
            doc = { ...doc, markdown, language: undefined, updatedAt: Date.now() };
            if (doc.titleAuto && !doc.fileName) doc.title = inferTitle(markdown);
            void saveDoc(doc).catch(() => setNotice('Could not save recovered Markdown structure.'));
          }
        }
        if (doc.asset || doc.fileName || !doc.markdown.trim() ||
            (!doc.titleAuto && !isUntitledTitle(doc.title))) return doc;
        const title = inferTitle(doc.markdown, doc.language);
        if (title === doc.title && doc.titleAuto) return doc;
        const updated = { ...doc, title, titleAuto: true };
        void saveDoc(updated).catch(() => setNotice('Could not save an automatic page title.'));
        return updated;
      });
      live.current = new Map(restored.map(doc => [doc.id, doc]));
      const prefs = readPrefs();
      const first = restored.find(doc => doc.id === prefs.activeDocumentId) || restored[0];
      const chosenWorkspace = data.workspaces.find(ws => ws.id === prefs.activeWorkspaceId) ||
        data.workspaces.find(ws => ws.id === first.workspaceId) || data.workspaces[0];
      const restoredMode = prefs.mode === 'preview' || prefs.mode === 'split' ? prefs.mode : 'write';
      setDocs(restored);
      setWorkspaces(data.workspaces);
      setFolders(data.folders);
      const width = typeof prefs.splitPercent === 'number' && Number.isFinite(prefs.splitPercent)
        ? Math.min(78, Math.max(22, prefs.splitPercent)) : 50;
      setSplitPercent(width);
      setStoredSplitPercent(width);
      splitNext.current = width;
      // Restoring the active document must not change saved tree disclosure.
      activeIdRef.current = first.id;
      setActiveId(first.id);
      setWorkspaceId(chosenWorkspace.id);
      setRecentIds(restoreRecent(prefs.recentIds, restored));
      setTheme(prefs.theme === 'dark' || prefs.theme === 'light' ? prefs.theme
        : 'dark');
      setAccentTheme(parseAccentTheme(prefs.accentTheme));
      // Never restore a desktop-open drawer over the entire phone editor.
      setSidebarOpen(!window.matchMedia('(max-width: 800px)').matches);
      modeRef.current = restoredMode;
      setMode(restoredMode);
      setPreviewText(first.markdown);
      // Yield a frame before cloning the entire workspace into the search worker
      // or doing per-document cloud reconciliation. Use the current live map,
      // not a stale startup snapshot, if an edit occurs before the callback.
      startupFrame = requestAnimationFrame(() => {
        startupTimer = window.setTimeout(() => {
          if (!alive) return;
          performance.mark('flow:workspace-ready');
          if (performance.getEntriesByName('flow:boot-start', 'mark').length) {
            performance.measure('flow:workspace-startup', 'flow:boot-start', 'flow:workspace-ready');
          }
          const current = [...live.current.values()];
          worker?.postMessage({ type: 'index', documents: current.map(({ id, workspaceId, title, markdown, updatedAt }) => ({ id, workspaceId, title, markdown, updatedAt })) });
          current.forEach(queueSharedSync);
          current.forEach(doc => queueSiteSync(doc));
           const htmlFolders = new Map(data.folders.filter(folder => folder.name.trim().toLowerCase() === 'html sites').map(folder => [folder.id, folder]));
           for (const doc of current) {
             const folder = doc.folderId ? htmlFolders.get(doc.folderId) : undefined;
             if (folder && isHtmlPage(doc)) void queueImportedHtmlBackup(doc, folder, data.workspaces.find(ws => ws.id === folder.workspaceId)).catch(() => {});
           }
        }, 0);
      });
      setLoaded(true);
    }).catch(() => { if (alive) { setSaveState('error'); setNotice('Workspace could not be recovered. Existing data was not changed. Reload to retry.'); } });
    return () => {
      alive = false;
      cancelAnimationFrame(startupFrame);
      clearTimeout(startupTimer);
      worker?.terminate();
      workerRef.current = null;
      for (const timer of saveTimers.current.values()) clearTimeout(timer);
      dirtySince.current.clear();
      for (const timer of visualTimers.current.values()) clearTimeout(timer);
      if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
      if (previewTimer.current !== null) clearTimeout(previewTimer.current);
      if (syncFrame.current !== null) cancelAnimationFrame(syncFrame.current);
      if (splitFrame.current !== null) cancelAnimationFrame(splitFrame.current);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    delete document.documentElement.dataset.background;
    const color = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (color) color.content = theme === 'dark' ? '#050505' : '#F4F4F4';
  }, [theme]);
  useEffect(() => { applyAccentTheme(accentTheme); }, [accentTheme]);
  useEffect(() => {
    const doc = live.current.get(activeId);
    if (!doc?.asset) { setAssetView(null); return; }
    const url = URL.createObjectURL(doc.asset);
    setAssetView({ id: doc.id, url });
    return () => URL.revokeObjectURL(url);
  }, [activeId]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 800px)');
    const update = () => {
      setCompact(query.matches);
      if (query.matches) setSidebarOpen(false);
    };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!compact) {
      document.documentElement.style.removeProperty('--flow-viewport-height');
      return;
    }
    const viewport = window.visualViewport;
    let frame: number | null = null;
    let lastHeight = -1;
    // iOS keyboard can emit dozens of visualViewport resizes. Batch writes
    // to one frame and skip unchanged heights to avoid forced relayout.
    const measure = () => {
      frame = null;
      const height = Math.round(viewport?.height || window.innerHeight);
      if (height === lastHeight) return;
      lastHeight = height;
      document.documentElement.style.setProperty('--flow-viewport-height', height + 'px');
    };
    const update = () => {
      if (frame === null) frame = window.requestAnimationFrame(measure);
    };
    measure();
    viewport?.addEventListener('resize', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--flow-viewport-height');
    };
  }, [compact]);
  useEffect(() => {
    if (!loaded) return;
    savePrefs({ theme, accentTheme, mode, sidebarOpen, activeDocumentId: activeId,
      activeWorkspaceId: workspaceId, recentIds,
      splitPercent: storedSplitPercent });
  }, [loaded, theme, accentTheme, mode, sidebarOpen, activeId, workspaceId, recentIds, storedSplitPercent]);

  const flush = useCallback((id: string) => {
    const timer = saveTimers.current.get(id);
    if (timer !== undefined) { clearTimeout(timer); saveTimers.current.delete(id); }
    dirtySince.current.delete(id);
    const doc = live.current.get(id);
    if (!doc) return;
    // Clean navigation must not serialize, rewrite or re-upload a committed revision.
    // Recovered drafts and failed writes are deliberately not marked committed.
    if (isLocallyCommitted(doc) && !saveQueue.current.has(id)) return;
    // Preserve a small emergency snapshot before an asynchronous local commit. Large files use IndexedDB.
    saveRecovery(doc);
    const previous = saveQueue.current.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => saveDoc(doc));
    saveQueue.current.set(id, next);
    void next.then(() => {
      if (saveQueue.current.get(id) === next) saveQueue.current.delete(id);
      const latest = live.current.get(id);
      if (latest === doc) {
        // Only synchronize a locally committed revision; do not inspect share
        // records or schedule cloud work on every editor keystroke.
        queueSharedSync(doc);
        queueSiteSync(doc);
        if (activeIdRef.current === id) {
          const started = saveStarted.current.get(id);
          if (started !== undefined) setSaveDuration(Math.max(1, Math.round(performance.now() - started)));
          setSaveState('saved');
        }
        saveStarted.current.delete(id);
        clearRecovery(id, doc.updatedAt);
      }
    }).catch(() => {
      if (saveQueue.current.get(id) === next) saveQueue.current.delete(id);
      if (activeIdRef.current === id) setSaveState('error');
      saveStarted.current.delete(id);
    });
  }, []);

  useEffect(() => {
    const finish = () => {
      const doc = live.current.get(activeIdRef.current);
      if (doc && !isLocallyCommitted(doc)) saveRecovery(doc);
      for (const id of [...saveTimers.current.keys()]) flush(id);
    };
    window.addEventListener('pagehide', finish);
    const onVisibility = () => { if (document.visibilityState === 'hidden') finish(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.removeEventListener('pagehide', finish); document.removeEventListener('visibilitychange', onVisibility); };
  }, [flush]);

  const scheduleSave = useCallback((doc: FlowDocument) => {
    live.current.set(doc.id, doc);
    if (doc.id === activeIdRef.current) window.dispatchEvent(new CustomEvent('flow-token-source', { detail: doc.id }));
    const now = performance.now();
    const firstDirty = dirtySince.current.get(doc.id) ?? now;
    dirtySince.current.set(doc.id, firstDirty);
    saveStarted.current.set(doc.id, now);
    setSaveDuration(0);
    setSaveState('saving');
    const old = saveTimers.current.get(doc.id);
    if (old !== undefined) clearTimeout(old);
    saveTimers.current.set(doc.id, window.setTimeout(() => flush(doc.id), localSaveDelay(doc.markdown.length, now - firstDirty)));
    const visual = visualTimers.current.get(doc.id);
    if (visual !== undefined) clearTimeout(visual);
    visualTimers.current.set(doc.id, window.setTimeout(() => {
      const latest = live.current.get(doc.id);
      if (!latest) return;
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'upsert', document: {
          id: latest.id, workspaceId: latest.workspaceId, title: latest.title,
          markdown: latest.markdown, updatedAt: latest.updatedAt,
        } });
      }
      visualTimers.current.delete(doc.id);
    }, doc.markdown.length > 100000 ? 700 : 430));
  }, [flush]);

  // Repair legacy Markdown imports that were stored as binary assets. Files
  // remain intact if decoding fails; successful conversions become editable.
  useEffect(() => {
    if (!loaded || !activeId) return;
    const doc = live.current.get(activeId);
    if (!doc?.asset || !isMarkdownFile(doc.fileName || '')) return;
    let cancelled = false;
    void readTextImport(doc.asset, doc.fileName).then(value => {
      if (cancelled) return;
      const current = live.current.get(doc.id);
      if (value === null) {
        setNotice('This Markdown file uses an unsupported encoding. The original download is preserved.');
        return;
      }
      if (!current?.asset || current.asset !== doc.asset) return;
      const next: FlowDocument = {
        ...current, asset: undefined, fileType: 'text',
        markdown: value, language: undefined, updatedAt: Date.now(),
      };
      scheduleSave(next);
      setDocs(items => items.map(item => item.id === doc.id ? next : item));
      if (activeIdRef.current === doc.id) {
        setPreviewText(value);
      }
    }).catch(() => {
      if (!cancelled) setNotice('Could not decode this Markdown file. The original is preserved.');
    });
    return () => { cancelled = true; };
  }, [activeId, loaded, scheduleSave]);

  useEffect(() => { setShareOpen(false); }, [activeId]);

  const onEditorChange = useCallback((value: string, id: string) => {
    const current = live.current.get(id);
    if (!current || current.markdown === value) return;
    const autoTitle = current.titleAuto || (!current.fileName && isUntitledTitle(current.title));
    // Only re-evaluate the first 12KB when it changes. Large plans stay fast
    // even when editing deep in the document.
    const title = autoTitle && (current.markdown.slice(0, 12000) !== value.slice(0, 12000) ||
      isUntitledTitle(current.title))
      ? inferTitle(value, current.language) : current.title;
    const next: FlowDocument = {
      ...current, markdown: value, title, titleAuto: autoTitle, updatedAt: Date.now(),
    };
    scheduleSave(next);
    if (id === activeIdRef.current) window.dispatchEvent(new CustomEvent('flow-outline-change', { detail: id }));
    // Coalesce edits to one preview update per animation frame, never after an idle delay.
    if (id === activeIdRef.current && modeRef.current !== 'write') {
      pendingPreview.current = { id, markdown: value };
      if (value.length > 220_000) {
        if (previewTimer.current !== null) clearTimeout(previewTimer.current);
        previewTimer.current = window.setTimeout(() => {
          previewTimer.current = null;
          const snapshot = pendingPreview.current;
          if (snapshot && snapshot.id === activeIdRef.current && modeRef.current !== 'write') setPreviewText(snapshot.markdown);
        }, value.length > 1_000_000 ? 500 : 220);
      } else if (previewFrame.current === null) {
        previewFrame.current = requestAnimationFrame(() => {
          previewFrame.current = null;
          const snapshot = pendingPreview.current;
          if (snapshot && snapshot.id === activeIdRef.current && modeRef.current !== 'write') setPreviewText(snapshot.markdown);
        });
      }
    }
    if (next.title !== current.title || next.titleAuto !== current.titleAuto) {
      setDocs(items => items.map(item => item.id === next.id ? next : item));
    }
  }, [scheduleSave]);

  const onSvgEdit = useCallback((source: string, next: string, line: number): boolean => {
    const id = activeIdRef.current;
    const current = live.current.get(id);
    if (!current || current.asset) return false;
    const view = editorRef.current;
    const text = view?.state.doc.toString() ?? current.markdown;
    const from = locateSvgSource(text, source, line);
    if (from < 0) return false;
    if (view) view.dispatch({ changes: { from, to: from + source.length, insert: next }, userEvent: 'input' });
    const updated = view?.state.doc.toString() ?? text.slice(0, from) + next + text.slice(from + source.length);
    onEditorChange(updated, id);
    setPreviewText(updated);
    return true;
  }, [onEditorChange]);

  const onToggleTask = useCallback((lineNumber: number, checked: boolean) => {
    const id = activeIdRef.current;
    const current = live.current.get(id);
    if (!current || current.asset) return;

    // CodeMirror is the editable source of truth in Write, Split and Preview.
    // Dispatching a one-character transaction preserves native undo/redo.
    const view = editorRef.current;
    if (view) {
      if (lineNumber < 1 || lineNumber > view.state.doc.lines) return;
      const line = view.state.doc.line(lineNumber);
      const edit = taskMarkerEdit(line.text, checked);
      if (!edit) return;
      view.dispatch({ changes: {
        from: line.from + edit.from, to: line.from + edit.to, insert: edit.insert,
      } });
      // Update the preview immediately even for long documents whose normal
      // typing pipeline batches string snapshots.
      const next = view.state.doc.toString();
      onEditorChange(next, id);
      setPreviewText(next);
      return;
    }

    // Defensive fallback during editor mounting: keep persistence and the
    // document snapshot consistent instead of silently dropping the click.
    const next = setTaskChecked(current.markdown, lineNumber, checked);
    if (next === current.markdown) return;
    onEditorChange(next, id);
    setPreviewText(next);
    const updated = live.current.get(id);
    if (updated) setDocs(items => items.map(doc => doc.id === id ? updated : doc));
  }, [onEditorChange]);

  const selectDocument = useCallback((id: string) => {
    const doc = live.current.get(id);
    if (!doc) return;
    const previous = activeIdRef.current;
    if (previous && previous !== id) {
      flush(previous);
      setRecentIds(ids => finishVisit(ids, previous, id, live.current.has(previous)));
    }
    activeIdRef.current = id;
    pendingPreview.current = null;
    if (previewTimer.current !== null) { clearTimeout(previewTimer.current); previewTimer.current = null; }
    if (previewFrame.current !== null) { cancelAnimationFrame(previewFrame.current); previewFrame.current = null; }
    setActiveId(id);
    setTreeReveal({ id });
    cancelHeadingMotion();
    targetLine.current = null;
    lastSyncLine.current = -1;
    scrollOwner.current = 'editor';
    modeRestore.current = null;
    if (previewScrollRef.current) previewScrollRef.current.scrollTop = 0;
    setWorkspaceId(doc.workspaceId);
    setDocs(current => {
      // Most visits do not edit anything. Avoid allocating an entire new array
      // in that case, while still reconciling any late editor cleanup or save.
      if (!current.some(item => (live.current.get(item.id) || item) !== item)) return current;
      return current.map(item => live.current.get(item.id) || item);
    });
    setPreviewText(doc.markdown);
    setSaveState('idle');
    if (window.innerWidth < 800) setSidebarOpen(false);
  }, [flush, cancelHeadingMotion]);

  const makeDocument = useCallback((targetWorkspace?: string, targetFolder?: string, parentId?: string) => {
    if (!workspaces.length) return;
    const target = targetWorkspace || workspaceId || workspaces[0].id;
    const stamp = Date.now();
    const doc: FlowDocument = {
      id: uid(), workspaceId: target, folderId: targetFolder, parentId, title: 'Untitled', titleAuto: true,
      markdown: '', createdAt: stamp, updatedAt: stamp,
    };
    live.current.set(doc.id, doc);
    setDocs(current => [doc, ...current]);
    // A page created from a collapsed workspace must be visible in its tree.
    // Keep the existing folder assignment and show the containing workspace.
    // Clear any filtered tree so the new page cannot be hidden by search.
    setQuery('');
    selectDocument(doc.id);
    void saveDoc(doc).catch(() => setSaveState('error'));
    window.requestAnimationFrame(() => editorRef.current?.focus());
  }, [selectDocument, workspaceId, workspaces]);

    function duplicateDocument(id: string) {
    const original = live.current.get(id);
    if (!original || original.asset) return;
    const stamp = Date.now();
    const source = id === activeIdRef.current ? editorRef.current?.state.doc.toString() ?? original.markdown : original.markdown;
    const doc: FlowDocument = { ...original, id: uid(), markdown: source, title: original.title + ' (copy)',
      titleAuto: false, fileName: undefined, createdAt: stamp, updatedAt: stamp };
    live.current.set(doc.id, doc);
    setDocs(items => [doc, ...items]);
    setQuery('');
    selectDocument(doc.id);
    void saveDoc(doc).catch(() => { setSaveState('error'); setNotice('Could not save duplicate.'); });
  }


async function eraseDocument(doc: FlowDocument, automatic = false) {
    // Remove the row instantly. Cloud revocation and IndexedDB writes are
    // asynchronous; restore the original page if any required operation fails.
    const pendingSave = saveQueue.current.get(doc.id);
    const saveTimer = saveTimers.current.get(doc.id);
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimers.current.delete(doc.id);
    dirtySince.current.delete(doc.id);
    const visualTimer = visualTimers.current.get(doc.id);
    if (visualTimer !== undefined) clearTimeout(visualTimer);
    visualTimers.current.delete(doc.id);
    const shared = readShareRecord(doc.id);
    const hosted = Boolean(readSiteRecord(doc.id));
    const wasActive = activeIdRef.current === doc.id;
    const remaining = [...live.current.values()].filter(item => item.id !== doc.id);
    live.current.delete(doc.id);
    workerRef.current?.postMessage({ type: 'remove', id: doc.id });
    setDocs(remaining);
    setRecentIds(ids => ids.filter(id => id !== doc.id));
    if (wasActive && remaining.length) selectDocument(remaining[0].id);
    try {
      // Parallelize independent cloud revocations, but do not pretend a
      // deleted local document has revoked public links until both succeed.
      await Promise.all([
        pendingSave?.catch(() => {}),
        shared ? revokeCloudShare(doc.id, shared) : Promise.resolve(),
        hosted ? revokeHtml(doc.id) : Promise.resolve(),
      ]);
      if (automatic) {
        if (!await removeEmptyDraft(doc)) {
          // A newer persisted revision may have prevented deletion. Restore
          // that revision instead of exposing the old blank snapshot for editing.
          const restored = await loadDoc(doc.id) || doc;
          live.current.set(restored.id, restored);
          setDocs([...live.current.values()]);
          workerRef.current?.postMessage({ type: 'upsert', document: { id: restored.id, workspaceId: restored.workspaceId, title: restored.title, markdown: restored.markdown, updatedAt: restored.updatedAt } });
          return;
        }
      } else await removeDoc(doc.id);
      // Deleting a page does not delete its subpages. Missing parents are also
      // rendered as roots if a save is interrupted.
      for (const child of live.current.values()) if (child.parentId === doc.id) {
        const moved = { ...child, parentId: doc.parentId, updatedAt: Date.now() };
        scheduleSave(moved);
      }
      setDocs([...live.current.values()]);
      if (wasActive && !remaining.length) makeDocument(doc.workspaceId);
    } catch {
      live.current.set(doc.id, doc);
      setDocs([...live.current.values()]);
      workerRef.current?.postMessage({ type: 'upsert', document: {
        id: doc.id, workspaceId: doc.workspaceId, title: doc.title,
        markdown: doc.markdown, updatedAt: doc.updatedAt,
      } });
      if (wasActive) selectDocument(doc.id);
      setNotice('Deletion could not finish. The page has been restored. Check its share links.');
    }
  }
  async function turnOnBackup() {
    try {
      await enableBackup();
      resumeBackup({ workspaces, folders, documents: [...live.current.values()] });
      setCloudState(backupStatus());
    } catch { setNotice('Cloud backup could not be enabled. Local files are unchanged.'); }
  }
  async function copyRecoveryKey() {
    try {
      await navigator.clipboard.writeText(await getRecoveryKey());
      setNotice('Recovery key copied. Save it privately; it grants access to your backups.');
    } catch { setNotice('Could not copy the recovery key.'); }
  }
  async function recoverCloudWorkspace() {
    const key = window.prompt('Enter your private Flow backup recovery key.');
    if (!key?.trim()) return;
    try {
      await recoverWithKey(key);
      window.location.reload();
    } catch { setNotice('Could not recover the backup. Check your key and connection.'); }
  }
  function createFolder(targetWorkspace: string) {
    if (!workspaces.some(ws => ws.id === targetWorkspace)) return;
    // Workspace ID is storage ownership, never a folder parent.
    const folder: Folder = { id: uid(), workspaceId: targetWorkspace, name: 'New folder', createdAt: Date.now() };
    setFolders(items => [...items, folder]);
    setQuery('');
    setNewFolderId(folder.id);
    void saveFolder(folder).catch(() => setNotice('Folder could not be saved.'));
  }
  function renameFolder(id: string, name: string) {
    const old = folders.find(item => item.id === id);
    if (!old || !name.trim()) { setNewFolderId(null); return; }
    const next = { ...old, name: name.trim() };
    setFolders(items => items.map(item => item.id === id ? next : item));
    setNewFolderId(null);
    void saveFolder(next).catch(() => setNotice('Folder rename could not be saved.'));
  }
  async function eraseFolder(id: string) {
    const folder = folders.find(item => item.id === id);
    if (!folder) return;
    // Removing a folder puts its documents at workspace root. Never erase file bodies.
    const affected = [...live.current.values()].filter(doc => doc.folderId === id);
    try {
      for (const doc of affected) {
        const timer = saveTimers.current.get(doc.id);
        if (timer !== undefined) clearTimeout(timer);
        saveTimers.current.delete(doc.id);
    dirtySince.current.delete(doc.id);
        await saveQueue.current.get(doc.id)?.catch(() => {});
        const current = live.current.get(doc.id);
        if (!current) continue;
        const updated = { ...current, folderId: undefined, updatedAt: Date.now() };
        await saveDoc(updated);
        live.current.set(doc.id, updated);
      }
      await removeFolder(id);
      setFolders(items => items.filter(item => item.id !== id));
      setDocs(items => items.map(doc => live.current.get(doc.id) || doc));
    } catch { setNotice('Folder could not be removed. Your documents were kept.'); }
  }
  function movePage(id: string, parentId?: string, folderId?: string) {
    const original = live.current.get(id);
    if (!original) return;
    const parent = parentId ? live.current.get(parentId) : undefined;
    if (parentId && (!parent || parent.asset)) return;
    const visited = new Set([id]);
    let ancestor = parent;
    while (ancestor) {
      if (visited.has(ancestor.id)) { setNotice('A page cannot contain itself or its ancestors.'); return; }
      visited.add(ancestor.id);
      ancestor = ancestor.parentId ? live.current.get(ancestor.parentId) : undefined;
    }
    const folder = folderId ? folders.find(item => item.id === folderId) : undefined;
    if (folderId && !folder) return;
    const targetWorkspace = parent?.workspaceId || folder?.workspaceId || original.workspaceId;
    const targetFolder = parent ? parent.folderId : folder?.id;
    if (original.parentId === parentId && original.folderId === targetFolder && original.workspaceId === targetWorkspace) return;
    const descendants = [id];
    const seen = new Set(descendants);
    for (let index = 0; index < descendants.length; index++) {
      for (const child of live.current.values()) if (child.parentId === descendants[index] && !seen.has(child.id)) {
        seen.add(child.id); descendants.push(child.id);
      }
    }
    for (const childId of descendants) {
      const doc = live.current.get(childId);
      if (!doc) continue;
      const updated = { ...doc, workspaceId: targetWorkspace, folderId: targetFolder,
        parentId: childId === id ? parentId : doc.parentId, updatedAt: Date.now() };
      scheduleSave(updated);
    }
    if (seen.has(activeIdRef.current)) setWorkspaceId(targetWorkspace);
    setDocs([...live.current.values()]);
  }
  function renameDocument(id: string, name: string) {
    const old = live.current.get(id);
    if (!old) return;
    const extension = old.fileName?.match(/\.[^.]+$/)?.[0] || '';
    const title = extension && name.toLowerCase().endsWith(extension.toLowerCase())
      ? name.slice(0, -extension.length).trim() || name : name;
    if (!title || (title === old.title && !old.titleAuto)) return;
    const next: FlowDocument = { ...old, title, titleAuto: false,
      fileName: old.fileName ? title + extension : undefined, updatedAt: Date.now() };
    scheduleSave(next);
    setDocs(items => items.map(doc => doc.id === id ? next : doc));
  }
  async function eraseWorkspace(id: string) {
    if (workspaces.length < 2) return;
    const ws = workspaces.find(item => item.id === id);
    if (!ws) return;
    const previousActive = activeIdRef.current;
    const previousWorkspaces = workspaces;
    const previousFolders = folders;
    const remainingWorkspaces = workspaces.filter(item => item.id !== id);
    const deletedDocs = [...live.current.values()].filter(doc => doc.workspaceId === id);
    const otherDocs = [...live.current.values()].filter(doc => doc.workspaceId !== id);
    const deletedFolders = folders.filter(item => item.workspaceId === id);
    const pendingWrites: Promise<unknown>[] = [];
    for (const doc of deletedDocs) {
      const timer = saveTimers.current.get(doc.id);
      if (timer !== undefined) clearTimeout(timer);
      saveTimers.current.delete(doc.id);
    dirtySince.current.delete(doc.id);
      const visual = visualTimers.current.get(doc.id);
      if (visual !== undefined) clearTimeout(visual);
      visualTimers.current.delete(doc.id);
      const pending = saveQueue.current.get(doc.id);
      if (pending) pendingWrites.push(pending.catch(() => {}));
      live.current.delete(doc.id);
      workerRef.current?.postMessage({ type: 'remove', id: doc.id });
    }
    // UI removal is immediate even for workspaces with hundreds of pages.
    setWorkspaces(remainingWorkspaces);
    setFolders(items => items.filter(folder => folder.workspaceId !== id));
    setDocs(otherDocs);
    setRecentIds(ids => ids.filter(docId => live.current.has(docId)));
    if (previousActive && !live.current.has(previousActive)) {
      if (otherDocs.length) selectDocument(otherDocs[0].id);
      else setActiveId('');
    } else if (workspaceId === id) setWorkspaceId(remainingWorkspaces[0].id);

    try {
      await Promise.all(pendingWrites);
      // Keep public links from surviving workspace deletion. Bound concurrency
      // so hundreds of files do not create hundreds of network requests at once.
      const revocations: Array<() => Promise<unknown>> = [];
      for (const doc of deletedDocs) {
        const shared = readShareRecord(doc.id);
        if (shared) revocations.push(() => revokeCloudShare(doc.id, shared));
        if (readSiteRecord(doc.id)) revocations.push(() => revokeHtml(doc.id));
      }
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, revocations.length) }, async () => {
        while (cursor < revocations.length) await revocations[cursor++]();
      }));
      await removeWorkspaceTree(id, deletedDocs.map(doc => doc.id),
        deletedFolders.map(folder => folder.id));
      if (!otherDocs.length) makeDocument(remainingWorkspaces[0].id);
    } catch {
      // Keep the documents if revocation or the atomic IndexedDB transaction
      // fails. No partial local workspace deletion should be acknowledged.
      for (const doc of deletedDocs) {
        live.current.set(doc.id, doc);
        workerRef.current?.postMessage({ type: 'upsert', document: {
          id: doc.id, workspaceId: doc.workspaceId, title: doc.title,
          markdown: doc.markdown, updatedAt: doc.updatedAt,
        } });
      }
      setWorkspaces(previousWorkspaces);
      setFolders(previousFolders);
      setDocs([...live.current.values()]);
      if (previousActive && live.current.has(previousActive)) selectDocument(previousActive);
      setNotice('Workspace deletion could not finish. Its files were restored; check public share links.');
    }
  }
  async function deleteTarget(target: { kind: 'document' | 'workspace'; id: string }, automatic = false) {
    const operationKey = target.kind + ':' + target.id;
    if (deletionsInFlight.current.has(operationKey)) return;
    deletionsInFlight.current.add(operationKey);
    try {
      if (target.kind === 'workspace') await eraseWorkspace(target.id);
      else {
        const doc = live.current.get(target.id);
        if (doc && (!automatic || canExpireDraft(doc, activeIdRef.current, live.current.values(),
          Boolean(readShareRecord(doc.id) || readSiteRecord(doc.id))))) await eraseDocument(doc, automatic);
      }
    } finally {
      deletionsInFlight.current.delete(operationKey);
    }
  }
  function toggleExport(event: React.MouseEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setExportMenu(current => current ? null : {
      top: Math.max(8, Math.min(bounds.bottom + 8, window.innerHeight - 120)),
      right: Math.max(9, window.innerWidth - bounds.right),
    });
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('.flow-export-menu button:not(:disabled)')?.focus();
    });
  }
  useEffect(() => {
    if (!exportMenu) return;
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest('.flow-export-menu,.export-button')) setExportMenu(null);
    };
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setExportMenu(null);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', dismiss);
    };
  }, [exportMenu]);

  async function exportPdf(doc: FlowDocument) {
    setExportMenu(null);
    if (pdfExporting) return;
    if (doc.asset) {
      setNotice('PDF export works with text and Markdown pages.');
      return;
    }
    const source = doc.id === activeIdRef.current
      ? editorRef.current?.state.doc.toString() ?? doc.markdown
      : doc.markdown;
    setPdfExporting(true);
    setNotice('Preparing PDF…');
    // Paint the loading state before the costly dynamic import or PDF layout begins.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      const { downloadStyledPdf } = await import('./lib/pdfExport');
      await downloadStyledPdf(source, doc.title, progress => setNotice(progress));
      setNotice('PDF exported');
    } catch (error) {
      console.error('PDF export failed', error);
      const reason = error instanceof Error && error.message
        ? error.message.slice(0, 120) : 'Unknown error.';
      setNotice(`Could not export PDF: ${reason}`);
    } finally {
      setPdfExporting(false);
    }
  }

  function exportDocument(doc: FlowDocument) {
    flush(doc.id);
    if (doc.asset || doc.fileName) {
      const blob = doc.asset ?? new Blob([doc.markdown], { type: 'text/plain;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = doc.fileName || doc.title;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } else {
      downloadMarkdown(doc.markdown, doc.title);
    }
    setNotice('Exported');
  }
  async function copyAll() {
    const current = live.current.get(activeIdRef.current);
    if (!current || current.asset) {
      setNotice('Open a text page to copy.');
      return;
    }
    // CodeMirror owns the latest edits even when a huge document's
    // persistence snapshot is intentionally delayed.
    const text = editorRef.current?.state.doc.toString() ?? current.markdown;
    if (!text) {
      setNotice('This page is empty.');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Support older iOS WebViews without the asynchronous Clipboard API.
        const input = document.createElement('textarea');
        input.value = text;
        input.readOnly = true;
        input.setAttribute('aria-hidden', 'true');
        Object.assign(input.style, {
          position: 'fixed', left: '-9999px', top: '0', opacity: '0',
        });
        document.body.appendChild(input);
        try {
          input.focus({ preventScroll: true });
          input.select();
          if (!document.execCommand('copy')) throw new Error('Copy denied');
        } finally {
          input.remove();
        }
      }
      setNotice('Entire page copied');
    } catch {
      setNotice('Could not copy. Check browser clipboard access.');
    }
  }

  async function autoFormatDocument() {
    if (autoFormatInFlight.current) return;
    const view = editorRef.current;
    const current = live.current.get(activeIdRef.current);
    if (!view || !current || current.asset) {
      setNotice('Open an editable page to format.');
      return;
    }
    // A selection formats only that region; without one, format the document.
    const range = view.state.selection.main;
    // Markdown blocks start at line boundaries, even when a user drags across
    // visually wrapped lines or selects only part of a paragraph.
    const selected = !range.empty;
    const from = selected ? view.state.doc.lineAt(range.from).from : 0;
    const endLineStart = view.state.doc.lineAt(range.to).from;
    const endPosition = selected && range.to === endLineStart && range.to > range.from
      ? range.to - 1 : range.to;
    const to = selected ? view.state.doc.lineAt(endPosition).to : view.state.doc.length;
    const originalDocument = view.state.doc;
    const source = originalDocument.sliceString(from, to);
    if (!source.trim()) { setNotice('Select or write some text first.'); return; }
    if (source.length > MAX_MANUAL_FORMAT_CHARS) {
      setNotice('Select a smaller section to format (1 MB maximum).');
      return;
    }

    const currentLanguage = repairLanguage(
      originalDocument.sliceString(0, 8192),
      current.language || languageForFile(current.fileName || ''),
    );
    if (!currentLanguage) {
      setNotice('Deterministic code repair currently supports HTML and Python.');
      return;
    }
    autoFormatInFlight.current = true;
    setAutoFormatting(true);
    setNotice('Checking ' + currentLanguage.toUpperCase() + ' source…');
    try {
      const formatted = await repairCodeAction(source, currentLanguage);
      // The user can type or change pages while a large worker is running.
      // Never overwrite a newer CodeMirror document with stale formatting.
      if (editorRef.current !== view || activeIdRef.current !== current.id ||
        view.state.doc !== originalDocument) {
        setNotice('Page changed during formatting. No edits were overwritten.');
        return;
      }
      if (formatted === source) {
        setNotice('No recognizable paste artifacts. Source unchanged.');
        return;
      }
      // One replacement transaction ensures Cmd/Ctrl+Z reverts the entire action.
      // Preserve the caret on full-page edits and select the changed region otherwise.
      const position = Math.min(from + formatted.length, range.head);
      view.dispatch({
        changes: { from, to, insert: formatted },
        selection: range.empty ? { anchor: position }
          : { anchor: from, head: from + formatted.length },
      });
      if (modeRef.current !== 'preview') view.focus();
      setNotice(currentLanguage.toUpperCase() + ' paste artifacts removed · Undo to revert');
    } catch (error) {
      console.error('Source formatting failed', error);
      setNotice('Could not process source. Your text was not changed.');
    } finally {
      autoFormatInFlight.current = false;
      setAutoFormatting(false);
    }
  }
  async function importFiles(incoming: File[]) {
    if (!incoming.length || importInFlight.current) return;
    importInFlight.current = true;
    setSaveDuration(0);
    setSaveState('saving');
    const imported: FlowDocument[] = [];
    const errors: string[] = [];
    const total = incoming.length;
    let completed = 0;
    setImportProgress({ done: 0, total });
    setNotice('Importing 0 / ' + total + ' files…');
    const targetWorkspace = workspaceId || workspaces[0]?.id;
    let htmlFolderPromise: Promise<Folder> | undefined;
    function htmlDestination(): Promise<Folder> {
      return htmlFolderPromise ??= (async () => {
        const existing = folders.find(folder => folder.name.trim().toLowerCase() === 'html sites');
        if (existing) return existing;
        if (!targetWorkspace) throw new Error('Workspace is not ready');
        const folder: Folder = { id: uid(), workspaceId: targetWorkspace, name: 'HTML Sites', createdAt: Date.now() };
        await saveFolder(folder);
        setFolders(items => [...items, folder]);
        return folder;
      })();
    }

    async function importOne(file: File) {
      if (file.size > 50 * 1024 * 1024) throw new Error(file.name + ' exceeds the 50 MB limit');
      const supportedImage = /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/i.test(file.type);
      const svg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
      const image = !svg && (supportedImage || /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(file.name));
      const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const recognizedText = svg || file.type.startsWith('text/') ||
        /^(application\/(?:json|javascript|xml|x-javascript|x-yaml|yaml|toml|graphql))$/i.test(file.type) ||
        Boolean(languageForFile(file.name)) || isMarkdownFile(file.name) ||
        /\.(txt|csv|tsv|log|ini|cfg|env|gitignore|editorconfig)$/i.test(file.name);
      let binary = !image && !pdf && Boolean(file.type && !recognizedText);
      let markdown = '';
      if (pdf) {
        // Heavy extraction only enters the browser when the first PDF is imported.
        const { readPdfAsMarkdown } = await import('./lib/pdfImport');
        markdown = await readPdfAsMarkdown(file);
      } else if (!image && !binary) {
        const decoded = await readTextImport(file, file.name);
        binary = decoded === null;
        if (decoded !== null) {
          const plainText = !languageForFile(file.name) && !isMarkdownFile(file.name) &&
            (/\.txt$/i.test(file.name) || file.type === 'text/plain');
          const mixedMarkdown = isMarkdownFile(file.name) && normalizeMixedContent(decoded) !== decoded;
          markdown = plainText || mixedMarkdown ? formatPlainTextAsMarkdown(decoded, { atDocumentStart: true }) : decoded;
        }
      }
      const now = Date.now();
      const fileType = image ? 'image' : binary ? 'binary' : 'text';
      const doc: FlowDocument = {
        id: uid(), workspaceId: targetWorkspace, markdown,
        title: file.name.replace(/\\.[^.]+$/, '') || file.name,
        // A successfully imported PDF becomes editable Markdown, not a binary attachment.
        fileName: pdf ? file.name.replace(/\\.pdf$/i, '.md') : file.name, fileType,
        language: fileType === 'text' && !isMarkdownFile(file.name) && !pdf
          ? (svg ? 'svg' : languageForFile(file.name)) || detectRawCode(markdown) || undefined : undefined,
        asset: image || binary ? file : undefined,
        titleAuto: false, createdAt: now, updatedAt: now,
      };
      const htmlFolder = isHtmlPage(doc) ? await htmlDestination() : undefined;
      if (htmlFolder) {
        doc.workspaceId = htmlFolder.workspaceId;
        doc.folderId = htmlFolder.id;
        doc.language = 'html';
      }
      await saveDoc(doc);
      if (htmlFolder) {
        const owner = workspaces.find(ws => ws.id === htmlFolder.workspaceId);
        void queueImportedHtmlBackup(doc, htmlFolder, owner).catch(() => {
          setNotice('HTML saved locally. Cloud backup could not start; retrying on the next visit.');
        });
      }
      live.current.set(doc.id, doc);
      imported.push(doc);
      workerRef.current?.postMessage({ type: 'upsert', document: {
        id: doc.id, workspaceId: doc.workspaceId, title: doc.title,
        markdown: doc.markdown, updatedAt: doc.updatedAt,
      } });
      // Progressive tree rendering lets users open completed PDFs immediately.
      setDocs(current => [doc, ...current]);
    }

    try {
      let cursor = 0;
      const parallelism = Math.min(3, Math.max(1, incoming.length));
      await Promise.all(Array.from({ length: parallelism }, async () => {
        while (cursor < incoming.length) {
          const file = incoming[cursor++];
          try { await importOne(file); }
          catch (error) {
            errors.push(file.name + ': ' + (error instanceof Error ? error.message : 'Could not import'));
          } finally {
            completed++;
            setImportProgress({ done: completed, total });
            setNotice('Importing ' + completed + ' / ' + total + ' files…');
          }
        }
      }));
      if (imported.length) {
        setQuery('');
        selectDocument(imported[0].id);
      }
      setSaveState(errors.length ? 'error' : 'saved');
    } finally {
      importInFlight.current = false;
      setImportProgress(null);
      setNotice(errors.length
        ? imported.length + ' imported · ' + errors.slice(0, 3).join(' · ') +
          (errors.length > 3 ? ' · +' + (errors.length - 3) + ' more failed' : '')
        : 'Imported ' + imported.length + (imported.length === 1 ? ' file' : ' files'));
    }
  }
  function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void importFiles(files);
  }
  function onDrop(event: DragEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    event.preventDefault();
    void importFiles(Array.from(event.dataTransfer.files));
  }
  const active = live.current.get(activeId) || docs.find(doc => doc.id === activeId);
  const activeFileLanguage = active?.language || languageForFile(active?.fileName || '');
  const activeRepairLanguage = useMemo(() => active && !active.asset
    ? repairLanguage(active.markdown.slice(0, 8192), activeFileLanguage) : null, [active, activeFileLanguage]);
  const formatActionLabel = activeRepairLanguage === 'html' ? 'Auto HTML Fix'
    : 'Auto Python Fix';
  const activeHtml = useMemo(() => isHtmlPage(active), [active]);
  useEffect(() => { setHtmlSurfaceTone('dark'); }, [activeId]);
  // Local previews never wait for cloud publishing.
  function openFullHtml() {
    const doc = live.current.get(activeIdRef.current);
    if (!doc || !isHtmlPage(doc)) return;
    const tab = window.open(localHtmlUrl(doc.id, doc.updatedAt), '_blank');
    if (!tab) { setNotice('Your browser blocked the HTML preview tab. Allow popups and retry.'); return; }
    tab.opener = null;
    flush(doc.id);
  }
  const matching = useMemo(() => {
    if (!query.trim()) return sortWorkspaceDocuments(docs);
    const byId = new Map(docs.map(doc => [doc.id, doc]));
    // The worker returns relevance ranking. Do not sort by modification time.
    return searchResults.flatMap(hit => {
      const doc = byId.get(hit.id);
      return doc ? [doc] : [];
    });
  }, [docs, query, searchResults]);
  useEffect(() => {
    const requestId = ++searchRequest.current;
    const text = query.trim();
    setSearchResults([]);
    if (!text) { workerRef.current?.postMessage({ type: 'cancel' }); setSearchPending(false); return; }
    setSearchPending(true);
    const timer = window.setTimeout(() => {
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'query', query: text, requestId });
      } else {
        // No Worker? Still search content, not just page names.
        const needle = text.toLowerCase();
        const hits: SearchHit[] = docs.flatMap(doc => {
          const titleMatch = doc.title.toLowerCase().includes(needle);
          const position = doc.markdown.toLowerCase().indexOf(needle);
          if (!titleMatch && position < 0) return [];
          return [{ id: doc.id, score: titleMatch ? 20 : 5,
            source: position >= 0 ? 'content' as const : 'title' as const,
            snippet: position >= 0 ? doc.markdown.slice(Math.max(0, position - 42), position + needle.length + 95)
              .replace(/\s+/g, ' ').trim() : '' }];
        }).sort((a, b) => b.score - a.score).slice(0, 80);
        if (requestId === searchRequest.current) {
          setSearchResults(hits);
          setSearchPending(false);
        }
      }
    }, 85);
    return () => clearTimeout(timer);
  }, [query, docs]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'b' && event.metaKey && !event.shiftKey) {
        event.preventDefault();
        setSidebarOpen(current => !current);
      } else if (key === 's') {
        event.preventDefault();
        const doc = live.current.get(activeIdRef.current);
        if (doc) exportDocument(doc);
      } else if (key === 'k' && !event.shiftKey) {
        event.preventDefault(); setSidebarOpen(true);
        window.requestAnimationFrame(() => { searchRef.current?.focus(); searchRef.current?.select(); });
      } else if (key === 'p' && event.shiftKey) {
        event.preventDefault();
        changeMode(modeRef.current === 'preview' ? 'write' : 'preview');
      } else if ('biek'.includes(key) && key !== 'k' || key === 'k' && event.shiftKey) {
        const format = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'e' ? 'code' : 'link';
        event.preventDefault(); formatEditor(editorRef.current, format);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || document.activeElement !== searchRef.current) return;
      event.preventDefault();
      if (query) setQuery('');
      else {
        searchRef.current?.blur();
        if (compact) setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query, compact]);

  const dispatchPreviewPosition = useCallback(() => {
    syncFrame.current = null;
    const target = targetLine.current;
    const preview = previewScrollRef.current;
    if (!target || !preview || target.id !== activeIdRef.current || modeRef.current === 'write') return;
    preview.dispatchEvent(new CustomEvent('flow-preview-position', {
      detail: { line: target.line, total: target.total, kind: target.kind },
    }));
  }, []);
  const onEditorPosition = useCallback((line: number, kind: 'scroll' | 'cursor', total: number) => {
    if (scrollOwner.current !== 'editor' || modeRef.current === 'preview') return;
    // Ignore sub-pixel movement, not entire wrapped logical lines.
    if (kind === 'scroll' && Math.abs(line - lastSyncLine.current) < 0.015) return;
    lastSyncLine.current = line;
    targetLine.current = { line, total, kind, id: activeIdRef.current };
    if (modeRef.current === 'write') return;
    if (kind === 'scroll') {
      // MarkdownEditor already throttles scrolling to one animation frame.
      // An additional frame here made the preview visibly trail long documents.
      if (syncFrame.current !== null) {
        cancelAnimationFrame(syncFrame.current);
        syncFrame.current = null;
      }
      dispatchPreviewPosition();
    } else if (syncFrame.current === null) {
      syncFrame.current = requestAnimationFrame(dispatchPreviewPosition);
    }
  }, [dispatchPreviewPosition]);
  const restoreModePosition = useCallback(() => {
    const target = modeRestore.current;
    if (!target || target.id !== activeIdRef.current) return;
    const view = editorRef.current;
    if (view && modeRef.current !== 'preview') restoreEditorPosition(view, target.line, target.smooth,
      target.smooth ? () => modeRestore.current === target : undefined);
    if (modeRef.current !== 'write') {
      targetLine.current = { ...target, kind: target.smooth ? 'jump' : 'scroll' };
      dispatchPreviewPosition();
    }
  }, [dispatchPreviewPosition]);

  useEffect(() => {
    const preview = previewScrollRef.current;
    if (!preview) return;
    let frame: number | null = null;
    let readyFrame: number | null = null;
    const onReady = () => {
      if (modeRef.current === 'write') return;
      if (readyFrame !== null) cancelAnimationFrame(readyFrame);
      readyFrame = requestAnimationFrame(() => {
        readyFrame = null;
        if (modeRestore.current) restoreModePosition();
        else if (scrollOwner.current === 'editor') dispatchPreviewPosition();
      });
    };
    const claim = () => {
      if (modeRef.current !== 'write') {
        cancelHeadingMotion();
        scrollOwner.current = 'preview';
        modeRestore.current = null;
        targetLine.current = null;
        preview.dispatchEvent(new Event('flow-preview-user-scroll'));
      }
    };
    const onScroll = (event: Event) => {
      if (event.target !== preview && !(event.target instanceof HTMLElement && event.target.matches('.preview-is-code .virtual-code-scroll'))) return;
      if (scrollOwner.current !== 'preview' || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const view = editorRef.current;
        if (!view || scrollOwner.current !== 'preview' || modeRef.current === 'write') return;
        const total = view.state.doc.lines;
        const line = previewPosition(preview, total);
        targetLine.current = { id: activeIdRef.current, line, total, kind: 'scroll' };
        lastSyncLine.current = line;
        if (modeRef.current === 'split') restoreEditorPosition(view, line);
      });
    };
    preview.addEventListener('flow-preview-ready', onReady);
    preview.addEventListener('wheel', claim, { passive: true });
    preview.addEventListener('touchstart', claim, { passive: true });
    preview.addEventListener('pointerdown', claim, { passive: true });
    preview.addEventListener('keydown', claim);
    preview.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => {
      preview.removeEventListener('flow-preview-ready', onReady);
      preview.removeEventListener('wheel', claim);
      preview.removeEventListener('touchstart', claim);
      preview.removeEventListener('pointerdown', claim);
      preview.removeEventListener('keydown', claim);
      preview.removeEventListener('scroll', onScroll, true);
      if (frame !== null) cancelAnimationFrame(frame);
      if (readyFrame !== null) cancelAnimationFrame(readyFrame);
    };
  }, [loaded, restoreModePosition, dispatchPreviewPosition, cancelHeadingMotion]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (modeRestore.current) restoreModePosition();
      else if (mode !== 'write' && scrollOwner.current === 'editor') dispatchPreviewPosition();
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, activeId, previewText, restoreModePosition, dispatchPreviewPosition]);
  function startSplitDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingSplit(true);
  }
  function moveSplitDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const area = editorAreaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    splitNext.current = Math.max(22, Math.min(78, ((event.clientX - rect.left) / rect.width) * 100));
    if (splitFrame.current !== null) return;
    splitFrame.current = requestAnimationFrame(() => {
      splitFrame.current = null;
      setSplitPercent(splitNext.current);
      editorRef.current?.requestMeasure();
    });
  }
  function finishSplitDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (splitFrame.current !== null) { cancelAnimationFrame(splitFrame.current); splitFrame.current = null; }
    setSplitPercent(splitNext.current);
    setStoredSplitPercent(splitNext.current);
    setResizingSplit(false);
    editorRef.current?.requestMeasure();
  }
  function changeMode(next: Mode) {
    const previous = modeRef.current;
    if (previous === next) return;
    cancelHeadingMotion();
    const view = editorRef.current;
    const preview = previewScrollRef.current;
    if (view) {
      const total = view.state.doc.lines;
      const line = scrollOwner.current === 'transition' && modeRestore.current
        ? modeRestore.current.line
        : previous === 'preview' || (previous === 'split' && scrollOwner.current === 'preview')
          ? (preview ? previewPosition(preview, total) : targetLine.current?.line || 1)
          : editorPosition(view);
      const target = { id: activeIdRef.current, line, total };
      modeRestore.current = target;
      targetLine.current = { ...target, kind: 'scroll' };
      scrollOwner.current = 'transition';
    }
    modeRef.current = next;
    if (next !== 'write') setPreviewText(view?.state.doc.toString() ?? live.current.get(activeIdRef.current)?.markdown ?? '');
    setMode(next);
    if (next === 'preview') view?.contentDOM.blur();
  }
  const outlineSource = useCallback(() => editorRef.current?.state.doc.toString()
    ?? live.current.get(activeIdRef.current)?.markdown ?? '', []);
  const outlinePosition = useCallback(() => {
    const view = editorRef.current;
    if (!view) return 1;
    if (modeRestore.current?.id === activeIdRef.current) return modeRestore.current.line;
    return modeRef.current === 'preview' || (modeRef.current === 'split' && scrollOwner.current === 'preview')
      ? previewScrollRef.current ? previewPosition(previewScrollRef.current, view.state.doc.lines) : 1
      : editorPosition(view);
  }, []);
  function jumpToHeading(line: number) {
    const view = editorRef.current;
    if (!view || line < 1 || line > view.state.doc.lines) return;
    cancelHeadingMotion();
    const target = { id: activeIdRef.current, line, total: view.state.doc.lines, smooth: !motionOff };
    modeRestore.current = target;
    targetLine.current = { ...target, kind: target.smooth ? 'jump' : 'scroll' };
    scrollOwner.current = 'transition';
    requestAnimationFrame(restoreModePosition);
  }
  function claimEditorScroll() {
    cancelHeadingMotion();
    scrollOwner.current = 'editor';
    modeRestore.current = null;
    targetLine.current = null;
  }
  useEffect(() => cancelHeadingMotion, [cancelHeadingMotion]);
  // A phone's Split mode shows two vertically stacked, independently scrolling panes.
  const presentationMode: Mode = mode;
  const gridColumns = presentationMode === 'split' ? `minmax(0, ${splitPercent}fr) minmax(0, ${100 - splitPercent}fr)`
    : presentationMode === 'preview' ? 'minmax(0, 0fr) minmax(0, 1fr)'
      : 'minmax(0, 1fr) minmax(0, 0fr)';
  const mobileGridRows = presentationMode === 'split' ? 'minmax(0, 1fr) minmax(0, 1fr)'
    : presentationMode === 'preview' ? 'minmax(0, 0fr) minmax(0, 1fr)'
      : 'minmax(0, 1fr) minmax(0, 0fr)';
  // Compositor-friendly transforms only on true hover devices. The phone
  // keeps the exact same controls and never gets sticky synthetic hover.
  const pressMotion = motionOff ? {} : {
    whileHover: compact ? undefined : { y: -1 },
    whileTap: { scale: 0.985 },
    transition: { duration: 0.17, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  };
  // Start the grace period only while a blank draft is not the active page.
  // Keep deadlines across unrelated renders; reopen cancels the countdown.
  useEffect(() => {
    if (!loaded) return;
    const eligible = new Set<string>();
    const timers: number[] = [];
    const deadlines = draftDeadlines.current;
    for (const doc of live.current.values()) {
      if (!canExpireDraft(doc, activeIdRef.current, live.current.values(),
        Boolean(readShareRecord(doc.id) || readSiteRecord(doc.id)))) continue;
      eligible.add(doc.id);
      if (!deadlines.has(doc.id)) deadlines.set(doc.id, Date.now() + EMPTY_DRAFT_IDLE_MS);
      const expire = () => {
        const current = live.current.get(doc.id);
        if (!current || !canExpireDraft(current, activeIdRef.current, live.current.values(),
          Boolean(readShareRecord(doc.id) || readSiteRecord(doc.id)))) {
          deadlines.delete(doc.id); return;
        }
        // Let an outstanding local commit settle before evaluating the stored draft.
        if (saveQueue.current.has(doc.id) || saveTimers.current.has(doc.id)) {
          timers.push(window.setTimeout(expire, 500)); return;
        }
        deadlines.delete(doc.id);
        void deleteTarget({ kind: 'document', id: doc.id }, true);
      };
      timers.push(window.setTimeout(expire, Math.max(0, deadlines.get(doc.id)! - Date.now())));
    }
    for (const id of deadlines.keys()) if (!eligible.has(id)) deadlines.delete(id);
    return () => { for (const timer of timers) clearTimeout(timer); };
    // Deletion uses current refs and the existing guarded persistence path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, docs, activeId]);
  const previousPageId = recentIds.find(id => id !== activeId && live.current.has(id));
  const treeActions = useTreeActions({
    onOpen: selectDocument, onNewFolder: createFolder, onNewDocument: makeDocument,
    onRenameFolder: renameFolder, onRenameDocument: renameDocument, onDuplicateDocument: duplicateDocument,
    onMovePage: movePage, onDeleteFolder: id => { void eraseFolder(id); },
    onDeleteDocument: id => { if (live.current.has(id)) void deleteTarget({ kind: 'document', id }); },
  });
  if (!loaded) return saveState === 'error' ? <main className="boot" role="alert"><FlowMark size={30} /><span>Workspace could not be opened. Reload to retry.</span></main> : <BootShell />;
  return <div className="flow-shell private-workspace" onDragOver={event => event.preventDefault()} onDrop={onDrop}>
    <motion.aside className={'sidebar' + (sidebarOpen ? ' is-open' : '')}
      initial={false} animate={{ width: sidebarOpen ? 232 : 0 }}
      transition={motionOff ? { duration: 0 } : { duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      aria-hidden={!sidebarOpen}
      aria-label="Private pages">
      <motion.div className="sidebar-inner" initial={false}
        animate={{ opacity: sidebarOpen ? 1 : 0, x: sidebarOpen ? 0 : -12,
          filter: motionOff || compact ? 'blur(0px)' : sidebarOpen ? 'blur(0px)' : 'blur(5px)' }}
        transition={motionOff ? { duration: 0 } : { duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        style={{ pointerEvents: sidebarOpen ? 'auto' : 'none' }}>
        <div className="sidebar-brand">
          <motion.div className="brand-lockup" initial={false} animate={{ opacity: sidebarOpen ? 1 : 0, x: sidebarOpen ? 0 : -8 }} transition={motionOff ? { duration: 0 } : { duration: 0.18 }}><span className="brand-mark"><FlowMark size={18} /></span><span>Flow</span></motion.div>
        </div>
        <label className="search-field"><Icon name="search" size={16} />
          <input ref={searchRef} value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && matching.length) {
                event.preventDefault(); selectDocument(matching[0].id); setQuery('');
              }
            }}
            placeholder="Search" aria-label="Search page names and content"
            aria-keyshortcuts="Meta+K Control+K" />
          <kbd aria-hidden="true">{/Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>
        </label>
        <button type="button" className="private-new-page" onClick={() => makeDocument(workspaceId)}>
          <Icon name="edit" size={17}/> New page <kbd>+</kbd>
        </button>
        <WorkspaceTree
          workspaces={workspaces} documents={matching} allDocuments={docs} folders={folders} newFolderId={newFolderId}
          activeId={activeId} activeWorkspaceId={workspaceId} reveal={treeReveal}
          search={query} searchHits={searchResults} searchPending={searchPending}
          {...treeActions}
        />
        <div className="sidebar-bottom">
          <a className="draw-sidebar-entry" href="/draw"><Icon name="edit" size={16} /> Draw screenshots</a>
          {cloudState === 'off' ? <button className="sidebar-bottom-action" disabled={!loaded}
            title="Privately back up every workspace and page to cloud storage. No public links are created."
            onClick={() => { void turnOnBackup(); }}><Icon name="download" size={16} /> Enable cloud backup</button>
            : <div className="sidebar-bottom-action" role="status" title="Private cloud backup; public sharing is separate">
              <Icon name={cloudState === 'synced' ? 'check' : 'history'} size={16} />
              {cloudState === 'synced' ? (backupScope() === 'html' ? 'HTML backup synced' : 'Cloud backup synced') : cloudState === 'error' ? 'Backup failed · retrying' : 'Backing up…'}
            </div>}
          {cloudState !== 'off' && backupScope() === 'html' && <button className="sidebar-bottom-action" disabled={!loaded} onClick={() => { void turnOnBackup(); }}><Icon name="download" size={16} /> Back up all pages</button>}
          {cloudState === 'off'
            ? <button className="sidebar-bottom-action" onClick={() => { void recoverCloudWorkspace(); }}>
                <Icon name="history" size={16} /> Restore cloud backup</button>
            : <button className="sidebar-bottom-action" onClick={() => { void copyRecoveryKey(); }}
                title="Keep this private key outside your browser to restore after clearing site data">
                <Icon name="copy" size={16} /> Copy recovery key</button>}
          <button className="sidebar-bottom-action" onClick={() => { if (previousPageId) selectDocument(previousPageId); }} disabled={!previousPageId}><Icon name="history" size={16} /> Previous page</button>
        </div>
      </motion.div>
    </motion.aside>
    {sidebarOpen && <button className="mobile-backdrop" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
    <div className="main-shell">
      <header className="topbar">
        <div className="document-meta">
          <motion.button {...pressMotion} className="square-button sidebar-toggle" title={sidebarOpen ? 'Hide sidebar' : 'Open sidebar'} aria-label={sidebarOpen ? 'Hide sidebar' : 'Open sidebar'}
            onClick={() => setSidebarOpen(current => !current)}><Icon name="sidebar" size={18} /></motion.button>
          <span className="private-breadcrumb"><Icon name="file" size={15}/><span>{active?.title || 'Untitled'}</span></span>
          <span className="private-visibility"><SuppliedIcon kind="lock" size={14}/>{active && (readShareRecord(active.id) || readSiteRecord(active.id)) ? 'Shared' : 'Private'}</span>

        </div>
        <div className="header-actions">
          <div className="mode-switch" role="group" aria-label="Editor mode">
            {(['write', 'split', 'preview'] as const).map(item => <motion.button key={item} type="button" aria-pressed={mode === item}
              className={mode === item ? 'selected' : ''} whileTap={motionOff ? undefined : { scale: 0.985 }}
              whileHover={motionOff || compact ? undefined : { y: -1 }}
              transition={motionOff ? { duration: 0 } : { duration: 0.17, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => changeMode(item)}>
              {mode === item && <motion.span layoutId="mode-highlight" className="mode-highlight" transition={motionOff ? { duration: 0 } : { duration: 0.22, ease: [0.23, 1, 0.32, 1] }} />}
              <span className="mode-label">{item.charAt(0).toUpperCase() + item.slice(1)}</span>
            </motion.button>)}
          </div>
          <motion.a href="/draw" className="draw-entry" title="Open Draw screenshot annotator" aria-label="Open Draw screenshot annotator"
            whileHover={motionOff || compact ? undefined : { y: -1 }}
            whileTap={motionOff ? undefined : { scale: 0.985 }}
            transition={motionOff ? { duration: 0 } : { duration: 0.17, ease: [0.22, 1, 0.36, 1] }}>
            <Icon name="edit" size={15}/><span>Draw</span></motion.a>
          <motion.button {...pressMotion} type="button" className="share-button"
            title={activeHtml ? 'Share interactive HTML' : 'Share page'} aria-label="Share page" disabled={!active || Boolean(active.asset)}
            onClick={() => setShareOpen(true)}><Icon name="link" size={15} /><span>Share</span></motion.button>
          <motion.button {...pressMotion} type="button" className="export-button"
            title="Export page" aria-label="Export page" aria-haspopup="menu"
            aria-expanded={Boolean(exportMenu)} aria-busy={pdfExporting} disabled={pdfExporting}
            onClick={toggleExport}>
            {pdfExporting ? <TerminalLoader loading /> : <Icon name="download" size={15} />} <span>{pdfExporting ? 'Exporting…' : 'Export'}</span>
          </motion.button>
          <motion.button {...pressMotion} type="button" className="square-button theme-toggle settings-trigger"
            title="Settings" aria-label="Settings" aria-haspopup="dialog" aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(true)}><Icon name="sliders" size={17} /></motion.button>
          <input ref={fileRef} type="file" hidden multiple onChange={onFileSelected} aria-label="Import files" />
        </div>
      </header>
      <div className="subbar private-page-toolbar">
        <div className="formatting-actions" role="toolbar" aria-label="Page actions">
          {activeRepairLanguage && <motion.button type="button" {...pressMotion} className="code-fix-action"
            title={formatActionLabel} aria-label={formatActionLabel} aria-busy={autoFormatting} disabled={autoFormatting}
            onMouseDown={event => event.preventDefault()} onClick={() => { void autoFormatDocument(); }}>
            {autoFormatting ? <TerminalLoader loading /> : <Icon name="format" size={16}/>}
            <span>{autoFormatting ? 'Checking…' : formatActionLabel}</span>
          </motion.button>}
          <motion.button type="button" {...pressMotion} className="copy-all-button"
            title="Copy the entire page" aria-label="Copy all" disabled={!active || Boolean(active.asset)}
            onClick={() => { void copyAll(); }}>
            <Icon name="copy" size={14} /> <span>Copy all</span>
          </motion.button>
          <motion.button {...pressMotion} className="import-action" title="Import files" aria-label="Import files" onClick={() => fileRef.current?.click()}><Icon name="upload" size={14} /><span>Upload</span></motion.button>
        </div>
        <motion.span className="save-indicator" data-save-state={saveState}
            initial={false} aria-hidden={saveState === 'idle'}
            animate={{ opacity: saveState === 'idle' ? 0 : 1, y: saveState === 'idle' ? -2 : 0 }}
            transition={motionOff ? { duration: 0 } : { duration: 0.19, ease: [0.22, 1, 0.36, 1] }}
            aria-label={saveState === 'saving' ? 'Saving page' : saveState === 'saved' ? 'Page saved in ' + saveDuration + ' milliseconds' : saveState === 'error' ? 'Save failed' : undefined}
            role="status" aria-live="polite">
            <span className="save-prefix" aria-hidden="true" />
            <span className="save-label">{saveState === 'error' ? 'Not saved' : saveState === 'saving' ? 'Saving' : 'Saved'}</span>
            {saveState === 'saving' && <TerminalLoader loading />}
            <span className={'save-duration' + (saveDuration <= 0 ? ' is-empty' : '')}>in <NumberFlow value={saveDuration}
              animated={!motionOff}
              spinTiming={{ duration: 260, easing: 'ease-out' }}
              transformTiming={{ duration: 260, easing: 'ease-out' }}
              opacityTiming={{ duration: 160, easing: 'ease-out' }} /> ms</span>
          </motion.span>
        <TokenCounter key={activeId} documentId={activeId} readSource={readTokenSource} />
      </div>
      <motion.main ref={editorAreaRef} className={'editor-area mode-' + mode + (compact ? ' compact' : '') + (resizingSplit ? ' is-resizing' : '')} aria-label="Flow Markdown workspace"
        initial={false} animate={{ gridTemplateColumns: compact ? 'minmax(0, 1fr)' : gridColumns,
          gridTemplateRows: compact ? mobileGridRows : 'minmax(0, 1fr)' }}
        transition={motionOff || resizingSplit || compact || Math.max(active?.markdown.length ?? 0, previewText.length) > 80000 ? { duration: 0 } : { duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        onAnimationComplete={() => { editorRef.current?.requestMeasure(); restoreModePosition(); }}>
        <section className="editor-pane" aria-label="Write Markdown"
          onPointerDownCapture={claimEditorScroll}
          onWheelCapture={claimEditorScroll}
          onTouchStartCapture={claimEditorScroll}
          onKeyDownCapture={claimEditorScroll}>
          {active?.asset ? <AssetPreview document={active} src={assetView?.id === active.id ? assetView.url : null} onExport={() => exportDocument(active)} theme={theme} /> : active && <MarkdownEditor key={active.id} documentId={active.id} initialText={active.markdown}
            fileLanguage={activeFileLanguage} viewRef={editorRef} onChange={onEditorChange} onPosition={onEditorPosition} />}
        </section>
        <section className="preview-pane" data-glass={activeHtml ? htmlSurfaceTone : undefined}
          aria-label="Markdown preview">
          {activeHtml && presentationMode !== 'write' &&
            <button type="button" className="html-preview-popout"
              aria-label="Open full HTML in a new tab" title="Open full HTML in a new tab"
              onClick={openFullHtml}><Icon name="arrowUpRight" size={15} /> <span>Full HTML</span></button>}
          <motion.div ref={previewScrollRef} className="preview-scroll" tabIndex={presentationMode === 'write' ? -1 : 0} aria-label="Scrollable preview" initial={false}
            animate={{ opacity: presentationMode === 'write' ? 0 : 1 }}
            transition={motionOff ? { duration: 0 } : { duration: 0.2, delay: presentationMode === 'write' ? 0 : 0.035 }}>
            <Suspense fallback={<div className="preview-loading">Rendering…</div>}>
              {presentationMode !== 'write' && (active?.asset
                ? <AssetPreview document={active} src={assetView?.id === active.id ? assetView.url : null} onExport={() => exportDocument(active)} theme={theme} />
                : <MarkdownPreview key={active?.id || 'preview'} markdown={previewText} sourceLanguage={active?.language} scrollRef={previewScrollRef} theme={theme} onToggleTask={onToggleTask} onSvgEdit={onSvgEdit} />)}
            </Suspense>
          </motion.div>
        </section>
        {active && !active.asset && !activeHtml && (!activeFileLanguage || activeFileLanguage === 'markdown') &&
          <PageOutline key={active.id} documentId={active.id} getSource={outlineSource}
            getPosition={outlinePosition} onJump={jumpToHeading} />}
        {mode === 'split' && !compact && <div className="split-resizer" role="separator" tabIndex={0}
          aria-label="Resize editor and preview" aria-orientation="vertical"
          aria-valuemin={22} aria-valuemax={78} aria-valuenow={Math.round(splitPercent)}
          title="Drag to resize · arrow keys to adjust"
          style={{ left: splitPercent + '%' }}
          onPointerDown={startSplitDrag} onPointerMove={moveSplitDrag}
          onPointerUp={finishSplitDrag} onPointerCancel={finishSplitDrag}
          onDoubleClick={() => { splitNext.current = 50; setSplitPercent(50); setStoredSplitPercent(50); }}
          onKeyDown={event => {
            const value = event.key === 'ArrowLeft' ? splitPercent - 2
              : event.key === 'ArrowRight' ? splitPercent + 2
              : event.key === 'Home' ? 25 : event.key === 'End' ? 75 : null;
            if (value === null) return;
            event.preventDefault();
            splitNext.current = Math.min(78, Math.max(22, value));
            setSplitPercent(splitNext.current);
            setStoredSplitPercent(splitNext.current);
          }}><span className="split-grip" /></div>}
      </motion.main>
      {createPortal(<AnimatePresence initial={false}>
        {exportMenu && <motion.div role="menu" aria-label="Export page as"
          className="flow-export-menu" style={{ top: exportMenu.top, right: exportMenu.right }}
          initial={motionOff ? false : { opacity: 0, y: -5, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={motionOff ? undefined : { opacity: 0, y: -3, scale: 0.99 }}
          transition={{ duration: motionOff ? 0 : 0.17, ease: [0.22, 1, 0.36, 1] }}>
          <button type="button" role="menuitem"
            onClick={() => {
              setExportMenu(null);
              const current = live.current.get(activeIdRef.current);
              if (current) exportDocument(current);
            }}><Icon name="file" size={15}/><span>Markdown</span><small>.md</small></button>
          <button type="button" role="menuitem" disabled={pdfExporting}
            onClick={() => {
              const current = live.current.get(activeIdRef.current);
              if (current) void exportPdf(current);
            }}><Icon name="download" size={15}/><span>Export as PDF</span><small>.pdf</small></button>
        </motion.div>}
      </AnimatePresence>, document.body)}
      {shareOpen && active && (activeHtml || Boolean(readSiteRecord(active.id))
        ? <HtmlSiteDialog key={active.id} documentId={active.id}
            title={live.current.get(active.id)?.title || active.title}
            getCurrent={() => live.current.get(active.id) || null}
            onClose={() => setShareOpen(false)} />
        : <ShareDialog key={active.id} documentId={active.id}
            title={live.current.get(active.id)?.title || active.title}
            getCurrent={() => live.current.get(active.id) || null}
            onClose={() => setShareOpen(false)} />)}
      {settingsOpen && <DialogFrame id="settings-dialog" title="Settings" icon="settings"
        describedBy="settings-description" onClose={() => setSettingsOpen(false)} footer={<button type="button" className="flow-dialog-button flow-dialog-done" onClick={() => setSettingsOpen(false)}>Done</button>}>
        <p id="settings-description" className="flow-dialog-copy settings-sr-only">Appearance is saved automatically on this device.</p>
        <section className="flow-settings-section">
          <h3>Appearance</h3>
          <div className="flow-appearance" role="group" aria-label="Appearance">
            {(['dark', 'light'] as const).map(option => {
              const selected = theme === option;
              return <button key={option} type="button" data-dialog-initial-focus={selected ? '' : undefined}
                aria-pressed={selected} onClick={() => setTheme(option)}>
                {selected && <motion.span layoutId="settings-appearance" className="flow-appearance-highlight"
                  transition={{ duration: motionOff ? 0 : .18, ease: [0.22, 1, 0.36, 1] }} />}
                <span className={'flow-appearance-chip tone-' + option} aria-hidden="true" />
                <span>{option === 'dark' ? 'Dark' : 'Light'}</span>
              </button>;
            })}
          </div>
        </section>
        <section className="flow-settings-section">
          <div className="flow-settings-label"><h3>Accent color</h3><span>{ACCENT_THEMES.find(option => option.id === accentTheme)?.label}</span></div>
          <div className="flow-accent-palette" role="group" aria-label="Accent color">
            {ACCENT_THEMES.map(option => <button key={option.id} type="button" title={option.label}
              aria-label={option.label} aria-pressed={option.id === accentTheme} onClick={() => setAccentTheme(option.id)}>
              <span className="flow-settings-swatch" style={{ backgroundColor: `var(--palette-${option.id}-600)` }} />
            </button>)}
          </div>
        </section>
      </DialogFrame>}
      <AnimatePresence initial={false}>
        {notice && <motion.div key={notice} role="status" className="notice" aria-live="polite"
          initial={motionOff ? false : { opacity: 0, y: 7 }}
          animate={{ opacity: 1, y: 0 }}
          exit={motionOff ? undefined : { opacity: 0, y: 4 }}
          transition={motionOff ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
          {pdfExporting || importProgress ? <TerminalLoader loading /> : <span className="notice-mark" aria-hidden="true" />}
          <span className="notice-text">{notice}</span>
          <button type="button" title="Dismiss" aria-label="Dismiss message"
            onClick={() => setNotice('')}><Icon name="close" size={14} /></button>
        </motion.div>}
      </AnimatePresence>
    </div>
  </div>;
}
