import { countTokens } from '../lib/tokenizer';
import { countAssetTokens } from '../lib/imageTokens';
type Request = { revision: number; source: string; asset?: Blob; isImage: boolean };
self.onmessage = async (event: MessageEvent<Request>) => {
  const { revision, source, asset, isImage } = event.data;
  const count = countTokens(source) + await countAssetTokens(asset, isImage);
  self.postMessage({ revision, count });
};
