/**
 * Persisted settings + pure helpers for the radial ("pie") menu
 * (components/pie/PieMenu.jsx, Settings -> Radial Menu).
 *
 * Same localStorage-backed pattern as keybindSettings.js / autosaveSettings.js:
 * a versioned key, a sanitize() that fills missing/invalid values, and a
 * same-tab broadcast event so the live menu picks up a change immediately.
 *
 * The wheel is app-wide, not per project: you build it once and it works for
 * every project you open.
 */

const STORAGE_KEY = 'blahblah.pieMenuSettings.v1';
export const PIE_SETTINGS_EVENT = 'blahblah:pie-menu-changed';

/** One wheel, eight slices (the Blender pie layout). */
export const PIE_SLOT_COUNT = 8;

/** Slice 0 starts at 12 o'clock and the wheel turns clockwise. */
export const PIE_START_ANGLE = -90;

/**
 * How a slice is confirmed.
 *   release - hold the shortcut, move onto a slice, let go (Blender's gesture)
 *   click   - hover to highlight, then click (releasing the key does nothing)
 *   hover   - run the moment the cursor enters a slice
 */
export const PIE_ACTIVATE_MODES = [
  {
    id: 'release',
    label: 'Hold to show, release to run',
    hint: 'The wheel is only there while you hold the shortcut. Hover a slice and let go to run it; let go without a slice and the wheel just closes.',
  },
  {
    id: 'click',
    label: 'Click a slice',
    hint: 'Hover to highlight, then click. Letting go of the shortcut does nothing.',
  },
  {
    id: 'hover',
    label: 'Run on hover',
    hint: 'The slice runs the moment the cursor moves into it - no click or release needed.',
  },
];

// Clockwise from the top: playback first, then the editing moves you reach for.
export const DEFAULT_PIE_SLOTS = [
  'togglePlay',
  'splitSelected',
  'deleteSelected',
  'undo',
  'saveProject',
  'redo',
  'duplicateSelected',
  'selectAll',
];

export const DEFAULT_PIE_HOTKEY = Object.freeze({ ctrl: false, alt: false, shift: false, key: 'tab' });

export const PIE_DEFAULTS = Object.freeze({
  enabled: true,
  hotkey: DEFAULT_PIE_HOTKEY,
  mode: 'release',
  slots: DEFAULT_PIE_SLOTS,
});

// ---- Hotkey helpers --------------------------------------------------------

const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'altgraph', 'os', 'capslock']);

// Keys that are safe to bind on their own because they do not type text, so
// they never swallow normal typing the way a bare letter would. This is what
// lets Tab (or an F-key) open the wheel without a modifier.
const BARE_KEYS = new Set(['tab']);
for (let i = 1; i <= 24; i += 1) BARE_KEYS.add(`f${i}`);

export function isBareKeyAllowed(key) {
  return BARE_KEYS.has(String(key || '').toLowerCase());
}

export function normalizeHotkey(hotkey) {
  const h = hotkey && typeof hotkey === 'object' ? hotkey : {};
  const key = typeof h.key === 'string' && h.key.trim()
    ? h.key.trim().toLowerCase()
    : DEFAULT_PIE_HOTKEY.key;
  const mods = { ctrl: !!h.ctrl, alt: !!h.alt, shift: !!h.shift };
  // A bare letter would steal normal typing, so it gets Alt added.
  if (!mods.ctrl && !mods.alt && !mods.shift && !isBareKeyAllowed(key)) mods.alt = true;
  return { ...mods, key };
}

const KEY_LABELS = { tab: 'Tab', escape: 'Esc', space: 'Space' };

function keyLabel(key) {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  const fn = /^f([1-9]|1[0-9]|2[0-4])$/.exec(key);
  if (fn) return `F${fn[1]}`;
  return key.length === 1 ? key.toUpperCase() : key;
}

/** "Tab", "Alt+Q", "Ctrl+Shift+P", "F5", ... */
export function formatHotkey(hotkey) {
  const h = normalizeHotkey(hotkey);
  const parts = [];
  if (h.ctrl) parts.push('Ctrl');
  if (h.alt) parts.push('Alt');
  if (h.shift) parts.push('Shift');
  parts.push(keyLabel(h.key));
  return parts.join('+');
}

/**
 * Turn a keydown into a binding, for the "press keys" recorder in Settings.
 * Returns null for modifier-only presses, Escape, and bare keys that are not
 * allowed on their own.
 */
export function hotkeyFromEvent(e) {
  const key = String(e.key || '').toLowerCase();
  if (!key || MODIFIER_KEYS.has(key) || key === 'escape') return null;
  const ctrl = !!e.ctrlKey || !!e.metaKey;
  const alt = !!e.altKey;
  const shift = !!e.shiftKey;
  if (!ctrl && !alt && !shift && !isBareKeyAllowed(key)) return null;
  return { ctrl, alt, shift, key };
}

export function matchesHotkey(e, hotkey) {
  const h = normalizeHotkey(hotkey);
  return String(e.key || '').toLowerCase() === h.key
    && (!!e.ctrlKey || !!e.metaKey) === h.ctrl
    && !!e.altKey === h.alt
    && !!e.shiftKey === h.shift;
}

// ---- Settings load / save --------------------------------------------------

export function normalizePieSlots(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  for (let i = 0; i < PIE_SLOT_COUNT; i += 1) {
    out.push(typeof arr[i] === 'string' ? arr[i] : '');
  }
  return out;
}

export function normalizeActivateMode(mode) {
  return PIE_ACTIVATE_MODES.some((m) => m.id === mode) ? mode : PIE_DEFAULTS.mode;
}

/** Clamp/fill a (possibly partial or hand-edited) settings blob. */
export function sanitizePieSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : PIE_DEFAULTS.enabled,
    hotkey: normalizeHotkey(r.hotkey ?? PIE_DEFAULTS.hotkey),
    mode: normalizeActivateMode(r.mode),
    slots: normalizePieSlots(r.slots ?? PIE_DEFAULTS.slots),
  };
}

export function loadPieSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return sanitizePieSettings(null);
    return sanitizePieSettings(JSON.parse(raw));
  } catch {
    return sanitizePieSettings(null);
  }
}

export function savePieSettings(settings) {
  const clean = sanitizePieSettings(settings);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Ignore storage errors (private browsing, quota, etc.)
  }
  // Same-tab localStorage writes do not fire the native 'storage' event, so
  // broadcast our own for the live menu and the Settings tab.
  window.dispatchEvent(new CustomEvent(PIE_SETTINGS_EVENT, { detail: clean }));
  return clean;
}

export function resetPieSettings() {
  return savePieSettings(null);
}

// ---- Geometry --------------------------------------------------------------

/**
 * Which slice a pointer offset from the wheel centre lands on.
 * dx/dy are relative to the centre, in screen pixels.
 * Returns an index in [0, count), or null when the pointer is in the hub.
 */
export function sliceIndexForPoint(dx, dy, count = PIE_SLOT_COUNT, deadZone = 52) {
  if (!count || count <= 0) return null;
  if (Math.hypot(dx, dy) < deadZone) return null;
  const step = 360 / count;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const turned = (angle - PIE_START_ANGLE + 360) % 360;
  return Math.floor(turned / step) % count;
}