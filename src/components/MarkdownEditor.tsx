import { memo, useEffect, useRef, type RefObject } from 'react';
import { Compartment, EditorState, Prec, type Text } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { minimalSetup } from 'codemirror';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { indentWithTab, insertNewline } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { detectRawCode, type CodeLanguage } from '../lib/code';
import { bulkInsertionBoundary, finishBulkInsertion, formatPlainTextAsMarkdown, shouldAutoFormatPaste } from '../lib/autoMarkdown';
import { formatMarkdownAction, WORKER_THRESHOLD } from '../lib/autoMarkdownAction';
import { listEnterIntent } from '../lib/listEditing';
import { repairLanguage } from '../lib/codeRepair';
import { blockCommands } from '../lib/blockCommands';
import { selectionEdit, type SelectionFormat } from '../lib/selectionFormat';
import { editorColorPicker } from '../lib/editorColorPicker';


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
  if (!range.empty) {
    const kind: SelectionFormat = format === 'heading' ? 'h1' : format;
    const edit = selectionEdit(view.state.doc, range.from, range.to, kind);
    if (edit) view.dispatch({ ...edit, scrollIntoView: true, userEvent: 'input.format' });
    view.focus();
    return;
  }
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

/**
 * Override only Enter on Markdown list lines. CodeMirror's built-in Markdown
 * keymap otherwise auto-continues "- ", causing doubled markers when a user
 * types "- two", and can trap tables/code inside a list. Leave all other
 * commands, including Markdown Backspace, as they were.
 */
function enterExplicitMarkdownList(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;

  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const intent = listEnterIntent(line.text, pos - line.from);
  if (!intent) return false;

  // A literal "- item" inside a fenced or indented code block is code, not
  // a Markdown list. Keep its normal Enter/indent behavior.
  let node = syntaxTree(state).resolveInner(Math.max(line.from, pos - 1), -1);
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' ||
      node.name === 'HTMLBlock' || node.name === 'InlineCode') return false;
    const parent = node.parent;
    if (!parent) break;
    node = parent;
  }

  if (intent === 'exit-list') {
    // Keep one blank separator when leaving an empty list item. Without it,
    // a following GFM table or fenced code block may still parse as list text.
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '\n' },
      selection: { anchor: line.from + 1 },
      scrollIntoView: true,
      userEvent: 'input',
    });
    return true;
  }
  return insertNewline(view);
}

