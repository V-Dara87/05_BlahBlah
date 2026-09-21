/**
 * Pitch-preserving time-stretch (WSOLA — Waveform-Similarity Overlap-Add).
 *
 * WHY THIS EXISTS — export/preview parity for clip speed.
 * The live preview plays audio through HTMLMediaElement, whose
 * `playbackRate` keeps the pitch unchanged (`preservesPitch` defaults to
 * true). The export mixdown used AudioBufferSourceNode.playbackRate
 * instead, which is a plain resample: a 1.1x voice came out ~1.65
 * semitones higher than in the preview. Web Audio has no pitch-preserving
 * option on AudioBufferSourceNode, so the export stretches the samples
 * here first and then schedules them at playbackRate 1.
 *
 * `rate` > 1 makes the audio faster/shorter, `rate` < 1 slower/longer:
 *   output length = round(input length / rate)
 *
 * How it works: the input is cut into overlapping ~30 ms grains that are
 * overlap-added (Hann window, 50 % overlap) onto a regular output grid.
 * The read position of each grain is nudged by up to ±12 ms to the spot
 * whose waveform best continues the previous grain, which keeps the
 * periodic structure of voiced speech in phase (no phasing/"robot" buzz).
 * All channels share the same alignment (chosen on a mono mixdown) so the
 * stereo image stays coherent.
 *
 * Pure function of its inputs — no Web Audio, no DOM — so it runs the
 * same in the browser and in Node tests.
 *
 * @param {Float32Array[]} channels   one Float32Array per channel (equal length)
 * @param {number}         sampleRate Hz
 * @param {number}         rate       playback-speed factor (e.g. 1.1)
 * @returns {Promise<Float32Array[]>} stretched channels (new arrays)
 */
export async function timeStretchChannels(channels, sampleRate, rate) {
  const numCh = channels.length;
  if (numCh === 0) return [];
  const inLen = channels[0].length;

  // Nothing to do (or nothing sensible to do): hand back plain copies.
  if (!(rate > 0) || !Number.isFinite(rate) || Math.abs(rate - 1) < 1e-4 || inLen < 2) {
    return channels.map((c) => Float32Array.from(c));
  }

  const outLen = Math.max(1, Math.round(inLen / rate));

  // ~30 ms grains, even length so the 50 % hop is an integer.
  let N = Math.round(sampleRate * 0.03);
  N += N % 2;
  const Hs = N / 2; // synthesis hop (output grid)
  const Ha = Hs * rate; // nominal analysis hop (input advance per grain)
  const tol = Math.max(1, Math.round(sampleRate * 0.012)); // ± search range
  const CAND_STEP = 2; // candidate spacing (samples)
  const CORR_STRIDE = 4; // correlation sub-sampling (speed)

  // Periodic Hann: w[n] + w[n + N/2] === 1 exactly, so 50 % overlap-add
  // reconstructs unity gain with no normalisation pass.
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  // First grain has nothing before it to cross-fade with: keep its first
  // half flat instead of fading in from silence.
  const winFirst = Float32Array.from(win);
  for (let i = 0; i < Hs; i++) winFirst[i] = 1;

  // Mono analysis signal, zero-padded so correlation reads never go OOB.
  const pad = Math.ceil(Ha) + N * 3 + tol * 2 + 64;
  const mono = new Float32Array(inLen + pad);
  for (let ch = 0; ch < numCh; ch++) {
    const x = channels[ch];
    for (let i = 0; i < inLen; i++) mono[i] += x[i] / numCh;
  }

  const outs = channels.map(() => new Float32Array(outLen + N));
  const corrLen = Hs;

  let prevPos = 0;
  let lastYield = typeof performance !== 'undefined' ? performance.now() : 0;

  for (let k = 0; k * Hs < outLen; k++) {
    const outPos = k * Hs;
    let pos;

    if (k === 0) {
      pos = 0;
    } else {
      const nominal = Math.max(0, Math.round(k * Ha));
      // Natural continuation of the previous grain's tail.
      const tmpl = prevPos + Hs;

      const score = (c) => {
        let dot = 0;
        let energy = 0;
        for (let i = 0; i < corrLen; i += CORR_STRIDE) {
          const b = mono[c + i];
          dot += mono[tmpl + i] * b;
          energy += b * b;
        }
        return dot / Math.sqrt(energy + 1e-9);
      };

      // Nominal position first so ties (silence, pure DC) keep the grid.
      pos = nominal;
      let best = score(nominal);
      const lo = Math.max(0, nominal - tol);
      const hi = nominal + tol;
      for (let c = lo; c <= hi; c += CAND_STEP) {
        if (c === nominal) continue;
        const s = score(c);
        if (s > best + 1e-12) {
          best = s;
          pos = c;
        }
      }
    }

    const w = k === 0 ? winFirst : win;
    for (let ch = 0; ch < numCh; ch++) {
      const x = channels[ch];
      const y = outs[ch];
      const limit = Math.min(N, inLen - pos);
      for (let i = 0; i < limit; i++) y[outPos + i] += x[pos + i] * w[i];
    }

    prevPos = pos;

    // Long clips: let the UI breathe instead of freezing the export dialog.
    if (typeof performance !== 'undefined' && performance.now() - lastYield > 30) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastYield = performance.now();
    }
  }

  return outs.map((y) => y.slice(0, outLen));
}