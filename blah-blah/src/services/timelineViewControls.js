/**
 * timelineViewControls — a tiny registry for timeline *view* commands that
 * live on the Timeline component but are triggered from outside it.
 *
 * The global keydown dispatcher (components/shell/EditorPlaybackShortcuts)
 * handles "Center View on Playhead", but only the mounted Timeline owns the
 * scroll element and knows pixelsPerSecond/HEADER_WIDTH, so it registers the
 * actual implementation here on mount and the dispatcher calls through this
 * registry. Same module-level-store idea as clipClipboard / playbackStore, and
 * it keeps the shortcut dispatcher decoupled from the Timeline's DOM.
 */

let centerOnPlayheadImpl = null;

/**
 * Register the timeline's "center on playhead" implementation.
 * @param {() => void} fn
 * @returns {() => void} unregister (safe to call even after a re-register)
 */
export function registerTimelineCenterOnPlayhead(fn) {
  centerOnPlayheadImpl = fn;
  return () => {
    if (centerOnPlayheadImpl === fn) centerOnPlayheadImpl = null;
  };
}

/** Center the timeline view on the playhead, if a Timeline is mounted. */
export function centerTimelineViewOnPlayhead() {
  try {
    centerOnPlayheadImpl?.();
  } catch (err) {
    console.warn('[timelineViewControls] centerOnPlayhead failed:', err);
  }
}
