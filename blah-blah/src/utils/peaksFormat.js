/**
 * peaksFormat — pure, dependency-free peak-file format for the timeline
 * waveform.
 *
 * The old waveform path (see utils/audioWaveform.js) decoded a whole audio
 * file into an AudioBuffer with `decodeAudioData` and kept it in memory
 * forever, so a one-hour stereo recording cost >1 GB of RAM before a single
 * waveform pixel was drawn, and every zoom/trim re-mixed that same buffer.
 * This module is the replacement storage layer: a multi-resolution "peak
 * file" that a media file is decoded into ONCE (by peakGenerator.js, via the
 * FFmpeg sidecar) and then read back in small slices.
 *
 * Layout
 * ------
 * A peak file holds several resolution LEVELS of the same audio. Level 0 is
 * the finest — `DEFAULT_PEAKS_PER_SECOND` peaks per second — and every
 * coarser level halves the resolution again (LEVEL_FACTOR = 2), so level L
 * holds `finestPps / 2^L` peaks per second. Each peak is BYTES_PER_PEAK = 3
 * bytes: a signed min, a signed max (both normalized -1..1) and an unsigned
 * RMS (0..1). At the finest level that is ~10 MB per hour of audio, which is
 * enough for the maximum timeline zoom while staying small enough to read
 * from disk in slices.
 *
 * Coarser levels are pure functions of the finest one (see
 * buildLevelsFromFinest): each coarser peak aggregates a fixed-size group of
 * finest peaks, so no level can drift from another.
 *
 * Nothing here touches the DOM, the filesystem or the network — it is all
 * plain array/byte math so it can be unit-tested in Node.
 */

/** 8-byte ASCII magic at the start of every peak file. */
export const PEAKS_MAGIC = 'BLHPEAKS';
/** Bumped only when the byte layout changes in a breaking way. */
export const PEAKS_VERSION = 1;
/** Finest level resolution. */
export const DEFAULT_PEAKS_PER_SECOND = 1000;
/** Each coarser level divides the previous level's resolution by this. */
export const PEAK_LEVEL_FACTOR = 2;
/** One signed min + one signed max + one unsigned rms byte. */
export const BYTES_PER_PEAK = 3;
/** Header size in bytes (fixed part, before the per-level peak counts). */
export const PEAK_HEADER_BYTES = 26;
/** Guard against a corrupt/huge levelCount field. */
export const MAX_PEAK_LEVELS = 24;

// ─── Byte encoding ───────────────────────────────────────────────────────
//
// min/max are stored as signed bytes so zero maps cleanly and the sign is
// explicit; rms is unsigned because it is a magnitude and wants the full
// byte range. Decoding clamps to [-1, 1] / [0, 1].

/** Normalized sample (-1..1) -> signed byte (-128..127). */
export function encodeSignedByte(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const scaled = Math.round(n * 127);
  if (scaled > 127) return 127;
  if (scaled < -128) return -128;
  return scaled;
}

/**
 * Raw byte (0..255, as read from a Uint8Array) -> normalized sample
 * (-1..1). Bytes are two's-complement signed on disk, so anything above
 * 127 is a negative value.
 */
export function decodeSignedByte(b) {
  const signed = b > 127 ? b - 256 : b;
  return Math.max(-1, signed / 127);
}

/** Raw byte (0..255) -> its signed int8 value. */
function toSignedByte(b) {
  return b > 127 ? b - 256 : b;
}

/** Normalized magnitude (0..1) -> unsigned byte (0..255). */
export function encodeRmsByte(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const scaled = Math.round(n * 255);
  return scaled > 255 ? 255 : scaled;
}

/** Unsigned byte -> normalized magnitude (0..1). */
export function decodeRmsByte(b) {
  return b / 255;
}

/** A blank envelope in the exact shape WaveformCanvas draws. */
export function emptyEnvelope(numBuckets = 0) {
  const n = Math.max(0, numBuckets | 0);
  return { mins: new Float32Array(n), maxs: new Float32Array(n), rms: new Float32Array(n) };
}

