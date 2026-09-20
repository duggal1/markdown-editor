import { useDeferredValue, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import MarkdownPreview from './components/MarkdownPreview';
import { STORAGE_KEY, countWords, downloadMarkdown, restoreDocument } from './lib/document';
import { applyFormat, type Format } from './lib/format';

type Mode = 'write' | 'split' | 'preview';
const maxFileSize = 2 * 1024 * 1024;
export default function App() {
  const [initial] = useState(restoreDocument);
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.markdown);
  const deferredContent = useDeferredValue(content);
  const [theme, setTheme] = useState<'light' | 'dark'>(initial.theme);
  const [mode, setMode] = useState<Mode>(() => 'write');
  const [status, setStatus] = useState('Saved locally');
  const [notice, setNotice] = useState('');
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    setStatus('Saving');
    const handle = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ title, markdown: content, theme }));
        setStatus('Saved locally');
      } catch { setStatus('Unable to save · storage full or blocked'); }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [title, content, theme]);

  useEffect(() => {
    const saveOnExit = () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ title, markdown: content, theme })); }
      catch { /* The visible save indicator handles storage errors. */ }
    };
    window.addEventListener('pagehide', saveOnExit);
    return () => window.removeEventListener('pagehide', saveOnExit);
  }, [title, content, theme]);

  function exportFile() { downloadMarkdown(content, title); setNotice('Markdown downloaded'); }
  function changeMode(next: Mode) {
    setMode(next);
    if (next !== 'preview') window.requestAnimationFrame(() => editorRef.current?.focus());
  }
  function insertFormat(format: Format) {
    if (mode === 'preview') setMode('write');
    window.requestAnimationFrame(() => {
      if (editorRef.current) setContent(applyFormat(editorRef.current, format));
    });
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > maxFileSize) { setNotice('Files must be smaller than 2 MB'); return; }
    if (!/\.(md|markdown|txt)$/i.test(file.name)) { setNotice('Choose a .md, .markdown, or .txt file'); return; }
    try {
      const text = await file.text();
      setContent(text);
      if (editorRef.current) editorRef.current.value = text;
      setTitle(file.name.replace(/\.(md|markdown|txt)$/i, '') || 'Untitled document');
      setMode('write');
      setNotice('Imported ' + file.name);
    } catch { setNotice('This file could not be opened'); }
  }
  function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    void importFile(event.target.files?.[0]);
    event.target.value = '';
  }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void importFile(event.dataTransfer.files?.[0]);
  }
  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Tab') {
      event.preventDefault();
      const area = event.currentTarget;
      const start = area.selectionStart;
      const end = area.selectionEnd;
      area.setRangeText('  ', start, end, 'end');
      setContent(area.value);
      return;
    }
    if (!(event.metaKey || event.ctrlKey)) return;
    const commands: Record<string, Format> = { b: 'bold', i: 'italic', k: 'link', e: 'code' };
    const format = commands[event.key.toLowerCase()];
    if (format) { event.preventDefault(); insertFormat(format); }
  }
  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); downloadMarkdown(content, title); setNotice('Markdown downloaded'); }
      if (event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault(); setMode(current => current === 'preview' ? 'write' : 'preview');
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [content, title]);
  function newDocument() {
    if (content && !window.confirm('Create a new document? This replaces the current document in this browser. Download a copy first if you want to keep it.')) return;
    setTitle('Untitled'); setContent(''); setMode('write');
    if (editorRef.current) editorRef.current.value = '';
    window.requestAnimationFrame(() => titleRef.current?.focus());
    setNotice('New document');
  }

  return <div className="app-shell" onDragOver={event => event.preventDefault()} onDrop={onDrop}>
    <header className="topbar">
      <div className="document-identity">
        <span className="wordmark">Plain</span>
        <span className="identity-divider" aria-hidden="true" />
        <input ref={titleRef} aria-label="Document title" className="document-title" value={title}
          onChange={event => setTitle(event.target.value)} placeholder="Untitled" spellCheck={false} />
      </div>
      <div className="topbar-actions">
        <button type="button" title="New document" onClick={newDocument}>New</button>
        <button type="button" title="Import Markdown" onClick={() => fileRef.current?.click()}>Open</button>
        <button type="button" title="Download Markdown (⌘S)" onClick={exportFile}>Export</button>
        <span className="action-divider" aria-hidden="true" />
        <button type="button" title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? 'Dark' : 'Light'}</button>
        <input ref={fileRef} type="file" hidden accept=".md,.markdown,.txt,text/markdown,text/plain"
          onChange={onFileSelected} aria-label="Import Markdown file" />
      </div>
    </header>
    <main className="workspace">
      <section className="editor" aria-label="Markdown editor">
        <div className="editor-toolbar">
          <div className="formatting-actions" aria-label="Formatting">
            <button type="button" className="format-bold" title="Bold (⌘B)" aria-label="Bold" onClick={() => insertFormat('bold')}>B</button>
            <button type="button" className="format-italic" title="Italic (⌘I)" aria-label="Italic" onClick={() => insertFormat('italic')}>I</button>
            <button type="button" title="Heading" onClick={() => insertFormat('heading')}>H</button>
            <span className="toolbar-divider" aria-hidden="true" />
            <button type="button" title="Insert link (⌘K)" onClick={() => insertFormat('link')}>Link</button>
            <button type="button" title="Insert code (⌘E)" onClick={() => insertFormat('code')}>Code</button>
            <button type="button" title="Blockquote" onClick={() => insertFormat('quote')}>Quote</button>
          </div>
          <div className="mode-toggle" aria-label="View mode">
            <button className={mode === 'write' ? 'selected' : ''} aria-pressed={mode === 'write'}
              onClick={() => changeMode('write')} type="button">Write</button>
            <button className={mode === 'split' ? 'selected' : ''} aria-pressed={mode === 'split'}
              onClick={() => changeMode('split')} type="button">Split</button>
            <button className={mode === 'preview' ? 'selected' : ''} aria-pressed={mode === 'preview'}
              onClick={() => changeMode('preview')} type="button">Preview</button>
          </div>
        </div>
        <div className={'editor-body mode-' + mode}>
          <div className="write-pane">
            <textarea ref={editorRef} className="markdown-input" aria-label="Write Markdown"
              defaultValue={initial.markdown} spellCheck autoCapitalize="sentences"
              onChange={event => setContent(event.target.value)} onKeyDown={onEditorKeyDown}
              placeholder="Write Markdown…" />
          </div>
          <div className="preview-pane">
            <div className="preview-scroll"><MarkdownPreview markdown={deferredContent} /></div>
          </div>
        </div>
      </section>
      <div className="status-line">
        <span className={status.startsWith('Unable') ? 'save-error' : ''} role={status.startsWith('Unable') ? 'alert' : undefined}>
          {status.startsWith('Unable') ? status : status === 'Saving' ? 'Saving…' : 'Saved'}
        </span>
        <span>{countWords(content).toLocaleString()} words</span>
      </div>
      {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notification" type="button">×</button></div>}
    </main>
  </div>;
}
