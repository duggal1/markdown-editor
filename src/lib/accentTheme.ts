/** Palette identifiers shared by Flow and Draw. Colors live in CSS. */
export const ACCENT_THEMES = [
  { id: 'orange', label: 'Orange' },
  { id: 'green', label: 'Green' },
  { id: 'sky', label: 'Sky' },
  { id: 'purple', label: 'Purple' },
  { id: 'pink', label: 'Pink' },
  { id: 'teal', label: 'Teal' },
  { id: 'indigo', label: 'Indigo' },
  { id: 'rose', label: 'Rose' },
] as const;
export type AccentTheme = (typeof ACCENT_THEMES)[number]['id'];
export const DEFAULT_ACCENT: AccentTheme = 'purple';

export function parseAccentTheme(input: unknown): AccentTheme {
  return ACCENT_THEMES.find(item => item.id === input)?.id ?? DEFAULT_ACCENT;
}

const FAVICON_COLORS: Record<AccentTheme, string> = {
  orange: '#ea580c', green: '#16a34a', sky: '#0284c7', purple: '#9810fa',
  pink: '#db2777', teal: '#0d9488', indigo: '#4f46e5', rose: '#e11d48',
};

function updateFavicon(accent: AccentTheme): void {
  // Reuse the original Flow mark geometry, changing only its two accent fills.
  const fill = FAVICON_COLORS[accent];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none" shape-rendering="crispEdges">' +
    '<path d="M8 0H56V8H64V56H56V64H8V56H0V8H8Z" fill="' + fill + '"/>' +
    '<path d="M21 12H43V18H49V46H43V52H21V46H15V18H21V12ZM25 22V28H21V36H25V42H39V36H43V28H39V22H25Z" fill="#0a0a0a"/>' +
    '<path d="M29 29H35V35H29Z" fill="' + fill + '"/></svg>';
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  link.type = 'image/svg+xml';
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

export function applyAccentTheme(input: unknown): AccentTheme {
  const accent = parseAccentTheme(input);
  document.documentElement.dataset.accent = accent;
  updateFavicon(accent);
  return accent;
}
