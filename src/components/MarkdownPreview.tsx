import { createContext, memo, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ReactNode } from 'react';
import { SvgInspector } from './SvgInspector';
import { cancelNavigation, navigateScroll } from '../lib/scrollMotion';
import { rehypePreviewColors } from '../lib/previewColors';
import { hexOccurrences } from '../lib/hexColor';
import { htmlPreviewDocument } from '../lib/htmlPreview';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import hljs from 'highlight.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Icon, type IconName } from './Icons';
import { detectRawCode, repairMixedCode } from '../lib/code';
import { cachedPreview, immediatePreview, preparePreview, type PreparedPreview } from '../lib/previewPipeline';

const safeMarkdownHtml = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'mark', 'sub', 'sup', 'details', 'summary',
    'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop', 'text', 'tspan'],
  attributes: {
    ...defaultSchema.attributes,
    svg: ['viewBox', 'width', 'height', 'fill', 'stroke', 'strokeWidth', 'xmlns', 'role', 'ariaLabel', 'preserveAspectRatio'],
    g: ['fill', 'stroke', 'strokeWidth', 'transform', 'opacity'],
    path: ['d', 'fill', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'opacity', 'transform', 'fillRule', 'clipRule'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'strokeWidth', 'opacity'],
    circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'strokeWidth', 'opacity'],
    ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'strokeWidth'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'strokeWidth', 'strokeLinecap'],
    polyline: ['points', 'fill', 'stroke', 'strokeWidth'],
    polygon: ['points', 'fill', 'stroke', 'strokeWidth'],
    linearGradient: ['id', 'x1', 'x2', 'y1', 'y2', 'gradientUnits'],
    radialGradient: ['id', 'cx', 'cy', 'r', 'fx', 'fy'],
    stop: ['offset', 'stopColor', 'stopOpacity'],
    text: ['x', 'y', 'fill', 'fontSize', 'textAnchor'],
    tspan: ['x', 'y', 'fill'],
  },
};
const ThemeContext = createContext<'light' | 'dark'>('light');
const SvgEditContext = createContext<((source: string, next: string, line: number) => boolean) | null>(null);
const LineContext = createContext(0);
const SourceLineMapContext = createContext<readonly number[] | undefined>(undefined);
const TaskLineContext = createContext<number | null>(null);
const TaskToggleContext = createContext<((line: number, checked: boolean) => void) | null>(null);
type SourceNode = { position?: { start?: { line?: number; offset?: number }; end?: { offset?: number } } };
function sourceLine(node?: SourceNode): number {
  const offset = useContext(LineContext);
  const map = useContext(SourceLineMapContext);
  const line = node?.position?.start?.line || 1;
  return map?.[line - 1] ?? offset + line;
}
type BlockProps = { children?: ReactNode; node?: SourceNode; className?: string };
function TaskCheckbox({ type, checked }: React.InputHTMLAttributes<HTMLInputElement>) {
  const line = useContext(TaskLineContext);
  const onToggle = useContext(TaskToggleContext);
  // Ordinary HTML inputs in the preview remain non-interactive.
  if (type !== 'checkbox' || line === null) return <input type={type} checked={checked} disabled />;
  return <input type="checkbox" checked={Boolean(checked)}
    aria-label={checked ? 'Mark task incomplete' : 'Mark task complete'}
    disabled={!onToggle} onChange={event => onToggle?.(line, event.currentTarget.checked)} />;
}
type PositionEvent = CustomEvent<{ line: number; total: number; kind: 'scroll' | 'cursor' | 'jump' }>;
function locatePreview(scroll: HTMLDivElement, line: number, kind: 'scroll' | 'cursor' | 'jump',
  section?: HTMLElement) {
  // The virtual preview can have hundreds of anchors. Only examine the
  // requested mounted section instead of querying every visible chunk.
  const anchored = (section || scroll).querySelectorAll<HTMLElement>('[data-source-line]');
  if (line <= 1) { navigateScroll(scroll, 0, kind === 'jump', Boolean(section)); return; }
  if (!anchored.length) {
    if (line <= 1) scroll.scrollTop = 0;
    return;
  }
  let lo = 0, hi = anchored.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Number(anchored[mid].dataset.sourceLine || 1) <= line) lo = mid;
    else hi = mid - 1;
  }
  const current = anchored[lo];
  const next = anchored[lo + 1] || null;
  const start = Number(current.dataset.sourceLine || 1);
  const scrollTop = scroll.scrollTop;
  const scrollY = scroll.getBoundingClientRect().top;
  const top = current.getBoundingClientRect().top - scrollY + scrollTop;
  const nextTop = next ? next.getBoundingClientRect().top - scrollY + scrollTop
    : top + Math.max(40, current.offsetHeight);
  const end = next ? Number(next.dataset.sourceLine || start + 1) : start + 1;
  const fraction = Math.max(0, Math.min(1, (line - start) / Math.max(1, end - start)));
  const target = top + (nextTop - top) * fraction;
  if (kind === 'cursor' && target >= scroll.scrollTop + scroll.clientHeight * 0.12 &&
    target <= scroll.scrollTop + scroll.clientHeight * 0.78) return;
  const destination = Math.max(0, target - (kind === 'cursor' ? scroll.clientHeight * 0.30 : 12));
  // Avoid a subpixel scroll write and layout invalidation every frame.
  if (Math.abs(destination - scrollTop) > 2 || kind !== 'jump') navigateScroll(scroll, destination, kind === 'jump', Boolean(section));
}

