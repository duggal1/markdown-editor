import { formatMarkdownDocument, type MarkdownFormatOptions } from '../lib/autoMarkdown';

// Isolate long document formatting from CodeMirror's input/scroll thread.
self.onmessage = (event: MessageEvent<{ source: string; options: MarkdownFormatOptions }>) => {
  try {
    self.postMessage({ ok: true, formatted: formatMarkdownDocument(event.data.source, event.data.options) });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Markdown formatting failed.',
    });
  }
};
