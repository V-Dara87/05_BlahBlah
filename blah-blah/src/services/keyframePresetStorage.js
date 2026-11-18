/**
 * App-wide store for the Dopesheet's keyframe presets (see engine/keyframePresets.js).
 * They live in the editor's localStorage, so they are available in every project;
 * Export / Import in the Presets menu moves them between machines as files.
 */
import { readJson, writeJson } from '../utils/appStorage';
import { normalizePreset } from '../engine/keyframePresets';

const KEY = 'blahblah.keyframePresets.v1';

/** The saved presets (anything unreadable is dropped). */
export function loadKeyframePresets() {
  const raw = readJson(KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      const clean = normalizePreset(p);
      // normalizePreset hands out a fresh id; keep the stored one so references stay stable.
      return clean ? { ...clean, id: typeof p.id === 'string' ? p.id : clean.id } : null;
    })
    .filter(Boolean);
}

/** Persist the list. Returns false when it only reached the in-memory fallback. */
export function saveKeyframePresets(presets) {
  return writeJson(KEY, presets);
}