import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons';
import type { FlowDocument, Folder, Workspace } from '../lib/store';
import type { SearchHit } from '../lib/searchIndex';
import './workspace-tree.css';

type Kind = 'workspace' | 'folder' | 'document';
type Editing = { kind: Kind; id: string; name: string };
type Menu = { kind: Kind; id: string; top: number; left: number };
type Props = {
  workspaces: Workspace[]; folders: Folder[]; documents: FlowDocument[];
  newFolderId: string | null; activeId: string; activeWorkspaceId: string;
  search: string; searchHits: SearchHit[]; searchPending: boolean;
  expandedIds: string[]; newWorkspaceId: string | null; reducedMotion: boolean;
  onToggle: (id: string) => void; onSelectWorkspace: (id: string) => void;
  onOpen: (id: string) => void; onNewWorkspace: () => void;
  onNewFolder: (workspaceId: string) => void; onNewDocument: (workspaceId: string, folderId?: string) => void;
  onRenameFolder: (id: string, name: string) => void; onMoveToFolder: (id: string, folderId: string) => void;
  onDeleteFolder: (id: string) => void; onRenameWorkspace: (id: string, name: string) => void;
  onRenameDocument: (id: string, name: string) => void; onMoveDocument: (id: string, workspaceId: string) => void;
  onDeleteWorkspace: (id: string) => void; onDeleteDocument: (id: string) => void;
};

function Rename({ value: original, commit, cancel }: {
  value: string; commit: (value: string) => void; cancel: () => void;
}) {
  const [value, setValue] = useState(original);
  const settled = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus(); field.current?.select(); }, []);
  function finish(accept: boolean) {
    if (settled.current) return;
    settled.current = true;
    if (accept && value.trim()) commit(value.trim());
    else cancel();
  }
  return <input ref={field} className="filetree-rename" value={value} maxLength={160}
    aria-label="Rename" spellCheck={false}
    onChange={event => setValue(event.target.value)}
    onClick={event => event.stopPropagation()}
    onBlur={() => finish(true)}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    }} />;
}

