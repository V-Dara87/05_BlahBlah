/**
 * Where to put a floating box (context menu, popover) that wants to open at
 * (x, y) so that it is always fully inside the window.
 *
 *  - Too close to the right / bottom edge: it is pushed back inside.
 *  - Taller (or wider) than the window: it is capped to the window and reported
 *    as `scrollable`, so the caller can give it `max-height` + `overflow: auto`
 *    instead of letting the lower part fall off-screen where it cannot be
 *    reached.
 *
 * Pure maths, so it is unit-tested; components/shared/ContextMenu.jsx measures
 * the real element and applies the result.
 */
export function placeInViewport({
  x, y, width, height, viewportWidth, viewportHeight, margin = 6,
}) {
  const maxWidth = Math.max(0, viewportWidth - margin * 2);
  const maxHeight = Math.max(0, viewportHeight - margin * 2);
  const w = Math.min(width, maxWidth);
  const h = Math.min(height, maxHeight);
  let left = x;
  let top = y;
  if (left + w + margin > viewportWidth) left = viewportWidth - w - margin;
  if (top + h + margin > viewportHeight) top = viewportHeight - h - margin;
  return {
    left: Math.max(margin, left),
    top: Math.max(margin, top),
    maxHeight,
    scrollable: height > maxHeight,
  };
}