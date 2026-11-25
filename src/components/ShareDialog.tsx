import { useEffect, useRef, useState } from 'react';
import { createCloudShare, queueSharedSync, readShareRecord, revokeCloudShare, shareUrl, type ShareRecord, type ShareStatus } from '../lib/sharing';
import { backupEnabled } from '../lib/backup';
import type { FlowDocument } from '../lib/store';
import DialogFrame from './DialogFrame';
import { Icon } from './Icons';

export default function ShareDialog({ documentId, title, getCurrent, onClose }: {
  documentId: string; title: string; getCurrent: () => FlowDocument | null; onClose: () => void;
}) {
  const [record, setRecord] = useState<ShareRecord | null>(() => readShareRecord(documentId));
  const [consent, setConsent] = useState(false);
  const backedUp = backupEnabled();
  const attempted = useRef(false);
  const inFlight = useRef(false);
  const [operation, setOperation] = useState<'create' | 'revoke' | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<ShareStatus>('synced');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  const busy = operation !== null;
  const link = record ? shareUrl(record.id) : '';

  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId: string; status: ShareStatus; progress?: number }>).detail;
      if (detail?.documentId !== documentId) return;
      setStatus(detail.status);
      setProgress(typeof detail.progress === 'number' ? detail.progress : null);
      if (detail.status === 'synced') setRecord(readShareRecord(documentId));
    };
    window.addEventListener('flow-share-sync', onStatus);
    return () => {
      window.removeEventListener('flow-share-sync', onStatus);
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
    };
  }, [documentId]);

  async function enable() {
    if ((!consent && !backedUp) || inFlight.current) return;
    const doc = getCurrent();
    if (!doc || doc.asset) { setError('Only text pages can be shared.'); return; }
    inFlight.current = true;
    setOperation('create');
    setProgress(null);
    setError('');
    try {
      const created = await createCloudShare(doc, setProgress);
      setRecord(created);
      setStatus('synced');
      queueSharedSync(getCurrent() || doc);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create link. Try again.');
    } finally { inFlight.current = false; setOperation(null); }
  }
  useEffect(() => {
    if (backedUp && !record && !attempted.current) {
      attempted.current = true;
      void enable();
    }
  }, [backedUp, record]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setError('');
      setCopied(true);
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch { setError('Could not copy link. Select and copy it manually.'); }
  }

  async function revoke() {
    if (!record || inFlight.current) return;
    inFlight.current = true;
    setOperation('revoke');
    setError('');
    try {
      await revokeCloudShare(documentId, record);
      setRecord(null);
      setConsent(false);
      setCopied(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not stop sharing');
    } finally { inFlight.current = false; setOperation(null); }
  }

  return <DialogFrame id="share-dialog" title="Share page" icon="link"
    describedBy="share-dialog-description" busy={operation === 'revoke'} onClose={onClose}
    footer={<>
      {record && <button className="share-revoke" type="button" disabled={busy} onClick={() => { void revoke(); }}>
        {operation === 'revoke' ? 'Stopping…' : 'Stop sharing'}
      </button>}
      <span className="flow-dialog-footer-spacer" />
      <button type="button" className="share-done" onClick={onClose} disabled={operation === 'revoke'}>Done</button>
    </>}>
    <div className="share-access">
      <Icon name="globe" size={17} />
      <div className="share-access-text">
        <strong>{record ? 'Anyone with the link' : 'Share a read-only link'}</strong>
        <p id="share-dialog-description">{record ? 'Can view · Cannot edit' : 'Only this page will be visible to link holders.'}</p>
      </div>
    </div>
    {record ? <>
      <div className="share-url-row">
        <Icon name="link" size={16} />
        <input aria-label="Share link" value={link} title={link} spellCheck={false} readOnly onFocus={event => event.currentTarget.select()} />
        <button type="button" className="share-copy" aria-label={copied ? 'Copied' : 'Copy link'} onClick={() => { void copyLink(); }} disabled={busy}>
          <span className="share-copy-labels" data-copied={copied} aria-hidden="true">
            <span className="share-copy-idle">Copy link</span>
            <span className="share-copy-success"><Icon name="check" size={14} />Copied</span>
          </span>
          <span className="settings-sr-only" role="status">{copied ? 'Copied' : 'Copy link'}</span>
        </button>
      </div>
      <p className="share-status" role="status" aria-live="polite">
        {status === 'syncing' ? 'Syncing changes' + (progress === null ? '…' : ' · ' + progress + '%') : status === 'error'
          ? 'Sync failed. Your local page is safe.' : 'Changes sync while Flow is open.'}
      </p>
    </> : <>
      {!backedUp && <label className="share-consent">
        <span className="share-consent-control">
          <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} data-dialog-initial-focus />
          <span className="share-consent-mark" aria-hidden="true"><Icon name="check" size={12} /></span>
        </span>
        <span>Upload to cloud</span>
      </label>}
      <button type="button" className="share-create" disabled={busy || (!backedUp && !consent)} onClick={() => { void enable(); }}>
        {operation === 'create' ? <span className="share-spinner" aria-hidden="true" /> : <Icon name="link" size={16} />}
        {operation === 'create' ? 'Creating link…' : error ? 'Retry' : 'Create link'}
      </button>
      {operation === 'create' && <p className="share-status" role="status">
        {progress !== null && progress < 100 ? 'Uploading · ' + progress + '%' : 'Checking cloud copy…'} You can close this window.
      </p>}
    </>}
    {error && <p className="share-error" role="alert">{error}</p>}
    <span className="settings-sr-only">{title}</span>
  </DialogFrame>;
}
