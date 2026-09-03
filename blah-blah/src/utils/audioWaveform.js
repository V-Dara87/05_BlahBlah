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

// Cache: URL → Promise<Float32Array> (resolved peaks)
const peakCache = new Map();

/**
 * Decode audio from a URL and return an AudioBuffer.
 */
async function decodeAudio(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    return audioBuffer;
  } finally {
    audioCtx.close();
  }
}

/**
 * Extract peak amplitude data from an AudioBuffer.
 * Returns a Float32Array of peak values (0..1) at the given resolution.
 *
 * @param {AudioBuffer} audioBuffer - decoded audio
 * @param {number} numPeaks - number of peak samples to produce
 * @returns {Float32Array} array of peak amplitudes (0..1)
 */
function extractPeaks(audioBuffer, numPeaks) {
  const channelData = audioBuffer.getChannelData(0); // mono mix from first channel
  const totalSamples = channelData.length;
  const samplesPerPeak = Math.max(1, Math.floor(totalSamples / numPeaks));
  const peaks = new Float32Array(numPeaks);

  for (let i = 0; i < numPeaks; i++) {
    const start = i * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, totalSamples);
    let max = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channelData[j]);
      if (abs > max) max = abs;
    }
    peaks[i] = max;
  }

  return peaks;
}

/**
 * Get waveform peaks for a given audio URL.
 * Returns a Float32Array of peak amplitudes. Results are cached.
 *
 * @param {string} url - audio file URL (blob: or http(s):)
 * @param {number} [numPeaks=200] - number of peak samples
 * @returns {Promise<Float32Array>} peak amplitudes (0..1)
 */
export function getWaveformPeaks(url, numPeaks = 200) {
  if (!url) return Promise.resolve(new Float32Array(0));

  if (peakCache.has(url)) {
    return peakCache.get(url);
  }

  const promise = decodeAudio(url)
    .then((buffer) => extractPeaks(buffer, numPeaks))
    .catch((err) => {
      console.warn('Waveform decode failed:', err);
      peakCache.delete(url);
      return new Float32Array(0);
    });

  peakCache.set(url, promise);
  return promise;
}

/**
 * Clear the waveform peak cache (e.g. on project load).
 */
export function clearWaveformCache() {
  peakCache.clear();
}
