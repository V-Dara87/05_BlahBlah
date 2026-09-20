import { useCallback, useState } from 'react';
import { loadAutosaveSettings, saveAutosaveSettings } from '../services/autosaveSettings';
 
/**
 * useAutosaveSettings — live copy of the persisted autosave settings.
 *
 * Owned by App so the autosave hook (useProjectAutosave) and the Settings
 * modal read the SAME state: changing a value in the modal takes effect on
 * the very next render, with no reload and no event bus.
 */
export function useAutosaveSettings() {
  const [autosaveSettings, setAutosaveSettings] = useState(() => loadAutosaveSettings());
 
  const updateAutosaveSettings = useCallback((next) => {
    // saveAutosaveSettings sanitizes (clamps the delay, fills missing keys)
    // and returns exactly what was stored, so state never holds a value that
    // wouldn't survive a reload.
    setAutosaveSettings(saveAutosaveSettings(next));
  }, []);
 
  return { autosaveSettings, updateAutosaveSettings };
}