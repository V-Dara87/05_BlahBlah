import { useCallback, useState } from 'react';
import { loadAsrSettings, saveAsrSettings } from '../services/asrSettings';

/**
 * useAsrSettings — live copy of the persisted speech-recognition settings.
 *
 * Owned by App so the Settings tab and anything else reading the value share
 * one source of truth. The Qwen3-ASR runner also reads the stored value
 * directly (services/asrSettings.js) at spawn time, so a change made here
 * applies to the very next transcription.
 */
export function useAsrSettings() {
  const [asrSettings, setAsrSettings] = useState(() => loadAsrSettings());

  const updateAsrSettings = useCallback((next) => {
    setAsrSettings(saveAsrSettings(next));
  }, []);

  return { asrSettings, updateAsrSettings };
}