const aliases: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', sh: 'bash', shell: 'bash', rs: 'rust', yml: 'yaml',
  html: 'xml', svg: 'xml', 'c++': 'cpp', 'c#': 'csharp', md: 'markdown',
};
function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// Second bounded cache: repeated syntax blocks and virtualized code rows.
const highlightCache = new Map<string, string>();
const MAX_HIGHLIGHTS = 96;
function highlight(value: string, language: string, limit = 1600) {
  if (!language || !hljs.getLanguage(language) || value.length > limit) return escapeHtml(value);
  const key = language + '\u0000' + value;
  const cached = highlightCache.get(key);
  if (cached !== undefined) {
    highlightCache.delete(key);
    highlightCache.set(key, cached);
    return cached;
  }
  let html: string;
  try { html = hljs.highlight(value, { language, ignoreIllegals: true }).value; }
  catch { html = escapeHtml(value); }
  // Cache only bounded fragments; large code and full trees are virtualized.
  if (value.length <= 20_000) {
    highlightCache.set(key, html);
    while (highlightCache.size > MAX_HIGHLIGHTS) {
      const oldest = highlightCache.keys().next().value;
      if (oldest === undefined) break;
      highlightCache.delete(oldest);
    }
  }
  return html;
}
function useCopy(code: string) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { setCopied(false); }
  }
  return { copied, copy };
}
/**
 * Render a real HTML page rather than a Markdown approximation.
 * Throttle iframe reloads to 8 per second during continuous typing, without
 * the stop-typing debounce that previously made Flow feel disconnected.
 */
