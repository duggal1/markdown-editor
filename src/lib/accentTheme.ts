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

// Ribbon F, vector reconstruction of the selected rebrand concept.
export const FLOW_RIBBON_PATHS = ["M7.3 13.8C7.1 9.2 8.8 6.1 13.1 5.2L23 2C22.5 5.6 20.7 8 17.4 9.1L10.8 11.2C8.7 11.9 7.6 12.8 7.3 13.8Z","M5.5 18.1C5.5 15.1 7.3 12.9 10.8 11.8L18.7 9.3C18.4 12.4 16.8 14.8 13.8 15.7L8.9 17.3C7.2 17.9 6 19.1 5.9 21C5.6 20.2 5.5 19.2 5.5 18.1Z","M5.9 21C5.9 19.4 7 18.3 8.9 17.6L11.2 16.8C10.8 20.2 9.4 22.4 7.7 22.5C6.8 22.5 6.1 21.9 5.9 21Z"] as const;
export const FLOW_RIBBON_OPACITY = [1, .84, .48] as const;

function updateFavicon(accent: AccentTheme): void {
  const fill = FAVICON_COLORS[accent];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 26 26">' +
    FLOW_RIBBON_PATHS.map((d, index) => '<path d="' + d + '" fill="' + fill +
      '" opacity="' + FLOW_RIBBON_OPACITY[index] + '"/>').join('') + '</svg>';
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
