import { formatMarkdownDocument, type MarkdownFormatOptions } from './autoMarkdown';

const WORKER_THRESHOLD = 50_000;

/** Keep small edits immediate; perform large document formatting off the UI thread. */
export function formatMarkdownAction(source: string, options: MarkdownFormatOptions): Promise<string> {
  if (source.length < WORKER_THRESHOLD || typeof Worker === 'undefined') {
    return Promise.resolve(formatMarkdownDocument(source, options));
  }
  return new Promise((resolve, reject) => {
    let finished = false;
    const worker = new Worker(new URL('../workers/autoMarkdown.ts', import.meta.url), { type: 'module' });
    const finish = (error?: Error, formatted?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      worker.terminate();
      if (error) reject(error);
      else resolve(formatted ?? source);
    };
    const timeout = setTimeout(() => finish(new Error('Markdown formatting timed out.')), 20_000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; formatted?: string; error?: string }>) => {
      if (event.data.ok && typeof event.data.formatted === 'string') finish(undefined, event.data.formatted);
      else finish(new Error(event.data.error || 'Markdown formatting failed.'));
    };
    worker.onerror = () => finish(new Error('Markdown formatting worker failed.'));
    worker.postMessage({ source, options });
  });
}
