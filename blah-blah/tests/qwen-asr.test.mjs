import test from 'node:test';
import assert from 'node:assert/strict';

// packageManager reads localStorage; the Node test runner has none.
const storage = {};
globalThis.localStorage = {
  getItem: (key) => storage[key] ?? null,
  setItem: (key, value) => {
    storage[key] = String(value);
  },
  removeItem: (key) => {
    delete storage[key];
  },
  clear: () => {
    for (const key of Object.keys(storage)) delete storage[key];
  },
};

import {
  DEFAULT_MAX_CHUNK_SECONDS,
  buildSilenceDetectArgs,
  parseSilenceDetectOutput,
  planSpeechChunks,
} from '../src/engine/asrChunking.js';
import {
  cleanTranscript,
  collapseRepeatedText,
  normalizeTranscript,
  normalizeWordTimings,
} from '../src/engine/asrText.js';
import {
  ASR_ENGINE_QWEN3,
  ASR_ENGINE_WHISPER,
  QWEN3_ALIGNER_PACKAGE_ID,
  QWEN3_ASR_SUPPORTED_LANGUAGES,
  getEngineLabel,
  getModelEngine,
  isLanguageSupportedByEngine,
  listAsrModelsForLanguage,
  modelCategoriesForLanguage,
} from '../src/engine/asrEngines.js';
import { parseQwenAsrRecord } from '../src/services/qwenAsrRunner.js';
import { parseSrt, toSrt } from '../src/engine/srt.js';
import { createPhrase } from '../src/engine/subtitleTrack.js';
import { getPackageById } from '../src/services/packageManager.js';

/* ── Silence detection parsing ───────────────────────────────────────────── */

const SILENCEDETECT_LOG = [
  '[silencedetect @ 000001] silence_start: 2.048',
  '[silencedetect @ 000001] silence_end: 3.456 | silence_duration: 1.408',
  '[silencedetect @ 000001] silence_start: 12.8',
  '[silencedetect @ 000001] silence_end: 14.1 | silence_duration: 1.3',
].join('\n');

test('parseSilenceDetectOutput - reads ffmpeg silence_start/silence_end lines', () => {
  const silences = parseSilenceDetectOutput(SILENCEDETECT_LOG);
  assert.equal(silences.length, 2);
  assert.deepEqual(silences[0], { start: 2.048, end: 3.456 });
  assert.deepEqual(silences[1], { start: 12.8, end: 14.1 });
});

test('parseSilenceDetectOutput - tolerates noise, missing end, and reversed input', () => {
  assert.deepEqual(parseSilenceDetectOutput(''), []);
  assert.deepEqual(parseSilenceDetectOutput('no silence here'), []);

  // A clip that ends while still quiet has no silence_end.
  const openEnded = parseSilenceDetectOutput('[silencedetect] silence_start: 7.5');
  assert.deepEqual(openEnded, [{ start: 7.5, end: null }]);

  // An end without a start means silence from 0.
  assert.deepEqual(parseSilenceDetectOutput('silence_end: 1.25'), [{ start: 0, end: 1.25 }]);

  // Windows line endings and extra fields are fine.
  const crlf = 'silence_start: 1.0\r\nsilence_end: 2.0 | silence_duration: 1.0\r\n';
  assert.deepEqual(parseSilenceDetectOutput(crlf), [{ start: 1, end: 2 }]);
});

test('buildSilenceDetectArgs - uses silencedetect with the configured threshold', () => {
  const args = buildSilenceDetectArgs('C:/tmp/audio.wav');
  assert.equal(args[0], '-hide_banner');
  assert.ok(args.includes('-af'));
  assert.equal(args[args.indexOf('-af') + 1], 'silencedetect=noise=-35dB:d=0.4');
  assert.equal(args[args.length - 1], '-');
  assert.equal(args[args.indexOf('-i') + 1], 'C:/tmp/audio.wav');

  const custom = buildSilenceDetectArgs('x.wav', { noiseDb: -50, minSilenceSeconds: 0.8 });
  assert.ok(custom.includes('silencedetect=noise=-50dB:d=0.8'));
});

/* ── Chunk planning ─────────────────────────────────────────────────────── */

test('planSpeechChunks - one silence-free recording is split at the max length', () => {
  const chunks = planSpeechChunks({ duration: 60, silences: [] });
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks[0], { start: 0, end: 20 });
  assert.deepEqual(chunks[1], { start: 20, end: 40 });
  assert.deepEqual(chunks[2], { start: 40, end: 60 });
  for (const chunk of chunks) {
    assert.ok(chunk.end - chunk.start <= DEFAULT_MAX_CHUNK_SECONDS + 1e-9);
  }
});

