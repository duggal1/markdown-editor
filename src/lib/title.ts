import { detectRawCode } from './code';

const MAX_TITLE = 76;
const LABELS: Record<string, string> = {
  swift: 'Swift', typescript: 'TypeScript', ts: 'TypeScript', tsx: 'TypeScript',
  javascript: 'JavaScript', js: 'JavaScript', jsx: 'JavaScript',
  python: 'Python', py: 'Python', rust: 'Rust', rs: 'Rust', go: 'Go',
  json: 'JSON', css: 'CSS', html: 'HTML', xml: 'XML', svg: 'SVG',
  sql: 'SQL', bash: 'Bash', sh: 'Bash', shell: 'Bash',
  java: 'Java', kotlin: 'Kotlin', c: 'C', cpp: 'C++', csharp: 'C#',
  ruby: 'Ruby', rb: 'Ruby', php: 'PHP', yaml: 'YAML',
};

export function isUntitledTitle(title: string): boolean {
  return /^(?:untitled(?: document| page)?)?$/i.test(title.trim());
}

function cleanHeading(value: string): string {
  return value
    .replace(/\s+#+\s*$/, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[\x60*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE)
    .trim();
}

function codeTitle(language: string): string {
  const normalized = language.toLowerCase().replace(/^language-/, '');
  const name = LABELS[normalized] || normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return name + (normalized === 'json' || normalized === 'yaml' ? ' data' : ' code');
}

/**
 * Deterministic, local title inference. Inspect only the first 12KB, avoiding
 * full-document scans for huge plans. Existing manual titles are managed by
 * the caller, never overwritten here.
 *
 * Order: first Markdown heading (outside fences/frontmatter), Setext heading,
 * detected raw programming language, fenced-code language, first prose line.
 */
export function inferTitle(source: string, languageHint?: string | null): string {
  const head = source.slice(0, 12_000).replace(/^\uFEFF/, '');
  if (!head.trim()) return 'Untitled';

  const explicitCode = languageHint && languageHint !== 'markdown' && languageHint !== 'md'
    ? languageHint : null;
  if (explicitCode) return codeTitle(explicitCode);

  // Raw source code takes priority over accidental comment-like headings.
  const rawLanguage = detectRawCode(head);
  if (rawLanguage) return codeTitle(rawLanguage);

  const lines = head.split(/\r?\n/);
  let fence: { char: string; width: number } | null = null;
  let frontmatter = lines[0].trim() === '---';
  let firstFenceLanguage: string | null = null;
  let firstProse: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (frontmatter) {
      if (i > 0 && (trimmed === '---' || trimmed === '...')) frontmatter = false;
      continue;
    }
    const marker = /^ {0,3}(\x60{3,}|~{3,})([^\s\x60~]*)/.exec(line);
    if (marker) {
      if (!fence) {
        fence = { char: marker[1][0], width: marker[1].length };
        if (!firstFenceLanguage && marker[2]) firstFenceLanguage = marker[2];
      } else if (fence.char === marker[1][0] && marker[1].length >= fence.width &&
        !line.slice(marker[0].length).trim()) {
        fence = null;
      }
      continue;
    }
    if (fence || !trimmed || /^([-*_])\1{2,}\s*$/.test(trimmed)) continue;

    const atx = /^ {0,3}#{1,6}[ \t]+(.+)$/.exec(line);
    if (atx) {
      const title = cleanHeading(atx[1]);
      if (title) return title;
    }
    if (i + 1 < lines.length && /^ {0,3}(?:={3,}|-{3,})\s*$/.test(lines[i + 1]) &&
        !/^(?:[-*+]|\d+[.)]|>)\s/.test(trimmed)) {
      const title = cleanHeading(trimmed);
      if (title) return title;
    }
    if (!firstProse && !/^(?:[-*+]|\d+[.)]|>)\s/.test(trimmed) &&
        !/^(?:!\[|<|\x60|---$)/.test(trimmed)) {
      firstProse = cleanHeading(trimmed);
    }
  }

  if (firstFenceLanguage) return codeTitle(firstFenceLanguage);
  return firstProse || 'Untitled';
}
