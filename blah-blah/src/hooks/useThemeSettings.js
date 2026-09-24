import { useCallback, useEffect, useState } from 'react';
import {
  THEME_DEFAULTS,
  applyThemeSettings,
  clearAppliedTheme,
  loadThemeSettings,
  notifyThemeChanged,
  saveThemeSettings,
} from '../services/themeSettings';

/**
 * useThemeSettings — live copy of the persisted theme (Settings -> Appearance).
 *
 * Owned by App so the Settings modal and the app itself read the SAME state:
 * picking a theme applies on the very next render, with no reload. The state
 * only owns the CHOICES (preset ids, custom colours, modes); the ramps they
 * imply are derived in services/themeSettings.js.
 *
 * The effect does two things, in order:
 *   1. writes every ramp onto <html> as inline CSS custom properties, which is
 *      what re-colours the app — every stylesheet reads var(--unity-*);
 *   2. broadcasts THEME_CHANGED_EVENT, for the handful of painters that CANNOT
 *      read a CSS variable: canvas waveforms and the curve editor. Those need a
 *      concrete colour string, and a re-render, which CSS alone cannot trigger.
 *
 * main.jsx also calls applyThemeSettings() before the first render so the
 * stored theme is on screen from the first paint (this hook's effect would
 * otherwise let one default-coloured frame through).
 */
export function useThemeSettings() {
  const [themeSettings, setThemeSettings] = useState(() => loadThemeSettings());

  useEffect(() => {
    applyThemeSettings(themeSettings);
    notifyThemeChanged(themeSettings);
  }, [themeSettings]);

  const updateThemeSettings = useCallback((next) => {
    // saveThemeSettings sanitizes (unknown preset ids, malformed hex, unknown
    // modes, out-of-range numbers) and returns exactly what was stored, so
    // state never holds a value that wouldn't survive a reload.
    setThemeSettings(saveThemeSettings(next));
  }, []);

  const resetThemeSettings = useCallback(() => {
    // The stored defaults are a real theme, so resetting writes them rather
    // than clearing the overrides — the two are equivalent values, but writing
    // them keeps load/save/apply on one code path.
    setThemeSettings(saveThemeSettings({ ...THEME_DEFAULTS }));
  }, []);

  /** Remove the inline overrides entirely; `:root` in index.css takes over. */
  const clearTheme = useCallback(() => {
    clearAppliedTheme();
    const defaults = saveThemeSettings({ ...THEME_DEFAULTS });
    notifyThemeChanged(defaults);
    setThemeSettings(defaults);
  }, []);

  return { themeSettings, updateThemeSettings, resetThemeSettings, clearTheme };
}