test('planSpeechChunks - short recordings stay a single chunk', () => {
  assert.deepEqual(planSpeechChunks({ duration: 8.5, silences: [] }), [{ start: 0, end: 8.5 }]);
  assert.deepEqual(planSpeechChunks({ duration: 0 }), []);
  assert.deepEqual(planSpeechChunks({ duration: Number.NaN }), []);
  assert.deepEqual(planSpeechChunks({}), []);
});

test('planSpeechChunks - splits at silences instead of mid-speech', () => {
  const chunks = planSpeechChunks({
    duration: 60,
    silences: [
      { start: 5, end: 6 },
      { start: 30, end: 40 },
    ],
  });
  assert.deepEqual(chunks, [
    { start: 0, end: 5 },
    { start: 6, end: 30 },
    { start: 40, end: 60 },
  ]);
});

test('planSpeechChunks - drops speech blips shorter than the minimum', () => {
  const chunks = planSpeechChunks({
    duration: 10,
    silences: [
      { start: 0, end: 2 },
      { start: 2.2, end: 10 },
    ],
  });
  assert.deepEqual(chunks, []);
});

test('planSpeechChunks - an open-ended silence runs to the end of the audio', () => {
  assert.deepEqual(planSpeechChunks({ duration: 10, silences: [{ start: 5, end: null }] }), [
    { start: 0, end: 5 },
  ]);
});

test('planSpeechChunks - clamps, merges overlapping silences, never overlaps chunks', () => {
  const chunks = planSpeechChunks({
    duration: 100,
    silences: [
      { start: 10, end: 12 },
      { start: 11, end: 20 },
      { start: -5, end: 2 },
      { start: 95, end: 500 },
    ],
  });

  assert.deepEqual(chunks[0], { start: 2, end: 10 });
  for (let index = 1; index < chunks.length; index += 1) {
    assert.ok(chunks[index].start >= chunks[index - 1].end, 'chunks must not overlap');
    assert.ok(chunks[index].end <= 100, 'chunks must stay inside the audio');
    assert.ok(chunks[index].end - chunks[index].start <= DEFAULT_MAX_CHUNK_SECONDS + 1e-9);
  }
  assert.equal(chunks[chunks.length - 1].end, 95);
});

test('planSpeechChunks - a custom maxChunkSeconds is honoured', () => {
  // A span with no silence is split into EQUAL pieces (3 x 4s), not one full
  // 5s chunk plus a 2s remainder, so every chunk stays under the limit.
  const chunks = planSpeechChunks({ duration: 12, silences: [], maxChunkSeconds: 5 });
  assert.deepEqual(chunks, [
    { start: 0, end: 4 },
    { start: 4, end: 8 },
    { start: 8, end: 12 },
  ]);
  for (const chunk of chunks) assert.ok(chunk.end - chunk.start <= 5);
});

/* ── Transcript cleanup ─────────────────────────────────────────────────── */

test('normalizeTranscript - collapses whitespace and strips model scaffolding', () => {
  assert.equal(normalizeTranscript('  hello\n\n   world  '), 'hello world');
  assert.equal(normalizeTranscript('<asr_text>សួស្តី'), 'សួស្តី');
  assert.equal(normalizeTranscript('language Khmer<asr_text>សួស្តី'), 'សួស្តី');
  assert.equal(normalizeTranscript(null), '');
  assert.equal(normalizeTranscript(undefined), '');
});

test('collapseRepeatedText - collapses runaway repeated words and phrases', () => {
  assert.equal(collapseRepeatedText('hello hello hello hello world'), 'hello world');
  assert.equal(collapseRepeatedText('a b a b a b a b'), 'a b');
  assert.equal(collapseRepeatedText('សួស្តី សួស្តី សួស្តី អរគុណ'), 'សួស្តី អរគុណ');
  // Legitimate doubling is preserved.
  assert.equal(collapseRepeatedText('very very good'), 'very very good');
  assert.equal(collapseRepeatedText('និយាយ និយាយ បន្តិច'), 'និយាយ និយាយ បន្តិច');
  assert.equal(collapseRepeatedText(''), '');
  assert.equal(collapseRepeatedText(null), '');
});

test('collapseRepeatedText - does not touch a normal sentence', () => {
  const sentence = 'ថ្ងៃនេះ ខ្ញុំ បាន ទៅ ផ្សារ ហើយ ទិញ ផ្លែឈើ';
  assert.equal(collapseRepeatedText(sentence), sentence);
});

test('cleanTranscript - normalize + collapse in one step', () => {
  assert.equal(cleanTranscript('  <asr_text>អរគុណ អរគុណ អរគុណ  '), 'អរគុណ');
});

/* ── SRT / phrase building from chunk results ───────────────────────────── */

