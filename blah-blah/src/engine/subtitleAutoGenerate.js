import { runFfmpeg } from '../services/ffmpegRunner.js';
import { runWhisper } from '../services/whisperRunner.js';
import { getPackageById, getPackagePath, isPackageInstalled } from '../services/packageManager.js';
import { parseSrt } from './srt.js';
import { createPhrase } from './subtitleTrack.js';
import { joinPath, removeFileIfExists, statFile } from '../services/tauriFsAdapter.js';
import { loadAsrSettings } from '../services/asrSettings.js';
import { runQwenAsr } from '../services/qwenAsrRunner.js';
import {
  ASR_ENGINE_QWEN3,
  QWEN3_ALIGNER_PACKAGE_ID,
  getEngineLabel,
  getModelEngine,
  isLanguageSupportedByEngine,
} from './asrEngines.js';
import {
  DEFAULT_MAX_CHUNK_SECONDS,
  buildSilenceDetectArgs,
  parseSilenceDetectOutput,
  planSpeechChunks,
} from './asrChunking.js';
import { cleanTranscript, normalizeWordTimings } from './asrText.js';

/** Bytes per second of 16 kHz, 16-bit, mono PCM audio. */
const WAV_BYTES_PER_SECOND = 16000 * 2;
/** Canonical PCM WAV header size; ffmpeg writes a few extra bytes, ~1 ms of audio. */
const WAV_HEADER_BYTES = 44;

/**
 * Resolves on-disk path for a clip/entity from mediaAssets library if needed.
 */
export function resolveClipSourcePath(entity, mediaAssets = []) {
  if (entity?.filePath) return entity.filePath;
  if (entity?.sourcePath) return entity.sourcePath;

  const videoComp = entity?.components?.find((c) => c.type === 'VideoRenderer');
  const audioComp = entity?.components?.find((c) => c.type === 'AudioSource');
  const src = videoComp?.src || audioComp?.src || entity?.src;
  if (!src) return null;

  if (Array.isArray(mediaAssets)) {
    const exact = mediaAssets.find((a) => a?.url === src || a?.path === src);
    if (exact?.path) return exact.path;
    const tail = (s) => {
      let str = String(s || '');
      try { str = decodeURIComponent(str); } catch {}
      return str.split(/[/\\]/).pop();
    };
    const byName = mediaAssets.find((a) => a?.url && tail(a.url) === tail(src));
    if (byName?.path) return byName.path;
  }

  // If src looks like an absolute path on disk (e.g. C:\... or /...)
  if (/^[a-zA-Z]:[/\\]/.test(src) || src.startsWith('/')) {
    return src;
  }

  return null;
}

/**
 * Extracts the clip window as a 16 kHz mono PCM WAV, which is what both engines
 * expect (Whisper's sidecar and Qwen3-ASR, which resamples to 16 kHz mono).
 */
async function extractAudioWav({ filePath, entity, tempWavPath, onProgress }) {
  const ffmpegArgs = ['-y', '-hide_banner', '-nostats'];

  // Seek/window if clip duration is constrained
  const sourceOffset = Number(entity?.sourceOffset) || 0;
  const clipDuration = Number(entity?.duration);
  if (sourceOffset > 0) {
    ffmpegArgs.push('-ss', String(sourceOffset));
  }
  if (Number.isFinite(clipDuration) && clipDuration > 0) {
    ffmpegArgs.push('-t', String(clipDuration));
  }

  ffmpegArgs.push(
    '-i',
    filePath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    tempWavPath
  );

  await runFfmpeg(ffmpegArgs, {
    onProgress: (p) => {
      if (typeof onProgress === 'function') {
        onProgress({ phase: 'extracting', line: p.line });
      }
    },
  });
}

/** Runs ffmpeg silencedetect and returns the silence intervals it found. */
async function detectSilences(wavPath) {
  const log = await runFfmpeg(buildSilenceDetectArgs(wavPath));
  return parseSilenceDetectOutput(log);
}

/** Length of the extracted WAV, derived from its PCM size (no ffprobe needed). */
async function readWavDuration(wavPath) {
  const info = await statFile(wavPath);
  const size = Number(info?.size) || 0;
  if (size <= WAV_HEADER_BYTES) return 0;
  return Math.max(0, (size - WAV_HEADER_BYTES) / WAV_BYTES_PER_SECOND);
}

