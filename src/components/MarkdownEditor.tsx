import { memo, useEffect, useRef, type RefObject } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { indentWithTab } from '@codemirror/commands';

export type Format = 'bold' | 'italic' | 'heading' | 'bullet' | 'todo' | 'quote' | 'link' | 'code';

export function formatEditor(view: EditorView | null, format: Format): void {
  if (!view) return;
  const range = view.state.selection.main;
  const selected = view.state.doc.sliceString(range.from, range.to);
  const tick = String.fromCharCode(96);
  if (format === 'heading' || format === 'bullet' || format === 'todo' || format === 'quote') {
    const line = view.state.doc.lineAt(range.from);
    const prefix = format === 'heading' ? '# ' : format === 'bullet' ? '- '
      : format === 'todo' ? '- [ ] ' : '> ';
    const existing = line.text.match(/^(#{1,6} |- \[[ xX]\] |- |> )/);
    const from = line.from;
    const to = from + (existing ? existing[0].length : 0);
    view.dispatch({
      changes: { from, to, insert: existing?.[0] === prefix ? '' : prefix },
      selection: { anchor: line.from + (existing?.[0] === prefix ? 0 : prefix.length) },
      scrollIntoView: true,
    });
    view.focus();
    return;
  }
  const multiline = selected.includes('\n');
  let before = '';
  let after = '';
  let middle = selected;
  switch (format) {
    case 'bold': before = '**'; after = '**'; middle ||= 'bold text'; break;
    case 'italic': before = '*'; after = '*'; middle ||= 'italic text'; break;
    case 'link': before = '['; after = '](https://example.com)'; middle ||= 'link text'; break;
    case 'code':
      before = multiline || !selected ? tick.repeat(3) + '\n' : tick;
      after = multiline || !selected ? '\n' + tick.repeat(3) : tick;
      middle ||= 'code';
      break;
  }
  const replacement = before + middle + after;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: replacement },
    selection: { anchor: range.from + before.length, head: range.from + before.length + middle.length },
    scrollIntoView: true,
  });
  view.focus();
}

function MarkdownEditor({
  documentId, initialText, viewRef, onChange, focusOnMount = false,
}: {
  documentId: string;
  initialText: string;
  viewRef: RefObject<EditorView | null>;
  onChange: (value: string) => void;
  focusOnMount?: boolean;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    if (!mount.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: initialText,
        extensions: [
          basicSetup,
          markdown({ codeLanguages: languages }),
          EditorView.lineWrapping,
          keymap.of([indentWithTab]),
          placeholder('Start writing…'),
          EditorView.updateListener.of(update => {
            if (update.docChanged) change.current(update.state.doc.toString());
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '14px' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--mono)' },
            '.cm-content': { padding: '0 0 44px', minHeight: '100%' },
            '.cm-line': { padding: '0' },
            '.cm-focused': { outline: 'none' },
          }),
        ],
      }),
      parent: mount.current,
    });
    viewRef.current = view;
    if (focusOnMount) view.focus();
    return () => {
      if (viewRef.current === view) viewRef.current = null;
      view.destroy();
    };
    // The editor is only reconstructed when switching documents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);
  return <div className="codemirror-host" ref={mount} aria-label="Markdown editor" />;
}
export default memo(MarkdownEditor);
