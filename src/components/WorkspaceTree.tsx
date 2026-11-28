import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon, SuppliedIcon } from './Icons';
import type { FlowDocument, Folder, Workspace } from '../lib/store';
import type { SearchHit } from '../lib/searchIndex';
import { WORKSPACE_ROOT as ROOT, readClosedTree, writeClosedTree, toggleTreeNode, expandTreeNodes, pageRevealPath } from '../lib/treeDisclosure';
import './workspace-tree.css';
import { isScopedPlanner, plannerId, type PlannerKind } from '../lib/planner';

type Props = {
  workspaces: Workspace[]; folders: Folder[]; documents: FlowDocument[]; allDocuments: FlowDocument[];
  activeId: string; activeWorkspaceId: string; selectedFolderId: string | null; search: string; searchHits: SearchHit[];
  searchPending: boolean; newFolderId: string | null; reveal: { id: string } | null;
  onOpen: (id: string) => void;
  onOpenPlanner: (kind: PlannerKind, workspaceId: string, folderId?: string) => void;
  onSelectFolder: (id: string | null) => void;
  onNewPageInSelection: () => void;
  onNewDocument: (workspaceId: string, folderId?: string, parentId?: string) => void;
  onNewFolder: (workspaceId: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onRenameDocument: (id: string, name: string) => void;
  onDuplicateDocument: (id: string) => void;
  onTogglePin: (id: string, planner?: { kind: PlannerKind; workspaceId: string; folderId?: string }) => void;
  onMovePage: (id: string, parentId?: string, folderId?: string) => void;
  onDeleteFolder: (id: string) => void;
  onDeleteDocument: (id: string) => void;
};
type Menu = { id: string; kind: 'page' | 'folder'; x: number; y: number };
const MIME = 'application/x-flow-document-id';

// Purpose-drawn 16px navigation glyphs, separate from the general icon system.
function TreeGlyph({ kind, open = false }: { kind: 'file' | 'folder'; open?: boolean }) {
  return <svg className="workspace-glyph" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === 'file' ? <>
      <path d="M4.5 2.25h4.3l3 3v7.1a1.4 1.4 0 0 1-1.4 1.4H4.5a1.4 1.4 0 0 1-1.4-1.4v-8.7a1.4 1.4 0 0 1 1.4-1.4Z"/>
      <path d="M8.75 2.5v2.1a.75.75 0 0 0 .75.75h2.05"/>
    </> : open ? <>
      <path d="M1.75 6.2V4.3a1.3 1.3 0 0 1 1.3-1.3H6l1.5 1.5h5.25a1.5 1.5 0 0 1 1.5 1.5v.35"/>
      <path d="M3.2 6.5h10.05a1 1 0 0 1 .96 1.3l-1.4 4.5a1.35 1.35 0 0 1-1.28.95H3a1.25 1.25 0 0 1-1.2-1.6l1.4-5.15Z"/>
    </> : <path d="M1.75 4.3A1.3 1.3 0 0 1 3.05 3H6l1.5 1.5h5.25a1.5 1.5 0 0 1 1.5 1.5v5.75a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5Z"/>}
  </svg>;
}

