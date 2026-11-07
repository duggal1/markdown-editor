import { useEffect, useRef, useState } from 'react';
import MarkdownPreview from './MarkdownPreview';
import { FlowMark, Icon } from './Icons';
import { downloadMarkdown } from '../lib/document';
import { readPrefs } from '../lib/store';

type PublicPage = { title: string; markdown: string; language?: string; updatedAt: number };
const id = window.location.pathname.split('/').filter(Boolean)[1] || '';

export default function SharedPage() {
  const [page, setPage] = useState<PublicPage | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const theme = readPrefs().theme === 'light' ? 'light' : 'dark';
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/share?id=' + encodeURIComponent(id), { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 404
          ? 'This link does not exist or sharing has been disabled.'
          : 'The shared page could not be loaded.');
        return response.json() as Promise<PublicPage>;
      })
      .then(data => { setPage(data); document.title = data.title + ' · Flow'; })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Page unavailable');
      });
    return () => controller.abort();
  }, []);
  async function copyMarkdown() {
    if (!page) return;
    try {
      await navigator.clipboard.writeText(page.markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setError('Could not copy Markdown. Try downloading it instead.'); }
  }
  return <main className="shared-page">
    <header className="shared-topbar">
      <a className="shared-brand" href="/" aria-label="Open Flow editor"><FlowMark size={23} /> Flow</a>
      <span className="shared-readonly"><Icon name="eye" size={15} /> View only</span>
      {page && <div className="shared-actions">
        <button type="button" onClick={() => { void copyMarkdown(); }}>
          <Icon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copied' : 'Copy Markdown'}
        </button>
        <button type="button" onClick={() => downloadMarkdown(page.markdown, page.title)}>
          <Icon name="download" size={15} /> Download
        </button>
      </div>}
    </header>
    {error ? <section className="shared-empty" role="alert">
      <h1>Page unavailable</h1><p>{error}</p><a href="/">Open Flow</a>
    </section> : !page ? <div className="shared-empty" role="status">Loading shared page…</div>
      : <div className="shared-scroll" ref={scrollRef}>
          <div className="shared-document">
            <h1 className="shared-title">{page.title}</h1>
            <MarkdownPreview markdown={page.markdown} sourceLanguage={page.language}
              theme={theme} scrollRef={scrollRef} />
          </div>
        </div>}
  </main>;
}
