import { Decoration, EditorView, MatchDecorator, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { hexPattern, normalizeHex } from './hexColor';
import { openColorPopover } from './colorPopover';

const matcher = new MatchDecorator({
  regexp: hexPattern,
  decoration: match => Decoration.mark({
    class: 'flow-hex-token',
    attributes: { 'data-flow-hex': match[0], style: '--hex-swatch:' + match[0] },
  }),
});


class ColorPicker {
  decorations;
  private panel: HTMLDivElement | null = null;
  private timer: number | undefined;
  private range: { from: number; to: number; text: string } | null = null;
  private writing = false;
  private anchor: HTMLElement | null = null;
  constructor(private view: EditorView) {
    this.decorations = matcher.createDeco(view);
    view.dom.addEventListener('pointerover', this.over);
    view.dom.addEventListener('pointerout', this.out);
    view.dom.addEventListener('click', this.click);
    document.addEventListener('pointerdown', this.outside, true);
    document.addEventListener('keydown', this.key, true);
    window.addEventListener('resize', this.close);
    view.scrollDOM.addEventListener('scroll', this.close);
  }
  update(update: ViewUpdate) {
    this.decorations = matcher.updateDeco(update, this.decorations);
    if (update.docChanged && !this.writing) this.close();
  }
  private token(event: Event) {
    return event.target instanceof Element ? event.target.closest<HTMLElement>('[data-flow-hex]') : null;
  }
  private over = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || this.panel?.contains(document.activeElement)) return;
    const token = this.token(event);
    if (token) this.open(token);
  };
  private out = (event: PointerEvent) => {
    if (this.token(event) && !(event.relatedTarget instanceof Node && this.panel?.contains(event.relatedTarget))) this.scheduleClose();
  };
  private click = (event: MouseEvent) => {
    const token = this.token(event);
    if (token) this.open(token);
  };
  private outside = (event: PointerEvent) => {
    if (event.target instanceof Node && !this.panel?.contains(event.target) && !this.token(event)) this.close();
  };
  private key = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.panel) { event.preventDefault(); event.stopPropagation(); this.close(); this.view.focus(); }
  };
  private cancelClose = () => { window.clearTimeout(this.timer); this.timer = undefined; };
  private scheduleClose = () => {
    this.cancelClose();
    this.timer = window.setTimeout(() => {
      if (!this.panel?.contains(document.activeElement)) this.close();
    }, 260);
  };
  private close = () => {
    this.cancelClose();
    this.panel?.remove();
    this.panel = null;
    this.anchor = null;
    this.range = null;
  };
  private open(token: HTMLElement) {
    this.cancelClose();
    if (this.anchor === token && this.panel) return;
    const literal = token.dataset.flowHex;
    if (!literal) return;
    let pos: number;
    try { pos = this.view.posAtDOM(token, 0); } catch { return; }
    const line = this.view.state.doc.lineAt(pos);
    const matches = Array.from(line.text.matchAll(new RegExp(hexPattern.source, hexPattern.flags)));
    const found = matches.find(m => m[0] === literal && pos >= line.from + m.index! && pos <= line.from + m.index! + m[0].length);
    const hex = normalizeHex(literal);
    if (!found || !hex) return;
    this.close();
    const from = line.from + found.index!;
    this.range = { from, to: from + literal.length, text: literal };
    this.anchor = token;
    this.panel = openColorPopover(token, hex, {
      onEnter: this.cancelClose, onLeave: this.scheduleClose,
      onDone: () => { this.close(); this.view.focus(); },
      onChange: value => {
        const range = this.range;
        if (!range || this.view.state.doc.sliceString(range.from, range.to) !== range.text) { this.close(); return false; }
        if (range.text === value) return true;
        this.writing = true;
        try {
          this.view.dispatch({ changes: { from: range.from, to: range.to, insert: value }, userEvent: 'input' });
          this.range = { from: range.from, to: range.from + value.length, text: value };
          return true;
        } finally { this.writing = false; }
      },
    });
  }
  destroy() {
    this.close();
    this.view.dom.removeEventListener('pointerover', this.over);
    this.view.dom.removeEventListener('pointerout', this.out);
    this.view.dom.removeEventListener('click', this.click);
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('keydown', this.key, true);
    window.removeEventListener('resize', this.close);
    this.view.scrollDOM.removeEventListener('scroll', this.close);
  }
}

export const editorColorPicker = ViewPlugin.fromClass(ColorPicker, { decorations: plugin => plugin.decorations });
