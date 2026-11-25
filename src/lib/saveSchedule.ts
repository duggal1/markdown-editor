/** Bound time spent dirty during continuous input, without saving every keystroke. */
export function localSaveDelay(documentLength: number, elapsedDirtyMs: number): number {
  const normalDelay = documentLength > 100000 ? 900 : 340;
  return Math.max(0, Math.min(normalDelay, 1500 - Math.max(0, elapsedDirtyMs)));
}
