import { Decoration, EditorView, MatchDecorator, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { hexPattern, normalizeHex, hexToHsv, hsvToHex } from './hexColor';
import './editorColorPicker.css';

const matcher = new MatchDecorator({
  regexp: hexPattern,
  decoration: match => Decoration.mark({
    class: 'flow-hex-token',
    attributes: { 'data-flow-hex': match[0], style: '--hex-swatch:' + match[0] },
  }),
});

const clamp = (v: number) => Math.min(1, Math.max(0, v));
function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) {
  const el = document.createElement(tag);
  el.className = cls;
  parent?.append(el);
  return el;
}

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
    const panel = element('div', 'flow-color-picker', document.body);
    this.panel = panel;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Hex color picker');
    panel.addEventListener('pointerenter', this.cancelClose);
    panel.addEventListener('pointerleave', this.scheduleClose);
    const header = element('div', 'flow-color-heading', panel);
    const title = element('span', '', header); title.textContent = 'Color';
    const done = element('button', 'flow-color-done', header);
    done.type = 'button'; done.textContent = 'Done'; done.onclick = () => { this.close(); this.view.focus(); };
    const field = element('div', 'flow-color-sv', panel);
    const dot = element('span', 'flow-color-dot', field);
    const hue = element('div', 'flow-color-hue', panel);
    const hueDot = element('span', 'flow-color-thumb', hue);
    const alpha = element('div', 'flow-color-alpha', panel);
    const alphaPaint = element('span', 'flow-color-alpha-paint', alpha);
    const alphaDot = element('span', 'flow-color-thumb', alpha);
    const row = element('div', 'flow-color-row', panel);
    const swatch = element('span', 'flow-color-current', row);
    const input = element('input', 'flow-color-input', row);
    input.type = 'text'; input.spellcheck = false; input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Hex color value');
    let state = hexToHsv(hex);
    let explicitAlpha = hex.length === 9;
    const render = (value: string, updateInput = true) => {
      field.style.setProperty('--picker-hue', 'hsl(' + state.h + ' 100% 50%)');
      dot.style.left = state.s * 100 + '%'; dot.style.top = (1 - state.v) * 100 + '%';
      hueDot.style.left = state.h / 360 * 100 + '%';
      alphaDot.style.left = state.a * 100 + '%';
      alphaPaint.style.background = 'linear-gradient(90deg, transparent, ' + value.slice(0, 7) + ')';
      swatch.style.background = value;
      hue.setAttribute('aria-valuenow', String(Math.round(state.h)));
      field.setAttribute('aria-valuenow', String(Math.round(state.s * 100)));
      field.setAttribute('aria-valuetext', 'Saturation ' + Math.round(state.s * 100) + '%, brightness ' + Math.round(state.v * 100) + '%');
      alpha.setAttribute('aria-valuenow', String(Math.round(state.a * 100)));
      if (updateInput) input.value = value.toUpperCase();
    };
    const commit = (value: string) => {
      const range = this.range;
      if (!range || this.view.state.doc.sliceString(range.from, range.to) !== range.text) { this.close(); return; }
      if (range.text === value) return;
      this.writing = true;
      try {
        this.view.dispatch({ changes: { from: range.from, to: range.to, insert: value }, userEvent: 'input' });
        this.range = { from: range.from, to: range.from + value.length, text: value };
      } finally { this.writing = false; }
    };
    const apply = () => {
      const value = hsvToHex(state.h, state.s, state.v, explicitAlpha ? state.a : undefined);
      render(value); commit(value);
    };
    const control = (el: HTMLElement, name: string, max: number, pointer: (x: number, y: number) => void, keyboard: (dx: number, dy: number) => void) => {
      el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', name);
      el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', String(max));
      const move = (event: PointerEvent) => {
        const rect = el.getBoundingClientRect();
        pointer(clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / rect.height));
        apply();
      };
      el.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); el.focus({ preventScroll: true }); el.setPointerCapture(event.pointerId); move(event);
      });
      el.addEventListener('pointermove', event => { if (el.hasPointerCapture(event.pointerId)) move(event); });
      el.addEventListener('keydown', event => {
        const dx = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const dy = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
        if (dx || dy) { event.preventDefault(); keyboard(dx, dy); apply(); }
      });
    };
    control(field, 'Saturation and brightness', 100, (x, y) => { state.s = x; state.v = 1 - y; },
      (dx, dy) => { state.s = clamp(state.s + dx * .01); state.v = clamp(state.v + dy * .01); });
    control(hue, 'Hue', 360, x => { state.h = Math.min(359.999, x * 360); },
      (dx, dy) => { state.h = (state.h + dx + dy + 360) % 360; });
    control(alpha, 'Opacity', 100, x => { state.a = x; explicitAlpha = true; },
      (dx, dy) => { state.a = clamp(state.a + (dx + dy) * .01); explicitAlpha = true; });
    input.addEventListener('input', () => {
      const value = normalizeHex(input.value);
      input.setAttribute('aria-invalid', String(!value));
      // Do not rewrite an intermediate 3/4-digit draft while entering a longer value.
      if (!value || ![6, 8].includes(input.value.replace(/^#/, '').trim().length)) return;
      state = hexToHsv(value); explicitAlpha = value.length === 9; render(value, false); commit(value);
    });
    const finishInput = () => {
      const value = normalizeHex(input.value);
      if (!value) { render(this.range?.text ? normalizeHex(this.range.text) || hex : hex); input.setAttribute('aria-invalid', 'false'); return; }
      state = hexToHsv(value); explicitAlpha = value.length === 9; render(value); commit(value);
    };
    input.addEventListener('blur', finishInput);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); finishInput(); } });
    render(hex);
    const bounds = token.getBoundingClientRect();
    const width = panel.offsetWidth, height = panel.offsetHeight;
    panel.style.left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)) + 'px';
    panel.style.top = Math.max(8, bounds.bottom + height + 8 <= window.innerHeight ? bounds.bottom + 5 : bounds.top - height - 5) + 'px';
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
