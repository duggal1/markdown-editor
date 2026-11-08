import { useEffect, useState } from 'react';
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

  return <DialogFrame id="share-dialog" title="Share page" icon="link"
    describedBy="share-dialog-description" busy={busy} onClose={onClose}
    footer={!record ? <>
      <button type="button" className="flow-dialog-button flow-dialog-neutral"
        onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="flow-dialog-button flow-dialog-contrast"
        disabled={!consent || busy} onClick={() => { void enable(); }}>
        {busy ? 'Creating link…' : 'Create link'}
      </button>
    </> : <>
      <button type="button" className="flow-dialog-button flow-dialog-danger"
        disabled={busy} onClick={() => { void revoke(); }}>
        {busy ? 'Stopping sharing…' : 'Stop sharing'}
      </button>
      <span className="flow-dialog-footer-spacer" />
      <button type="button" className="flow-dialog-button flow-dialog-neutral"
        disabled={busy} onClick={onClose}>Done</button>
    </>}>
    <div className="flow-dialog-file">
      <span className="flow-dialog-file-icon"><Icon name="file" size={16} /></span>
      <span className="flow-dialog-file-text">
        <strong title={title || 'Untitled'}>{title || 'Untitled'}</strong>
        <small>Markdown page</small>
      </span>
      <span className="flow-dialog-readonly">View only</span>
    </div>

    {!record ? <>
      <p id="share-dialog-description" className="flow-dialog-copy">
        Create a private link to this page. Anyone with the link can read and copy
        its contents, but cannot edit it.
      </p>
      <label className="flow-dialog-consent">
        <input type="checkbox" checked={consent}
          onChange={event => setConsent(event.target.checked)}
          disabled={busy} data-dialog-initial-focus />
        <span>
          <strong>Upload to cloud</strong>
          <small>Only this page is uploaded when you create the link.</small>
        </span>
      </label>
    </> : <>
      <p id="share-dialog-description" className="flow-dialog-status"
        data-status={status} role="status" aria-live="polite">
        <span className="flow-dialog-status-dot" aria-hidden="true" />
        {status === 'syncing' ? 'Syncing changes…' : status === 'error'
          ? 'Sync failed. Your local page is safe.' : 'Link active · Read only'}
      </p>
      <label className="flow-dialog-label" htmlFor="share-link-input">Share link</label>
      <div className="flow-dialog-link">
        <input id="share-link-input" value={link} readOnly
          onFocus={event => event.currentTarget.select()} />
        <button type="button" className="flow-dialog-button flow-dialog-contrast"
          onClick={() => { void copyLink(); }}>
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="flow-dialog-hint">
        Changes sync while this editor is open. Anyone with the link can view the latest version.
      </p>
    </>}
    {error && <p className="flow-dialog-error" role="alert">{error}</p>}
  </DialogFrame>;
}
