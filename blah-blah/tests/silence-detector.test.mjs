import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFfmpegSilenceOutput,
  computeAudibleAndSilentSegments,
  formatTime,
  detectSilenceWithWebAudio,
} from '../src/services/silenceDetector.js';

test('silenceDetector - parseFfmpegSilenceOutput', async (t) => {
  await t.test('parses standard silence_start and silence_end with duration', () => {
    const log = `
[silencedetect @ 0000021e7d825c00] silence_start: 3.456
[silencedetect @ 0000021e7d825c00] silence_end: 7.89 | silence_duration: 4.434
[silencedetect @ 0000021e7d825c00] silence_start: 12.1
[silencedetect @ 0000021e7d825c00] silence_end: 14.5 | silence_duration: 2.4
`;
    const intervals = parseFfmpegSilenceOutput(log, 20.0);
    assert.equal(intervals.length, 2);
    assert.equal(intervals[0].start, 3.456);
    assert.equal(intervals[0].end, 7.89);
    assert.equal(intervals[0].duration, 4.434);
    assert.equal(intervals[1].start, 12.1);
    assert.equal(intervals[1].end, 14.5);
    assert.equal(intervals[1].duration, 2.4);
  });

  await t.test('handles silence starting at the very beginning (0s) before first log', () => {
    const log = `
[silencedetect @ 0x...] silence_end: 2.5 | silence_duration: 2.5
[silencedetect @ 0x...] silence_start: 8.0
[silencedetect @ 0x...] silence_end: 10.0 | silence_duration: 2.0
`;
    const intervals = parseFfmpegSilenceOutput(log, 15.0);
    assert.equal(intervals.length, 2);
    assert.equal(intervals[0].start, 0);
    assert.equal(intervals[0].end, 2.5);
    assert.equal(intervals[0].duration, 2.5);
  });

  await t.test('handles unclosed silence at the end of the file', () => {
    const log = `
[silencedetect @ 0x...] silence_start: 12.5
`;
    const intervals = parseFfmpegSilenceOutput(log, 18.0);
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].start, 12.5);
    assert.equal(intervals[0].end, 18.0);
    assert.equal(intervals[0].duration, 5.5);
  });

  await t.test('handles empty or invalid logs cleanly', () => {
    assert.deepEqual(parseFfmpegSilenceOutput('', 10), []);
    assert.deepEqual(parseFfmpegSilenceOutput(null, 10), []);
  });
});

test('silenceDetector - computeAudibleAndSilentSegments', async (t) => {
  await t.test('applies padding (offset) buffer and inverts silence into kept audible speech', () => {
    // Total clip duration = 10s
    // Raw silence between 3.0s and 6.0s (3.0s duration)
    // Padding = 0.2s -> Silence cut is narrowed to [3.2s, 5.8s]
    // Kept speech = [0, 3.2] (dur 3.2) and [5.8, 10] (dur 4.2) -> total kept = 7.4s
    const raw = [{ start: 3.0, end: 6.0 }];
    const result = computeAudibleAndSilentSegments(raw, 10.0, {
      padding: 0.2,
      minSpeechDuration: 0.1,
    });

    assert.equal(result.cutSegments.length, 1);
    assert.equal(result.cutSegments[0].start, 3.2);
    assert.equal(result.cutSegments[0].end, 5.8);
    assert.equal(result.cutSegments[0].duration, 2.6);

    assert.equal(result.keptSegments.length, 2);
    assert.equal(result.keptSegments[0].start, 0);
    assert.equal(result.keptSegments[0].end, 3.2);
    assert.equal(result.keptSegments[0].duration, 3.2);

    assert.equal(result.keptSegments[1].start, 5.8);
    assert.equal(result.keptSegments[1].end, 10);
    assert.equal(result.keptSegments[1].duration, 4.2);

    assert.equal(result.newDuration, 7.4);
    assert.equal(result.savedDuration, 2.6);
    assert.equal(result.savedPercent, 26);
  });

  await t.test('does not pad silence start into negative if at beginning of clip', () => {
    const raw = [{ start: 0, end: 3.0 }];
    const result = computeAudibleAndSilentSegments(raw, 10.0, {
      padding: 0.2,
      minSpeechDuration: 0.1,
    });

    // Start of clip (0) shouldn't be pushed past 0
    assert.equal(result.cutSegments[0].start, 0);
    assert.equal(result.cutSegments[0].end, 2.8);
    assert.equal(result.keptSegments.length, 1);
    assert.equal(result.keptSegments[0].start, 2.8);
    assert.equal(result.keptSegments[0].end, 10.0);
  });

  await t.test('ignores micro-speech blips shorter than minSpeechDuration', () => {
    // 0 to 1 silence, 1 to 1.05 blip (0.05s < 0.15s), 1.05 to 4 silence
    const raw = [
      { start: 0, end: 1.0 },
      { start: 1.05, end: 4.0 },
    ];
    const result = computeAudibleAndSilentSegments(raw, 10.0, {
      padding: 0,
      minSpeechDuration: 0.15,
    });

    // Kept speech only includes [4, 10]
    assert.equal(result.keptSegments.length, 1);
    assert.equal(result.keptSegments[0].start, 4.0);
    assert.equal(result.keptSegments[0].end, 10.0);
  });
});

