import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { EditorView } from '@codemirror/view';
import MarkdownEditor, { formatEditor, type Format } from './components/MarkdownEditor';
import WorkspaceTree from './components/WorkspaceTree';
import { FlowMark, Icon, type IconName } from './components/Icons';
import { downloadMarkdown } from './lib/document';
import { detectRawCode, isMarkdownFile, languageForFile } from './lib/code';
import {
  clearRecovery, inferTitle, loadWorkspace, readPrefs, removeDoc, removeWorkspace,
  saveDoc, savePrefs, saveRecovery, saveWorkspace, uid, wordCount,
  type FlowDocument, type Mode, type Theme, type Workspace,
} from './lib/store';

const MarkdownPreview = lazy(() => import('./components/MarkdownPreview'));
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FORMATS: { name: Format; icon?: IconName; label: string; shortcut?: string }[] = [
  { name: 'heading', label: 'Heading', shortcut: '#' },
  { name: 'bold', label: 'Bold', shortcut: '⌘B' },
  { name: 'italic', label: 'Italic', shortcut: '⌘I' },
  { name: 'link', icon: 'link', label: 'Link', shortcut: '⌘K' },
  { name: 'bullet', icon: 'list', label: 'List', shortcut: '-' },
  { name: 'todo', icon: 'todo', label: 'Task', shortcut: '[ ]' },
  { name: 'quote', icon: 'quote', label: 'Quote' },
  { name: 'code', icon: 'code', label: 'Code', shortcut: '⌘E' },
];

