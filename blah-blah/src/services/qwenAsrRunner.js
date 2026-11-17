import { isTauri, joinPath, removeFileIfExists } from './tauriFsAdapter.js';
import { loadAsrSettings } from './asrSettings.js';

/**
 * Service for the Qwen3-ASR (Khmer) speech-recognition engine.
 *
 * Whisper runs through the bundled whisper-cli sidecar; Qwen3-ASR cannot — it
 * is a PyTorch model that needs the user's own Python environment. This module
 * is the JS half of that bridge: it spawns the bundled helper script through
 * the Rust command `run_qwen_asr` (status in src-tauri/resources/qwen_asr_khmer.py),
 * turns its stdout records into callbacks, and keeps the same "don't fail
 * loudly in the browser" behaviour the other runners have.
 *
 * Model facts (seanghay/Qwen3-ASR-0.6B-Khmer, Apache-2.0): ~0.8B params,
 * bf16 on CUDA fits in 6 GB VRAM, input is resampled to 16 kHz mono, output
 * has NO punctuation and NO timestamps, and long/hesitant audio can produce
 * runaway repeated phrases (collapsed by engine/asrText.js).
 *
 * Word timings come from Qwen's optional forced aligner
 * (Qwen/Qwen3-ForcedAligner-0.6B): when its package is installed and the caller
 * asks for them, the helper loads it alongside the ASR model and returns one
 * `words` list per chunk. Without it the result is exactly what it was before.
 */

export const QWEN3_ASR_MODEL_REPO = 'seanghay/Qwen3-ASR-0.6B-Khmer';
export const QWEN3_ALIGNER_MODEL_REPO = 'Qwen/Qwen3-ForcedAligner-0.6B';

const PROGRESS_EVENT = 'qwen-asr-progress';
const RECORD_PREFIX = 'QASR_';

/** The name Qwen3-ASR expects for a language code, or undefined for auto. */
export function qwenLanguageName(code) {
  if (code === 'km') return 'Khmer';
  if (code === 'en') return 'English';
  return undefined;
}

/** Session id of the transcription/download currently running, if any. */
let activeSessionId = null;

export function getActiveQwenAsrSessionId() {
  return activeSessionId;
}

function resolvePythonPath(explicit) {
  const value = typeof explicit === 'string' ? explicit.trim() : '';
  if (value) return value;
  return loadAsrSettings().pythonPath;
}

function errorMessage(err) {
  return typeof err === 'string' ? err : err?.message || JSON.stringify(err);
}

/**
 * One stdout line -> { kind, data }. Returns null for anything that is not one
 * of our records (torch/transformers warnings, stray prints, ...).
 */
export function parseQwenAsrRecord(line) {
  const text = String(line ?? '').trim();
  if (!text.startsWith(RECORD_PREFIX)) return null;
  const spaceIndex = text.indexOf(' ');
  const kind = (spaceIndex === -1 ? text.slice(RECORD_PREFIX.length) : text.slice(RECORD_PREFIX.length, spaceIndex)).trim();
  if (!kind) return null;
  if (spaceIndex === -1) return { kind, data: null };
  try {
    return { kind, data: JSON.parse(text.slice(spaceIndex + 1)) };
  } catch {
    return { kind, data: null };
  }
}

/** Pull the message out of a QASR_FATAL record embedded in a Rust error. */
function fatalMessageFrom(raw) {
  const match = String(raw || '').match(/QASR_FATAL (\{[^\n]*\})/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed?.message || null;
  } catch {
    return null;
  }
}

/** Turn raw spawn/module errors into something a user can act on. */
function friendlyQwenAsrError(raw) {
  const message = String(raw || 'Qwen3-ASR failed');
  const lower = message.toLowerCase();
  if (
    lower.includes('failed to spawn') ||
    lower.includes('program not found') ||
    lower.includes('os error 2') ||
    lower.includes('failed to run')
  ) {
    return (
      'Python could not be started. Set the interpreter path in Settings → Speech Recognition ' +
      `(default: "python" on PATH).\n\n${message}`
    );
  }
  if (lower.includes('modulenotfounderror') || lower.includes('no module named')) {
    return (
      'This Python environment is missing the Qwen3-ASR dependencies. ' +
      `Run: pip install -U qwen-asr\n\n${message}`
    );
  }
  return message;
}

