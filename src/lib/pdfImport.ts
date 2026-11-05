/** Convert a PDF to editable Markdown using an isolated, short-lived worker. */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export async function readPdfAsMarkdown(file: File): Promise<string> {
  if (file.size > 50 * 1024 * 1024) throw new Error('PDF exceeds the 50 MB file limit.');
  // Worker isolation keeps 20 simultaneous imports from freezing CodeMirror.
  const worker = new Worker(new URL('../workers/pdfImport.ts', import.meta.url), { type: 'module' });
  return new Promise<string>((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error, result?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      worker.terminate();
      if (error) reject(error);
      else resolve(result || '');
    };
    const timeout = setTimeout(() => finish(new Error('PDF extraction timed out after 45 seconds.')), 45_000);
    worker.onmessage = (event: MessageEvent<{ok: boolean; markdown?: string; error?: string}>) => {
      if (event.data.ok && event.data.markdown) finish(undefined, event.data.markdown);
      else finish(new Error(event.data.error || 'PDF has no selectable text.'));
    };
    worker.onerror = () => finish(new Error('PDF worker crashed.'));
    void file.arrayBuffer().then(buffer => {
      if (!finished) worker.postMessage({ buffer }, [buffer]);
    }).catch(error => finish(error instanceof Error ? error : new Error('Cannot read PDF.')));
  });
}
