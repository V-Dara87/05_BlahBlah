import { createEditorStore, useSelectorFromStore } from './editorStore';

/**
 * The Silence Remover's transient preview (which clips have which cuts), outside
 * React state.
 *
 * WHY. It is a preview — never persisted, never undoable — and it was part of
 * App's `editorData`, so every tick of the panel (dragging a threshold)
 * re-rendered all dock panels. Only the timeline draws it, so only the timeline
 * panel subscribes now.
 *
 * Shape: `{ targetType: 'clip'|'track', targetId, cuts } | null`.
 */
const store = createEditorStore(null);

/** Replace the preview (`null` clears it). */
export function setSilencePreview(data) {
  store.setState(data || null);
}

/** The current preview without subscribing. */
export function getSilencePreview() {
  return store.getState();
}

/** Subscribe to the preview. */
export function useSilencePreview() {
  return useSelectorFromStore(store, (value) => value);
}