/**
 * Spawns the helper and streams its records. Resolves with the full stdout
 * (the records are also delivered line by line through `onLine`).
 */
async function invokeQwenAsr({ pythonPath, args, sessionId, onLine }) {
  if (!isTauri()) {
    throw new Error('Qwen3-ASR is only supported when running inside the Tauri desktop app.');
  }

  const { invoke } = await import('@tauri-apps/api/core');
  let unlisten = null;

  try {
    if (typeof onLine === 'function') {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen(PROGRESS_EVENT, (event) => {
        const payload = event?.payload;
        if (!payload || payload.session_id !== sessionId) return;
        try {
          onLine(payload.line);
        } catch (callbackErr) {
          console.error('[qwenAsrRunner] Error in progress callback:', callbackErr);
        }
      });
    }

    return await invoke('run_qwen_asr', {
      pythonPath,
      args: args.map(String),
      sessionId,
    });
  } finally {
    if (unlisten) {
      try {
        unlisten();
      } catch (cleanupErr) {
        console.warn('[qwenAsrRunner] Failed to unsubscribe progress listener:', cleanupErr);
      }
    }
  }
}

/**
 * Probes the configured interpreter: is Python there, are `torch` and
 * `qwen_asr` importable, and is CUDA available?
 *
 * Never throws for "not installed" — that is the normal first-run answer and
 * the UI turns it into setup instructions.
 *
 * @param {{ pythonPath?: string }} [options]
 * @returns {Promise<{
 *   pythonPath: string, pythonFound: boolean, ready: boolean,
 *   pythonVersion: string|null, torch: boolean, qwenAsr: boolean,
 *   cuda: boolean, deviceName: string|null, problems: string[], error: string|null,
 * }>}
 */
export async function checkQwenAsrSetup({ pythonPath } = {}) {
  const resolvedPython = resolvePythonPath(pythonPath);
  const result = {
    pythonPath: resolvedPython,
    pythonFound: false,
    ready: false,
    pythonVersion: null,
    torch: false,
    qwenAsr: false,
    cuda: false,
    deviceName: null,
    problems: [],
    error: null,
  };

  if (!isTauri()) {
    return { ...result, error: 'Qwen3-ASR is only available in the Tauri desktop app.' };
  }

  let checkRecord = null;
  try {
    await invokeQwenAsr({
      pythonPath: resolvedPython,
      args: ['--check'],
      sessionId: `qwen-asr-check-${crypto.randomUUID()}`,
      onLine: (line) => {
        const record = parseQwenAsrRecord(line);
        if (record?.kind === 'CHECK' && record.data) checkRecord = record.data;
      },
    });
  } catch (err) {
    const raw = errorMessage(err);
    const message = String(raw).toLowerCase();
    const pythonFound = !(
      message.includes('failed to spawn') ||
      message.includes('program not found') ||
      message.includes('os error 2')
    );
    return {
      ...result,
      pythonFound,
      error: fatalMessageFrom(raw) || friendlyQwenAsrError(raw),
    };
  }

  if (!checkRecord) {
    return {
      ...result,
      pythonFound: true,
      error: 'The Python helper did not report its setup status.',
    };
  }

  const problems = Array.isArray(checkRecord.problems) ? checkRecord.problems.map(String) : [];
  return {
    ...result,
    pythonFound: true,
    ready: Boolean(checkRecord.ready),
    pythonVersion: checkRecord.pythonVersion ?? null,
    torch: Boolean(checkRecord.torch),
    qwenAsr: Boolean(checkRecord.qwenAsr),
    cuda: Boolean(checkRecord.cuda),
    deviceName: checkRecord.deviceName ?? null,
    problems,
    error: checkRecord.ready ? null : problems[0] || 'Qwen3-ASR is not ready.',
  };
}

