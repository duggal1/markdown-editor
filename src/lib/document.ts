export const STORAGE_KEY = 'plain.document.v1';
export const DEFAULT_MARKDOWN = [
  '# A quieter place to think.',
  '',
  'The best ideas deserve a little space. This is yours.',
  '',
  'Write in **Markdown**. Keep the structure, lose the noise. Switch to Preview to see the finished page.',
  '',
  '## The essentials',
  '',
  '- Everything saves automatically, right here in your browser.',
  '- Paste Markdown directly. What you write is what you keep.',
  '- Bring a .md file in, or download one when you leave.',
  '',
  '## Code, beautifully considered',
  '',
  '~~~typescript',
  'type Thought = {',
  '  idea: string;',
  '  complete: boolean;',
  '};',
  '',
  'const write = (idea: string): Thought => ({',
  '  idea,',
  '  complete: false,',
  '});',
  '~~~',
  '',
  '> Less interface. More intention.',
].join('\n');
export type DocumentState = { title: string; markdown: string; theme: 'light' | 'dark' };
export function restoreDocument(): DocumentState {
  const fallback: DocumentState = { title: 'Untitled document', markdown: DEFAULT_MARKDOWN, theme: 'light' };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') {
        const value = parsed as Partial<DocumentState>;
        if (typeof value.title === 'string' && typeof value.markdown === 'string')
          return { title: value.title, markdown: value.markdown, theme: value.theme === 'dark' ? 'dark' : 'light' };
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
