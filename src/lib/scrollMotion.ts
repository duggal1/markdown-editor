// Animate explicit navigation only. Never put an easing filter over wheel,
// touch, cursor synchronization or virtualizer measurement corrections.
export function navigationEase(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  // Quintic smoothstep: zero velocity and acceleration at both endpoints.
  return t * t * t * (t * (t * 6 - 15) + 10);
}
export function navigationDuration(distance: number, viewport: number): number {
  return Math.max(220, Math.min(560, 220 + 135 * Math.sqrt(Math.abs(distance) / Math.max(1, viewport))));
}

type Motion = { frame: number; target: number };
const running = new WeakMap<HTMLElement, Motion>();

export function cancelNavigation(scroll: HTMLElement | null | undefined): void {
  if (!scroll) return;
  const motion = running.get(scroll);
  if (!motion) return;
  cancelAnimationFrame(motion.frame);
  running.delete(scroll);
}

export function navigateScroll(scroll: HTMLElement, top: number, smooth = false, bounded = false): void {
  const target = Math.max(0, Math.min(top, Math.max(0, scroll.scrollHeight - scroll.clientHeight)));
  const previous = running.get(scroll);
  if (smooth && previous && Math.abs(previous.target - target) < 2) return;
  cancelNavigation(scroll);
  if (Math.abs(scroll.scrollTop - target) < 1) return;
  if (!smooth || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    scroll.scrollTop = target;
    return;
  }
  let from = scroll.scrollTop;
  const viewport = Math.max(1, scroll.clientHeight);
  // Don't render hundreds of offscreen virtual windows just to cross a large
  // file. Seek close to the target, then ease the final visible travel.
  if (bounded && Math.abs(target - from) > viewport * 3) {
    from = target - Math.sign(target - from) * viewport * 1.25;
    scroll.scrollTop = from;
  }
  const distance = target - from;
  const duration = navigationDuration(distance, viewport);
  const start = performance.now();
  const motion: Motion = { frame: 0, target };
  const tick = (now: number) => {
    if (running.get(scroll) !== motion) return;
    const progress = Math.max(0, Math.min(1, (now - start) / duration));
    // One write per display refresh. No React updates or geometry reads here.
    scroll.scrollTop = progress === 1 ? target : from + distance * navigationEase(progress);
    if (progress < 1) motion.frame = requestAnimationFrame(tick);
    else running.delete(scroll);
  };
  running.set(scroll, motion);
  motion.frame = requestAnimationFrame(tick);
}
