/**
 * Persisted settings for local speech recognition (Settings > Speech
 * Recognition). Global (not per project), stored in localStorage, same pattern
 * as autosaveSettings.js / editorSettings.js.
 *
 *  - pythonPath  Interpreter the Qwen3-ASR helper runs with. Either a command
 *                name resolved on PATH ("python", "python3") or an absolute
 *                path to a virtual environment's python.exe. PyTorch is NOT
 *                bundled with the app, so this is how the user points BlahBlah
 *                at an environment where `torch` and `qwen-asr` are installed.
 *
 * The whisper.cpp sidecar does not read this value: it ships with the app and
 * needs no interpreter.
 */

import { readJson, writeJson } from '../utils/appStorage.js';

const STORAGE_KEY = 'blahblah.asrSettings.v1';

export const ASR_DEFAULTS = Object.freeze({
  pythonPath: 'python',
});

/** Coerce any stored/partial value into a complete settings object. */
export function sanitizeAsrSettings(candidate) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const rawPath = typeof c.pythonPath === 'string' ? c.pythonPath.trim() : '';
  return {
    pythonPath: rawPath || ASR_DEFAULTS.pythonPath,
  };
}

export function loadAsrSettings() {
  const parsed = readJson(STORAGE_KEY, null);
  return parsed ? sanitizeAsrSettings(parsed) : { ...ASR_DEFAULTS };
}

/** Persists and returns the sanitized settings that were actually stored. */
export function saveAsrSettings(settings) {
  const sanitized = sanitizeAsrSettings(settings);
  writeJson(STORAGE_KEY, sanitized);
  return sanitized;
}
