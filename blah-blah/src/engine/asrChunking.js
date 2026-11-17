/**
 * Speech-chunk planning for engines that return text without timestamps.
 *
 * Whisper emits an SRT with its own timings. Qwen3-ASR returns a plain string
 * per call, so the subtitle timings have to come from somewhere else: detect
 * silences with ffmpeg, treat everything between them as speech, then split
 * each speech span into pieces of at most ~25 s. Each piece becomes one phrase. No
 * overlap is ever produced: every chunk ends exactly where the next begins.
 *
 * Everything here is pure so it can be unit-tested without ffmpeg, Tauri, or a
 * GPU (see tests/qwen-asr.test.mjs).
 */

export const DEFAULT_MAX_CHUNK_SECONDS = 25;
export const DEFAULT_MIN_CHUNK_SECONDS = 0.5;
export const DEFAULT_SILENCE_NOISE_DB = -35;
export const DEFAULT_SILENCE_MIN_SECONDS = 0.4;

/** ffmpeg arguments that print silence_start / silence_end lines to stderr. */
export function buildSilenceDetectArgs(
  inputPath,
  { noiseDb = DEFAULT_SILENCE_NOISE_DB, minSilenceSeconds = DEFAULT_SILENCE_MIN_SECONDS } = {}
) {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    inputPath,
    '-af',
    `silencedetect=noise=${noiseDb}dB:d=${minSilenceSeconds}`,
    '-f',
    'null',
    '-',
  ];
}

/**
 * Parses ffmpeg's silencedetect log into silence intervals.
 *
 * A silence that is still open when the log ends (the clip finishes while
 * quiet) is returned with `end: null`; the planner treats that as "until the
 * end of the audio".
 *
 * @param {string} log - ffmpeg stderr containing silencedetect lines.
 * @returns {Array<{ start: number, end: number|null }>}
 */
export function parseSilenceDetectOutput(log) {
  const silences = [];
  let openStart = null;

  for (const line of String(log ?? '').split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (startMatch) {
      const start = Math.max(0, Number(startMatch[1]));
      // Two starts in a row means the previous silence never reported an end.
      if (openStart !== null && start > openStart) silences.push({ start: openStart, end: start });
      openStart = start;
      continue;
    }

    const endMatch = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (!endMatch) continue;

    const end = Math.max(0, Number(endMatch[1]));
    if (openStart === null) {
      silences.push({ start: 0, end });
    } else if (end > openStart) {
      silences.push({ start: openStart, end });
    }
    openStart = null;
  }

  if (openStart !== null) silences.push({ start: openStart, end: null });
  return silences;
}

function roundSeconds(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Plans non-overlapping speech chunks.
 *
 * @param {object} params
 * @param {number} params.duration - Length of the extracted audio, in seconds.
 * @param {Array<{ start: number, end: number|null }>} [params.silences]
 * @param {number} [params.maxChunkSeconds=25] - Upper bound for one chunk.
 * @param {number} [params.minChunkSeconds=0.5] - Shorter blips are discarded.
 * @returns {Array<{ start: number, end: number }>} Chunks in ascending order.
 */
export function planSpeechChunks({
  duration,
  silences = [],
  maxChunkSeconds = DEFAULT_MAX_CHUNK_SECONDS,
  minChunkSeconds = DEFAULT_MIN_CHUNK_SECONDS,
} = {}) {
  const total = Number(duration);
  if (!Number.isFinite(total) || total <= 0) return [];

  const requestedMax = Number(maxChunkSeconds);
  const maxChunk = requestedMax > 0 ? requestedMax : DEFAULT_MAX_CHUNK_SECONDS;
  const requestedMin = Number(minChunkSeconds);
  const minChunk = Number.isFinite(requestedMin) && requestedMin >= 0 ? requestedMin : DEFAULT_MIN_CHUNK_SECONDS;

  // Clamp, drop empty intervals, and merge overlaps so the complement of the
  // silences (i.e. the speech) is unambiguous.
  const merged = [];
  for (const silence of (Array.isArray(silences) ? silences : [])
    .map((item) => {
      const start = Math.min(total, Math.max(0, Number(item?.start) || 0));
      const rawEnd = item?.end === null || item?.end === undefined ? total : Number(item.end);
      const end = Math.min(total, Math.max(start, Number.isFinite(rawEnd) ? rawEnd : total));
      return { start, end };
    })
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (previous && silence.start <= previous.end) {
      previous.end = Math.max(previous.end, silence.end);
    } else {
      merged.push({ ...silence });
    }
  }

  const speechSpans = [];
  let cursor = 0;
  for (const silence of merged) {
    if (silence.start > cursor) speechSpans.push({ start: cursor, end: silence.start });
    cursor = Math.max(cursor, silence.end);
  }
  if (cursor < total) speechSpans.push({ start: cursor, end: total });

  const chunks = [];
  for (const span of speechSpans) {
    const length = span.end - span.start;
    if (length <= 0 || length < minChunk) continue;

    // Split an over-long speech span into equal pieces: there is no silence to
    // cut at, and equal pieces keep every chunk under the limit.
    const parts = Math.max(1, Math.ceil((length - 1e-6) / maxChunk));
    const partLength = length / parts;
    for (let index = 0; index < parts; index += 1) {
      const start = roundSeconds(span.start + index * partLength);
      const end = roundSeconds(Math.min(total, span.start + (index + 1) * partLength));
      if (end > start) chunks.push({ start, end });
    }
  }

  return chunks;
}
