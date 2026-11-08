import { createEditorStore, useSelectorFromStore } from './editorStore';

/**
 * The live microphone level (0..1 RMS), outside React state.
 *
 * WHY. `useAudioRecorder` used to keep this in `useState` and App consumed it
 * through `useAudioRecording`, so the mic meter's rAF loop re-rendered the
 * ENTIRE editor ~60 times a second while recording. Nothing in the editor
 * needs it except the meter the timeline/header draws, so it lives here now:
 * the drawing component subscribes, everything else is untouched.
 *
 * Same `createEditorStore` mechanism as the editor store, so
 * `useRecordingLevel()` re-renders only on an actual level change.
 */
const store = createEditorStore(0);

/** 0..1. Called from the recorder's meter loop (and 0 when the meter stops). */
export function setRecordingLevel(level) {
  const next = Number.isFinite(level) ? level : 0;
  store.setState(next);
}

/** The current level without subscribing — for event handlers / imperatives. */
export function getRecordingLevel() {
  return store.getState();
}

/** Subscribe to the level (re-renders on every change). */
export function useRecordingLevel() {
  return useSelectorFromStore(store, (level) => level);
}

/** The raw store, for anything that needs to subscribe by hand. */
export function getRecordingLevelStore() {
  return store;
}
