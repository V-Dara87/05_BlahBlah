/**
 * Persisted, user-customizable keyboard shortcuts (Settings modal ->
 * Keyboard Shortcuts tab). Same localStorage-backed pattern as
 * audioSettings.js — survives reloads without needing a project folder.
 *
 * A "binding" is stored as the normalized string produced by
 * normalizeKeyEvent() below, e.g. "Ctrl+Shift+Z", "Space", "Delete", "C".
 * Modifier order is always Ctrl -> Alt -> Shift -> Meta, so comparisons
 * are always plain string equality — no need to re-parse/re-order at
 * match time.
 */
 
const STORAGE_KEY = 'blahblah.keybindSettings.v1';
 
// Every rebindable action, with its id (used everywhere in code), a
// human label for the Settings UI, the group it's shown under, and its
// factory-default binding. Add new shortcuts here — EditorPlaybackShortcuts
// and the File/Edit menu config both read from this single source of
// truth instead of hardcoding key literals, so a new entry here is
// immediately rebindable with no other code changes needed.
export const SHORTCUT_ACTIONS = [
  // Project
  { id: 'saveProject', label: 'Save Project', group: 'Project', default: 'Ctrl+S' },
  { id: 'undo', label: 'Undo', group: 'Project', default: 'Ctrl+Z' },
  { id: 'redo', label: 'Redo', group: 'Project', default: 'Ctrl+Shift+Z' },
 
  // Selection
  { id: 'selectAll', label: 'Select All', group: 'Selection', default: 'Ctrl+A' },
  { id: 'clearSelection', label: 'Deselect', group: 'Selection', default: 'Escape' },
  { id: 'duplicateSelected', label: 'Duplicate Clip', group: 'Selection', default: 'Ctrl+D' },
 
  // Timeline editing
  { id: 'splitSelected', label: 'Split Clip (Cut)', group: 'Timeline', default: 'C' },
  { id: 'deleteSelected', label: 'Delete Clip', group: 'Timeline', default: 'Delete' },
  { id: 'toggleSnapping', label: 'Toggle Snapping', group: 'Timeline', default: 'N' },
  { id: 'zoomIn', label: 'Zoom In', group: 'Timeline', default: '=' },
  { id: 'zoomOut', label: 'Zoom Out', group: 'Timeline', default: '-' },
  { id: 'setInPoint', label: 'Set Export In Point', group: 'Timeline', default: 'I' },
  { id: 'setOutPoint', label: 'Set Export Out Point', group: 'Timeline', default: 'O' },
 
  // Playback
  { id: 'togglePlay', label: 'Play / Pause', group: 'Playback', default: 'Space' },
  { id: 'seekBack', label: 'Step Back', group: 'Playback', default: 'ArrowLeft' },
  { id: 'seekForward', label: 'Step Forward', group: 'Playback', default: 'ArrowRight' },
  { id: 'jumpToStart', label: 'Jump to Start', group: 'Playback', default: 'Home' },
  { id: 'jumpToEnd', label: 'Jump to End', group: 'Playback', default: 'End' },
];
 
const DEFAULT_BINDINGS = Object.fromEntries(
  SHORTCUT_ACTIONS.map((a) => [a.id, a.default])
);
 
/**
 * Normalizes a KeyboardEvent into the canonical binding string this
 * module stores and compares against. Modifier order is fixed (Ctrl,
 * Alt, Shift, Meta) so the same physical combo always produces the same
 * string regardless of the order keys were physically pressed in.
 * Letter keys are upper-cased; everything else uses e.key as-is (so
 * 'ArrowLeft', 'Escape', 'Delete', ' ' -> 'Space', etc. all come through
 * consistently).
 */
export function normalizeKeyEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
 
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
 
  // Bare modifier presses (user tapped just Ctrl/Shift/etc.) aren't a
  // valid binding on their own — caller should ignore these and keep
  // listening rather than recording a modifier-only combo.
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
 
  parts.push(key);
  return parts.join('+');
}
 
export function loadKeybindSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BINDINGS };
    const parsed = JSON.parse(raw);
    // Merge over defaults rather than trusting the stored blob wholesale,
    // so a shortcut added in a later app version (not present in an
    // older saved blob) still gets its default instead of being
    // undefined.
    return { ...DEFAULT_BINDINGS, ...parsed };
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}
 
export function saveKeybindSettings(bindings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Ignore storage errors (private browsing, quota, etc.)
  }
  // Same-tab localStorage writes don't fire the native 'storage' event
  // (that only fires in OTHER tabs), so broadcast our own event to let
  // EditorPlaybackShortcuts (and anything else reading bindings) pick up
  // the change immediately without needing a reload.
  window.dispatchEvent(new CustomEvent('blahblah:keybinds-changed', { detail: bindings }));
}
 
export function resetKeybindSettings() {
  saveKeybindSettings({ ...DEFAULT_BINDINGS });
  return { ...DEFAULT_BINDINGS };
}
 
export function getDefaultBinding(actionId) {
  return DEFAULT_BINDINGS[actionId];
}
 
/** True if `binding` is already assigned to a different action than `excludeActionId`. */
export function findConflict(bindings, binding, excludeActionId) {
  const entry = Object.entries(bindings).find(
    ([id, b]) => id !== excludeActionId && b === binding
  );
  return entry ? entry[0] : null;
}