import type { CSSProperties } from 'react';
import { FLOW_RIBBON_PATHS, FLOW_RIBBON_OPACITY } from '../lib/accentTheme';
import { phosphorMarkup, type IconName } from '../lib/phosphorGlyphs';
export type { IconName } from '../lib/phosphorGlyphs';

/** One vector mark across the workspace, Draw, public views and favicon. */
export function FlowMark({ size = 22, style }: { size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 26 26" fill="none"
    aria-hidden="true" style={style}>
    {FLOW_RIBBON_PATHS.map((d, index) => <path key={d} d={d}
      fill="currentColor" opacity={FLOW_RIBBON_OPACITY[index]} />)}
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
