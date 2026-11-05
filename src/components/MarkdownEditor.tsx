import { memo, useEffect, useRef, type RefObject } from 'react';
import { Compartment, EditorState, type Text } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { minimalSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { detectRawCode, type CodeLanguage } from '../lib/code';
import { formatPlainTextAsMarkdown, shouldAutoFormatPaste } from '../lib/autoMarkdown';


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
  documentId, initialText, viewRef, onChange, onPosition, focusOnMount = false,
}: {
  documentId: string;
  initialText: string;
  viewRef: RefObject<EditorView | null>;
  onChange: (value: string, documentId: string) => void;
  onPosition?: (line: number, kind: 'scroll' | 'cursor', total: number) => void;
  focusOnMount?: boolean;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const position = useRef(onPosition);
  position.current = onPosition;
  useEffect(() => {
    if (!mount.current) return;
    const languageSlot = new Compartment();
    const gutterSlot = new Compartment();
    let activeLanguage: CodeLanguage | null = null;
    let request = 0;
    let languageTimer: number | undefined;
    let pendingText: Text | null = null;
    let frame: number | null = null;
    let idleTimer: number | null = null;
    const drain = () => {
      if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
      if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
      if (pendingText) {
        const doc = pendingText;
        pendingText = null;
        change.current(doc.toString(), documentId);
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') drain(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', drain);
    let view: EditorView;
    let scrollFrame: number | null = null;
    const onScroll = () => {
      if (scrollFrame !== null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        if (viewRef.current !== view) return;
        const scroller = view.scrollDOM;
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
        // CodeMirror's viewport includes a large overscan region on long pages.
        // Map the real viewport top through its measured document-height model
        // instead. Fractional lines retain movement within wrapped source lines.
        const viewportTop = (scroller.getBoundingClientRect().top - view.documentTop) /
          (view.scaleY || 1);
        const height = Math.max(0, viewportTop);
        const block = view.lineBlockAtHeight(height);
        const fraction = Math.max(0, Math.min(0.999, (height - block.top) / Math.max(1, block.height)));
        const line = atBottom ? view.state.doc.lines :
          view.state.doc.lineAt(block.from).number + fraction;
        position.current?.(line, 'scroll', view.state.doc.lines);
      });
    };
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
          // Multi-line plain text becomes structured Markdown as it is pasted.
          // Code, existing Markdown and single-line edits stay untouched.
          EditorView.domEventHandlers({
            paste(event, target) {
              const text = event.clipboardData?.getData('text/plain');
              if (!text || !shouldAutoFormatPaste(text)) return false;
              const empty = target.state.doc.length === 0;
              const atStart = empty && target.state.selection.main.from === 0;
              const formatted = formatPlainTextAsMarkdown(text, { atDocumentStart: atStart });
              if (formatted === text) return false;
              event.preventDefault();
              target.dispatch(target.state.replaceSelection(formatted));
              return true;
            },
          }),
          keymap.of([indentWithTab]),
          placeholder('Start writing…'),
          EditorView.updateListener.of(update => {
            if (update.selectionSet || update.docChanged) {
              const line = update.state.doc.lineAt(update.state.selection.main.head).number;
              position.current?.(line, 'cursor', update.state.doc.lines);
            }
            if (!update.docChanged) return;
            // Keep typing synchronous. Large immutable snapshots are materialized at most
            // once per animation frame, even across a burst of CodeMirror transactions.
            if (update.state.doc.length < 25000) {
              change.current(update.state.doc.toString(), documentId);
            } else {
              pendingText = update.state.doc;
              // CodeMirror owns edits synchronously. Serialize large source text
              // after the edit burst rather than blocking every animation frame.
              if (update.state.doc.length > 220_000) {
                if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
                if (idleTimer !== null) clearTimeout(idleTimer);
                idleTimer = window.setTimeout(() => { idleTimer = null; drain(); }, 180);
              } else if (frame === null) {
                frame = requestAnimationFrame(() => { frame = null; drain(); });
              }
            }
            // Language switching is infrequent and never runs in a typing transaction.
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
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    setLanguage(initialText.slice(0, 12000));
    if (focusOnMount) view.focus();
    return () => {
      ++request;
      view.scrollDOM.removeEventListener('scroll', onScroll);
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', drain);
      drain();
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