export default function WorkspaceTree(props: Props) {
  const {
    workspaces, folders, documents, activeId, activeWorkspaceId, search, searchHits, searchPending,
    expandedIds, newWorkspaceId, newFolderId, reducedMotion, onToggle,
    onSelectWorkspace, onOpen, onNewWorkspace, onNewFolder, onNewDocument,
    onRenameFolder, onMoveToFolder, onDeleteFolder, onRenameWorkspace,
    onRenameDocument, onMoveDocument, onDeleteWorkspace, onDeleteDocument,
  } = props;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([]);
  const [drop, setDrop] = useState<string | null>(null);
  const interaction = reducedMotion ? {} : {
    whileHover: { scale: 1.045 },
    whileTap: { scale: 0.96 },
    transition: { duration: 0.17, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  };
  const menuMotion = reducedMotion ? {} : {
    whileHover: { x: 2 },
    whileTap: { scale: 0.99 },
    transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  };
  const searching = Boolean(search.trim());
  const query = search.trim().toLowerCase();

  useEffect(() => {
    const workspace = workspaces.find(item => item.id === newWorkspaceId);
    if (workspace && newWorkspaceId) setEditing({ kind: 'workspace', id: workspace.id, name: workspace.name });
  }, [newWorkspaceId]);
  useEffect(() => {
    const folder = folders.find(item => item.id === newFolderId);
    if (folder && newFolderId) {
      setCollapsedFolders(ids => ids.filter(id => id !== folder.id));
      setEditing({ kind: 'folder', id: folder.id, name: folder.name });
    }
  }, [newFolderId]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.filetree-more,.filetree-menu')) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    const dismiss = () => setMenu(null);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [menu]);

  function openMenu(event: MouseEvent<HTMLButtonElement>, kind: Kind, id: string) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const height = kind === 'workspace' ? 176 : kind === 'folder' ? 140 : 140;
    const top = Math.min(window.innerHeight - height - 8, rect.bottom + 4);
    const left = Math.max(8, Math.min(rect.right - 176, window.innerWidth - 184));
    setMenu(current => current?.kind === kind && current.id === id ? null :
      { kind, id, top: Math.max(8, top), left });
  }
  function rename(kind: Kind, id: string, name: string) {
    setEditing({ kind, id, name });
    setMenu(null);
  }
  function finishRename(kind: Kind, id: string, value: string) {
    if (kind === 'workspace') onRenameWorkspace(id, value);
    else if (kind === 'folder') onRenameFolder(id, value);
    else onRenameDocument(id, value);
    setEditing(null);
  }
  function field(kind: Kind, id: string) {
    return editing?.kind === kind && editing.id === id
      ? <Rename key={id} value={editing.name} commit={value => finishRename(kind, id, value)} cancel={() => setEditing(null)} />
      : null;
  }
  function dragDoc(event: React.DragEvent<HTMLDivElement>, id: string) {
    event.dataTransfer.setData('application/x-flow-document-id', id);
    event.dataTransfer.effectAllowed = 'move';
  }
  function dragOver(event: React.DragEvent<HTMLDivElement>, id: string) {
    if (!event.dataTransfer.types.includes('application/x-flow-document-id')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDrop(id);
  }
  function dropped(event: React.DragEvent<HTMLDivElement>, id: string, folder: boolean) {
    const documentId = event.dataTransfer.getData('application/x-flow-document-id');
    if (!documentId) return;
    event.preventDefault();
    event.stopPropagation();
    setDrop(null);
    if (folder) onMoveToFolder(documentId, id);
    else onMoveDocument(documentId, id);
  }
  function more(kind: Kind, id: string, label: string) {
    return <motion.button {...interaction} type="button" className="filetree-more" aria-label={'Actions for ' + label}
      aria-haspopup="menu" aria-expanded={menu?.kind === kind && menu.id === id}
      onClick={event => openMenu(event, kind, id)}><Icon name="more" size={16} /></motion.button>;
  }
  function documentRow(doc: FlowDocument) {
    return <div key={doc.id} role="treeitem" aria-selected={activeId === doc.id}
      className={'filetree-row filetree-file' + (activeId === doc.id ? ' is-active' : '')}
      draggable={!(editing?.kind === 'document' && editing.id === doc.id)}
      onDragStart={event => dragDoc(event, doc.id)} onDragEnd={() => setDrop(null)}>
      {activeId === doc.id && <motion.span
        className="filetree-selection" layoutId="flow-active-document"
        initial={false}
        transition={reducedMotion ? { duration: 0 } :
          { type: 'tween', duration: 0.24, ease: [0.22, 1, 0.36, 1] }} />}
      <Icon name={doc.fileType === 'image' ? 'svg' : 'file'} size={14} />
      {field('document', doc.id) ||
        <button className="filetree-label" type="button" title={doc.title} onClick={() => onOpen(doc.id)}>
          {doc.title || 'Untitled'}
        </button>}
      {more('document', doc.id, doc.title)}
    </div>;
  }

  const visible = workspaces.filter(ws =>
    !searching || ws.name.toLowerCase().includes(query) ||
    documents.some(doc => doc.workspaceId === ws.id) ||
    folders.some(folder => folder.workspaceId === ws.id && folder.name.toLowerCase().includes(query)));
  const ease = { duration: reducedMotion || searching ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };
  return <>
    <div className="filetree-heading">
      <span>{searching ? 'Results' : 'Workspaces'}</span>
      {!searching && <motion.button {...interaction} type="button" onClick={onNewWorkspace}
        aria-label="New workspace" title="New workspace">
        <Icon name="plus" size={16} />
      </motion.button>}
    </div>
    {searching ? <div className="filetree-scroll filetree-results" role="tree" aria-label="Search results"
      aria-busy={searchPending}>
      {documents.map(doc => {
        const hit = searchHits.find(item => item.id === doc.id);
        return <div className={'filetree-result' + (activeId === doc.id ? ' is-active' : '')}
          key={doc.id} role="treeitem" aria-selected={activeId === doc.id}>
          <button type="button" className="filetree-result-open"
            onClick={() => onOpen(doc.id)}
            title={'Open ' + doc.title}>
            <Icon name={doc.fileType === 'image' ? 'svg' : 'file'} size={14} />
            <span className="filetree-result-copy">
              <span className="filetree-result-title">{doc.title || 'Untitled'}</span>
              {hit?.snippet && <span className="filetree-result-snippet">{hit.snippet}</span>}
            </span>
          </button>
        </div>;
      })}
      {searchPending && <div className="filetree-empty" role="status">Searching pages…</div>}
      {!searchPending && !documents.length && <div className="filetree-empty">No matching pages</div>}
    </div> : <div className="filetree-scroll" role="tree" aria-label="Workspace files">
      {visible.map(ws => {
        const wsFolders = folders.filter(folder => folder.workspaceId === ws.id);
        const wsDocs = documents.filter(doc => doc.workspaceId === ws.id);
        const roots = wsDocs.filter(doc => !doc.folderId || !wsFolders.some(folder => folder.id === doc.folderId));
        const expanded = searching || expandedIds.includes(ws.id);
        return <div className="filetree-workspace" key={ws.id} role="treeitem" aria-expanded={expanded}>
          <div className={'filetree-row filetree-root' + (activeWorkspaceId === ws.id ? ' is-current' : '') +
            (drop === ws.id ? ' is-drop' : '')}
            onDragOver={event => dragOver(event, ws.id)}
            onDragLeave={() => setDrop(current => current === ws.id ? null : current)}
            onDrop={event => dropped(event, ws.id, false)}>
            <button className={'filetree-chevron' + (expanded ? ' is-open' : '')} type="button"
              aria-label={(expanded ? 'Collapse ' : 'Expand ') + ws.name}
              aria-expanded={expanded} onClick={() => onToggle(ws.id)}>
              <Icon name="chevron" size={13} />
            </button>
            <Icon name="folder" size={15} />
            {field('workspace', ws.id) ||
              <button type="button" className="filetree-label filetree-workspace-label"
                title={ws.name} onClick={() => { onSelectWorkspace(ws.id); if (!expanded) onToggle(ws.id); }}>
                {ws.name}
              </button>}
            <motion.button {...interaction} type="button" className="filetree-add-page"
              aria-label={'Add page to ' + ws.name}
              title="Add page"
              onClick={event => { event.stopPropagation(); onNewDocument(ws.id); }}>
              <Icon name="plus" size={15} />
            </motion.button>
            {more('workspace', ws.id, ws.name)}
          </div>
          <AnimatePresence initial={false}>
            {expanded && <motion.div role="group" className="filetree-branch" initial={false}
              animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={ease}>
              {wsFolders.filter(folder => !searching || folder.name.toLowerCase().includes(query) ||
                wsDocs.some(doc => doc.folderId === folder.id)).map(folder => {
                const open = searching || !collapsedFolders.includes(folder.id);
                return <div className="filetree-folder-group" key={folder.id} role="treeitem" aria-expanded={open}>
                  <div className={'filetree-row filetree-folder' + (drop === folder.id ? ' is-drop' : '')}
                    onDragOver={event => dragOver(event, folder.id)}
                    onDragLeave={() => setDrop(current => current === folder.id ? null : current)}
                    onDrop={event => dropped(event, folder.id, true)}>
                    <button type="button" className={'filetree-chevron' + (open ? ' is-open' : '')}
                      aria-label={(open ? 'Collapse ' : 'Expand ') + folder.name} aria-expanded={open}
                      onClick={() => setCollapsedFolders(ids => open ? [...ids, folder.id] : ids.filter(id => id !== folder.id))}>
                      <Icon name="chevron" size={13} />
                    </button>
                    <Icon name="folder" size={14} />
                    {field('folder', folder.id) ||
                      <button type="button" className="filetree-label" title={folder.name}
                        onClick={() => setCollapsedFolders(ids => open ? [...ids, folder.id] : ids.filter(id => id !== folder.id))}>
                        {folder.name}
                      </button>}
                    {more('folder', folder.id, folder.name)}
                  </div>
                  <AnimatePresence initial={false}>
                    {open && <motion.div role="group" className="filetree-folder-branch"
                      initial={false} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={ease}>
                      {wsDocs.filter(doc => doc.folderId === folder.id).map(documentRow)}
                    </motion.div>}
                  </AnimatePresence>
                </div>;
              })}
              {roots.map(documentRow)}
              {!wsFolders.length && !wsDocs.length && !searching && <div className="filetree-empty">No files</div>}
            </motion.div>}
          </AnimatePresence>
        </div>;
      })}
    </div>}
    {menu && createPortal(<motion.div role="menu" className="filetree-menu"
      style={{ top: menu.top, left: menu.left }} aria-label="File actions"
      initial={reducedMotion ? false : { opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.19, ease: [0.22, 1, 0.36, 1] }}>
      {menu.kind === 'workspace' && <>
        <motion.button {...menuMotion} role="menuitem" type="button" onClick={() => { onNewDocument(menu.id); setMenu(null); }}><Icon name="file" size={15} /> Add page</motion.button>
        <motion.button {...menuMotion} role="menuitem" type="button" onClick={() => { onNewFolder(menu.id); setMenu(null); }}><Icon name="folder" size={15} /> New folder</motion.button>
      </>}
      {menu.kind === 'folder' && <motion.button {...menuMotion} role="menuitem" type="button"
        onClick={() => {
          const folder = folders.find(item => item.id === menu.id);
          if (folder) onNewDocument(folder.workspaceId, folder.id);
          setMenu(null);
        }}><Icon name="file" size={15} /> Add page</motion.button>}
      {menu.kind === 'document' && (() => {
        const doc = documents.find(item => item.id === menu.id);
        return doc?.folderId ? <motion.button {...menuMotion} role="menuitem" type="button" onClick={() => {
          onMoveDocument(doc.id, doc.workspaceId); setMenu(null);
        }}><Icon name="folder" size={15} /> Move to root</motion.button> : null;
      })()}
      <motion.button {...menuMotion} role="menuitem" type="button" onClick={() => {
        const item = menu.kind === 'workspace' ? workspaces.find(ws => ws.id === menu.id) :
          menu.kind === 'folder' ? folders.find(folder => folder.id === menu.id) :
          documents.find(doc => doc.id === menu.id);
        if (item) rename(menu.kind, menu.id, 'name' in item ? item.name : item.title);
      }}><Icon name="edit" size={15} /> Rename</motion.button>
      <motion.button {...menuMotion} role="menuitem" type="button" className="filetree-delete"
        disabled={menu.kind === 'workspace' && workspaces.length < 2}
        onClick={() => {
          const { kind, id } = menu; setMenu(null);
          if (kind === 'workspace') onDeleteWorkspace(id);
          else if (kind === 'folder') onDeleteFolder(id);
          else onDeleteDocument(id);
        }}><Icon name="trash" size={15} /> Delete</motion.button>
    </motion.div>, document.body)}
  </>;
}
