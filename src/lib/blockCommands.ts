import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { Prec, type Text } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { phosphorElement, type IconName } from './phosphorGlyphs';
import { selectionEdit, type SelectionFormat } from './selectionFormat';

type Command = { name: string; icon: string; keywords: string; insert: string; caret?: number; group: string };
const commands: Command[] = [
  { name: 'Text', icon: 'text', keywords: 'paragraph plain', insert: '', group: 'Basic blocks' },
  ...[1, 2, 3, 4].map(n => ({ name: 'Heading ' + n, icon: 'h' + n, keywords: 'title h' + n,
    insert: '#'.repeat(n) + ' ', group: 'Basic blocks' })),
  { name: 'Bulleted list', icon: 'bullet', keywords: 'unordered ul', insert: '- ', group: 'Basic blocks' },
  { name: 'Numbered list', icon: 'number', keywords: 'ordered ol', insert: '1. ', group: 'Basic blocks' },
  { name: 'To-do list', icon: 'todo', keywords: 'task checkbox checklist', insert: '- [ ] ', group: 'Basic blocks' },
  { name: 'Quote', icon: 'quote', keywords: 'blockquote', insert: '> ', group: 'Basic blocks' },
  { name: 'Divider', icon: 'divider', keywords: 'horizontal rule separator', insert: '---\n\n', group: 'Basic blocks' },
  { name: 'Table', icon: 'table', keywords: 'grid columns', insert: '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n', caret: 2, group: 'Basic blocks' },
  { name: 'Bold', icon: 'bold', keywords: 'strong', insert: '****', caret: 2, group: 'Inline' },
  { name: 'Italic', icon: 'italic', keywords: 'emphasis', insert: '**', caret: 1, group: 'Inline' },
  { name: 'Link', icon: 'link', keywords: 'url hyperlink bookmark', insert: '[text](https://)', caret: 1, group: 'Inline' },
  { name: 'Inline code', icon: 'code', keywords: 'monospace', insert: '\x60\x60', caret: 1, group: 'Inline' },
  { name: 'Code block', icon: 'code', keywords: 'fenced programming', insert: '\x60\x60\x60\n\n\x60\x60\x60', caret: 4, group: 'Media and code' },
  { name: 'Image', icon: 'image', keywords: 'photo picture url', insert: '![alt text](https://)', caret: 2, group: 'Media and code' },
  { name: 'HTML block', icon: 'html', keywords: 'embed markup', insert: '\x60\x60\x60html\n\n\x60\x60\x60', caret: 8, group: 'Media and code' },
];
function glyph(name: string): SVGSVGElement {
  const aliases: Record<string, IconName> = { bullet: 'list', image: 'svg' };
  return phosphorElement(aliases[name] || name as IconName);
}
const selectionActions: { kind: SelectionFormat; icon: string; label: string }[] = [
  { kind: 'bold', icon: 'bold', label: 'Bold' }, { kind: 'italic', icon: 'italic', label: 'Italic' },
  { kind: 'link', icon: 'link', label: 'Link' }, { kind: 'code', icon: 'code', label: 'Code' },
  ...([1, 2, 3, 4] as const).map(n => ({ kind: ('h' + n) as SelectionFormat, icon: 'h' + n, label: 'Heading ' + n })),
  { kind: 'bullet', icon: 'bullet', label: 'Bulleted list' }, { kind: 'number', icon: 'number', label: 'Numbered list' },
  { kind: 'todo', icon: 'todo', label: 'To-do list' }, { kind: 'quote', icon: 'quote', label: 'Quote' },
  { kind: 'text', icon: 'text', label: 'Plain text block' },
];
type Span = { from: number; to: number };
function blockAt(view: EditorView, pos: number): Span {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  let node = syntaxTree(view.state).resolveInner(pos, 1);
  // Preserve fenced blocks, tables, quotes, and complete list items.
  while (node.parent && node.parent.name !== 'Document' && node.name !== 'ListItem') node = node.parent;
  if (node.name === 'Document' || node.from === node.to) return { from: line.from, to: line.to };
  return { from: doc.lineAt(node.from).from, to: doc.lineAt(Math.max(node.from, node.to - 1)).to };
}
function codeContext(view: EditorView, pos: number): boolean {
  if (view.dom.classList.contains('raw-code')) return true;
  let node = syntaxTree(view.state).resolveInner(pos, -1);
  while (node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock'].includes(node.name)) return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}
class BlockUI {
  menu = document.createElement('div');
  handle = document.createElement('div');
  toolbar = document.createElement('div');
  selectionFrame = 0;
  dismissedSelection: Span | null = null;
  selectionSnapshot: (Span & { doc: Text }) | null = null;
  add = document.createElement('button');
  grip = document.createElement('button');
  matches: Command[] = [];
  selected = 0;
  trigger: Span | null = null;
  dismissed: number | null = null;
  hover: Span | null = null;
  drag: { span: Span; doc: Text } | null = null;
  frame = 0;
  menuFrame = 0;
  constructor(readonly view: EditorView) {
    this.menu.className = 'flow-slash-menu';
    this.menu.setAttribute('role', 'listbox');
    this.menu.setAttribute('aria-label', 'Insert Markdown block');
    this.menu.hidden = true;
    this.handle.className = 'flow-block-handle';
    this.handle.hidden = true;
    this.add.type = this.grip.type = 'button';
    this.add.title = 'Insert block'; this.add.setAttribute('aria-label', 'Insert block');
    this.grip.title = 'Drag to move block'; this.grip.setAttribute('aria-label', 'Drag to move block');
    this.add.append(glyph('plus')); this.grip.append(glyph('grip'));
    this.grip.draggable = true;
    this.handle.append(this.add, this.grip);
    this.toolbar.className = 'flow-selection-toolbar';
    this.toolbar.setAttribute('role', 'group');
    this.toolbar.setAttribute('aria-label', 'Format selected Markdown');
    this.toolbar.hidden = true;
    for (const action of selectionActions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = action.label;
      button.setAttribute('aria-label', action.label);
      button.dataset.format = action.kind;
      button.append(glyph(action.icon));
      // Keep the editor's native selection when using mouse, pen or touch.
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => this.formatSelection(action.kind));
      this.toolbar.append(button);
    }
    this.toolbar.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.escape();
        this.view.focus();
      }
    });
    this.toolbar.addEventListener('focusout', this.scheduleSelection);
    document.body.append(this.menu, this.handle, this.toolbar);
    view.dom.addEventListener('pointerup', this.scheduleSelection);
    view.dom.addEventListener('touchend', this.scheduleSelection, { passive: true });
    window.visualViewport?.addEventListener('resize', this.scheduleSelection);
    window.visualViewport?.addEventListener('scroll', this.scheduleSelection);
    this.add.addEventListener('mousedown', e => e.preventDefault());
    this.add.addEventListener('click', () => {
      const span = this.hover;
      if (!span) return;
      const line = this.view.state.doc.lineAt(span.to);
      const insert = line.text.trim() ? '\n/' : '/';
      const from = line.text.trim() ? line.to : line.from;
      this.view.dispatch({ changes: { from, to: line.to, insert }, selection: { anchor: from + insert.length } });
      this.view.focus();
    });
    this.grip.addEventListener('dragstart', e => {
      if (!this.hover || !e.dataTransfer) { e.preventDefault(); return; }
      this.drag = { span: this.hover, doc: view.state.doc };
      e.dataTransfer.setData('application/x-flow-markdown-block', 'move');
      e.dataTransfer.effectAllowed = 'move';
    });
    this.grip.addEventListener('dragend', () => { this.drag = null; });
    view.dom.addEventListener('pointermove', this.onMove);
    view.dom.addEventListener('dragover', this.onDragOver, true);
    view.dom.addEventListener('drop', this.onDrop, true);
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
    document.addEventListener('pointerdown', this.onOutside);
    window.addEventListener('resize', this.onScroll);
  }
  onOutside = (e: PointerEvent) => {
    if (!(e.target instanceof Node) || this.menu.contains(e.target) || this.handle.contains(e.target) || this.toolbar.contains(e.target)) return;
    if (!this.view.dom.contains(e.target)) {
      this.close(); this.handle.hidden = true;
      const range = this.view.state.selection.main;
      this.dismissedSelection = { from: range.from, to: range.to };
      this.hideSelection();
    }
  };
  onScroll = () => { this.handle.hidden = true; if (this.trigger) this.position(); this.scheduleSelection(); };
  hideSelection() {
    this.toolbar.hidden = true;
    this.selectionSnapshot = null;
  }
  scheduleSelection = () => {
    if (this.selectionFrame) return;
    this.selectionFrame = requestAnimationFrame(() => {
      this.selectionFrame = 0;
      this.positionSelection();
    });
  };
  positionSelection() {
    const { state } = this.view;
    const range = state.selection.main;
    const focused = this.view.hasFocus || this.toolbar.contains(document.activeElement);
    if (!focused || range.empty || state.selection.ranges.length !== 1 ||
        state.readOnly || this.view.composing ||
        this.view.dom.classList.contains('raw-code') ||
        (this.dismissedSelection?.from === range.from && this.dismissedSelection.to === range.to) ||
        !this.view.dom.getClientRects().length || getComputedStyle(this.view.dom).visibility === 'hidden') {
      this.hideSelection(); return;
    }
    // Never apply prose formatting inside source blocks or across fenced code.
    let inCode = false;
    syntaxTree(state).iterate({ from: range.from, to: range.to, enter: node => {
      if (node.from < range.to && node.to > range.from &&
          ['FencedCode', 'CodeBlock', 'HTMLBlock'].includes(node.name)) { inCode = true; return false; }
    } });
    if (inCode) { this.hideSelection(); return; }
    const pane = this.view.scrollDOM.getBoundingClientRect();
    const vv = window.visualViewport;
    const left = Math.max(pane.left, vv?.offsetLeft ?? 0) + 8;
    const right = Math.min(pane.right, (vv?.offsetLeft ?? 0) + (vv?.width ?? window.innerWidth)) - 8;
    const top = Math.max(pane.top, vv?.offsetTop ?? 0) + 8;
    const bottom = Math.min(pane.bottom, (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight)) - 8;
    if (right - left < 100 || bottom - top < 48) { this.hideSelection(); return; }
    const start = this.view.coordsAtPos(range.from, 1);
    const end = this.view.coordsAtPos(range.to, -1);
    if ((!start && !end) || (start && end && (end.bottom < top || start.top > bottom))) {
      this.hideSelection(); return;
    }
    const visible = (rect: typeof start) => !!rect && rect.bottom >= top && rect.top <= bottom;
    if (!visible(start) && !visible(end) && !(start && end && start.top < top && end.bottom > bottom)) {
      this.hideSelection(); return;
    }
    this.handle.hidden = true;
    this.close();
    this.toolbar.style.maxWidth = (right - left) + 'px';
    this.toolbar.hidden = false;
    const link = this.toolbar.querySelector<HTMLButtonElement>('[data-format="link"]');
    // Compare line numbers rather than allocating selected text on each frame.
    if (link) link.disabled = state.doc.lineAt(range.from).number !== state.doc.lineAt(range.to - 1).number;
    const width = this.toolbar.offsetWidth, height = this.toolbar.offsetHeight;
    if (height > bottom - top) { this.hideSelection(); return; }
    const anchor = visible(start) ? start! : visible(end) ? end! : null;
    const center = start && end && Math.abs(start.top - end.top) < 2
      ? (start.left + end.right) / 2 : anchor?.left ?? (left + right) / 2;
    const above = (start?.top ?? top) - height - 8;
    const below = (end?.bottom ?? bottom) + 8;
    const y = above >= top ? above : below + height <= bottom ? below
      : anchor && anchor.top - top > bottom - anchor.bottom ? top : bottom - height;
    this.toolbar.style.left = Math.max(left, Math.min(center - width / 2, right - width)) + 'px';
    this.toolbar.style.top = Math.max(top, Math.min(y, bottom - height)) + 'px';
    this.selectionSnapshot = { from: range.from, to: range.to, doc: state.doc };
  }
  focusSelection() {
    if (this.toolbar.hidden) return false;
    this.toolbar.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return true;
  }
  formatSelection(kind: SelectionFormat) {
    const snapshot = this.selectionSnapshot;
    if (!snapshot || snapshot.doc !== this.view.state.doc) { this.hideSelection(); return; }
    const range = this.view.state.selection.main;
    if (range.from !== snapshot.from || range.to !== snapshot.to) { this.hideSelection(); return; }
    const edit = selectionEdit(snapshot.doc, snapshot.from, snapshot.to, kind);
    if (!edit) return;
    this.view.dispatch({ ...edit, userEvent: 'input.format', scrollIntoView: false });
    this.view.focus();
    if (kind === 'link') {
      this.dismissedSelection = { from: edit.selection.anchor, to: edit.selection.head };
      this.hideSelection();
    } else this.scheduleSelection();
  }
  onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || this.drag || !this.menu.hidden || !this.view.state.selection.main.empty) { this.handle.hidden = true; return; }
    if (this.frame) return;
    const x = e.clientX, y = e.clientY;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const content = this.view.contentDOM.getBoundingClientRect();
      if (x > content.right || x < content.left - 60 || y < content.top || y > content.bottom) { this.handle.hidden = true; return; }
      const pos = this.view.posAtCoords({ x: Math.max(content.left + 2, x), y }, false);
      if (pos === null || this.view.dom.classList.contains('raw-code')) { this.handle.hidden = true; return; }
      const span = blockAt(this.view, pos);
      const rect = this.view.coordsAtPos(span.from);
      if (!rect) { this.handle.hidden = true; return; }
      this.hover = span;
      this.handle.style.left = Math.max(4, rect.left - 50) + 'px';
      this.handle.style.top = rect.top + 'px';
      this.handle.hidden = false;
    });
  };
  onDragOver = (e: DragEvent) => {
    if (!this.drag || !e.dataTransfer?.types.includes('application/x-flow-markdown-block')) return;
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
  };
  onDrop = (e: DragEvent) => {
    const drag = this.drag;
    if (!drag) return;
    e.preventDefault(); e.stopPropagation(); this.drag = null;
    if (drag.doc !== this.view.state.doc) return;
    const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
    if (pos === null) return;
    const target = blockAt(this.view, pos);
    const rect = this.view.coordsAtPos(target.from);
    const before = !rect || e.clientY < (rect.top + rect.bottom) / 2;
    const { from, to } = drag.span;
    if (target.from <= to && target.to >= from) return;
    const text = drag.doc.sliceString(from, to);
    const at = before ? target.from : target.to;
    // Rotate the range between source and destination, retaining the exact
    // line-break separator at the source. No whole-document copy is needed.
    if (at < from) {
      const between = drag.doc.sliceString(at, from);
      const separator = between.match(/\n+$/)?.[0] || '\n';
      const rest = between.endsWith(separator) ? between.slice(0, -separator.length) : between;
      this.view.dispatch({ changes: { from: at, to, insert: text + separator + rest }, userEvent: 'move.drop' });
    } else if (at > to) {
      const between = drag.doc.sliceString(to, at);
      const separator = between.match(/^\n+/)?.[0] || '\n';
      const rest = between.startsWith(separator) ? between.slice(separator.length) : between;
      this.view.dispatch({ changes: { from, to: at, insert: rest + separator + text }, userEvent: 'move.drop' });
    }
    this.handle.hidden = true; this.view.focus();
  };
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.focusChanged || update.geometryChanged || update.viewportChanged) this.scheduleSelection();
    if (!update.docChanged && !update.selectionSet && !update.focusChanged) return;
    if (update.docChanged) this.dismissed = null;
    const range = update.state.selection.main;
    const previous = update.startState.selection.main;
    if (update.docChanged || previous.from !== range.from || previous.to !== range.to) {
      this.dismissedSelection = null;
      this.selectionSnapshot = null;
      if (range.empty || update.docChanged) this.hideSelection();
    }
    if (!range.empty) this.handle.hidden = true;
    if (!this.view.hasFocus || !range.empty || codeContext(this.view, range.head)) { this.close(); return; }
    const line = update.state.doc.lineAt(range.head);
    const prefix = line.text.slice(0, range.head - line.from);
    const match = prefix.match(/^\s*\/([\w -]{0,48})$/);
    if (!match || this.dismissed === range.head) { this.close(); return; }
    this.trigger = { from: line.from + prefix.indexOf('/'), to: range.head };
    const q = match[1].toLowerCase().trim();
    this.matches = commands.filter(c => (c.name + ' ' + c.keywords).toLowerCase().includes(q));
    this.selected = 0; this.render();
    // Layout reads must happen after CodeMirror finishes the update cycle.
    cancelAnimationFrame(this.menuFrame);
    this.menuFrame = requestAnimationFrame(() => { this.menuFrame = 0; this.position(); });
  }
  position() {
    if (!this.trigger) return;
    const rect = this.view.coordsAtPos(this.trigger.to);
    if (!rect) { this.close(); return; }
    const width = Math.min(300, window.innerWidth - 16);
    const height = Math.min(this.menu.offsetHeight, 360);
    this.menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
    this.menu.style.top = Math.max(8, rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 6 : rect.top - height - 6) + 'px';
  }
  render() {
    this.menu.replaceChildren();
    this.menu.hidden = false; this.handle.hidden = true;
    let group = '';
    this.matches.forEach((cmd, i) => {
      if (cmd.group !== group) {
        group = cmd.group;
        const label = document.createElement('div'); label.className = 'flow-slash-group'; label.textContent = group; this.menu.append(label);
      }
      const row = document.createElement('button');
      row.type = 'button'; row.tabIndex = -1; row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === this.selected));
      row.append(glyph(cmd.icon));
      const name = document.createElement('span'); name.textContent = cmd.name; row.append(name);
      if (cmd.icon.startsWith('h') && /^h[1-4]$/.test(cmd.icon)) {
        const hint = document.createElement('kbd'); hint.textContent = cmd.insert.trim(); row.append(hint);
      }
      row.addEventListener('mousedown', e => e.preventDefault());
      row.addEventListener('click', () => this.choose(i));
      row.addEventListener('pointerenter', () => { this.selected = i; this.mark(false); });
      this.menu.append(row);
    });
    if (!this.matches.length) {
      const empty = document.createElement('div'); empty.className = 'flow-slash-group'; empty.textContent = 'No matching blocks'; this.menu.append(empty);
    }
    const footer = document.createElement('div'); footer.className = 'flow-slash-footer'; footer.textContent = '↑ ↓ Navigate · Enter Select · Esc Close'; this.menu.append(footer);
  }
  mark(scroll: boolean) {
    this.menu.querySelectorAll('button').forEach((row, i) => {
      row.setAttribute('aria-selected', String(i === this.selected));
      if (scroll && i === this.selected) row.scrollIntoView({ block: 'nearest' });
    });
  }
  step(n: number) {
    if (!this.trigger || !this.matches.length) return false;
    this.selected = (this.selected + n + this.matches.length) % this.matches.length;
    this.mark(true); return true;
  }
  choose(i = this.selected) {
    const cmd = this.matches[i], span = this.trigger;
    if (!cmd || !span) return false;
    this.close();
    this.view.dispatch({ changes: { ...span, insert: cmd.insert },
      selection: { anchor: span.from + (cmd.caret ?? cmd.insert.length) }, userEvent: 'input' });
    this.view.focus(); return true;
  }
  escape() {
    if (!this.toolbar.hidden) {
      const range = this.view.state.selection.main;
      this.dismissedSelection = { from: range.from, to: range.to };
      this.hideSelection(); return true;
    }
    if (!this.trigger) return false;
    this.dismissed = this.view.state.selection.main.head; this.close(); return true;
  }
  close() { this.trigger = null; this.menu.hidden = true; cancelAnimationFrame(this.menuFrame); }
  destroy() {
    cancelAnimationFrame(this.frame); cancelAnimationFrame(this.menuFrame); cancelAnimationFrame(this.selectionFrame);
    this.menu.remove(); this.handle.remove(); this.toolbar.remove();
    this.view.dom.removeEventListener('pointerup', this.scheduleSelection);
    this.view.dom.removeEventListener('touchend', this.scheduleSelection);
    window.visualViewport?.removeEventListener('resize', this.scheduleSelection);
    window.visualViewport?.removeEventListener('scroll', this.scheduleSelection);
    this.view.dom.removeEventListener('pointermove', this.onMove);
    this.view.dom.removeEventListener('dragover', this.onDragOver, true);
    this.view.dom.removeEventListener('drop', this.onDrop, true);
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    document.removeEventListener('pointerdown', this.onOutside);
    window.removeEventListener('resize', this.onScroll);
  }
}
const plugin = ViewPlugin.fromClass(BlockUI);
export const blockCommands = [plugin, Prec.highest(keymap.of([
  { key: 'ArrowDown', run: view => view.plugin(plugin)?.step(1) ?? false },
  { key: 'ArrowUp', run: view => view.plugin(plugin)?.step(-1) ?? false },
  { key: 'Enter', run: view => view.plugin(plugin)?.choose() ?? false },
  { key: 'Escape', run: view => view.plugin(plugin)?.escape() ?? false },
  { key: 'Alt-F10', run: view => view.plugin(plugin)?.focusSelection() ?? false },
]))];
