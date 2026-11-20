import { repairCode, type RepairLanguage, type RepairResult } from './codeRepair';

const WORKER_THRESHOLD = 50_000;

/** Deterministic local repair, worker-backed for large pasted files. */
export function repairCodeAction(source: string, language: RepairLanguage): Promise<RepairResult> {
  if (source.length < WORKER_THRESHOLD || typeof Worker === 'undefined') {
    return Promise.resolve(repairCode(source, language));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/codeRepair.ts', import.meta.url), { type: 'module' });
    let finished = false;
    const finish = (error?: Error, result?: RepairResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      worker.terminate();
      if (error) reject(error);
      else resolve(result ?? { text: source, fixes: [] });
    };
    const timeout = setTimeout(() => finish(new Error('Code repair timed out.')), 25_000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: RepairResult; error?: string }>) => {
      if (event.data.ok && event.data.result && typeof event.data.result.text === 'string') {
        finish(undefined, event.data.result);
      } else finish(new Error(event.data.error || 'Code repair failed'));
    };
    worker.onerror = () => finish(new Error('Code repair worker failed'));
    worker.postMessage({ source, language });
  });
}
