import { useEffect, useRef, useState } from 'react';
import MarkdownPreview from './MarkdownPreview';
import { FlowMark, Icon } from './Icons';
import { downloadMarkdown } from '../lib/document';
import { readPrefs } from '../lib/store';
import { MAX_CLOUD_BYTES } from '../lib/sharing';

type PublicPage = {
  title: string; markdown: string; language?: string; updatedAt: number;
};
type CloudManifest = Omit<PublicPage, 'markdown'> & {
  markdown?: string; urls?: string[]; bytes?: number; checksum?: string;
};
const id = window.location.pathname.split('/').filter(Boolean)[1] || '';

async function fetchPart(url: string, signal: AbortSignal, index: number): Promise<ArrayBuffer> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store', signal });
      if (response.ok) return response.arrayBuffer();
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
        throw new Error('Could not download part ' + (index + 1));
      }
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof Error && error.message.startsWith('Could not download')) throw error;
    }
    if (attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 350 * 2 ** attempt));
    }
  }
  throw new Error('Cloud download failed for part ' + (index + 1));
}

async function fetchPage(signal: AbortSignal, onProgress: (percent: number) => void): Promise<PublicPage> {
  const response = await fetch('/api/share?id=' + encodeURIComponent(id), {
    cache: 'no-store', signal,
  });
  if (!response.ok) throw new Error(response.status === 404
    ? 'This link does not exist or sharing has been disabled.'
    : 'The shared page could not be loaded.');
  const manifest = await response.json() as CloudManifest;
  if (typeof manifest.markdown === 'string') return manifest as PublicPage;
  if (!Array.isArray(manifest.urls) || !manifest.urls.length || manifest.urls.length > 100 ||
      !manifest.urls.every(url => typeof url === 'string' && (url.startsWith('https://') || url.startsWith('/api/storage?ticket='))) ||
      !Number.isSafeInteger(manifest.bytes) || manifest.bytes! < 0 ||
      manifest.bytes! > MAX_CLOUD_BYTES || !/^[a-f0-9]{64}$/.test(manifest.checksum || '')) {
    throw new Error('Cloud returned an invalid document');
  }
  const parts: ArrayBuffer[] = new Array(manifest.urls.length);
  let cursor = 0;
  let finished = 0;
  await Promise.all(Array.from({ length: Math.min(4, manifest.urls.length) }, async () => {
    while (cursor < manifest.urls!.length) {
      const index = cursor++;
      parts[index] = await fetchPart(manifest.urls![index], signal, index);
      finished++;
      if (!signal.aborted) onProgress(Math.round(finished / manifest.urls!.length * 100));
    }
  }));
  if (signal.aborted) throw new Error('Download cancelled');
  const totalBytes = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (totalBytes !== manifest.bytes) throw new Error('Cloud document is incomplete');
  const bytes = await new Blob(parts).arrayBuffer();
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== manifest.checksum) throw new Error('Cloud document failed integrity verification');
  const markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { title: manifest.title, markdown, language: manifest.language,
    updatedAt: manifest.updatedAt };
}

export default function SharedPage() {
  const [page, setPage] = useState<PublicPage | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const theme = readPrefs().theme === 'light' ? 'light' : 'dark';
  useEffect(() => {
    const controller = new AbortController();
    void fetchPage(controller.signal, setProgress)
      .then(data => {
        if (controller.signal.aborted) return;
        setPage(data);
        document.title = data.title + ' · Flow';
      })
      .catch(cause => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Page unavailable');
        }
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
    </section> : !page ? <div className="shared-empty" role="status">
        {progress > 0 ? 'Downloading shared page… ' + progress + '%' : 'Loading shared page…'}
      </div>
      : <div className="shared-scroll" ref={scrollRef}>
          <div className="shared-document">
            <h1 className="shared-title">{page.title}</h1>
            <MarkdownPreview markdown={page.markdown} sourceLanguage={page.language}
              theme={theme} scrollRef={scrollRef} />
          </div>
        </div>}
  </main>;
}
