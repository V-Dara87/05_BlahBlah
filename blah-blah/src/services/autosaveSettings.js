/**
 * Persisted user-facing autosave settings (Settings modal -> "Autosave" tab).
 * Global (not per project) and kept in localStorage, same pattern as
 * audioSettings.js / keybindSettings.js.
 *
 *  - enabled        Master switch. Off = nothing is written to disk until the
 *                   user saves manually (File > Save Project).
 *  - delayMs        Quiet time after the LAST document change before a save is
 *                   attempted (debounce).
 *  - saveOnBlur     Also flush any pending change right away when the window
 *                   loses focus, the page is hidden, or the app is closing.
 *  - skipUnchanged  Don't rewrite project.json / prefab files whose content is
 *                   identical to what was last written. Scripts are always
 *                   compared against the disk copy regardless of this switch,
 *                   because that comparison is what keeps external edits safe.
 */
 
const STORAGE_KEY = 'blahblah.autosaveSettings.v1';
 
export const AUTOSAVE_DEFAULTS = Object.freeze({
  enabled: true,
  delayMs: 2000,
  saveOnBlur: true,
  skipUnchanged: true,
});
 
export const AUTOSAVE_MIN_DELAY_MS = 500;
export const AUTOSAVE_MAX_DELAY_MS = 30000;
export const AUTOSAVE_DELAY_PRESETS_MS = [500, 1000, 2000, 5000, 10000, 30000];
 
/**
 * Upper bound on how long a continuous burst of edits can postpone a save.
 * Without it, a debounce that keeps getting reset (e.g. dragging a slider
 * for a minute) would never save at all.
 */
export function getAutosaveMaxWaitMs(delayMs) {
  return Math.max(delayMs * 5, 10000);
}
 
/** Coerce any stored/partial value into a complete, in-range settings object. */
export function sanitizeAutosaveSettings(candidate) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const rawDelay = Number(c.delayMs);
  const delayMs = Number.isFinite(rawDelay)
    ? Math.min(AUTOSAVE_MAX_DELAY_MS, Math.max(AUTOSAVE_MIN_DELAY_MS, Math.round(rawDelay)))
    : AUTOSAVE_DEFAULTS.delayMs;
  return {
    enabled: typeof c.enabled === 'boolean' ? c.enabled : AUTOSAVE_DEFAULTS.enabled,
    delayMs,
    saveOnBlur: typeof c.saveOnBlur === 'boolean' ? c.saveOnBlur : AUTOSAVE_DEFAULTS.saveOnBlur,
    skipUnchanged:
      typeof c.skipUnchanged === 'boolean' ? c.skipUnchanged : AUTOSAVE_DEFAULTS.skipUnchanged,
  };
}
 
export function loadAutosaveSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...AUTOSAVE_DEFAULTS };
    return sanitizeAutosaveSettings(JSON.parse(raw));
  } catch {
    return { ...AUTOSAVE_DEFAULTS };
  }
}
 
/** Persists and returns the sanitized settings that were actually stored. */
export function saveAutosaveSettings(settings) {
  const sanitized = sanitizeAutosaveSettings(settings);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage errors (private browsing, quota, etc.)
  }
  return sanitized;
}