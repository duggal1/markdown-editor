import { useEffect, useState } from 'react';
import DialogFrame from './DialogFrame';
import { Icon } from './Icons';
import {
  isHtmlPage, publishHtml, queueSiteSync, readSiteRecord, revokeHtml, siteUrl,
  type SiteRecord, type SiteStatus,
} from '../lib/siteHosting';
import type { FlowDocument } from '../lib/store';

export default function HtmlSiteDialog({ documentId, title, getCurrent, onClose }: {
  documentId: string;
  title: string;
  getCurrent: () => FlowDocument | null;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<SiteRecord | null>(() => readSiteRecord(documentId));
  const [status, setStatus] = useState<SiteStatus>(() => {
    const previous = readSiteRecord(documentId);
    return previous?.syncedVersion ? 'synced' : 'syncing';
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{
        documentId: string; status: SiteStatus; error?: string;
      }>).detail;
      if (detail?.documentId !== documentId) return;
      setRecord(readSiteRecord(documentId));
      setStatus(detail.status);
      if (detail.error) setError(detail.error);
      else if (detail.status === 'synced') setError('');
    };
    window.addEventListener('flow-site-sync', onStatus);
    return () => window.removeEventListener('flow-site-sync', onStatus);
  }, [documentId]);

  async function publish() {
    const doc = getCurrent();
    if (!isHtmlPage(doc)) { setError('This page is not currently HTML. Stop sharing to remove the existing site.'); return; }
    setBusy(true);
    setStatus('syncing');
    setError('');
    try {
      const next = await publishHtml(doc!);
      setRecord(next);
      queueSiteSync(doc!, true);
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not publish HTML');
    } finally { setBusy(false); }
  }
  async function copy() {
    if (!record?.syncedVersion) return;
    try {
      await navigator.clipboard.writeText(siteUrl(record.id));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setError('Could not copy link. Select the URL and copy it manually.'); }
  }
  async function revoke() {
    setBusy(true);
    setError('');
    try {
      await revokeHtml(documentId);
      setRecord(null);
      setStatus('synced');
      setCopied(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not revoke site');
    } finally { setBusy(false); }
  }
  const published = Boolean(record?.syncedVersion);
  return <DialogFrame id="html-site-dialog" title="Publish HTML" icon="link"
    describedBy="html-site-description" busy={busy} onClose={onClose}
    footer={<>
      {record && <button type="button" className="flow-dialog-button flow-dialog-danger"
        disabled={busy} onClick={() => { void revoke(); }}>Stop hosting</button>}
      <span className="flow-dialog-footer-spacer" />
      <button type="button" className="flow-dialog-button flow-dialog-neutral"
        disabled={busy} onClick={onClose}>Done</button>
      {(!published || status === 'error') && <button type="button"
        className="flow-dialog-button flow-dialog-contrast" disabled={busy}
        onClick={() => { void publish(); }}>
        {busy ? 'Publishing…' : record ? 'Retry publish' : 'Publish'}
      </button>}
    </>}>
    <div className="flow-dialog-file">
      <span className="flow-dialog-file-icon"><Icon name="code" size={16} /></span>
      <span className="flow-dialog-file-text">
        <strong title={title}>{title || 'Untitled HTML'}</strong>
        <small>Interactive HTML · up to 10 MB</small>
      </span>
      <span className="flow-dialog-readonly">Public link</span>
    </div>
    <p id="html-site-description" className="flow-dialog-copy">
      Your HTML is hosted as an interactive page. Anyone with the link can run
      its scripts and access its public source. Updates publish automatically
      while the editor is open. Other Markdown pages remain local.
    </p>
    {record && <p className="flow-dialog-status" data-status={status} role="status"
      aria-live="polite">
      <span className="flow-dialog-status-dot" aria-hidden="true" />
      {status === 'syncing' ? 'Uploading HTML in the background…'
        : status === 'error' ? 'Upload failed · Local HTML is safe'
          : 'Site published · Link is live'}
    </p>}
    {published && record && <>
      <label className="flow-dialog-label" htmlFor="html-site-url">Public link</label>
      <div className="flow-dialog-link">
        <input id="html-site-url" value={siteUrl(record.id)} readOnly
          onFocus={event => event.currentTarget.select()} />
        <button type="button" className="flow-dialog-button flow-dialog-contrast"
          onClick={() => { void copy(); }}>
          <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="flow-dialog-hint">Routes continue under /slug/{record.id}/.</p>
    </>}
    {error && <p className="flow-dialog-error" role="alert">{error}</p>}
  </DialogFrame>;
}
