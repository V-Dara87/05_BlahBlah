/**
 * Imperative external store for wet-preview state.
 *
 * Playback and audio elements must not drive React state every frame. This
 * store only changes when a bounce becomes available or a chain is edited;
 * `useMediaSync` reads the stable `active` flag directly to suppress dry audio,
 * and the mixer subscribes for status badges.
 */

import { useSyncExternalStore } from 'react';

let state = { byTrack: {}, revision: 0 };
let actions = null;
const listeners = new Set();

function emit() {
  for (const listener of Array.from(listeners)) listener();
}

export function subscribeTrackFx(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTrackFxState() {
  return state;
}

export function getTrackFxEntry(trackId) {
  return state.byTrack[trackId] || null;
}

export function setTrackFxEntry(trackId, entry) {
  if (!trackId) return;
  const current = state.byTrack[trackId];
  if (current === entry) return;
  state = {
    byTrack: { ...state.byTrack, [trackId]: entry },
    revision: state.revision + 1,
  };
  emit();
}

export function patchTrackFxEntry(trackId, patch) {
  const current = state.byTrack[trackId] || {};
  setTrackFxEntry(trackId, { ...current, ...patch });
}

export function clearTrackFxEntry(trackId) {
  if (!trackId || !state.byTrack[trackId]) return;
  const byTrack = { ...state.byTrack };
  delete byTrack[trackId];
  state = { byTrack, revision: state.revision + 1 };
  emit();
}

/** Dry preview is muted only while a ready wet file exists for this track. */
export function isTrackFxPreviewActive(trackId) {
  const entry = state.byTrack[trackId];
  return !!(entry?.active && entry?.path);
}

export function setTrackFxActions(nextActions) {
  if (actions === nextActions) return;
  actions = nextActions;
  emit();
}

export function getTrackFxActions() {
  return actions;
}

export function useTrackFxEntry(trackId) {
  return useSyncExternalStore(
    subscribeTrackFx,
    () => getTrackFxEntry(trackId),
    () => getTrackFxEntry(trackId)
  );
}

export function useTrackFxRevision() {
  return useSyncExternalStore(
    subscribeTrackFx,
    () => state.revision,
    () => state.revision
  );
}