test('whisper SRT segments still become phrases with the same timing', () => {
  const srt = toSrt([
    { startTime: 0, endTime: 2.5, text: 'សួស្តី សួស្តី សួស្តី' },
    { startTime: 3, endTime: 6, text: '<asr_text>អរគុណ' },
  ]);

  const phrases = parseSrt(srt).map((segment) =>
    createPhrase({ ...segment, text: cleanTranscript(segment.text), mode: 'set' })
  );
  assert.equal(phrases.length, 2);
  assert.equal(phrases[0].text, 'សួស្តី');
  assert.equal(phrases[0].startTime, 0);
  assert.equal(phrases[0].endTime, 2.5);
  assert.equal(phrases[1].text, 'អរគុណ');
  assert.equal(phrases[1].startTime, 3);
  assert.equal(phrases[1].endTime, 6);
  assert.equal(phrases[0].mode, 'set');
  assert.equal('words' in phrases[0], false);
});

test('Qwen chunk results become phrases, carrying word timings when aligned', () => {
  const result = {
    index: 0,
    start: 4,
    end: 12,
    text: 'សួស្តី អរគុណ',
    // The helper already offsets these into clip time.
    words: [
      { text: 'សួស្តី', start: 4.2, end: 5.1 },
      { text: 'អរគុណ', start: 5.2, end: 6 },
    ],
  };

  const words = normalizeWordTimings(result.words, { startTime: result.start, endTime: result.end });
  const phrase = createPhrase({
    startTime: result.start,
    endTime: result.end,
    text: cleanTranscript(result.text),
    words,
    mode: 'set',
  });

  assert.equal(phrase.startTime, 4);
  assert.equal(phrase.endTime, 12);
  assert.equal(phrase.text, 'សួស្តី អរគុណ');
  assert.deepEqual(phrase.words, [
    { word: 'សួស្តី', start: 4.2, end: 5.1 },
    { word: 'អរគុណ', start: 5.2, end: 6 },
  ]);
});

/* ── Word timings ───────────────────────────────────────────────────────── */

test('normalizeWordTimings - clamps to the phrase, sorts, and drops junk', () => {
  const words = normalizeWordTimings(
    [
      { text: '  ខ  ', start: 5.2, end: 5.9 },
      { text: '', start: 5.9, end: 6.2 },
      { text: 'ក', start: 3.5, end: 4.4 }, // starts before the chunk
      { text: 'គ', start: 11.6, end: 12.9 }, // ends after the chunk
      { text: 'ឃ', start: 20, end: 21 }, // entirely outside the chunk
      { text: 'ង', start: 'x', end: 2 }, // not numeric
      { text: 'ច', start: 7, end: 7 }, // zero length
      { word: 'ឆ', start: 6.5, end: 7.2 }, // already in phrase.words shape
    ],
    { startTime: 4, endTime: 12 }
  );

  assert.deepEqual(words, [
    { word: 'ក', start: 4, end: 4.4 },
    { word: 'ខ', start: 5.2, end: 5.9 },
    { word: 'ឆ', start: 6.5, end: 7.2 },
    { word: 'គ', start: 11.6, end: 12 },
  ]);
});

test('normalizeWordTimings - empty or missing input yields no words', () => {
  assert.deepEqual(normalizeWordTimings(null), []);
  assert.deepEqual(normalizeWordTimings(undefined, { startTime: 0, endTime: 3 }), []);
  assert.deepEqual(normalizeWordTimings([], { startTime: 0, endTime: 3 }), []);

  const phrase = createPhrase({
    startTime: 0,
    endTime: 3,
    text: 'អរគុណ',
    words: normalizeWordTimings([], { startTime: 0, endTime: 3 }),
    mode: 'set',
  });
  assert.equal('words' in phrase, false);
});

test('empty chunk transcripts never become phrases', () => {
  const chunkResults = [
    { index: 0, start: 0, end: 2, text: '   ' },
    { index: 1, start: 2, end: 4, text: 'អរគុណ' },
  ];
  const phrases = chunkResults
    .map((result) => ({ startTime: result.start, endTime: result.end, text: cleanTranscript(result.text) }))
    .filter((phrase) => phrase.text && phrase.endTime > phrase.startTime);
  assert.equal(phrases.length, 1);
  assert.equal(parseSrt(toSrt(phrases))[0].text, 'អរគុណ');
});

/* ── Progress record parsing ────────────────────────────────────────────── */

