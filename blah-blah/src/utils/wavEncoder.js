/**
 * Minimal WAV (RIFF/PCM) encoder used by the voice recorder.
 *
 * MediaRecorder cannot produce WAV (Chromium/WebView2 only offers WebM/Opus,
 * which the rest of the app doesn't treat as audio on reload — see the
 * extension checks in projectFileSystem.js). So the recorder captures raw
 * Float32 PCM through Web Audio and this module wraps it in a WAV container.
 * No re-encoding, no quality loss.
 */
 
/** Merge an array of Float32Array chunks into one contiguous Float32Array. */
export function mergeFloat32Chunks(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
 
/** Sum channel arrays down to mono (average). Single channel is returned as-is. */
export function mixToMono(channelData) {
  if (channelData.length === 1) return channelData[0];
  const len = channelData[0].length;
  const out = new Float32Array(len);
  const n = channelData.length;
  for (let ch = 0; ch < n; ch++) {
    const data = channelData[ch];
    for (let i = 0; i < len; i++) out[i] += data[i] / n;
  }
  return out;
}
 
function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}
 
/**
 * Encode mono Float32 samples (-1..1) as a 16-bit PCM WAV Blob.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {Blob} audio/wav
 */
export function encodeWav(samples, sampleRate) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
 
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                                   // fmt chunk size
  view.setUint16(20, 1, true);                                    // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true);         // block align
  view.setUint16(34, 16, true);                                   // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);
 
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}