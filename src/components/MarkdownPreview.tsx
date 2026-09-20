import { isValidElement, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import rust from 'highlight.js/lib/languages/rust';
import { HugeiconsIcon } from '@hugeicons/react';
import { Copy01Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('rust', rust);
const aliases: Record<string, string> = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'bash', shell: 'bash', html: 'xml', svg: 'xml', rs: 'rust' };
function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
  const code = String(child?.props.children ?? '').replace(/\n$/, '');
  const rawLanguage = /language-([\w-]+)/.exec(child?.props.className ?? '')?.[1] ?? '';
  const language = aliases[rawLanguage] ?? rawLanguage;
  const lines = code.split('\n');
  let highlightedHtml = escapeHtml(code);
  if (language && hljs.getLanguage(language)) {
    try { highlightedHtml = hljs.highlight(code, { language, ignoreIllegals: true }).value; }
    catch { /* Keep escaped fallback for unrecognized grammar. */ }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setCopied(false); }
  }
  return <div className="code-block">
    <div className="code-header"><span>{rawLanguage || 'plain text'}</span><button aria-label="Copy code" className="code-copy" type="button" onClick={() => void copy()}>
      <HugeiconsIcon icon={copied ? CheckmarkCircle02Icon : Copy01Icon} size={15} strokeWidth={1.7} />
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button></div>
    <pre className="code-content" tabIndex={0}><span className="code-gutter" aria-hidden="true">{lines.map((_, index) => <span className="gutter-line" key={index}>{index + 1}</span>)}</span><code className="code-text" dangerouslySetInnerHTML={{ __html: highlightedHtml || ' ' }} /></pre>
  </div>;
}
export default function MarkdownPreview({ markdown }: { markdown: string }) {
  return <article className="markdown-preview">
    {markdown.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    }}>{markdown}</ReactMarkdown> : <p className="empty-preview">Your words will appear here.</p>}
  </article>;
}
