import { memo, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import hljs from 'highlight.js';
import { Icon } from './Icons';
import { detectRawCode } from '../lib/code';

const safeMarkdownHtml = { ...defaultSchema, tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'mark', 'sub', 'sup', 'details', 'summary'] };

const aliases: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', sh: 'bash', shell: 'bash', rs: 'rust', yml: 'yaml',
  html: 'xml', svg: 'xml', 'c++': 'cpp', 'c#': 'csharp', md: 'markdown',
};
function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function CodeBlock({ code, rawLanguage }: { code: string; rawLanguage: string }) {
  const [copied, setCopied] = useState(false);
  const language = aliases[rawLanguage.toLowerCase()] || rawLanguage.toLowerCase();
  const isSvg = rawLanguage.toLowerCase() === 'svg';
  const highlighted = useMemo(() => {
    if (code.length > 130000 || !language || !hljs.getLanguage(language)) return escapeHtml(code);
    try { return hljs.highlight(code, { language, ignoreIllegals: true }).value; }
    catch { return escapeHtml(code); }
  }, [code, language]);
  const rows = useMemo(() => code.split('\n').length, [code]);
  const svgDocument = useMemo(() =>
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data: blob:; style-src &#39;unsafe-inline&#39;"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:transparent}svg{max-width:100%;max-height:100%;width:auto;height:auto}</style></head><body>' + code + '</body></html>', [code]);
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { setCopied(false); }
  }
  return <div className="code-block">
    <div className="code-header">
      <span className="code-language"><span className="language-dot" />{rawLanguage || 'code'}</span>
      <button type="button" className="code-copy" onClick={() => { void copyCode(); }} aria-label={copied ? 'Copied' : 'Copy code'}>
        <Icon name={copied ? 'check' : 'copy'} size={13} />{copied ? 'Copied' : 'Copy'}
      </button>
    </div>
    {isSvg && <div className="svg-preview"><iframe title="SVG preview" sandbox="" srcDoc={svgDocument} loading="lazy" /></div>}
    <pre className="code-content" tabIndex={0}>
      {rows <= 400 && <span className="code-gutter" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => <span key={index}>{index + 1}</span>)}
      </span>}
      <code className="code-text" dangerouslySetInnerHTML={{ __html: highlighted || ' ' }} />
    </pre>
  </div>;
}
function MarkdownPreview({ markdown }: { markdown: string }) {
  const detected = useMemo(() => detectRawCode(markdown), [markdown]);
  if (!markdown.trim()) return <article className="markdown-preview"><p className="empty-preview">Nothing to preview.</p></article>;
  // Pasted source is shown as source. Markdown prose never gets a fabricated gutter.
  if (detected) return <article className="markdown-preview preview-is-code">
    <CodeBlock code={markdown} rawLanguage={detected} />
  </article>;
  return <article className="markdown-preview">
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, safeMarkdownHtml]]} components={{
      table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
      pre: ({ children }) => {
        const child = Array.isArray(children) ? children[0] : children;
        if (!child || typeof child !== 'object' || !('props' in child)) return <pre>{children}</pre>;
        const props = child.props as { className?: string; children?: unknown };
        const language = /language-([\w+#.-]+)/.exec(props.className ?? '')?.[1] ?? '';
        return <CodeBlock code={String(props.children ?? '').replace(/\n$/, '')} rawLanguage={language} />;
      },
      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      input: props => <input {...props} aria-label="Task" disabled />,
      img: props => <img {...props} loading="lazy" alt={props.alt || ''} />,
    }}>{markdown}</ReactMarkdown>
  </article>;
}
export default memo(MarkdownPreview);