/**
 * Qwen3-ASR returns text without timestamps, so timing is built here:
 * detect speech, plan chunks of at most ~25 s, transcribe each chunk, and use
 * the chunk's start/end as the phrase timing. Chunks are transcribed in one
 * process (the model loads once); a failing chunk is logged and skipped.
 *
 * When `alignerPath` is set the same pass also asks Qwen's forced aligner for
 * word-level timings, which ride along on each segment as `words`.
 *
 * Returns the same segment shape the Whisper path gets from parseSrt
 * (`{ startTime, endTime, text }`, plus optional `words`).
 */
async function transcribeWithQwen({ wavPath, modelPath, alignerPath, language, onProgress }) {
  const duration = await readWavDuration(wavPath);
  if (duration <= 0) {
    throw new Error('The extracted audio is empty, so there is nothing to transcribe.');
  }

  if (typeof onProgress === 'function') {
    onProgress({ phase: 'analyzing', percent: 0 });
  }

  let silences = [];
  try {
    silences = await detectSilences(wavPath);
  } catch (err) {
    console.warn('[subtitleAutoGenerate] Silence detection failed, using fixed chunks:', err);
  }

  let chunks = planSpeechChunks({ duration, silences });
  if (chunks.length === 0) {
    // Nothing usable came back from silencedetect (very quiet recording, or a
    // clip with no pause at all): fall back to fixed-length chunks.
    for (let start = 0; start < duration; start += DEFAULT_MAX_CHUNK_SECONDS) {
      chunks.push({ start, end: Math.min(duration, start + DEFAULT_MAX_CHUNK_SECONDS) });
    }
  }

  let cpuFallbackWarned = false;
  let alignerWarned = false;
  const { pythonPath } = loadAsrSettings();

  const { results, errors, warnings } = await runQwenAsr(wavPath, chunks, {
    pythonPath,
    modelPath,
    alignerPath,
    language,
    onProgress: (progress) => {
      if (typeof onProgress !== 'function') return;
      if (progress.phase === 'loading') {
        onProgress({ phase: 'loading', percent: 0 });
        return;
      }
      // The aligner is optional: the helper keeps transcribing without it, so
      // tell the UI that the request for word timings was not honoured.
      if (alignerPath && progress.aligner === false && !alignerWarned) {
        alignerWarned = true;
        onProgress({ phase: 'transcribing', wordTimingsUnavailable: true });
      }
      const chunkTotal = progress.chunkTotal || chunks.length;
      const chunkIndex = progress.chunkIndex || 0;
      const cpuFallback = progress.device === 'cpu' && !cpuFallbackWarned;
      if (cpuFallback) cpuFallbackWarned = true;
      onProgress({
        phase: 'transcribing',
        percent: chunkTotal > 0 ? Math.round((chunkIndex / chunkTotal) * 100) : 0,
        chunkIndex,
        chunkTotal,
        cpuFallback,
      });
    },
  });

  if (errors.length > 0) {
    console.warn('[subtitleAutoGenerate] Some Qwen3-ASR chunks failed:', errors);
  }
  if (warnings.length > 0) {
    console.warn('[subtitleAutoGenerate] Qwen3-ASR reported:', warnings);
  }

  if (results.length === 0) {
    const firstError = errors.find((error) => error?.message);
    if (firstError) {
      throw new Error(`Qwen3-ASR could not transcribe this clip: ${firstError.message}`);
    }
    return [];
  }

  // Word timings come from the aligner running over the RAW transcript, while
  // `text` is the cleaned one. The repetition guard only rewrites the display
  // text, so on pathological repeated audio the two can disagree — acceptable,
  // because rebuilding Khmer text from aligner tokens would insert spaces
  // Khmer does not use.
  return results
    .map((result) => {
      const startTime = Math.min(result.start, duration);
      const endTime = Math.min(result.end, duration);
      const text = cleanTranscript(result.text);
      const words = normalizeWordTimings(result.words, { startTime, endTime });
      return words.length > 0
        ? { startTime, endTime, text, words }
        : { startTime, endTime, text };
    })
    .filter((segment) => segment.text && segment.endTime > segment.startTime)
    .sort((a, b) => a.startTime - b.startTime);
}

