import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import DialogFrame from './DialogFrame';
import { Icon } from './Icons';
import {
  isHtmlPage, publishHtml, queueSiteSync, readSiteRecord, revokeHtml, siteUrl, verifyHostedHtml,
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
  // A local syncedVersion cannot establish that a public link still works.
  // It is verified against the server before it becomes copyable.
  const [status, setStatus] = useState<SiteStatus>('syncing');
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const existing = readSiteRecord(documentId);
    if (!existing) return;
    let cancelled = false;
    const latest = getCurrent();
    if (!existing.id.startsWith('html-') && isHtmlPage(latest)) {
      // A legacy local record should receive a short /play/ URL even when
      // opened directly from Write mode (where auto-publish is not running).
      void publishHtml(latest!).then(nextRecord => {
        if (!cancelled) { setRecord(nextRecord); setStatus('syncing'); setVerified(false); }
      }).catch(cause => {
        if (!cancelled) { setStatus('error'); setError(String(cause)); }
      });
      return () => { cancelled = true; };
    }
    void verifyHostedHtml(existing.id).then(ok => {
      if (cancelled) return;
      const latest = getCurrent();
      if (!ok || (latest && existing.syncedVersion !== latest.updatedAt)) {
        setVerified(false);
        setStatus('syncing');
        if (isHtmlPage(latest)) queueSiteSync(latest!, true, !ok);
      } else {
        setVerified(true);
        setStatus('synced');
      }
    }).catch(() => {
      if (!cancelled) {
        setVerified(false);
        setStatus('error');
        setError('Could not verify the public link. Retry publishing.');
      }
    });
    return () => { cancelled = true; };
  }, [documentId]);

  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{
        documentId: string; status: SiteStatus; error?: string;
      }>).detail;
      if (detail?.documentId !== documentId) return;
      setRecord(readSiteRecord(documentId));
      setStatus(detail.status);
      if (detail.status === 'synced') setVerified(true);
      else setVerified(false);
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
      queueSiteSync(doc!, true, true);
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not publish HTML');
    } finally { setBusy(false); }
  }
  async function copy() {
    if (!record?.syncedVersion || !verified) return;
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
      setVerified(false);
      setStatus('syncing');
      setCopied(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not revoke site');
    } finally { setBusy(false); }
  }
  const published = Boolean(record?.syncedVersion && verified && status === 'synced');
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
