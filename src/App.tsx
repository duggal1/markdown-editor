import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon';
import Download04Icon from '@hugeicons/core-free-icons/Download04Icon';
import EyeIcon from '@hugeicons/core-free-icons/EyeIcon';
import FileAddIcon from '@hugeicons/core-free-icons/FileAddIcon';
import Moon02Icon from '@hugeicons/core-free-icons/Moon02Icon';
import PencilEdit02Icon from '@hugeicons/core-free-icons/PencilEdit02Icon';
import Sun03Icon from '@hugeicons/core-free-icons/Sun03Icon';
import Upload04Icon from '@hugeicons/core-free-icons/Upload04Icon';
import TextBoldIcon from '@hugeicons/core-free-icons/TextBoldIcon';
import TextItalicIcon from '@hugeicons/core-free-icons/TextItalicIcon';
import Heading02Icon from '@hugeicons/core-free-icons/Heading02Icon';
import Link01Icon from '@hugeicons/core-free-icons/Link01Icon';
import SourceCodeIcon from '@hugeicons/core-free-icons/SourceCodeIcon';
import QuoteUpIcon from '@hugeicons/core-free-icons/QuoteUpIcon';
import ArrowDown01Icon from '@hugeicons/core-free-icons/ArrowDown01Icon';
import { Columns, PencilSimple } from '@phosphor-icons/react';
import MarkdownPreview from './components/MarkdownPreview';
import IconButton from './components/IconButton';
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
  const [mode, setMode] = useState<Mode>(() => window.matchMedia('(max-width: 760px)').matches ? 'write' : 'split');
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
    setTitle('Untitled document'); setContent(''); setMode('write');
    if (editorRef.current) editorRef.current.value = '';
    window.requestAnimationFrame(() => titleRef.current?.focus());
    setNotice('New document');
  }

  return <div className="app-shell" onDragOver={event => event.preventDefault()} onDrop={onDrop}>
    <header className="topbar">
      <div className="brand" aria-label="Plain Markdown editor"><span className="brand-mark">p<span>.</span></span><span className="brand-word">plain</span><span className="brand-extension">.md</span></div>
      <span className="topbar-center">A little space to think.</span>
      <div className="topbar-actions">
        <IconButton icon={FileAddIcon} title="New document" onClick={newDocument} />
        <IconButton icon={Upload04Icon} title="Import Markdown" onClick={() => fileRef.current?.click()} />
        <IconButton icon={Download04Icon} title="Download Markdown (⌘S)" onClick={exportFile} />
        <span className="vertical-rule" />
        <IconButton icon={theme === 'light' ? Moon02Icon : Sun03Icon} title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
        <input ref={fileRef} type="file" hidden accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={onFileSelected} aria-label="Import Markdown file" />
      </div>
    </header>

    <main className="workspace">
      <div className="document-heading">
        <div className="eyebrow"><span className="eyebrow-square" /> YOUR WORKSPACE <span className="eyebrow-separator">/</span> DOCUMENT 01</div>
        <div className="title-line">
          <input aria-label="Document title" className="document-title" ref={titleRef} value={title} onChange={event => setTitle(event.target.value)} placeholder="Untitled document" spellCheck={false} />
          <span className="file-suffix">.md</span>
        </div>
        <div className="heading-meta"><span className="status-dot" /><span>{status}</span><span className="meta-divider">·</span><span>{countWords(content).toLocaleString()} words</span><span className="meta-divider">·</span><span>{content.length.toLocaleString()} characters</span></div>
      </div>

      <section className="editor-card" aria-label="Markdown editor">
        <div className="editor-toolbar">
          <div className="formatting-actions" aria-label="Formatting">
            <IconButton icon={TextBoldIcon} title="Bold (⌘B)" onClick={() => insertFormat('bold')} />
            <IconButton icon={TextItalicIcon} title="Italic (⌘I)" onClick={() => insertFormat('italic')} />
            <IconButton icon={Heading02Icon} title="Heading" onClick={() => insertFormat('heading')} />
            <span className="toolbar-rule" />
            <IconButton icon={Link01Icon} title="Insert link (⌘K)" onClick={() => insertFormat('link')} />
            <IconButton icon={SourceCodeIcon} title="Insert code (⌘E)" onClick={() => insertFormat('code')} />
            <IconButton icon={QuoteUpIcon} title="Blockquote" onClick={() => insertFormat('quote')} />
          </div>
          <div className="mode-toggle" aria-label="View mode">
            <button className={mode === 'write' ? 'selected' : ''} aria-pressed={mode === 'write'} onClick={() => changeMode('write')} type="button"><PencilSimple size={15} weight="regular" /> <span>Write</span></button>
            <button className={mode === 'split' ? 'selected' : ''} aria-pressed={mode === 'split'} onClick={() => changeMode('split')} type="button"><Columns size={15} weight="regular" /> <span>Split</span></button>
            <button className={mode === 'preview' ? 'selected' : ''} aria-pressed={mode === 'preview'} onClick={() => changeMode('preview')} type="button"><HugeiconsIcon icon={EyeIcon} size={15} strokeWidth={1.6} /> <span>Preview</span></button>
          </div>
        </div>
        <div className={'editor-body mode-' + mode}>
          <div className="write-pane">
            <div className="pane-label"><HugeiconsIcon icon={PencilEdit02Icon} size={13} strokeWidth={1.7} /> MARKDOWN <span className="pane-hint">RAW TEXT</span></div>
            <textarea ref={editorRef} className="markdown-input" aria-label="Write Markdown" defaultValue={initial.markdown}
              spellCheck autoCapitalize="sentences" onChange={event => setContent(event.target.value)}
              onKeyDown={onEditorKeyDown} placeholder="Start writing. The rest can wait." />
          </div>
          <div className="preview-pane">
            <div className="pane-label"><HugeiconsIcon icon={EyeIcon} size={13} strokeWidth={1.7} /> PREVIEW <span className="pane-hint">LIVE RENDER</span></div>
            <div className="preview-scroll"><MarkdownPreview markdown={deferredContent} /></div>
          </div>
        </div>
        <div className="editor-footer"><div><HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} strokeWidth={1.7} /> <span>Private by design. Stored on this device.</span></div><span className="footer-hint">MARKDOWN <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={1.7} /></span></div>
      </section>
      <div className="below-editor"><span>JUST WORDS, NOTHING ELSE.</span><span>⌘ S TO EXPORT <span className="below-separator">·</span> ⌘ ⇧ P TO PREVIEW</span></div>
      {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notification" type="button">×</button></div>}
    </main>
  </div>;
}
