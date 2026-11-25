import { looksLikeHtml } from './htmlPreview';

export type CodeLanguage = 'swift' | 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'json' | 'css' | 'xml' | 'svg' | 'html' | 'sql' | 'bash';


/** Strong statement evidence, rather than identifiers mentioned in prose. */
function statementStart(line: string): boolean {
  const t = line.trim();
  return /^(?:(?:export|default|async|pub|public|private|static)\s+)*(?:(?:const|let|var)\s+(?:[\w$]+|[\[{])|(?:function|fn|func|def|class|interface|struct|enum|type|impl)\s+[\w$]+|(?:import|from|package|use)\s+\S+|return\s+.+;|(?:if|for|while|switch|catch)\s*\(|[\w$]+(?:\.[\w$]+)*\s*\([^]*\)\s*;|[\w$]+(?:\.[\w$]+)*\s*=(?!=)|(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b)/.test(t)
    || /^(?:#Preview\b|#!|\/\/|\/\*|\*\/|<\?xml|<svg\b|<!doctype\b|<[a-z][\w:-]*[\s/>]|[.#]?[\w-]+\s*\{|(?:npm|git|curl|brew)\s+\S|[$>]\s+\w)/i.test(t);
}
function proseLine(line: string): boolean {
  const t = line.trim();
  if (!t || statementStart(t) || /^(?:[{}[\]();,.]|["']|#|\/\/|\/\*|\*|[-+>]\s)/.test(t)) return false;
  return /^[A-Za-z][\w$./()'’-]*(?:\s+\S+){1,}/.test(t) && !/[{=;]\s*$/.test(t);
}
function startsWithDocumentProse(source: string): boolean {
  const lines = source.slice(0, 12000).split(/\r?\n/);
  const first = lines.findIndex(line => Boolean(line.trim()));
  if (first < 0) return false;
  const start = lines[first].trim();
  if (statementStart(start) || /^[{[\]()<]/.test(start)) return false;
  if (proseLine(start)) return true;
  if (/^[A-Za-z][\w-]{0,50}$/.test(start)) {
    const next = lines.slice(first + 1).find(line => Boolean(line.trim()));
    return Boolean(next && proseLine(next));
  }
  return false;
}
function codeContinuation(line: string): boolean {
  const t = line.trim();
  return Boolean(t) && (statementStart(t) || /^(?:[}\])][\s,;.)\]}]*$|\}\s*(?:else|catch|finally)\b|\.[\w$]+\s*\(|\/\/|\/\*|\*\/)/.test(t)
    || (/^\s+/.test(line) && !proseLine(t)));
}

// Narrow, deterministic repair for copied JS/TS documentation. Only strong
// declarations/calls are anchors; an unmatched expression must be closed by
// an immediately adjacent code-shaped continuation. Never synthesize code.
const jsDeclaration = /^(?:export\s+)?(?:const|let|var)\s+(?:[\w$]+|\[[^\]]+\]|\{[^}]+\})\s*(?::[^=]+)?=(?!=)/;
const jsCall = /^(?:await\s+)?(?:console\.[\w$]+|[\w$]+(?:\.[\w$]+)+)\s*\([^]*\)\s*;$/;
const jsAnchor = (line: string) => jsDeclaration.test(line.trim()) || jsCall.test(line.trim());
const jsTail = (line: string) => /^[\s]*[}\])]/.test(line);
const fenceMarker = /^ {0,3}(\x60{3,}|~{3,})(.*)$/;

