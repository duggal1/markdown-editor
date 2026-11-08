import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icons';

type DialogFrameProps = {
  id: string;
  title: string;
  icon: IconName;
  describedBy: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
};

/**
 * Native modal focus management, keyboard trapping and focus restoration.
 * Render in the top layer so editor, sidebar and menus cannot clip it.
 */
export default function DialogFrame({
  id, title, icon, describedBy, busy = false, onClose, children, footer,
}: DialogFrameProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return createPortal(
    <dialog ref={ref} className="flow-dialog"
      aria-labelledby={id + '-title'} aria-describedby={describedBy}
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onMouseDown={event => {
        if (event.target !== event.currentTarget || busy) return;
        // Native <dialog> sends backdrop presses to the dialog element.
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <header className="flow-dialog-header">
        <div className="flow-dialog-heading">
          <Icon name={icon} size={15} />
          <h2 id={id + '-title'}>{title}</h2>
        </div>
        <button type="button" className="flow-dialog-close"
          aria-label="Close dialog" disabled={busy} onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </header>
      <div className="flow-dialog-body">{children}</div>
      <footer className="flow-dialog-footer">{footer}</footer>
    </dialog>,
    document.body,
  );
}
