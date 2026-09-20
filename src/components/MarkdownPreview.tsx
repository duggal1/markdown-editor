import { isValidElement, memo, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js';
import { Icon } from './Icons';

const aliases: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', sh: 'bash', shell: 'bash', rs: 'rust', yml: 'yaml',
  html: 'xml', svg: 'xml', 'c++': 'cpp', 'c#': 'csharp', md: 'markdown',
};
function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
  const code = String(child?.props.children ?? '').replace(/\n$/, '');
  const rawLanguage = /language-([\w+#.-]+)/.exec(child?.props.className ?? '')?.[1] ?? '';
  const language = aliases[rawLanguage.toLowerCase()] || rawLanguage.toLowerCase();
  const isSvg = rawLanguage.toLowerCase() === 'svg';
  const highlighted = useMemo(() => {
    if (code.length > 130000 || !language || !hljs.getLanguage(language)) return escapeHtml(code);
    try { return hljs.highlight(code, { language, ignoreIllegals: true }).value; }
    catch { return escapeHtml(code); }
  }, [code, language]);
  const rows = useMemo(() => code.split('\n').length, [code]);
  const svgDocument = useMemo(() => '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data: blob:; style-src &#39;unsafe-inline&#39;"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:transparent}svg{max-width:100%;max-height:100%;width:auto;height:auto}</style></head><body>' + code + '</body></html>', [code]);
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
      <button type="button" className="code-copy" onClick={() => { void copyCode(); }} aria-label={copied ? 'Copied' : 'Copy code'}><Icon name={copied ? 'check' : 'copy'} size={13} />{copied ? 'Copied' : 'Copy'}</button>
    </div>
    {isSvg && <div className="svg-preview"><iframe title="SVG preview" sandbox="" srcDoc={svgDocument} loading="lazy" /></div>}
    <pre className="code-content" tabIndex={0}>
      <span className="code-gutter" aria-hidden="true">{Array.from({ length: rows }, (_, index) => <span key={index}>{index + 1}</span>)}</span>
      <code className="code-text" dangerouslySetInnerHTML={{ __html: highlighted || ' ' }} />
    </pre>
  </div>;
}
function MarkdownPreview({ markdown }: { markdown: string }) {
  return <article className="markdown-preview">
    {markdown.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      input: props => <input {...props} aria-label="Task" disabled />,
      img: props => <img {...props} loading="lazy" alt={props.alt || ''} />,
    }}>{markdown}</ReactMarkdown> : <p className="empty-preview">Nothing to preview.</p>}
  </article>;
}
export default memo(MarkdownPreview);