function MarkdownEditor({
  documentId, initialText, fileLanguage, viewRef, onChange, onPosition, focusOnMount = false,
}: {
  documentId: string;
  initialText: string;
  fileLanguage?: string | null;
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
      // A damaged HTML/Python paste still needs a code gutter and highlighting
      // before the user clicks Auto Fix. Other languages use existing detection.
      const language = fileLanguage === 'html' || fileLanguage === 'python' || fileLanguage === 'svg'
        ? fileLanguage : detectRawCode(source) || repairLanguage(source);
      view.dom.classList.toggle('raw-code', Boolean(language));
      if (language === activeLanguage) return;
      activeLanguage = language;
      const current = ++request;
      if (!language) {
        view.dispatch({
          effects: [
            languageSlot.reconfigure(markdown({ codeLanguages: languages, addKeymap: false })),
            gutterSlot.reconfigure([]),
          ],
        });
        return;
      }
      const match = languages.find(item =>
        item.name.toLowerCase() === (language === 'svg' ? 'xml' : language) ||
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
    const proseContext = (state: EditorState, from: number, to: number) => {
      if (activeLanguage || (fileLanguage && fileLanguage !== 'markdown')) return false;
      for (const pos of [from, to]) {
        let node = syntaxTree(state).resolveInner(pos, -1);
        while (node) {
          if (/^(?:FencedCode|CodeBlock|HTMLBlock|InlineCode|BulletList|OrderedList|Blockquote|Table)$/.test(node.name)) return false;
          const parent = node.parent;
          if (!parent) break;
          node = parent;
        }
      }
      return true;
    };
    view = new EditorView({
      state: EditorState.create({
        doc: initialText,
        extensions: [
          minimalSetup,
          blockCommands,
          editorColorPicker,
          gutterSlot.of([]),
          languageSlot.of(markdown({ codeLanguages: languages, addKeymap: false })),
          syntaxHighlighting(flowHighlight),
          EditorView.lineWrapping,
          // Format one bulk insertion, never the whole page or ordinary keystrokes.
          EditorView.domEventHandlers({
            paste(event, target) {
              const text = event.clipboardData?.getData('text/plain');
              if (!text || repairLanguage(text, fileLanguage) || !shouldAutoFormatPaste(text)) return false;
              const range = target.state.selection.main;
              if (target.state.selection.ranges.length !== 1 || !proseContext(target.state, range.from, range.to)) return false;
              const doc = target.state.doc;
              const boundary = bulkInsertionBoundary(doc.sliceString(doc.lineAt(range.from).from, range.from),
                doc.sliceString(range.to, doc.lineAt(range.to).to));
              if (!boundary) return false;
              const options = { atDocumentStart: range.from === 0, manual: false };
              if (text.length < WORKER_THRESHOLD) {
                const formatted = finishBulkInsertion(text, formatPlainTextAsMarkdown(text, options), boundary);
                if (formatted === text) return false;
                event.preventDefault();
                target.dispatch({ ...target.state.replaceSelection(formatted), userEvent: 'input.paste' });
                return true;
              }
              // Insert immediately, even if the worker fails or navigation intervenes.
              event.preventDefault();
              target.dispatch({ ...target.state.replaceSelection(text), userEvent: 'input.paste' });
              const snapshot = target.state.doc;
              const insertedEnd = target.state.selection.main.head;
              void formatMarkdownAction(text, options).then(result => {
                const formatted = finishBulkInsertion(text, result, boundary);
                if (formatted === text || viewRef.current !== target || target.state.doc !== snapshot) return;
                target.dispatch({ changes: { from: range.from, to: insertedEnd, insert: formatted }, userEvent: 'input.format' });
              }).catch(() => { /* Original insertion is already saved. */ });
              return true;
            },
          }),
          // Native dictation and accessibility tools often insert a long single
          // transaction instead of emitting a clipboard paste.
          EditorState.transactionFilter.of(tr => {
            if (!tr.docChanged || !tr.isUserEvent('input') || tr.isUserEvent('input.paste') ||
                tr.isUserEvent('input.compose') || tr.isUserEvent('input.format') ||
                tr.startState.selection.ranges.length !== 1) return tr;
            const edits: { fromA: number; toA: number; fromB: number; toB: number; text: string }[] = [];
            tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
              if (inserted.length >= 80 && inserted.length < WORKER_THRESHOLD)
                edits.push({ fromA, toA, fromB, toB, text: inserted.toString() });
              else edits.push({ fromA, toA, fromB, toB, text: '' });
            });
            if (edits.length !== 1) return tr;
            const edit = edits[0];
            const doc = tr.startState.doc;
            const boundary = bulkInsertionBoundary(doc.sliceString(doc.lineAt(edit.fromA).from, edit.fromA),
              doc.sliceString(edit.toA, doc.lineAt(edit.toA).to));
            if (!edit.text || !boundary || !proseContext(tr.startState, edit.fromA, edit.toA) ||
                repairLanguage(edit.text, fileLanguage) || !shouldAutoFormatPaste(edit.text)) return tr;
            const formatted = finishBulkInsertion(edit.text,
              formatPlainTextAsMarkdown(edit.text, { atDocumentStart: edit.fromA === 0 }), boundary);
            if (formatted === edit.text) return tr;
            return [tr, { changes: { from: edit.fromB, to: edit.toB, insert: formatted },
              selection: { anchor: edit.fromB + formatted.length }, sequential: true }];
          }),
          // Disable only Markdown's implicit Enter continuation. Preserve
          // its Backspace handling, plus normal Tab indentation.
          Prec.highest(keymap.of([
            { key: 'Enter', run: target => !activeLanguage && enterExplicitMarkdownList(target) },
            ...markdownKeymap.filter(binding => binding.key === 'Backspace'),
          ])),
          keymap.of([indentWithTab]),
          placeholder('Press / for commands, or start writing…'),
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
