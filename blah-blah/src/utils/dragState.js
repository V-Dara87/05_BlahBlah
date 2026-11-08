/**
 * Lightweight global timeline-drag flag.
 *
 * Written by TimelineCanvas whenever any clip/trim/lasso drag is active so
 * that other animation loops (e.g. MixerPanel's meter tick) can throttle
 * themselves and hand the main thread back to the timeline renderer.
 *
 * Intentionally a plain module-level variable — no React state, no Zustand,
 * no event bus. The only consumers are requestAnimationFrame loops that read
 * it once per frame at negligible cost.
 */
let _dragging = false;

/** Call with `true` on drag start, `false` on drag end. */
export function setTimelineDragging(active) {
  _dragging = !!active;
}

/** Returns true while any timeline drag (move / trim / lasso) is in progress. */
export function isTimelineDragging() {
  return _dragging;
}
