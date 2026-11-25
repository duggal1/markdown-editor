import { hexOccurrences } from './hexColor';

type AstNode = {
  type: string; tagName?: string; value?: string;
  properties?: Record<string, unknown>; children?: AstNode[];
};

// Preview is deliberately read-only. Generate real, inline-painted swatch
// elements after sanitation, not pseudo-elements or source editing controls.
export function rehypePreviewColors() {
  return (tree: AstNode) => {
    function visit(parent: AstNode) {
      if (!parent.children || ['pre', 'svg', 'style', 'script'].includes(parent.tagName || '')) return;
      parent.children = parent.children.flatMap(node => {
        if (node.type !== 'text' || !node.value) { visit(node); return [node]; }
        const matches = hexOccurrences(node.value);
        if (!matches.length) return [node];
        const result: AstNode[] = [];
        let cursor = 0;
        for (const item of matches) {
          if (item.from > cursor) result.push({ type: 'text', value: node.value.slice(cursor, item.from) });
          result.push({ type: 'element', tagName: 'span', properties: {
            className: ['flow-preview-hex'],
          }, children: [
            { type: 'element', tagName: 'span', properties: {
              className: ['flow-preview-swatch'], ariaHidden: 'true',
              style: 'display:inline-block;width:.8em;height:.8em;margin-right:4px;vertical-align:-.04em;border-radius:3px;box-shadow:inset 0 0 0 1px #8888;background-color:' + item.text,
            }, children: [] },
            { type: 'text', value: item.text },
          ] });
          cursor = item.from + item.text.length;
        }
        if (cursor < node.value.length) result.push({ type: 'text', value: node.value.slice(cursor) });
        return result;
      });
    }
    visit(tree);
  };
}