function TerminalLoader({ loading }: { loading: boolean }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!loading) { setFrame(0); return; }
    const interval = window.setInterval(() => setFrame(current => (current + 1) % SPINNER.length), 80);
    return () => window.clearInterval(interval);
  }, [loading]);
  return loading ? <span className="terminal-loader" aria-hidden="true">{SPINNER[frame]}</span> : null;
}
function AssetPreview({ document: doc, src, onExport }: {
  document: FlowDocument; src: string | null; onExport: () => void;
}) {
  return <div className="asset-preview">
    {doc.fileType === 'image' && src
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
  const [docs, setDocs] = useState<FlowDocument[]>([]);
  const live = useRef(new Map<string, FlowDocument>());
  const [activeId, setActiveId] = useState('');
  const activeIdRef = useRef('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [newWorkspaceId, setNewWorkspaceId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('light');
  const [mode, setMode] = useState<Mode>('write');
  const modeRef = useRef<Mode>('write');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 800px)').matches);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [previewText, setPreviewText] = useState('');
  const [words, setWords] = useState(0);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saved');
  const [notice, setNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'document' | 'workspace'; id: string; title: string; count?: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletionInFlight = useRef(false);
  const importInFlight = useRef(false);
  const [assetView, setAssetView] = useState<{ id: string; url: string } | null>(null);
  const editorRef = useRef<EditorView | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const searchRequest = useRef(0);
  const saveTimers = useRef(new Map<string, number>());
  const visualTimers = useRef(new Map<string, number>());
  const previewFrame = useRef<number | null>(null);
  const pendingPreview = useRef<{ id: string; markdown: string } | null>(null);
  const motionOff = useReducedMotion();

  useEffect(() => {
    let alive = true;
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./workers/search.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ type: string; requestId: number; ids: string[] }>) => {
        if (event.data.type === 'result' && event.data.requestId === searchRequest.current) {
          setSearchResults(event.data.ids);
        }
      };
      workerRef.current = worker;
    } catch { /* Title-only fallback is available without workers. */ }
    void loadWorkspace().then(data => {
      if (!alive) return;
      live.current = new Map(data.documents.map(doc => [doc.id, doc]));
      const prefs = readPrefs();
      const first = data.documents.find(doc => doc.id === prefs.activeDocumentId) || data.documents[0];
      const chosenWorkspace = data.workspaces.find(ws => ws.id === prefs.activeWorkspaceId) ||
        data.workspaces.find(ws => ws.id === first.workspaceId) || data.workspaces[0];
      const restoredMode = prefs.mode === 'preview' || prefs.mode === 'split' ? prefs.mode : 'write';
      setDocs(data.documents);
      setWorkspaces(data.workspaces);
      setExpandedIds(Array.isArray(prefs.expandedWorkspaceIds)
        ? prefs.expandedWorkspaceIds.filter(id => data.workspaces.some(ws => ws.id === id))
        : data.workspaces.map(ws => ws.id));
      activeIdRef.current = first.id;
      setActiveId(first.id);
      setWorkspaceId(chosenWorkspace.id);
      setRecentIds(Array.isArray(prefs.recentIds) ? prefs.recentIds.filter(id => live.current.has(id)) : [first.id]);
      setTheme(prefs.theme === 'dark' || prefs.theme === 'light' ? prefs.theme
        : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      // Never restore a desktop-open drawer over the entire phone editor.
      setSidebarOpen(window.matchMedia('(max-width: 800px)').matches ? false : prefs.sidebarOpen !== false);
      modeRef.current = restoredMode;
      setMode(restoredMode);
      setPreviewText(first.markdown);
      setWords(wordCount(first.markdown));
      worker?.postMessage({ type: 'index', documents: data.documents.map(({ id, workspaceId, title, markdown, updatedAt }) => ({ id, workspaceId, title, markdown, updatedAt })) });
      setLoaded(true);
    }).catch(() => { if (alive) { setSaveState('error'); setNotice('Local storage could not be opened.'); } });
    return () => {
      alive = false;
      worker?.terminate();
      workerRef.current = null;
      for (const timer of saveTimers.current.values()) clearTimeout(timer);
      for (const timer of visualTimers.current.values()) clearTimeout(timer);
      if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const color = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (color) color.content = theme === 'dark' ? '#191817' : '#ffffff';
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
    const update = () => {
      const height = viewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--flow-viewport-height', Math.round(height) + 'px');
    };
    update();
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--flow-viewport-height');
    };
  }, [compact]);
  useEffect(() => {
    if (!loaded) return;
    savePrefs({ theme, mode, sidebarOpen, activeDocumentId: activeId,
      activeWorkspaceId: workspaceId, recentIds, expandedWorkspaceIds: expandedIds });
  }, [loaded, theme, mode, sidebarOpen, activeId, workspaceId, recentIds, expandedIds]);

  const flush = useCallback((id: string) => {
    const timer = saveTimers.current.get(id);
    if (timer !== undefined) { clearTimeout(timer); saveTimers.current.delete(id); }
    const doc = live.current.get(id);
    if (!doc) return;
    void saveDoc(doc).then(() => {
      if (activeIdRef.current === id) setSaveState('saved');
      clearRecovery(id);
    }).catch(() => { if (activeIdRef.current === id) setSaveState('error'); });
  }, []);

  useEffect(() => {
    const finish = () => {
      const doc = live.current.get(activeIdRef.current);
      if (doc) saveRecovery(doc);
      for (const id of saveTimers.current.keys()) flush(id);
    };
    window.addEventListener('pagehide', finish);
    const onVisibility = () => { if (document.visibilityState === 'hidden') finish(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.removeEventListener('pagehide', finish); document.removeEventListener('visibilitychange', onVisibility); };
  }, [flush]);

  const scheduleSave = useCallback((doc: FlowDocument) => {
    live.current.set(doc.id, doc);
    setSaveState('saving');
    const old = saveTimers.current.get(doc.id);
    if (old !== undefined) clearTimeout(old);
    saveTimers.current.set(doc.id, window.setTimeout(() => flush(doc.id), 170));
    const visual = visualTimers.current.get(doc.id);
    if (visual !== undefined) clearTimeout(visual);
    visualTimers.current.set(doc.id, window.setTimeout(() => {
      const latest = live.current.get(doc.id);
      if (!latest) return;
      setDocs(current => current.map(item => item.id === latest.id ? latest : item));
      workerRef.current?.postMessage({ type: 'upsert', document: { id: latest.id, workspaceId: latest.workspaceId, title: latest.title, markdown: latest.markdown, updatedAt: latest.updatedAt } });
      if (activeIdRef.current === latest.id) setWords(wordCount(latest.markdown));
      visualTimers.current.delete(doc.id);
    }, 360));
  }, [flush]);

  const onEditorChange = useCallback((value: string) => {
    const id = activeIdRef.current;
    const current = live.current.get(id);
    if (!current || current.markdown === value) return;
    const next: FlowDocument = {
      ...current, markdown: value, updatedAt: Date.now(),
      title: current.titleAuto || !current.title.trim() || current.title === 'Untitled' ? inferTitle(value) : current.title,
      titleAuto: current.titleAuto || !current.title.trim() || current.title === 'Untitled',
    };
    scheduleSave(next);
    // Coalesce edits to one preview update per animation frame, never after an idle delay.
    if (modeRef.current !== 'write') {
      pendingPreview.current = { id, markdown: value };
      if (previewFrame.current === null) {
        previewFrame.current = requestAnimationFrame(() => {
          previewFrame.current = null;
          const snapshot = pendingPreview.current;
          if (snapshot && snapshot.id === activeIdRef.current && modeRef.current !== 'write') {
            setPreviewText(snapshot.markdown);
          }
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
    if (previewFrame.current !== null) { cancelAnimationFrame(previewFrame.current); previewFrame.current = null; }
    setActiveId(id);
    setExpandedIds(ids => ids.includes(doc.workspaceId) ? ids : [...ids, doc.workspaceId]);
    setWorkspaceId(doc.workspaceId);
    setDocs(current => current.map(item => live.current.get(item.id) || item));
    setRecentIds(current => [id, ...current.filter(item => item !== id)].slice(0, 30));
    setPreviewText(doc.markdown);
    setWords(wordCount(doc.markdown));
    setSaveState('saved');
    if (window.innerWidth < 800) setSidebarOpen(false);
  }, [flush]);

  const makeDocument = useCallback((targetWorkspace?: string) => {
    if (!workspaces.length) return;
    const target = targetWorkspace || workspaceId || workspaces[0].id;
    const stamp = Date.now();
    const doc: FlowDocument = {
      id: uid(), workspaceId: target, title: 'Untitled', titleAuto: true,
      markdown: '', createdAt: stamp, updatedAt: stamp,
    };
    live.current.set(doc.id, doc);
    setDocs(current => [doc, ...current]);
    selectDocument(doc.id);
    void saveDoc(doc).catch(() => setSaveState('error'));
    window.requestAnimationFrame(() => editorRef.current?.focus());
  }, [selectDocument, workspaceId, workspaces]);

  async function eraseDocument(doc: FlowDocument) {
    const remaining = [...live.current.values()].filter(item => item.id !== doc.id);
    live.current.delete(doc.id);
    workerRef.current?.postMessage({ type: 'remove', id: doc.id });
    setDocs(remaining);
    setRecentIds(current => current.filter(id => id !== doc.id));
    try { await removeDoc(doc.id); } catch { setNotice('Document deletion could not be saved.'); }
    if (activeIdRef.current === doc.id) {
      const other = remaining[0];
      if (other) selectDocument(other.id);
      else makeDocument(doc.workspaceId);
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
  async function importFiles(incoming: File[]) {
    if (!incoming.length || importInFlight.current) return;
    importInFlight.current = true;
    setSaveState('saving');
    const imported: FlowDocument[] = [];
    const errors: string[] = [];
    try {
      for (const file of incoming) {
        if (file.size > 50 * 1024 * 1024) {
          errors.push(file.name + ' exceeds the 50 MB limit');
          continue;
        }
        try {
          const supportedImage = /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/i.test(file.type);
          const image = supportedImage || /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i.test(file.name);
          const recognizedText = file.type.startsWith('text/') ||
            /^(application\/(?:json|javascript|xml|x-javascript|x-yaml|yaml|toml|graphql))$/i.test(file.type) ||
            Boolean(languageForFile(file.name)) || isMarkdownFile(file.name) ||
            /\.(txt|csv|tsv|log|ini|cfg|env|gitignore|editorconfig)$/i.test(file.name);
          let binary = !image && Boolean(file.type && !recognizedText);
          let markdown = '';
          if (!image && !binary) {
            const sample = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
            binary = sample.includes(0);
            if (!binary) {
              try { new TextDecoder('utf-8', { fatal: true }).decode(sample); }
              catch { binary = true; }
            }
            if (!binary) markdown = await file.text();
          }
          const now = Date.now();
          const fileType = image ? 'image' : binary ? 'binary' : 'text';
          const doc: FlowDocument = {
            id: uid(), workspaceId, markdown,
            title: file.name.replace(/\.[^.]+$/, '') || file.name,
            fileName: file.name, fileType,
            language: fileType === 'text' && !isMarkdownFile(file.name)
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
        } catch {
          errors.push('Could not import ' + file.name);
        }
      }
      if (imported.length) {
        setDocs(current => [...imported.slice().reverse(), ...current]);
        selectDocument(imported[0].id);
        setNotice(imported.length === 1 ? 'Imported ' + imported[0].fileName : 'Imported ' + imported.length + ' files');
      }
      if (errors.length) setNotice(errors.join(' · '));
      setSaveState(errors.length ? 'error' : 'saved');
    } finally {
      importInFlight.current = false;
    }
  }
  function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void importFiles(files);
  }
  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    void importFiles(Array.from(event.dataTransfer.files));
  }
  const active = live.current.get(activeId) || docs.find(doc => doc.id === activeId);
  const matching = useMemo(() => query.trim()
    ? searchResults.map(id => docs.find(doc => doc.id === id)).filter((doc): doc is FlowDocument => !!doc)
    : [...docs].sort((a, b) => b.updatedAt - a.updatedAt),
    [docs, query, searchResults]);
  useEffect(() => {
    const requestId = ++searchRequest.current;
    if (!query.trim()) { setSearchResults([]); return; }
    const timer = window.setTimeout(() => {
      if (workerRef.current) workerRef.current.postMessage({ type: 'query', query, requestId });
      else setSearchResults(docs.filter(doc => doc.title.toLowerCase().includes(query.toLowerCase())).map(doc => doc.id));
    }, 160);
    return () => clearTimeout(timer);
  }, [query, docs]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        const doc = live.current.get(activeIdRef.current);
        if (doc) exportDocument(doc);
      } else if (key === 'k' && !event.shiftKey) {
        event.preventDefault(); setSidebarOpen(true); window.requestAnimationFrame(() => searchRef.current?.focus());
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
  const gridColumns = presentationMode === 'split' ? 'minmax(0, 1fr) minmax(0, 1fr)'
    : presentationMode === 'preview' ? 'minmax(0, 0fr) minmax(0, 1fr)'
      : 'minmax(0, 1fr) minmax(0, 0fr)';
  const mobileGridRows = presentationMode === 'split' ? 'minmax(0, 1fr) minmax(0, 1fr)'
    : presentationMode === 'preview' ? 'minmax(0, 0fr) minmax(0, 1fr)'
      : 'minmax(0, 1fr) minmax(0, 0fr)';
  const pressMotion = motionOff ? {} : { whileHover: { scale: 1.035 }, whileTap: { scale: 0.965 } };
  if (!loaded) return <main className="boot"><FlowMark size={30} /><span>Opening workspace…</span></main>;
  return <div className="flow-shell" onDragOver={event => event.preventDefault()} onDrop={onDrop}>
    <motion.aside className={'sidebar' + (sidebarOpen ? ' is-open' : '')}
      initial={false} animate={{ width: sidebarOpen ? 256 : 0 }}
      transition={motionOff ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Documents">
      <div className="sidebar-inner">
        <div className="sidebar-brand">
          <motion.div className="brand-lockup" initial={false} animate={{ opacity: sidebarOpen ? 1 : 0, x: sidebarOpen ? 0 : -8 }} transition={motionOff ? { duration: 0 } : { duration: 0.18 }}><span className="brand-mark"><FlowMark size={18} /></span><span>Flow</span></motion.div>
        </div>
        <label className="search-field"><Icon name="search" size={16} />
          <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search documents" aria-label="Search documents" />
        </label>
        <div className="sidebar-heading documents-heading"><span>{query ? 'Results' : 'Documents'}</span>
          <motion.button {...pressMotion} title="New document" aria-label="New document" onClick={() => makeDocument()}><Icon name="plus" size={15} /></motion.button>
        </div>
        <div className="document-list">
          {matching.map(doc => <div key={doc.id} className={'document-entry' + (activeId === doc.id ? ' active' : '')}>
            <motion.button className="document-select" whileTap={motionOff ? undefined : { scale: 0.994 }} transition={{ duration: 0.12 }} onClick={() => selectDocument(doc.id)}>
              <Icon name={doc.fileType === 'image' ? 'svg' : 'file'} size={15} /><span className="document-label">{doc.title || 'Untitled'}</span>
              <span className="md-tag">{doc.fileName?.match(/\.[^.]+$/)?.[0] || '.md'}</span>
            </motion.button>
            <button className="row-delete" aria-label={'Delete ' + doc.title} title="Delete document" onClick={() => setPendingDelete({ id: doc.id, title: doc.title.trim() || 'Untitled' })}><Icon name="trash" size={13} /></button>
          </div>)}
          {!matching.length && <span className="no-results">{query ? 'No documents found' : 'No documents yet'}</span>}
        </div>
        <div className="sidebar-bottom">
          <button className="sidebar-bottom-action" onClick={() => { if (recentIds[1]) selectDocument(recentIds[1]); }} disabled={!recentIds[1]}><Icon name="history" size={16} /> Previous document</button>
        </div>
      </div>
    </motion.aside>
    {sidebarOpen && <button className="mobile-backdrop" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
    <div className="main-shell">
      <header className="topbar">
        <div className="document-meta">
          <motion.button {...pressMotion} className="square-button sidebar-toggle" title={sidebarOpen ? 'Hide sidebar' : 'Open sidebar'} aria-label={sidebarOpen ? 'Hide sidebar' : 'Open sidebar'}
            onClick={() => setSidebarOpen(current => !current)}><Icon name="sidebar" size={18} /></motion.button>
          <input ref={titleRef} className="document-title" aria-label="Document title" spellCheck={false}
            value={active?.title || ''} onChange={event => changeTitle(event.target.value)} placeholder="Untitled" />
          <span className="save-indicator" data-save-state={saveState} aria-label={saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : 'Save failed'} role="status">
            {saveState === 'saving' && <TerminalLoader loading />}{saveState === 'error' ? 'Not saved' : saveState === 'saving' ? 'Saving' : 'Saved'}
          </span>
        </div>
        <div className="header-actions">
          <div className="mode-switch" role="group" aria-label="Editor mode">
            {(['write', 'split', 'preview'] as const).map(item => <motion.button key={item} type="button" aria-pressed={mode === item}
              className={mode === item ? 'selected' : ''} whileTap={motionOff ? undefined : { scale: 0.96 }} onClick={() => changeMode(item)}>
              {mode === item && <motion.span layoutId="mode-highlight" className="mode-highlight" transition={motionOff ? { duration: 0 } : { type: 'spring', stiffness: 550, damping: 42 }} />}
              <span className="mode-label">{item.charAt(0).toUpperCase() + item.slice(1)}</span>
            </motion.button>)}
          </div>
          <motion.button {...pressMotion} type="button" className="export-button" onClick={() => { const doc = live.current.get(activeIdRef.current); if (doc) exportDocument(doc); }}><Icon name="download" size={15} /> <span>Export</span></motion.button>
          <motion.button {...pressMotion} type="button" className="square-button theme-toggle" title={theme === 'light' ? 'Dark mode' : 'Light mode'} aria-label={theme === 'light' ? 'Dark mode' : 'Light mode'} onClick={() => setTheme(current => current === 'light' ? 'dark' : 'light')}>
            <AnimatePresence initial={false} mode="wait"><motion.span key={theme} className="theme-icon" initial={motionOff ? false : { opacity: 0, rotate: -25 }} animate={{ opacity: 1, rotate: 0 }} exit={motionOff ? undefined : { opacity: 0, rotate: 25 }} transition={{ duration: motionOff ? 0 : 0.15 }}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={17} /></motion.span></AnimatePresence>
          </motion.button>
          <input ref={fileRef} type="file" hidden multiple onChange={onFileSelected} aria-label="Import files" />
        </div>
      </header>
      <div className="subbar">
        <div className="formatting-actions" role="toolbar" aria-label="Markdown formatting">
          {FORMATS.map(format => <motion.button key={format.name} type="button" whileTap={motionOff ? undefined : { scale: 0.94 }} title={format.label + (format.shortcut ? ' · ' + format.shortcut : '')} aria-label={format.label}
            onClick={() => { if (mode === 'preview') changeMode('write'); window.requestAnimationFrame(() => formatEditor(editorRef.current, format.name)); }}>
            {format.icon ? <Icon name={format.icon} size={16} /> : format.name === 'heading' ? <span className="format-heading">H<span>1</span></span>
              : <span className={format.name === 'bold' ? 'format-bold' : 'format-italic'}>{format.name === 'bold' ? 'B' : 'I'}</span>}
          </motion.button>)}
          <span className="format-divider" />
          <motion.button {...pressMotion} title="Import files" aria-label="Import files" onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /></motion.button>
        </div>
        <span className="word-stat">{active?.fileType === 'image' ? 'Image' : active?.fileType === 'binary' ? 'File' : `${words.toLocaleString()} words`}</span>
      </div>
      <motion.main className={'editor-area mode-' + mode + (compact ? ' compact' : '')} aria-label="Flow Markdown workspace"
        initial={false} animate={{ gridTemplateColumns: compact ? 'minmax(0, 1fr)' : gridColumns,
          gridTemplateRows: compact ? mobileGridRows : 'minmax(0, 1fr)' }}
        transition={motionOff ? { duration: 0 } : { duration: 0.29, ease: [0.22, 1, 0.36, 1] }}
        onAnimationComplete={() => editorRef.current?.requestMeasure()}>
        <section className="editor-pane" aria-label="Write Markdown">
          {active?.asset ? <AssetPreview document={active} src={assetView?.id === active.id ? assetView.url : null} onExport={() => exportDocument(active)} /> : active && <MarkdownEditor key={active.id} documentId={active.id} initialText={active.markdown}
            viewRef={editorRef} onChange={onEditorChange} />}
        </section>
        <section className="preview-pane" aria-label="Markdown preview">
          <motion.div className="preview-scroll" initial={false}
            animate={{ opacity: presentationMode === 'write' ? 0 : 1 }}
            transition={motionOff ? { duration: 0 } : { duration: 0.2, delay: presentationMode === 'write' ? 0 : 0.035 }}>
            <Suspense fallback={<div className="preview-loading">Rendering…</div>}>
              {presentationMode !== 'write' && (active?.asset
                ? <AssetPreview document={active} src={assetView?.id === active.id ? assetView.url : null} onExport={() => exportDocument(active)} />
                : <MarkdownPreview markdown={previewText} sourceLanguage={active?.language} />)}
            </Suspense>
          </motion.div>
        </section>
      </motion.main>
      <AnimatePresence initial={false}>
      {pendingDelete && <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: motionOff ? 0 : 0.16 }}
        onMouseDown={event => { if (event.target === event.currentTarget && !deleting) setPendingDelete(null); }}>
        <motion.section className="delete-dialog" initial={motionOff ? false : { opacity: 0, y: 9, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={motionOff ? undefined : { opacity: 0, y: 5, scale: 0.99 }}
          transition={motionOff ? { duration: 0 } : { duration: 0.21, ease: [0.22, 1, 0.36, 1] }} role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description">
          <div className="dialog-header"><Icon name="trash" size={17} /><button type="button" aria-label="Close dialog" disabled={deleting} onClick={() => setPendingDelete(null)}><Icon name="close" size={15} /></button></div>
          <h2 id="delete-dialog-title">Delete document?</h2>
          <p id="delete-dialog-description">“{pendingDelete.title}” will be removed from this browser. This cannot be undone.</p>
          <div className="dialog-actions">
            <button autoFocus type="button" disabled={deleting} className="dialog-cancel" onClick={() => setPendingDelete(null)}>Cancel</button>
            <button type="button" disabled={deleting} className="dialog-delete" aria-label={deleting ? 'Deleting' : 'Delete'} onClick={() => { void confirmDelete(); }}>
              {deleting && <TerminalLoader loading />}{deleting ? 'Deleting' : 'Delete'}
            </button>
          </div>
        </motion.section>
      </motion.div>}
      </AnimatePresence>
      {notice && <div role="status" className="notice"><span>{notice}</span><button title="Dismiss" aria-label="Dismiss" onClick={() => setNotice('')}><Icon name="close" size={14} /></button></div>}
    </div>
  </div>;
}
