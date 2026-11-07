import { useEffect, useState } from 'react';
import { createCloudShare, queueSharedSync, readShareRecord, revokeCloudShare, shareUrl, type ShareRecord, type ShareStatus } from '../lib/sharing';
import type { FlowDocument } from '../lib/store';
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
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, busy]);
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
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { setError('Could not copy link. Select and copy it manually.'); }
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not stop sharing');
    } finally { setBusy(false); }
  }

  return <div className="dialog-backdrop share-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <section className="share-dialog" role="dialog" aria-modal="true"
      aria-labelledby="share-dialog-title" aria-describedby="share-dialog-description">
      <div className="dialog-header"><Icon name="link" size={17} />
        <button type="button" aria-label="Close sharing" disabled={busy} onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <h2 id="share-dialog-title">Share this page</h2>
      <p className="share-document-name">{title || 'Untitled'}</p>
      {!record ? <>
        <p id="share-dialog-description">
          To share this page, upload its Markdown to private cloud storage. Your page stays
          on this device until you enable sharing. Anyone with the link can view and copy
          the entire page, but cannot edit it.
        </p>
        <label className="share-consent">
          <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}
            disabled={busy} />
          <span>Host this page in the cloud</span>
        </label>
        <div className="dialog-actions">
          <button type="button" className="dialog-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="share-primary" disabled={!consent || busy}
            onClick={() => { void enable(); }}>{busy ? 'Uploading…' : 'Upload and create link'}</button>
        </div>
      </> : <>
        <p id="share-dialog-description" className="share-status">
          <Icon name="check" size={14} />
          {status === 'syncing' ? 'Syncing changes to cloud…' : status === 'error'
            ? 'Cloud sync failed. Your local page is safe.' : 'Hosted in the cloud · View only'}
        </p>
        <label className="share-link-label" htmlFor="share-link-input">Shareable link</label>
        <div className="share-link-row">
          <input id="share-link-input" value={link} readOnly onFocus={event => event.currentTarget.select()} />
          <button type="button" className="share-primary" onClick={() => { void copyLink(); }}>
            <Icon name={copied ? 'check' : 'copy'} size={15} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="share-description">Changes to this page sync in the background while the editor is open. Anyone with this link can read the updated Markdown.</p>
        <div className="share-footer">
          <button type="button" onClick={() => { void revoke(); }} disabled={busy}>Stop sharing</button>
          <button type="button" className="dialog-cancel" onClick={onClose} disabled={busy}>Done</button>
        </div>
      </>}
      {error && <p className="share-error" role="alert">{error}</p>}
    </section>
  </div>;
}
