/**
 * Persisted user-facing audio settings (Settings modal).
 * Currently just the selected microphone/input device — kept in
 * localStorage so it survives reloads without needing a project folder.
 */
 
import { readJson, writeJson } from '../utils/appStorage.js';

const STORAGE_KEY = 'blahblah.audioSettings.v1';
 
export function loadAudioSettings() {
  const parsed = readJson(STORAGE_KEY, null);
  return {
    inputDeviceId: parsed?.inputDeviceId || 'default',
  };
}
 
export function saveAudioSettings(settings) {
  writeJson(STORAGE_KEY, settings);
}
 
/**
 * List available audio input devices. Requires a prior getUserMedia
 * grant for device labels to be populated (otherwise devices come back
 * with blank labels) — callers should request mic permission first if
 * they need labels immediately.
 */
export async function listAudioInputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({
      deviceId: d.deviceId || 'default',
      label: d.label || `Microphone ${i + 1}`,
    }));
}
 