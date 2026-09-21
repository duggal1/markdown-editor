import { looksLikeHtml } from './htmlPreview';

export type CodeLanguage = 'swift' | 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'json' | 'css' | 'xml' | 'svg' | 'html' | 'sql' | 'bash';

export function detectRawCode(source: string): CodeLanguage | null {
  const text = source.trim();
  if (!text || text.length < 16) return null;
  const head = text.slice(0, 12000);
  // Recognize complete HTML documents before scanning for Markdown-like lines
  // inside <style>, <script>, or HTML text nodes.
  if (looksLikeHtml(head)) return 'html';
  // Ordinary Markdown, including fenced code, should stay Markdown.
  if (/^\s*`{3,}/m.test(head) || /^\s*#{1,6}\s+(?!Preview\b)/m.test(head)
      || /^\s*[-*+]\s+\S/m.test(head) || /^\s*>\s+\S/m.test(head)) return null;
  if (/(?:^|\n)\s*(?:#Preview\b|import\s+SwiftUI\b|struct\s+\w+\s*:\s*View\b|\bCGPoint\s*\(|\bPath\s*\{|\b\.preferredColorScheme\s*\()/m.test(head)
      || (head.includes('func ') && head.includes('let ') && /\b(?:var|struct|class)\b/.test(head))) return 'swift';
  if (/^\s*[{[]/.test(head)) {
    try { JSON.parse(text); return 'json'; } catch { /* more likely code */ }
  }
  if (/^\s*(?:import\s+\w+|from\s+\w+\s+import|def\s+\w+\s*\(|class\s+\w+\s*:)/m.test(head)
      && /:\s*(?:\n|#)|\bself\.|\bprint\(/.test(head)) return 'python';
  if (/\bfn\s+\w+\s*\(|\blet\s+mut\s+\w+|\bimpl\s+\w+\s*\{/.test(head)) return 'rust';
  if (/\bpackage\s+main\b|\bfunc\s+main\s*\(\)|\bimport\s*\(\s*"/.test(head)) return 'go';
  if (/\b(?:interface|type)\s+\w+\s*[={<]|:\s*(?:string|number|boolean|unknown|never)\b/.test(head)) return 'typescript';
  if (/^\s*(?:(?:export|default|async)\s+)*(?:function\s+[\w$]+|(?:const|let|var)\s+[\w$]+\s*=|class\s+[\w$]+|import\s+[^\n]+\s+from\s*['"])/m.test(head)
      && /(?:\{|=>|\breturn\b|;)/.test(head)) return 'javascript';
  if (/\b(?:const|let|function|export|import)\b/.test(head)
      && /(?:=>|console\.|\breturn\b|from\s*['"]|;\s*(?:\n|$))/.test(head)) return 'javascript';
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(head)) return 'svg';
  if (/^\s*<\?xml\b|^\s*<(?:html|div|span|section)\b/i.test(head)) return 'xml';
  if (/\bSELECT\b[\s\S]*\bFROM\b|\bCREATE\s+TABLE\b/i.test(head)) return 'sql';
  if (head.startsWith('#!/bin/sh') || head.startsWith('#!/bin/bash') || /^\s*(?:\$\s+\w+|(?:npm|git|curl|brew)\s+\w+)/m.test(head)) return 'bash';
  if (/^\s*[.#]?[\w-]+\s*\{[\s\S]*\b(?:color|display|padding|margin):/.test(head)) return 'css';
  return null;
}


const fileLanguages: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', typescript: 'typescript',
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript', javascript: 'javascript',
  py: 'python', pyw: 'python', python: 'python', rs: 'rust', rust: 'rust',
  go: 'go', swift: 'swift', java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp',
  rb: 'ruby', php: 'php', lua: 'lua', r: 'r', ex: 'elixir', exs: 'elixir',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', ps1: 'powershell',
  json: 'json', jsonc: 'json', jsonl: 'json', yaml: 'yaml', yml: 'yaml',
  toml: 'toml', xml: 'xml', svg: 'svg', html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less', sql: 'sql', graphql: 'graphql',
  gql: 'graphql', dockerfile: 'dockerfile', makefile: 'makefile',
  diff: 'diff', patch: 'diff', mdx: 'markdown',
  vue: 'xml', svelte: 'xml', proto: 'protobuf', tf: 'hcl', hcl: 'hcl',
};
export function languageForFile(filename: string): string | null {
  const lower = filename.toLowerCase();
  const ext = lower.split('.').pop() || '';
  if (lower === 'dockerfile' || lower === 'makefile') return fileLanguages[lower];
  return fileLanguages[ext] || null;
}
export function isMarkdownFile(filename: string): boolean {
  return /\.(md|markdown|mdown|mdx)$/i.test(filename);
}
