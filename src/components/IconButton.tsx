import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import type { ReactNode } from 'react';
export default function IconButton({ icon, title, onClick, active = false, children, disabled = false }: {
  icon: IconSvgElement; title: string; onClick: () => void; active?: boolean; children?: ReactNode; disabled?: boolean;
}) {
  return <button className={'icon-button' + (active ? ' is-active' : '')} title={title} aria-label={title}
    aria-pressed={active || undefined} type="button" onClick={onClick} disabled={disabled}>
    <HugeiconsIcon icon={icon} size={18} strokeWidth={1.65} />{children}
  </button>;
}
