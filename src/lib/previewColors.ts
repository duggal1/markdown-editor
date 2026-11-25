import { hexOccurrences, mapHexOccurrences, normalizeHex } from './hexColor';
import { openColorPopover } from './colorPopover';
export type PreviewColorEdit = (from: number, before: string, after: string, expected: string) => boolean;
type AstNode = {
  type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: AstNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
// Only generated spans after sanitization; values are validated hex and numeric offsets.
export function rehypePreviewColors(base: number) {
  return (tree: AstNode, file: { value: unknown }) => {
    const source = String(file.value);
    function visit(parent: AstNode) {
      if (!parent.children || ['pre', 'svg', 'style', 'script', 'a'].includes(parent.tagName || '')) return;
      const single = parent.children.length === 1;
      parent.children = parent.children.flatMap(node => {
        if (node.type !== 'text' || !node.value) { visit(node); return [node]; }
        const matches = hexOccurrences(node.value);
        if (!matches.length) return [node];
        const pos = node.position || (single ? parent.position : undefined);
        const start = pos?.start.offset, end = pos?.end.offset;
        const mapped = start !== undefined && end !== undefined
          ? mapHexOccurrences(node.value, source.slice(start, end), base + start) : [];
        const result: AstNode[] = [];
        let cursor = 0;
        for (let i = 0; i < matches.length; i++) {
          const item = matches[i];
          if (item.from > cursor) result.push({ type: 'text', value: node.value.slice(cursor, item.from) });
          result.push({ type: 'element', tagName: 'span', properties: {
            className: ['flow-preview-hex'], dataFlowHex: item.text,
            dataFlowFrom: String(mapped[i]?.from ?? -1),
            style: '--hex-swatch:' + item.text,
          }, children: [{ type: 'text', value: item.text }] });
          cursor = item.from + item.text.length;
        }
        if (cursor < node.value.length) result.push({ type: 'text', value: node.value.slice(cursor) });
        return result;
      });
    }
    visit(tree);
  };
}

export function attachPreviewColorPicker(root: HTMLElement, getSource: () => string, edit: PreviewColorEdit) {
  let panel: HTMLDivElement | null = null, anchor: HTMLElement | null = null;
  let timer: number | undefined;
  const clear = () => { window.clearTimeout(timer); timer = undefined; };
  const close = () => { clear(); const old = panel; panel = null; anchor = null; old?.remove(); };
  const leave = () => { clear(); timer = window.setTimeout(() => {
    if (!panel?.contains(document.activeElement)) close();
  }, 240); };
  const token = (event: Event) => event.target instanceof Element
    ? event.target.closest<HTMLElement>('.flow-preview-hex[data-flow-from]') : null;
  const open = (el: HTMLElement) => {
    clear();
    if (anchor === el && panel) return;
    const from = Number(el.dataset.flowFrom);
    let before = el.dataset.flowHex || '';
    const hex = normalizeHex(before);
    let expected = getSource();
    if (!hex || !Number.isSafeInteger(from) || from < 0 || expected.slice(from, from + before.length) !== before) return;
    close(); anchor = el;
    panel = openColorPopover(el, hex, {
      onEnter: clear, onLeave: leave, onDone: close,
      onChange: after => {
        if (!panel || !edit(from, before, after, expected)) { close(); return false; }
        expected = expected.slice(0, from) + after + expected.slice(from + before.length);
        before = after; return true;
      },
    });
  };
  const over = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || panel?.contains(document.activeElement)) return;
    const el = token(event); if (el) open(el);
  };
  const out = (event: PointerEvent) => {
    const el = token(event);
    if (el && !(event.relatedTarget instanceof Node && el.contains(event.relatedTarget))) leave();
  };
  const click = (event: MouseEvent) => { const el = token(event); if (el) { event.preventDefault(); open(el); } };
  const outside = (event: PointerEvent) => {
    if (event.target instanceof Node && !panel?.contains(event.target) && !token(event)) close();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && panel) { event.preventDefault(); close(); }
  };
  const scroll = () => { if (!panel?.contains(document.activeElement)) close(); };
  root.addEventListener('pointerover', over); root.addEventListener('pointerout', out);
  root.addEventListener('click', click); root.addEventListener('scroll', scroll, true);
  document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true);
  window.addEventListener('resize', close);
  return () => {
    close();
    root.removeEventListener('pointerover', over); root.removeEventListener('pointerout', out);
    root.removeEventListener('click', click); root.removeEventListener('scroll', scroll, true);
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true);
    window.removeEventListener('resize', close);
  };
}
