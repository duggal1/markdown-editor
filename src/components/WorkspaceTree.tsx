import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons';
import type { FlowDocument, Folder, Workspace } from '../lib/store';

type Editing = { kind: 'workspace' | 'folder' | 'document'; id: string; name: string };
type TreeMenu = { kind: 'workspace' | 'folder' | 'document'; id: string; top: number; left: number };
type Props = {
  workspaces: Workspace[];
  folders: Folder[];
  documents: FlowDocument[];
  newFolderId: string | null;
  activeId: string;
  activeWorkspaceId: string;
  search: string;
  expandedIds: string[];
  newWorkspaceId: string | null;
  reducedMotion: boolean;
  onToggle: (id: string) => void;
  onSelectWorkspace: (id: string) => void;
  onOpen: (id: string) => void;
  onNewWorkspace: () => void;
  onNewFolder: (workspaceId: string) => void;
  onNewDocument: (workspaceId: string, folderId?: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onMoveToFolder: (id: string, folderId: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameWorkspace: (id: string, name: string) => void;
  onRenameDocument: (id: string, name: string) => void;
  onMoveDocument: (id: string, workspaceId: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onDeleteDocument: (id: string) => void;
};
function RenameField({ name, onCommit, onCancel }: {
  name: string; onCommit: (value: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  const settled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  function commit() {
    if (settled.current) return;
    settled.current = true;
    const next = value.trim();
    if (next) onCommit(next);
    else onCancel();
  }
  function cancel() {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  }
  return <input ref={inputRef} className="tree-rename" aria-label="Rename" value={value}
    maxLength={160} onClick={event => event.stopPropagation()}
    onChange={event => setValue(event.target.value)}
    onBlur={commit}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    }} />;
}

export default function WorkspaceTree({
  workspaces, folders, documents, activeId, activeWorkspaceId, search, expandedIds,
  newWorkspaceId, newFolderId, reducedMotion, onToggle, onSelectWorkspace, onOpen,
  onNewWorkspace, onNewFolder, onNewDocument, onRenameWorkspace, onRenameFolder,
  onRenameDocument, onMoveDocument, onMoveToFolder, onDeleteFolder,
  onDeleteWorkspace, onDeleteDocument,
}: Props) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [menu, setMenu] = useState<TreeMenu | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!newWorkspaceId) return;
    const ws = workspaces.find(item => item.id === newWorkspaceId);
    if (ws) setEditing({ kind: 'workspace', id: ws.id, name: ws.name });
  // Only a newly created id starts the rename flow; edits must not restart it.
  }, [newWorkspaceId]);
  useEffect(() => {
    if (!newFolderId) return;
    const folder = folders.find(item => item.id === newFolderId);
    if (folder) setEditing({ kind: 'folder', id: folder.id, name: folder.name });
  }, [newFolderId]);
  useEffect(() => {
    if (!menu) return;
    function close(event: globalThis.PointerEvent) {
      if (!(event.target instanceof Element) ||
        !event.target.closest('.tree-more, .tree-menu')) setMenu(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenu(null);
    }
    const closeOnScroll = () => setMenu(null);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    document.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnScroll);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeOnScroll);
    };
  }, [menu]);
  function toggleMenu(event: MouseEvent<HTMLButtonElement>, kind: TreeMenu['kind'], id: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    const top = window.innerHeight - rect.bottom < 88 && rect.top > 88
      ? rect.top - 79 : rect.bottom + 4;
    const left = Math.max(8, Math.min(rect.right - 168, window.innerWidth - 176));
    setMenu(current => current?.kind === kind && current.id === id ? null : {
      kind, id, top, left,
    });
  }
  const searching = Boolean(search.trim());
  function renderDocument(doc: FlowDocument) {
    const docEditing = editing?.kind === 'document' && editing.id === doc.id;
    return <div key={doc.id} role="treeitem" draggable={!docEditing} onDragStart={event => {
      event.dataTransfer.setData('application/x-flow-document-id', doc.id);
      event.dataTransfer.effectAllowed = 'move';
    }} onDragEnd={() => setDropTarget(null)} className={'tree-row tree-document' + (activeId === doc.id ? ' is-active' : '')}>
      <Icon name={doc.fileType === 'image' ? 'svg' : 'file'} size={14} />
      {docEditing ? <RenameField name={doc.title} onCommit={name => { onRenameDocument(doc.id, name); setEditing(null); }} onCancel={() => setEditing(null)} />
        : <button type="button" className="tree-document-name" title={doc.title} onClick={() => onOpen(doc.id)}>
          <span className="tree-document-title">{doc.title || 'Untitled'}</span>
          <span className="md-tag">{doc.fileName?.match(/\.[^.]+$/)?.[0] || '.md'}</span>
        </button>}
      <button type="button" className="tree-more" title={'Actions for ' + doc.title} aria-label={'Actions for ' + doc.title} onClick={event => toggleMenu(event, 'document', doc.id)}><Icon name="more" size={16} /></button>
    </div>;
  }
  return <>
    <div className="tree-heading">
      <span>Workspaces</span>
      <button type="button" onClick={onNewWorkspace} title="New workspace" aria-label="New workspace">
        <Icon name="plus" size={16} />
      </button>
    </div>
    <div className="tree-list" role="tree" aria-label="Workspaces">
      {workspaces.map(ws => {
        const children = documents.filter(doc => doc.workspaceId === ws.id);
        const workspaceFolders = folders.filter(folder => folder.workspaceId === ws.id);
        const rootChildren = children.filter(doc => !doc.folderId || !workspaceFolders.some(folder => folder.id === doc.folderId));
        const show = !searching || children.length || workspaceFolders.some(folder => folder.name.toLowerCase().includes(search.trim().toLowerCase())) || ws.name.toLowerCase().includes(search.trim().toLowerCase());
        if (!show) return null;
        const expanded = searching || expandedIds.includes(ws.id);
        const wsEditing = editing?.kind === 'workspace' && editing.id === ws.id;
        const selected = activeWorkspaceId === ws.id;
        return <div className="tree-workspace" key={ws.id} role="treeitem" aria-expanded={expanded}>
          <div className={'tree-row tree-workspace-row' + (selected ? ' is-current' : '') + (dropTarget === ws.id ? ' is-drop' : '')}
            onDragOver={event => {
              if (event.dataTransfer.types.includes('application/x-flow-document-id')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget(ws.id);
              }
            }}
            onDragLeave={() => setDropTarget(current => current === ws.id ? null : current)}
            onDrop={event => {
              const id = event.dataTransfer.getData('application/x-flow-document-id');
              if (!id) return;
              event.preventDefault();
              event.stopPropagation();
              setDropTarget(null);
              onMoveDocument(id, ws.id);
            }}>
            <button type="button" className={'tree-chevron' + (expanded ? ' is-expanded' : '')}
              title={expanded ? 'Collapse workspace' : 'Expand workspace'}
              aria-label={(expanded ? 'Collapse ' : 'Expand ') + ws.name}
              onClick={() => onToggle(ws.id)}><Icon name="chevron" size={14} /></button>
            <Icon name="folder" size={15} />
            {wsEditing
              ? <RenameField key={ws.id} name={editing?.name || ws.name}
                  onCommit={name => { onRenameWorkspace(ws.id, name); setEditing(null); }}
                  onCancel={() => setEditing(null)} />
              : <button type="button" className="tree-workspace-name"
                  title={ws.name}
                  onClick={() => { onSelectWorkspace(ws.id); onToggle(ws.id); }}>
                  {ws.name}
                </button>}
            <button type="button" className="tree-add" title={'New document in ' + ws.name}
              aria-label={'New document in ' + ws.name}
              onClick={() => onNewDocument(ws.id)}><Icon name="plus" size={14} /></button>
            <button type="button" className="tree-add-folder" title={'New folder in ' + ws.name}
              aria-label={'New folder in ' + ws.name} onClick={() => onNewFolder(ws.id)}>
              <Icon name="folder" size={14} /><Icon name="plus" size={9} />
            </button>
            <div className="tree-action">
              <button type="button" className="tree-more" title={'Actions for ' + ws.name}
                aria-label={'Actions for ' + ws.name} aria-expanded={menu?.kind === 'workspace' && menu.id === ws.id}
                onClick={event => toggleMenu(event, 'workspace', ws.id)}>
                <Icon name="more" size={16} />
              </button>
            </div>
          </div>
          <AnimatePresence initial={false}>
            {expanded && <motion.div className="tree-children" role="group"
              initial={reducedMotion || searching ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={reducedMotion || searching ? undefined : { height: 0, opacity: 0 }}
              transition={{ duration: reducedMotion || searching ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}>
              {workspaceFolders.filter(folder => !searching || children.some(doc => doc.folderId === folder.id) || folder.name.toLowerCase().includes(search.trim().toLowerCase())).map(folder => {
                const folderDocs = children.filter(doc => doc.folderId === folder.id);
                const folderEditing = editing?.kind === 'folder' && editing.id === folder.id;
                return <div key={folder.id} className="tree-folder-group">
                  <div className="tree-row tree-folder" role="treeitem" onDragOver={event => {
                    if (event.dataTransfer.types.includes('application/x-flow-document-id')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(folder.id); }
                  }} onDragLeave={() => setDropTarget(current => current === folder.id ? null : current)}
                    onDrop={event => { const id = event.dataTransfer.getData('application/x-flow-document-id'); if (!id) return; event.preventDefault(); event.stopPropagation(); setDropTarget(null); onMoveToFolder(id, folder.id); }}
                    data-drop={dropTarget === folder.id || undefined}>
                    <Icon name="folder" size={14} />
                    {folderEditing ? <RenameField name={folder.name} onCommit={name => { onRenameFolder(folder.id, name); setEditing(null); }} onCancel={() => setEditing(null)} />
                      : <span className="tree-folder-name" title={folder.name}>{folder.name}</span>}
                    <button type="button" className="tree-add" title={'New document in ' + folder.name} aria-label={'New document in ' + folder.name} onClick={() => onNewDocument(ws.id, folder.id)}><Icon name="plus" size={14} /></button>
                    <button type="button" className="tree-more" aria-label={'Actions for ' + folder.name} onClick={event => toggleMenu(event, 'folder', folder.id)}><Icon name="more" size={16} /></button>
                  </div>
                  <div className="tree-folder-documents">
                    {folderDocs.map(doc => renderDocument(doc))}
                  </div>
                </div>;
              })}
              {rootChildren.map(doc => {
                const docEditing = editing?.kind === 'document' && editing.id === doc.id;
                return <div key={doc.id} role="treeitem"
                  draggable={!docEditing}
                  onDragStart={event => {
                    event.dataTransfer.setData('application/x-flow-document-id', doc.id);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDropTarget(null)}
                  className={'tree-row tree-document' + (activeId === doc.id ? ' is-active' : '')}>
                  <Icon name={doc.fileType === 'image' ? 'svg' : 'file'} size={14} />
                  {docEditing
                    ? <RenameField key={doc.id} name={editing?.name || doc.title}
                        onCommit={name => { onRenameDocument(doc.id, name); setEditing(null); }}
                        onCancel={() => setEditing(null)} />
                    : <button type="button" className="tree-document-name"
                        title={doc.title}
                        onClick={() => onOpen(doc.id)}>
                        <span className="tree-document-title">{doc.title || 'Untitled'}</span>
                        <span className="md-tag">{doc.fileName?.match(/\.[^.]+$/)?.[0] || '.md'}</span>
                      </button>}
                  <div className="tree-action">
                    <button type="button" className="tree-more" title={'Actions for ' + doc.title}
                      aria-label={'Actions for ' + doc.title} aria-expanded={menu?.kind === 'document' && menu.id === doc.id}
                      onClick={event => toggleMenu(event, 'document', doc.id)}>
                      <Icon name="more" size={16} />
                    </button>
                  </div>
                </div>;
              })}
              {!children.length && !workspaceFolders.length && <span className="tree-empty">No documents</span>}
            </motion.div>}
          </AnimatePresence>
        </div>;
      })}
      {searching && !workspaces.some(ws => documents.some(doc => doc.workspaceId === ws.id) ||
        ws.name.toLowerCase().includes(search.trim().toLowerCase())) &&
        <span className="tree-empty">No matches</span>}
    </div>
    {menu && createPortal(<div className="tree-menu" role="menu"
      aria-label={menu.kind === 'workspace' ? 'Workspace actions' : 'Document actions'}
      style={{ top: menu.top, left: menu.left }}>
      <button type="button" role="menuitem" onClick={() => {
        const item = menu.kind === 'workspace'
          ? workspaces.find(ws => ws.id === menu.id)
          : menu.kind === 'folder' ? folders.find(folder => folder.id === menu.id)
          : documents.find(doc => doc.id === menu.id);
        if (item) setEditing({ kind: menu.kind, id: menu.id,
          name: 'name' in item ? item.name : item.title || 'Untitled' });
        setMenu(null);
      }}>Rename</button>
      <button type="button" role="menuitem" className="tree-menu-delete"
        disabled={menu.kind === 'workspace' && workspaces.length < 2}
        onClick={() => {
          const { kind, id } = menu;
          setMenu(null);
          if (kind === 'workspace') onDeleteWorkspace(id);
          else if (kind === 'folder') onDeleteFolder(id);
          else onDeleteDocument(id);
        }}>Delete</button>
    </div>, document.body)}
  </>;
}
