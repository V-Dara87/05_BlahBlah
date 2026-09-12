import { isTauri } from './tauriFsAdapter.js';

/**
 * Service for interacting with the FFmpeg sidecar binary via Tauri IPC.
 *
 * Designed to degrade gracefully when running in a standard web browser (non-Tauri),
 * reporting unavailable or throwing explicit errors rather than crashing.
 */

/**
 * Returns true if running within Tauri and the FFmpeg sidecar binary responds to a version check.
 * @returns {Promise<boolean>}
 */
export async function isFfmpegAvailable() {
  if (!isTauri()) {
    return false;
  }
  try {
    const version = await getFfmpegVersion();
    return Boolean(version);
  } catch (err) {
    console.warn('[ffmpegRunner] FFmpeg sidecar unavailable:', err?.message || err);
    return false;
  }
}

/**
 * Retrieves the FFmpeg version string by running `ffmpeg -version` via Tauri sidecar.
 * @throws {Error} if not running in Tauri or if the binary is missing/unusable.
 * @returns {Promise<string>} e.g. "ffmpeg version 7.1-essentials_build-www.gyan.dev ..."
 */
export async function getFfmpegVersion() {
  if (!isTauri()) {
    throw new Error('FFmpeg sidecar is only supported when running inside the Tauri desktop app.');
  }

  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const version = await invoke('ffmpeg_version');
    return version;
  } catch (err) {
    const message = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
    throw new Error(`Failed to check FFmpeg version: ${message}`);
  }
}

/**
 * Executes the FFmpeg sidecar with the given arguments.
 *
 * @param {string[]} args - List of CLI arguments to pass to FFmpeg.
 * @param {object} [options]
 * @param {(progress: { line: string, key?: string, value?: string, session_id: string }) => void} [options.onProgress]
 *        Optional callback invoked for each line of stdout emitted by FFmpeg (e.g. from `-progress pipe:1`).
 * @returns {Promise<string>} Full stdout output on success.
 * @throws {Error} on non-zero exit or execution failure.
 */
export async function runFfmpeg(args = [], { onProgress } = {}) {
  if (!isTauri()) {
    throw new Error('FFmpeg sidecar is only supported when running inside the Tauri desktop app.');
  }

  if (!Array.isArray(args)) {
    throw new TypeError('FFmpeg args must be an array of strings.');
  }

  const sessionId = `ffmpeg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let unlisten = null;

  try {
    if (typeof onProgress === 'function') {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen('ffmpeg-progress', (event) => {
        const payload = event?.payload;
        if (payload && payload.session_id === sessionId) {
          try {
            onProgress(payload);
          } catch (callbackErr) {
            console.error('[ffmpegRunner] Error in onProgress callback:', callbackErr);
          }
        }
      });
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke('run_ffmpeg', {
      args: args.map(String),
      sessionId,
    });

    return result;
  } catch (err) {
    const message = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
    throw new Error(`FFmpeg execution failed: ${message}`);
  } finally {
    if (unlisten) {
      try {
        unlisten();
      } catch (cleanupErr) {
        console.warn('[ffmpegRunner] Failed to unsubscribe progress listener:', cleanupErr);
      }
    }
  }
}

export { isTauri };