// ─── Finest-level builder (streaming) ────────────────────────────────────
//
// peakGenerator.js decodes the source to raw mono PCM in a temp file and
// reads it back in chunks. The builder consumes those chunks incrementally
// so peak memory stays bounded by the OUTPUT peak data (~10 MB/hour), not by
// the source audio. Chunk boundaries do not line up with peak boundaries, so
// the builder keeps an absolute sample counter and closes a peak exactly
// when the counter reaches that peak's boundary — no sample is dropped or
// double-counted across chunk seams.

/**
 * A growable byte buffer for peak triples. Doubling growth keeps the total
 * allocation O(peakCount) without needing the duration up front.
 */
function createByteAccumulator(initialBytes = 1024) {
  let buf = new Uint8Array(initialBytes);
  let len = 0;
  return {
    push(a, b, c) {
      if (len + BYTES_PER_PEAK > buf.length) {
        let next = buf.length * 2;
        while (next < len + BYTES_PER_PEAK) next *= 2;
        const grown = new Uint8Array(next);
        grown.set(buf.subarray(0, len));
        buf = grown;
      }
      buf[len++] = a;
      buf[len++] = b;
      buf[len++] = c;
    },
    /** Trimmed view of exactly the bytes written. */
    toUint8Array() {
      return buf.slice(0, len);
    },
  };
}

/**
 * Streaming builder for the FINEST peak level.
 *
 * @param {object} [options]
 * @param {number} [options.sampleRate=8000] - sample rate of the mono PCM fed in
 * @param {number} [options.peaksPerSecond=DEFAULT_PEAKS_PER_SECOND]
 */
export function createFinestLevelBuilder({
  sampleRate = 8000,
  peaksPerSecond = DEFAULT_PEAKS_PER_SECOND,
} = {}) {
  // Guard against a caller passing a sample rate below the requested
  // resolution (which would make a peak cover <1 sample and could wedge the
  // boundary loop below).
  const samplesPerPeak = Math.max(1, sampleRate / peaksPerSecond);
  const acc = createByteAccumulator();

  let consumed = 0; // absolute sample index of the next sample to arrive
  let peakIndex = 0;
  let min = 0;
  let max = 0;
  let sumSq = 0;
  let count = 0;
  let finished = false;

  const flush = () => {
    // A trailing partial peak still gets emitted so the level's duration
    // covers the whole file; count==0 means only reachable via finish() on
    // an empty input, in which case there is nothing to emit.
    if (count === 0) return;
    acc.push(
      encodeSignedByte(min),
      encodeSignedByte(max),
      encodeRmsByte(Math.sqrt(sumSq / count))
    );
    min = 0;
    max = 0;
    sumSq = 0;
    count = 0;
    peakIndex++;
  };

  const pushSample = (v) => {
    // Close every peak boundary we have now passed (samplesPerPeak can be
    // fractional, e.g. 44100/1000, so a chunk may cross several boundaries).
    while (consumed >= Math.round((peakIndex + 1) * samplesPerPeak)) flush();
    if (v < min) min = v;
    if (v > max) max = v;
    sumSq += v * v;
    count++;
    consumed++;
  };

  return {
    /** Feed a chunk of mono samples in [-1, 1]. */
    pushSamples(samples) {
      if (finished) throw new Error('Peak level builder already finished');
      if (!samples) return;
      for (let i = 0; i < samples.length; i++) pushSample(samples[i]);
    },
    /** Feed a chunk of mono signed 16-bit PCM (FFmpeg's raw output format). */
    pushInt16(samples) {
      if (finished) throw new Error('Peak level builder already finished');
      if (!samples) return;
      const scale = 1 / 32768;
      for (let i = 0; i < samples.length; i++) pushSample(samples[i] * scale);
    },
    get peakCount() {
      return peakIndex;
    },
    get samplesPerPeak() {
      return samplesPerPeak;
    },
    /**
     * Finalize and return the finest level bytes.
     * @returns {{ bytes: Uint8Array, peakCount: number, sampleRate: number, peaksPerSecond: number }}
     */
    finish() {
      if (!finished) {
        flush();
        finished = true;
      }
      return {
        bytes: acc.toUint8Array(),
        peakCount: peakIndex,
        sampleRate,
        peaksPerSecond,
      };
    },
  };
}

