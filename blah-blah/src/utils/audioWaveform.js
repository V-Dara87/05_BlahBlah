/**
 * Audio Waveform — provides min/max/rms envelopes for timeline waveform
 * rendering.
 *
 * Two backends, tried in this order:
 *
 *   1. The project's generated PEAK FILE (services/peakCache.js), sliced to
 *      the requested window with utils/peaksFormat.js. This is the path for
 *      anything long: a one-hour recording is read from a ~10 MB file in
 *      kilobytes at a time, and zooming/trimming re-slices that file instead
 *      of re-mixing a decoded buffer.
 *   2. The original in-memory decode (Web Audio API `decodeAudioData`). Kept
 *      only for SHORT files and for the browser build, where there is no
 *      FFmpeg sidecar to generate peaks with.
 *
 * Long media in the desktop build never reaches backend 2. While its peaks
 * are still generating (or if generation failed) it returns an EMPTY
 * envelope, which WaveformCanvas renders as a placeholder and then redraws
 * when the peaks become ready.
 *
 * ── Remaining whole-file-decode paths (known, deliberately not solved here) ──
 * These still pull a full AudioBuffer into memory, so they remain a risk for
 * long media and should be converted to the peak/FFmpeg path if they ever
 * show up in a memory profile:
 *   - components/silence-remover/SilenceRemoverPanel.jsx — the "Audition"
 *     player needs a real AudioBuffer to schedule playback from, so it still
 *     calls decodeAudio() for the selected clip (detection itself now uses
 *     FFmpeg for long clips in Tauri — see that file).
 *   - engine/exportRunner.js decodeAudioSource() — the export audio mixdown
 *     decodes every source into an AudioBuffer and caches them for the whole
 *     export. Correct for short clips, heavy for hour-long ones.
 *   - components/project/AssetPreviewPopover.jsx plays a real <audio> element
 *     (streams), but its waveform goes through this module, so it is covered
 *     by whichever backend above applies.
 */

import { getPeaksForUrl, getAssetByUrl, getAssetById, subscribePeaksUpdated } from '../services/peakCache';
import { isTauri } from '../services/tauriFsAdapter';
import { slicePeaks } from './peaksFormat';

// Media longer than this is never decoded in memory; without peaks it gets an
// empty envelope (placeholder) instead. 10 minutes comfortably covers the
// short clips the in-memory path is fast for, and keeps a 30-60 minute file
// from ever being decoded whole.
export const LONG_MEDIA_THRESHOLD_SEC = 10 * 60;

// The bucket-count policy (how many envelope buckets a box of a given pixel
// size should ask for) lives in utils/waveformResolution.js, shared with both
// renderers so they request the same envelope for the same box.

// Bounded caches. Previously both grew forever for the life of the session:
// every distinct URL kept its AudioBuffer (the 1 GB/hour problem), and every
// (url, numPeaks, window) triple kept an envelope. These limits release the
// oldest entries once a modest budget is reached.
const MAX_BUFFER_CACHE_ENTRIES = 6; // decoded AudioBuffers — the expensive ones
const MAX_PEAK_CACHE_ENTRIES = 240; // small envelope arrays


// Cache: `${url}::${numPeaks}::${startSec}::${endSec}` → Promise<envelope>
const peakCache = new Map();

// When background generation finishes for an asset, the envelopes computed
// while its peaks were missing are empty placeholders that must not stay
// cached. Only drop entries whose source URL belongs to THAT asset — clearing
// the whole map would force every other clip's waveform to be recomputed
// every time any file in a large project finishes generating. Falls back to a
// full clear only when the asset can't be resolved to a URL at all.
subscribePeaksUpdated((assetId) => {
  const asset = assetId ? getAssetById(assetId) : null;
  if (!asset?.url) {
    peakCache.clear();
    return;
  }
  const tail = (value) => String(value).split(/[/\\]/).pop();
  const urlTail = tail(asset.url);
  for (const key of [...peakCache.keys()]) {
    const separator = key.indexOf('::');
    const keyUrl = separator === -1 ? key : key.slice(0, separator);
    if (keyUrl === asset.url || tail(keyUrl) === urlTail) peakCache.delete(key);
  }
});
 
// Cache: URL → Promise<AudioBuffer> (the decoded audio itself, independent
// of resolution) — separate from peakCache so requesting a NEW numPeaks
// for a URL already seen (timeline zoom, track-height expand revealing
// more detail) re-buckets the existing decode instead of re-fetching and
// re-decoding the source audio from scratch.
const bufferCache = new Map();

/** Map.get that also refreshes insertion (LRU) order. */
function lruGet(map, key) {
  const value = map.get(key);
  if (value !== undefined) {
    map.delete(key);
    map.set(key, value);
  }
  return value;
}

/** Map.set that evicts the oldest entries past `max`. */
function lruSet(map, key, value, max) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    map.delete(map.keys().next().value);
  }
}
 
/**
 * Decode audio from a URL and return an AudioBuffer. Cached by URL.
 */
export function decodeAudio(url) {
  const cached = lruGet(bufferCache, url);
  if (cached) return cached;
 
  const promise = (async () => {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      return await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
      audioCtx.close();
    }
  })().catch((err) => {
    bufferCache.delete(url);
    throw err;
  });
 
  lruSet(bufferCache, url, promise, MAX_BUFFER_CACHE_ENTRIES);
  return promise;
}
 
