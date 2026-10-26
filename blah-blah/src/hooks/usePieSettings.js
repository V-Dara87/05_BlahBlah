import { useCallback, useEffect, useState } from 'react';
import {
  PIE_SETTINGS_EVENT,
  loadPieSettings,
  savePieSettings,
} from '../services/pieMenuSettings';

/**
 * usePieSettings — live copy of the persisted radial-menu settings
 * (Settings -> Radial Menu).
 *
 * Owned by App so the Settings modal reads the same state the wheel uses. The
 * wheel (components/pie/PieMenu.jsx) listens to PIE_SETTINGS_EVENT itself, and
 * so does this hook, which is what makes "Reset all settings" (it calls
 * resetPieSettings directly, not through here) update the open tab at once.
 */
export function usePieSettings() {
  const [pieSettings, setPieSettings] = useState(() => loadPieSettings());

  useEffect(() => {
    const onChanged = (e) => setPieSettings(e.detail || loadPieSettings());
    window.addEventListener(PIE_SETTINGS_EVENT, onChanged);
    return () => window.removeEventListener(PIE_SETTINGS_EVENT, onChanged);
  }, []);

  const updatePieSettings = useCallback((next) => {
    // savePieSettings sanitizes, stores and broadcasts; the event listener
    // above then updates state, so there is a single path for every change.
    savePieSettings(next);
  }, []);

  return { pieSettings, updatePieSettings };
}