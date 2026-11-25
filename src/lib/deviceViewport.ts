export type TabletOrientation = 'portrait' | 'landscape';

// A representative 11-inch iPad layout viewport in CSS pixels.
// This is responsive layout testing, not Safari or physical DPR emulation.
export function tabletViewport(orientation: TabletOrientation) {
  const [width, height] = orientation === 'landscape' ? [1180, 820] : [820, 1180];
  const bezel = 12;
  return { width, height, bezel, outerWidth: width + bezel * 2, outerHeight: height + bezel * 2 };
}

export function fitDevice(availableWidth: number, availableHeight: number, width: number, height: number): number {
  return Math.max(.01, Math.min(1, (availableWidth - 24) / width, (availableHeight - 24) / height));
}