/**
 * Automatically generates subtitles from an audio/video entity.
 *
 * The engine is chosen by the model package's `engine` field:
 * `whisper-cpp` (default) runs the whisper-cli sidecar unchanged, `qwen3-asr`
 * runs the bundled Python helper through `run_qwen_asr`.
 *
 * @param {object} params
 * @param {object} params.entity - The selected entity/clip
 * @param {string} [params.sourcePath] - Absolute path to audio/video file on disk
 * @param {Array} [params.mediaAssets] - Media assets list for path resolution
 * @param {string} [params.language='auto'] - Language code (e.g. 'en', 'ja', 'km')
 * @param {string} [params.modelId='whisper-small'] - Model package ID
 * @param {boolean} [params.withWordTimings=false] - Ask the Qwen3 forced aligner
 *        for word timings (only used by the qwen3-asr engine, and only when the
 *        aligner package is installed).
 * @param {(progress: {
 *   phase: 'extracting' | 'analyzing' | 'loading' | 'transcribing',
 *   percent?: number, line?: string, chunkIndex?: number, chunkTotal?: number,
 *   cpuFallback?: boolean, wordTimingsUnavailable?: boolean,
 * }) => void} [params.onProgress]
 * @returns {Promise<Array<object>>} Generated subtitle phrases
 */
export async function generateSubtitlesFromEntity({
  entity,
  sourcePath: directPath,
  mediaAssets = [],
  language = 'auto',
  modelId = 'whisper-small',
  withWordTimings = false,
  onProgress,
}) {
  const filePath = directPath || resolveClipSourcePath(entity, mediaAssets);
  if (!filePath) {
    throw new Error(
      'Could not find media source file on disk for this clip. Make sure the media is imported from a local file.'
    );
  }

  const modelPackage = await getPackageById(modelId);
  const engine = getModelEngine(modelPackage);
  const engineLabel = getEngineLabel(engine);

  if (!isLanguageSupportedByEngine(engine, language)) {
    const err = new Error(
      `${engineLabel} does not support the language "${language}". Choose a different model or language.`
    );
    err.code = 'ENGINE_LANGUAGE_UNSUPPORTED';
    err.modelId = modelId;
    throw err;
  }

  const modelInstalled = await isPackageInstalled(modelId);
  if (!modelInstalled) {
    const err = new Error(`${engineLabel} model "${modelId}" is not installed yet.`);
    err.code = 'MODEL_NOT_INSTALLED';
    err.modelId = modelId;
    throw err;
  }

  const modelPath = await getPackagePath(modelId);
  if (!modelPath) {
    const err = new Error(`Model file path for "${modelId}" could not be resolved.`);
    err.code = 'MODEL_PATH_MISSING';
    err.modelId = modelId;
    throw err;
  }

  // Word timings need the optional forced-aligner package next to the model.
  let alignerPath = null;
  if (engine === ASR_ENGINE_QWEN3 && withWordTimings) {
    try {
      if (await isPackageInstalled(QWEN3_ALIGNER_PACKAGE_ID)) {
        alignerPath = await getPackagePath(QWEN3_ALIGNER_PACKAGE_ID);
      }
    } catch (err) {
      console.warn('[subtitleAutoGenerate] Could not resolve the Qwen3 aligner:', err);
    }
  }

  // Prepare temporary 16kHz mono WAV path
  const { tempDir } = await import('@tauri-apps/api/path');
  const osTemp = await tempDir();
  const sessionNonce = `sub_${crypto.randomUUID()}`;
  const tempWavPath = joinPath(osTemp, `${sessionNonce}.wav`);

  try {
    // 1. Audio extraction via FFmpeg
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'extracting', percent: 0 });
    }

    await extractAudioWav({ filePath, entity, tempWavPath, onProgress });

    // 2. Transcription. Both engines end up with the same segment shape:
    //    { startTime, endTime, text } plus optional word timings.
    let segments;

    if (engine === ASR_ENGINE_QWEN3) {
      segments = await transcribeWithQwen({
        wavPath: tempWavPath,
        modelPath,
        alignerPath,
        language,
        onProgress,
      });
    } else {
      if (typeof onProgress === 'function') {
        onProgress({ phase: 'transcribing', percent: 0 });
      }

      const srtText = await runWhisper(tempWavPath, modelPath, {
        language,
        onProgress: (p) => {
          if (typeof onProgress === 'function') {
            // Parse progress if line contains progress percentage
            let pct = undefined;
            const match = p.line.match(/(\d+)%/);
            if (match) {
              pct = parseInt(match[1], 10);
            }
            onProgress({ phase: 'transcribing', percent: pct, line: p.line });
          }
        },
      });
      segments = parseSrt(srtText || '');
    }

    // 3. Segments -> SubtitleTrack phrases (words only when the aligner ran).
    return segments.map((segment) =>
      createPhrase({
        startTime: segment.startTime,
        endTime: segment.endTime,
        text: segment.text,
        words: segment.words,
        mode: 'set',
      })
    );
  } finally {
    await removeFileIfExists(tempWavPath);
  }
}