test('parseQwenAsrRecord - parses helper stdout lines and ignores chatter', () => {
  assert.deepEqual(parseQwenAsrRecord('QASR_PROGRESS {"index":2,"total":12}'), {
    kind: 'PROGRESS',
    data: { index: 2, total: 12 },
  });
  assert.deepEqual(parseQwenAsrRecord('QASR_DONE'), { kind: 'DONE', data: null });
  assert.deepEqual(parseQwenAsrRecord('QASR_CHECK {"ready":true,"cuda":false}'), {
    kind: 'CHECK',
    data: { ready: true, cuda: false },
  });
  assert.equal(parseQwenAsrRecord('CUDA out of memory'), null);
  assert.equal(parseQwenAsrRecord(''), null);
  assert.equal(parseQwenAsrRecord('QASR_RESULT not-json').kind, 'RESULT');

  const aligned = parseQwenAsrRecord(
    'QASR_RESULT {"index":0,"start":4,"end":12,"text":"x","words":[{"text":"x","start":4.2,"end":4.8}]}'
  );
  assert.deepEqual(aligned.data.words, [{ text: 'x', start: 4.2, end: 4.8 }]);
});

/* ── Engine selection ───────────────────────────────────────────────────── */

test('getModelEngine - unknown or missing engine is whisper-cpp', () => {
  assert.equal(getModelEngine(null), ASR_ENGINE_WHISPER);
  assert.equal(getModelEngine({}), ASR_ENGINE_WHISPER);
  assert.equal(getModelEngine({ engine: 'whisper-cpp' }), ASR_ENGINE_WHISPER);
  assert.equal(getModelEngine({ engine: 'qwen3-asr' }), ASR_ENGINE_QWEN3);
  assert.equal(getModelEngine({ engine: 'something-new' }), ASR_ENGINE_WHISPER);
  assert.equal(getEngineLabel(ASR_ENGINE_WHISPER), 'Whisper');
  assert.equal(getEngineLabel(ASR_ENGINE_QWEN3), 'Qwen3-ASR');
});

test('isLanguageSupportedByEngine - Qwen3-ASR is Khmer only, Whisper is not limited', () => {
  assert.deepEqual(QWEN3_ASR_SUPPORTED_LANGUAGES, ['km']);
  assert.equal(isLanguageSupportedByEngine(ASR_ENGINE_QWEN3, 'km'), true);
  assert.equal(isLanguageSupportedByEngine(ASR_ENGINE_QWEN3, 'en'), false);
  assert.equal(isLanguageSupportedByEngine(ASR_ENGINE_QWEN3, 'auto'), false);
  assert.equal(isLanguageSupportedByEngine(ASR_ENGINE_WHISPER, 'km'), true);
  assert.equal(isLanguageSupportedByEngine(ASR_ENGINE_WHISPER, 'ja'), true);
  assert.equal(isLanguageSupportedByEngine(ASR_ENGINE_WHISPER, 'auto'), true);
});

test('modelCategoriesForLanguage - Khmer lists Qwen3-ASR before Whisper', () => {
  assert.deepEqual(modelCategoriesForLanguage('km'), ['asr-model-khmer', 'whisper-model-khmer']);
  assert.deepEqual(modelCategoriesForLanguage('ja'), ['whisper-model-official']);
  assert.deepEqual(modelCategoriesForLanguage('unknown-code'), ['whisper-model-official']);
});

test('listAsrModelsForLanguage - Khmer offers Qwen3-ASR as the recommended default', async () => {
  const models = await listAsrModelsForLanguage('km');
  assert.deepEqual(models.map((model) => model.id), ['qwen3-asr-khmer', 'whisper-khmer-small']);

  const [qwen, whisper] = models;
  assert.equal(getModelEngine(qwen), ASR_ENGINE_QWEN3);
  assert.equal(qwen.recommended, true);
  assert.equal(qwen.attribution, 'seanghay/Qwen3-ASR-0.6B-Khmer (Apache-2.0)');
  assert.ok(qwen.tags.includes('km'));
  assert.equal(getModelEngine(whisper), ASR_ENGINE_WHISPER);
  assert.equal(whisper.category, 'whisper-model-khmer');

  const english = await listAsrModelsForLanguage('en');
  assert.ok(english.every((model) => getModelEngine(model) === ASR_ENGINE_WHISPER));
});

test('the forced aligner is a separate optional package, not a transcription model', async () => {
  const aligner = await getPackageById(QWEN3_ALIGNER_PACKAGE_ID);
  assert.ok(aligner);
  assert.equal(aligner.category, 'asr-aligner');
  assert.equal(aligner.engineModel, 'Qwen/Qwen3-ForcedAligner-0.6B');
  assert.equal(aligner.installPath, 'models/qwen3-asr/aligner');
  assert.equal(getModelEngine(aligner), ASR_ENGINE_QWEN3);
  assert.equal(aligner.recommended, false);

  // Installing it must never add a second entry to the Khmer model picker.
  const models = await listAsrModelsForLanguage('km');
  assert.ok(!models.some((model) => model.id === QWEN3_ALIGNER_PACKAGE_ID));
});
