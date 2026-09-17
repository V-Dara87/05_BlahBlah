/**
 * Single source of truth for adjusting a clip's `mediaOffset` (the clip's
 * in-point into its source media file, in source-file seconds) whenever
 * the clip is trimmed, split, or has silence cut from it.
 *
 * `mediaOffset` lives in SOURCE time, but the amount a clip's start moves
 * on the timeline (drag delta, split point, cut-segment start, etc.) is
 * measured in TIMELINE time. When a clip plays at `speed !== 1`, one
 * second of timeline time corresponds to `speed` seconds of source time,
 * so the timeline delta must be scaled by `speed` before it's added to
 * `mediaOffset`. Every call site that shifts a clip's in-point (left-trim
 * drag, ripple-trim-to-playhead, split, cut-silence) must go through this
 * function so the speed correction is never accidentally skipped in one
 * place while present in another.
 *
 * @param {number} origOffset - The component's current mediaOffset (source seconds).
 * @param {number} timelineDeltaSeconds - How far the clip's in-point moved, in timeline seconds.
 * @param {number} [speed=1] - The clip's playback speed (1 = normal speed).
 * @returns {number} The new mediaOffset (source seconds), clamped to >= 0.
 */
export function computeTrimmedOffset(origOffset, timelineDeltaSeconds, speed = 1) {
  const safeSpeed = Number(speed) || 1;
  const safeOrigOffset = Number(origOffset) || 0;
  const safeDelta = Number(timelineDeltaSeconds) || 0;
  return Math.max(0, safeOrigOffset + safeDelta * safeSpeed);
}