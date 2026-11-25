import { countTokens } from '../lib/tokenizer';

type Request = { revision: number; source: string; hasAsset: boolean };
self.onmessage = (event: MessageEvent<Request>) => {
  const { revision, source, hasAsset } = event.data;
  self.postMessage({ revision, count: countTokens(source, hasAsset) });
};
