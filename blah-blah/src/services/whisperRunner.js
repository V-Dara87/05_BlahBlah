import { isTauri, removeFileIfExists, joinPath } from './tauriFsAdapter.js';

/**
 * Service for executing the whisper-cli sidecar binary via Tauri IPC.
 */

/**
 * Returns true if running within Tauri and whisper-cli responds to version check.
 * @returns {Promise<boolean>}
 */
export async function isWhisperAvailable() {
  if (!isTauri()) return false;
  try {
    const version = await getWhisperVersion();
    return Boolean(version);
  } catch (err) {
    console.warn('[whisperRunner] Whisper sidecar unavailable:', err?.message || err);
    return false;
  }
}

/**
 * Retrieves Whisper version string via sidecar.
 * @returns {Promise<string>}
 */
export async function getWhisperVersion() {
  if (!isTauri()) {
    throw new Error('Whisper sidecar is only supported when running inside the Tauri desktop app.');
  }

  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const version = await invoke('whisper_version');
    return version;
  } catch (err) {
    const msg = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
    throw new Error(`Failed to check Whisper version: ${msg}`);
  }
}

/**
 * Executes Whisper speech-to-text recognition on a WAV audio file.
 *
 * @param {string} audioPath - Absolute path to 16kHz 16-bit mono WAV file.
 * @param {string} modelPath - Absolute path to GGML whisper model binary.
 * @param {object} [options]
 * @param {string} [options.language='auto'] - Language code (e.g. 'en', 'ja', 'km', 'auto').
 * @param {(progress: { line: string, session_id: string }) => void} [options.onProgress]
 * @param {string[]} [options.extraArgs=[]]
 * @returns {Promise<string>} Generated SRT content string.
 */
export async function runWhisper(audioPath, modelPath, { language = 'auto', onProgress, extraArgs = [] } = {}) {
  if (!isTauri()) {
    throw new Error('Whisper speech recognition is only supported when running inside the Tauri desktop app.');
  }
  if (!audioPath) throw new Error('Audio path is required.');
  if (!modelPath) throw new Error('Model path is required.');

  const sessionId = `whisper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let unlisten = null;

  // Generate unique output prefix in the OS temp directory
  const { tempDir } = await import('@tauri-apps/api/path');
  const osTemp = await tempDir();
  const outPrefix = joinPath(osTemp, `whisper_out_${sessionId}`);
  const srtPath = `${outPrefix}.srt`;

  const args = [
    '-m',
    modelPath,
    '-f',
    audioPath,
    '-l',
    language || 'auto',
    '-osrt',
    '-of',
    outPrefix,
    '--print-progress',
    ...extraArgs,
  ];

  try {
    if (typeof onProgress === 'function') {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen('whisper-progress', (event) => {
        const payload = event?.payload;
        if (payload && payload.session_id === sessionId) {
          try {
            onProgress(payload);
          } catch (cbErr) {
            console.error('[whisperRunner] Error in onProgress callback:', cbErr);
          }
        }
      });
    }

    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('run_whisper', {
      args: args.map(String),
      sessionId,
    });

    // Read the resulting SRT file
    const fs = await import('@tauri-apps/plugin-fs');
    if (await fs.exists(srtPath)) {
      const srtContent = await fs.readTextFile(srtPath);
      return srtContent;
    }

    throw new Error(`Whisper completed but expected SRT file not found at ${srtPath}`);
  } catch (err) {
    const msg = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
    throw new Error(`Whisper recognition failed: ${msg}`);
  } finally {
    if (unlisten) {
      try {
        unlisten();
      } catch (cleanupErr) {
        console.warn('[whisperRunner] Failed to unsubscribe progress listener:', cleanupErr);
      }
    }
    // Clean up temporary output srt
    await removeFileIfExists(srtPath);
  }
}

export { isTauri };
