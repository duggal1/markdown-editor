export type CodeLanguage = 'swift' | 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'json' | 'css' | 'xml' | 'sql' | 'bash';

export function detectRawCode(source: string): CodeLanguage | null {
  const text = source.trim();
  if (!text || text.length < 16) return null;
  const head = text.slice(0, 12000);
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
  if (/\b(?:const|let|function|export|import)\b/.test(head)
      && /(?:=>|console\.|\breturn\b|from\s*['"]|;\s*(?:\n|$))/.test(head)) return 'javascript';
  if (/^\s*<\?xml\b|^\s*<(?:svg|html|div|span|section)\b/i.test(head)) return 'xml';
  if (/\bSELECT\b[\s\S]*\bFROM\b|\bCREATE\s+TABLE\b/i.test(head)) return 'sql';
  if (/^\s*(?:#!\/(?:bin\/)?(?:ba)?sh|\$\s+\w+|(?:npm|git|curl|brew)\s+\w+)/m.test(head)) return 'bash';
  if (/^\s*[.#]?[\w-]+\s*\{[\s\S]*\b(?:color|display|padding|margin):/.test(head)) return 'css';
  return null;
}
