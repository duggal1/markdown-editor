import { memo, useEffect, useRef, type RefObject } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { minimalSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { detectRawCode, type CodeLanguage } from '../lib/code';


const flowHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: tags.controlKeyword, color: 'var(--syntax-keyword)' },
  { tag: tags.definitionKeyword, color: 'var(--syntax-keyword)' },
  { tag: tags.typeName, color: 'var(--syntax-literal)' },
  { tag: tags.className, color: 'var(--syntax-literal)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.bool, color: 'var(--syntax-number)' },
  { tag: tags.comment, color: 'var(--syntax-comment)' },
  { tag: tags.function(tags.variableName), color: 'var(--syntax-function)' },
  { tag: tags.propertyName, color: 'var(--syntax-function)' },
  { tag: tags.heading, color: 'var(--strong)', fontWeight: '400' },
  { tag: tags.link, color: 'var(--blue)', textDecoration: 'underline dotted' },
  { tag: tags.strong, fontWeight: '400' },
  { tag: tags.emphasis, fontStyle: 'italic' },
]);

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
    const languageSlot = new Compartment();
    const gutterSlot = new Compartment();
    let activeLanguage: CodeLanguage | null = null;
    let request = 0;
    let languageTimer: number | undefined;
    let view: EditorView;
    const setLanguage = (source: string) => {
      const language = detectRawCode(source);
      view.dom.classList.toggle('raw-code', Boolean(language));
      if (language === activeLanguage) return;
      activeLanguage = language;
      const current = ++request;
      if (!language) {
        view.dispatch({
          effects: [
            languageSlot.reconfigure(markdown({ codeLanguages: languages })),
            gutterSlot.reconfigure([]),
          ],
        });
        return;
      }
      const match = languages.find(item =>
        item.name.toLowerCase() === language ||
        item.alias.some(alias => alias.toLowerCase() === language),
      );
      if (!match) return;
      void match.load().then(support => {
        if (current !== request || viewRef.current !== view) return;
        view.dispatch({
          effects: [
            languageSlot.reconfigure(support),
            gutterSlot.reconfigure(lineNumbers()),
          ],
        });
      }).catch(() => { /* Markdown stays editable when an optional language fails. */ });
    };
    view = new EditorView({
      state: EditorState.create({
        doc: initialText,
        extensions: [
          minimalSetup,
          gutterSlot.of([]),
          languageSlot.of(markdown({ codeLanguages: languages })),
          syntaxHighlighting(flowHighlight),
          EditorView.lineWrapping,
          keymap.of([indentWithTab]),
          placeholder('Start writing…'),
          EditorView.updateListener.of(update => {
            if (!update.docChanged) return;
            change.current(update.state.doc.toString());
            // Editing stays synchronous and virtualized; expensive language loading does not.
            if (languageTimer !== undefined) clearTimeout(languageTimer);
            languageTimer = window.setTimeout(() => {
              if (viewRef.current === view) setLanguage(view.state.doc.sliceString(0, 12000));
            }, 320);
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
    setLanguage(initialText.slice(0, 12000));
    if (focusOnMount) view.focus();
    return () => {
      ++request;
      if (languageTimer !== undefined) clearTimeout(languageTimer);
      if (viewRef.current === view) viewRef.current = null;
      view.destroy();
    };
    // The editor is reconstructed only when switching documents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);
  return <div className="codemirror-host" ref={mount} aria-label="Markdown editor" />;
}
export default memo(MarkdownEditor);