// ─── Coarser levels ──────────────────────────────────────────────────────

/** How many levels (including the finest) are worth storing for this audio. */
export function computeLevelCount(peakCount, peaksPerSecond = DEFAULT_PEAKS_PER_SECOND) {
  let levels = 1;
  let count = peakCount;
  let pps = peaksPerSecond;
  while (levels < MAX_PEAK_LEVELS && count > 4 && pps > 1) {
    count = Math.ceil(count / PEAK_LEVEL_FACTOR);
    pps = pps / PEAK_LEVEL_FACTOR;
    levels++;
  }
  return levels;
}

/**
 * Build every level from the finest one. Level L aggregates groups of
 * `LEVEL_FACTOR^L` consecutive finest peaks:
 *   min  = min of the group's mins
 *   max  = max of the group's maxs
 *   rms  = sqrt(mean of the group's squared rms values)   (energy preserving)
 * All levels are therefore derived directly from level 0 and cannot drift.
 *
 * @param {Uint8Array} finestBytes - interleaved min/max/rms triples
 * @param {object} options
 * @param {number} options.peakCount - number of peaks in finestBytes
 * @param {number} [options.peaksPerSecond=DEFAULT_PEAKS_PER_SECOND]
 * @param {number} [options.levelCount] - defaults to computeLevelCount(peakCount)
 * @returns {Uint8Array[]} levels, index 0 = finest
 */
export function buildLevelsFromFinest(finestBytes, {
  peakCount,
  peaksPerSecond = DEFAULT_PEAKS_PER_SECOND,
  levelCount,
} = {}) {
  if (!finestBytes || peakCount <= 0) return [new Uint8Array(0)];
  const levels = Math.max(1, Math.min(MAX_PEAK_LEVELS, levelCount || computeLevelCount(peakCount, peaksPerSecond)));
  const out = [finestBytes];

  for (let level = 1; level < levels; level++) {
    const group = PEAK_LEVEL_FACTOR ** level;
    const outCount = Math.ceil(peakCount / group);
    const bytes = new Uint8Array(outCount * BYTES_PER_PEAK);
    for (let p = 0; p < outCount; p++) {
      const from = p * group;
      const to = Math.min(from + group, peakCount);
      let minRaw = 0;
      let maxRaw = 0;
      let minSigned = 0;
      let maxSigned = 0;
      let rmsSumSq = 0;
      let n = 0;
      for (let i = from; i < to; i++) {
        const o = i * BYTES_PER_PEAK;
        const sMn = toSignedByte(finestBytes[o]);
        const sMx = toSignedByte(finestBytes[o + 1]);
        if (n === 0 || sMn < minSigned) { minSigned = sMn; minRaw = finestBytes[o]; }
        if (n === 0 || sMx > maxSigned) { maxSigned = sMx; maxRaw = finestBytes[o + 1]; }
        const f = decodeRmsByte(finestBytes[o + 2]);
        rmsSumSq += f * f;
        n++;
      }
      const outOffset = p * BYTES_PER_PEAK;
      bytes[outOffset] = minRaw;
      bytes[outOffset + 1] = maxRaw;
      bytes[outOffset + 2] = encodeRmsByte(n > 0 ? Math.sqrt(rmsSumSq / n) : 0);
    }
    out.push(bytes);
  }
  return out;
}

// ─── Serialize / parse ───────────────────────────────────────────────────

/**
 * Serialize a complete peak file.
 *
 * Header (little-endian):
 *   0  8 bytes  magic "BLHPEAKS"
 *   8  uint16   version
 *   10 uint32   source sampleRate
 *   14 uint32   finest peaksPerSecond
 *   18 uint32   durationMs
 *   22 uint8    levelCount
 *   23 uint8    bytesPerPeak
 *   24 uint16   reserved
 *   26 uint32[levelCount] peak counts (finest first)
 *   .. level data, concatenated in level order
 *
 * @returns {Uint8Array}
 */
