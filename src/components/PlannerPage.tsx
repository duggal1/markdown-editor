import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons';
import { TaskCheck } from './TaskCheck';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { appendPlannerItems, editPlannerRow, plannerRows, selectPlannerContext, type PlannerItem, type PlannerKind, type PlannerRow } from '../lib/planner';
import { setTaskChecked } from '../lib/taskList';
import { consumePlannerStream, streamedItems } from '../lib/plannerStream';
import { githubOwner, publicRepos, repoContext, type RepoCatalog } from '../lib/plannerGithub';
import './planner.css';

/* pixel-idea: a live manuscript: the newest streamed words resolve into ink,
   while the existing Flow save-label shimmer indicates actual inference. */
const StreamWords = memo(function StreamWords({ text, live }: { text: string; live: boolean }) {
  const parts = text.match(/\s+|\S+/g) || [];
  const cutoff = Math.max(0, parts.length - 48);
  return <>{parts.map((part, index) => /\s/.test(part[0])
    ? part
    : <span key={index} className={live && index >= cutoff ? 'planner-word is-new' : 'planner-word'}>{part}</span>)}</>;
});
type Props = {
  kind: PlannerKind; markdown: string; memory: string; scope: string;
  onEdit: (change: (source: string) => string) => void;
};
const ACCESS = 'flow.planner.access.session';
const GITHUB = 'flow.planner.github.owner';
function readGithub() { try { return localStorage.getItem(GITHUB); } catch { return null; } }
function saveGithub(owner: string) { try { localStorage.setItem(GITHUB, owner); } catch { /* storage unavailable */ } }
function GithubMark() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.32-3.79-1.32-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.29-5.13-1.25-5.13-5.56 0-1.23.44-2.24 1.16-3.03-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.09 1.16a10.8 10.8 0 0 1 5.63 0c2.14-1.46 3.09-1.16 3.09-1.16.61 1.55.23 2.7.11 2.98.72.79 1.16 1.8 1.16 3.03 0 4.32-2.63 5.27-5.14 5.55.4.35.76 1.04.76 2.1v3.08c0 .3.21.65.78.54A11.25 11.25 0 0 0 12 .75Z"/></svg>;
}
function readAccess() { try { return sessionStorage.getItem(ACCESS) || ''; } catch { return ''; } }
const ItemRow = memo(function ItemRow({ row, kind, onEdit }: { row: PlannerRow; kind: PlannerKind; onEdit: Props['onEdit'] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.text);
  const canceled = useRef(false);
  function finish() { if (!canceled.current && draft.trim()) onEdit(source => editPlannerRow(source, kind, row, draft)); setEditing(false); }
  return <div className={'planner-row' + (row.done ? ' is-done' : '') + (editing ? ' is-editing' : '')}>
    {kind === 'todo' ? <TaskCheck className="planner-check" checked={row.done} label={row.text}
      onToggle={() => onEdit(source => {
        const current = plannerRows(source, kind).find(item => item.line === row.line);
        return current?.text === row.text && current.category === row.category ? setTaskChecked(source, row.line, !current.done) : source;
      })}/> : <Icon name="bookmark" size={15} className="planner-memory-mark"/>}
    {editing ? <input className="planner-inline-input" aria-label="Edit item" autoFocus maxLength={1200} value={draft}
      onChange={e => setDraft(e.target.value)} onBlur={finish} onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); canceled.current = true; setEditing(false); }
      }}/> : <button type="button" className="planner-row-text" onClick={() => { canceled.current = false; setDraft(row.text); setEditing(true); }}>{row.text}</button>}
    <button type="button" className="planner-remove" aria-label={'Remove ' + row.text} title="Remove item"
      onPointerDown={event => { if (editing) event.preventDefault(); }}
      onClick={() => { canceled.current = true; setEditing(false); onEdit(source => editPlannerRow(source, kind, row, null)); }}><Icon name="close" size={14}/></button>
  </div>;
}, (a, b) => a.kind === b.kind && a.onEdit === b.onEdit && a.row.line === b.row.line && a.row.text === b.row.text && a.row.category === b.row.category && a.row.done === b.row.done);

