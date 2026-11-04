import { isMarkdownFile } from './code';

/**
 * Text imports may be UTF-8, UTF-8 BOM, or UTF-16. UTF-16 markdown contains
 * NUL bytes and must not be mistaken for an attachment/binary download.
 * Unknown binary content is never decoded with replacement characters.
 */
export async function readTextImport(file: Blob, fileName = ''): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 8192)).arrayBuffer());
  const isMd = isMarkdownFile(fileName);
  if (!head.length) return '';
  let encoding: 'utf-8' | 'utf-16le' | 'utf-16be' = 'utf-8';
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) encoding = 'utf-16le';
  else if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) encoding = 'utf-16be';
  else if (head.includes(0)) {
    // BOM-less UTF-16: recognizable alternating zero bytes in ASCII markdown.
    let even = 0, odd = 0;
    for (let i = 0; i < head.length; i++) if (head[i] === 0) {
      if (i % 2 === 0) even++;
      else odd++;
    }
    const threshold = head.length / 5;
    if (isMd && odd > threshold && even < head.length / 40) encoding = 'utf-16le';
    else if (isMd && even > threshold && odd < head.length / 40) encoding = 'utf-16be';
    else return null;
  }
  try {
    // Fatal decoding prevents arbitrary binary data from becoming corrupt text.
    const bytes = await file.arrayBuffer();
    return new TextDecoder(encoding, { fatal: true })
      .decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  } catch {
    return null;
  }
}
