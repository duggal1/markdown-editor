import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons';
import { appendPlannerItems, editPlannerRow, plannerRows, selectPlannerContext, type PlannerItem, type PlannerKind, type PlannerRow } from '../lib/planner';
import { setTaskChecked } from '../lib/taskList';
import { consumePlannerStream, streamedItems } from '../lib/plannerStream';
import './planner.css';

type Props = {
  kind: PlannerKind; markdown: string; memory: string; scope: string;
  onEdit: (change: (source: string) => string) => void;
};
const ACCESS = 'flow.planner.access.session';
function readAccess() { try { return sessionStorage.getItem(ACCESS) || ''; } catch { return ''; } }
function Check({ done }: { done: boolean }) {
  return <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="1.5" y="1.5" width="15" height="15" rx="4.5" fill={done ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2"/>
    {done && <path d="m5 9 2.6 2.6 5.3-5.3" stroke="var(--surface)" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"/>}
  </svg>;
}
const ItemRow = memo(function ItemRow({ row, kind, onEdit }: { row: PlannerRow; kind: PlannerKind; onEdit: Props['onEdit'] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.text);
  const canceled = useRef(false);
  function finish() { if (!canceled.current && draft.trim()) onEdit(source => editPlannerRow(source, kind, row, draft)); setEditing(false); }
  return <div className={'planner-row' + (row.done ? ' is-done' : '')}>
    {kind === 'todo' ? <button type="button" className="planner-check" role="checkbox" aria-checked={row.done} aria-label={row.text}
      onClick={() => onEdit(source => {
        const current = plannerRows(source, kind).find(item => item.line === row.line);
        return current?.text === row.text && current.category === row.category ? setTaskChecked(source, row.line, !current.done) : source;
      })}><Check done={row.done}/></button> : <span className="planner-memory-dot" aria-hidden="true"/>}
    {editing ? <input className="planner-inline-input" aria-label="Edit item" autoFocus maxLength={1200} value={draft}
      onChange={e => setDraft(e.target.value)} onBlur={finish} onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); canceled.current = true; setEditing(false); }
      }}/> : <button type="button" className="planner-row-text" onClick={() => { canceled.current = false; setDraft(row.text); setEditing(true); }}>{row.text}</button>}
    <button type="button" className="planner-remove" aria-label={'Remove ' + row.text} onClick={() => onEdit(source => editPlannerRow(source, kind, row, null))}><Icon name="trash" size={14}/></button>
  </div>;
}, (a, b) => a.kind === b.kind && a.onEdit === b.onEdit && a.row.line === b.row.line && a.row.text === b.row.text && a.row.category === b.row.category && a.row.done === b.row.done);