export function serializePeakFile({ sampleRate = 8000, durationSec = 0, peaksPerSecond = DEFAULT_PEAKS_PER_SECOND, levels } = {}) {
  const list = Array.isArray(levels) ? levels.filter(Boolean) : [];
  const levelCount = list.length;
  if (levelCount === 0) throw new Error('serializePeakFile requires at least one level');

  const counts = list.map((bytes) => Math.floor((bytes.length || 0) / BYTES_PER_PEAK));
  const dataBytes = counts.reduce((a, b) => a + b, 0) * BYTES_PER_PEAK;
  const total = PEAK_HEADER_BYTES + levelCount * 4 + dataBytes;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  for (let i = 0; i < PEAKS_MAGIC.length; i++) buf[i] = PEAKS_MAGIC.charCodeAt(i);
  view.setUint16(8, PEAKS_VERSION, true);
  view.setUint32(10, Math.max(0, Math.round(sampleRate)) >>> 0, true);
  view.setUint32(14, Math.max(1, Math.round(peaksPerSecond)) >>> 0, true);
  view.setUint32(18, Math.max(0, Math.round(durationSec * 1000)) >>> 0, true);
  buf[22] = levelCount;
  buf[23] = BYTES_PER_PEAK;
  view.setUint16(24, 0, true);

  let offset = PEAK_HEADER_BYTES;
  for (let i = 0; i < levelCount; i++) {
    view.setUint32(offset, counts[i] >>> 0, true);
    offset += 4;
  }
  for (let i = 0; i < levelCount; i++) {
    buf.set(list[i], offset);
    offset += list[i].length;
  }
  return buf;
}

/**
 * Parse a peak file back into its levels. Returns null for anything that is
 * not a recognizable/valid peak file (magic or version mismatch, truncated
 * data, nonsensical counts) so callers can treat it as a cache miss instead
 * of crashing on a half-written file.
 *
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {null | { sampleRate:number, duration:number, peaksPerSecond:number, levelCount:number, peakCounts:number[], levels:Uint8Array[], peakCount:number }}
 */