function HtmlCanvas({ source, embedded = false, scrollRef }: {
  source: string; embedded?: boolean;
  scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  const [rendered, setRendered] = useState(source);
  const iframe = useRef<HTMLIFrameElement>(null);
  const progress = useRef(0);
  useEffect(() => {
    // Recreating a large WebGL document during every keystroke resets its GPU
    // context. Render once after edits settle, without polling 10 MB strings.
    const delay = source.length > 250_000 ? 1000 : source.length > 60_000 ? 350 : 125;
    const timer = window.setTimeout(() => setRendered(source), delay);
    return () => clearTimeout(timer);
  }, [source]);
  const documentHtml = useMemo(() => htmlPreviewDocument(rendered), [rendered]);
  useEffect(() => {
    const parent = scrollRef?.current;
    if (!parent) return;
    const onPosition = (event: Event) => {
      const { line, total } = (event as PositionEvent).detail;
      progress.current = Math.max(0, Math.min(1, (line - 1) / Math.max(1, total - 1)));
      iframe.current?.contentWindow?.postMessage({
        type: 'flow-html-scroll', progress: progress.current,
      }, '*');
    };
    parent.addEventListener('flow-preview-position', onPosition);
    parent.dispatchEvent(new Event('flow-preview-ready'));
    return () => parent.removeEventListener('flow-preview-position', onPosition);
  }, [scrollRef]);
  if (!documentHtml) return embedded ? null
    : <div className="html-preview-unavailable">Paste a valid HTML document to preview it.</div>;
  return <div className={embedded ? 'html-embedded-preview' : 'html-document-preview'}>
    <iframe ref={iframe} title={embedded ? 'HTML code preview' : 'HTML document preview'}
      sandbox="allow-scripts allow-pointer-lock allow-forms allow-downloads" srcDoc={documentHtml} referrerPolicy="no-referrer"
      onLoad={() => iframe.current?.contentWindow?.postMessage({
        type: 'flow-html-scroll', progress: progress.current,
      }, '*')} />
  </div>;
}
function isSvgCode(code: string, language: string) {
  return language.toLowerCase() === 'svg' ||
    (!language || /^(xml|html)$/i.test(language)) && detectRawCode(code) === 'svg';
}
// Highlighted source is already escaped. Wrap the exact text range without
// destroying the existing syntax markup, even across highlight spans.
function colorCodeHtml(value: string, html: string): string {
  const matches = hexOccurrences(value);
  if (!matches.length) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number; end: number }[] = [];
  let cursor = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    nodes.push({ node, start: cursor, end: cursor + node.length });
    cursor += node.length;
  }
  let index = nodes.length - 1;
  for (const item of matches.reverse()) {
    const end = item.from + item.text.length;
    while (index >= 0 && nodes[index].start >= end) index--;
    const last = nodes[index];
    while (index >= 0 && nodes[index].start > item.from) index--;
    const first = nodes[index];
    if (!first || !last || first.end <= item.from || last.end < end) continue;
    const range = document.createRange();
    try {
      range.setStart(first.node, item.from - first.start);
      range.setEnd(last.node, end - last.start);
      const span = document.createElement('span');
      span.className = 'flow-preview-hex';
      const swatch = document.createElement('span');
      swatch.className = 'flow-preview-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.cssText = 'display:inline-block;width:.8em;height:.8em;margin-right:4px;vertical-align:-.04em;border-radius:3px;box-shadow:inset 0 0 0 1px #8888';
      swatch.style.backgroundColor = item.text;
      span.append(swatch, range.extractContents());
      range.insertNode(span);
    } catch { /* Retain the escaped source if a range cannot be decorated. */ }
  }
  return template.innerHTML;
}
/** SVG is artwork, never an accompanying source viewer. The editor retains its source. */
function SvgCanvas({ source, line = 1 }: { source: string; line?: number }) {
  const theme = useContext(ThemeContext);
  const edit = useContext(SvgEditContext);
  return <SvgInspector source={source} theme={theme} onEdit={edit ? (next) => edit(source, next, line) : undefined} />;
}
const snippetLanguages: Record<string, { label: string; icon: IconName }> = {
  javascript: { label: 'JavaScript', icon: 'fileJs' }, jsx: { label: 'JSX', icon: 'fileJs' },
  typescript: { label: 'TypeScript', icon: 'fileTs' }, tsx: { label: 'TSX', icon: 'fileTs' },
  html: { label: 'HTML', icon: 'fileHtml' }, sql: { label: 'SQL', icon: 'database' },
  css: { label: 'CSS', icon: 'code' }, json: { label: 'JSON', icon: 'code' },
  python: { label: 'Python', icon: 'code' }, bash: { label: 'Bash', icon: 'terminal' },
  swift: { label: 'Swift', icon: 'code' }, rust: { label: 'Rust', icon: 'code' },
  go: { label: 'Go', icon: 'code' }, xml: { label: 'XML', icon: 'code' },
  markdown: { label: 'Markdown', icon: 'file' }, yaml: { label: 'YAML', icon: 'file' },
};
function CodeLanguageLabel({ rawLanguage }: { rawLanguage: string }) {
  const raw = rawLanguage.toLowerCase();
  const key = raw === 'html' || raw === 'jsx' || raw === 'tsx' ? raw : aliases[raw] || raw;
  const meta = snippetLanguages[key] || { label: raw ? raw[0].toUpperCase()+raw.slice(1) : 'Code', icon: 'code' as const };
  return <span className="code-language"><Icon name={meta.icon} size={15} /><span>{meta.label}</span></span>;
}
function VirtualCodeBlock({ code, rawLanguage }: { code: string; rawLanguage: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const language = aliases[rawLanguage.toLowerCase()] || rawLanguage.toLowerCase();
  const lines = useMemo(() => code.split('\n'), [code]);
  const { copied, copy } = useCopy(code);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 22,
    overscan: 12,
  });
  return <div className="code-block virtual-code-block">
    <div className="code-header"><CodeLanguageLabel rawLanguage={rawLanguage} />
      <button type="button" className="code-copy" onClick={() => { void copy(); }}>
        <Icon name={copied ? 'check' : 'copy'} size={13} />{copied ? 'Copied' : 'Copy'}
      </button>
    </div>
    {rawLanguage.toLowerCase() === 'html' && <HtmlCanvas source={code} embedded />}
    <pre ref={ref} className="code-content virtual-code-scroll" tabIndex={0}>
      <code className="virtual-code-canvas" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(item => <span key={item.key} className="virtual-code-row"
          style={{ transform: 'translateY(' + item.start + 'px)' }}>
          <span className="code-row-number" aria-hidden="true">{item.index + 1}</span>
          <span className="virtual-code-text" dangerouslySetInnerHTML={{ __html: colorCodeHtml(lines[item.index], highlight(lines[item.index], language)) || ' ' }} />
        </span>)}
      </code>
    </pre>
  </div>;
}
function CodeBlock({ code, rawLanguage, line }: { code: string; rawLanguage: string; line?: number }) {
  if (isSvgCode(code, rawLanguage)) return <SvgCanvas source={code} line={line} />;
  return <SourceCodeBlock code={code} rawLanguage={rawLanguage} />;
}
function SourceCodeBlock({ code, rawLanguage }: { code: string; rawLanguage: string }) {
  const { copied, copy } = useCopy(code);
  const language = aliases[rawLanguage.toLowerCase()] || rawLanguage.toLowerCase();
  const big = code.length > 20000;
  const highlighted = useMemo(() => big ? '' : colorCodeHtml(code, highlight(code, language, 20000)), [code, language, big]);
  const rows = useMemo(() => big ? 0 : code.split('\n').length, [code, big]);
  // Large code is a fixed-height, line-virtualized source viewer instead of thousands of DOM nodes.
  if (big) return <VirtualCodeBlock code={code} rawLanguage={rawLanguage} />;
  return <div className="code-block">
    <div className="code-header">
      <CodeLanguageLabel rawLanguage={rawLanguage} />
      <button type="button" className="code-copy" onClick={() => { void copy(); }} aria-label={copied ? 'Copied' : 'Copy code'}>
        <Icon name={copied ? 'check' : 'copy'} size={13} />{copied ? 'Copied' : 'Copy'}
      </button>
    </div>
    {rawLanguage.toLowerCase() === 'html' && <HtmlCanvas source={code} embedded />}
    <pre className="code-content" tabIndex={0}>
      {rows <= 400 && <span className="code-gutter" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => <span key={index}>{index + 1}</span>)}
      </span>}
      <code className="code-text" dangerouslySetInnerHTML={{ __html: highlighted || ' ' }} />
    </pre>
  </div>;
}
const components = {
  p: ({ children, node, className }: BlockProps) =>
    <p data-source-line={sourceLine(node)} className={className}>{children}</p>,
  h1: ({ children, node }: BlockProps) => <h1 data-source-line={sourceLine(node)}>{children}</h1>,
  h2: ({ children, node }: BlockProps) => <h2 data-source-line={sourceLine(node)}>{children}</h2>,
  h3: ({ children, node }: BlockProps) => <h3 data-source-line={sourceLine(node)}>{children}</h3>,
  h4: ({ children, node }: BlockProps) => <h4 data-source-line={sourceLine(node)}>{children}</h4>,
  h5: ({ children, node }: BlockProps) => <h5 data-source-line={sourceLine(node)}>{children}</h5>,
  h6: ({ children, node }: BlockProps) => <h6 data-source-line={sourceLine(node)}>{children}</h6>,
  li: ({ children, node, className }: BlockProps) => {
    const line = sourceLine(node);
    const taskLine = className?.split(/\s+/).includes('task-list-item') ? line : null;
    return <li data-source-line={line} className={className}>
      <TaskLineContext.Provider value={taskLine}>{children}</TaskLineContext.Provider>
    </li>;
  },
  blockquote: ({ children, node }: BlockProps) =>
    <blockquote data-source-line={sourceLine(node)}>{children}</blockquote>,
  table: ({ children, node }: BlockProps) =>
    <div data-source-line={sourceLine(node)} className="table-scroll"><table>{children}</table></div>,
  pre: ({ children, node }: BlockProps) => {
    const line = sourceLine(node);
    const child = Array.isArray(children) ? children[0] : children;
    if (!child || typeof child !== 'object' || !('props' in child)) return <pre data-source-line={line}>{children}</pre>;
    const props = child.props as { className?: string; children?: unknown };
    const language = /language-([\w+#.-]+)/.exec(props.className ?? '')?.[1] ?? '';
    const code = String(props.children ?? '').replace(/\n$/, '');
    return <div data-source-line={line}><CodeBlock code={code} rawLanguage={language} line={line} /></div>;
  },
  a: ({ children, href }: { children?: ReactNode; href?: string }) =>
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <TaskCheckbox {...props} />,
  img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} loading="lazy" alt={props.alt || ''} />,
};
// Send complete raw SVG blocks through the isolated SVG renderer instead of
// stripping masks, filters, styles and references with Markdown's HTML sanitizer.
type SvgMarkdownNode = {
  type: string; value?: string; lang?: string; children?: SvgMarkdownNode[];
  position?: { start: { offset?: number; line: number }; end: { offset?: number; line: number } };
};
function remarkSvgBlocks() {
  return (tree: SvgMarkdownNode, file: { value: unknown }) => {
    const source = String(file.value);
    const children = tree.children;
    if (!children) return;
    // CommonMark HTML blocks can end at a blank line even inside an SVG.
    // Recover the complete original block by source offsets, including nested
    // svg elements, while leaving inline markup and fenced code alone.
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      const from = node.position?.start.offset;
      if (node.type !== 'html' || from === undefined || !/^<svg(?:\s|\/?>)/i.test(source.slice(from))) continue;
      const tags = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
      tags.lastIndex = from;
      let depth = 0;
      let end = from;
      let match: RegExpExecArray | null;
      while ((match = tags.exec(source))) {
        const tag = match[0];
        if (tag.startsWith('<!--') || tag.startsWith('<![')) continue;
        if (tag.startsWith('</')) depth--;
        else if (!/\/>$/.test(tag)) depth++;
        if (depth === 0) { end = tags.lastIndex; break; }
      }
      if (end <= from) continue;
      let last = i;
      while (last + 1 < children.length && (children[last + 1].position?.start.offset ?? Infinity) < end) last++;
      // Don't discard text sharing the closing SVG's source line.
      const tail = children[last].position?.end.offset ?? end;
      if (tail > end && source.slice(end, tail).trim()) continue;
      children.splice(i, last - i + 1, {
        type: 'code', lang: 'svg', value: source.slice(from, end),
        position: node.position ? { start: node.position.start, end: { offset: end, line: node.position.end.line } } : undefined,
      });
    }
  };
}
const MarkdownChunk = memo(function MarkdownChunk({ markdown, lineOffset = 0, sourceLines }: { markdown: string; lineOffset?: number; sourceLines?: readonly number[] }) {
  return <LineContext.Provider value={lineOffset}><SourceLineMapContext.Provider value={sourceLines}><ReactMarkdown remarkPlugins={[remarkGfm, remarkSvgBlocks]}
    rehypePlugins={[rehypeRaw, [rehypeSanitize, safeMarkdownHtml], rehypePreviewColors]}
    components={components}>{markdown}</ReactMarkdown></SourceLineMapContext.Provider></LineContext.Provider>;
});
function VirtualMarkdown({ markdown, scrollRef }: {
  markdown: string; scrollRef: RefObject<HTMLDivElement | null>;
}) {
  // Small documents are instant. Large ones are prepared in a Web Worker,
  // then reused by source identity on subsequent preview visits.
  const immediate = useMemo(() => markdown.length < 80_000
    ? immediatePreview(markdown) : cachedPreview(markdown), [markdown]);
  const [workerResult, setWorkerResult] = useState<PreparedPreview | null>(null);
  useEffect(() => {
    if (immediate) return;
    let cancelled = false;
    void preparePreview(markdown).then(result => {
      if (!cancelled) setWorkerResult(result);
    });
    return () => { cancelled = true; };
  }, [markdown, immediate]);
  const prepared = immediate || (workerResult?.source === markdown ? workerResult : null);
  const chunks = prepared?.chunks || [];
  const firstLines = prepared?.firstLines || [];
  const virtualizer = useVirtualizer({
    count: chunks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => Math.max(80, Math.ceil(chunks[index].length / 90) * 27),
    // Only a few complete Markdown blocks are mounted. A small read-ahead
    // prevents blank flashes during rapid wheel and iOS momentum scrolling.
    overscan: 3,
    useFlushSync: false,
  });
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !chunks.length) return;
    let pending: number | null = null;
    let settle: number | null = null;
    let latest: PositionEvent['detail'] | null = null;

    function sync() {
      pending = null;
      if (!scroll || !latest) return;
      const { line, total, kind } = latest;
      if (settle !== null) { cancelAnimationFrame(settle); settle = null; }
      if (line <= 1) { navigateScroll(scroll, 0, kind === 'jump', true); return; }
      if (line >= total) {
        if (kind === 'jump') { navigateScroll(scroll, scroll.scrollHeight, true, true); return; }
        virtualizer.scrollToIndex(chunks.length - 1, { align: 'end' });
        if (settle !== null) cancelAnimationFrame(settle);
        settle = requestAnimationFrame(() => {
          settle = null;
          if (scroll) scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight;
        });
        return;
      }
      let low = 0, high = firstLines.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (firstLines[mid] <= line) low = mid;
        else high = mid - 1;
      }
      const index = low;
      const selector = `.virtual-markdown-section[data-index="${index}"]`;
      const section = scroll.querySelector<HTMLElement>(selector);
      if (section) {
        locatePreview(scroll, line, kind, section);
        return;
      }
      // Explicit navigation eases to an estimated virtual offset, then aligns
      // the measured heading once mounted. Ordinary sync stays immediate.
      let attempts = 0;
      const settleWhenMounted = () => {
        settle = null;
        if (!scroll || !latest) return;
        const currentLine = latest.line;
        let low = 0, high = firstLines.length - 1;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          if (firstLines[mid] <= currentLine) low = mid;
          else high = mid - 1;
        }
        const mounted = scroll.querySelector<HTMLElement>(
          `.virtual-markdown-section[data-index="${low}"]`,
        );
        if (mounted) {
          locatePreview(scroll, currentLine, latest.kind, mounted);
        } else if (++attempts < 4) {
          settle = requestAnimationFrame(settleWhenMounted);
        }
      };
      const estimated = kind === 'jump' ? virtualizer.getOffsetForIndex(index, 'start')?.[0] : undefined;
      if (estimated !== undefined) {
        navigateScroll(scroll, estimated, true, true, () => {
          if (latest?.line !== line) return;
          // Measurement may shift the estimate while traversing virtual chunks.
          if (!scroll.querySelector(selector)) virtualizer.scrollToIndex(index, { align: 'start' });
          settle = requestAnimationFrame(settleWhenMounted);
        });
      } else {
        cancelNavigation(scroll);
        virtualizer.scrollToIndex(index, { align: 'start' });
        settle = requestAnimationFrame(settleWhenMounted);
      }
    }
    function onPosition(event: Event) {
      latest = (event as PositionEvent).detail;
      // Editor scroll events have already been coalesced into a frame.
      // Handle them here without stacking another whole frame of latency.
      // Cursor movement is not throttled at the source, so keep it batched.
      if (latest.kind === 'scroll') {
        if (pending !== null) {
          cancelAnimationFrame(pending);
          pending = null;
        }
        sync();
      } else if (pending === null) {
        pending = requestAnimationFrame(sync);
      }
    }
    function cancelSync() {
      latest = null;
      cancelNavigation(scroll);
      if (pending !== null) { cancelAnimationFrame(pending); pending = null; }
      if (settle !== null) { cancelAnimationFrame(settle); settle = null; }
    }
    scroll.addEventListener('flow-preview-position', onPosition);
    scroll.addEventListener('flow-preview-user-scroll', cancelSync);
    scroll.dispatchEvent(new Event('flow-preview-ready'));
    return () => {
      scroll.removeEventListener('flow-preview-position', onPosition);
      scroll.removeEventListener('flow-preview-user-scroll', cancelSync);
      cancelNavigation(scroll);
      if (pending !== null) cancelAnimationFrame(pending);
      if (settle !== null) cancelAnimationFrame(settle);
    };
  }, [firstLines, chunks.length, scrollRef, virtualizer]);

  const visible = virtualizer.getVirtualItems();
  const firstStart = visible[0]?.start || 0;
  if (!prepared) return <article className="markdown-preview virtual-markdown" aria-busy="true">
    <p className="preview-loading">Preparing preview…</p>
  </article>;
  return <article className="markdown-preview virtual-markdown">
    <div className="virtual-markdown-canvas" style={{ height: virtualizer.getTotalSize() }}>
      {visible.length > 0 && <div className="virtual-markdown-window"
        style={{ transform: 'translateY(' + firstStart + 'px)' }}>
        {visible.map(item => <div key={item.key}
          ref={virtualizer.measureElement} data-index={item.index}
          className={'virtual-markdown-section' +
            (prepared.continuations[item.index] ? ' continues-list' : '') +
            (prepared.continuations[item.index + 1] ? ' followed-by-list' : '')}>
          <MarkdownChunk markdown={chunks[item.index]} lineOffset={firstLines[item.index] - 1} sourceLines={prepared.sourceLineMaps?.[item.index]} />
        </div>)}
      </div>}
    </div>
  </article>;
}
function MarkdownPreview({ markdown, sourceLanguage, scrollRef, theme, onToggleTask = null, onSvgEdit = null }: {
  markdown: string; sourceLanguage?: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  theme: 'light' | 'dark';
  onToggleTask?: ((line: number, checked: boolean) => void) | null;
  onSvgEdit?: ((source: string, next: string, line: number) => boolean) | null;
}) {
  const deferred = useDeferredValue(markdown);
  const value = markdown.length <= 18000 ? markdown : deferred;
  const detected = useMemo(() => detectRawCode(value) === 'svg' ? 'svg' : sourceLanguage && sourceLanguage !== 'markdown'
    ? sourceLanguage : detectRawCode(value), [value, sourceLanguage]);
  const html = detected === 'html';
  const svg = detected === 'svg';
  const virtual = !detected && value.length > 18000;
  const repaired = useMemo(() => !detected && !virtual ? repairMixedCode(value) : { markdown: value }, [value, detected, virtual]);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || virtual || html || svg) return;
    const onPosition = (event: Event) => {
      const { line, total, kind } = (event as PositionEvent).detail;
      const code = scroll.querySelector<HTMLElement>('.virtual-code-scroll');
      if (detected && code) {
        code.scrollTop = line >= total ? code.scrollHeight : Math.max(0, (line - 1) * 22 - (kind === 'cursor' ? code.clientHeight * .28 : 0));
        return;
      }
      if (line >= total && total > 1) {
        navigateScroll(scroll, scroll.scrollHeight, kind === 'jump');
        return;
      }
      if (detected) {
        const content = scroll.querySelector<HTMLElement>('.code-block');
        if (content) scroll.scrollTop = Math.max(0,
          content.offsetTop + (line / Math.max(1, total)) * content.offsetHeight - scroll.clientHeight * 0.25);
        return;
      }
      locatePreview(scroll, line, kind);
    };
    scroll.addEventListener('flow-preview-position', onPosition);
    scroll.dispatchEvent(new Event('flow-preview-ready'));
    const cancel = () => cancelNavigation(scroll);
    scroll.addEventListener('flow-preview-user-scroll', cancel);
    return () => {
      scroll.removeEventListener('flow-preview-position', onPosition);
      scroll.removeEventListener('flow-preview-user-scroll', cancel);
      cancelNavigation(scroll);
    };
  }, [detected, scrollRef, virtual, html, svg, value]);
  const body = !value.trim()
    ? <article className="markdown-preview"><p className="empty-preview">Nothing to preview.</p></article>
    : svg
      ? <article className="markdown-preview preview-is-svg"><SvgCanvas source={value} /></article>
    : html
      ? <HtmlCanvas source={value} scrollRef={scrollRef} />
    : detected
      ? <article className="markdown-preview preview-is-code">
          <CodeBlock code={value} rawLanguage={detected} />
        </article>
      : virtual
        ? <VirtualMarkdown markdown={value} scrollRef={scrollRef} />
        : <article className="markdown-preview"><MarkdownChunk markdown={repaired.markdown} sourceLines={repaired.sourceLines} /></article>;
  return <TaskToggleContext.Provider value={onToggleTask}>
    <ThemeContext.Provider value={theme}><SvgEditContext.Provider value={onSvgEdit}>{body}</SvgEditContext.Provider></ThemeContext.Provider>
  </TaskToggleContext.Provider>;
}
export default memo(MarkdownPreview);
