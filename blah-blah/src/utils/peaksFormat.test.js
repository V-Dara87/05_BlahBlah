import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BYTES_PER_PEAK,
  DEFAULT_PEAKS_PER_SECOND,
  createFinestLevelBuilder,
  buildLevelsFromFinest,
  computeLevelCount,
  serializePeakFile,
  parsePeakFile,
  slicePeaks,
  pickLevel,
  levelPeaksPerSecond,
  encodeSignedByte,
  decodeSignedByte,
  encodeRmsByte,
  decodeRmsByte,
  emptyEnvelope,
} from './peaksFormat.js';

test('peaksFormat - byte encoding round trips within quantization error', () => {
  for (const v of [-1, -0.5, -0.001, 0, 0.25, 0.5, 0.999, 1]) {
    assert.ok(Math.abs(decodeSignedByte(encodeSignedByte(v)) - v) < 0.01, `signed ${v}`);
  }
  for (const v of [0, 0.1, 0.5, 0.9, 1]) {
    assert.ok(Math.abs(decodeRmsByte(encodeRmsByte(v)) - v) < 0.01, `rms ${v}`);
  }
  // Out-of-range input clamps instead of wrapping.
  assert.equal(encodeSignedByte(5), 127);
  assert.equal(encodeSignedByte(-5), -128);
  assert.equal(encodeRmsByte(5), 255);
  assert.equal(encodeRmsByte(-1), 0);
  assert.equal(decodeSignedByte(-128), -1);
});

test('peaksFormat - finest builder produces one peak per sample at 1:1 resolution', () => {
  const builder = createFinestLevelBuilder({ sampleRate: 1000, peaksPerSecond: 1000 });
  builder.pushSamples(new Float32Array([0.5, -0.25, 1.0, -1.0]));
  const { bytes, peakCount } = builder.finish();

  assert.equal(peakCount, 4);
  assert.equal(bytes.length, 4 * BYTES_PER_PEAK);

  const peak = (i) => ({
    min: decodeSignedByte(bytes[i * 3]),
    max: decodeSignedByte(bytes[i * 3 + 1]),
    rms: decodeRmsByte(bytes[i * 3 + 2]),
  });

  assert.deepEqual(peak(0), { min: 0, max: 64 / 127, rms: 128 / 255 });
  assert.ok(Math.abs(peak(1).min - -0.25) < 0.01);
  assert.equal(peak(2).max, 1);
  assert.equal(peak(3).min, -1);
});

test('peaksFormat - builder keeps peaks aligned across chunk boundaries', () => {
  // 8 samples per peak (8000/1000). Feeding in two chunks must not merge or
  // split peaks differently than feeding all at once.
  const all = new Float32Array(16).fill(0.5);
  const oneShot = createFinestLevelBuilder({ sampleRate: 8000, peaksPerSecond: 1000 });
  oneShot.pushSamples(all);
  const expected = oneShot.finish();

  const chunked = createFinestLevelBuilder({ sampleRate: 8000, peaksPerSecond: 1000 });
  chunked.pushSamples(all.subarray(0, 5));
  chunked.pushSamples(all.subarray(5, 9));
  chunked.pushSamples(all.subarray(9));
  const actual = chunked.finish();

  assert.equal(actual.peakCount, 2);
  assert.equal(expected.peakCount, 2);
  assert.deepEqual(Array.from(actual.bytes), Array.from(expected.bytes));
  assert.equal(actual.bytes[1], encodeSignedByte(0.5));
});

test('peaksFormat - coarser levels are built from the finest with energy-preserving rms', () => {
  const builder = createFinestLevelBuilder({ sampleRate: 1000, peaksPerSecond: 1000 });
  builder.pushSamples(new Float32Array([0.5, -0.5, 0.25, -0.25, 1, -1, 0.1, -0.1]));
  const finest = builder.finish();

  const levels = buildLevelsFromFinest(finest.bytes, {
    peakCount: finest.peakCount,
    peaksPerSecond: 1000,
    levelCount: 3,
  });
  assert.equal(levels.length, 3);
  assert.equal(levels[0], finest.bytes);

  // Level 1 groups pairs: [0.5,-0.5] -> max 0.5, min -0.5, rms 0.5
  assert.equal(levels[1].length, 4 * BYTES_PER_PEAK);
  assert.equal(decodeSignedByte(levels[1][1]), encodeSignedByte(0.5) / 127);
  assert.ok(Math.abs(decodeRmsByte(levels[1][2]) - 0.5) < 0.01);

  // Level 2 groups of 4: first group is 0.5,-0.5,0.25,-0.25 (min -0.5,
  // max 0.5); second group 1,-1,0.1,-0.1 (min -1, max 1).
  assert.equal(levels[2].length, 2 * BYTES_PER_PEAK);
  assert.ok(Math.abs(decodeSignedByte(levels[2][0]) - -0.5) < 0.01);
  assert.ok(Math.abs(decodeSignedByte(levels[2][1]) - 0.5) < 0.01);
  assert.equal(decodeSignedByte(levels[2][3]), -1);
  assert.equal(decodeSignedByte(levels[2][4]), 1);
});

