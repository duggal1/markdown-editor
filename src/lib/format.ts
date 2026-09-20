export type Format = 'bold' | 'italic' | 'code' | 'link' | 'heading' | 'quote';
export function applyFormat(area: HTMLTextAreaElement, format: Format): string {
  const start = area.selectionStart, end = area.selectionEnd;
  const original = area.value;
  const selected = original.slice(start, end);
  let front = '', back = '', placeholder = '';
  switch (format) {
    case 'bold': front = '**'; back = '**'; placeholder = 'bold text'; break;
    case 'italic': front = '*'; back = '*'; placeholder = 'italic text'; break;
    case 'link': front = '['; back = '](https://example.com)'; placeholder = 'link text'; break;
    case 'code':
      front = selected.includes('\n') ? '\n~~~\n' : '\u0060';
      back = selected.includes('\n') ? '\n~~~\n' : '\u0060';
      placeholder = 'code'; break;
    case 'heading': front = '## '; placeholder = 'Heading'; break;
    case 'quote': front = '> '; placeholder = 'Quote'; break;
  }
  const middle = selected || placeholder;
  const result = original.slice(0, start) + front + middle + back + original.slice(end);
  area.value = result;
  area.focus();
  area.setSelectionRange(start + front.length, start + front.length + middle.length);
  return result;
}
