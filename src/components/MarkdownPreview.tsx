import { createContext, memo, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ReactNode } from 'react';
import { svgPreviewDocument } from '../lib/svgPreview';
import { htmlPreviewDocument } from '../lib/htmlPreview';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import hljs from 'highlight.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Icon } from './Icons';
import { detectRawCode } from '../lib/code';
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
const LineContext = createContext(0);
type SourceNode = { position?: { start?: { line?: number } } };
function sourceLine(node?: SourceNode): number {
  const offset = useContext(LineContext);
  return offset + (node?.position?.start?.line || 1);
}
type BlockProps = { children?: ReactNode; node?: SourceNode; className?: string };
type PositionEvent = CustomEvent<{ line: number; total: number; kind: 'scroll' | 'cursor' }>;
function locatePreview(scroll: HTMLDivElement, line: number, kind: 'scroll' | 'cursor',
  section?: HTMLElement) {
  // The virtual preview can have hundreds of anchors. Only examine the
  // requested mounted section instead of querying every visible chunk.
  const anchored = (section || scroll).querySelectorAll<HTMLElement>('[data-source-line]');
  if (!anchored.length) {
    if (line <= 1) scroll.scrollTop = 0;
    return;
  }
  let current = anchored[0];
  let next: HTMLElement | null = null;
  for (let i = 0; i < anchored.length; i++) {
    const at = Number(anchored[i].dataset.sourceLine || 1);
    if (at > line) { next = anchored[i]; break; }
    current = anchored[i];
  }
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
  const destination = Math.max(0, target - scroll.clientHeight * (kind === 'cursor' ? 0.30 : 0.12));
  // Avoid a subpixel scroll write and layout invalidation every frame.
  if (Math.abs(destination - scrollTop) > 2) scroll.scrollTop = destination;
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
  const latest = useRef(source);
  const iframe = useRef<HTMLIFrameElement>(null);
  const progress = useRef(0);
  latest.current = source;
  useEffect(() => {
    const interval = window.setInterval(() => {
      setRendered(current => current === latest.current ? current : latest.current);
    }, 125);
    return () => window.clearInterval(interval);
  }, []);
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
    return () => parent.removeEventListener('flow-preview-position', onPosition);
  }, [scrollRef]);
  if (!documentHtml) return embedded ? null
    : <div className="html-preview-unavailable">Paste a valid HTML document to preview it.</div>;
  return <div className={embedded ? 'html-embedded-preview' : 'html-document-preview'}>
    <iframe ref={iframe} title={embedded ? 'HTML code preview' : 'HTML document preview'}
      sandbox="allow-scripts" srcDoc={documentHtml} referrerPolicy="no-referrer"
      onLoad={() => iframe.current?.contentWindow?.postMessage({
        type: 'flow-html-scroll', progress: progress.current,
      }, '*')} />
  </div>;
}
function VirtualCodeBlock({ code, rawLanguage }: { code: string; rawLanguage: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const theme = useContext(ThemeContext);
  const language = aliases[rawLanguage.toLowerCase()] || rawLanguage.toLowerCase();
  const lines = useMemo(() => code.split('\n'), [code]);
  const { copied, copy } = useCopy(code);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 22,
    overscan: 12,
  });
  const svgDocument = useMemo(() => rawLanguage.toLowerCase() === 'svg' && code.length < 150000
    ? svgPreviewDocument(code, theme) : '', [code, rawLanguage, theme]);
  return <div className="code-block virtual-code-block">
    <div className="code-header"><span className="code-language"><span className="language-dot" />{rawLanguage || 'code'}</span>
      <button type="button" className="code-copy" onClick={() => { void copy(); }}>
        <Icon name={copied ? 'check' : 'copy'} size={13} />{copied ? 'Copied' : 'Copy'}
      </button>
    </div>
    {svgDocument && <div className="svg-preview"><iframe title="SVG preview" sandbox="" srcDoc={svgDocument} loading="lazy" /></div>}
    {rawLanguage.toLowerCase() === 'html' && <HtmlCanvas source={code} embedded />}
    <pre ref={ref} className="code-content virtual-code-scroll" tabIndex={0}>
      <code className="virtual-code-canvas" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(item => <span key={item.key} className="virtual-code-row"
          style={{ transform: 'translateY(' + item.start + 'px)' }}>
          <span className="code-row-number" aria-hidden="true">{item.index + 1}</span>
          <span className="virtual-code-text" dangerouslySetInnerHTML={{ __html: highlight(lines[item.index], language) || ' ' }} />
        </span>)}
      </code>
    </pre>
  </div>;
}
function CodeBlock({ code, rawLanguage }: { code: string; rawLanguage: string }) {
  const theme = useContext(ThemeContext);
  const { copied, copy } = useCopy(code);
  const language = aliases[rawLanguage.toLowerCase()] || rawLanguage.toLowerCase();
  const big = code.length > 20000;
  const highlighted = useMemo(() => big ? '' : highlight(code, language, 20000), [code, language, big]);
  const rows = useMemo(() => big ? 0 : code.split('\n').length, [code, big]);
  const svgDocument = useMemo(() => rawLanguage.toLowerCase() === 'svg' && !big
    ? svgPreviewDocument(code, theme) : '', [code, rawLanguage, big, theme]);
  // Large code is a fixed-height, line-virtualized source viewer instead of thousands of DOM nodes.
  if (big) return <VirtualCodeBlock code={code} rawLanguage={rawLanguage} />;
  return <div className="code-block">
    <div className="code-header">
      <span className="code-language"><span className="language-dot" />{rawLanguage || 'code'}</span>
      <button type="button" className="code-copy" onClick={() => { void copy(); }} aria-label={copied ? 'Copied' : 'Copy code'}>
        <Icon name={copied ? 'check' : 'copy'} size={13} />{copied ? 'Copied' : 'Copy'}
      </button>
    </div>
    {svgDocument && <div className="svg-preview"><iframe title="SVG preview" sandbox="" srcDoc={svgDocument} loading="lazy" /></div>}
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
  li: ({ children, node, className }: BlockProps) =>
    <li data-source-line={sourceLine(node)} className={className}>{children}</li>,
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
    return <div data-source-line={line}><CodeBlock code={String(props.children ?? '').replace(/\n$/, '')} rawLanguage={language} /></div>;
  },
  a: ({ children, href }: { children?: ReactNode; href?: string }) =>
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} aria-label="Task" disabled />,
  img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} loading="lazy" alt={props.alt || ''} />,
};
const MarkdownChunk = memo(function MarkdownChunk({ markdown, lineOffset = 0 }: { markdown: string; lineOffset?: number }) {
  return <LineContext.Provider value={lineOffset}><ReactMarkdown remarkPlugins={[remarkGfm]}
    rehypePlugins={[rehypeRaw, [rehypeSanitize, safeMarkdownHtml]]}
    components={components}>{markdown}</ReactMarkdown></LineContext.Provider>;
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
      if (line >= total - 1) {
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
      // Jump to the nearest virtual chunk immediately, then land on its
      // exact source anchor after React mounts it. One frame was insufficient
      // during heavy Markdown rendering, leaving the preview behind.
      virtualizer.scrollToIndex(index, { align: 'start' });
      if (settle !== null) cancelAnimationFrame(settle);
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
      settle = requestAnimationFrame(settleWhenMounted);
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
    scroll.addEventListener('flow-preview-position', onPosition);
    return () => {
      scroll.removeEventListener('flow-preview-position', onPosition);
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
          <MarkdownChunk markdown={chunks[item.index]} lineOffset={firstLines[item.index] - 1} />
        </div>)}
      </div>}
    </div>
  </article>;
}
function MarkdownPreview({ markdown, sourceLanguage, scrollRef, theme }: {
  markdown: string; sourceLanguage?: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  theme: 'light' | 'dark';
}) {
  const deferred = useDeferredValue(markdown);
  const value = markdown.length <= 18000 ? markdown : deferred;
  const detected = useMemo(() => sourceLanguage && sourceLanguage !== 'markdown'
    ? sourceLanguage : detectRawCode(value), [value, sourceLanguage]);
  const html = detected === 'html';
  const virtual = !detected && value.length > 18000;
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || virtual || html) return;
    const onPosition = (event: Event) => {
      const { line, total, kind } = (event as PositionEvent).detail;
      if (line >= total - 1) {
        scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight;
        return;
      }
      const code = scroll.querySelector<HTMLElement>('.virtual-code-scroll');
      if (detected && code) {
        code.scrollTop = Math.max(0, (line - 1) * 22 - code.clientHeight * 0.28);
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
    return () => scroll.removeEventListener('flow-preview-position', onPosition);
  }, [detected, scrollRef, virtual, html, value]);
  const body = !value.trim()
    ? <article className="markdown-preview"><p className="empty-preview">Nothing to preview.</p></article>
    : html
      ? <HtmlCanvas source={value} scrollRef={scrollRef} />
    : detected
      ? <article className="markdown-preview preview-is-code">
          <CodeBlock code={value} rawLanguage={detected} />
        </article>
      : virtual
        ? <VirtualMarkdown markdown={value} scrollRef={scrollRef} />
        : <article className="markdown-preview"><MarkdownChunk markdown={value} /></article>;
  return <ThemeContext.Provider value={theme}>{body}</ThemeContext.Provider>;
}
export default memo(MarkdownPreview);
