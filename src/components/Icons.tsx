import type { CSSProperties } from 'react';
import { phosphorMarkup, type IconName } from '../lib/phosphorGlyphs';
export type { IconName } from '../lib/phosphorGlyphs';

// The product mark remains original branding, not an invented icon set.
export function FlowMark({ size = 22, style }: { size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    shapeRendering="crispEdges" aria-hidden="true" style={style}>
    <path fill="currentColor" d="M5 2h14v3h3v14h-3v3H5v-3H2V5h3V2zm3 4v3H6v6h2v3h8v-3h2V9h-2V6H8z" />
    <rect x="10" y="10" width="4" height="4" fill="var(--brand-head, #fff)" />
  </svg>;
}


export function Icon({ name, size = 17, className = '', active = false }: {
  name: IconName; size?: number; className?: string; active?: boolean;
}) {
  return <span className={'pixel-huge-icon phosphor-icon' + (active ? ' is-active' : '') + (className ? ' ' + className : '')}
    aria-hidden="true" style={{ width: size, height: size }}
    dangerouslySetInnerHTML={{ __html: phosphorMarkup(name) }} />;
}

export type SuppliedIconKind = 'lock' | 'privacyLock' | 'websitePlaceholder' | 'noInternalLogo';
export function SuppliedIcon({ kind, size = 18, className = '' }: {
  kind: SuppliedIconKind; size?: number; className?: string;
}) {
  return <Icon name={kind === 'lock' || kind === 'privacyLock' ? 'lock' : kind === 'websitePlaceholder' ? 'globe' : 'globeOff'} size={size} className={className} />;
}