test('peaksFormat - computeLevelCount shrinks resolution toward ~1 peak/sec', () => {
  assert.equal(computeLevelCount(0), 1);
  assert.ok(computeLevelCount(1000 * 3600) >= 10);
  const count = computeLevelCount(1000 * 3600);
  // The coarsest stored level is at (or just below) one peak per second —
  // storing it anyway costs a handful of bytes and keeps the zoomed-out
  // path on the coarsest level rather than the finest.
  assert.ok(levelPeaksPerSecond(DEFAULT_PEAKS_PER_SECOND, count - 1) >= 0.5);
});

test('peaksFormat - serialize/parse round trips a full file', () => {
  const builder = createFinestLevelBuilder({ sampleRate: 8000, peaksPerSecond: 1000 });
  const samples = new Float32Array(8000); // 1 second
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 20) * 0.75;
  builder.pushSamples(samples);
  const finest = builder.finish();
  const levels = buildLevelsFromFinest(finest.bytes, {
    peakCount: finest.peakCount,
    peaksPerSecond: finest.peaksPerSecond,
  });

  const file = serializePeakFile({
    sampleRate: finest.sampleRate,
    durationSec: 1,
    peaksPerSecond: finest.peaksPerSecond,
    levels,
  });
  assert.ok(file instanceof Uint8Array);

  const parsed = parsePeakFile(file);
  assert.ok(parsed);
  assert.equal(parsed.sampleRate, 8000);
  assert.equal(parsed.peaksPerSecond, 1000);
  assert.equal(parsed.duration, 1);
  assert.equal(parsed.levelCount, levels.length);
  assert.equal(parsed.peakCount, finest.peakCount);
  assert.equal(parsed.levels[0].length, finest.bytes.length);
  assert.deepEqual(Array.from(parsed.levels[0]), Array.from(finest.bytes));
});

test('peaksFormat - parse rejects garbage instead of throwing', () => {
  assert.equal(parsePeakFile(null), null);
  assert.equal(parsePeakFile(new Uint8Array(0)), null);
  assert.equal(parsePeakFile(new Uint8Array(40)), null); // zeroed, no magic

  const good = serializePeakFile({
    sampleRate: 8000,
    durationSec: 1,
    peaksPerSecond: 1000,
    levels: [new Uint8Array(300)],
  });
  // Truncate the data payload -> parse must refuse rather than return
  // half a level.
  assert.equal(parsePeakFile(good.subarray(0, good.length - 10)), null);
});

test('peaksFormat - slicePeaks returns numBuckets of the requested window', () => {
  const builder = createFinestLevelBuilder({ sampleRate: 1000, peaksPerSecond: 1000 });
  // 10 seconds: first half silent, second half loud, so the slice's shape
  // is unambiguous.
  const samples = new Float32Array(10000);
  for (let i = 5000; i < 10000; i++) samples[i] = 0.8;
  builder.pushSamples(samples);
  const finest = builder.finish();
  const levels = buildLevelsFromFinest(finest.bytes, { peakCount: finest.peakCount });
  const parsed = parsePeakFile(serializePeakFile({
    sampleRate: 1000,
    durationSec: 10,
    peaksPerSecond: 1000,
    levels,
  }));

  const buckets = 200;
  const full = slicePeaks(parsed, 0, 10, buckets);
  assert.equal(full.mins.length, buckets);
  assert.equal(full.maxs.length, buckets);
  assert.equal(full.rms.length, buckets);
  // First quarter is silent, last quarter is loud.
  assert.ok(Math.abs(full.maxs[10]) < 0.05);
  assert.ok(full.maxs[190] > 0.7);
  assert.ok(full.rms[190] > 0.7);

  const narrow = slicePeaks(parsed, 5, 6, 100);
  assert.equal(narrow.maxs.length, 100);
  assert.ok(narrow.maxs.every((v) => v > 0.7));

  const silent = slicePeaks(parsed, 0, 1, 50);
  assert.ok(silent.maxs.every((v) => Math.abs(v) < 0.05));

  // A degenerate window returns a zeroed envelope, not a throw.
  const degenerate = slicePeaks(parsed, 5, 5, 10);
  assert.deepEqual(Array.from(degenerate.maxs), Array.from(emptyEnvelope(10).maxs));
  assert.deepEqual(Array.from(slicePeaks(null, 0, 1, 10).maxs), Array.from(emptyEnvelope(10).maxs));
});

test('peaksFormat - slicePeaks picks the coarsest level that still fits the zoom', () => {
  const parsed = parsePeakFile(serializePeakFile({
    sampleRate: 8000,
    durationSec: 100,
    peaksPerSecond: 1000,
    levels: [
      new Uint8Array(100000 * BYTES_PER_PEAK),
      new Uint8Array(50000 * BYTES_PER_PEAK),
      new Uint8Array(25000 * BYTES_PER_PEAK),
      new Uint8Array(12500 * BYTES_PER_PEAK),
    ],
  }));

  // Zoomed out: 200 buckets over 100s only needs 2 peaks/sec -> coarsest.
  assert.equal(pickLevel(parsed, 200 / 100), 3);
  // Maximum zoom: 400 buckets over 0.2s needs 2000 peaks/sec -> finest.
  assert.equal(pickLevel(parsed, 400 / 0.2), 0);
  // In between picks an intermediate level rather than the finest.
  assert.equal(pickLevel(parsed, 300), 1);
});
