import { useEffect, useState } from 'react';
import {
  getLiveThemeSettings,
  resolveWaveformColor,
  subscribeThemeChanges,
} from '../services/themeSettings';

/**
 * useWaveformColor — the resolved audio-waveform colour for one clip category.
 *
 * WHY THIS IS A SUBSCRIPTION AND NOT A CSS VARIABLE
 *   The waveform is painted on a <canvas>. Canvas has no `var()`, so
 *   WaveformCanvas needs a concrete rgba() string -- and it needs a NEW string
 *   when the theme changes, or its draw effect never re-runs and the old colour
 *   stays on screen. The theme is applied as CSS custom properties on <html>,
 *   which React cannot observe, so App broadcasts a change event after applying
 *   (see services/themeSettings.js).
 *
 * WHY IT GOES THROUGH subscribeThemeChanges
 *   This hook runs once per rendered clip, so listening on `window` directly
 *   would register hundreds of listeners in a busy timeline. The service binds
 *   that one window listener for the whole app and hands subscribers a shared,
 *   cached settings object instead — the same pattern the keyboard-shortcut
 *   bindings use (see keybindSettings.js), but without the per-component cost.
 *
 * @param {string} category  clip category, only used by the 'clip' waveform
 *                           mode (a waveform takes its card's accent colour)
 */
export function useWaveformColor(category = 'audio') {
  const [settings, setSettings] = useState(getLiveThemeSettings);

  useEffect(() => subscribeThemeChanges(setSettings), []);

  return resolveWaveformColor(settings, category);
}
