/**
 * Shared pointer-drag math for editable time-segment UIs (originally
 * written for the sub-strip system, kept because the interaction itself
 * — drag to move, drag an edge to resize, snap to nearby points — is
 * useful to any full clip renderer that shows editable segments, not
 * just a compact strip. SubtitleClipBody.jsx is the current user.
 */
 
export const MIN_SEGMENT_DURATION = 0.1; // seconds — floor so a resize/add can't collapse a segment to nothing
 
export function getSnappedTime(rawTime, pixelsPerSecond, snappingPoints, snappingEnabled) {
  if (!snappingEnabled || !snappingPoints || snappingPoints.length === 0) return rawTime;
  const snapThresholdSec = 10 / pixelsPerSecond;
  for (const point of snappingPoints) {
    if (Math.abs(rawTime - point) < snapThresholdSec) return point;
  }
  return rawTime;
}
 
/**
 * Starts a window-level pointer drag that moves a segment (both edges
 * together, preserving its duration). Calls `onChange({ startTime, endTime })`
 * on every move; caller decides how to apply that (usually a provider's
 * onSegmentChange-style mutation).
 */
export function startSegmentMoveDrag({ e, segment, pixelsPerSecond, snappingPoints, snappingEnabled, onChange }) {
  e.stopPropagation();
  e.preventDefault();
 
  const startX = e.clientX;
  const origStart = segment.startTime;
  const origSpan = segment.endTime - segment.startTime;
 
  const handlePointerMove = (moveEvent) => {
    const deltaTime = (moveEvent.clientX - startX) / pixelsPerSecond;
    let newStart = Math.max(0, origStart + deltaTime);
    newStart = getSnappedTime(newStart, pixelsPerSecond, snappingPoints, snappingEnabled);
    onChange({ startTime: newStart, endTime: newStart + origSpan });
  };
 
  const handlePointerUp = () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
  };
 
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);
}
 
/**
 * Starts a window-level pointer drag that resizes just one edge of a
 * segment. `edge` is 'left' or 'right'. Calls `onChange({ startTime })` or
 * `onChange({ endTime })` accordingly — never both, so callers can patch
 * just the field that changed.
 */
export function startSegmentResizeDrag({ e, segment, edge, pixelsPerSecond, snappingPoints, snappingEnabled, onChange }) {
  e.stopPropagation();
  e.preventDefault();
 
  const startX = e.clientX;
  const origStart = segment.startTime;
  const origEnd = segment.endTime;
 
  const handlePointerMove = (moveEvent) => {
    const deltaTime = (moveEvent.clientX - startX) / pixelsPerSecond;
 
    if (edge === 'left') {
      let newStart = Math.min(origStart + deltaTime, origEnd - MIN_SEGMENT_DURATION);
      newStart = Math.max(0, newStart);
      newStart = getSnappedTime(newStart, pixelsPerSecond, snappingPoints, snappingEnabled);
      if (newStart >= origEnd - MIN_SEGMENT_DURATION) return;
      onChange({ startTime: newStart });
    } else {
      let newEnd = Math.max(origEnd + deltaTime, origStart + MIN_SEGMENT_DURATION);
      newEnd = getSnappedTime(newEnd, pixelsPerSecond, snappingPoints, snappingEnabled);
      if (newEnd <= origStart + MIN_SEGMENT_DURATION) return;
      onChange({ endTime: newEnd });
    }
  };
 
  const handlePointerUp = () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
  };
 
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);
}