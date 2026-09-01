import { useEffect } from 'react';
import { usePlaybackStore } from '../hooks/PlaybackContext';

/**
 * Keyboard shortcuts that need live playback state. Lives inside
 * PlaybackProvider so App itself never re-renders on every rAF tick.
 */
export function EditorPlaybackShortcuts({
  selectedEntityId,
  onSplitSelected,
  onDeleteSelected,
  onSaveProject,
  onUndo,
  onRedo,
  onToggleSnapping,
  onZoomIn,
  onZoomOut,
}) {
  const store = usePlaybackStore();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        onSaveProject();
        return;
      }

      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        onUndo();
      } else if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        onRedo();
      } else if (e.code === 'Space') {
        e.preventDefault();
        store.togglePlay();
      } else if (e.key === 'c' || e.key === 'C' || e.key === 's' || e.key === 'S') {
        if (selectedEntityId) {
          e.preventDefault();
          onSplitSelected();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEntityId) {
          e.preventDefault();
          onDeleteSelected();
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const t = store.getCurrentTime();
        store.seek(t - (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const t = store.getCurrentTime();
        store.seek(t + (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === 'n' || e.key === 'N') {
        onToggleSnapping();
      } else if (e.key === '=' || e.key === '+') {
        onZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        onZoomOut();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    store,
    selectedEntityId,
    onSplitSelected,
    onDeleteSelected,
    onSaveProject,
    onUndo,
    onRedo,
    onToggleSnapping,
    onZoomIn,
    onZoomOut,
  ]);

  return null;
}
