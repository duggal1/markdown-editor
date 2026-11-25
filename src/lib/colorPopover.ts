import { normalizeHex, hexToHsv, hsvToHex } from './hexColor';
import './editorColorPicker.css';
const clamp = (v: number) => Math.min(1, Math.max(0, v));
function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) {
  const el = document.createElement(tag);
  el.className = cls;
  parent?.append(el);
  return el;
}

export function openColorPopover(anchor: HTMLElement, hex: string, options: {
  onChange: (value: string) => boolean; onEnter: () => void; onLeave: () => void; onDone: () => void;
}): HTMLDivElement {
    const panel = element('div', 'flow-color-picker', document.body);
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Hex color picker');
    panel.addEventListener('pointerenter', options.onEnter);
    panel.addEventListener('pointerleave', options.onLeave);
    const header = element('div', 'flow-color-heading', panel);
    const title = element('span', '', header); title.textContent = 'Color';
    const done = element('button', 'flow-color-done', header);
    done.type = 'button'; done.textContent = 'Done'; done.onclick = options.onDone;
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
    let last = hex;
    const commit = (value: string) => {
      if (value !== last && options.onChange(value)) last = value;
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
      if (!value) { render(last); input.setAttribute('aria-invalid', 'false'); return; }
      state = hexToHsv(value); explicitAlpha = value.length === 9; render(value); commit(value);
    };
    input.addEventListener('blur', finishInput);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); finishInput(); } });
    render(hex);
    const bounds = anchor.getBoundingClientRect();
    const width = panel.offsetWidth, height = panel.offsetHeight;
    panel.style.left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)) + 'px';
    panel.style.top = Math.max(8, bounds.bottom + height + 8 <= window.innerHeight ? bounds.bottom + 5 : bounds.top - height - 5) + 'px';
    return panel;
}
