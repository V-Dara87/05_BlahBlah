/**
 * timelineAutoScroll — the one place that scrolls the timeline lanes while a
 * pointer drag is near the left/right edge.
 *
 * This pattern used to be copy-pasted into five different drag/trim/scrub
 * handlers (Timeline box-select, ClipItem clip-drag, ClipItem left-trim,
 * ClipItem right-trim, TimeRuler scrub). Only the LANES element was scrolled,
 * so the time ruler's tick marks stayed put and the two lost alignment until
 * something else scrolled and re-synced them.
 *
 * Centralizing it here means the ruler sync is written once and can't be
 * forgotten the next time a drag gesture is added.
 */

/** Left gutter (track headers) that sits inside the scrolled lanes area. */
export const TIMELINE_HEADER_WIDTH = 180;

/**
 * Scroll the lanes (and mirror the position onto the ruler) when `clientX` is
 * within `edgeMargin` px of the lanes' left/right edge.
 *
 * The lanes element's own scrollLeft is read back AFTER assignment so the
 * browser's native clamp (min 0 / max scrollWidth - clientWidth) is what gets
 * mirrored onto the ruler — otherwise the two could drift at the ends.
 *
 * @param {number} clientX - current pointer client X
 * @param {object} options
 * @param {HTMLElement|null} options.lanesEl  - the `.lanes-wrapper` scroll container
 * @param {HTMLElement|null} [options.rulerEl] - the `.ruler-wrapper` container to keep in sync
 * @param {number} [options.headerWidth=180]  - left gutter inside the lanes area
 * @param {number} [options.edgeMargin=60]    - activation distance from an edge
 * @param {number} [options.scrollSpeed=10]   - px scrolled per call
 * @returns {number} the lanes' scrollLeft after this call (unchanged if inactive)
 */
export function applyEdgeAutoScroll(clientX, {
  lanesEl,
  rulerEl = null,
  headerWidth = TIMELINE_HEADER_WIDTH,
  edgeMargin = 60,
  scrollSpeed = 10,
} = {}) {
  if (!lanesEl) return 0;
  const rect = lanesEl.getBoundingClientRect();

  let next = lanesEl.scrollLeft;
  if (clientX < rect.left + headerWidth + edgeMargin) {
    next = Math.max(0, next - scrollSpeed);
  } else if (clientX > rect.right - edgeMargin) {
    next = next + scrollSpeed;
  } else {
    return lanesEl.scrollLeft;
  }

  lanesEl.scrollLeft = next;
  // Read back so the ruler mirrors the natively-clamped value.
  const applied = lanesEl.scrollLeft;
  if (rulerEl) rulerEl.scrollLeft = applied;
  return applied;
}

/**
 * Look up the timeline's lanes + ruler scroll containers by class. Used by the
 * drag handlers that live on ClipItem / TimeRuler and don't have refs to the
 * sibling containers (Timeline.jsx passes its refs directly instead).
 */
export function getTimelineElements() {
  if (typeof document === 'undefined') return { lanesEl: null, rulerEl: null };
  return {
    lanesEl: document.querySelector('.lanes-wrapper'),
    rulerEl: document.querySelector('.ruler-wrapper'),
  };
}