export default function PlannerPage({ kind, markdown, memory, onEdit }: Props) {
  const [github, setGithub] = useState(readGithub);
  const [githubDraft, setGithubDraft] = useState(github || '');
  const [githubOpen, setGithubOpen] = useState(github === null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();
  const [githubCatalog, setGithubCatalog] = useState<RepoCatalog | null>(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState('');
  const [githubRevision, setGithubRevision] = useState(0);
  const [contextLoading, setContextLoading] = useState(false);
  useEffect(() => {
    setGithubCatalog(null); setGithubError(''); setGithubLoading(false);
    if (!github) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    let active = true;
    setGithubLoading(true);
    void publicRepos(github, controller.signal, fetch, githubRevision > 0).then(value => {
      if (active) setGithubCatalog(value);
    }).catch(cause => {
      if (active) setGithubError(controller.signal.aborted ? 'GitHub lookup timed out. Retry when ready.' : cause instanceof Error ? cause.message : 'GitHub lookup failed.');
    }).finally(() => { window.clearTimeout(timer); if (active) setGithubLoading(false); });
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [github, githubRevision]);
  function connectGithub() {
    const owner = githubOwner(githubDraft);
    if (!owner) { setGithubError('Enter a GitHub username or public repository URL.'); return; }
    if (owner !== github) { setGithubCatalog(null); setGithubError(''); }
    setGithub(owner); saveGithub(owner); setGithubDraft(owner); setGithubOpen(false);
    if (owner === github) setGithubRevision(value => value + 1);
    promptRef.current?.focus();
  }
  function skipGithub() { setGithubCatalog(null); saveGithub(''); setGithub(''); setGithubDraft(''); setGithubOpen(false); setGithubError(''); promptRef.current?.focus(); }
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all');
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [access, setAccess] = useState(readAccess);
  const [needsAccess, setNeedsAccess] = useState(false);
  const [includeMemory, setIncludeMemory] = useState(false);
  const [suggestions, setSuggestions] = useState<PlannerItem[] | null>(null);
  const [stream, setStream] = useState({ reasoning: '', content: '' });
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [stopped, setStopped] = useState(false);
  const [generation, setGeneration] = useState(0);
  const streamBuffer = useRef({ reasoning: '', content: '' });
  const streamFrame = useRef<number | null>(null);
  const thinkingScroll = useRef<HTMLDivElement>(null);
  const streamed = useMemo(() => streamedItems(stream.content), [stream.content]);
  useEffect(() => { const el = thinkingScroll.current; if (el && busy && thinkingOpen) el.scrollTop = el.scrollHeight; }, [stream.reasoning, busy, thinkingOpen]);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; if (streamFrame.current !== null) cancelAnimationFrame(streamFrame.current); }, []);
  const rows = useMemo(() => plannerRows(markdown, kind), [markdown, kind]);
  const counts = useMemo(() => { const done = rows.filter(row => row.done).length; return { all: rows.length, open: rows.length - done, done }; }, [rows]);
  const groups = useMemo(() => {
    const map = new Map<string, PlannerRow[]>();
    for (const row of rows) {
      if (kind === 'todo' && filter !== 'all' && row.done !== (filter === 'done')) continue;
      const group = map.get(row.category) || []; group.push(row); map.set(row.category, group);
    }
    return [...map];
  }, [rows, kind, filter]);
  function add() {
    if (!draft.trim()) return;
    onEdit(source => appendPlannerItems(source, kind, [{ text: draft, category: 'Inbox' }]));
    setDraft(''); setFilter('all'); addRef.current?.focus();
  }
  async function generate() {
    if (!prompt.trim() || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setSuggestions(null); setThinkingOpen(true); setStopped(false); setGeneration(value => value + 1);
    streamBuffer.current = { reasoning: '', content: '' }; setStream({ ...streamBuffer.current });
    try {
      let repositories = '';
      if (github && githubCatalog && githubCatalog.repos.length) {
        setContextLoading(true);
        const lookup = new AbortController();
        const stopLookup = () => lookup.abort();
        controller.signal.addEventListener('abort', stopLookup, { once: true });
        const timer = window.setTimeout(stopLookup, 3200);
        try { repositories = await repoContext(prompt, githubCatalog, lookup.signal); }
        catch { /* GitHub is optional: continue without repository context. */ }
        finally { window.clearTimeout(timer); controller.signal.removeEventListener('abort', stopLookup); setContextLoading(false); }
      }
      if (controller.signal.aborted) return;
      const response = await fetch('/api/planner', { method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Flow-Planner-Key': access },
        body: JSON.stringify({ kind, input: prompt, repositories, existing: selectPlannerContext(markdown, kind, prompt), memory: kind === 'todo' && includeMemory ? selectPlannerContext(memory, 'memory', prompt) : '' }) });
      if (controller.signal.aborted) return;
      setNeedsAccess(response.status === 401);
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw Error(result.error || 'Generation failed'); }
      let result: PlannerItem[] | null = null;
      await consumePlannerStream(response, event => {
        if (controller.signal.aborted) return;
        if (event.type === 'done') { result = event.items; return; }
        if (event.type !== 'reasoning' && event.type !== 'content') return;
        streamBuffer.current[event.type] += event.text;
        if (streamFrame.current === null) streamFrame.current = requestAnimationFrame(() => {
          streamFrame.current = null; setStream({ ...streamBuffer.current });
        });
      });
      if (controller.signal.aborted) return;
      if (!result) throw Error('No usable items returned.');
      try { if (access) sessionStorage.setItem(ACCESS, access); } catch { /* session storage unavailable */ }
      setNeedsAccess(false); setSuggestions(result);
    } catch (cause) {
      if (controller.signal.aborted) { if (request.current === controller) setStopped(true); }
      else setError(cause instanceof Error ? cause.message : 'Generation failed');
    } finally {
      if (request.current === controller) {
        if (streamFrame.current !== null) { cancelAnimationFrame(streamFrame.current); streamFrame.current = null; }
        if (controller.signal.aborted) setStopped(true);
        setStream({ ...streamBuffer.current }); request.current = null; setBusy(false); setContextLoading(false);
      }
    }
  }
  function apply() {
    if (!suggestions) return;
    onEdit(source => appendPlannerItems(source, kind, suggestions));
    setSuggestions(null); setPrompt(''); setFilter('all'); setStopped(false); setStream({ reasoning: '', content: '' });
  }
  return <div className="planner-scroll"><div className="planner-page">
    <header className="planner-header">
      <h1>{kind === 'todo' ? 'To-do' : 'Memory'}</h1>
    </header>
    <section className="planner-composer" aria-label="AI planner">
      <div className="planner-composer-top"><div className="planner-composer-label">{kind === 'todo' ? 'Plan with AI' : 'Organize memory'}</div>
    <div className="planner-github">
      <button type="button" className="planner-github-trigger" disabled={busy} aria-expanded={githubOpen} onClick={() => { setGithubDraft(github || ''); setGithubOpen(value => !value); }}>
        <GithubMark/><span>{github || 'GitHub'}</span>
        <span className={githubLoading ? 'planner-shimmer' : 'planner-github-meta'}>{githubLoading ? 'Fetching repositories…' : githubCatalog ? githubCatalog.repos.length + (githubCatalog.complete ? ' repos' : '+ repos') : github ? 'Not loaded' : 'Optional'}</span>
        <Icon name="chevron" size={12}/>
      </button>
      {githubOpen && <form className="planner-github-form" onSubmit={event => { event.preventDefault(); connectGithub(); }}>
        <label htmlFor="planner-github-owner">Public GitHub repositories</label>
        <input id="planner-github-owner" placeholder="Username or repository URL" value={githubDraft} onChange={event => setGithubDraft(event.target.value)} maxLength={240} autoComplete="off" spellCheck={false} disabled={busy}/>
        <div className="planner-github-actions"><span>No token required.</span><button type="button" className="planner-github-disconnect" disabled={busy} onClick={skipGithub}>{github ? 'Disconnect' : 'Skip'}</button><button type="submit" className="planner-action planner-github-update" disabled={busy || !githubDraft.trim()}>{github ? 'Update' : 'Connect'}</button></div>
      </form>}
      {githubError && <div className="planner-github-error" role="status"><span>{githubError}</span>{github && <button type="button" disabled={busy || githubLoading} onClick={() => setGithubRevision(value => value + 1)}>Retry</button>}</div>}
    </div>
      </div>
      <textarea ref={promptRef} aria-label={kind === 'todo' ? 'Describe your tasks' : 'Describe what to remember'} value={prompt} maxLength={12000}
        onChange={e => setPrompt(e.target.value)} placeholder={kind === 'todo' ? 'What needs to get done?' : 'What should you remember?'}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generate(); } }}/>
      {needsAccess && <label className="planner-access">Private access key<input type="password" autoComplete="off" value={access} onChange={e => setAccess(e.target.value)} placeholder="Enter your deployment access key"/></label>}
      <div className="planner-composer-footer">
        <div className="planner-composer-context">{kind === 'todo' && memory.trim() ? <button type="button" className="planner-context" aria-pressed={includeMemory} onClick={() => setIncludeMemory(v => !v)}><span className="planner-context-switch" aria-hidden="true"><i/></span>Use saved memory</button> : <span className="planner-key-hint" aria-hidden="true">⌘ ↵</span>}</div>
        {busy ? <button type="button" className="planner-action" aria-label="Stop generation" onClick={() => request.current?.abort()}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="1" fill="currentColor"/></svg> Stop</button> :
          <button type="button" className="planner-action" disabled={!prompt.trim()} onClick={() => { void generate(); }}>Generate <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13V3m-4 4 4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button>}
      </div>
      {(busy || stream.reasoning || stopped) && <div className="planner-thinking" key={generation}>
        <button type="button" className="planner-thinking-toggle" aria-expanded={thinkingOpen} onClick={() => setThinkingOpen(value => !value)}>
          <span className={busy ? 'planner-shimmer' : 'planner-status-label'}>{busy ? (contextLoading ? 'Reading GitHub…' : stream.content ? 'Writing…' : 'Thinking…') : stopped ? 'Stopped' : error ? 'Interrupted' : 'Thought process'}</span>
          <span className="planner-thinking-chevron"><Icon name="chevron" size={12}/></span>
        </button>
        <AnimatePresence>
          {thinkingOpen && <motion.div key="thinking-body" className="planner-thinking-reveal"
            initial={reducedMotion ? false : { height: 0, opacity: 0, filter: 'blur(6px)' }}
            animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)' }}
            exit={reducedMotion ? { height: 0, opacity: 0 } : { height: 0, opacity: 0, filter: 'blur(6px)' }}
            transition={{ duration: reducedMotion ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}>
            <div ref={thinkingScroll} className="planner-thinking-text"><StreamWords text={stream.reasoning} live={busy}/></div>
          </motion.div>}
        </AnimatePresence>
      </div>}
      {error && <div className="planner-error" role="alert"><span>{error}</span><button type="button" disabled={busy || !prompt.trim()} onClick={() => { void generate(); }}>Retry</button></div>}
    </section>
    {((busy && stream.content) || suggestions) && <section className="planner-suggestions" key={generation} aria-label={busy ? 'Generating items' : 'Suggested changes'}>
      <div className="planner-section-head"><span className={busy ? 'planner-shimmer' : ''}>{busy ? (kind === 'todo' ? 'Writing tasks…' : 'Writing memories…') : (suggestions?.length ?? 0) + (kind === 'todo' ? ' suggested tasks' : ' suggested memories')}</span></div>
      <div className="planner-suggest-list">{(suggestions || streamed.map(text => ({ text, category: '' }))).map((item, index) => <div className="planner-suggestion-row" key={index}><span className="planner-suggestion-index">{String(index + 1).padStart(2, '0')}</span><div>{item.category && <div className="planner-suggestion-category">{item.category}</div>}<p><StreamWords text={item.text} live={busy}/></p></div></div>)}</div>
      {suggestions && <div className="planner-review-actions"><button type="button" onClick={() => { setSuggestions(null); setStopped(false); setStream({ reasoning: '', content: '' }); }}>Discard</button><button type="button" className="planner-action" onClick={apply}>Add to {kind === 'todo' ? 'list' : 'memory'}</button></div>}
    </section>}
    <section className="planner-list" aria-label={kind === 'todo' ? 'Tasks' : 'Saved memories'}>
      <div className="planner-section-head"><span>{kind === 'todo' ? 'Your tasks' : 'Your memory'}</span>
        {kind === 'todo' && <div className="planner-filters" role="group" aria-label="Filter tasks">{(['all', 'open', 'done'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'open' ? 'Open' : 'Done'}{filter === value && <span className="planner-filter-count">{counts[value]}</span>}</button>)}</div>}
      </div>
      <form className="planner-add" onSubmit={e => { e.preventDefault(); add(); }}><button type="button" className="planner-add-icon" aria-label={kind === 'todo' ? 'Add task' : 'Add memory'} onClick={() => { if (draft.trim()) add(); else addRef.current?.focus(); }}><Icon name="plus" size={16}/></button><input ref={addRef} aria-label={kind === 'todo' ? 'New task' : 'New memory'} placeholder={kind === 'todo' ? 'Add a task…' : 'Add a memory…'} maxLength={1200} value={draft} onChange={e => setDraft(e.target.value)}/><button type="submit" disabled={!draft.trim()}>Add</button></form>
      {!groups.length && <p className="planner-empty">{rows.length ? (filter === 'done' ? 'No completed tasks.' : 'No open tasks.') : kind === 'todo' ? 'No tasks yet.' : 'No memories yet.'}{rows.length > 0 && filter !== 'all' && <button type="button" onClick={() => setFilter('all')}>Show all</button>}</p>}
      {groups.map(([category, items]) => <section key={category} className="planner-group"><h2>{category}<small>{items.length}</small></h2>
        {items.map(row => <ItemRow key={row.line + ':' + row.text} row={row} kind={kind} onEdit={onEdit}/>)}</section>)}

    </section>
  </div></div>;
}
