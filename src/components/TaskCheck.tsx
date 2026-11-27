import { memo } from 'react';

// Shared accessible, entirely custom visual control. No browser checkbox chrome.
export const TaskCheck = memo(function TaskCheck({ checked, onToggle, label, className = '', disabled = false }: {
  checked: boolean; onToggle: () => void; label: string; className?: string; disabled?: boolean;
}) {
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} disabled={disabled}
    className={'flow-task-check ' + className} onClick={onToggle}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect className="flow-task-box" x="1.25" y="1.25" width="13.5" height="13.5" rx="3.25" />
      <path className="flow-task-tick" d="m4.4 8 2.35 2.35 4.85-4.85" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  </button>;
});