/** True when the configured Python environment can actually run Qwen3-ASR. */
export async function isQwenAsrAvailable(options = {}) {
  const setup = await checkQwenAsrSetup(options);
  return Boolean(setup.ready);
}

/**
 * Transcribes already-planned speech chunks. Timing comes from the chunk plan
 * (the model returns text without timestamps).
 *
 * A chunk that fails is reported in `errors` and skipped; the job only fails
 * when the whole process fails (Python missing, model unloadable, ...).
 *
 * @param {string} audioPath - 16 kHz mono PCM WAV written by subtitleAutoGenerate.
 * @param {Array<{ start: number, end: number }>} chunks - Non-overlapping speech chunks.
 * @param {object} [options]
 * @param {string} [options.pythonPath]
 * @param {string} [options.modelPath] - Local snapshot folder (or HF repo id).
 * @param {string} [options.alignerPath] - Forced-aligner snapshot folder; when
 *        set, word timings are requested for every chunk.
 * @param {string} [options.cacheDir] - HF cache dir, used when the model id is not local.
 * @param {string} [options.language='km']
 * @param {'auto'|'cuda'|'cpu'} [options.device='auto']
 * @param {(progress: object) => void} [options.onProgress]
 * @returns {Promise<{
 *   results: Array<{ index: number, start: number, end: number, text: string,
 *                    words: Array<{ text: string, start: number, end: number }> }>,
 *   errors: Array<{ index: number|null, message: string }>,
 *   warnings: string[], device: string|null, dtype: string|null, cuda: boolean,
 *   aligner: boolean,
 * }>}
 */
export async function runQwenAsr(
  audioPath,
  chunks,
  { pythonPath, modelPath, alignerPath, cacheDir, language = 'km', device = 'auto', onProgress } = {}
) {
  if (!isTauri()) {
    throw new Error('Qwen3-ASR speech recognition is only supported when running inside the Tauri desktop app.');
  }
  if (!audioPath) throw new Error('Audio path is required.');
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('There are no speech chunks to transcribe.');
  }

  const sessionId = `qwen-asr-${crypto.randomUUID()}`;
  const { tempDir } = await import('@tauri-apps/api/path');
  const osTemp = await tempDir();
  const planPath = joinPath(osTemp, `${sessionId}.chunks.json`);

  const report = (payload) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress(payload);
    } catch (callbackErr) {
      console.error('[qwenAsrRunner] Error in onProgress callback:', callbackErr);
    }
  };

  const args = [
    '--audio',
    audioPath,
    '--chunks-file',
    planPath,
    '--model',
    modelPath || QWEN3_ASR_MODEL_REPO,
    '--language',
    language || 'km',
    '--device',
    device || 'auto',
  ];
  if (cacheDir) args.push('--cache-dir', cacheDir);
  // Word timings are opt-in: they need the forced aligner loaded as well.
  if (alignerPath) args.push('--time-stamps', '--aligner', alignerPath);

  const results = new Array(chunks.length).fill(null);
  const errors = [];
  const warnings = [];
  let status = null;

  try {
    const fs = await import('@tauri-apps/plugin-fs');
    await fs.writeTextFile(
      planPath,
      JSON.stringify({
        language: language || 'km',
        chunks: chunks.map((chunk) => ({
          start: Number(chunk.start) || 0,
          end: Number(chunk.end) || 0,
        })),
      })
    );

    activeSessionId = sessionId;
    await invokeQwenAsr({
      pythonPath: resolvePythonPath(pythonPath),
      args,
      sessionId,
      onLine: (line) => {
        const record = parseQwenAsrRecord(line);
        if (!record) return;
        switch (record.kind) {
          case 'STATUS':
            status = { ...(status || {}), ...(record.data || {}) };
            report({
              phase: record.data?.stage === 'loading' ? 'loading' : 'transcribing',
              device: record.data?.device ?? null,
              dtype: record.data?.dtype ?? null,
              cuda: record.data?.cuda === true,
              aligner: record.data?.aligner === true,
            });
            break;
          case 'PROGRESS':
            report({
              phase: 'transcribing',
              chunkIndex: Number(record.data?.index ?? 0) + 1,
              chunkTotal: Number(record.data?.total ?? chunks.length),
              chunkStart: record.data?.start ?? null,
              chunkEnd: record.data?.end ?? null,
            });
            break;
          case 'RESULT':
            if (record.data && Number.isInteger(record.data.index)) {
              results[record.data.index] = {
                index: record.data.index,
                start: Number(record.data.start) || 0,
                end: Number(record.data.end) || 0,
                text: String(record.data.text || ''),
                words: Array.isArray(record.data.words) ? record.data.words : [],
              };
            }
            break;
          case 'WARNING':
            if (record.data?.message) warnings.push(String(record.data.message));
            break;
          case 'ERROR':
            errors.push({
              index: Number.isInteger(record.data?.index) ? record.data.index : null,
              message: record.data?.message || 'A chunk failed to transcribe.',
            });
            break;
          default:
            break;
        }
      },
    });
  } catch (err) {
    const raw = errorMessage(err);
    const message = fatalMessageFrom(raw) || friendlyQwenAsrError(raw);
    const wrapped = new Error(message);
    wrapped.code = 'QWEN_ASR_FAILED';
    throw wrapped;
  } finally {
    activeSessionId = null;
    await removeFileIfExists(planPath);
  }

  return {
    results: results.filter(Boolean),
    errors,
    warnings,
    device: status?.device ?? null,
    dtype: status?.dtype ?? null,
    cuda: status?.cuda === true,
    aligner: status?.aligner === true,
  };
}

