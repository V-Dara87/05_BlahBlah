import { runFfmpeg } from '../services/ffmpegRunner.js';
import { runWhisper } from '../services/whisperRunner.js';
import { getPackagePath, isPackageInstalled } from '../services/packageManager.js';
import { parseSrt } from './srt.js';
import { createPhrase } from './subtitleTrack.js';
import { joinPath, removeFileIfExists } from '../services/tauriFsAdapter.js';

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
    const tail = (s) => String(s || '').split(/[/\\]/).pop();
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
 * Automatically generates subtitles from an audio/video entity using Whisper.
 *
 * @param {object} params
 * @param {object} params.entity - The selected entity/clip
 * @param {string} [params.sourcePath] - Absolute path to audio/video file on disk
 * @param {Array} [params.mediaAssets] - Media assets list for path resolution
 * @param {string} [params.language='auto'] - Language code (e.g. 'en', 'ja', 'km')
 * @param {string} [params.modelId='whisper-small'] - Model package ID
 * @param {(progress: { phase: 'extracting' | 'transcribing', percent?: number, line?: string }) => void} [params.onProgress]
 * @returns {Promise<Array<object>>} Generated subtitle phrases
 */
export async function generateSubtitlesFromEntity({
  entity,
  sourcePath: directPath,
  mediaAssets = [],
  language = 'auto',
  modelId = 'whisper-small',
  onProgress,
}) {
  const filePath = directPath || resolveClipSourcePath(entity, mediaAssets);
  if (!filePath) {
    throw new Error(
      'Could not find media source file on disk for this clip. Make sure the media is imported from a local file.'
    );
  }

  const modelInstalled = await isPackageInstalled(modelId);
  if (!modelInstalled) {
    const err = new Error(`Whisper model "${modelId}" is not installed yet.`);
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

  // Prepare temporary 16kHz mono WAV path
  const { tempDir } = await import('@tauri-apps/api/path');
  const osTemp = await tempDir();
  const sessionNonce = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tempWavPath = joinPath(osTemp, `${sessionNonce}.wav`);

  try {
    // 1. Audio extraction via FFmpeg
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'extracting', percent: 0 });
    }

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

    // 2. Transcription via Whisper
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

    // 3. Parse generated SRT into SubtitleTrack phrases
    const parsedPhrases = parseSrt(srtText || '');
    const phrases = parsedPhrases.map((p) =>
      createPhrase({
        startTime: p.startTime,
        endTime: p.endTime,
        text: p.text,
        mode: 'set',
      })
    );

    return phrases;
  } finally {
    await removeFileIfExists(tempWavPath);
  }
}
