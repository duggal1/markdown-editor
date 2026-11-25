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
    return { children, roots };
  }, [documents, byId, folderIds]);
  const defaultWorkspace = activeWorkspaceId || workspaces[0]?.id || '';
  const searching = !!search.trim();
  const toggle = (id: string) => setClosed(old => {
    const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const expand = (id: string) => setClosed(old => { const next = new Set(old); next.delete(id); return next; });
  useEffect(() => {
    if (newFolderId) { setEditing(newFolderId); expand(newFolderId); }
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
          <span className="private-file-icon"><Icon name={doc.fileType === 'image' ? 'svg' : 'file'} size={16}/></span>
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
        onClick={() => onNewFolder(defaultWorkspace)}><Icon name="folder" size={15}/></button>
        <button type="button" title="New page" aria-label="New page" disabled={!defaultWorkspace}
          onClick={() => onNewDocument(defaultWorkspace)}><Icon name="plus" size={16}/></button></div>}
    </div>
    <div className="filetree-scroll private-tree" role="tree" aria-label={searching ? 'Search results' : 'Private pages'}>
      {searching ? <>
        {documents.map(doc => <div key={doc.id} role="treeitem" aria-selected={doc.id === activeId} className={'filetree-result' + (doc.id === activeId ? ' is-active' : '')}>
          <button type="button" className="filetree-result-open" onClick={() => onOpen(doc.id)}><Icon name="file" size={15}/>
            <span className="filetree-result-copy"><span className="filetree-result-title">{doc.title}</span>
              <span className="filetree-result-snippet">{searchHits.find(hit => hit.id === doc.id)?.snippet}</span></span>
          </button></div>)}
        {!documents.length && <div className="filetree-empty">{searchPending ? 'Searching…' : 'No matching pages'}</div>}
      </> : <>
        {tree.roots.map(doc => row(doc))}
        {folders.map(folder => {
          const open = !closed.has(folder.id);
          return <div key={folder.id} role="treeitem" aria-expanded={open}>
            <div className={'filetree-row private-page-row private-folder-row' + (drop === folder.id ? ' is-drop' : '')}
              onDragOver={e => dragOver(e, folder.id)} onDrop={e => dropped(e, undefined, folder.id)}
              onDragLeave={() => setDrop(old => old === folder.id ? null : old)}>
              <button type="button" className={'private-page-icon' + (open ? ' is-open' : '')} onClick={() => toggle(folder.id)}
                aria-label={(open ? 'Collapse ' : 'Expand ') + folder.name}><span className="private-file-icon"><Icon name="folder" size={16}/></span><span className="private-chevron"><Icon name="chevron" size={13}/></span></button>
              {editing === folder.id ? <Rename title={folder.name} onSave={value => { onRenameFolder(folder.id, value); setEditing(null); }} onCancel={() => setEditing(null)}/>
                : <button type="button" className="filetree-label" onClick={() => toggle(folder.id)}>{folder.name}</button>}
              <button type="button" className="private-add-child" aria-label={'Add page to ' + folder.name} onClick={() => { expand(folder.id); onNewDocument(folder.workspaceId, folder.id); }}><Icon name="plus" size={14}/></button>
              {more(folder.id, 'folder', folder.name)}
            </div>
            {open && <div role="group">{(tree.children.get('folder:' + folder.id) || []).map(doc => row(doc, 1))}</div>}
          </div>;
        })}
        <div className={'private-root-drop' + (drop === 'root' ? ' is-drop' : '')} onDragOver={e => dragOver(e, 'root')} onDrop={e => dropped(e)}
          onDragLeave={() => setDrop(old => old === 'root' ? null : old)}>
          <button type="button" disabled={!defaultWorkspace} onClick={() => onNewDocument(defaultWorkspace)}><Icon name="plus" size={15}/> Add new</button>
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
      {menu.kind === 'page' && <button type="button" role="menuitem" onClick={() => { onMovePage(menu.id); setMenu(null); }}><Icon name="folder" size={15}/> Move to root</button>}
      <button type="button" role="menuitem" className="filetree-delete" onClick={() => { if (menu.kind === 'page') onDeleteDocument(menu.id); else onDeleteFolder(menu.id); setMenu(null); }}><Icon name="trash" size={15}/> Delete</button>
    </div>, document.body)}
  </>;
}
export default memo(WorkspaceTree);