/**
 * Extract MIN/MAX envelope + RMS data from an AudioBuffer, one triple per
 * bucket, so the waveform can be drawn as a true signed envelope (like
 * DaVinci/Audition/most DAWs) instead of a symmetric abs-peak bar.
 *
 * Returns three Float32Arrays of equal length (numPeaks):
 *   - mins:  most-negative sample in each bucket (-1..0)
 *   - maxs:  most-positive sample in each bucket (0..1)
 *   - rms:   root-mean-square loudness of each bucket (0..1) — drawn as a
 *            denser inner fill so louder/busier sections visually read as
 *            "fuller" even when the outer min/max envelope looks similar.
 *
 * @param {AudioBuffer} audioBuffer - decoded audio
 * @param {number} numPeaks - number of buckets to produce
 */
function extractEnvelope(audioBuffer, numPeaks, startSec = 0, endSec = null) {
  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bufferTotalSamples = audioBuffer.length;
 
  // Clamp the requested window into the buffer's actual sample range.
  const windowStartSample = Math.max(0, Math.min(bufferTotalSamples, Math.floor(startSec * sampleRate)));
  const windowEndSample = endSec != null
    ? Math.max(windowStartSample, Math.min(bufferTotalSamples, Math.ceil(endSec * sampleRate)))
    : bufferTotalSamples;
  const totalSamples = windowEndSample - windowStartSample;
 
  if (totalSamples <= 0) {
    return { mins: new Float32Array(numPeaks), maxs: new Float32Array(numPeaks), rms: new Float32Array(numPeaks) };
  }
 
  // Average all channels down to one array up front — cheaper than
  // re-reading N channel buffers per-bucket, and a stereo mixdown is what
  // every other part of the app already treats a clip's "loudness" as.
  // Only the requested window is mixed down, not the whole buffer, so a
  // trimmed clip's waveform costs roughly the same as its trimmed length,
  // not the full original file's length.
  const mixed = new Float32Array(totalSamples);
  for (let ch = 0; ch < channels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < totalSamples; i++) {
      mixed[i] += data[windowStartSample + i] / channels;
    }
  }
 
  const samplesPerPeak = Math.max(1, Math.floor(totalSamples / numPeaks));
  const mins = new Float32Array(numPeaks);
  const maxs = new Float32Array(numPeaks);
  const rms = new Float32Array(numPeaks);
 
  for (let i = 0; i < numPeaks; i++) {
    const start = i * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, totalSamples);
    let min = 0;
    let max = 0;
    let sumSq = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      const v = mixed[j];
      if (v < min) min = v;
      if (v > max) max = v;
      sumSq += v * v;
      count++;
    }
    mins[i] = min;
    maxs[i] = max;
    rms[i] = count > 0 ? Math.sqrt(sumSq / count) : 0;
  }
 
  return { mins, maxs, rms };
}
 
/**
 * Get a MIN/MAX/RMS waveform envelope for a given audio URL, at the
 * requested resolution, optionally windowed to a [startSec, endSec) slice
 * of the underlying file. This is what makes a trimmed clip's waveform
 * actually show the trimmed audio instead of always stretching the full
 * original file across the clip's current width — pass the clip's own
 * mediaOffset/duration (its in/out points into the source file) as
 * startSec/endSec and only that slice gets drawn.
 *
 * Results are cached per (url, numPeaks, startSec, endSec) — re-trimming
 * a clip (new offset/duration) re-buckets from the already-decoded
 * AudioBuffer (see decodeAudio's own cache) rather than re-fetching or
 * re-decoding the source file.
 *
 * @param {string} url - audio file URL (blob: or http(s):)
 * @param {number} [numPeaks=200] - number of envelope buckets
 * @param {number} [startSec=0] - start of the window, in seconds into the source file
 * @param {number|null} [endSec=null] - end of the window, in seconds into the source file (null = to the end)
 * @returns {Promise<{ mins: Float32Array, maxs: Float32Array, rms: Float32Array }>}
 */
export function getWaveformPeaks(url, numPeaks = 200, startSec = 0, endSec = null) {
  const empty = () => ({ mins: new Float32Array(0), maxs: new Float32Array(0), rms: new Float32Array(0) });
  if (!url) return Promise.resolve(empty());
 
  const cacheKey = `${url}::${numPeaks}::${startSec}::${endSec ?? 'end'}`;
  const cached = lruGet(peakCache, cacheKey);
  if (cached) return cached;
 
  const promise = (async () => {
    // 1. Generated peak file (fills in for long media, and after first run
    //    for short media too).
    try {
      const parsed = await getPeaksForUrl(url);
      if (parsed) {
        return slicePeaks(parsed, startSec, endSec == null ? parsed.duration : endSec, numPeaks);
      }
    } catch (err) {
      console.warn('Waveform peak read failed, falling back to decode:', err);
    }

    // 2. Refuse to decode long media. On desktop the ONLY files allowed
    //    through to the in-memory path are ones we can positively identify
    //    as short — a resolved asset whose probed duration is under the
    //    threshold. Anything longer (or unidentifiable) falls back to the
    //    empty placeholder, which WaveformCanvas fills while the background
    //    peak generation finishes; that is what keeps a 30-60 minute file
    //    from ever being decoded whole. In a browser there is no FFmpeg
    //    sidecar and no generator, so the old decode path stays available.
    const asset = getAssetByUrl(url);
    if (isTauri() && (!asset || (asset.duration || 0) > LONG_MEDIA_THRESHOLD_SEC)) {
      return empty();
    }

    // 3. Old in-memory path — short files and the browser build.
    const buffer = await decodeAudio(url);
    return extractEnvelope(buffer, numPeaks, startSec, endSec);
  })().catch((err) => {
    console.warn('Waveform decode failed:', err);
    peakCache.delete(cacheKey);
    return empty();
  });
 
  lruSet(peakCache, cacheKey, promise, MAX_PEAK_CACHE_ENTRIES);
  return promise;
}
 
/**
 * Clear the waveform caches (e.g. on project load).
 */
export function clearWaveformCache() {
  peakCache.clear();
  bufferCache.clear();
}
 