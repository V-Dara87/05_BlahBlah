/**
 * Transcript cleanup for speech engines that return raw model text.
 *
 * Qwen3-ASR's Khmer fine-tune is known to repeat phrases on long or hesitant
 * audio ("ខ្ញុំគិតថា ខ្ញុំគិតថា ខ្ញុំគិតថា …"), and its raw decode can carry a
 * language prefix / <asr_text> marker. Both are handled here, once, so every
 * consumer (subtitle generation, tools/asr_eval.py's JS counterpart, tests)
 * sees the same clean string.
 *
 * A phrase that legitimately repeats twice ("very very good") is preserved;
 * only a run of `minRepeats` (3) or more identical n-grams is collapsed to one,
 * which is what runaway generation looks like.
 *
 * Pure functions, no engine or Tauri dependency.
 */

const LANGUAGE_PREFIX_RE = /^\s*language\s+[A-Za-z][A-Za-z ()-]*\s*(?=<asr_text>)/i;
const ASR_TEXT_TOKEN_RE = /<\/?asr_text>/gi;
const CHAT_TOKEN_RE = /<\/?\|?(?:im_start|im_end|endoftext)\|?>/gi;

/**
 * Whitespace-normalizes and strips model scaffolding (language prefix,
 * <asr_text> / chat markers). Returns '' for non-strings.
 */
export function normalizeTranscript(text) {
  if (typeof text !== 'string') return '';
  let out = text.replace(/\r\n?/g, '\n');
  out = out.replace(LANGUAGE_PREFIX_RE, ' ');
  out = out.replace(ASR_TEXT_TOKEN_RE, ' ');
  out = out.replace(CHAT_TOKEN_RE, ' ');
  return out
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function gramAt(tokens, index, size) {
  let key = '';
  for (let offset = 0; offset < size; offset += 1) {
    key += `${tokens[index + offset]}\u0001`;
  }
  return key;
}

/** One left-to-right pass: collapse runs of the same `size`-token n-gram. */
function collapseRuns(tokens, size, minRepeats) {
  const out = [];
  let index = 0;

  while (index < tokens.length) {
    if (index + size > tokens.length) {
      out.push(...tokens.slice(index));
      break;
    }

    const first = gramAt(tokens, index, size);
    let run = 1;
    while (index + (run + 1) * size <= tokens.length && gramAt(tokens, index + run * size, size) === first) {
      run += 1;
    }

    const keep = run >= minRepeats ? 1 : run;
    for (let repeat = 0; repeat < keep; repeat += 1) {
      for (let offset = 0; offset < size; offset += 1) {
        out.push(tokens[index + repeat * size + offset]);
      }
    }
    index += run * size;
  }

  return out;
}

/**
 * Collapses runaway repeated n-grams (1..maxGram tokens) down to one occurrence.
 * Runs to a fixed point so nested repetition ("a a a b a a a b …") is handled.
 *
 * @param {string} text
 * @param {{ minRepeats?: number, maxGram?: number, maxPasses?: number }} [options]
 * @returns {string}
 */
export function collapseRepeatedText(text, { minRepeats = 3, maxGram = 5, maxPasses = 3 } = {}) {
  const normalized = normalizeTranscript(text);
  if (!normalized) return '';

  const repeatThreshold = Math.max(2, Number(minRepeats) || 3);
  const gramLimit = Math.max(1, Number(maxGram) || 5);
  let tokens = normalized.split(' ');

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let next = tokens;
    const largestGram = Math.max(1, Math.min(gramLimit, Math.floor(tokens.length / repeatThreshold)));
    for (let size = largestGram; size >= 1; size -= 1) {
      next = collapseRuns(next, size, repeatThreshold);
    }
    if (next.length === tokens.length && next.every((token, index) => token === tokens[index])) break;
    tokens = next;
  }

  return tokens.join(' ');
}

/** Normalize + collapse: the text that ends up in a subtitle phrase. */
export function cleanTranscript(text) {
  return collapseRepeatedText(text);
}

function roundMillis(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Normalizes one chunk's word timings into SubtitleTrack's phrase.words shape
 * (`{ word, start, end }`): trimmed text, entries clamped to the phrase window,
 * sorted by start time, and empty/invalid/zero-length entries dropped.
 *
 * The forced aligner returns `{ text, start, end }` per token, already offset
 * into clip time by the helper. Alignment can round a word slightly past the
 * chunk boundary (it was aligned against the chunk audio), so clamping here is
 * what keeps a phrase's words inside that phrase.
 *
 * @param {Array<{ text?: string, word?: string, start: number, end: number }>} words
 * @param {{ startTime?: number, endTime?: number }} [bounds]
 * @returns {Array<{ word: string, start: number, end: number }>}
 */
export function normalizeWordTimings(words, { startTime = 0, endTime = Infinity } = {}) {
  const lower = Number.isFinite(Number(startTime)) ? Number(startTime) : 0;
  const requestedUpper = Number(endTime);
  const upper = Number.isFinite(requestedUpper) ? requestedUpper : Infinity;

  const normalized = [];
  for (const item of Array.isArray(words) ? words : []) {
    const rawText =
      typeof item?.word === 'string' ? item.word : typeof item?.text === 'string' ? item.text : '';
    const word = rawText.replace(/\s+/g, ' ').trim();
    if (!word) continue;

    const rawStart = Number(item?.start);
    const rawEnd = Number(item?.end);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;

    const start = roundMillis(Math.max(lower, Math.min(upper, rawStart)));
    const end = roundMillis(Math.max(lower, Math.min(upper, rawEnd)));
    if (end <= start) continue;

    normalized.push({ word, start, end });
  }

  return normalized.sort((a, b) => a.start - b.start || a.end - b.end);
}
