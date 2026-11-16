import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { createCloudShare, queueSharedSync, readShareRecord, revokeCloudShare, shareUrl, type ShareRecord, type ShareStatus } from '../lib/sharing';
import type { FlowDocument } from '../lib/store';
import DialogFrame from './DialogFrame';
import { Icon } from './Icons';

export default function ShareDialog({ documentId, title, getCurrent, onClose }: {
  documentId: string;
  title: string;
  getCurrent: () => FlowDocument | null;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<ShareRecord | null>(() => readShareRecord(documentId));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ShareStatus>('synced');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const reducedMotion = useReducedMotion();
  const linkInputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId: string; status: ShareStatus }>).detail;
      if (detail?.documentId === documentId) {
        setStatus(detail.status);
        if (detail.status === 'synced') setRecord(readShareRecord(documentId));
      }
    };
    window.addEventListener('flow-share-sync', onStatus);
    return () => window.removeEventListener('flow-share-sync', onStatus);
  }, [documentId]);

  useEffect(() => {
    if (record) linkInputRef.current?.focus();
  }, [record?.id]);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const link = record ? shareUrl(record.id) : '';

  async function enable() {
    if (!consent || busy) return;
    const doc = getCurrent();
    if (!doc || doc.asset) { setError('This page cannot be shared as Markdown.'); return; }
    setBusy(true);
    setError('');
    try {
      const created = await createCloudShare(doc);
      setRecord(created);
      setStatus('synced');
      queueSharedSync(getCurrent() || doc);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cloud upload failed');
    } finally { setBusy(false); }
  }

  async function copyLink() {
    if (!link || busy) return;
    let successful = false;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(link);
      successful = true;
    } catch {
      const input = linkInputRef.current;
      if (input) {
        input.focus();
        input.select();
        try { successful = document.execCommand('copy'); }
        catch { successful = false; }
      }
    }
    if (!successful) {
      setError('Could not copy the link. Select and copy it manually.');
      return;
    }
    setError('');
    setCopied(true);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
  }

  async function revoke() {
    if (!record || busy) return;
    setBusy(true);
    setError('');
    try {
      await revokeCloudShare(documentId, record);
      setRecord(null);
      setConsent(false);
      setCopied(false);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not stop sharing');
    } finally { setBusy(false); }
  }

  return <DialogFrame id="share-dialog" title="Share page" icon="link"
    variant="share" describedBy="share-dialog-description" busy={busy} onClose={onClose}
    footer={!record ? (
      <motion.button type="button" className="flow-share-primary"
        disabled={!consent || busy} onClick={() => { void enable(); }}
        whileTap={reducedMotion ? undefined : { scale: 0.985 }}>
        {busy ? 'Creating link…' : 'Create link'}
      </motion.button>
    ) : (
      <>
        <button type="button" className="flow-share-revoke"
          disabled={busy} onClick={() => { void revoke(); }}>
          {busy ? 'Stopping sharing…' : 'Stop sharing'}
        </button>
        <button type="button" className="flow-share-done"
          disabled={busy} onClick={onClose}>Done</button>
      </>
    )}>
    <p id="share-dialog-description" className="flow-share-description">
      {record
        ? 'Anyone with this link can view and copy this page.'
        : 'Create a link anyone can use to view this page. Editing stays private.'}
    </p>

    <div className="flow-share-file">
      <span className="flow-share-file-icon"><Icon name="file" size={16} /></span>
      <span className="flow-share-file-name" title={title || 'Untitled'}>{title || 'Untitled'}</span>
      <span className="flow-share-file-access">View only</span>
    </div>

    {!record ? (
      <label className="flow-share-consent">
        <input type="checkbox" checked={consent} data-dialog-initial-focus
          onChange={event => setConsent(event.target.checked)} disabled={busy} />
        <span className="flow-share-consent-text">
          <strong>Upload to cloud</strong>
          <small>Only this page is uploaded when you create a link.</small>
        </span>
      </label>
    ) : (
      <div className="flow-share-link-section">
        <p className="flow-share-status" data-status={status} role="status" aria-live="polite">
          <span className="flow-share-status-dot" aria-hidden="true" />
          {status === 'syncing' ? 'Syncing changes…' : status === 'error'
            ? 'Sync failed. Your local page is safe.' : 'Link active · Read only'}
        </p>
        <label className="flow-share-label" htmlFor="share-link-input">Share link</label>
        <div className="flow-share-link-field">
          <Icon name="link" size={16} />
          <input id="share-link-input" ref={linkInputRef} value={link} readOnly
            data-dialog-initial-focus aria-label="Share link"
            onFocus={event => event.currentTarget.select()} />
        </div>
        <motion.button type="button" className="flow-share-primary flow-share-copy"
          disabled={busy} onClick={() => { void copyLink(); }}
          whileTap={reducedMotion ? undefined : { scale: 0.985 }}>
          <AnimatePresence initial={false} mode="wait">
            <motion.span key={copied ? 'copied' : 'copy'} className="flow-share-copy-label"
              initial={reducedMotion ? false : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -5 }}
              transition={{ duration: reducedMotion ? 0 : 0.14 }}>
              <Icon name={copied ? 'check' : 'copy'} size={16} />
              {copied ? 'Copied' : 'Copy link'}
            </motion.span>
          </AnimatePresence>
        </motion.button>
        <p className="flow-share-hint">Changes sync while this editor is open.</p>
      </div>
    )}
    {error && <p className="flow-share-error" role="alert">{error}</p>}
  </DialogFrame>;
}
