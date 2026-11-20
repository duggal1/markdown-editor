import { repairCodeSource, type RepairLanguage } from './codeRepair';

const WORKER_THRESHOLD = 50_000;

/** Keep large deterministic repairs off the CodeMirror typing thread. */
export function repairCodeAction(source: string, language: RepairLanguage): Promise<string> {
  if (source.length < WORKER_THRESHOLD || typeof Worker === 'undefined') {
    return Promise.resolve(repairCodeSource(source, language));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/codeRepair.ts', import.meta.url), { type: 'module' });
    let finished = false;
    const finish = (error?: Error, value?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      worker.terminate();
      if (error) reject(error);
      else resolve(value ?? source);
    };
    const timeout = setTimeout(() => finish(new Error('Code repair timed out.')), 20_000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; output?: string; error?: string }>) => {
      if (event.data.ok && typeof event.data.output === 'string') finish(undefined, event.data.output);
      else finish(new Error(event.data.error || 'Code repair failed.'));
    };
    worker.onerror = () => finish(new Error('Code repair worker failed.'));
    worker.postMessage({ source, language });
  });
}
