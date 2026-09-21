import { useCallback, useState } from 'react';
import { loadExportSettings, saveExportSettings } from '../services/exportSettings';
 
/**
 * useExportSettings — live copy of the persisted default export options.
 *
 * Owned by App so the Export dialog and the Settings modal read the SAME
 * state: a default changed in Settings is what the very next export dialog
 * opens with, with no reload and no event bus.
 */
export function useExportSettings() {
  const [exportSettings, setExportSettings] = useState(() => loadExportSettings());
 
  const updateExportSettings = useCallback((next) => {
    // saveExportSettings sanitizes (drops unknown ids, fills missing keys)
    // and returns exactly what was stored, so state never holds a value that
    // wouldn't survive a reload.
    setExportSettings(saveExportSettings(next));
  }, []);
 
  return { exportSettings, updateExportSettings };
}