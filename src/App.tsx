import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { EditorView } from '@codemirror/view';
import MarkdownEditor, { formatEditor, type Format } from './components/MarkdownEditor';
import { FlowMark, Icon, type IconName } from './components/Icons';
import { downloadMarkdown } from './lib/document';
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
export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [docs, setDocs] = useState<FlowDocument[]>([]);
  const live = useRef(new Map<string, FlowDocument>());
  const [activeId, setActiveId] = useState('');
  const activeIdRef = useRef('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [theme, setTheme] = useState<Theme>('light');
  const [mode, setMode] = useState<Mode>('write');
  const modeRef = useRef<Mode>('write');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [words, setWords] = useState(0);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saved');
  const [notice, setNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'document' | 'workspace'; id: string; title: string; count?: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletionInFlight = useRef(false);
  const workspaceInFlight = useRef(false);
  const editorRef = useRef<EditorView | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const searchRequest = useRef(0);
  const saveTimers = useRef(new Map<string, number>());
  const visualTimers = useRef(new Map<string, number>());
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
      activeIdRef.current = first.id;
      setActiveId(first.id);
      setWorkspaceId(chosenWorkspace.id);
      setRecentIds(Array.isArray(prefs.recentIds) ? prefs.recentIds.filter(id => live.current.has(id)) : [first.id]);
      setTheme(prefs.theme === 'dark' ? 'dark' : 'light');
      setSidebarOpen(prefs.sidebarOpen !== false);
      modeRef.current = restoredMode;
      setMode(restoredMode);
      setPreviewText(first.markdown);
      setWords(wordCount(first.markdown));
      worker?.postMessage({ type: 'index', documents: data.documents });
      setLoaded(true);
    }).catch(() => { if (alive) { setSaveState('error'); setNotice('Local storage could not be opened.'); } });
    return () => {
      alive = false;
      worker?.terminate();
      workerRef.current = null;
      for (const timer of saveTimers.current.values()) clearTimeout(timer);
      for (const timer of visualTimers.current.values()) clearTimeout(timer);
    };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (!loaded) return;
    savePrefs({ theme, mode, sidebarOpen, activeDocumentId: activeId,
      activeWorkspaceId: workspaceId, recentIds });
  }, [loaded, theme, mode, sidebarOpen, activeId, workspaceId, recentIds]);

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
      workerRef.current?.postMessage({ type: 'upsert', document: latest });
      if (activeIdRef.current === latest.id) {
        if (modeRef.current !== 'write') setPreviewText(latest.markdown);
        setWords(wordCount(latest.markdown));
      }
      visualTimers.current.delete(doc.id);
    }, 360));
  }, [flush]);

  const onEditorChange = useCallback((value: string) => {
    const id = activeIdRef.current;
    const current = live.current.get(id);
    if (!current || current.markdown === value) return;
    const next: FlowDocument = {
      ...current, markdown: value, updatedAt: Date.now(),
      title: current.titleAuto ? inferTitle(value) : current.title,
    };
    scheduleSave(next);
  }, [scheduleSave]);

  const selectDocument = useCallback((id: string) => {
    const doc = live.current.get(id);
    if (!doc) return;
    const previous = activeIdRef.current;
    if (previous && previous !== id) flush(previous);
    activeIdRef.current = id;
    setActiveId(id);
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

  async function addWorkspace() {
    if (workspaceInFlight.current) return;
    const name = workspaceName.trim();
    if (!name) { setCreatingWorkspace(false); return; }
    workspaceInFlight.current = true;
    const ws: Workspace = { id: uid(), name: name.slice(0, 65), createdAt: Date.now() };
    setWorkspaces(current => [...current, ws]);
    setWorkspaceId(ws.id);
    setCreatingWorkspace(false);
    setWorkspaceName('');
    try { await saveWorkspace(ws); }
    catch { setNotice('Workspace could not be saved.'); }
    makeDocument(ws.id);
    workspaceInFlight.current = false;
  }
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
  async function eraseWorkspace(ws: Workspace) {
    if (workspaces.length < 2) return;
    const contents = [...live.current.values()].filter(doc => doc.workspaceId === ws.id);
    for (const doc of contents) {
      live.current.delete(doc.id);
      workerRef.current?.postMessage({ type: 'remove', id: doc.id });
      try { await removeDoc(doc.id); } catch { setNotice('Some documents could not be deleted.'); }
    }
    try { await removeWorkspace(ws.id); } catch { setNotice('Workspace deletion could not be saved.'); }
    setWorkspaces(current => current.filter(item => item.id !== ws.id));
    const remaining = [...live.current.values()];
    setDocs(remaining);
    if (contents.some(doc => doc.id === activeIdRef.current)) {
      const other = remaining[0];
      if (other) selectDocument(other.id);
      else makeDocument(workspaces.find(item => item.id !== ws.id)?.id);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deletionInFlight.current) return;
    deletionInFlight.current = true;
    setDeleting(true);
    try {
      if (pendingDelete.kind === 'document') {
        const doc = live.current.get(pendingDelete.id);
        if (doc) await eraseDocument(doc);
      } else {
        const ws = workspaces.find(item => item.id === pendingDelete.id);
        if (ws) await eraseWorkspace(ws);
      }
      setPendingDelete(null);
    } finally {
      deletionInFlight.current = false;
      setDeleting(false);
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setNotice('Maximum file size: 15 MB'); return; }
    if (!/\.(md|markdown|txt)$/i.test(file.name)) { setNotice('Choose a .md, .markdown or .txt file.'); return; }
    try {
      const markdown = await file.text();
      const now = Date.now();
      const doc: FlowDocument = {
        id: uid(), workspaceId, markdown, title: file.name.replace(/\.(md|markdown|txt)$/i, ''),
        titleAuto: false, createdAt: now, updatedAt: now,
      };
      live.current.set(doc.id, doc);
      setDocs(current => [doc, ...current]);
      selectDocument(doc.id);
      await saveDoc(doc);
      setNotice('Imported ' + file.name);
    } catch { setNotice('The file could not be imported.'); }
  }
  function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    void importFile(event.target.files?.[0]);
    event.target.value = '';
  }
  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    void importFile(event.dataTransfer.files?.[0]);
  }
  const active = live.current.get(activeId) || docs.find(doc => doc.id === activeId);
  const matching = useMemo(() => query.trim()
    ? searchResults.map(id => docs.find(doc => doc.id === id)).filter((doc): doc is FlowDocument => !!doc)
    : docs.filter(doc => doc.workspaceId === workspaceId).sort((a, b) => b.updatedAt - a.updatedAt),
    [docs, query, searchResults, workspaceId]);
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
        if (doc) { flush(doc.id); downloadMarkdown(doc.markdown, doc.title); setNotice('Markdown exported'); }
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
    if (next !== 'preview') window.requestAnimationFrame(() => editorRef.current?.focus());
  }
  function changeTitle(value: string) {
    const current = live.current.get(activeIdRef.current);
    if (!current) return;
    const next = { ...current, title: value, titleAuto: false, updatedAt: Date.now() };
    scheduleSave(next);
    setDocs(docs => docs.map(doc => doc.id === next.id ? next : doc));
  }

  if (!loaded) return <main className="boot"><FlowMark size={30} /><span>Opening workspace…</span></main>;
  return <div className="flow-shell" onDragOver={event => event.preventDefault()} onDrop={onDrop}>
    <motion.aside className={'sidebar' + (sidebarOpen ? ' is-open' : '')}
      initial={false} animate={{ width: sidebarOpen ? 256 : 0 }}
      transition={motionOff ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Workspaces">
      <div className="sidebar-inner">
        <div className="sidebar-brand">
          <div className="brand-lockup"><FlowMark size={23} /><span>Flow</span></div>
        </div>
        <label className="search-field"><Icon name="search" size={16} />
          <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search documents" aria-label="Search documents" />
        </label>
        <div className="sidebar-heading"><span>Workspaces</span><button title="Add workspace" aria-label="Add workspace" onClick={() => setCreatingWorkspace(true)}><Icon name="plus" size={15} /></button></div>
        <div className="workspace-list">
          {workspaces.map(ws => <div className={'workspace-entry' + (workspaceId === ws.id ? ' active' : '')} key={ws.id}>
            <button className="workspace-select" onClick={() => { setQuery(''); const first = [...live.current.values()].filter(doc => doc.workspaceId === ws.id).sort((a, b) => b.updatedAt - a.updatedAt)[0]; if (first) selectDocument(first.id); else { setWorkspaceId(ws.id); makeDocument(ws.id); } }}>
              <Icon name="folder" size={15} /><span>{ws.name}</span>
            </button>
            {workspaces.length > 1 && <button className="row-delete" aria-label={'Delete workspace ' + ws.name} title="Delete workspace" onClick={() => setPendingDelete({ kind: 'workspace', id: ws.id, title: ws.name, count: [...live.current.values()].filter(doc => doc.workspaceId === ws.id).length })}><Icon name="trash" size={13} /></button>}
          </div>)}
          {creatingWorkspace && <input className="new-workspace-field" autoFocus value={workspaceName}
            onChange={event => setWorkspaceName(event.target.value)} placeholder="Workspace name"
            onKeyDown={event => { if (event.key === 'Enter') void addWorkspace(); if (event.key === 'Escape') setCreatingWorkspace(false); }}
            onBlur={() => { if (workspaceName.trim()) void addWorkspace(); else setCreatingWorkspace(false); }} />}
        </div>
        <div className="sidebar-heading documents-heading"><span>{query ? 'Results' : 'Documents'}</span>
          <button title="New document" aria-label="New document" onClick={() => makeDocument()}><Icon name="plus" size={15} /></button>
        </div>
        <div className="document-list">
          {matching.map(doc => <div key={doc.id} className={'document-entry' + (activeId === doc.id ? ' active' : '')}>
            <button className="document-select" onClick={() => selectDocument(doc.id)}>
              <Icon name="file" size={15} /><span className="document-label">{doc.title || 'Untitled'}</span>
              <span className="md-tag">.md</span>
            </button>
            <button className="row-delete" aria-label={'Delete ' + doc.title} title="Delete document" onClick={() => setPendingDelete({ kind: 'document', id: doc.id, title: doc.title.trim() || 'Untitled' })}><Icon name="trash" size={13} /></button>
          </div>)}
          {!matching.length && <span className="no-results">{query ? 'No documents found' : 'No documents yet'}</span>}
        </div>
        <div className="sidebar-bottom">
          <button className="sidebar-bottom-action" onClick={() => makeDocument()}><Icon name="plus" size={16} /> New document</button>
          <button className="sidebar-bottom-action" onClick={() => { if (recentIds[1]) selectDocument(recentIds[1]); }} disabled={!recentIds[1]}><Icon name="history" size={16} /> Previous document</button>
        </div>
      </div>
    </motion.aside>
    {sidebarOpen && <button className="mobile-backdrop" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
    <div className="main-shell">
      <header className="topbar">
        <div className="document-meta">
          <button className="square-button sidebar-toggle" title={sidebarOpen ? 'Hide sidebar' : 'Open sidebar'} aria-label={sidebarOpen ? 'Hide sidebar' : 'Open sidebar'}
            onClick={() => setSidebarOpen(current => !current)}><Icon name="sidebar" size={18} /></button>
          {!sidebarOpen && <FlowMark size={19} />}
          <input ref={titleRef} className="document-title" aria-label="Document title" spellCheck={false}
            value={active?.title || ''} onChange={event => changeTitle(event.target.value)} placeholder="Untitled" />
          <span className="save-indicator" aria-label={saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : 'Save failed'} role="status">
            {saveState === 'saving' && <TerminalLoader loading />} {saveState === 'error' ? 'Not saved' : saveState === 'saving' ? 'Saving' : 'Saved'}
          </span>
        </div>
        <div className="header-actions">
          <div className="mode-switch" role="group" aria-label="Editor mode">
            {(['write', 'split', 'preview'] as const).map(item => <button key={item} type="button" aria-pressed={mode === item}
              className={mode === item ? 'selected' : ''} onClick={() => changeMode(item)}>
              {mode === item && <motion.span layoutId="mode-highlight" className="mode-highlight" transition={motionOff ? { duration: 0 } : { type: 'spring', stiffness: 550, damping: 42 }} />}
              <span className="mode-label">{item.charAt(0).toUpperCase() + item.slice(1)}</span>
            </button>)}
          </div>
          <button className="square-button" title={theme === 'light' ? 'Dark mode' : 'Light mode'} aria-label={theme === 'light' ? 'Dark mode' : 'Light mode'} onClick={() => setTheme(current => current === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={17} /></button>
          <button className="export-button" onClick={() => { const doc = live.current.get(activeIdRef.current); if (doc) { flush(doc.id); downloadMarkdown(doc.markdown, doc.title); setNotice('Exported'); } }}><Icon name="download" size={15} /> <span>Export</span></button>
          <input ref={fileRef} type="file" hidden accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={onFileSelected} aria-label="Import Markdown file" />
        </div>
      </header>
      <div className="subbar">
        <div className="formatting-actions" role="toolbar" aria-label="Markdown formatting">
          {FORMATS.map(format => <button key={format.name} type="button" title={format.label + (format.shortcut ? ' · ' + format.shortcut : '')} aria-label={format.label}
            onClick={() => { if (mode === 'preview') changeMode('write'); window.requestAnimationFrame(() => formatEditor(editorRef.current, format.name)); }}>
            {format.icon ? <Icon name={format.icon} size={16} /> : format.name === 'heading' ? <span className="format-heading">H<span>1</span></span>
              : <span className={format.name === 'bold' ? 'format-bold' : 'format-italic'}>{format.name === 'bold' ? 'B' : 'I'}</span>}
          </button>)}
          <span className="format-divider" />
          <button title="Import Markdown" aria-label="Import Markdown" onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /></button>
        </div>
        <span className="word-stat">{words.toLocaleString()} words</span>
      </div>
      <main className={'editor-area mode-' + mode} aria-label="Flow Markdown workspace">
        <section className="editor-pane" aria-label="Write Markdown">
          {active && <MarkdownEditor key={active.id} documentId={active.id} initialText={active.markdown}
            viewRef={editorRef} onChange={onEditorChange} />}
        </section>
        <section className="preview-pane" aria-label="Markdown preview">
          <div className="preview-scroll"><Suspense fallback={<div className="preview-loading">Rendering…</div>}>
            {mode !== 'write' && <MarkdownPreview markdown={previewText} />}
          </Suspense></div>
        </section>
      </main>
      {pendingDelete && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !deleting) setPendingDelete(null); }}>
        <section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description">
          <div className="dialog-header"><Icon name="trash" size={17} /><button type="button" aria-label="Close dialog" disabled={deleting} onClick={() => setPendingDelete(null)}><Icon name="close" size={15} /></button></div>
          <h2 id="delete-dialog-title">Delete {pendingDelete.kind}?</h2>
          <p id="delete-dialog-description">“{pendingDelete.title}”{pendingDelete.kind === 'workspace' ? ' and its ' + (pendingDelete.count || 0) + ' documents' : ''} will be removed from this browser. This cannot be undone.</p>
          <div className="dialog-actions">
            <button autoFocus type="button" disabled={deleting} className="dialog-cancel" onClick={() => setPendingDelete(null)}>Cancel</button>
            <button type="button" disabled={deleting} className="dialog-delete" aria-label={deleting ? 'Deleting' : 'Delete'} onClick={() => { void confirmDelete(); }}>
              {deleting && <TerminalLoader loading />}{deleting ? 'Deleting' : 'Delete'}
            </button>
          </div>
        </section>
      </div>}
      {notice && <div role="status" className="notice"><span>{notice}</span><button title="Dismiss" aria-label="Dismiss" onClick={() => setNotice('')}><Icon name="close" size={14} /></button></div>}
    </div>
  </div>;
}
