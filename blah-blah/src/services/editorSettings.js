import { DEFAULT_PIXELS_PER_SECOND } from '../types';
 
/**
 * Persisted editor settings (Settings modal -> "Timeline" tab, added in the
 * next step). Global (not per project) and kept in localStorage, same pattern
 * as autosaveSettings.js / audioSettings.js / keybindSettings.js.
 *
 * Every default below is the value the app hard-codes today, so loading the
 * defaults changes nothing about how the editor behaves.
 *
 *  - snappingEnabled         Whether clips snap to edges/playhead when a
 *                            project opens. (The header toggle still flips it
 *                            for the current session; this is the starting
 *                            value. Was `useState(true)` in App.jsx.)
 *  - pixelsPerSecond         Timeline zoom when a project opens (40 = 100%).
 *                            Was DEFAULT_PIXELS_PER_SECOND in types.js.
 *  - defaultClipDurationSec  Length of a clip created without a natural
 *                            length (empty clip, prefab, script clip). Was a
 *                            hard-coded `duration: 5` in useEntityActions.js.
 *  - undoHistoryLimit        How many undo steps are kept. Was HISTORY_LIMIT
 *                            in useUndoableState.js.
 *
 * Bounds (exported so the Settings tab and the sanitizer can never disagree):
 *  - Zoom is limited to 10..160, the range EVERY zoom control can reach. The
 *    header +/- buttons stop at 10 and 160, while Ctrl+wheel and the keyboard
 *    go wider (4..240); a starting zoom outside 10..160 would make the first
 *    header-button click jump.
 *  - Clip length 0.5..600 s and undo depth 10..500 are limits chosen here to
 *    keep the app usable (a 0-length clip is invisible; an unbounded history
 *    holds every snapshot in memory), not limits inherited from elsewhere.
 */
 
const STORAGE_KEY = 'blahblah.editorSettings.v1';
 
export const EDITOR_DEFAULTS = Object.freeze({
  snappingEnabled: true,
  pixelsPerSecond: DEFAULT_PIXELS_PER_SECOND,
  defaultClipDurationSec: 5,
  undoHistoryLimit: 100,
});
 
export const EDITOR_MIN_PIXELS_PER_SECOND = 10;
export const EDITOR_MAX_PIXELS_PER_SECOND = 160;
export const EDITOR_MIN_CLIP_DURATION_SEC = 0.5;
export const EDITOR_MAX_CLIP_DURATION_SEC = 600;
export const EDITOR_MIN_UNDO_LIMIT = 10;
export const EDITOR_MAX_UNDO_LIMIT = 500;
 
/**
 * Coerce a stored value into a clamped, rounded number, or `fallback` when it
 * is not a usable number. Only real numbers and non-empty numeric strings
 * count: null, '', true, [] and {} all fall back instead of silently turning
 * into 0 or 1 (which `Number()` alone would do).
 */
function toClampedNumber(value, min, max, fallback, decimals = 0) {
  const isNumeric =
    typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  const n = isNumeric ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const factor = 10 ** decimals;
  return Math.min(max, Math.max(min, Math.round(n * factor) / factor));
}
 
/** Coerce any stored/partial value into a complete, in-range settings object. */
export function sanitizeEditorSettings(candidate) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  return {
    snappingEnabled:
      typeof c.snappingEnabled === 'boolean' ? c.snappingEnabled : EDITOR_DEFAULTS.snappingEnabled,
    pixelsPerSecond: toClampedNumber(
      c.pixelsPerSecond,
      EDITOR_MIN_PIXELS_PER_SECOND,
      EDITOR_MAX_PIXELS_PER_SECOND,
      EDITOR_DEFAULTS.pixelsPerSecond
    ),
    defaultClipDurationSec: toClampedNumber(
      c.defaultClipDurationSec,
      EDITOR_MIN_CLIP_DURATION_SEC,
      EDITOR_MAX_CLIP_DURATION_SEC,
      EDITOR_DEFAULTS.defaultClipDurationSec,
    ),
    undoHistoryLimit: toClampedNumber(
      c.undoHistoryLimit,
      EDITOR_MIN_UNDO_LIMIT,
      EDITOR_MAX_UNDO_LIMIT,
      EDITOR_DEFAULTS.undoHistoryLimit
    ),
  };
}
 
export function loadEditorSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EDITOR_DEFAULTS };
    return sanitizeEditorSettings(JSON.parse(raw));
  } catch {
    return { ...EDITOR_DEFAULTS };
  }
}
 
/** Persists and returns the sanitized settings that were actually stored. */
export function saveEditorSettings(settings) {
  const sanitized = sanitizeEditorSettings(settings);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage errors (private browsing, quota, etc.)
  }
  return sanitized;
}