/**
 * Flow Lexical v1. A source tokenizer, not a BPE vocabulary or model billing
 * estimate. UTF-16 offsets are exact, including astral code points. Whitespace
 * is a separator; punctuation is a token; identifiers are maximal word runs.
 * East Asian Han/Kana/Hangul characters are individual lexical units. Common
 * emoji sequences (flags, keycaps, modifiers, ZWJ) remain a single token.
 */
export const TOKENIZER_VERSION = 'flow-lexical-v1';
export type TokenKind = 'word' | 'symbol' | 'emoji';
export type SourceToken = { kind: TokenKind; start: number; end: number; value: string };
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_PART = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]\p{M}*|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const EMOJI = String.raw`(?:[0-9#*]\uFE0F?\u20E3|\p{Regional_Indicator}{1,2}|\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?(?:[\u{E0020}-\u{E007E}]+\u{E007F})?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?)*)`;
const PATTERN = String.raw`(\s+)|(` + EMOJI + String.raw`)|([\p{L}\p{M}\p{N}_]+)|([\s\S])`;
// Match all non-whitespace source without allocating a token array when counting.
function* scan(source: string): Generator<SourceToken> {
  const pattern = new RegExp(PATTERN, 'gu');
  for (const match of source.matchAll(pattern)) {
    if (match[1]) continue;
    const value = match[0], start = match.index!;
    const kind: TokenKind = match[2] ? 'emoji' : match[3] ? 'word' : 'symbol';
    if (kind === 'word' && CJK.test(value)) {
      for (const part of value.matchAll(CJK_PART)) {
        const offset = start + part.index!;
        yield { kind, start: offset, end: offset + part[0].length, value: part[0] };
      }
    } else yield { kind, start, end: start + value.length, value };
  }
}
export function tokenize(source: string): IterableIterator<SourceToken> {
  return scan(source);
}
export function countTokens(source: string, hasAsset = false): number {
  let count = hasAsset ? 1 : 0;
  for (const _ of scan(source)) count++;
  return count;
}
/** Worker-disabled fallback yields between batches; cancellation stops work. */
export async function countTokensCooperative(source: string, hasAsset: boolean, cancelled: () => boolean): Promise<number | null> {
  let count = hasAsset ? 1 : 0, batch = 0;
  for (const _ of scan(source)) {
    count++;
    if (++batch === 4096) {
      batch = 0;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (cancelled()) return null;
    }
  }
  return cancelled() ? null : count;
}