export function parsePeakFile(input) {
  if (!input) return null;
  const bytes = input instanceof Uint8Array
    ? input
    : (input instanceof ArrayBuffer ? new Uint8Array(input) : null);
  if (!bytes || bytes.length < PEAK_HEADER_BYTES) return null;

  for (let i = 0; i < PEAKS_MAGIC.length; i++) {
    if (bytes[i] !== PEAKS_MAGIC.charCodeAt(i)) return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(8, true);
  if (version !== PEAKS_VERSION) return null;

  const sampleRate = view.getUint32(10, true);
  const peaksPerSecond = view.getUint32(14, true);
  const duration = view.getUint32(18, true) / 1000;
  const levelCount = bytes[22];
  const bytesPerPeak = bytes[23];
  if (levelCount < 1 || levelCount > MAX_PEAK_LEVELS || bytesPerPeak !== BYTES_PER_PEAK) return null;

  const countsEnd = PEAK_HEADER_BYTES + levelCount * 4;
  if (bytes.length < countsEnd) return null;

  const peakCounts = [];
  let offset = PEAK_HEADER_BYTES;
  for (let i = 0; i < levelCount; i++) {
    peakCounts.push(view.getUint32(offset, true));
    offset += 4;
  }

  const levels = [];
  for (let i = 0; i < levelCount; i++) {
    const byteLen = peakCounts[i] * BYTES_PER_PEAK;
    if (offset + byteLen > bytes.length) return null;
    // subarray is a view (no copy) — the parsed file is the single owner of
    // the backing buffer, and slices are read-only, so sharing is safe.
    levels.push(bytes.subarray(offset, offset + byteLen));
    offset += byteLen;
  }

  return {
    sampleRate,
    duration,
    peaksPerSecond,
    levelCount,
    peakCounts,
    levels,
    peakCount: peakCounts[0] || 0,
  };
}

// ─── Slicing ─────────────────────────────────────────────────────────────

/** Resolution (peaks/sec) of a given level. */
export function levelPeaksPerSecond(peaksPerSecond, level) {
  return peaksPerSecond / (PEAK_LEVEL_FACTOR ** level);
}

/**
 * Pick the coarsest level that still has at least `idealPps` peaks per
 * second. That is the level that needs the least aggregation work while
 * never upsampling (which would stretch/lose detail). Falls back to the
 * finest level when the requested window is narrower than the finest
 * resolution.
 */
export function pickLevel(peaks, idealPps) {
  const levels = peaks.levels || [];
  // Walk from the coarsest level up to the finest; the first one whose
  // resolution still satisfies idealPps is the cheapest that avoids
  // upsampling. If even the finest is too coarse, use the finest.
  for (let level = levels.length - 1; level >= 0; level--) {
    if (levelPeaksPerSecond(peaks.peaksPerSecond, level) >= idealPps) return level;
  }
  return 0;
}

/**
 * Read a [startSec, endSec) window out of a parsed peak file as `numBuckets`
 * min/max/rms buckets — the exact shape WaveformCanvas draws.
 *
 * When the chosen level has fewer peaks than buckets (window shorter than
 * the finest resolution) the last available peak is repeated rather than
 * interpolated: at maximum zoom the difference is a sub-pixel smoothing
 * artefact, and repeating keeps the shape honest (no invented data).
 *
 * @param {ReturnType<typeof parsePeakFile>} peaks
 * @param {number} startSec
 * @param {number} endSec
 * @param {number} numBuckets
 * @returns {{ mins: Float32Array, maxs: Float32Array, rms: Float32Array }}
 */
export function slicePeaks(peaks, startSec, endSec, numBuckets) {
  const buckets = Math.max(1, numBuckets | 0);
  if (!peaks || !peaks.levels || peaks.levels.length === 0 || peaks.peakCount === 0) {
    return emptyEnvelope(buckets);
  }

  const duration = peaks.duration || 0;
  let start = Number.isFinite(startSec) ? startSec : 0;
  let end = Number.isFinite(endSec) && endSec != null ? endSec : duration;
  if (start < 0) start = 0;
  if (duration > 0 && end > duration) end = duration;
  if (end <= start) return emptyEnvelope(buckets);

  const windowDur = end - start;
  const idealPps = buckets / windowDur;
  const level = pickLevel(peaks, idealPps);
  const bytes = peaks.levels[level];
  const count = peaks.peakCounts[level] || 0;
  if (count === 0) return emptyEnvelope(buckets);

  const pps = levelPeaksPerSecond(peaks.peaksPerSecond, level);
  let peakStart = Math.floor(start * pps);
  let peakEnd = Math.ceil(end * pps);
  if (peakStart < 0) peakStart = 0;
  if (peakEnd > count) peakEnd = count;
  if (peakEnd <= peakStart) {
    // The window falls between two stored peaks (possible at the coarsest
    // levels); fall back to the single nearest peak rather than nothing.
    peakStart = Math.min(peakStart, count - 1);
    peakEnd = peakStart + 1;
  }

  const span = peakEnd - peakStart;
  const mins = new Float32Array(buckets);
  const maxs = new Float32Array(buckets);
  const rms = new Float32Array(buckets);

  for (let b = 0; b < buckets; b++) {
    let from = peakStart + Math.floor((b * span) / buckets);
    let to = peakStart + Math.floor(((b + 1) * span) / buckets);
    if (to <= from) to = Math.min(from + 1, peakEnd);
    if (from >= peakEnd) from = peakEnd - 1;

    let minRaw = 0;
    let maxRaw = 0;
    let minSigned = 0;
    let maxSigned = 0;
    let rmsSumSq = 0;
    let n = 0;
    for (let p = from; p < to; p++) {
      const o = p * BYTES_PER_PEAK;
      const sMn = toSignedByte(bytes[o]);
      const sMx = toSignedByte(bytes[o + 1]);
      if (n === 0 || sMn < minSigned) { minSigned = sMn; minRaw = bytes[o]; }
      if (n === 0 || sMx > maxSigned) { maxSigned = sMx; maxRaw = bytes[o + 1]; }
      const f = decodeRmsByte(bytes[o + 2]);
      rmsSumSq += f * f;
      n++;
    }
    mins[b] = decodeSignedByte(minRaw);
    maxs[b] = decodeSignedByte(maxRaw);
    rms[b] = n > 0 ? Math.sqrt(rmsSumSq / n) : 0;
  }

  return { mins, maxs, rms };
}
