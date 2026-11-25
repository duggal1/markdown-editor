export const SCRAMBLE_MS = 180;
/** Deterministic decoding animation: digit positions resolve left to right.
 * The true label remains available to assistive technology throughout. */
export function scrambleDigits(target: string, progress: number, seed: number): string {
  if (progress >= 1) return target;
  const digits = (target.match(/[0-9]/g) || []).length;
  let index = 0;
  const revealed = Math.floor(Math.max(0, progress) * digits);
  const frame = Math.floor(Math.max(0, progress) * 8);
  return target.replace(/[0-9]/g, digit => {
    const slot = index++;
    return slot < revealed ? digit : String((Number(digit) + 1 + ((seed + frame * 7 + slot * 3) % 9)) % 10);
  });
}
