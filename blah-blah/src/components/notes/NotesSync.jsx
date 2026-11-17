import { useEffect, useRef } from 'react';
import { useEditorSelector, useEditorStore } from '../../hooks/editorStore';
import { usePlaybackStore } from '../../hooks/PlaybackContext';
import { useEditorActions } from '../../dock/EditorContext';
import { loadKeybindSettings, normalizeKeyEvent } from '../../services/keybindSettings';
import { configureNotes, addNoteAtPlayhead } from '../../hooks/notesStore';
import { toggleDrawing, undoShape, cancelDrawing, isDrawingActive } from '../../hooks/noteDrawStore';

/**
 * Headless. Mounted once by DockLayout so notes work whether or not the Notes
 * tab is open: it tells the notes store which project folder is open and how to
 * read the editor state / playhead, and owns the "add note" shortcuts.
 *
 * The shortcuts are listed in services/keybindSettings.js (so they show up in
 * Settings -> Keyboard Shortcuts and can be rebound); EditorPlaybackShortcuts
 * ignores ids it does not know, so handling them here does not double-fire.
 */
export function NotesSync() {
  const editorStore = useEditorStore();
  const playback = usePlaybackStore();
  const { focusDockPanel } = useEditorActions();
  const projectFolderHandle = useEditorSelector((s) => s.projectFolderHandle);
  const projectDir = projectFolderHandle?.path || null;

  const focusRef = useRef(focusDockPanel);
  focusRef.current = focusDockPanel;

  useEffect(
    () =>
      configureNotes({
        projectDir,
        getEditorState: () => editorStore.getState(),
        getPlayback: () => playback,
        focusPanel: () => focusRef.current?.('notes'),
      }),
    [projectDir, editorStore, playback]
  );

  const bindingsRef = useRef(loadKeybindSettings());
  useEffect(() => {
    const onChanged = (e) => {
      bindingsRef.current = e.detail || loadKeybindSettings();
    };
    window.addEventListener('blahblah:keybinds-changed', onChanged);
    return () => window.removeEventListener('blahblah:keybinds-changed', onChanged);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.repeat) return;
      const target = e.target;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable) return;
      const binding = normalizeKeyEvent(e);
      if (!binding) return;
      const bindings = bindingsRef.current;
      const actionId = Object.keys(bindings).find((id) => bindings[id] === binding);
      if (actionId === 'addNote') {
        e.preventDefault();
        void addNoteAtPlayhead({ range: false });
      } else if (actionId === 'addRangeNote') {
        e.preventDefault();
        void addNoteAtPlayhead({ range: true });
      } else if (actionId === 'toggleNoteDraw') {
        e.preventDefault();
        toggleDrawing();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // While drawing marks on the preview, Ctrl+Z undoes the last mark (not the
  // project) and Esc stops drawing. Capture phase so the editor's own undo /
  // deselect shortcuts never see these keys.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!isDrawingActive()) return;
      const target = e.target;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable) return;
      const key = String(e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (key === 'z' && !e.shiftKey) undoShape();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancelDrawing();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return null;
}