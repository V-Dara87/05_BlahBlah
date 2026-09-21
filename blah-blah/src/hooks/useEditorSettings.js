import { useCallback, useState } from 'react';
import { loadEditorSettings, saveEditorSettings } from '../services/editorSettings';
 
/**
 * useEditorSettings — live copy of the persisted editor settings.
 *
 * Owned by App so anything that needs them (the timeline's starting zoom and
 * snapping, new-clip length, undo depth) and the Settings modal read the SAME
 * state: changing a value in the modal takes effect on the very next render,
 * with no reload and no event bus.
 *
 * Call this BEFORE useProjectStore in App.jsx: the store creates its undo
 * history there, so the undo depth has to be known by then.
 */
export function useEditorSettings() {
  const [editorSettings, setEditorSettings] = useState(() => loadEditorSettings());
 
  const updateEditorSettings = useCallback((next) => {
    // saveEditorSettings sanitizes (clamps numbers, fills missing keys) and
    // returns exactly what was stored, so state never holds a value that
    // wouldn't survive a reload.
    setEditorSettings(saveEditorSettings(next));
  }, []);
 
  return { editorSettings, updateEditorSettings };
}