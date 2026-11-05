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
export const DEFAULT_ACCENT: AccentTheme = 'orange';

export function parseAccentTheme(input: unknown): AccentTheme {
  return ACCENT_THEMES.find(item => item.id === input)?.id ?? DEFAULT_ACCENT;
}

export function applyAccentTheme(input: unknown): AccentTheme {
  const accent = parseAccentTheme(input);
  document.documentElement.dataset.accent = accent;
  return accent;
}
