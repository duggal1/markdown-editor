import type { EditorView } from '@codemirror/view';

export function editorPosition(view: EditorView): number {
  const scroll = view.scrollDOM;
  if (scroll.scrollTop <= 1) return 1;
  if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 3) return view.state.doc.lines;
  const height = Math.max(0, (scroll.getBoundingClientRect().top - view.documentTop) / (view.scaleY || 1));
  const block = view.lineBlockAtHeight(height);
  return view.state.doc.lineAt(block.from).number +
    Math.max(0, Math.min(.999, (height - block.top) / Math.max(1, block.height)));
}

export function previewPosition(scroll: HTMLDivElement, total: number): number {
  const code = scroll.querySelector<HTMLElement>('.preview-is-code .virtual-code-scroll');
  if (code) {
    if (code.scrollTop <= 1) return 1;
    if (code.scrollTop + code.clientHeight >= code.scrollHeight - 3) return total;
    return Math.min(total, 1 + code.scrollTop / 22);
  }
  if (scroll.scrollTop <= 1) return 1;
  if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 3) return total;
  const top = scroll.getBoundingClientRect().top + 12;
  // Only inspect anchors in the mounted chunk intersecting the viewport.
  // This bounds DOM walks during rapid scrolling of long Markdown.
  const sections = scroll.querySelectorAll<HTMLElement>('.virtual-markdown-section');
  let section: HTMLElement | undefined;
  if (sections.length) {
    let lo = 0, hi = sections.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (sections[mid].getBoundingClientRect().top <= top) lo = mid;
      else hi = mid - 1;
    }
    section = sections[lo];
  }
  const nodes = (section || scroll).querySelectorAll<HTMLElement>('[data-source-line]');
  if (!nodes.length) return 1 + (total - 1) * scroll.scrollTop / Math.max(1, scroll.scrollHeight - scroll.clientHeight);
  let lo = 0, hi = nodes.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (nodes[mid].getBoundingClientRect().top <= top) lo = mid;
    else hi = mid - 1;
  }
  const current = nodes[lo], next = nodes[lo + 1];
  const a = Number(current.dataset.sourceLine || 1);
  const b = next ? Number(next.dataset.sourceLine || a + 1) : Math.min(total, a + 1);
  const rect = current.getBoundingClientRect();
  const end = next?.getBoundingClientRect().top ?? rect.bottom;
  return Math.max(1, Math.min(total, a + Math.max(0, Math.min(1,
    (top - rect.top) / Math.max(1, end - rect.top))) * Math.max(0, b - a)));
}

export function restoreEditorPosition(view: EditorView, line: number) {
  view.requestMeasure({
    read: v => {
      const scroll = v.scrollDOM;
      if (!scroll.clientHeight || !scroll.clientWidth) return null;
      if (line <= 1) return 0;
      if (line >= v.state.doc.lines) return scroll.scrollHeight;
      const source = v.state.doc.line(Math.max(1, Math.min(v.state.doc.lines, Math.floor(line))));
      const block = v.lineBlockAt(source.from);
      return scroll.scrollTop + v.documentTop - scroll.getBoundingClientRect().top +
        (block.top + (line % 1) * block.height) * (v.scaleY || 1);
    },
    write: (top, v) => {
      if (top !== null && Math.abs(v.scrollDOM.scrollTop - top) > 2) v.scrollDOM.scrollTop = top;
    },
  });
}
