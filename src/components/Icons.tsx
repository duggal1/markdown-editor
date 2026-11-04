import type { CSSProperties } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  SidebarLeft01Icon, Search01Icon, Add01Icon, File01Icon, Folder01Icon,
  ArrowLeft01Icon, ArrowRight01Icon, ChevronRightIcon, Download01Icon,
  Upload01Icon, Moon01Icon, Sun01Icon, ViewIcon, SidebarRight01Icon,
  Edit02Icon, Link01Icon, CodeIcon, QuoteUpIcon, ListViewIcon,
  CheckListIcon, Cancel01Icon, Delete02Icon, MoreHorizontalIcon,
  Clock01Icon, Copy01Icon, Tick01Icon, Bookmark01Icon, Image01Icon,
  TerminalIcon, Cursor01Icon, TextIcon, ArrowUpRight01Icon, ImageAdd01Icon,
  Undo02Icon, MagicWand01Icon, TextBoldIcon, TextItalicIcon,
} from '@hugeicons/core-free-icons';

// The product mark remains original branding, not an invented icon set.
export function FlowMark({ size = 22, style }: { size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    shapeRendering="crispEdges" aria-hidden="true" style={style}>
    <path fill="currentColor" d="M5 2h14v3h3v14h-3v3H5v-3H2V5h3V2zm3 4v3H6v6h2v3h8v-3h2V9h-2V6H8z" />
    <rect x="10" y="10" width="4" height="4" fill="var(--brand-head, #fff)" />
  </svg>;
}

// Every UI control uses the original Hugeicons vector geometry.
const glyphs = {
  sidebar: SidebarLeft01Icon, search: Search01Icon, plus: Add01Icon,
  file: File01Icon, folder: Folder01Icon,
  back: ArrowLeft01Icon, forward: ArrowRight01Icon, chevron: ChevronRightIcon,
  download: Download01Icon, upload: Upload01Icon,
  moon: Moon01Icon, sun: Sun01Icon, eye: ViewIcon, split: SidebarRight01Icon,
  edit: Edit02Icon, link: Link01Icon, code: CodeIcon, quote: QuoteUpIcon,
  list: ListViewIcon, todo: CheckListIcon, close: Cancel01Icon, trash: Delete02Icon,
  more: MoreHorizontalIcon, menu: ListViewIcon, history: Clock01Icon,
  copy: Copy01Icon, check: Tick01Icon, bookmark: Bookmark01Icon,
  svg: Image01Icon, terminal: TerminalIcon, cursor: Cursor01Icon,
  text: TextIcon, arrowUpRight: ArrowUpRight01Icon,
  imageAdd: ImageAdd01Icon, undo: Undo02Icon, format: MagicWand01Icon,
  bold: TextBoldIcon, italic: TextItalicIcon,
} as const;

export type IconName = keyof typeof glyphs;

/**
 * Subtle pixel treatment shared by Flow and Draw.
 *
 * Keep the original Hugeicons SVG as the only icon geometry. Square joins and
 * pixel-snapped edges echo the earlier Draw toolbar, without resampling an
 * icon onto a tiny bitmap (which destroyed detail at 14–16px).
 *
 * The sidebar control adds a restrained three-cell rail, making its function
 * clearer than the generic rectangle-with-divider glyph on its own.
 */
export function Icon({ name, size = 17, className = '', active = false }: {
  name: IconName; size?: number; className?: string; active?: boolean;
}) {
  return <span
    className={'pixel-huge-icon pixel-huge-icon-subtle' +
      (name === 'sidebar' ? ' pixel-sidebar-toggle' : '') +
      (className ? ' ' + className : '')}
    aria-hidden="true" style={{ width: size, height: size }}>
    <HugeiconsIcon icon={glyphs[name]} size={size} strokeWidth={active ? 1.9 : 1.65} />
  </span>;
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
