import { runFfmpeg, isTauri, isFfmpegAvailable } from './ffmpegRunner.js';
 
/**
 * Silence Detector Service
 *
 * Provides:
 * 1. FFmpeg `silencedetect` runner via Tauri sidecar
 * 2. High-performance Web Audio API PCM analyzer (instant in-memory feedback)
 * 3. Padding / offset buffer computation for smooth speech lead-in and lead-out
 */
 
/**
 * Parses FFmpeg `silencedetect` filter logs from stderr.
 *
 * FFmpeg emits:
 *   [silencedetect @ 0x...] silence_start: 12.345
 *   [silencedetect @ 0x...] silence_end: 15.678 | silence_duration: 3.333
 *
 * Handles edge cases:
 * - Silence at the very start (silence_end appears without a preceding silence_start)
 * - Silence at the very end (silence_start appears without a matching silence_end before EOF)
 *
 * @param {string} output - Full FFmpeg stderr string
 * @param {number} totalDuration - Total clip/media duration in seconds
 * @returns {Array<{ start: number, end: number, duration: number }>}
 */
export function parseFfmpegSilenceOutput(output, totalDuration = 0) {
  if (!output || typeof output !== 'string') return [];
 
  const intervals = [];
  let currentStart = null;
 
  const lines = output.split(/\r?\n/);
  const startRegex = /silence_start:\s*(-?[\d.]+)/;
  const endRegex = /silence_end:\s*(-?[\d.]+)(?:\s*\|\s*silence_duration:\s*(-?[\d.]+))?/;
 
  for (const line of lines) {
    const endMatch = line.match(endRegex);
    if (endMatch) {
      const endSec = Math.max(0, parseFloat(endMatch[1]));
      let startSec = currentStart;
 
      if (startSec === null) {
        // Silence started at 0.0 before the first detection log
        const dur = endMatch[2] ? parseFloat(endMatch[2]) : null;
        startSec = dur !== null ? Math.max(0, endSec - dur) : 0;
      }
 
      if (endSec > startSec) {
        intervals.push({
          start: Math.round(startSec * 1000) / 1000,
          end: Math.round(endSec * 1000) / 1000,
          duration: Math.round((endSec - startSec) * 1000) / 1000,
        });
      }
      currentStart = null;
      continue;
    }
 
    const startMatch = line.match(startRegex);
    if (startMatch) {
      currentStart = Math.max(0, parseFloat(startMatch[1]));
    }
  }
 
  // If there's an unclosed silence_start at the end of the file
  if (currentStart !== null && totalDuration > currentStart) {
    intervals.push({
      start: Math.round(currentStart * 1000) / 1000,
      end: Math.round(totalDuration * 1000) / 1000,
      duration: Math.round((totalDuration - currentStart) * 1000) / 1000,
    });
  }
 
  return intervals;
}
 
/**
 * Runs FFmpeg `silencedetect` on an audio/video file on disk via Tauri sidecar.
 *
 * @param {object} params
 * @param {string} params.filePath - Absolute path to local media file
 * @param {number} [params.thresholdDb=-35] - Volume threshold in dB below which is silence
 * @param {number} [params.minSilenceDuration=0.4] - Minimum silence length in seconds
 * @param {number} [params.mediaOffset=0] - Offset into media file (in seconds)
 * @param {number} [params.duration=0] - Duration of visible clip section (in seconds)
 * @returns {Promise<Array<{ start: number, end: number, duration: number }>>}
 */
export async function detectSilenceWithFfmpeg({
  filePath,
  thresholdDb = -35,
  minSilenceDuration = 0.4,
  mediaOffset = 0,
  duration = 0,
}) {
  if (!isTauri()) {
    throw new Error('FFmpeg silence detection requires the Tauri desktop environment.');
  }
 
  const args = ['-nostats', '-hide_banner'];
 
  if (mediaOffset > 0) {
    args.push('-ss', String(mediaOffset));
  }
  if (duration > 0) {
    args.push('-t', String(duration));
  }
 
  args.push(
    '-i',
    filePath,
    '-af',
    `silencedetect=noise=${thresholdDb}dB:d=${minSilenceDuration}`,
    '-f',
    'null',
    '-'
  );
 
  const output = await runFfmpeg(args);
  return parseFfmpegSilenceOutput(output, duration);
}
 
