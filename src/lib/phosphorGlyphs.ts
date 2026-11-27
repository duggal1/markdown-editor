// Flow's hand-authored 24-unit icon system. Static geometry only; no imported SVG pack or user markup.
const glyphs = {
  "fileJs": "M5 2.5h8l6 6v13H5z M13 2.5v6h6 M9 13v4q0 2-2 2 M14 13h3l-3 3h3v3h-3",
  "fileTs": "M5 2.5h8l6 6v13H5z M13 2.5v6h6 M7 13h5m-2.5 0v6 M14 13h3l-3 3h3v3h-3",
  "fileHtml": "M5 2.5h8l6 6v13H5z M13 2.5v6h6 M10 13l-3 3 3 3m4-6 3 3-3 3",
  "database": "M4 6c0-2 3.6-3.5 8-3.5S20 4 20 6s-3.6 3.5-8 3.5S4 8 4 6v12c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5V6 M4 12c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5",
  "sliders": "M3 7h5m4 0h9M3 17h9m4 0h5 M8 4v6m8 4v6",
  "desktop": "M3 4h18v13H3z M12 17v4m-4 0h8",
  "phone": "M7 2.5h10a1.5 1.5 0 011.5 1.5v16a1.5 1.5 0 01-1.5 1.5H7A1.5 1.5 0 015.5 20V4A1.5 1.5 0 017 2.5z M10 18.5h4",
  "tablet": "M5 2.5h14a1.5 1.5 0 011.5 1.5v16a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 20V4A1.5 1.5 0 015 2.5z M10 18.5h4",
  "caretDown": "m6 9 6 6 6-6",
  "refresh": "M20 11a8 8 0 10-2 6m2-12v6h-6",
  "maximize": "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6",
  "sidebar": "M3 4h18v16H3z M9 4v16",
  "search": "M15.6 15.6 21 21 M17.5 10.5a7 7 0 11-14 0 7 7 0 0114 0z",
  "plus": "M12 4v16M4 12h16",
  "file": "M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z",
  "folder": "M3 7V5h6l2 2h10v13H3z",
  "back": "M19 12H5m6-6-6 6 6 6",
  "forward": "M5 12h14m-6-6 6 6-6 6",
  "chevron": "m9 6 6 6-6 6",
  "download": "M12 3v12m-5-5 5 5 5-5 M4 17v4h16v-4",
  "upload": "M12 15V3m-5 5 5-5 5 5 M4 17v4h16v-4",
  "moon": "M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z",
  "sun": "M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2 M16.5 12a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z",
  "eye": "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z M14.5 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z",
  "split": "M3 4h18v16H3z M12 4v16",
  "edit": "m4 16 11-11 5 5L9 21H4z M12.5 7.5l5 5",
  "link": "M10 8l3-3a4.2 4.2 0 016 6l-3 3M14 16l-3 3a4.2 4.2 0 01-6-6l3-3m1 5 6-6",
  "code": "m8 6-6 6 6 6m8-12 6 6-6 6m-2-15-4 18",
  "quote": "M9 6H4v7h5c0 3-1 4-4 5 M20 6h-5v7h5c0 3-1 4-4 5",
  "list": "M8 6h13M8 12h13M8 18h13 M3 6h.1M3 12h.1M3 18h.1",
  "todo": "m3 6 2 2 3-4m-5 10 2 2 3-4 M11 7h10m-10 8h10",
  "close": "m6 6 12 12M18 6 6 18",
  "trash": "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  "more": "M5 12h.1M12 12h.1M19 12h.1",
  "menu": "M4 6h16M4 12h16M4 18h16",
  "history": "M3 11a9 9 0 119 10m-9-16v6h6 M12 7v5l4 2",
  "copy": "M8 8h12v13H8z M16 8V3H3v13h5",
  "check": "m5 12 4 4L19 6",
  "bookmark": "M6 3h12v18l-6-4-6 4z",
  "svg": "M3 4h18v16H3z M3 16l5-5 4 4 4-6 5 6M8 8h.1",
  "terminal": "M3 4h18v16H3z m4 5 4 3-4 3m6 0h4",
  "cursor": "m5 3 14 10-6 1-3 6z",
  "text": "M4 5h16M12 5v14m-4 0h8",
  "arrowUpRight": "M6 18 18 6M7 6h11v11",
  "imageAdd": "M3 4h18v16H3z M3 16l5-5 4 4m3-2h5m-2.5-2.5v5 M8 8h.1",
  "undo": "M8 4 3 9l5 5M3 9h10a7 7 0 010 14",
  "format": "m5 19 12-12 3 3L8 22z M15 9l3 3M6 3v6M3 6h6m10-4v3m-1.5-1.5h3",
  "bold": "M7 3h7a4.5 4.5 0 010 9H7zm0 9h8a4.5 4.5 0 010 9H7z",
  "italic": "M10 4h9M5 20h9M14 4 10 20",
  "settings": "M12 3 14 6l3.5-.2.7 3.4 3 2.8-3 2.8-.7 3.4L14 18l-2 3-2-3-3.5.2-.7-3.4-3-2.8 3-2.8.7-3.4L10 6z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  "lock": "M6 10h12v11H6z M9 10V7a3 3 0 016 0v3 M12 14v3",
  "globe": "M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm87.62,96H175.79C174,83.49,159.94,57.67,148.41,42.4A88.19,88.19,0,0,1,215.63,120ZM96.23,136h63.54c-2.31,41.61-22.23,67.11-31.77,77C118.45,203.1,98.54,177.6,96.23,136Zm0-16C98.54,78.39,118.46,52.89,128,43c9.55,9.93,29.46,35.43,31.77,77Zm11.36-77.6C96.06,57.67,82,83.49,80.21,120H40.37A88.19,88.19,0,0,1,107.59,42.4ZM40.37,136H80.21c1.82,36.51,15.85,62.33,27.38,77.6A88.19,88.19,0,0,1,40.37,136Zm108,77.6c11.53-15.27,25.56-41.09,27.38-77.6h39.84A88.19,88.19,0,0,1,148.41,213.6Z",
  "globeOff": "M4 4l16 16M20.5 15A9 9 0 009 3.5M15 20.5A9 9 0 013.5 9M3 12h9",
  "h1": "M3 5v14m9-14v14M3 12h9m4-3 3-2v12m-3 0h6",
  "h2": "M3 5v14m9-14v14M3 12h9m4-2a3 3 0 116 0c0 3-6 4-6 9h6",
  "h3": "M3 5v14m9-14v14M3 12h9m4-3h4l-2 4c5 0 5 6-2 6",
  "h4": "M3 5v14m9-14v14M3 12h9m7-5-4 7h7m-2-7v12",
  "number": "M3 4l2-1v5m-2 0h4M3 12c0-3 5-3 5 0 0 2-5 3-5 6h5M11 6h10m-10 10h10",
  "divider": "M4 12h16",
  "table": "M3 4h18v16H3z M3 9h18M3 14.5h18M9 4v16M15 4v16",
  "html": "M3 4h18v16H3z M3 8h18m6 4-3 3 3 3m6-6 3 3-3 3",
  "grip": "M9 5h.1M15 5h.1M9 12h.1M15 12h.1M9 19h.1M15 19h.1"
} as const;
export type IconName = keyof typeof glyphs;
export function phosphorMarkup(name: IconName): string {
  // User-supplied filled paths retain their native 256-unit geometry.
  if (name === 'file' || name === 'globe') {
    return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" width="100%" height="100%" viewBox="0 0 256 256"><path d="${glyphs[name]}" fill="currentColor"/></svg>`;
  }
  const weight = name === 'more' || name === 'grip' ? 2.8 : 1.65;
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" width="100%" height="100%" viewBox="0 0 24 24"><path d="${glyphs[name]}" fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
export function phosphorElement(name: IconName, size = 16): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = phosphorMarkup(name);
  const svg = template.content.querySelector('svg')!;
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  return svg;
}
