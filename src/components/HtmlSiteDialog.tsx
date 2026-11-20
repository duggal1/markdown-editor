import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
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
  const motionOff = useReducedMotion();
  const press = { whileTap: motionOff ? undefined : { scale: 0.96 },
    whileHover: motionOff ? undefined : { y: -1 },
    transition: { type: 'spring' as const, stiffness: 470, damping: 32 } };
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
      {record && <motion.button {...press} type="button" className="flow-dialog-button flow-dialog-danger"
        disabled={busy} onClick={() => { void revoke(); }}>Stop hosting</motion.button>}
      <span className="flow-dialog-footer-spacer" />
      <motion.button {...press} type="button" className="flow-dialog-button flow-dialog-neutral"
        disabled={busy} onClick={onClose}>Done</motion.button>
      {(!published || status === 'error') && <motion.button {...press} type="button"
        className="flow-dialog-button flow-dialog-contrast" disabled={busy}
        onClick={() => { void publish(); }}>
        {busy ? 'Publishing…' : record ? 'Retry publish' : 'Publish'}
      </motion.button>}
    </>}>
    <div className="flow-dialog-file">
      <span className="flow-dialog-file-icon"><Icon name="code" size={16} /></span>
      <span className="flow-dialog-file-text">
        <strong title={title}>{title || 'Untitled HTML'}</strong>
        <small>Interactive HTML</small>
      </span>
      <span className="flow-dialog-readonly">Public link</span>
    </div>
    <span id="html-site-description" className="html-site-visually-hidden">
      Public HTML is accessible to anyone with the link.
    </span>
    {record && <p className="flow-dialog-status" data-status={status} role="status"
      aria-live="polite">
      <span className="flow-dialog-status-dot" aria-hidden="true" />
      {status === 'syncing' ? 'Updating…'
        : status === 'error' ? 'Upload failed'
          : 'Live'}
    </p>}
    {published && record && <>
      <label className="flow-dialog-label" htmlFor="html-site-url">Public link</label>
      <div className="flow-dialog-link">
        <input id="html-site-url" value={siteUrl(record.id)} readOnly
          onFocus={event => event.currentTarget.select()} />
        <motion.button {...press} type="button" className="flow-dialog-button flow-dialog-contrast"
          onClick={() => { void copy(); }}>
          <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy'}
        </motion.button>
      </div>

    </>}
    {error && <p className="flow-dialog-error" role="alert">{error}</p>}
  </DialogFrame>;
}
