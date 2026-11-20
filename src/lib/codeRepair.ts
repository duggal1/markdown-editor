import { detectRawCode } from './code';

export type RepairLanguage = 'html' | 'python';
export type RepairResult = { text: string; fixes: string[] };
export const MAX_CODE_REPAIR_CHARS = 10 * 1024 * 1024;

const FLOW_LINK = /^https?:\/\/(?:markdown-editor\.opalhq\.fun|markdown-editor-new\.vercel\.app|markdown\.bixbite\.fun)\/(?:play|slug)\/[A-Za-z0-9_-]+\/?$/i;
const FENCE = /^(?:>\s*)?\x60{3,}(?:html|htm|python|py)?[ \t]*$/i;
const LABEL = /^(?:code|html|python)$/i;
const HTML_ROOT = /<!doctype\s+html\s*>|<html(?=[\s>])|<(?:body|head|main|section|div|p|style|script)(?=[\s>])/i;

function safePreamble(prefix: string, language: RepairLanguage): boolean {
  return prefix.replace(/^\uFEFF/, '').split(/\r?\n/).every(raw => {
    const line = raw.trim();
    if (!line || line === '>' || FLOW_LINK.test(line)) return true;
    if (FENCE.test(line)) return true;
    return LABEL.test(line) && (language === 'html' || line.toLowerCase() !== 'html');
  });
}

function htmlRoot(source: string): { position: number; preamble: string } | null {
  // Bounded probing keeps toolbar detection cheap even for a 10 MiB source.
  const match = HTML_ROOT.exec(source.slice(0, 8192));
  if (!match) return null;
  const preamble = source.slice(0, match.index);
  if (!safePreamble(preamble, 'html')) return null;
  return { position: match.index, preamble };
}

function removeEndFence(source: string, openingWasFenced: boolean): string {
  if (!openingWasFenced) return source;
  // Only a standalone closing fence at the very end is removable. A fence
  // within an HTML script/string or an ordinary Python comment is left alone.
  return source.replace(/(?:\r?\n)[ \t]*(?:>[ \t]*)?\x60{3,}[ \t]*(?:\r?\n)*$/, '');
}

function repairHtml(source: string): RepairResult {
  const root = htmlRoot(source);
  if (!root) return { text: source, fixes: [] };
  const fixes: string[] = [];
  let result = source.slice(root.position);
  if (root.position > 0) fixes.push('Removed pasted link, label or Markdown fence before HTML');
  const fenced = /(?:^|\r?\n)\s*(?:>\s*)?\x60{3,}(?:html|htm)?[ \t]*(?:\r?\n|$)/i.test(root.preamble)
    || /\x60{3,}$/.test(root.preamble);
  const withoutClosingFence = removeEndFence(result, fenced);
  if (result !== withoutClosingFence) {
    fixes.push('Removed closing Markdown fence after HTML');
    result = withoutClosingFence;
  }
  return { text: result, fixes };
}

const PYTHON_START = /^(?:#![^\r\n]*\bpython(?:3)?\b|(?:from\s+[\w.]+\s+import\b|import\s+\w|(?:async\s+)?def\s+\w+\s*\(|class\s+\w+[\s(:]|print\s*\(|(?:if|for|while|try|with)\b))/;

function pythonFenceBody(source: string): { body: string; prefix: string } | null {
  const match = /(?:^|\r?\n)(?:[ \t]*>\s*)?[ \t]*\x60{3,}(?:python|py)[ \t]*(?:\r?\n)/i.exec(source.slice(0, 8192));
  if (!match) return null;
  const index = match.index + (match[0].startsWith('\n') ? 1 : match[0].startsWith('\r\n') ? 2 : 0);
  const before = source.slice(0, index);
  if (!safePreamble(before, 'python')) return null;
  const body = source.slice(index + match[0].length - (index - match.index));
  return { body, prefix: source.slice(0, index + match[0].length - (index - match.index)) };
}

function removePythonPrompts(source: string): string {
  const lines = source.split(/(\r?\n)/);
  const contentLines = lines.filter((_, index) => index % 2 === 0 && Boolean(lines[index].trim()));
  if (contentLines.length === 0 || !/^>>>[ \t]/.test(contentLines[0])) return source;
  if (!contentLines.every(line => /^(?:>>>|\.\.\.)[ \t]/.test(line))) return source;
  return lines.map((line, index) => index % 2 === 0
    ? line.replace(/^(?:>>>|\.\.\.)[ \t]/, '') : line).join('');
}

function repairPython(source: string): RepairResult {
  const fixes: string[] = [];
  let text = source;
  const fenced = pythonFenceBody(text);
  if (fenced) {
    const cleaned = removeEndFence(fenced.body, true);
    // An unterminated fence is not safe to unwrap: this could be Markdown
    // documentation rather than a complete Python file.
    if (cleaned !== fenced.body) {
      text = cleaned;
      fixes.push('Unwrapped pasted Python Markdown code fence');
    }
  }
  if (text === source) {
    // A standalone Flow link before clearly recognizable Python source is
    // an accidental paste; arbitrary URLs and other prose stay untouched.
    const line = /^([^\r\n]+)\r?\n/.exec(text);
    if (line && FLOW_LINK.test(line[1].trim())) {
      const remainder = text.slice(line[0].length);
      if (PYTHON_START.test(remainder.trimStart())) {
        text = remainder;
        fixes.push('Removed pasted Flow link before Python source');
      }
    }
  }
  const cleanedPrompts = removePythonPrompts(text);
  if (cleanedPrompts !== text) {
    text = cleanedPrompts;
    fixes.push('Removed Python REPL prompts');
  }
  return { text, fixes };
}

/** Unlike a generic formatter, these repairs modify only provable wrappers.
 * Indentation, strings, comments, attributes and code bodies are untouched. */
export function repairCode(source: string, language: RepairLanguage): RepairResult {
  if (source.length > MAX_CODE_REPAIR_CHARS || !source.trim()) {
    return { text: source, fixes: [] };
  }
  return language === 'html' ? repairHtml(source) : repairPython(source);
}

/** Detection tolerates corrupted paste wrappers without mistaking ordinary
 * Markdown prose containing a code example for an executable source file. */
export function detectRepairLanguage(
  source: string, hint?: string | null,
): RepairLanguage | null {
  const declared = hint?.toLowerCase();
  if (declared === 'html' || declared === 'htm') return 'html';
  if (declared === 'python' || declared === 'py') return 'python';
  if (!source.trim()) return null;

  const raw = detectRawCode(source.slice(0, 12_000));
  if (raw === 'html' || raw === 'python') return raw;

  const root = htmlRoot(source);
  if (root && root.position > 0 && root.position < 8192) return 'html';

  if (pythonFenceBody(source)) return 'python';
  const head = source.slice(0, 4096);
  if (/^>>>[ \t]/.test(head) && /(?:^|\n)(?:\.\.\.|>>>)[ \t]/.test(head)) return 'python';
  const prefix = /^([^\r\n]+)\r?\n/.exec(head);
  if (prefix && FLOW_LINK.test(prefix[1].trim())
    && PYTHON_START.test(head.slice(prefix[0].length).trimStart())) return 'python';
  return null;
}
