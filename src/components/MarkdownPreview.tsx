import { memo, useDeferredValue, useMemo, useRef, useState, type RefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import hljs from 'highlight.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Icon } from './Icons';
import { detectRawCode } from '../lib/code';
import { previewChunks } from '../lib/previewChunks';

const safeMarkdownHtml = { ...defaultSchema, tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'mark', 'sub', 'sup', 'details', 'summary'] };
const aliases: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', sh: 'bash', shell: 'bash', rs: 'rust', yml: 'yaml',
  html: 'xml', svg: 'xml', 'c++': 'cpp', 'c#': 'csharp', md: 'markdown',
};
function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function highlight(value: string, language: string) {
  if (!language || !hljs.getLanguage(language) || value.length > 1600) return escapeHtml(value);
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
  const language = aliases[rawLanguage.toLowerCase()] || rawLanguage.toLowerCase();
  const lines = useMemo(() => code.split('\n'), [code]);
  const { copied, copy } = useCopy(code);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 22,
    overscan: 12,
  });
  const svgDocument = useMemo(() => rawLanguage === 'svg' && code.length < 150000
    ? '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data: blob:; style-src &#39;unsafe-inline&#39;"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:transparent}svg{max-width:100%;max-height:100%;width:auto;height:auto}</style></head><body>' + code + '</body></html>'
    : '', [code, rawLanguage]);
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
  const { copied, copy } = useCopy(code);
  const language = aliases[rawLanguage.toLowerCase()] || rawLanguage.toLowerCase();
  const big = code.length > 20000;
  const highlighted = useMemo(() => big ? '' : highlight(code, language), [code, language, big]);
  const rows = useMemo(() => big ? 0 : code.split('\n').length, [code, big]);
  const svgDocument = useMemo(() => rawLanguage === 'svg' && !big
    ? '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data: blob:; style-src &#39;unsafe-inline&#39;"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:transparent}svg{max-width:100%;max-height:100%;width:auto;height:auto}</style></head><body>' + code + '</body></html>'
    : '', [code, rawLanguage, big]);
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
  table: ({ children }: { children?: React.ReactNode }) => <div className="table-scroll"><table>{children}</table></div>,
  pre: ({ children }: { children?: React.ReactNode }) => {
    const child = Array.isArray(children) ? children[0] : children;
    if (!child || typeof child !== 'object' || !('props' in child)) return <pre>{children}</pre>;
    const props = child.props as { className?: string; children?: unknown };
    const language = /language-([\w+#.-]+)/.exec(props.className ?? '')?.[1] ?? '';
    return <CodeBlock code={String(props.children ?? '').replace(/\n$/, '')} rawLanguage={language} />;
  },
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) =>
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} aria-label="Task" disabled />,
  img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} loading="lazy" alt={props.alt || ''} />,
};
const MarkdownChunk = memo(function MarkdownChunk({ markdown }: { markdown: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}
    rehypePlugins={[rehypeRaw, [rehypeSanitize, safeMarkdownHtml]]}
    components={components}>{markdown}</ReactMarkdown>;
});
function VirtualMarkdown({ markdown, scrollRef }: {
  markdown: string; scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const chunks = useMemo(() => previewChunks(markdown), [markdown]);
  const virtualizer = useVirtualizer({
    count: chunks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => Math.max(80, Math.ceil(chunks[index].length / 90) * 27),
    overscan: 2,
    useFlushSync: false,
  });
  return <article className="markdown-preview virtual-markdown">
    <div className="virtual-markdown-canvas" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map(item => <div key={item.key}
        ref={virtualizer.measureElement} data-index={item.index}
        className="virtual-markdown-section"
        style={{ transform: 'translateY(' + item.start + 'px)' }}>
        <MarkdownChunk markdown={chunks[item.index]} />
      </div>)}
    </div>
  </article>;
}
function MarkdownPreview({ markdown, sourceLanguage, scrollRef }: {
  markdown: string; sourceLanguage?: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const deferred = useDeferredValue(markdown);
  // Keep small documents exact-frame live; big ones yield to the actual typing interaction.
  const value = markdown.length <= 18000 ? markdown : deferred;
  const detected = useMemo(() => sourceLanguage && sourceLanguage !== 'markdown'
    ? sourceLanguage : detectRawCode(value), [value, sourceLanguage]);
  if (!value.trim()) return <article className="markdown-preview"><p className="empty-preview">Nothing to preview.</p></article>;
  if (detected) return <article className="markdown-preview preview-is-code">
    <CodeBlock code={value} rawLanguage={detected} />
  </article>;
  if (value.length > 18000) return <VirtualMarkdown markdown={value} scrollRef={scrollRef} />;
  return <article className="markdown-preview"><MarkdownChunk markdown={value} /></article>;
}
export default memo(MarkdownPreview);