/**
 * Fast in-memory silence detection using Web Audio API AudioBuffer PCM data.
 * Computes windowed RMS in dB: 20 * log10(rms).
 *
 * @param {AudioBuffer} audioBuffer - Decoded audio buffer
 * @param {object} params
 * @param {number} [params.thresholdDb=-35] - Silence threshold in dB
 * @param {number} [params.minSilenceDuration=0.4] - Minimum silence duration in seconds
 * @param {number} [params.mediaOffset=0] - In-point offset inside buffer in seconds
 * @param {number} [params.duration=0] - Visible duration in seconds (0 = full buffer)
 * @returns {Array<{ start: number, end: number, duration: number }>} Relative to visible clip (0..duration)
 */
export function detectSilenceWithWebAudio(audioBuffer, {
  thresholdDb = -45,
  minSilenceDuration = 0.4,
  mediaOffset = 0,
  duration = 0,
} = {}) {
  if (!audioBuffer) return [];
 
  const sampleRate = audioBuffer.sampleRate;
  const totalBufferDur = audioBuffer.duration;
  const clipDur = duration > 0 ? Math.min(duration, Math.max(0, totalBufferDur - mediaOffset)) : totalBufferDur;
  if (clipDur <= 0.05) return [];
 
  const startSample = Math.max(0, Math.floor(mediaOffset * sampleRate));
  const totalSamples = Math.min(Math.floor(clipDur * sampleRate), audioBuffer.length - startSample);
  if (totalSamples <= 0) return [];
 
  // Frame size for RMS analysis (approx 20ms to 25ms, standard for speech vad)
  const frameSize = Math.max(256, Math.floor(sampleRate * 0.025));
  const numChannels = audioBuffer.numberOfChannels;
 
  // Mix down channels into mono slice
  const mono = new Float32Array(totalSamples);
  for (let c = 0; c < numChannels; c++) {
    const channelData = audioBuffer.getChannelData(c);
    for (let i = 0; i < totalSamples; i++) {
      mono[i] += channelData[startSample + i] / numChannels;
    }
  }
 
  const numFrames = Math.floor(totalSamples / frameSize);
  const frameDbs = new Float32Array(numFrames);
 
  for (let f = 0; f < numFrames; f++) {
    const offset = f * frameSize;
    let sumSq = 0;
    for (let i = 0; i < frameSize; i++) {
      const s = mono[offset + i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / frameSize);
    frameDbs[f] = 20 * Math.log10(Math.max(rms, 1e-5));
  }
 
  const frameDurationSec = frameSize / sampleRate;
  const minFrames = Math.max(1, Math.round(minSilenceDuration / frameDurationSec));
 
  // Hysteresis: speech has natural micro-gaps between syllables/consonants
  // (a soft "s", "f", "t", or the breath between words) that dip well
  // below a single loud-vowel threshold without being real silence. Two
  // thresholds — one to ENTER silence, a higher one to EXIT it — stop a
  // single quiet or loud frame from flipping state on its own, without
  // the separate frame-confirmation counters from the previous version,
  // which were mis-reporting boundary timestamps (cuts landing a frame or
  // two into what was actually still speech). minSilenceDuration below
  // already filters out anything short, so hysteresis alone is enough.
  const exitThresholdDb = thresholdDb + 4;
 
  const intervals = [];
  let inSilence = false;
  let silenceStartFrame = 0;
 
  for (let f = 0; f < numFrames; f++) {
    const db = frameDbs[f];
 
    if (!inSilence) {
      if (db < thresholdDb) {
        inSilence = true;
        silenceStartFrame = f;
      }
    } else if (db > exitThresholdDb) {
      const silenceLenFrames = f - silenceStartFrame;
      if (silenceLenFrames >= minFrames) {
        const startSec = silenceStartFrame * frameDurationSec;
        const endSec = f * frameDurationSec;
        intervals.push({
          start: Math.round(startSec * 1000) / 1000,
          end: Math.round(endSec * 1000) / 1000,
          duration: Math.round((endSec - startSec) * 1000) / 1000,
        });
      }
      inSilence = false;
    }
  }
 
  // End of clip silence
  if (inSilence) {
    const silenceLenFrames = numFrames - silenceStartFrame;
    if (silenceLenFrames >= minFrames) {
      const startSec = silenceStartFrame * frameDurationSec;
      const endSec = clipDur;
      intervals.push({
        start: Math.round(startSec * 1000) / 1000,
        end: Math.round(endSec * 1000) / 1000,
        duration: Math.round((endSec - startSec) * 1000) / 1000,
      });
    }
  }
 
  return intervals;
}
 
/**
 * Computes audible segments (kept) and cut segments (silence) after applying
 * padding/offset buffer (lead-in and lead-out margins).
 *
 * @param {Array<{ start: number, end: number }>} rawSilenceIntervals
 * @param {number} totalDuration - Visible clip duration in seconds
 * @param {object} [options]
 * @param {number} [options.padding=0.08] - Lead-in/out safety buffer (seconds)
 * @param {number} [options.minSpeechDuration=0.15] - Minimum length of kept speech (seconds)
 * @returns {object} { cutSegments, keptSegments, originalDuration, newDuration, savedDuration, savedPercent }
 */
export function computeAudibleAndSilentSegments(
  rawSilenceIntervals,
  totalDuration,
  { padding = 0.12, minSpeechDuration = 0.15 } = {}
) {
  if (!totalDuration || totalDuration <= 0) {
    return {
      cutSegments: [],
      keptSegments: [],
      originalDuration: 0,
      newDuration: 0,
      savedDuration: 0,
      savedPercent: 0,
    };
  }
 
  // 1. Apply padding (offset) to silence intervals
  // Speech before gets +padding (silence cut starts later)
  // Speech after gets +padding (silence cut ends earlier)
  const adjustedCuts = [];
  for (let i = 0; i < rawSilenceIntervals.length; i++) {
    const raw = rawSilenceIntervals[i];
    // If silence is at the very beginning of the clip, don't pad into negative
    const isStartOfClip = raw.start <= 0.02;
    // If silence is at the very end of the clip, don't pad past totalDuration
    const isEndOfClip = raw.end >= totalDuration - 0.02;
 
    const effStart = isStartOfClip ? 0 : Math.min(totalDuration, raw.start + padding);
    const effEnd = isEndOfClip ? totalDuration : Math.max(0, raw.end - padding);
 
    // Only cut if effective duration remains positive
    if (effEnd > effStart + 0.02) {
      adjustedCuts.push({
        id: `cut-${i}-${Math.round(effStart * 100)}`,
        start: Math.round(effStart * 1000) / 1000,
        end: Math.round(effEnd * 1000) / 1000,
        duration: Math.round((effEnd - effStart) * 1000) / 1000,
        enabled: true,
      });
    }
  }
 
  // 2. Merge overlapping cuts if padding caused overlap
  const mergedCuts = [];
  for (const cut of adjustedCuts) {
    if (mergedCuts.length === 0) {
      mergedCuts.push({ ...cut });
    } else {
      const prev = mergedCuts[mergedCuts.length - 1];
      if (cut.start <= prev.end + 0.02) {
        prev.end = Math.max(prev.end, cut.end);
        prev.duration = Math.round((prev.end - prev.start) * 1000) / 1000;
      } else {
        mergedCuts.push({ ...cut });
      }
    }
  }
 
  // 3. Invert cuts into kept audible segments
  const kept = [];
  let curTime = 0;
 
  for (const cut of mergedCuts) {
    if (cut.start > curTime + 0.02) {
      const segDur = cut.start - curTime;
      if (segDur >= minSpeechDuration) {
        kept.push({
          start: Math.round(curTime * 1000) / 1000,
          end: Math.round(cut.start * 1000) / 1000,
          duration: Math.round(segDur * 1000) / 1000,
        });
      }
    }
    curTime = Math.max(curTime, cut.end);
  }
 
  if (curTime < totalDuration - 0.02) {
    const segDur = totalDuration - curTime;
    if (segDur >= minSpeechDuration) {
      kept.push({
        start: Math.round(curTime * 1000) / 1000,
        end: Math.round(totalDuration * 1000) / 1000,
        duration: Math.round(segDur * 1000) / 1000,
      });
    }
  }
 
  const newDuration = kept.reduce((acc, k) => acc + k.duration, 0);
  const savedDuration = Math.max(0, totalDuration - newDuration);
  const savedPercent = totalDuration > 0 ? Math.round((savedDuration / totalDuration) * 100) : 0;
 
  return {
    cutSegments: mergedCuts,
    keptSegments: kept,
    originalDuration: Math.round(totalDuration * 1000) / 1000,
    newDuration: Math.round(newDuration * 1000) / 1000,
    savedDuration: Math.round(savedDuration * 1000) / 1000,
    savedPercent,
  };
}
 
/**
 * Formats time in seconds to mm:ss.ms
 */
export function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}
 
export { isTauri, isFfmpegAvailable };
 