type Balance = { stack: string[]; quote: string; comment: boolean; invalid: boolean };
function newBalance(): Balance { return { stack: [], quote: '', comment: false, invalid: false }; }
function scanBalance(state: Balance, line: string) {
  for (let i = 0; i < line.length; i++) {
    const c = line[i], next = line[i + 1];
    if (state.comment) {
      if (c === '*' && next === '/') { state.comment = false; i++; }
      continue;
    }
    if (state.quote) {
      if (c === '\\') { i++; continue; }
      if (c === state.quote) state.quote = '';
      continue;
    }
    if (c === '/' && next === '/') break;
    if (c === '/' && next === '*') { state.comment = true; i++; continue; }
    if (c === "'" || c === '"' || c === '\x60') { state.quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') state.stack.push(c);
    else if (c === ')' || c === ']' || c === '}') {
      if (state.stack.pop() !== ({ ')': '(', ']': '[', '}': '{' } as Record<string,string>)[c]) {
        state.invalid = true; return;
      }
    }
  }
}
function settled(state: Balance) { return !state.invalid && !state.stack.length && !state.quote && !state.comment; }
function jsCodeLine(line: string): boolean {
  const t = line.trim();
  return jsAnchor(t) || jsTail(t) || /^(?:\.[\w$]+\s*\(|\/\/|\/\*|\*\/|(?:if|for|while)\s*\(|[\w$]+(?:\.[\w$]+)*\s*\(|[\w$]+\s*:|[{\[])/.test(t);
}
function jsLanguage(body: string): 'javascript' | 'typescript' {
  return /^(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*:\s*[^=\n]+=/m.test(body)
    ? 'typescript' : 'javascript';
}
export type RepairedMixedCode = { markdown: string; sourceLines?: number[] };

/** Read-only normalization with original 1-based source line mapping.
 * Valid fences remain byte-identical. No DOM, parser dependency or AI calls.
 */
export function repairMixedCode(source: string): RepairedMixedCode {
  if (!source.trim() || source.length > 2_000_000 || detectRawCode(source)) return { markdown: source };
  const lines = source.split(/\r\n|\n|\r/);
  const output: string[] = [], sourceLines: number[] = [];
  let changed = false;
  const push = (value: string, line: number) => { output.push(value); sourceLines.push(line + 1); };
  const blankBefore = (line: number) => { if (output.length && output[output.length - 1].trim()) push('', line); };
  const blankAfter = (line: number) => { if (lines[line]?.trim()) push('', line); };
  const isBoundary = (line: string) => /^ {0,3}(?:#{1,6}\s|[-+*]\s|>\s|\|)/.test(line);
  let inHtml = false;
  let listContext = false;
  for (let i = 0; i < lines.length;) {
    const line = lines[i], marker = fenceMarker.exec(line);
    // Raw HTML and nested Markdown containers are deliberately not repaired.
    if (!inHtml && /^ {0,3}<(?:div|table|details|section|article|pre|script|style|svg)(?:\s|>)/i.test(line)) inHtml = true;
    if (inHtml) {
      push(line,i++);
      if (/<\/(?:div|table|details|section|article|pre|script|style|svg)\s*>|\/>\s*$/i.test(line)) inHtml = false;
      continue;
    }
    if (/^ {0,3}(?:[-+*]|\d+[.)])\s+/.test(line)) listContext = true;
    else if (line.trim() && !/^\s/.test(line)) listContext = false;
    if (marker) {
      const close = (j: number) => {
        const m = fenceMarker.exec(lines[j]);
        return !!m && m[1][0] === marker[1][0] && m[1].length >= marker[1].length && !m[2].trim();
      };
      let end = i + 1;
      while (end < lines.length && !close(end)) end++;
      if (end >= lines.length) { while(i < lines.length) push(lines[i],i++); break; }
      const lang = marker[2].trim().toLowerCase();
      const body = lines.slice(i+1,end);
      const first = body.find(x => x.trim()) || '';
      const recognized = /^(?:js|javascript|ts|typescript|jsx|tsx|sql)?$/.test(lang) && jsDeclaration.test(first.trim());
      if (recognized && !listContext && !/^\s/.test(line)) {
        const state = newBalance();
        body.forEach(x => scanBalance(state,x));
        let tail = end+1;
        while (tail < lines.length && !lines[tail].trim() && tail-end <= 3) tail++;
        let last = tail;
        // A missing closing expression is strong evidence that the fence is premature.
        if (!state.invalid && state.stack.length && !state.quote && !state.comment && jsTail(lines[tail] || '')) {
          while(last < lines.length && last-tail < 64 && jsCodeLine(lines[last]) && !isBoundary(lines[last])) {
            scanBalance(state,lines[last++]);
            if (state.invalid || settled(state)) break;
          }
          if (settled(state)) {
            while(last < lines.length && jsCall.test(lines[last].trim())) last++;
            const repairedLang = lang === 'sql' || !lang ? jsLanguage(body.join('\n')) : marker[2].trim();
            push(marker[1]+repairedLang,i);
            for(let j=i+1;j<end;j++) push(lines[j],j);
            for(let j=tail;j<last;j++) push(lines[j],j);
            push(lines[end],last-1); blankAfter(last);
            changed = true; i = last; continue;
          }
        }
        if (lang === 'sql' || !lang) {
          push(marker[1]+jsLanguage(body.join('\n')),i);
          for(let j=i+1;j<=end;j++) push(lines[j],j);
          changed = true; i = end+1; continue;
        }
      }
      while(i<=end) push(lines[i],i++);
      continue;
    }
    // Never infer a block inside a list or from indented prose, and require a
    // declaration at a paragraph boundary before interpreting unfenced text.
    if (!listContext && !/^\s/.test(line) && jsDeclaration.test(line) && (i===0 || !lines[i-1].trim())) {
      const state = newBalance();
      let end = i;
      while(end < lines.length && end-i < 512 && lines[end].trim() && !isBoundary(lines[end]) && !fenceMarker.test(lines[end])) {
        if (end>i && !jsCodeLine(lines[end])) break;
        scanBalance(state,lines[end++]);
        if (state.invalid) break;
      }
      if (end>i && settled(state) && (end-i>1 || /;\s*$/.test(line))) {
        const body = lines.slice(i,end).join('\n');
        let width = 3;
        for(const m of body.matchAll(/\x60+/g)) width = Math.max(width,m[0].length+1);
        const delimiter = '\x60'.repeat(width);
        blankBefore(i); push(delimiter+jsLanguage(body),i);
        for(let j=i;j<end;j++) push(lines[j],j);
        push(delimiter,end-1); blankAfter(end);
        changed=true; i=end; continue;
      }
    }
    push(line,i++);
  }
  return changed ? { markdown: output.join('\n'), sourceLines } : { markdown: source };
}

/** Recover code islands and tab-separated tables without changing snippet text. */
export function normalizeMixedContent(source: string): string {
  if (!source.trim() || source.length > 1_000_000 || detectRawCode(source)) return source;
  const repaired = repairMixedCode(source).markdown;
  const lines = repaired.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let fence: { char: string; width: number } | null = null;
  let changed = repaired !== source;
  const blank = () => { if (out.length && out[out.length - 1].trim()) out.push(''); };
  const cells = (line: string) => line.includes('\t') && !/^\s/.test(line) ? line.split('\t').map(cell => cell.trim()) : [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const marker = /^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], width: marker[1].length };
      else if (fence.char === marker[1][0] && marker[1].length >= fence.width && !marker[2].trim()) fence = null;
      out.push(line); i++; continue;
    }
    if (fence) { out.push(line); i++; continue; }
    const header = cells(line);
    if (header.length >= 2 && header.every(Boolean) && !statementStart(line)) {
      let end = i + 1;
      while (end < lines.length && cells(lines[end]).length === header.length && !statementStart(lines[end])) end++;
      if (end > i + 1) {
        const row = (values: string[]) => '| ' + values.map(value => value.replace(/\|/g, '\\|')).join(' | ') + ' |';
        blank(); out.push(row(header), row(header.map(() => '---')));
        for (let j = i + 1; j < end; j++) out.push(row(cells(lines[j])));
        if (lines[end]?.trim()) out.push('');
        i = end; changed = true; continue;
      }
    }
    if (statementStart(line) && !/^\s*(?:[-*+>]\s|#(?!Preview|!))/.test(line)) {
      let end = i + 1;
      while (end < lines.length && codeContinuation(lines[end])) end++;
      const body = lines.slice(i, end).join('\n');
      const language = detectRawCode(body);
      if (language && !/^(?:html|svg|xml)$/.test(language)) {
        let ticks = 3;
        for (const match of body.matchAll(/\x60+/g)) ticks = Math.max(ticks, match[0].length + 1);
        const delimiter = '\x60'.repeat(ticks);
        blank(); out.push(delimiter + language);
        for (let j = i; j < end; j++) out.push(lines[j]);
        out.push(delimiter);
        if (lines[end]?.trim()) out.push('');
        i = end; changed = true; continue;
      }
      for (let j = i; j < end; j++) out.push(lines[j]);
      i = end; continue;
    }
    out.push(line); i++;
  }
  return changed ? out.join('\n') : source;
}

export function detectRawCode(source: string): CodeLanguage | null {
  const text = source.trim();
  if (!text) return null;
  // SVG must be identified before generic HTML or CSS heuristics.
  if (/^\s*(?:<\?xml[^>]*>\s*|<!--[\s\S]*?-->\s*)*<svg(?:\s|\/?>)/i.test(text)) {
    const close = /<\/svg\s*>|<svg\b[^>]*\/>/gi;
    const ends = Array.from(text.matchAll(close));
    if (!ends.length || ends[ends.length - 1].index! + ends[ends.length - 1][0].length === text.length) return 'svg';
    return null;
  }
  // Even a tiny valid snippet like <p>Hi</p> deserves a real preview.
  // Check before scanning Markdown-like text inside <style> and <script>.
  if (looksLikeHtml(text)) return 'html';
  if (text.length < 16) return null;
  const head = text.slice(0, 12000);
  if (startsWithDocumentProse(head)) return null;
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
  if (/^\s*(?:(?:export|default|async)\s+)*(?:function\s+[\w$]+|(?:const|let|var)\s+(?:[\w$]+|\[[^\]\n]+\]|\{[^}\n]+\})\s*=|class\s+[\w$]+|import\s+[^\n]+\s+from\s*['"])/m.test(head)
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
