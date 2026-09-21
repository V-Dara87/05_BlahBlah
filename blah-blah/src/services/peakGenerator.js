/**
 * peakGenerator — builds a multi-resolution peak file for one media file.
 *
 * The waveform used to come from decoding the WHOLE file into an AudioBuffer
 * in the webview (utils/audioWaveform.js), which is what made a one-hour
 * recording cost over a gigabyte of RAM before anything was drawn. Instead
 * this service asks the FFmpeg sidecar for a tiny mono PCM stream and folds
 * it into a peak file:
 *
 *   1. FFmpeg decodes the source to mono signed-16-bit PCM at
 *      PEAK_DECODE_SAMPLE_RATE into a temp file inside the project's cache
 *      folder (memory stays O(1) regardless of length).
 *   2. That temp file is read back in fixed-size chunks
 *      (tauriFsAdapter.readFileChunks) and fed to the streaming finest-level
 *      builder from utils/peaksFormat.js, so only the OUTPUT peaks (~10 MB
 *      per hour) are ever held in memory.
 *   3. Coarser levels are derived from the finest, serialized, and the temp
 *      file is deleted.
 *
 * Outside Tauri there is no sidecar to run, so the service reports
 * `{ status: 'unsupported' }` rather than throwing — callers (peakCache's
 * background queue) use that to fall back to the old decode path for short
 * files and to just skip long ones.
 */

import {
  isTauri,
  joinPath,
  ensureDir,
  readFileChunks,
  removeFileIfExists,
} from './tauriFsAdapter.js';
import { runFfmpeg } from './ffmpegRunner.js';
import {
  DEFAULT_PEAKS_PER_SECOND,
  createFinestLevelBuilder,
  buildLevelsFromFinest,
  serializePeakFile,
} from '../utils/peaksFormat.js';

/** Mono decode rate — plenty for an envelope, and 16 samples per finest peak. */
export const PEAK_DECODE_SAMPLE_RATE = 16000;
/** Peak resolution. */
export const PEAKS_PER_SECOND = DEFAULT_PEAKS_PER_SECOND;
/** PCM read chunk size (bytes). 256 KiB = ~8 s of 16 kHz mono s16le. */
export const PEAK_READ_CHUNK_BYTES = 1 << 18;

/** True when this environment can generate peak files at all. */
export function isPeakGenerationSupported() {
  return isTauri();
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** FFmpeg's `-progress` reports time in microseconds under either key. */
function progressMicrosFromEvent(evt) {
  if (!evt) return null;
  if (evt.key === 'out_time_us' || evt.key === 'out_time_ms') {
    const v = Number(evt.value);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/**
 * Generate the peak file bytes for a media file.
 *
 * @param {object} params
 * @param {string} params.sourcePath - absolute path to the source media on disk
 * @param {number} [params.durationSec=0] - known media duration (for progress + header)
 * @param {string} params.tempDirPath - cache folder to write (and delete) the PCM temp file in
 * @param {(progress: { phase: string, ratio: number }) => void} [params.onProgress]
 * @param {{ aborted: boolean }} [params.signal]
 * @returns {Promise<{ status: 'unsupported' } | { status: 'ready', bytes: Uint8Array, sampleRate: number, peaksPerSecond: number, duration: number, peakCount: number }>}
 */
export async function generatePeaksForAsset({
  sourcePath,
  durationSec = 0,
  tempDirPath,
  onProgress,
  signal,
} = {}) {
  if (!isTauri()) {
    return { status: 'unsupported' };
  }
  if (!sourcePath) {
    throw new Error('Peak generation requires a source file path on disk.');
  }
  if (!tempDirPath) {
    throw new Error('Peak generation requires a project cache directory.');
  }

  const report = (phase, ratio) => {
    try {
      onProgress?.({ phase, ratio: clamp01(ratio) });
    } catch (err) {
      console.error('[peakGenerator] onProgress callback threw:', err);
    }
  };

  await ensureDir(tempDirPath);

  const baseName = String(sourcePath).split(/[/\\]/).pop() || 'audio';
  const safeBase = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  const tempPath = joinPath(tempDirPath, `peaks-${safeBase}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.raw`);

  try {
    report('decode', 0);

    // Decode to s16le mono. `-progress pipe:1` makes FFmpeg emit
    // `out_time_us=...` lines on stdout, which ffmpegRunner re-broadcasts.
    await runFfmpeg(
      [
        '-nostats',
        '-hide_banner',
        '-progress',
        'pipe:1',
        '-i',
        sourcePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(PEAK_DECODE_SAMPLE_RATE),
        '-f',
        's16le',
        '-acodec',
        'pcm_s16le',
        '-y',
        tempPath,
      ],
      {
        onProgress: (evt) => {
          const micros = progressMicrosFromEvent(evt);
          if (micros !== null && durationSec > 0) {
            report('decode', (micros / 1e6 / durationSec) * 0.7);
          }
        },
      }
    );

    report('decode', 0.7);

    const builder = createFinestLevelBuilder({
      sampleRate: PEAK_DECODE_SAMPLE_RATE,
      peaksPerSecond: PEAKS_PER_SECOND,
    });

    const expectedBytes = durationSec > 0 ? durationSec * PEAK_DECODE_SAMPLE_RATE * 2 : 0;
    let bytesRead = 0;
    // A chunk may end on an odd byte (half a 16-bit sample); carry it into
    // the next chunk so no sample is lost or misaligned across the seam.
    let carry = null;

    await readFileChunks(tempPath, PEAK_READ_CHUNK_BYTES, (chunk) => {
      let bytes = chunk;
      if (carry) {
        const merged = new Uint8Array(carry.length + bytes.length);
        merged.set(carry, 0);
        merged.set(bytes, carry.length);
        bytes = merged;
        carry = null;
      }
      const evenLen = bytes.length - (bytes.length % 2);
      if (evenLen !== bytes.length) {
        carry = bytes.slice(evenLen);
        bytes = bytes.subarray(0, evenLen);
      }
      if (bytes.length === 0) return;
      // Copy into a fresh, correctly-aligned buffer: Int16Array requires a
      // 2-byte-aligned byteOffset, and the chunk may be an arbitrary view.
      const aligned = new Uint8Array(bytes.length);
      aligned.set(bytes);
      builder.pushInt16(new Int16Array(aligned.buffer));

      bytesRead += chunk.length;
      if (expectedBytes > 0) report('read', 0.7 + 0.2 * (bytesRead / expectedBytes));
    }, { signal });

    if (carry && carry.length > 0) {
      const aligned = new Uint8Array(2);
      aligned.set(carry.subarray(0, 1), 0);
      builder.pushInt16(new Int16Array(aligned.buffer));
    }

    const finest = builder.finish();
    report('optimize', 0.92);

    const levels = buildLevelsFromFinest(finest.bytes, {
      peakCount: finest.peakCount,
      peaksPerSecond: PEAKS_PER_SECOND,
    });
    report('optimize', 0.97);

    const duration = durationSec > 0 ? durationSec : finest.peakCount / PEAKS_PER_SECOND;
    const bytes = serializePeakFile({
      sampleRate: PEAK_DECODE_SAMPLE_RATE,
      durationSec: duration,
      peaksPerSecond: PEAKS_PER_SECOND,
      levels,
    });

    report('done', 1);
    return {
      status: 'ready',
      bytes,
      sampleRate: PEAK_DECODE_SAMPLE_RATE,
      peaksPerSecond: PEAKS_PER_SECOND,
      duration,
      peakCount: finest.peakCount,
    };
  } finally {
    await removeFileIfExists(tempPath);
  }
}