export default function PlannerPage({ kind, markdown, memory, scope, onEdit }: Props) {
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
  const streamBuffer = useRef({ reasoning: '', content: '' });
  const streamFrame = useRef<number | null>(null);
  const thinkingScroll = useRef<HTMLDivElement>(null);
  const streamed = useMemo(() => streamedItems(stream.content), [stream.content]);
  useEffect(() => { const el = thinkingScroll.current; if (el && busy && thinkingOpen) el.scrollTop = el.scrollHeight; }, [stream.reasoning, busy, thinkingOpen]);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; if (streamFrame.current !== null) cancelAnimationFrame(streamFrame.current); }, []);
  const rows = useMemo(() => plannerRows(markdown, kind), [markdown, kind]);
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
    setDraft(''); setFilter('all');
  }
  async function generate() {
    if (!prompt.trim() || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setSuggestions(null); setThinkingOpen(true);
    streamBuffer.current = { reasoning: '', content: '' }; setStream({ ...streamBuffer.current });
    try {
      const response = await fetch('/api/planner', { method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Flow-Planner-Key': access },
        body: JSON.stringify({ kind, input: prompt, existing: selectPlannerContext(markdown, kind, prompt), memory: kind === 'todo' && includeMemory ? selectPlannerContext(memory, 'memory', prompt) : '' }) });
      if (controller.signal.aborted) return;
      if (response.status === 401) setNeedsAccess(true);
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
      try { sessionStorage.setItem(ACCESS, access); } catch { /* session storage unavailable */ }
      setNeedsAccess(false); setSuggestions(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Generation failed');
    } finally {
      if (request.current === controller) {
        if (streamFrame.current !== null) { cancelAnimationFrame(streamFrame.current); streamFrame.current = null; }
        setStream({ ...streamBuffer.current }); request.current = null; setBusy(false);
      }
    }
  }
  function apply() {
    if (!suggestions) return;
    onEdit(source => appendPlannerItems(source, kind, suggestions));
    setSuggestions(null); setPrompt(''); setFilter('all'); setStream({ reasoning: '', content: '' });
  }
  return <div className="planner-scroll"><div className="planner-page">
    <header className="planner-header">
      <div className="planner-kicker"><span className="planner-scope-dot"/>{scope}<span> / </span>{kind === 'todo' ? 'Planning' : 'Memory'}</div>
      <h1>{kind === 'todo' ? 'To-do' : 'Memory'}</h1>
    </header>
    <section className="planner-composer" aria-label="AI planner">
      <div className="planner-composer-label"><svg className="planner-spark" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1v14M1 8h14M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> {kind === 'todo' ? 'Plan with AI' : 'Organize memory'}</div>
      <textarea aria-label={kind === 'todo' ? 'Describe your tasks' : 'Describe what to remember'} value={prompt} maxLength={12000}
        onChange={e => setPrompt(e.target.value)} placeholder={kind === 'todo' ? 'What needs to get done? Paste a brain dump or describe a plan…' : 'What should you remember? Add a decision, preference or context…'}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generate(); } }}/>
      {needsAccess && <label className="planner-access">Private access key<input type="password" autoComplete="off" value={access} onChange={e => setAccess(e.target.value)} placeholder="Enter your deployment access key"/></label>}
      <div className="planner-composer-footer">
        {kind === 'todo' && memory.trim() ? <button type="button" className="planner-context" aria-pressed={includeMemory} onClick={() => setIncludeMemory(v => !v)}><span className={'planner-context-dot' + (includeMemory ? ' is-on' : '')}/>Use saved memory</button> : <span aria-hidden="true"/>}
        {busy ? <button type="button" className="planner-action" aria-label="Stop generation" onClick={() => request.current?.abort()}><span className="planner-pulse"/> Stop</button> :
          <button type="button" className="planner-action" disabled={!prompt.trim()} onClick={() => { void generate(); }}>Generate <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13V3m-4 4 4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button>}
      </div>
      {(busy || stream.reasoning) && <div className="planner-thinking">
        <button type="button" className="planner-thinking-toggle" aria-expanded={thinkingOpen} onClick={() => setThinkingOpen(value => !value)}>
          {busy && !stream.content ? <span className="planner-pulse"/> : <Icon name="check" size={13}/>}
          <span>{busy && !stream.content ? 'Thinking…' : 'Thinking'}</span><span className="planner-thinking-chevron"><Icon name="chevron" size={12}/></span>
        </button>
        {thinkingOpen && <div ref={thinkingScroll} className="planner-thinking-text">{stream.reasoning || (busy ? 'Preparing…' : '')}{busy && !stream.content && <span className="planner-stream-caret" aria-hidden="true"/>}</div>}
      </div>}
      {error && <div className="planner-error" role="alert">{error}</div>}
    </section>
    {busy && stream.content && <section className="planner-suggestions" aria-label="Generating items">
      <div className="planner-section-head"><span>{kind === 'todo' ? 'Writing tasks' : 'Writing memories'}…</span><span className="planner-pulse" aria-hidden="true"/></div>
      <div className="planner-suggest-list">{streamed.map((item, index) => <div key={index}><p>{item}{index === streamed.length - 1 && <span className="planner-stream-caret" aria-hidden="true"/>}</p></div>)}</div>
    </section>}
    {suggestions && <section className="planner-suggestions" aria-label="Suggested changes">
      <div className="planner-section-head"><span>{suggestions.length} suggested {kind === 'todo' ? 'tasks' : 'memories'}</span></div>
      <div className="planner-suggest-list">{suggestions.map((item, index) => <div key={index}><span>{item.category}</span><p>{item.text}</p></div>)}</div>
      <div className="planner-review-actions"><button type="button" onClick={() => { setSuggestions(null); setStream({ reasoning: '', content: '' }); }}>Discard</button><button type="button" className="planner-action" onClick={apply}>Add to {kind === 'todo' ? 'list' : 'memory'}</button></div>
    </section>}
    <section className="planner-list" aria-label={kind === 'todo' ? 'Tasks' : 'Saved memories'}>
      <div className="planner-section-head"><span>{kind === 'todo' ? 'Your tasks' : 'Your memory'}</span>
        {kind === 'todo' && <div className="planner-filters" role="group" aria-label="Filter tasks">{(['all', 'open', 'done'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'open' ? 'Open' : 'Done'}</button>)}</div>}
      </div>
      {!groups.length && <p className="planner-empty">{rows.length ? 'No items in this view.' : kind === 'todo' ? 'No tasks yet.' : 'No memories yet.'}</p>}
      {groups.map(([category, items]) => <section key={category} className="planner-group"><h2><span/>{category}<small>{items.length}</small></h2>
        {items.map(row => <ItemRow key={row.line + ':' + row.text} row={row} kind={kind} onEdit={onEdit}/>)}</section>)}
      <form className="planner-add" onSubmit={e => { e.preventDefault(); add(); }}><Icon name="plus" size={16}/><input aria-label={kind === 'todo' ? 'New task' : 'New memory'} placeholder={kind === 'todo' ? 'Add a task…' : 'Add a memory…'} maxLength={1200} value={draft} onChange={e => setDraft(e.target.value)}/><button type="submit" disabled={!draft.trim()}>Add</button></form>
    </section>
  </div></div>;
}
