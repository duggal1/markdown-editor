import { repairCodeSource, type RepairLanguage } from '../lib/codeRepair';

self.onmessage = (event: MessageEvent<{ source: string; language: RepairLanguage }>) => {
  try {
    const { source, language } = event.data;
    if ((language !== 'html' && language !== 'python') || typeof source !== 'string') {
      throw new Error('Unsupported code repair request.');
    }
    self.postMessage({ ok: true, output: repairCodeSource(source, language) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Code repair failed.' });
  }
};
