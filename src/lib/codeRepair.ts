import { detectRawCode } from './code';

export type RepairLanguage = 'html' | 'python';

/**
 * Conservative repair: deletes identifiable paste/Markdown wrapper artifacts.
 * Never generates code or guesses missing tags, statements or indentation.
 */
const HTML_START = /<!doctype\s+html\b|<html\b|<svg\b|<\?xml\b/i;
const HTML_END = /(<\/html\s*>|<\/svg\s*>)\s*`{3,}[ \t]*$/i;
const LANGUAGE_LABEL = /^(?:html|xml|python|py|code|html code|python code)$/i;
const FENCE = /^(?:>\s*)?`{3,}(?:(?:html|xml|python|py)\s*)?$/i;
const PASTE_URL = /^https?:\/\/[^\s<>"']+$/i;

function isWrapperLine(line: string): boolean {
  const clean = line.trim();
  return !clean || FENCE.test(clean) || LANGUAGE_LABEL.test(clean) ||
    PASTE_URL.test(clean) || clean === '>' || /^`{1,3}$/.test(clean);
}

function safeHtmlStart(source: string): number {
  const found = HTML_START.exec(source.slice(0, 8192));
  if (!found) return -1;
  const prefix = source.slice(0, found.index);
  if (!prefix.trim()) return found.index === 0 ? 0 : -1;
  // Never delete real source, including comments and legitimate text.
  if (!prefix.split(/\r?\n/).every(isWrapperLine)) return -1;
  return found.index;
}

function repairHtml(source: string): string {
  const start = safeHtmlStart(source);
  if (start < 0) return source;
  const content = start === 0 ? source : source.slice(start);
  // Only strip a closing Markdown fence AFTER the HTML document.
  return content.replace(HTML_END, '$1');
}

function looksPython(line: string): boolean {
  return /^(?:from\s+\S+\s+import\b|import\s+\w+|(?:async\s+)?def\s+\w+\s*\(|class\s+\w+[\s(:]|if\s+__name__\s*==|print\s*\(|#[!]|@[\w.]+)/.test(line.trim());
}

function repairPython(source: string): string {
  let result = source;
  const lines = result.split(/\r?\n/);
  let first = 0;
  // A copied page may begin with a URL, code label or language fence.
  while (first < Math.min(lines.length, 8) && isWrapperLine(lines[first])) first++;
  let lastMeaningful = lines.length - 1;
  while (lastMeaningful >= 0 && !lines[lastMeaningful].trim()) lastMeaningful--;
  // Leading blank lines are legitimate Python formatting, not corruption.
  const hasWrapperArtifact = lines.slice(0, first).some(line => Boolean(line.trim()));
  if (hasWrapperArtifact && first < lines.length && looksPython(lines[first])) {
    const wrapped = lines.slice(0, first).some(line => FENCE.test(line.trim()));
    const closing = lastMeaningful > first && /^`{3,}$/.test(lines[lastMeaningful].trim());
    const end = wrapped && closing ? lastMeaningful : lines.length;
    result = lines.slice(first, end).join('\n') + (source.endsWith('\n') ? '\n' : '');
  }
  // Strip REPL prompts only when every nonblank line is prompted input.
  const repl = result.split('\n');
  const active = repl.filter(line => line.trim());
  if (active.length && /^>>> (?:import\b|from\b|def\b|class\b|print\b|[\w(])/.test(active[0].trim()) &&
      active.every(line => /^(?:>>> |\.\.\. )/.test(line.trimStart()))) {
    const prefix = /^([ \t]*)(?:>>> |\.\.\. )/;
    result = repl.map(line => line.replace(prefix, '$1')).join('\n');
  }
  return result;
}

/** Detect HTML/Python even when wrapper junk defeated normal code detection. */
export function repairLanguage(source: string, explicit?: string | null): RepairLanguage | null {
  const declared = explicit?.toLowerCase();
  if (declared === 'html' || declared === 'python') return declared;
  const detected = detectRawCode(source);
  if (detected === 'html' || detected === 'python') return detected;
  if (safeHtmlStart(source) >= 0) return 'html';
  const first = source.slice(0, 8192).split(/\r?\n/);
  let index = 0;
  while (index < Math.min(first.length, 8) && isWrapperLine(first[index])) index++;
  if (index > 0 && index < first.length && looksPython(first[index])) return 'python';
  if (/^\s*>>> (?:import\b|from\b|def\b|class\b|print\b)/.test(source)) return 'python';
  return null;
}

/** Idempotent, local and undoable. No guesses, no invented code. */
export function repairCodeSource(source: string, language: RepairLanguage): string {
  if (!source) return source;
  return language === 'html' ? repairHtml(source) : repairPython(source);
}
