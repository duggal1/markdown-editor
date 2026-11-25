import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon, SuppliedIcon } from './Icons';
import type { FlowDocument, Folder, Workspace } from '../lib/store';
import type { SearchHit } from '../lib/searchIndex';
import './workspace-tree.css';

type Props = {
  workspaces: Workspace[]; folders: Folder[]; documents: FlowDocument[];
  activeId: string; activeWorkspaceId: string; search: string; searchHits: SearchHit[];
  searchPending: boolean; newFolderId: string | null;
  onOpen: (id: string) => void;
  onNewDocument: (workspaceId: string, folderId?: string, parentId?: string) => void;
  onNewFolder: (workspaceId: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onRenameDocument: (id: string, name: string) => void;
  onDuplicateDocument: (id: string) => void;
  onMovePage: (id: string, parentId?: string, folderId?: string) => void;
  onDeleteFolder: (id: string) => void;
  onDeleteDocument: (id: string) => void;
};
type Menu = { id: string; kind: 'page' | 'folder'; x: number; y: number };
const MIME = 'application/x-flow-document-id';
const ROOT = 'workspace-root';

// Purpose-drawn 16px navigation glyphs, separate from the general icon system.
function TreeGlyph({ kind, open = false }: { kind: 'file' | 'folder'; open?: boolean }) {
  return <svg className="workspace-glyph" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === 'file' ? <>
      <path d="M4.25 1.75h4.7l3.3 3.3v7.7a1.5 1.5 0 0 1-1.5 1.5h-6.5a1.5 1.5 0 0 1-1.5-1.5v-9.5a1.5 1.5 0 0 1 1.5-1.5Z"/>
      <path d="M8.75 1.9v2.5a.8.8 0 0 0 .8.8h2.5M5.3 8.2h4.4M5.3 10.7h3"/>
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
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
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
  workspaces, folders, documents, activeId, activeWorkspaceId, search, searchHits, searchPending, newFolderId,
  onOpen, onNewDocument, onNewFolder, onRenameFolder, onRenameDocument, onDuplicateDocument, onMovePage, onDeleteFolder, onDeleteDocument,
}: Props) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [drop, setDrop] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const byId = useMemo(() => new Map(documents.map(doc => [doc.id, doc])), [documents]);
  const folderIds = useMemo(() => new Set(folders.map(folder => folder.id)), [folders]);
  const tree = useMemo(() => {
    const children = new Map<string, FlowDocument[]>();
    const roots: FlowDocument[] = [];
    for (const doc of documents) {
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
    // A branch inherits its most recently used descendant's rank. Keep real
    // parent/folder relationships intact instead of flattening nested pages.
    const rank = new Map(documents.map((doc, index) => [doc.id, index]));
    const branchRanks = new Map<string, number>();
    function branchRank(id: string): number {
      const cached = branchRanks.get(id);
      if (cached !== undefined) return cached;
      let best = rank.get(id) ?? Infinity;
      for (const child of children.get(id) || []) best = Math.min(best, branchRank(child.id));
      branchRanks.set(id, best);
      return best;
    }
    for (const siblings of children.values()) siblings.sort((a, b) => branchRank(a.id) - branchRank(b.id));
    const entries = [
      ...roots.map(doc => ({ kind: 'page' as const, doc, rank: branchRank(doc.id) })),
      ...folders.map(folder => ({ kind: 'folder' as const, folder, rank: branchRank('folder:' + folder.id) })),
    ].sort((a, b) => a.rank - b.rank);
    return { children, entries };
  }, [documents, byId, folderIds, folders]);
  const defaultWorkspace = activeWorkspaceId || workspaces[0]?.id || '';
  const searching = !!search.trim();
  const toggle = (id: string) => setClosed(old => {
    const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const expand = (id: string) => setClosed(old => { const next = new Set(old); next.delete(id); return next; });
  useEffect(() => {
    if (newFolderId) { setEditing(newFolderId); expand(newFolderId); expand(ROOT); }
  }, [newFolderId]);
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
    const next = new Set<string>();
    let doc = byId.get(activeId);
    while (doc?.parentId && !next.has(doc.parentId)) {
      next.add(doc.parentId); doc = byId.get(doc.parentId);
    }
    if (doc?.folderId) next.add(doc.folderId);
    if (next.size) setClosed(old => new Set([...old].filter(id => !next.has(id))));
  }, [activeId, byId]);
  useEffect(() => { if (activeId) expand(ROOT); }, [activeId]);
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
  function row(doc: FlowDocument, depth = 0): React.ReactNode {
    const children = tree.children.get(doc.id) || [];
    const expanded = !closed.has(doc.id);
    return <div className="private-page-group" key={doc.id} role="treeitem" aria-selected={doc.id === activeId}
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
        {more(doc.id, 'page', doc.title)}
      </div>
      {expanded && children.length > 0 && <div role="group">{children.map(child => row(child, depth + 1))}</div>}
    </div>;
  }
  return <>
    <div className="private-tree-heading">
      <span>{searching ? 'Search results' : 'Private'}</span>
      {!searching && <div><button type="button" title="New folder" aria-label="New folder" disabled={!defaultWorkspace}
        onClick={() => onNewFolder(defaultWorkspace)}><TreeGlyph kind="folder"/></button>
        <button type="button" title="New page" aria-label="New page" disabled={!defaultWorkspace}
          onClick={() => onNewDocument(defaultWorkspace)}><Icon name="plus" size={16}/></button></div>}
    </div>
    <div className="filetree-scroll private-tree" role="tree" aria-label={searching ? 'Search results' : 'Private pages'}>
      {searching ? <>
        {documents.map(doc => <div key={doc.id} role="treeitem" aria-selected={doc.id === activeId} className={'filetree-result' + (doc.id === activeId ? ' is-active' : '')}>
          <button type="button" className="filetree-result-open" onClick={() => onOpen(doc.id)}><TreeGlyph kind="file"/>
            <span className="filetree-result-copy"><span className="filetree-result-title">{doc.title}</span>
              <span className="filetree-result-snippet">{searchHits.find(hit => hit.id === doc.id)?.snippet}</span></span>
          </button></div>)}
        {!documents.length && <div className="filetree-empty">{searchPending ? 'Searching…' : 'No matching pages'}</div>}
      </> : <>
        <div className="workspace-root" role="treeitem" aria-expanded={!closed.has(ROOT)}>
          <div className={'filetree-row workspace-root-row' + (drop === ROOT ? ' is-drop' : '')}
            onDragOver={e => dragOver(e, ROOT)} onDrop={e => { dropped(e); expand(ROOT); }}
            onDragLeave={() => setDrop(old => old === ROOT ? null : old)}>
            <button type="button" className="workspace-root-toggle" onClick={() => toggle(ROOT)}
              aria-label={(closed.has(ROOT) ? 'Expand ' : 'Collapse ') + 'workspace'}>
              <span className={'workspace-root-chevron' + (!closed.has(ROOT) ? ' is-open' : '')}><Icon name="chevron" size={12}/></span>
              <TreeGlyph kind="folder" open={!closed.has(ROOT)}/>
              <span>workspace</span>
            </button>
            <button type="button" className="private-add-child" aria-label="Add page to workspace" disabled={!defaultWorkspace}
              onClick={() => { expand(ROOT); onNewDocument(defaultWorkspace); }}><Icon name="plus" size={14}/></button>
          </div>
          {!closed.has(ROOT) && <div className="workspace-root-children" role="group">
        {tree.entries.map(entry => {
          if (entry.kind === 'page') return row(entry.doc, 1);
          const folder = entry.folder;
          const open = !closed.has(folder.id);
          return <div key={folder.id} role="treeitem" aria-expanded={open}>
            <div className={'filetree-row private-page-row private-folder-row' + (drop === folder.id ? ' is-drop' : '')}
              style={{ paddingInlineStart: 19 }}
              onDragOver={e => dragOver(e, folder.id)} onDrop={e => dropped(e, undefined, folder.id)}
              onDragLeave={() => setDrop(old => old === folder.id ? null : old)}>
              <button type="button" className={'private-page-icon' + (open ? ' is-open' : '')} onClick={() => toggle(folder.id)}
                aria-label={(open ? 'Collapse ' : 'Expand ') + folder.name}><span className="private-file-icon"><TreeGlyph kind="folder" open={open}/></span><span className="private-chevron"><Icon name="chevron" size={13}/></span></button>
              {editing === folder.id ? <Rename title={folder.name} onSave={value => { onRenameFolder(folder.id, value); setEditing(null); }} onCancel={() => setEditing(null)}/>
                : <button type="button" className="filetree-label" onClick={() => toggle(folder.id)}>{folder.name}</button>}
              <button type="button" className="private-add-child" aria-label={'Add page to ' + folder.name} onClick={() => { expand(folder.id); onNewDocument(folder.workspaceId, folder.id); }}><Icon name="plus" size={14}/></button>
              {more(folder.id, 'folder', folder.name)}
            </div>
            {open && <div role="group">{(tree.children.get('folder:' + folder.id) || []) .map(doc => row(doc, 2))}</div>}
          </div>;
        })}
        <div className={'private-root-drop' + (drop === 'root' ? ' is-drop' : '')} onDragOver={e => dragOver(e, 'root')} onDrop={e => dropped(e)}
          onDragLeave={() => setDrop(old => old === 'root' ? null : old)}>
          <button type="button" disabled={!defaultWorkspace} onClick={() => onNewDocument(defaultWorkspace)}><Icon name="plus" size={15}/> Add new</button>
        </div>
          </div>}
        </div>
      </>}
    </div>
    {menu && createPortal(<div role="menu" className="filetree-menu private-page-menu" style={{ left: menu.x, top: menu.y }}>
      <div className="private-menu-label"><SuppliedIcon kind="lock" size={13}/> Private pages</div>
      {menu.kind === 'page' && <button type="button" role="menuitem" onClick={() => {
        const page = byId.get(menu.id); if (page && !page.asset) { expand(page.id); onNewDocument(page.workspaceId, page.folderId, page.id); } setMenu(null);
      }}><Icon name="plus" size={15}/> Add subpage</button>}
      <button type="button" role="menuitem" onClick={() => { setEditing(menu.id); setMenu(null); }}><Icon name="edit" size={15}/> Rename</button>
      {menu.kind === 'page' && !byId.get(menu.id)?.asset && <button type="button" role="menuitem" onClick={() => { onDuplicateDocument(menu.id); setMenu(null); }}><Icon name="copy" size={15}/> Duplicate</button>}
      {menu.kind === 'page' && <button type="button" role="menuitem" onClick={() => { onMovePage(menu.id); setMenu(null); }}><TreeGlyph kind="folder"/> Move to root</button>}
      <button type="button" role="menuitem" className="filetree-delete" onClick={() => { if (menu.kind === 'page') onDeleteDocument(menu.id); else onDeleteFolder(menu.id); setMenu(null); }}><Icon name="trash" size={15}/> Delete</button>
    </div>, document.body)}
  </>;
}
export default memo(WorkspaceTree);
