/**
 * Audio Waveform — decodes audio from a URL and extracts peak amplitude
 * data for rendering waveforms on the timeline.
 *
 * Uses the Web Audio API's OfflineAudioContext to decode the audio buffer,
 * then downsamples it to a manageable number of peaks for canvas rendering.
 *
 * Peak data is cached by URL to avoid re-decoding the same audio file
 * across re-renders or multiple clips using the same source.
 */
 
// Cache: `${url}::${numPeaks}` → Promise<{ mins, maxs, rms }> (resolved envelope)
const peakCache = new Map();
 
// Cache: URL → Promise<AudioBuffer> (the decoded audio itself, independent
// of resolution) — separate from peakCache so requesting a NEW numPeaks
// for a URL already seen (timeline zoom, track-height expand revealing
// more detail) re-buckets the existing decode instead of re-fetching and
// re-decoding the source audio from scratch.
const bufferCache = new Map();
 
/**
 * Decode audio from a URL and return an AudioBuffer. Cached by URL.
 */
export function decodeAudio(url) {
  if (bufferCache.has(url)) return bufferCache.get(url);
 
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
 
  bufferCache.set(url, promise);
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
  if (peakCache.has(cacheKey)) {
    return peakCache.get(cacheKey);
  }
 
  const promise = decodeAudio(url)
    .then((buffer) => extractEnvelope(buffer, numPeaks, startSec, endSec))
    .catch((err) => {
      console.warn('Waveform decode failed:', err);
      peakCache.delete(cacheKey);
      return empty();
    });
 
  peakCache.set(cacheKey, promise);
  return promise;
}
 
/**
 * Clear the waveform caches (e.g. on project load).
 */
export function clearWaveformCache() {
  peakCache.clear();
  bufferCache.clear();
}
 