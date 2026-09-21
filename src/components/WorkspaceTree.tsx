import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Icon } from './Icons';
import type { FlowDocument, Workspace } from '../lib/store';

type Editing = { kind: 'workspace' | 'document'; id: string; name: string };
type Props = {
  workspaces: Workspace[];
  documents: FlowDocument[];
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
  onNewDocument: (workspaceId: string) => void;
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
  workspaces, documents, activeId, activeWorkspaceId, search, expandedIds,
  newWorkspaceId, reducedMotion, onToggle, onSelectWorkspace, onOpen,
  onNewWorkspace, onNewDocument, onRenameWorkspace, onRenameDocument, onMoveDocument,
  onDeleteWorkspace, onDeleteDocument,
}: Props) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  const heldId = useRef<string | null>(null);
  useEffect(() => {
    if (!newWorkspaceId) return;
    const ws = workspaces.find(item => item.id === newWorkspaceId);
    if (ws) setEditing({ kind: 'workspace', id: ws.id, name: ws.name });
  // Only a newly created id starts the rename flow; edits must not restart it.
  }, [newWorkspaceId]);
  useEffect(() => {
    if (!menu) return;
    function close(event: globalThis.PointerEvent) {
      if (!(event.target instanceof Element) ||
        !event.target.closest('.tree-more, .tree-menu')) setMenu(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenu(null);
    }
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);
  useEffect(() => () => {
    if (holdTimer.current !== undefined) clearTimeout(holdTimer.current);
  }, []);
  function beginTouch(event: PointerEvent<HTMLButtonElement>, doc: FlowDocument) {
    if (event.pointerType !== 'touch') return;
    if (holdTimer.current !== undefined) clearTimeout(holdTimer.current);
    heldId.current = null;
    holdTimer.current = window.setTimeout(() => {
      heldId.current = doc.id;
      setEditing({ kind: 'document', id: doc.id, name: doc.title || 'Untitled' });
    }, 550);
  }
  function endTouch() {
    if (holdTimer.current !== undefined) clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
  }
  const searching = Boolean(search.trim());
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
        const show = !searching || children.length || ws.name.toLowerCase().includes(search.trim().toLowerCase());
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
                  title={ws.name + ' · double-click to rename'}
                  onClick={event => { onSelectWorkspace(ws.id); if (event.detail === 1) onToggle(ws.id); }}
                  onDoubleClick={() => setEditing({ kind: 'workspace', id: ws.id, name: ws.name })}>
                  {ws.name}
                </button>}
            <button type="button" className="tree-add" title={'New document in ' + ws.name}
              aria-label={'New document in ' + ws.name}
              onClick={() => onNewDocument(ws.id)}><Icon name="plus" size={14} /></button>
            <div className="tree-action">
              <button type="button" className="tree-more" title={'Actions for ' + ws.name}
                aria-label={'Actions for ' + ws.name} aria-expanded={menu === 'w:' + ws.id}
                onClick={() => setMenu(current => current === 'w:' + ws.id ? null : 'w:' + ws.id)}>
                <Icon name="more" size={16} />
              </button>
              {menu === 'w:' + ws.id && <div className="tree-menu" role="menu">
                <button type="button" role="menuitem" disabled={workspaces.length < 2}
                  onClick={() => { setMenu(null); onDeleteWorkspace(ws.id); }}>Delete workspace</button>
              </div>}
            </div>
          </div>
          <AnimatePresence initial={false}>
            {expanded && <motion.div className="tree-children" role="group"
              initial={reducedMotion || searching ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={reducedMotion || searching ? undefined : { height: 0, opacity: 0 }}
              transition={{ duration: reducedMotion || searching ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}>
              {children.map(doc => {
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
                        title={doc.title + ' · double-click to rename'}
                        onClick={() => {
                          if (heldId.current === doc.id) { heldId.current = null; return; }
                          onOpen(doc.id);
                        }}
                        onDoubleClick={() => setEditing({ kind: 'document', id: doc.id, name: doc.title || 'Untitled' })}
                        onPointerDown={event => beginTouch(event, doc)}
                        onPointerUp={endTouch} onPointerCancel={endTouch}
                        onPointerLeave={endTouch}>
                        <span className="tree-document-title">{doc.title || 'Untitled'}</span>
                        <span className="md-tag">{doc.fileName?.match(/\.[^.]+$/)?.[0] || '.md'}</span>
                      </button>}
                  <div className="tree-action">
                    <button type="button" className="tree-more" title={'Actions for ' + doc.title}
                      aria-label={'Actions for ' + doc.title} aria-expanded={menu === 'd:' + doc.id}
                      onClick={() => setMenu(current => current === 'd:' + doc.id ? null : 'd:' + doc.id)}>
                      <Icon name="more" size={16} />
                    </button>
                    {menu === 'd:' + doc.id && <div className="tree-menu" role="menu">
                      <button type="button" role="menuitem"
                        onClick={() => { setMenu(null); onDeleteDocument(doc.id); }}>Delete</button>
                    </div>}
                  </div>
                </div>;
              })}
              {!children.length && <span className="tree-empty">No documents</span>}
            </motion.div>}
          </AnimatePresence>
        </div>;
      })}
      {searching && !workspaces.some(ws => documents.some(doc => doc.workspaceId === ws.id) ||
        ws.name.toLowerCase().includes(search.trim().toLowerCase())) &&
        <span className="tree-empty">No matches</span>}
    </div>
  </>;
}