test('silenceDetector - detectSilenceWithWebAudio simulated PCM', async (t) => {
  await t.test('detects quiet PCM region below threshold', () => {
    const sampleRate = 4000; // Small sample rate for fast unit test
    const duration = 2.0;
    const length = sampleRate * duration;
    const pcm = new Float32Array(length);

    // First 0.5s: loud audio (sine wave, amplitude 0.8 -> ~ -2 dB)
    for (let i = 0; i < sampleRate * 0.5; i++) {
      pcm[i] = 0.8 * Math.sin((i / sampleRate) * 440 * 2 * Math.PI);
    }
    // Next 1.0s (0.5 to 1.5s): near zero amplitude (silence, amplitude 0.0001 -> -80 dB)
    for (let i = sampleRate * 0.5; i < sampleRate * 1.5; i++) {
      pcm[i] = 0.0001;
    }
    // Last 0.5s (1.5 to 2.0s): loud audio
    for (let i = sampleRate * 1.5; i < sampleRate * 2.0; i++) {
      pcm[i] = 0.8 * Math.sin((i / sampleRate) * 440 * 2 * Math.PI);
    }

    const mockBuffer = {
      sampleRate,
      duration,
      length,
      numberOfChannels: 1,
      getChannelData: () => pcm,
    };

    const silences = detectSilenceWithWebAudio(mockBuffer, {
      thresholdDb: -30,
      minSilenceDuration: 0.4,
      mediaOffset: 0,
      duration: 2.0,
    });

    assert.equal(silences.length, 1);
    assert.ok(Math.abs(silences[0].start - 0.5) < 0.05, `Expected start near 0.5, got ${silences[0].start}`);
    assert.ok(Math.abs(silences[0].end - 1.5) < 0.05, `Expected end near 1.5, got ${silences[0].end}`);
  });
});

test('silenceDetector - formatTime helper', () => {
  assert.equal(formatTime(0), '00:00.00');
  assert.equal(formatTime(65.234), '01:05.23');
});

test('silenceDetector - timeline tandem slice & ripple math', () => {
  // A video parent and audio child clip of 10 seconds starting at t=5
  const video = {
    id: 'vid-1',
    name: 'Interview',
    trackId: 'track-1',
    startTime: 5.0,
    duration: 10.0,
    parentId: null,
    components: [{ type: 'VideoRenderer', mediaOffset: 1.0, speed: 1 }],
  };
  const audio = {
    id: 'aud-1',
    name: 'Interview (Audio)',
    trackId: 'track-2',
    startTime: 5.0,
    duration: 10.0,
    parentId: 'vid-1',
    components: [{ type: 'AudioSource', mediaOffset: 1.0, speed: 1 }],
  };
  const downstream = {
    id: 'next-1',
    name: 'Outro',
    trackId: 'track-1',
    startTime: 16.0,
    duration: 4.0,
    parentId: null,
    components: [],
  };

  // Kept segments (0 to 3s, and 7 to 10s -> 4s silence cut between 3s and 7s)
  const kept = [
    { start: 0, end: 3, duration: 3 },
    { start: 7, end: 10, duration: 3 },
  ];

  // Emulate tandem slice logic
  const primaryEntity = video;
  const childEntities = [audio];
  const allGroup = [primaryEntity, ...childEntities];
  const origStart = primaryEntity.startTime;
  const toAdd = [];
  const updatedMap = new Map();
  let accum = 0;

  for (let i = 0; i < kept.length; i++) {
    const seg = kept[i];
    const segStart = origStart + accum; // ripple mode
    accum += seg.duration;
    const isFirst = i === 0;
    const pId = isFirst ? primaryEntity.id : `vid-part-${i + 1}`;

    const pSlice = {
      ...primaryEntity,
      id: pId,
      startTime: segStart,
      duration: seg.duration,
      components: primaryEntity.components.map((c) => ({
        ...c,
        mediaOffset: (c.mediaOffset || 0) + seg.start,
      })),
    };
    if (isFirst) updatedMap.set(primaryEntity.id, pSlice);
    else toAdd.push(pSlice);

    for (const ch of childEntities) {
      const chId = isFirst ? ch.id : `aud-part-${i + 1}`;
      const chSlice = {
        ...ch,
        id: chId,
        parentId: pId,
        startTime: segStart,
        duration: seg.duration,
        components: ch.components.map((c) => ({
          ...c,
          mediaOffset: (c.mediaOffset || 0) + seg.start,
        })),
      };
      if (isFirst) updatedMap.set(ch.id, chSlice);
      else toAdd.push(chSlice);
    }
  }

  // Check part 1 (first 3s)
  const v1 = updatedMap.get('vid-1');
  const a1 = updatedMap.get('aud-1');
  assert.equal(v1.startTime, 5.0);
  assert.equal(v1.duration, 3.0);
  assert.equal(v1.components[0].mediaOffset, 1.0);
  assert.equal(a1.parentId, 'vid-1');
  assert.equal(a1.startTime, 5.0);
  assert.equal(a1.duration, 3.0);
  assert.equal(a1.components[0].mediaOffset, 1.0);

  // Check part 2 (rippled right after part 1, so starts at 5 + 3 = 8s)
  const v2 = toAdd.find((e) => e.id === 'vid-part-2');
  const a2 = toAdd.find((e) => e.id === 'aud-part-2');
  assert.equal(v2.startTime, 8.0);
  assert.equal(v2.duration, 3.0);
  assert.equal(v2.components[0].mediaOffset, 1.0 + 7.0); // 8.0 mediaOffset
  assert.equal(a2.parentId, 'vid-part-2'); // correctly reparented!
  assert.equal(a2.startTime, 8.0);
  assert.equal(a2.duration, 3.0);
  assert.equal(a2.components[0].mediaOffset, 8.0);

  // Downstream clip (was at 16.0, totalCut is 4s, so shifts to 12.0)
  const totalCut = 10.0 - 6.0; // 4.0s cut
  const newDownstreamStart = downstream.startTime - totalCut;
  assert.equal(newDownstreamStart, 12.0);
});

