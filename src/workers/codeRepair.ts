import { repairCode, type RepairLanguage } from '../lib/codeRepair';

self.onmessage = (event: MessageEvent<{ source: string; language: RepairLanguage }>) => {
  try {
    const { source, language } = event.data;
    self.postMessage({ ok: true, result: repairCode(source, language) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Code repair failed' });
  }
};
