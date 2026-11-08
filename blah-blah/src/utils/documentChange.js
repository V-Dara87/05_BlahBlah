/**
 * documentChange — a synchronous "the project document was just edited" signal.
 *
 * WHY. The autosave hook used to notice edits from a `useEffect` that depends
 * on entities/tracks/scripts/prefabs and then call `setSaveStatus('unsaved')`.
 * An effect cannot batch with the update that caused it, so every drop (one
 * App state commit) produced a SECOND full App render pass just to flip the
 * save badge — the "Cascading Update" in the drag trace.
 *
 * `useUndoableState` now announces a commit here while the originating event
 * handler is still running, so the status update lands in React's batch for
 * that event and both changes render in ONE pass.
 *
 * Kept as a plain module-level listener set (no React state, no store) — the
 * only subscriber is useProjectAutosave, and it only ever sets a save badge.
 */
const listeners = new Set();

/** Subscribe to document edits. Returns an unsubscribe function. */
export function subscribeDocumentChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Announce that the document was just edited (called from the edit itself). */
export function notifyDocumentChange() {
  for (const listener of listeners) listener();
}
