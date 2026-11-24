import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { Prec, type Text } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

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
const paths: Record<string, string> = {
  text: 'M4 5h16M12 5v14M8 19h8', bullet: 'M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1',
  number: 'M10 5h11M10 12h11M10 19h11M3 3h2v5M3 10h3l-3 4h3M3 17h3v4H3',
  todo: 'M3 4h6v6H3zM3 14h6v6H3zM4 6l2 2 4-5M13 7h8M13 17h8',
  quote: 'M9 5H4v7h5v-7M20 5h-5v7h5v-7M9 12c0 4-2 6-5 7M20 12c0 4-2 6-5 7',
  divider: 'M3 12h18', table: 'M3 4h18v16H3zM3 10h18M3 15h18M12 4v16',
  bold: 'M6 4h7a4 4 0 0 1 0 8H6V4m0 8h8a4 4 0 0 1 0 8H6z',
  italic: 'M10 4h9M5 20h9M15 4L9 20', link: 'M10 14l4-4M9 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M15 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  code: 'M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16', html: 'M4 4h16v16H4zM9 9l-3 3 3 3M15 9l3 3-3 3',
  image: 'M3 4h18v16H3zM3 17l5-5 4 4 4-6 5 7M8 8h1', plus: 'M12 5v14M5 12h14',
  grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
};
function glyph(name: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  if (/^h[1-4]$/.test(name)) {
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', '2'); text.setAttribute('y', '18'); text.setAttribute('font-size', '17');
    text.setAttribute('fill', 'currentColor'); text.textContent = 'H' + name[1]; svg.append(text);
  } else {
    const path = document.createElementNS(ns, 'path'); path.setAttribute('d', paths[name] || paths.text);
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', name === 'grip' ? '3.5' : '1.6');
    path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.append(path);
  }
  return svg;
}
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
  add = document.createElement('button');
  grip = document.createElement('button');
  matches: Command[] = [];
  selected = 0;
  trigger: Span | null = null;
  dismissed: number | null = null;
  hover: Span | null = null;
  drag: { span: Span; doc: Text } | null = null;
  frame = 0;
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
    document.body.append(this.menu, this.handle);
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
    view.dom.addEventListener('dragover', this.onDragOver);
    view.dom.addEventListener('drop', this.onDrop);
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
    document.addEventListener('pointerdown', this.onOutside);
    window.addEventListener('resize', this.onScroll);
  }
  onOutside = (e: PointerEvent) => {
    if (!(e.target instanceof Node) || this.menu.contains(e.target) || this.handle.contains(e.target)) return;
    if (!this.view.dom.contains(e.target)) { this.close(); this.handle.hidden = true; }
  };
  onScroll = () => { this.handle.hidden = true; if (this.trigger) this.position(); };
  onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || this.drag || !this.menu.hidden) return;
    if (this.frame) return;
    const x = e.clientX, y = e.clientY;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const content = this.view.contentDOM.getBoundingClientRect();
      if (x > content.right || x < content.left - 60 || y < content.top || y > content.bottom) { this.handle.hidden = true; return; }
      const pos = this.view.posAtCoords({ x: Math.max(content.left + 2, x), y }, false);
      if (pos === null || codeContext(this.view, pos)) { this.handle.hidden = true; return; }
      const span = blockAt(this.view, pos);
      const rect = this.view.coordsAtPos(span.from);
      if (!rect) { this.handle.hidden = true; return; }
      this.hover = span;
      this.handle.style.left = Math.max(4, content.left - 50) + 'px';
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
    const removeTo = to < drag.doc.length ? to + 1 : to;
    const removeFrom = removeTo === to && from > 0 ? from - 1 : from;
    const at = before ? target.from : target.to;
    const insert = before ? text + '\n' : '\n' + text;
    this.view.dispatch({ changes: [{ from: removeFrom, to: removeTo }, { from: at, insert }].sort((a,b) => a.from-b.from),
      userEvent: 'move.drop' });
    this.handle.hidden = true; this.view.focus();
  };
  update(update: ViewUpdate) {
    if (!update.docChanged && !update.selectionSet && !update.focusChanged) return;
    if (update.docChanged) this.dismissed = null;
    const range = update.state.selection.main;
    if (!this.view.hasFocus || !range.empty || codeContext(this.view, range.head)) { this.close(); return; }
    const line = update.state.doc.lineAt(range.head);
    const prefix = line.text.slice(0, range.head - line.from);
    const match = prefix.match(/^\s*\/([\w -]{0,48})$/);
    if (!match || this.dismissed === range.head) { this.close(); return; }
    this.trigger = { from: line.from + prefix.indexOf('/'), to: range.head };
    const q = match[1].toLowerCase().trim();
    this.matches = commands.filter(c => (c.name + ' ' + c.keywords).toLowerCase().includes(q));
    this.selected = 0; this.render(); this.position();
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
    if (!this.trigger) return false;
    this.dismissed = this.view.state.selection.main.head; this.close(); return true;
  }
  close() { this.trigger = null; this.menu.hidden = true; }
  destroy() {
    cancelAnimationFrame(this.frame); this.menu.remove(); this.handle.remove();
    this.view.dom.removeEventListener('pointermove', this.onMove);
    this.view.dom.removeEventListener('dragover', this.onDragOver);
    this.view.dom.removeEventListener('drop', this.onDrop);
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
]))];
