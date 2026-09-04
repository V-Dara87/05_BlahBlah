import { useEffect } from 'react';
import { usePlaybackStore } from '../hooks/PlaybackContext';

/**
 * Keyboard shortcuts that need live playback state. Lives inside
 * PlaybackProvider so App itself never re-renders on every rAF tick.
 */
export function EditorPlaybackShortcuts({
  entities = [],
  selectedEntityId,
  selectedIds = [],
  onSplitSelected,
  onDeleteSelected,
  onDeleteMultiple,
  onDuplicateSelected,
  onGroupSelected,
  onUngroupSelected,
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

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Allow shortcuts if not in text input fields
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) {
        return;
      }

      // Save: Ctrl+S
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        onSaveProject();
        return;
      }

      // Select All: Ctrl+A
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        onSelectAll?.();
        return;
      }

      // Duplicate: Ctrl+D
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        onDuplicateSelected?.();
        return;
      }

      // Group: Ctrl+G / Ungroup: Ctrl+Shift+G
      if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) {
          onUngroupSelected?.();
        } else {
          onGroupSelected?.();
        }
        return;
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        onUndo();
        return;
      } else if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        onRedo();
        return;
      }

      // Deselect: Escape
      if (e.key === 'Escape') {
        onClearSelection?.();
        return;
      }

      // Play / Pause
      if (e.code === 'Space') {
        e.preventDefault();
        store.togglePlay();
        return;
      }

      // Split clip(s): C or S (without Ctrl)
      if (!e.ctrlKey && !e.metaKey && (e.key === 'c' || e.key === 'C' || e.key === 's' || e.key === 'S')) {
        if (selectedIds.length > 0 || selectedEntityId) {
          e.preventDefault();
          onSplitSelected();
        }
        return;
      }

      // Delete clip(s)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0 || selectedEntityId) {
          e.preventDefault();
          if (selectedIds.length > 1) {
            onDeleteMultiple();
          } else {
            onDeleteSelected();
          }
        }
        return;
      }

      // Seek Frame/Second: ArrowLeft / ArrowRight
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const t = store.getCurrentTime();
        store.seek(t - (e.shiftKey ? 1 : 1 / 30));
        return;
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const t = store.getCurrentTime();
        store.seek(t + (e.shiftKey ? 1 : 1 / 30));
        return;
      }

      // Jump to start / end: Home / End
      if (e.key === 'Home') {
        e.preventDefault();
        store.seek(0);
        return;
      } else if (e.key === 'End') {
        e.preventDefault();
        store.seek(totalDuration);
        return;
      }

      // Snapping: N
      if (e.key === 'n' || e.key === 'N') {
        onToggleSnapping();
        return;
      }

      // Zoom: + / -
      if (e.key === '=' || e.key === '+') {
        onZoomIn();
        return;
      } else if (e.key === '-' || e.key === '_') {
        onZoomOut();
        return;
      }

      // Export In / Out markers: I / O
      if (e.key === 'i' || e.key === 'I') {
        const t = store.getCurrentTime();
        const out = exportRange?.out ?? totalDuration;
        const finalOut = t >= out ? Math.max(t + 1, totalDuration) : out;
        onSetExportRange({ in: t, out: finalOut });
        return;
      } else if (e.key === 'o' || e.key === 'O') {
        const t = store.getCurrentTime();
        const inp = exportRange?.in ?? 0;
        const finalIn = t <= inp ? Math.max(0, t - 1) : inp;
        onSetExportRange({ in: finalIn, out: t });
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
    onDuplicateSelected,
    onGroupSelected,
    onUngroupSelected,
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
