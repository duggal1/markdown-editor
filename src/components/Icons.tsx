import type { CSSProperties } from 'react';

const BRAND = 'M 128 0 C 147.68 0 164.04 14.213 167.377 32.934 C 182.974 22.055 204.594 23.574 218.51 37.49 C 232.426 51.406 233.944 73.025 223.066 88.622 C 241.787 91.96 256 108.32 256 128 C 256 147.68 241.787 164.04 223.065 167.377 C 233.944 182.974 232.426 204.594 218.51 218.51 C 204.594 232.426 182.974 233.944 167.377 223.065 C 164.04 241.787 147.68 256 128 256 C 108.32 256 91.959 241.787 88.622 223.065 C 73.025 233.944 51.406 232.426 37.49 218.51 C 23.574 204.594 22.055 182.974 32.934 167.377 C 14.213 164.04 0 147.68 0 128 C 0 108.32 14.213 91.96 32.934 88.622 C 22.056 73.025 23.574 51.406 37.49 37.49 C 51.406 23.574 73.025 22.055 88.622 32.934 C 91.96 14.213 108.32 0 128 0 Z';
export function FlowMark({ size = 22, style }: { size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 256 256" fill="none" aria-hidden="true" style={style}>
    <path d={BRAND} fill="rgb(84, 84, 84)" />
  </svg>;
}

const glyphs = {
  sidebar: 'M3 4.5h18v15H3zM9 4.5v15',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm6-2 4.5 4.5',
  plus: 'M12 4v16M4 12h16',
  file: 'M6 3.5h8l4 4V21H6zM14 3.5v4h4M9 12h6M9 16h6',
  folder: 'M2.5 7a2 2 0 0 1 2-2h5l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z',
  back: 'M14.5 5 7.5 12l7 7M8 12h12',
  chevron: 'm9 6 6 6-6 6',
  download: 'M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3',
  upload: 'M12 17V5m-4 4 4-4 4 4M4 18v3h16v-3',
  moon: 'M20.4 14.5A8.8 8.8 0 0 1 9.5 3.6 8.9 8.9 0 1 0 20.4 14.5Z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  split: 'M3 4.5h18v15H3zM12 4.5v15',
  edit: 'M4 20h4l12-12-4-4L4 16v4ZM14.5 5.5l4 4',
  link: 'M10 13.5a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2M14 10.5a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.2-1.2',
  code: 'm8 8-4 4 4 4m8-8 4 4-4 4M14 4l-4 16',
  quote: 'M4 6h7v7l-4 5M14 6h7v7l-4 5',
  list: 'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01',
  todo: 'M3 4h18v16H3zM7 12l3 3 7-7',
  close: 'M5 5l14 14M19 5 5 19',
  trash: 'M4 7h16M10 4h4M6 7l1 14h10l1-14M10 10v7m4-7v7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8V3m0 5h5M12 7v5l3 2',
  copy: 'M8 8h12v13H8zM4 17V4h12',
  check: 'M4 12l5 5L20 6',
  bookmark: 'M5 3h14v19l-7-5-7 5z',
  svg: 'M4 4h16v16H4zM8 16l3-4 2 2 3-5 3 7',
  terminal: 'M4 5h16v14H4zM8 9l3 3-3 3m5 0h4',
} as const;
export type IconName = keyof typeof glyphs;
export function Icon({ name, size = 17, className = '' }: {
  name: IconName; size?: number; className?: string;
}) {
  return <svg className={className} aria-hidden="true" width={size} height={size}
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round"><path d={glyphs[name]} /></svg>;
}
