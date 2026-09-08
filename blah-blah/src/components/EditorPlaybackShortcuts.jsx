import { useEffect, useRef } from 'react';
import { usePlaybackStore } from '../hooks/PlaybackContext';
import { loadKeybindSettings, normalizeKeyEvent } from '../services/keybindSettings';
 
/**
 * Keyboard shortcuts that need live playback state. Lives inside
 * PlaybackProvider so App itself never re-renders on every rAF tick.
 *
 * Key bindings are user-customizable (Settings -> Keyboard Shortcuts —
 * see services/keybindSettings.js for the source-of-truth action list
 * and services/keybindSettings.js's SHORTCUT_ACTIONS for the id/label/
 * default for each). This component no longer hardcodes any key
 * literals: it normalizes the incoming event the same way the Settings
 * UI normalizes a captured rebind, looks up which action (if any) owns
 * that binding, and dispatches to the matching handler below. Rebinding
 * a shortcut in Settings takes effect immediately via the
 * 'blahblah:keybinds-changed' event, no reload needed.
 */
export function EditorPlaybackShortcuts({
  entities = [],
  selectedEntityId,
  selectedIds = [],
  onSplitSelected,
  onDeleteSelected,
  onDeleteMultiple,
  onRippleDeleteBefore,
  onRippleDeleteAfter,
  onDuplicateSelected,
  onSelectAll,
  onClearSelection,
  onSaveProject,
  onUndo,
  onRedo,
  onToggleSnapping,
  onZoomIn,
  onZoomOut,
  onSetExportRange,
  exportRange,
  totalDuration,
}) {
  const store = usePlaybackStore();
 
  // Bindings are read via a ref (not React state) so a rebind in
  // Settings is picked up by the very next keydown without needing to
  // re-subscribe the window listener — the listener effect below still
  // only depends on the handler callbacks, same as before.
  const bindingsRef = useRef(loadKeybindSettings());
 
  useEffect(() => {
    const handleBindingsChanged = (e) => {
      bindingsRef.current = e.detail || loadKeybindSettings();
    };
    window.addEventListener('blahblah:keybinds-changed', handleBindingsChanged);
    return () => window.removeEventListener('blahblah:keybinds-changed', handleBindingsChanged);
  }, []);
 
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Allow shortcuts if not in text input fields
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) {
        return;
      }
 
      const binding = normalizeKeyEvent(e);
      if (!binding) return; // bare modifier key, not a real combo
 
      const bindings = bindingsRef.current;
      // Reverse-lookup: which action id (if any) is currently bound to
      // this exact combo. A handful of actions intentionally share a
      // default binding (Split's factory default is a bare 'W'; nothing
      // else uses that by default), so this still finds at most one
      // *currently assigned* action per combo since Settings enforces
      // one binding per key when the user rebinds (see SettingsModal's
      // conflict handling) — first match wins if that invariant were
      // ever violated by a hand-edited localStorage blob.
      const actionId = Object.keys(bindings).find((id) => bindings[id] === binding);
      if (!actionId) return;
 
      switch (actionId) {
        case 'saveProject':
          e.preventDefault();
          onSaveProject();
          return;
 
        case 'selectAll':
          e.preventDefault();
          onSelectAll?.();
          return;
 
        case 'duplicateSelected':
          e.preventDefault();
          onDuplicateSelected?.();
          return;
 
        case 'undo':
          e.preventDefault();
          onUndo();
          return;
 
        case 'redo':
          e.preventDefault();
          onRedo();
          return;
 
        case 'clearSelection':
          onClearSelection?.();
          return;
 
        case 'togglePlay':
          e.preventDefault();
          store.togglePlay();
          return;
 
        case 'splitSelected':
          if (selectedIds.length > 0 || selectedEntityId) {
            e.preventDefault();
            onSplitSelected();
          }
          return;
 
        case 'deleteSelected':
          if (selectedIds.length > 0 || selectedEntityId) {
            e.preventDefault();
            if (selectedIds.length > 1) {
              onDeleteMultiple();
            } else {
              onDeleteSelected();
            }
          }
          return;

        // Ripple trim the selected clip to the playhead — Q cuts off
        // everything in the clip before the playhead, E cuts off
        // everything after. Acts on a single anchor clip, so it's a
        // no-op with a multi-selection or no selection at all.
        case 'rippleDeleteBefore':
          if (selectedIds.length <= 1 && selectedEntityId) {
            e.preventDefault();
            onRippleDeleteBefore?.(selectedEntityId);
          }
          return;

        case 'rippleDeleteAfter':
          if (selectedIds.length <= 1 && selectedEntityId) {
            e.preventDefault();
            onRippleDeleteAfter?.(selectedEntityId);
          }
          return;
 
        case 'seekBack': {
          e.preventDefault();
          const t = store.getCurrentTime();
          store.seek(t - (e.shiftKey ? 1 : 1 / 30));
          return;
        }
 
        case 'seekForward': {
          e.preventDefault();
          const t = store.getCurrentTime();
          store.seek(t + (e.shiftKey ? 1 : 1 / 30));
          return;
        }
 
        case 'jumpToStart':
          e.preventDefault();
          store.seek(0);
          return;
 
        case 'jumpToEnd':
          e.preventDefault();
          store.seek(totalDuration);
          return;
 
        case 'toggleSnapping':
          onToggleSnapping();
          return;
 
        case 'zoomIn':
          onZoomIn();
          return;
 
        case 'zoomOut':
          onZoomOut();
          return;
 
        case 'setInPoint': {
          const t = store.getCurrentTime();
          const out = exportRange?.out ?? totalDuration;
          const finalOut = t >= out ? Math.max(t + 1, totalDuration) : out;
          onSetExportRange({ in: t, out: finalOut });
          return;
        }
 
        case 'setOutPoint': {
          const t = store.getCurrentTime();
          const inp = exportRange?.in ?? 0;
          const finalIn = t <= inp ? Math.max(0, t - 1) : inp;
          onSetExportRange({ in: finalIn, out: t });
          return;
        }
 
        default:
          return;
      }
    };
 
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    store,
    entities,
    selectedEntityId,
    selectedIds,
    onSplitSelected,
    onDeleteSelected,
    onDeleteMultiple,
    onRippleDeleteBefore,
    onRippleDeleteAfter,
    onDuplicateSelected,
    onSelectAll,
    onClearSelection,
    onSaveProject,
    onUndo,
    onRedo,
    onToggleSnapping,
    onZoomIn,
    onZoomOut,
    onSetExportRange,
    exportRange,
    totalDuration,
  ]);
 
  return null;
}