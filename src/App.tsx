import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { createPortal } from 'react-dom';
import NumberFlow from '@number-flow/react';
import type { EditorView } from '@codemirror/view';
import MarkdownEditor, { formatEditor, type Format } from './components/MarkdownEditor';
import WorkspaceTree from './components/WorkspaceTree';
import { FlowMark, Icon, type IconName } from './components/Icons';
import { downloadMarkdown } from './lib/document';
import { detectRawCode, isMarkdownFile, languageForFile } from './lib/code';
import { svgPreviewDocument } from './lib/svgPreview';
import { readTextImport } from './lib/textImport';
import { formatPlainTextAsMarkdown } from './lib/autoMarkdown';
import { inferTitle, isUntitledTitle } from './lib/title';
import type { SearchHit } from './lib/searchIndex';
import {
  clearRecovery, loadWorkspace, readPrefs, removeDoc, removeFolder, removeWorkspace,
  saveDoc, saveFolder, savePrefs, saveRecovery, saveWorkspace, uid, wordCount,
  type FlowDocument, type Folder, type Mode, type Theme, type Workspace,
} from './lib/store';

const MarkdownPreview = lazy(() => import('./components/MarkdownPreview'));

// Warm the preview's module on idle without blocking the editor or changing
// mobile layout. This removes a cold-import pause on the first preview.
function warmPreviewModule() {
  void import('./components/MarkdownPreview');
}
const FORMATS: { name: Format; icon?: IconName; label: string; shortcut?: string }[] = [
  { name: 'heading', label: 'Heading', shortcut: '#' },
  { name: 'bold', icon: 'bold', label: 'Bold' },
  { name: 'italic', icon: 'italic', label: 'Italic', shortcut: '⌘I' },
  { name: 'link', icon: 'link', label: 'Link', shortcut: '⌘⇧K' },
  { name: 'bullet', icon: 'list', label: 'List', shortcut: '-' },
  { name: 'todo', icon: 'todo', label: 'Task', shortcut: '[ ]' },
  { name: 'quote', icon: 'quote', label: 'Quote' },
  { name: 'code', icon: 'code', label: 'Code', shortcut: '⌘E' },
];

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
  const activeIdRef = useRef('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [newWorkspaceId, setNewWorkspaceId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('dark');
  const [mode, setMode] = useState<Mode>('write');
  const [splitPercent, setSplitPercent] = useState(50);
  const [storedSplitPercent, setStoredSplitPercent] = useState(50);
  const [resizingSplit, setResizingSplit] = useState(false);
  const modeRef = useRef<Mode>('write');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 800px)').matches);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searchPending, setSearchPending] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [words, setWords] = useState(0);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveDuration, setSaveDuration] = useState(0);
  const saveStarted = useRef(new Map<string, number>());
  const [notice, setNotice] = useState('');
  const [exportMenu, setExportMenu] = useState<{ top: number; right: number } | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'document' | 'workspace'; id: string; title: string; count?: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletionInFlight = useRef(false);
  const importInFlight = useRef(false);
  const [assetView, setAssetView] = useState<{ id: string; url: string } | null>(null);
  const editorRef = useRef<EditorView | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const editorAreaRef = useRef<HTMLElement>(null);
  const targetLine = useRef<{ line: number; total: number; kind: 'scroll' | 'cursor'; id: string } | null>(null);
  const syncFrame = useRef<number | null>(null);
  const splitFrame = useRef<number | null>(null);
  const splitNext = useRef<number>(50);
  const lastSyncLine = useRef(-1);
  const workerRef = useRef<Worker | null>(null);
  const searchRequest = useRef(0);
  const saveTimers = useRef(new Map<string, number>());
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
    try {
      worker = new Worker(new URL('./workers/search.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<
        | { type: 'result'; requestId: number; hits: SearchHit[] }
        | { type: 'metrics'; id: string; updatedAt: number; words: number }
      >) => {
        if (event.data.type === 'result' && event.data.requestId === searchRequest.current) {
          setSearchResults(event.data.hits);
          setSearchPending(false);
        } else if (event.data.type === 'metrics') {
          const current = live.current.get(event.data.id);
          if (current && activeIdRef.current === event.data.id &&
            current.updatedAt === event.data.updatedAt) setWords(event.data.words);
        }
      };
      workerRef.current = worker;
    } catch { /* Title-only fallback is available without workers. */ }
    void loadWorkspace().then(data => {
      if (!alive) return;
      // Upgrade older default "Untitled" pages once. Named pages and
      // imported filenames are never silently renamed.
      const restored = data.documents.map(doc => {
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
      setExpandedIds(Array.isArray(prefs.expandedWorkspaceIds)
        ? prefs.expandedWorkspaceIds.filter(id => data.workspaces.some(ws => ws.id === id))
        : data.workspaces.map(ws => ws.id));
      activeIdRef.current = first.id;
      setActiveId(first.id);
      setWorkspaceId(chosenWorkspace.id);
      setRecentIds(Array.isArray(prefs.recentIds) ? prefs.recentIds.filter(id => live.current.has(id)) : [first.id]);
      setTheme(prefs.theme === 'dark' || prefs.theme === 'light' ? prefs.theme
        : 'dark');
      // Never restore a desktop-open drawer over the entire phone editor.
      setSidebarOpen(window.matchMedia('(max-width: 800px)').matches ? false : prefs.sidebarOpen !== false);
      modeRef.current = restoredMode;
      setMode(restoredMode);
      setPreviewText(first.markdown);
      setWords(first.markdown.length < 25000 ? wordCount(first.markdown) : 0);
      worker?.postMessage({ type: 'index', documents: restored.map(({ id, workspaceId, title, markdown, updatedAt }) => ({ id, workspaceId, title, markdown, updatedAt })) });
      if (first.markdown.length >= 25000) worker?.postMessage({ type: 'metrics', document: { id: first.id, markdown: first.markdown, updatedAt: first.updatedAt } });
      setLoaded(true);
    }).catch(() => { if (alive) { setSaveState('error'); setNotice('Local storage could not be opened.'); } });
    return () => {
      alive = false;
      worker?.terminate();
      workerRef.current = null;
      for (const timer of saveTimers.current.values()) clearTimeout(timer);
      for (const timer of visualTimers.current.values()) clearTimeout(timer);
      if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
      if (previewTimer.current !== null) clearTimeout(previewTimer.current);
      if (syncFrame.current !== null) cancelAnimationFrame(syncFrame.current);
      if (splitFrame.current !== null) cancelAnimationFrame(splitFrame.current);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const color = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (color) color.content = theme === 'dark' ? '#0A0A0A' : '#F4F4F4';
  }, [theme]);
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
    savePrefs({ theme, mode, sidebarOpen, activeDocumentId: activeId,
      activeWorkspaceId: workspaceId, recentIds, expandedWorkspaceIds: expandedIds,
      splitPercent: storedSplitPercent });
  }, [loaded, theme, mode, sidebarOpen, activeId, workspaceId, recentIds, expandedIds, storedSplitPercent]);

  const flush = useCallback((id: string) => {
    const timer = saveTimers.current.get(id);
    if (timer !== undefined) { clearTimeout(timer); saveTimers.current.delete(id); }
    const doc = live.current.get(id);
    if (!doc) return;
    const previous = saveQueue.current.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => saveDoc(doc));
    saveQueue.current.set(id, next);
    void next.then(() => {
      if (saveQueue.current.get(id) === next) saveQueue.current.delete(id);
      const latest = live.current.get(id);
      if (latest && latest.updatedAt === doc.updatedAt) {
        if (activeIdRef.current === id) {
          const started = saveStarted.current.get(id);
          if (started !== undefined) setSaveDuration(Math.max(1, Math.round(performance.now() - started)));
          setSaveState('saved');
        }
        saveStarted.current.delete(id);
        clearRecovery(id);
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
      if (doc) saveRecovery(doc);
      for (const id of [...saveTimers.current.keys()]) flush(id);
    };
    window.addEventListener('pagehide', finish);
    const onVisibility = () => { if (document.visibilityState === 'hidden') finish(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.removeEventListener('pagehide', finish); document.removeEventListener('visibilitychange', onVisibility); };
  }, [flush]);

  const scheduleSave = useCallback((doc: FlowDocument) => {
    live.current.set(doc.id, doc);
    saveStarted.current.set(doc.id, performance.now());
    setSaveDuration(0);
    setSaveState('saving');
    const old = saveTimers.current.get(doc.id);
    if (old !== undefined) clearTimeout(old);
    saveTimers.current.set(doc.id, window.setTimeout(() => flush(doc.id), doc.markdown.length > 100000 ? 900 : 340));
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
      } else if (activeIdRef.current === latest.id) setWords(wordCount(latest.markdown));
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
        setWords(wordCount(value));
      }
    }).catch(() => {
      if (!cancelled) setNotice('Could not decode this Markdown file. The original is preserved.');
    });
    return () => { cancelled = true; };
  }, [activeId, loaded, scheduleSave]);

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

  const selectDocument = useCallback((id: string) => {
    const doc = live.current.get(id);
    if (!doc) return;
    const previous = activeIdRef.current;
    if (previous && previous !== id) flush(previous);
    activeIdRef.current = id;
    pendingPreview.current = null;
    if (previewTimer.current !== null) { clearTimeout(previewTimer.current); previewTimer.current = null; }
    if (previewFrame.current !== null) { cancelAnimationFrame(previewFrame.current); previewFrame.current = null; }
    setActiveId(id);
    targetLine.current = null;
    lastSyncLine.current = -1;
    setExpandedIds(ids => ids.includes(doc.workspaceId) ? ids : [...ids, doc.workspaceId]);
    setWorkspaceId(doc.workspaceId);
    setDocs(current => current.map(item => live.current.get(item.id) || item));
    setRecentIds(current => [id, ...current.filter(item => item !== id)].slice(0, 30));
    setPreviewText(doc.markdown);
    setWords(doc.markdown.length < 25000 ? wordCount(doc.markdown) : 0);
    if (doc.markdown.length >= 25000) workerRef.current?.postMessage({ type: 'metrics', document: { id: doc.id, markdown: doc.markdown, updatedAt: doc.updatedAt } });
    setSaveState('idle');
    if (window.innerWidth < 800) setSidebarOpen(false);
  }, [flush]);

  const makeDocument = useCallback((targetWorkspace?: string, targetFolder?: string) => {
    if (!workspaces.length) return;
    const target = targetWorkspace || workspaceId || workspaces[0].id;
    const stamp = Date.now();
    const doc: FlowDocument = {
      id: uid(), workspaceId: target, folderId: targetFolder, title: 'Untitled', titleAuto: true,
      markdown: '', createdAt: stamp, updatedAt: stamp,
    };
    live.current.set(doc.id, doc);
    setDocs(current => [doc, ...current]);
    // A page created from a collapsed workspace must be visible in its tree.
    // Keep the existing folder assignment and show the containing workspace.
    setExpandedIds(ids => ids.includes(target) ? ids : [...ids, target]);
    // Clear any filtered tree so the new page cannot be hidden by search.
    setQuery('');
    selectDocument(doc.id);
    void saveDoc(doc).catch(() => setSaveState('error'));
    window.requestAnimationFrame(() => editorRef.current?.focus());
  }, [selectDocument, workspaceId, workspaces]);

  async function eraseDocument(doc: FlowDocument) {
    // Delete immediately in the UI. Cancel pending writes so a stale save
    // cannot recreate a deleted file after its IndexedDB record is removed.
    const saveTimer = saveTimers.current.get(doc.id);
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimers.current.delete(doc.id);
    const visualTimer = visualTimers.current.get(doc.id);
    if (visualTimer !== undefined) clearTimeout(visualTimer);
    visualTimers.current.delete(doc.id);
    const pendingSave = saveQueue.current.get(doc.id);
    const remaining = [...live.current.values()].filter(item => item.id !== doc.id);
    live.current.delete(doc.id);
    workerRef.current?.postMessage({ type: 'remove', id: doc.id });
    setDocs(remaining);
    setRecentIds(current => current.filter(id => id !== doc.id));
    if (activeIdRef.current === doc.id) {
      const other = remaining[0];
      if (other) selectDocument(other.id);
      else makeDocument(doc.workspaceId);
    }
    try {
      if (pendingSave) await pendingSave.catch(() => {});
      await removeDoc(doc.id);
    } catch {
      // Failed deletion should not silently lose access to the original.
      live.current.set(doc.id, doc);
      setDocs(items => [...items, doc]);
      workerRef.current?.postMessage({ type: 'upsert', document: {
        id: doc.id, workspaceId: doc.workspaceId, title: doc.title,
        markdown: doc.markdown, updatedAt: doc.updatedAt,
      } });
      setNotice("Couldn't delete the page. It's still here.");
    }
  }
  function toggleWorkspace(id: string) {
    setExpandedIds(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]);
  }
  function createWorkspace() {
    const ws: Workspace = { id: uid(), name: 'New workspace', createdAt: Date.now() };
    setWorkspaces(items => [...items, ws]);
    setWorkspaceId(ws.id);
    setExpandedIds(ids => [...ids, ws.id]);
    setNewWorkspaceId(ws.id);
    void saveWorkspace(ws).catch(() => setNotice('Workspace could not be saved.'));
  }
  function createFolder(targetWorkspace: string) {
    if (!workspaces.some(ws => ws.id === targetWorkspace)) return;
    const folder: Folder = { id: uid(), workspaceId: targetWorkspace, name: 'New folder', createdAt: Date.now() };
    setFolders(items => [...items, folder]);
    setExpandedIds(ids => ids.includes(targetWorkspace) ? ids : [...ids, targetWorkspace]);
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
  function renameWorkspace(id: string, name: string) {
    const old = workspaces.find(item => item.id === id);
    if (!old || name === old.name) { setNewWorkspaceId(null); return; }
    const next = { ...old, name };
    setWorkspaces(items => items.map(item => item.id === id ? next : item));
    setNewWorkspaceId(null);
    void saveWorkspace(next).catch(() => setNotice('Workspace rename could not be saved.'));
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
    const remainingWorkspaces = workspaces.filter(item => item.id !== id);
    const deletedDocs = [...live.current.values()].filter(doc => doc.workspaceId === id);
    const otherDocs = [...live.current.values()].filter(doc => doc.workspaceId !== id);
    // Preserve document data if a storage deletion fails; do not silently drop files.
    try {
      for (const doc of deletedDocs) await removeDoc(doc.id);
      for (const folder of folders.filter(item => item.workspaceId === id)) await removeFolder(folder.id);
      await removeWorkspace(id);
    } catch {
      setNotice('Could not delete the workspace completely. Refresh to reconcile your files.');
      return;
    }
    for (const doc of deletedDocs) {
      live.current.delete(doc.id);
      workerRef.current?.postMessage({ type: 'remove', id: doc.id });
    }
    setWorkspaces(remainingWorkspaces);
    setFolders(items => items.filter(folder => folder.workspaceId !== id));
    setExpandedIds(ids => ids.filter(item => item !== id));
    setDocs(otherDocs);
    setRecentIds(ids => ids.filter(docId => live.current.has(docId)));
    if (activeIdRef.current && !live.current.has(activeIdRef.current)) {
      if (otherDocs.length) selectDocument(otherDocs[0].id);
      else makeDocument(remainingWorkspaces[0].id);
    } else if (workspaceId === id) setWorkspaceId(remainingWorkspaces[0].id);
  }
  async function confirmDelete() {
    if (!pendingDelete || deletionInFlight.current) return;
    deletionInFlight.current = true;
    setDeleting(true);
    try {
      if (pendingDelete.kind === 'workspace') await eraseWorkspace(pendingDelete.id);
      else {
        const doc = live.current.get(pendingDelete.id);
        if (doc) await eraseDocument(doc);
      }
      setPendingDelete(null);
    } finally {
      deletionInFlight.current = false;
      setDeleting(false);
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
      setNotice('Could not export PDF. Try again.');
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

  function autoFormatDocument() {
    const view = editorRef.current;
    const current = live.current.get(activeIdRef.current);
    if (!view || !current || current.asset) {
      setNotice('Open an editable page to format.');
      return;
    }
    const source = view.state.doc.toString();
    if (source.length > 180_000) {
      setNotice('This page is too large to auto-format at once.');
      return;
    }
    const formatted = formatPlainTextAsMarkdown(source, { atDocumentStart: true });
    if (formatted === source) {
      setNotice('Already formatted, or this looks like code.');
      return;
    }
    // A single CodeMirror transaction is undoable (Cmd/Ctrl+Z).
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } });
    view.focus();
    setNotice('Markdown formatted · Undo to revert');
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
    const targetWorkspace = workspaceId;

    async function importOne(file: File) {
      if (file.size > 50 * 1024 * 1024) throw new Error(file.name + ' exceeds the 50 MB limit');
      const supportedImage = /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/i.test(file.type);
      const image = supportedImage || /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i.test(file.name);
      const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const recognizedText = file.type.startsWith('text/') ||
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
          const plainText = /\.txt$/i.test(file.name) && !languageForFile(file.name);
          markdown = plainText ? formatPlainTextAsMarkdown(decoded, { atDocumentStart: true }) : decoded;
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
          ? languageForFile(file.name) || detectRawCode(markdown) || undefined : undefined,
        asset: image || binary ? file : undefined,
        titleAuto: false, createdAt: now, updatedAt: now,
      };
      await saveDoc(doc);
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
        setExpandedIds(ids => ids.includes(targetWorkspace) ? ids : [...ids, targetWorkspace]);
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
  const matching = useMemo(() => {
    if (!query.trim()) return [...docs].sort((a, b) => b.updatedAt - a.updatedAt);
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
    if (!text) { setSearchPending(false); return; }
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
        setMode(current => {
          const next = current === 'preview' ? 'write' : 'preview';
          modeRef.current = next;
          if (next !== 'write') setPreviewText(live.current.get(activeIdRef.current)?.markdown || '');
          return next;
        });
      } else if ('biek'.includes(key) && key !== 'k' || key === 'k' && event.shiftKey) {
        const format = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'e' ? 'code' : 'link';
        event.preventDefault(); formatEditor(editorRef.current, format);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flush]);

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
    if (modeRef.current === 'write') return;
    // Ignore sub-pixel movement, not entire wrapped logical lines.
    if (kind === 'scroll' && Math.abs(line - lastSyncLine.current) < 0.015) return;
    lastSyncLine.current = line;
    targetLine.current = { line, total, kind, id: activeIdRef.current };
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
  useEffect(() => {
    if (mode === 'write') return;
    const frame = requestAnimationFrame(() => {
      const view = editorRef.current;
      if (!view || !activeId) return;
      const target = targetLine.current;
      const line = target?.id === activeId ? target.line : view.state.doc.lineAt(view.state.selection.main.head).number;
      onEditorPosition(line, target?.kind || 'cursor', view.state.doc.lines);
    });
    return () => cancelAnimationFrame(frame);
  }, [previewText, mode, activeId, onEditorPosition]);
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
    modeRef.current = next;
    if (next !== 'write') setPreviewText(live.current.get(activeIdRef.current)?.markdown || '');
    setMode(next);
    if (compact && next === 'preview') editorRef.current?.contentDOM.blur();
    if (!compact && next !== 'preview') window.requestAnimationFrame(() => editorRef.current?.focus());
  }
  function changeTitle(value: string) {
    const current = live.current.get(activeIdRef.current);
    if (!current) return;
    const next = { ...current, title: value, titleAuto: false, updatedAt: Date.now() };
    scheduleSave(next);
    setDocs(docs => docs.map(doc => doc.id === next.id ? next : doc));
  }

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
  if (!loaded) return <main className="boot"><FlowMark size={30} /><span>Opening workspace…</span></main>;
  return <div className="flow-shell" onDragOver={event => event.preventDefault()} onDrop={onDrop}>
    <motion.aside className={'sidebar' + (sidebarOpen ? ' is-open' : '')}
      initial={false} animate={{ width: sidebarOpen ? 256 : 0 }}
      transition={motionOff ? { duration: 0 } : { duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      aria-hidden={!sidebarOpen}
      aria-label="Workspaces and pages">
      <motion.div className="sidebar-inner" initial={false}
        animate={{ opacity: sidebarOpen ? 1 : 0, x: sidebarOpen ? 0 : -12,
          filter: motionOff || compact ? 'blur(0px)' : sidebarOpen ? 'blur(0px)' : 'blur(5px)' }}
        transition={motionOff ? { duration: 0 } : { duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        style={{ pointerEvents: sidebarOpen ? 'auto' : 'none' }}>
        <div className="sidebar-brand">
          <motion.div className="brand-lockup" initial={false} animate={{ opacity: sidebarOpen ? 1 : 0, x: sidebarOpen ? 0 : -8 }} transition={motionOff ? { duration: 0 } : { duration: 0.18 }}><span className="brand-mark"><FlowMark size={18} /></span><span>Flow<span className="brand-period">.</span></span></motion.div>
        </div>
        <label className="search-field"><Icon name="search" size={16} />
          <input ref={searchRef} value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && matching.length) {
                event.preventDefault(); selectDocument(matching[0].id); setQuery('');
              }
            }}
            placeholder="Search all pages" aria-label="Search page names and content"
            aria-keyshortcuts="Meta+K Control+K" />
          <kbd aria-hidden="true">{/Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>
        </label>
        <WorkspaceTree
          workspaces={workspaces} documents={matching} folders={folders} newFolderId={newFolderId}
          activeId={activeId} activeWorkspaceId={workspaceId}
          search={query} searchHits={searchResults} searchPending={searchPending} expandedIds={expandedIds}
          newWorkspaceId={newWorkspaceId} reducedMotion={!!motionOff}
          onToggle={toggleWorkspace}
          onSelectWorkspace={setWorkspaceId}
          onOpen={selectDocument}
          onNewWorkspace={createWorkspace}
          onNewFolder={createFolder}
          onNewDocument={makeDocument}
          onRenameFolder={renameFolder}
          onRenameWorkspace={renameWorkspace}
          onRenameDocument={renameDocument}
          onMoveDocument={(id, targetWorkspace) => {
            const original = live.current.get(id);
            if (!original || (original.workspaceId === targetWorkspace && !original.folderId)) return;
            const moved = { ...original, workspaceId: targetWorkspace, folderId: undefined, updatedAt: Date.now() };
            scheduleSave(moved);
            setDocs(items => items.map(doc => doc.id === id ? moved : doc));
            setExpandedIds(ids => ids.includes(targetWorkspace) ? ids : [...ids, targetWorkspace]);
            if (activeIdRef.current === id) setWorkspaceId(targetWorkspace);
          }}
          onMoveToFolder={(id, folderId) => {
            const folder = folders.find(item => item.id === folderId);
            const original = live.current.get(id);
            if (!folder || !original) return;
            if (original.workspaceId === folder.workspaceId && original.folderId === folder.id) return;
            const moved = { ...original, workspaceId: folder.workspaceId, folderId: folder.id, updatedAt: Date.now() };
            scheduleSave(moved);
            setDocs(items => items.map(doc => doc.id === id ? moved : doc));
            if (activeIdRef.current === id) setWorkspaceId(folder.workspaceId);
          }}
          onDeleteFolder={id => { void eraseFolder(id); }}
          onDeleteWorkspace={id => {
            const ws = workspaces.find(item => item.id === id);
            if (ws) setPendingDelete({ kind: 'workspace', id, title: ws.name,
              count: [...live.current.values()].filter(doc => doc.workspaceId === id).length });
          }}
          onDeleteDocument={id => {
            const doc = live.current.get(id);
            if (doc) void eraseDocument(doc);
          }}
        />
        <div className="sidebar-bottom">
          <a className="draw-sidebar-entry" href="/draw"><Icon name="edit" size={16} /> Draw screenshots</a>
          <button className="sidebar-bottom-action" onClick={() => makeDocument(workspaceId)}><Icon name="plus" size={16} /> Add page</button>
          <button className="sidebar-bottom-action" onClick={() => { if (recentIds[1]) selectDocument(recentIds[1]); }} disabled={!recentIds[1]}><Icon name="history" size={16} /> Previous page</button>
        </div>
      </motion.div>
    </motion.aside>
    {sidebarOpen && <button className="mobile-backdrop" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
    <div className="main-shell">
      <header className="topbar">
        <div className="document-meta">
          <motion.button {...pressMotion} className="square-button sidebar-toggle" title={sidebarOpen ? 'Hide sidebar' : 'Open sidebar'} aria-label={sidebarOpen ? 'Hide sidebar' : 'Open sidebar'}
            onClick={() => setSidebarOpen(current => !current)}><Icon name="sidebar" size={18} /></motion.button>
          <input ref={titleRef} className="document-title" aria-label="Page title" spellCheck={false}
            value={active?.title || ''} onChange={event => changeTitle(event.target.value)} placeholder="Untitled" />
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
          <motion.button {...pressMotion} type="button" className="export-button"
            title="Export page" aria-label="Export page" aria-haspopup="menu"
            aria-expanded={Boolean(exportMenu)} aria-busy={pdfExporting} disabled={pdfExporting}
            onClick={toggleExport}>
            {pdfExporting ? <TerminalLoader loading /> : <Icon name="download" size={15} />} <span>{pdfExporting ? 'Exporting…' : 'Export'}</span>
          </motion.button>
          <motion.button {...pressMotion} type="button" className="square-button theme-toggle" title={theme === 'light' ? 'Dark mode' : 'Light mode'} aria-label={theme === 'light' ? 'Dark mode' : 'Light mode'} onClick={() => setTheme(current => current === 'light' ? 'dark' : 'light')}>
            <AnimatePresence initial={false} mode="wait"><motion.span key={theme} className="theme-icon" initial={motionOff ? false : { opacity: 0, rotate: -25 }} animate={{ opacity: 1, rotate: 0 }} exit={motionOff ? undefined : { opacity: 0, rotate: 25 }} transition={{ duration: motionOff ? 0 : 0.15 }}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={17} /></motion.span></AnimatePresence>
          </motion.button>
          <input ref={fileRef} type="file" hidden multiple onChange={onFileSelected} aria-label="Import files" />
        </div>
      </header>
      <div className="subbar">
        <div className="formatting-actions" role="toolbar" aria-label="Markdown formatting">
          {FORMATS.map(format => <motion.button key={format.name} type="button" whileTap={motionOff ? undefined : { scale: 0.985 }}
            whileHover={motionOff || compact ? undefined : { y: -1 }}
            transition={motionOff ? { duration: 0 } : { duration: 0.17, ease: [0.22, 1, 0.36, 1] }}
            title={format.label + (format.shortcut ? ' · ' + format.shortcut : '')} aria-label={format.label}
            onClick={() => { if (mode === 'preview') changeMode('write'); window.requestAnimationFrame(() => formatEditor(editorRef.current, format.name)); }}>
            {format.icon ? <Icon name={format.icon} size={16} /> : format.name === 'heading' ? <span className="format-heading">H<span>1</span></span>
              : <span className={format.name === 'bold' ? 'format-bold' : 'format-italic'}>{format.name === 'bold' ? 'B' : 'I'}</span>}
          </motion.button>)}
          <span className="format-divider" />
          <motion.button type="button" {...pressMotion} className="auto-markdown-button"
            title="Auto Markdown · clean whitespace and format unstyled text"
            aria-label="Auto Markdown" disabled={Boolean(active?.asset)}
            onClick={autoFormatDocument}>
            <Icon name="format" size={16} /> <span>Auto Markdown</span>
          </motion.button>
          <motion.button type="button" {...pressMotion} className="copy-all-button"
            title="Copy the entire page" aria-label="Copy all" disabled={!active || Boolean(active.asset)}
            onClick={() => { void copyAll(); }}>
            <Icon name="copy" size={16} /> <span>Copy all</span>
          </motion.button>
          <motion.button {...pressMotion} title="Import files" aria-label="Import files" onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /></motion.button>
        </div>
        <span className="word-stat">{active?.fileType === 'image' ? 'Image' : active?.fileType === 'binary' ? 'File' : `${words.toLocaleString()} words`}</span>
      </div>
      <motion.main ref={editorAreaRef} className={'editor-area mode-' + mode + (compact ? ' compact' : '') + (resizingSplit ? ' is-resizing' : '')} aria-label="Flow Markdown workspace"
        initial={false} animate={{ gridTemplateColumns: compact ? 'minmax(0, 1fr)' : gridColumns,
          gridTemplateRows: compact ? mobileGridRows : 'minmax(0, 1fr)' }}
        transition={motionOff || resizingSplit ? { duration: 0 } : { duration: 0.29, ease: [0.22, 1, 0.36, 1] }}
        onAnimationComplete={() => editorRef.current?.requestMeasure()}>
        <section className="editor-pane" aria-label="Write Markdown">
          {active?.asset ? <AssetPreview document={active} src={assetView?.id === active.id ? assetView.url : null} onExport={() => exportDocument(active)} theme={theme} /> : active && <MarkdownEditor key={active.id} documentId={active.id} initialText={active.markdown}
            viewRef={editorRef} onChange={onEditorChange} onPosition={onEditorPosition} />}
        </section>
        <section className="preview-pane" aria-label="Markdown preview">
          <motion.div ref={previewScrollRef} className="preview-scroll" initial={false}
            animate={{ opacity: presentationMode === 'write' ? 0 : 1 }}
            transition={motionOff ? { duration: 0 } : { duration: 0.2, delay: presentationMode === 'write' ? 0 : 0.035 }}>
            <Suspense fallback={<div className="preview-loading">Rendering…</div>}>
              {presentationMode !== 'write' && (active?.asset
                ? <AssetPreview document={active} src={assetView?.id === active.id ? assetView.url : null} onExport={() => exportDocument(active)} theme={theme} />
                : <MarkdownPreview key={active?.id || 'preview'} markdown={previewText} sourceLanguage={active?.language} scrollRef={previewScrollRef} theme={theme} />)}
            </Suspense>
          </motion.div>
        </section>
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
      <AnimatePresence initial={false}>
      {pendingDelete && <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: motionOff ? 0 : 0.16 }}
        onMouseDown={event => { if (event.target === event.currentTarget && !deleting) setPendingDelete(null); }}>
        <motion.section className="delete-dialog" initial={motionOff ? false : { opacity: 0, y: 9, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={motionOff ? undefined : { opacity: 0, y: 5, scale: 0.99 }}
          transition={motionOff ? { duration: 0 } : { duration: 0.21, ease: [0.22, 1, 0.36, 1] }} role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description">
          <div className="dialog-header"><Icon name="trash" size={17} /><button type="button" aria-label="Close dialog" disabled={deleting} onClick={() => setPendingDelete(null)}><Icon name="close" size={15} /></button></div>
          <h2 id="delete-dialog-title">Delete {pendingDelete.kind === 'document' ? 'page' : 'workspace'}?</h2>
          <p id="delete-dialog-description">“{pendingDelete.title}”{pendingDelete.kind === 'workspace' ? ` and ${pendingDelete.count || 0} page${pendingDelete.count === 1 ? '' : 's'}` : ''} will be removed from this browser. This can't be undone.</p>
          <div className="dialog-actions">
            <button autoFocus type="button" disabled={deleting} className="dialog-cancel" onClick={() => setPendingDelete(null)}>Cancel</button>
            <button type="button" disabled={deleting} className="dialog-delete" aria-label={deleting ? 'Deleting' : 'Delete'} onClick={() => { void confirmDelete(); }}>
              {deleting && <TerminalLoader loading />}{deleting ? 'Deleting' : 'Delete'}
            </button>
          </div>
        </motion.section>
      </motion.div>}
      </AnimatePresence>
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
