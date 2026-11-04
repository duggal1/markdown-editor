import { buildPreviewSections } from '../lib/previewPipeline';

type Message = { requestId: number; source: string };
self.onmessage = (event: MessageEvent<Message>) => {
  const { requestId, source } = event.data;
  const { chunks, firstLines } = buildPreviewSections(source);
  self.postMessage({ requestId, chunks, firstLines });
};
