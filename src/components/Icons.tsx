import type { CSSProperties } from 'react';

// Pixel-locked aperture: every edge uses exact SVG integer coordinates.
export function FlowMark({ size = 22, style }: { size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    shapeRendering="crispEdges" aria-hidden="true" style={style}>
    <path fill="currentColor" d="M5 2h14v3h3v14h-3v3H5v-3H2V5h3V2zm3 4v3H6v6h2v3h8v-3h2V9h-2V6H8z" />
    <rect x="10" y="10" width="4" height="4" fill="var(--brand-head, #fff)" />
  </svg>;
}

const glyphs = {
  sidebar: 'M3 4H21V20H3ZM9 4V20',
  search: 'M6 4H14V6H17V9H19V14H17V17H14V19H6V17H3V14H2V9H3V6H6ZM17 17H19V19H21V21H23',
  plus: 'M11 3V11H3V13H11V21H13V13H21V11H13V3Z',
  file: 'M6 3H14L19 8V21H6ZM14 3V8H19M9 12H16M9 16H16',
  folder: 'M3 6H10V8H21V19H3Z',
  back: 'M12 4H10V6H8V8H6V10H4V14H6V16H8V18H10V20H12M4 12H21',
  forward: 'M12 4H14V6H16V8H18V10H20V14H18V16H16V18H14V20H12M3 12H20',
  chevron: 'M9 5H11V7H13V9H15V11H17V13H15V15H13V17H11V19H9',
  download: 'M11 3V14H8V12H6V14H8V16H10V18H14V16H16V14H18V12H16V14H13V3ZM4 19V21H20V19',
  upload: 'M11 21V10H8V12H6V10H8V8H10V6H14V8H16V10H18V12H16V10H13V21ZM4 3V5H20V3',
  moon: 'M17 3V6H13V9H11V14H13V17H17V19H11V17H7V15H5V11H3V9H5V6H8V4H11V3',
  sun: 'M10 8H14V10H16V14H14V16H10V14H8V10H10ZM11 2V5M11 19V22M2 11H5M19 11H22M4 4H6V6M17 17H19V19M4 18H6V16M17 6H19V4',
  eye: 'M2 11H4V9H6V7H9V6H15V7H18V9H20V11H22V13H20V15H18V17H15V18H9V17H6V15H4V13H2ZM10 10H14V14H10Z',
  split: 'M3 4H21V20H3ZM12 4V20',
  edit: 'M3 18H5V16H7V14H9V12H11V10H13V8H15V6H17V4H20V7H18V9H16V11H14V13H12V15H10V17H8V19H3Z',
  link: 'M9 7H6V9H4V15H6V17H10V15H12M15 7H18V9H20V15H18V17H14V15H12M8 12H16',
  code: 'M9 6H7V8H5V10H3V14H5V16H7V18H9M15 6H17V8H19V10H21V14H19V16H17V18H15M14 4L10 20',
  quote: 'M4 5H10V11H8V15H5V18M13 5H19V11H17V15H14V18',
  list: 'M4 6H6V8H4ZM10 7H21M4 11H6V13H4ZM10 12H21M4 16H6V18H4ZM10 17H21',
  todo: 'M3 4H21V20H3ZM7 12H9V14H11V12H13V10H16',
  close: 'M4 4H6V6H8V8H10V10H14V8H16V6H18V4H20M10 14H14M4 20H6V18H8V16H10V14M14 14H16V16H18V18H20V20',
  trash: 'M4 6H20M9 4H15M6 7V20H18V7M10 10V17M14 10V17',
  more: 'M4 11H6V13H4ZM11 11H13V13H11ZM18 11H20V13H18Z',
  menu: 'M4 6H20M4 12H20M4 18H20',
  history: 'M7 5H17V7H20V10H22V16H20V19H17V21H8V19H5V16H3V9H5V6H7M3 3V9H9M12 8V13H16',
  copy: 'M8 7H20V21H8ZM4 17V3H16',
  check: 'M4 12H6V14H8V16H10V14H12V12H14V10H16V8H18V6H20',
  bookmark: 'M6 3H18V21H16V19H14V17H10V19H8V21H6Z',
  svg: 'M3 4H21V20H3ZM7 16L10 12L13 15L16 10L19 16',
  terminal: 'M3 4H21V20H3ZM7 9H9V11H11V13H9V15H7M13 15H18',
  cursor: 'M5 3V19H8V15H11V17H13V15H11V13H14V11H12V9H10V7H8V5H6',
  text: 'M3 4H21V8H19V6H13V20H16V22H8V20H11V6H5V8H3Z',
  arrowUpRight: 'M6 18L18 6M10 6H18V14',
  imageAdd: 'M3 5H15V8M15 15V20H3V5M6 16L9 12L12 15M19 3V11M15 7H23',
  undo: 'M10 4H7V6H5V8H3V12H5V14H7V11H17V13H19V17H17V19H11M3 10H10',
  format: 'M4 4H20M4 9H15M4 14H20M4 19H13M17 17H19V19H21V21H19V23H17V21H15V19H17Z',
} as const;
export type IconName = keyof typeof glyphs;
export function Icon({ name, size = 17, className = '' }: {
  name: IconName; size?: number; className?: string;
}) {
  return <svg className={className} aria-hidden="true" width={size} height={size}
    viewBox="0 0 24 24" shapeRendering="crispEdges" fill="none"
    stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="square" strokeLinejoin="miter"><path d={glyphs[name]} /></svg>;
}

/**
 * User-provided exact SVGs. Their paint inherits currentColor, which means
 * browser chrome and previews can use the same shapes in either theme.
 */
export type SuppliedIconKind = 'lock' | 'privacyLock' | 'websitePlaceholder' | 'noInternalLogo';
export function SuppliedIcon({ kind, size = 18, className = '' }: {
  kind: SuppliedIconKind; size?: number; className?: string;
}) {
  if (kind === 'lock' || kind === 'privacyLock') {
    return <svg aria-hidden="true" className={className} width={size} height={size}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round">
      {kind === 'lock' ? <>
        <path d="M7.5 10V7a4.5 4.5 0 0 1 9 0v3" />
        <rect x="5.5" y="10" width="13" height="11" rx="0.25" />
      </> : <>
        <path d="M7.5 9V6.5a4.5 4.5 0 0 1 9 0V9" />
        <rect x="4" y="9" width="16" height="13" rx="0.3" />
        <circle cx="8" cy="15.5" r="0.25" />
        <circle cx="12" cy="15.5" r="0.25" />
        <circle cx="16" cy="15.5" r="0.25" />
      </>}
    </svg>;
  }
  const website = "M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm88,104a87.61,87.61,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.61,87.61,0,0,1,216,128ZM102,168H154a115.11,115.11,0,0,1-26,45A115.27,115.27,0,0,1,102,168Zm-3.9-16a140.84,140.84,0,0,1,0-48h59.88a140.84,140.84,0,0,1,0,48ZM40,128a87.61,87.61,0,0,1,3.33-24H81.84a157.44,157.44,0,0,0,0,48H43.33A87.61,87.61,0,0,1,40,128ZM154,88H102a115.11,115.11,0,0,1,26-45A115.27,115.27,0,0,1,154,88Zm52.33,0H170.71a135.28,135.28,0,0,0-22.3-45.6A88.29,88.29,0,0,1,206.37,88ZM107.59,42.4A135.28,135.28,0,0,0,85.29,88H49.63A88.29,88.29,0,0,1,107.59,42.4ZM49.63,168H85.29a135.28,135.28,0,0,0,22.3,45.6A88.29,88.29,0,0,1,49.63,168Zm98.78,45.6a135.28,135.28,0,0,0,22.3-45.6h35.66A88.29,88.29,0,0,1,148.41,213.6Z";
  const unavailable = "M128,24a104,104,0,0,0,0,208,8,8,0,0,0,5-14.23h0c-1.12-.91-20.88-17.32-31.06-49.77h26a8,8,0,0,0,0-16H98.08a140.17,140.17,0,0,1,0-48h59.88A138,138,0,0,1,160,128a8,8,0,0,0,16,0,154.7,154.7,0,0,0-1.84-24h38.51A87.61,87.61,0,0,1,216,128a8,8,0,0,0,16,0A104.11,104.11,0,0,0,128,24ZM107.59,42.4A135.28,135.28,0,0,0,85.29,88H49.63A88.29,88.29,0,0,1,107.59,42.4Zm0,171.2a88.29,88.29,0,0,1-58-45.6H85.29A135.28,135.28,0,0,0,107.59,213.6ZM81.84,152H43.33a88.15,88.15,0,0,1,0-48H81.84a157.44,157.44,0,0,0,0,48ZM102,88a115.11,115.11,0,0,1,26-45,115.27,115.27,0,0,1,26,45Zm68.75,0a135.28,135.28,0,0,0-22.3-45.6,88.29,88.29,0,0,1,58,45.6Zm50.95,85.66L203.31,192l18.35,18.34a8,8,0,0,1-11.32,11.32L192,203.31l-18.34,18.35a8,8,0,0,1-11.32-11.32L180.69,192l-18.35-18.34a8,8,0,0,1,11.32-11.32L192,180.69l18.34-18.35a8,8,0,0,1,11.32,11.32Z";
  return <svg aria-hidden="true" className={className} width={size} height={size}
    fill="currentColor" viewBox="0 0 256 256"><path d={kind === 'websitePlaceholder' ? website : unavailable} /></svg>;
}
