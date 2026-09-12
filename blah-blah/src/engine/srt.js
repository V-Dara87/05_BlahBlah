/**
 * SRT import/export — pure functions, no UI/engine dependencies, per
 * step 2 of the subtitle-track implementation plan. Testable
 * independent of everything else the feature touches.
 *
 * SRT is the interchange format for SubtitleTrack.phrases (see
 * subtitleTrack.js) because it already matches the
 * `{ startTime, endTime, text }` shape and has an existing tooling
 * ecosystem — Whisper and other transcription tools output SRT.
 *
 * Word-level timing (`phrase.words`) is a BlahBlah-only extension.
 * Plain SRT carries no word timing, so `parseSrt` never populates
 * `words`, and `toSrt` never emits it — round-tripping a hand-authored
 * or externally-imported SRT file through parse -> export is lossless
 * for the fields SRT actually has, and silently drops `words`/
 * `emphasis`/`language` (BlahBlah-only fields) since those have no SRT
 * representation. Project-native persistence (project.json) keeps the
 * full phrase object including those fields; SRT is only ever the
 * exchange format at the edges (import/export), not the storage format.
 */
import { createPhrase } from './subtitleTrack.js';

const SRT_TIME_RE = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;
const SRT_TIMING_LINE_RE = new RegExp(
  `${SRT_TIME_RE.source}\\s*-->\\s*${SRT_TIME_RE.source}`
);

function srtTimeToSeconds(h, m, s, ms) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

function secondsToSrtTime(totalSeconds) {
  const safe = Math.max(0, totalSeconds || 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const pad2 = (n) => String(n).padStart(2, '0');
  const pad3 = (n) => String(n).padStart(3, '0');
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

/**
 * Parse SRT text into an array of phrase objects (see
 * subtitleTrack.js's createPhrase for the shape). Tolerant of the usual
 * real-world SRT variations: CRLF or LF line endings, a `.` instead of
 * `,` before milliseconds, blank-line-separated blocks with or without
 * a trailing blank line, and a missing/non-numeric index line (some
 * transcription tools omit it or restart numbering — the index itself
 * isn't used for anything here, phrases are ordered by parse order and
 * then re-sorted by startTime like every other phrase mutation).
 *
 * Malformed blocks (no parseable timing line) are skipped rather than
 * throwing, so one bad block in an otherwise-good file doesn't lose the
 * rest of the import.
 */
export function parseSrt(srtText) {
  if (!srtText || typeof srtText !== 'string') return [];

  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  const phrases = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    // Find the timing line — usually line 1 (after an index line), but
    // don't assume position; scan for whichever line actually matches.
    const timingLineIndex = lines.findIndex((l) => SRT_TIMING_LINE_RE.test(l));
    if (timingLineIndex === -1) continue;

    const match = lines[timingLineIndex].match(SRT_TIMING_LINE_RE);
    if (!match) continue;
    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match;
    const startTime = srtTimeToSeconds(h1, m1, s1, ms1);
    const endTime = srtTimeToSeconds(h2, m2, s2, ms2);

    const text = lines
      .slice(timingLineIndex + 1)
      .join('\n')
      .trim();
    if (!text) continue;

    phrases.push(createPhrase({ startTime, endTime, text }));
  }

  return phrases.sort((a, b) => a.startTime - b.startTime);
}

/**
 * Serialize phrases to SRT text. Only the fields SRT actually
 * represents (timing + text) are emitted — `words`/`emphasis`/
 * `language` have no SRT equivalent and are dropped here (they live on
 * long-term in project.json, not in exported SRT). Multi-line phrase
 * text is preserved as-is inside a block.
 */
export function toSrt(phrases) {
  if (!phrases || phrases.length === 0) return '';

  const sorted = [...phrases].sort((a, b) => a.startTime - b.startTime);
  return sorted
    .map((phrase, i) => {
      const index = i + 1;
      const timing = `${secondsToSrtTime(phrase.startTime)} --> ${secondsToSrtTime(phrase.endTime)}`;
      return `${index}\n${timing}\n${phrase.text || ''}`;
    })
    .join('\n\n') + '\n';
}