export const STORAGE_KEY = 'plain.document.v1';
export const DEFAULT_MARKDOWN = '';
export type DocumentState = { title: string; markdown: string; theme: 'light' | 'dark' };
export function restoreDocument(): DocumentState {
  const fallback: DocumentState = { title: 'Untitled', markdown: DEFAULT_MARKDOWN, theme: 'light' };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') {
        const value = parsed as Partial<DocumentState>;
        if (typeof value.title === 'string' && typeof value.markdown === 'string')
          return { title: value.title === 'Untitled document' ? 'Untitled' : value.title, markdown: value.markdown.startsWith('# A quieter place to think.\n\nThe best ideas deserve a little space. This is yours.') && value.markdown.includes('Less interface. More intention.') ? '' : value.markdown, theme: value.theme === 'dark' ? 'dark' : 'light' };
      }
    }
    return { ...fallback, theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' };
  } catch { return fallback; }
}
export function downloadMarkdown(markdown: string, title: string) {
  const filename = (title.trim() || 'untitled').replace(/[<>:"/\\|?*]/g, '-').slice(0, 90) + '.md';
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}
