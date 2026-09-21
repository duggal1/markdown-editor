import { createContext, memo, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ReactNode } from 'react';
import { svgPreviewDocument } from '../lib/svgPreview';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import hljs from 'highlight.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Icon } from './Icons';
import { detectRawCode } from '../lib/code';
import { previewChunks } from '../lib/previewChunks';

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
function locatePreview(scroll: HTMLDivElement, line: number, kind: 'scroll' | 'cursor') {
  const anchored = Array.from(scroll.querySelectorAll<HTMLElement>('[data-source-line]'));
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
  const top = current.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
  const nextTop = next ? next.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop
    : top + Math.max(40, current.offsetHeight);
  const end = next ? Number(next.dataset.sourceLine || start + 1) : start + 1;
  const fraction = Math.max(0, Math.min(1, (line - start) / Math.max(1, end - start)));
  const target = top + (nextTop - top) * fraction;
  if (kind === 'cursor' && target >= scroll.scrollTop + scroll.clientHeight * 0.12 &&
    target <= scroll.scrollTop + scroll.clientHeight * 0.78) return;
  scroll.scrollTop = Math.max(0, target - scroll.clientHeight * (kind === 'cursor' ? 0.30 : 0.12));
}

const aliases: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', sh: 'bash', shell: 'bash', rs: 'rust', yml: 'yaml',
  html: 'xml', svg: 'xml', 'c++': 'cpp', 'c#': 'csharp', md: 'markdown',
};
function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function highlight(value: string, language: string, limit = 1600) {
  if (!language || !hljs.getLanguage(language) || value.length > limit) return escapeHtml(value);
  try { return hljs.highlight(value, { language, ignoreIllegals: true }).value; }
  catch { return escapeHtml(value); }
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
  const chunks = useMemo(() => previewChunks(markdown), [markdown]);
  const firstLines = useMemo(() => {
    let line = 1;
    return chunks.map(chunk => {
      const first = line;
      for (let i = 0; i < chunk.length; i++) if (chunk.charCodeAt(i) === 10) line++;
      return first;
    });
  }, [chunks]);
  const virtualizer = useVirtualizer({
    count: chunks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => Math.max(80, Math.ceil(chunks[index].length / 90) * 27),
    overscan: 2,
    useFlushSync: false,
  });
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    let pending: number | null = null;
    function onPosition(event: Event) {
      const { line, total, kind } = (event as PositionEvent).detail;
      if (pending !== null) cancelAnimationFrame(pending);
      if (line >= total - 1) {
        virtualizer.scrollToIndex(chunks.length - 1, { align: 'end' });
        pending = requestAnimationFrame(() => {
          pending = null;
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
      // Avoid a visible jump to the beginning of the same chunk on every scroll tick.
      if (scroll.querySelector(selector)) {
        locatePreview(scroll, line, kind);
        return;
      }
      virtualizer.scrollToIndex(index, { align: 'start' });
      pending = requestAnimationFrame(() => {
        pending = null;
        if (scroll?.querySelector(selector)) locatePreview(scroll, line, kind);
      });
    }
    scroll.addEventListener('flow-preview-position', onPosition);
    return () => {
      scroll.removeEventListener('flow-preview-position', onPosition);
      if (pending !== null) cancelAnimationFrame(pending);
    };
  }, [firstLines, scrollRef, virtualizer]);
  return <article className="markdown-preview virtual-markdown">
    <div className="virtual-markdown-canvas" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map(item => <div key={item.key}
        ref={virtualizer.measureElement} data-index={item.index}
        className="virtual-markdown-section"
        style={{ transform: 'translateY(' + item.start + 'px)' }}>
        <MarkdownChunk markdown={chunks[item.index]} lineOffset={firstLines[item.index] - 1} />
      </div>)}
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
  const virtual = !detected && value.length > 18000;
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || virtual) return;
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
  }, [detected, scrollRef, virtual, value]);
  const body = !value.trim()
    ? <article className="markdown-preview"><p className="empty-preview">Nothing to preview.</p></article>
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