function Rename({ title, onSave, onCancel }: { title: string; onSave: (s: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { input.current?.scrollIntoView({ block: 'nearest' }); input.current?.focus(); input.current?.select(); }, []);
  function finish(save: boolean) {
    if (done.current) return;
    done.current = true;
    if (save && value.trim()) onSave(value.trim());
    else onCancel();
  }
  return <input ref={input} className="filetree-rename" aria-label="Rename" value={value} maxLength={160}
    onChange={e => setValue(e.target.value)} onBlur={() => finish(true)}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); finish(e.key === 'Enter'); } }} />;
}
function WorkspaceTree({
  workspaces, folders, documents, allDocuments, activeId, activeWorkspaceId, selectedFolderId, search, searchHits, searchPending, newFolderId, reveal,
  onOpen, onOpenPlanner, onSelectFolder, onNewPageInSelection, onNewDocument, onNewFolder, onRenameFolder, onRenameDocument, onDuplicateDocument, onTogglePin, onMovePage, onDeleteFolder, onDeleteDocument,
}: Props) {
  const [closed, setClosed] = useState<Set<string>>(() => readClosedTree());
  const closedRef = useRef(closed);
  const lastReveal = useRef<typeof reveal>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [drop, setDrop] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const byId = useMemo(() => new Map(documents.map(doc => [doc.id, doc])), [documents]);
  const allById = useMemo(() => new Map(allDocuments.map(doc => [doc.id, doc])), [allDocuments]);
  const pinned = useMemo(() => allDocuments.filter(doc => Number.isFinite(doc.pinnedAt) && (doc.pinnedAt ?? 0) > 0)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) || a.id.localeCompare(b.id)), [allDocuments]);
  const folderNames = useMemo(() => new Map(folders.map(folder => [folder.id, folder.name])), [folders]);
  const hitsById = useMemo(() => new Map(searchHits.map(hit => [hit.id, hit])), [searchHits]);
  const folderIds = useMemo(() => new Set(folders.map(folder => folder.id)), [folders]);
  const tree = useMemo(() => {
    const children = new Map<string, FlowDocument[]>();
    const roots: FlowDocument[] = [];
    for (const doc of documents) {
      if (isScopedPlanner(doc)) continue;
      let parent = doc.parentId ? byId.get(doc.parentId) : undefined;
      // Invalid or cyclic imported parent links become visible roots instead of disappearing.
      const seen = new Set([doc.id]);
      let ancestor = parent;
      while (ancestor) {
        if (seen.has(ancestor.id)) { parent = undefined; break; }
        seen.add(ancestor.id);
        ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
      }
      const key = parent?.id || (doc.folderId && folderIds.has(doc.folderId) ? 'folder:' + doc.folderId : '');
      if (!key) roots.push(doc);
      else { const list = children.get(key) || []; list.push(doc); children.set(key, list); }
    }
    // Input order is stable creation order. Never promote a branch on open/edit.
    const topLevelFolders = [...folders].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    return { children, roots, topLevelFolders };
  }, [documents, byId, folderIds, folders]);
  const defaultWorkspace = workspaces.some(ws => ws.id === activeWorkspaceId) ? activeWorkspaceId : workspaces[0]?.id || '';
  const searching = !!search.trim();
  const updateClosed = useCallback((update: (old: Set<string>) => Set<string>) => {
    const next = update(closedRef.current);
    if (next === closedRef.current) return;
    closedRef.current = next;
    // Write during the interaction so an immediate refresh cannot lose it.
    writeClosedTree(next);
    setClosed(next);
  }, []);
  const toggle = (id: string) => updateClosed(old => toggleTreeNode(old, id));
  const expand = useCallback((id: string) => updateClosed(old => expandTreeNodes(old, [id])), [updateClosed]);
  useEffect(() => {
    if (newFolderId) { setEditing(newFolderId); expand(newFolderId); }
  }, [newFolderId, expand]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (e: PointerEvent) => { if (!(e.target instanceof Element) || !e.target.closest('.filetree-menu,.filetree-more')) setMenu(null); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    const scroll = () => setMenu(null);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', scroll);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); window.removeEventListener('resize', scroll); };
  }, [menu]);
  useEffect(() => {
    // Startup restores activeId without a reveal request. A completed request
    // is consumed once; edits, search results and title changes cannot reopen it.
    if (!reveal || lastReveal.current === reveal) return;
    const path = pageRevealPath(reveal.id, allById, folderIds);
    if (!path) return;
    lastReveal.current = reveal;
    updateClosed(old => expandTreeNodes(old, path));
  }, [reveal, allById, folderIds, updateClosed]);
  function openMenu(e: MouseEvent<HTMLButtonElement>, id: string, kind: Menu['kind']) {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu(old => old?.id === id ? null : { id, kind, x: Math.max(8, Math.min(rect.left, innerWidth - 208)),
      y: Math.max(8, Math.min(rect.bottom + 4, innerHeight - 220)) });
  }
  function dragOver(e: DragEvent, id: string) {
    if (!e.dataTransfer.types.includes(MIME) || moving === id) return;
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDrop(id);
  }
  function dropped(e: DragEvent, parentId?: string, folderId?: string) {
    const id = e.dataTransfer.getData(MIME);
    if (!id) return;
    e.preventDefault(); e.stopPropagation(); setDrop(null); setMoving(null);
    onMovePage(id, parentId, folderId);
    if (parentId || folderId) expand((parentId || folderId)!);
  }
  function more(id: string, kind: Menu['kind'], title: string) {
    return <button type="button" className="filetree-more" aria-label={'Actions for ' + title} aria-haspopup="menu"
      aria-expanded={menu?.id === id} onClick={e => openMenu(e, id, kind)}><Icon name="more" size={16}/></button>;
  }
  function pinButton(id: string, title: string, selected: boolean, planner?: { kind: PlannerKind; workspaceId: string; folderId?: string }) {
    const label = (selected ? 'Unpin ' : 'Pin ') + title;
    return <button type="button" className={'page-pin-button' + (selected ? ' is-pinned' : '')}
      aria-label={label} aria-pressed={selected} title={label} onClick={() => onTogglePin(id, planner)}>
      <Icon name="pin" size={14}/>
    </button>;
  }
  function breadcrumb(doc: FlowDocument): string {
    const parts: string[] = [];
    const seen = new Set([doc.id]);
    let current = doc;
    while (current.parentId && !seen.has(current.parentId)) {
      const parent = allById.get(current.parentId);
      if (!parent) break;
      seen.add(parent.id);
      parts.unshift(parent.title);
      current = parent;
    }
    parts.unshift((current.folderId && folderNames.get(current.folderId)) || 'workspace');
    return parts.join(' / ');
  }
  function row(doc: FlowDocument, depth = 0): React.ReactNode {
    const children = tree.children.get(doc.id) || [];
    const expanded = !closed.has(doc.id);
    return <div className="private-page-group" key={doc.id} role="treeitem" aria-selected={doc.id === activeId} aria-level={depth + 1}
      aria-expanded={children.length ? expanded : undefined}>
      <div className={'filetree-row private-page-row' + (doc.id === activeId ? ' is-active' : '') + (drop === doc.id ? ' is-drop' : '')}
        style={{ paddingInlineStart: 5 + Math.min(depth, 12) * 14 }}
        draggable={editing !== doc.id}
        onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData(MIME, doc.id); e.dataTransfer.effectAllowed = 'move'; setMoving(doc.id); }}
        onDragEnd={() => { setDrop(null); setMoving(null); }}
        onDragOver={e => dragOver(e, doc.id)}
        onDragLeave={e => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setDrop(old => old === doc.id ? null : old); }}
        onDrop={e => dropped(e, doc.id)}>
        <button type="button" className={'private-page-icon' + (children.length && expanded ? ' is-open' : '')}
          aria-label={children.length ? (expanded ? 'Collapse ' : 'Expand ') + doc.title : 'Open ' + doc.title}
          onClick={() => children.length ? toggle(doc.id) : onOpen(doc.id)}>
          <span className="private-file-icon">{doc.fileType === 'image' ? <Icon name="svg" size={16}/> : <TreeGlyph kind="file"/>}</span>
          {children.length > 0 && <span className="private-chevron"><Icon name="chevron" size={13}/></span>}
        </button>
        {editing === doc.id ? <Rename title={doc.title} onSave={value => { onRenameDocument(doc.id, value); setEditing(null); }}
          onCancel={() => setEditing(null)}/> : <button type="button" className="filetree-label" onClick={() => onOpen(doc.id)} title={doc.title}>{doc.title || 'Untitled'}</button>}
        {!doc.asset && <button type="button" className="private-add-child" aria-label={'Add subpage to ' + doc.title}
          onClick={() => { expand(doc.id); onNewDocument(doc.workspaceId, doc.folderId, doc.id); }}><Icon name="plus" size={14}/></button>}
        {pinButton(doc.id, doc.title, !!doc.pinnedAt)}
        {more(doc.id, 'page', doc.title)}
      </div>
      {expanded && children.length > 0 && <div role="group">{children.map(child => row(child, depth + 1))}</div>}
    </div>;
  }
  function plannerLink(kind: PlannerKind, workspaceId: string, folderId?: string, depth = 1) {
    const id = plannerId(kind, workspaceId, folderId);
    const label = kind === 'todo' ? 'To-do' : 'Memory';
    return <div className="planner-pin-row">
      <button type="button" className="planner-tree-row" style={{ paddingInlineStart: 5 + depth * 14 }}
        aria-current={activeId === id ? 'page' : undefined} onClick={() => onOpenPlanner(kind, workspaceId, folderId)}>
        <Icon name={kind === 'todo' ? 'check' : 'history'} size={15}/><span>{label}</span>
      </button>
      {pinButton(id, label, !!allById.get(id)?.pinnedAt, { kind, workspaceId, folderId })}
    </div>;
  }
  function plannerFolder(folder: Folder) {
    const id = 'planner-folder-' + folder.id;
    const open = !closed.has(id);
    const active = activeId === plannerId('todo', folder.workspaceId, folder.id);
    return <div role="treeitem" aria-level={2} aria-expanded={open} aria-selected={active}>
      <div className="planner-tree-branch">
        <button type="button" className={'planner-tree-chevron' + (open ? ' is-open' : '')}
          aria-label={(open ? 'Collapse ' : 'Expand ') + 'To-do in ' + folder.name} onClick={() => toggle(id)}><Icon name="chevron" size={12}/></button>
        <button type="button" className="planner-tree-row" aria-current={active ? 'page' : undefined}
          onClick={() => onOpenPlanner('todo', folder.workspaceId, folder.id)}>
          <TreeGlyph kind="folder" open={open}/><span>To-do</span>
        </button>
        {pinButton(plannerId('todo', folder.workspaceId, folder.id), 'To-do · ' + folder.name,
          !!allById.get(plannerId('todo', folder.workspaceId, folder.id))?.pinnedAt, { kind: 'todo', workspaceId: folder.workspaceId, folderId: folder.id })}
      </div>
      {open && <div role="group">{plannerLink('memory', folder.workspaceId, folder.id, 2)}</div>}
    </div>;
  }
  return <>
    <div className="private-tree-heading">
      <span>{searching ? 'Search results' : 'Private'}</span>
      {!searching && <div><button type="button" title="New folder" aria-label="New folder" disabled={!defaultWorkspace}
        onClick={() => onNewFolder(defaultWorkspace)}><TreeGlyph kind="folder"/></button>
        <button type="button" title="New page" aria-label="New page" disabled={!defaultWorkspace}
          onClick={onNewPageInSelection}><Icon name="plus" size={16}/></button></div>}
    </div>
    <div className="filetree-scroll private-tree" role="tree" aria-label={searching ? 'Search results' : 'Private pages'}>
      {searching ? <>
        {documents.map(doc => <div key={doc.id} role="treeitem" aria-selected={doc.id === activeId} className={'filetree-result' + (doc.id === activeId ? ' is-active' : '')}>
          <button type="button" className="filetree-result-open" onClick={() => onOpen(doc.id)}><TreeGlyph kind="file"/>
            <span className="filetree-result-copy"><span className="filetree-result-title">{doc.title}</span>
              <span className="filetree-result-path" title={breadcrumb(doc)}>{breadcrumb(doc)}</span>
              <span className="filetree-result-snippet">{hitsById.get(doc.id)?.snippet}</span></span>
          </button>{pinButton(doc.id, doc.title, !!doc.pinnedAt)}</div>)}
        {!documents.length && <div className="filetree-empty">{searchPending ? 'Searching…' : 'No matching pages'}</div>}
      </> : <>
        {pinned.length > 0 && <div className="pinned-pages" role="group" aria-label="Pinned pages">
          <div className="pinned-pages-heading" aria-hidden="true">Pinned</div>
          {pinned.map(doc => <div key={doc.id} role="treeitem" aria-level={1} aria-selected={doc.id === activeId}
            className={'filetree-row pinned-page-row' + (doc.id === activeId ? ' is-active' : '')}>
            <button type="button" className="pinned-page-open" title={doc.title} aria-current={doc.id === activeId ? 'page' : undefined}
              onClick={() => onOpen(doc.id)}>
              <Icon name="pin" size={15}/><span>{doc.title || 'Untitled'}</span>
            </button>
            {pinButton(doc.id, doc.title, true)}
          </div>)}
        </div>}
        {tree.topLevelFolders.map(folder => {
          const open = !closed.has(folder.id);
          return <div key={folder.id} className="workspace-sibling-folder" role="treeitem" aria-level={1} aria-expanded={open} aria-selected={selectedFolderId === folder.id}>
            <div className={'filetree-row private-page-row private-folder-row' + (drop === folder.id ? ' is-drop' : '') + (selectedFolderId === folder.id ? ' is-selected-folder' : '')}
              style={{ paddingInlineStart: 2 }}
              onDragOver={e => dragOver(e, folder.id)} onDrop={e => dropped(e, undefined, folder.id)}
              onDragLeave={() => setDrop(old => old === folder.id ? null : old)}>
              <button type="button" className="workspace-folder-toggle" onClick={() => { onSelectFolder(folder.id); toggle(folder.id); }}
                aria-label={(open ? 'Collapse ' : 'Expand ') + folder.name}>
                <span className={'workspace-root-chevron' + (open ? ' is-open' : '')}><Icon name="chevron" size={12}/></span>
                <TreeGlyph kind="folder" open={open}/>
              </button>
              {editing === folder.id ? <Rename title={folder.name} onSave={value => { onRenameFolder(folder.id, value); setEditing(null); }} onCancel={() => setEditing(null)}/>
                : <button type="button" className="filetree-label" onClick={() => { onSelectFolder(folder.id); toggle(folder.id); }}>{folder.name}</button>}
              <button type="button" className="private-add-child" aria-label={'Add page to ' + folder.name} onClick={() => { expand(folder.id); onNewDocument(folder.workspaceId, folder.id); }}><Icon name="plus" size={14}/></button>
              {more(folder.id, 'folder', folder.name)}
            </div>
            {open && <div role="group">{plannerFolder(folder)}{(tree.children.get('folder:' + folder.id) || []).map(doc => row(doc, 1))}</div>}
          </div>;
        })}
        <div className="workspace-root" role="treeitem" aria-level={1} aria-expanded={!closed.has(ROOT)} aria-selected={selectedFolderId === null}>
          <div className={'filetree-row workspace-root-row' + (drop === ROOT ? ' is-drop' : '') + (selectedFolderId === null ? ' is-selected-folder' : '')}
            onDragOver={e => dragOver(e, ROOT)} onDrop={e => { dropped(e); expand(ROOT); }}
            onDragLeave={() => setDrop(old => old === ROOT ? null : old)}>
            <button type="button" className="workspace-root-toggle" onClick={() => { onSelectFolder(null); toggle(ROOT); }}
              aria-label={(closed.has(ROOT) ? 'Expand ' : 'Collapse ') + 'workspace'}>
              <span className={'workspace-root-chevron' + (!closed.has(ROOT) ? ' is-open' : '')}><Icon name="chevron" size={12}/></span>
              <TreeGlyph kind="folder" open={!closed.has(ROOT)}/>
              <span>workspace</span>
            </button>
            <button type="button" className="private-add-child" aria-label="Add page to workspace" disabled={!defaultWorkspace}
              onClick={() => { expand(ROOT); onNewDocument(defaultWorkspace); }}><Icon name="plus" size={14}/></button>
          </div>
          {!closed.has(ROOT) && <div className="workspace-root-children" role="group">
        {defaultWorkspace && plannerLink('todo', defaultWorkspace)}
        {defaultWorkspace && plannerLink('memory', defaultWorkspace)}
        {tree.roots.map(doc => row(doc, 1))}
        <div className={'private-root-drop' + (drop === 'root' ? ' is-drop' : '')} onDragOver={e => dragOver(e, 'root')} onDrop={e => dropped(e)}
          onDragLeave={() => setDrop(old => old === 'root' ? null : old)}>
          <button type="button" disabled={!defaultWorkspace} onClick={() => onNewDocument(defaultWorkspace)}><Icon name="plus" size={15}/> Add new</button>
        </div>
          </div>}
        </div>
      </>}
    </div>
    {menu && createPortal(<div role="menu" className="filetree-menu private-page-menu" style={{ left: menu.x, top: menu.y }}>
      <div className="private-menu-label"><SuppliedIcon kind="lock" size={13}/><span>Private pages</span></div>
      {menu.kind === 'page' && <button type="button" role="menuitem" onClick={() => {
        const page = byId.get(menu.id); if (page && !page.asset) { expand(page.id); onNewDocument(page.workspaceId, page.folderId, page.id); } setMenu(null);
      }}><Icon name="plus" size={15}/> Add subpage</button>}
      {menu.kind === 'page' && <button type="button" role="menuitem" className="page-pin-menu" onClick={() => { onTogglePin(menu.id); setMenu(null); }}>
        <Icon name="pin" size={15}/> {allById.get(menu.id)?.pinnedAt ? 'Unpin page' : 'Pin page'}
      </button>}
      <button type="button" role="menuitem" onClick={() => { setEditing(menu.id); setMenu(null); }}><Icon name="edit" size={15}/> Rename</button>
      {menu.kind === 'page' && !byId.get(menu.id)?.asset && <button type="button" role="menuitem" onClick={() => { onDuplicateDocument(menu.id); setMenu(null); }}><Icon name="copy" size={15}/> Duplicate</button>}
      {menu.kind === 'page' && <button type="button" role="menuitem" onClick={() => { onMovePage(menu.id); setMenu(null); }}><TreeGlyph kind="folder"/> Move to root</button>}
      <button type="button" role="menuitem" className="filetree-delete" onClick={() => { if (menu.kind === 'page') onDeleteDocument(menu.id); else onDeleteFolder(menu.id); setMenu(null); }}><Icon name="trash" size={15}/> Delete</button>
    </div>, document.body)}
  </>;
}
export default memo(WorkspaceTree);
