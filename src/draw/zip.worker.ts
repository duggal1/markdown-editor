import { createImageZip, type ZipEntry } from './zip';

type ZipRequest = { entries: ZipEntry[] };
type ZipResponse = { zip?: Blob; error?: string };

self.addEventListener('message', (event: MessageEvent<ZipRequest>) => {
  void (async () => {
    try {
      const zip = await createImageZip(event.data.entries);
      self.postMessage({ zip } satisfies ZipResponse);
    } catch (cause) {
      self.postMessage({
        error: cause instanceof Error ? cause.message : 'Could not create ZIP.',
      } satisfies ZipResponse);
    }
  })();
});