/**
 * Downloads the model snapshot into `modelDir` (the Package Manager's install
 * path) using huggingface_hub inside the user's Python environment. No
 * PyTorch download is triggered by this.
 */
export async function downloadQwenAsrModel({
  pythonPath,
  modelDir,
  cacheDir,
  repo = QWEN3_ASR_MODEL_REPO,
  onProgress,
} = {}) {
  if (!isTauri()) {
    throw new Error('Qwen3-ASR model downloads are only supported when running inside the Tauri desktop app.');
  }
  if (!modelDir) throw new Error('A destination folder for the model is required.');

  const sessionId = `qwen-asr-dl-${crypto.randomUUID()}`;
  const args = ['--download', '--model', modelDir, '--repo', repo];
  if (cacheDir) args.push('--cache-dir', cacheDir);

  let bytesDownloaded = 0;

  try {
    activeSessionId = sessionId;
    await invokeQwenAsr({
      pythonPath: resolvePythonPath(pythonPath),
      args,
      sessionId,
      onLine: (line) => {
        const record = parseQwenAsrRecord(line);
        if (record?.kind !== 'DOWNLOAD' || !record.data) return;
        if (Number.isFinite(record.data.bytes)) bytesDownloaded = record.data.bytes;
        try {
          onProgress?.({ bytesDownloaded, done: record.data.done === true });
        } catch (callbackErr) {
          console.error('[qwenAsrRunner] Error in download progress callback:', callbackErr);
        }
      },
    });
  } catch (err) {
    const raw = errorMessage(err);
    throw new Error(fatalMessageFrom(raw) || friendlyQwenAsrError(raw));
  } finally {
    activeSessionId = null;
  }

  return { modelDir, bytes: bytesDownloaded };
}

/**
 * Kills the running helper (transcription or download). `cancel_process` is the
 * same registry the whisper/ffmpeg sidecars use.
 */
export async function cancelQwenAsr(sessionId = activeSessionId) {
  if (!isTauri() || !sessionId) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke('cancel_process', { sessionId });
  } catch (err) {
    console.warn('[qwenAsrRunner] Failed to cancel the Python helper:', err);
    return false;
  }
}
