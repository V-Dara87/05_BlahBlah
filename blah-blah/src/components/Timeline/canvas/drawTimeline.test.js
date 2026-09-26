import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTimelineScene } from '../../../utils/timelineScene.js';
import { TRACK_HEIGHT } from '../../../utils/timelineLayout.js';
import { drawTimelineScene, readTimelineTheme, waveformRectFor, wantsWaveform } from './drawTimeline.js';
import {
  bucketsForCard,
  drawWaveformEnvelope,
  drawWaveformPlaceholder,
  MIN_WAVEFORM_BUCKETS,
  MAX_WAVEFORM_BUCKETS,
} from './drawWaveform.js';

/** Minimal 2D context double that records op counts and stroke/fill colours. */
function mockContext() {
  const calls = { fillRect: 0, fillText: 0, strokeRect: 0, fill: 0, stroke: 0, clip: 0, moveTo: 0, lineTo: 0 };
  // Colours seen at each stroke()/fill(), so tests can assert what was drawn
  // (e.g. that the selected card is highlighted) without a real canvas.
  const strokedWith = [];
  const filledWith = [];
  const noop = (name) => (...args) => {
    void args;
    if (name in calls) calls[name] += 1;
  };
  const dashed = [];
  // Every filled rectangle with the style in force, so tests can assert the
  // LAYOUT of the things that are drawn as plain rects (grid lines, lane
  // backgrounds) rather than only that something was drawn.
  const filledRects = [];
  const ctx = {
    calls,
    strokedWith,
    filledWith,
    dashed,
    filledRects,
    save: noop('save'),
    restore: noop('restore'),
    beginPath: noop('beginPath'),
    closePath: noop('closePath'),
    rect: noop('rect'),
    clip: noop('clip'),
    translate: noop('translate'),
    setTransform: noop('setTransform'),
    clearRect: noop('clearRect'),
    fillRect: (x, y, w, h) => {
      calls.fillRect += 1;
      filledRects.push({ style: ctx.fillStyle, x, y, w, h });
    },
    strokeRect: noop('strokeRect'),
    moveTo: noop('moveTo'),
    lineTo: noop('lineTo'),
    quadraticCurveTo: noop('quadraticCurveTo'),
    // Only the transition label pill measures text; a fixed 6px/char is plenty
    // for the mock, it just needs to be a function.
    measureText: (text) => ({ width: String(text).length * 6 }),
    setLineDash: (pattern) => {
      if (pattern.length > 0) dashed.push(pattern.join(','));
    },
    fill: () => {
      calls.fill += 1;
      filledWith.push(ctx.fillStyle);
    },
    stroke: () => {
      calls.stroke += 1;
      strokedWith.push(ctx.strokeStyle);
    },
    fillText: noop('fillText'),
    arc: noop('arc'),
  };
  return ctx;
}

const TRACKS = [{ id: 't1', name: 'Track 1', visible: true, locked: false }];
const clip = (id, startTime, duration, extra = {}) => ({
  id,
  trackId: 't1',
  name: id,
  startTime,
  duration,
  components: [{ type: 'AudioSource', src: 'asset://a.wav', mediaOffset: 0 }],
  ...extra,
});

function envelopeOf(n) {
  const mins = new Float32Array(n);
  const maxs = new Float32Array(n);
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mins[i] = -Math.sin(i / 3) * 0.8;
    maxs[i] = Math.sin(i / 3) * 0.8;
    rms[i] = Math.abs(Math.sin(i / 3)) * 0.5;
  }
  return { mins, maxs, rms };
}

test('readTimelineTheme falls back cleanly without a DOM', () => {
  const theme = readTimelineTheme(null);
  assert.ok(theme.text);
  assert.ok(theme.cards.video.background.startsWith('#'));
  assert.equal(theme.cards.audio.accent, '#8b5cf6');
});

test('the lane background is composited over the live themed backdrop', () => {
  const original = globalThis.getComputedStyle;
  try {
    // Only --unity-darkest is themed; every other variable falls back.
    globalThis.getComputedStyle = () => ({
      getPropertyValue: (name) => (name === '--unity-darkest' ? '#2a1a3a' : ''),
    });
    // `.track-lane-row` is rgba(28, 28, 32, 0.4), so #2a1a3a (42, 26, 58)
    // composited with it is (36, 27, 48).
    assert.equal(readTimelineTheme({}).laneBackground, 'rgb(36, 27, 48)');

    // The shipped backdrop still reproduces the CSS literal, #1a1a1c.
    globalThis.getComputedStyle = () => ({
      getPropertyValue: (name) => (name === '--unity-darkest' ? '#191919' : ''),
    });
    assert.equal(readTimelineTheme({}).laneBackground, 'rgb(26, 26, 28)');

    // A backdrop the canvas cannot decompose keeps the literal fallback.
    globalThis.getComputedStyle = () => ({
      getPropertyValue: (name) => (name === '--unity-darkest' ? 'hsl(220, 10%, 10%)' : ''),
    });
    assert.equal(readTimelineTheme({}).laneBackground, '#1a1a1c');
  } finally {
    globalThis.getComputedStyle = original;
  }
});

test('drawTimelineScene renders visible clips and never throws', () => {
  const clips = [clip('a', 0, 4), clip('b', 10, 4), clip('far', 4000, 4)];
  const scene = buildTimelineScene({
    tracks: TRACKS,
    clips,
    pixelsPerSecond: 40,
    // The library resolves the clips' source, so no missing-media badge is
    // drawn and the label count is exactly the visible-card count.
    mediaAssets: [{ id: 'm', url: 'asset://a.wav' }],
  });
  const ctx = mockContext();

  const result = drawTimelineScene(ctx, {
    scene,
    theme: readTimelineTheme(null),
    view: { scrollLeft: 0, scrollTop: 0, width: 800, height: 200 },
    state: { selectedIds: ['a'], peaksFor: () => envelopeOf(64) },
  });

  // `far` is off-screen (x = 160000px): only the two visible clips are drawn.
  assert.equal(result.drawnClips, 2);
  assert.ok(ctx.calls.fillRect > 0, 'lane backgrounds and cards were filled');
  // Three texts per card — the category glyph, the title beside it and the
  // duration bottom-right — matching ClipItem's `.clip-top-row` (type icon +
  // `.clip-title-text`) and `.clip-time-text`, NOT one "name (12.0s)" line
  // (that concatenation is the card's tooltip, never its label).
  assert.equal(ctx.calls.fillText, 6, 'glyph + title + duration per visible card');

  // Without the library entry the same clip is flagged: the warning glyph is
  // drawn instead of a handle, exactly like ClipItem's missing-media state.
  const orphanScene = buildTimelineScene({ tracks: TRACKS, clips, pixelsPerSecond: 40, mediaAssets: [] });
  assert.equal(orphanScene.byId.get('a').isMissingMedia, true);
});

test('drawTimelineScene draws transition strips, export range, lasso and recording', () => {
  const transition = {
    id: 'tr', trackId: 't1', name: 'tr', startTime: 2, duration: 1,
    type: 'transition', components: [{ type: 'TransitionClipComponent', enabled: true }],
  };
  const scene = buildTimelineScene({
    tracks: TRACKS,
    clips: [clip('a', 0, 6), transition],
    pixelsPerSecond: 40,
  });
  const ctx = mockContext();

  const result = drawTimelineScene(ctx, {
    scene,
    theme: readTimelineTheme(null),
    view: { scrollLeft: 0, scrollTop: 0, width: 600, height: 160 },
    state: {
      exportRange: { in: 1, out: 4 },
      lasso: { x0: 0, y0: 0, x1: 100, y1: 100 },
      recording: { trackId: 't1', startTime: 5, level: 0.6 },
      hover: { clipId: 'tr' },
      peaksLoading: true,
    },
  });

  assert.equal(result.drawnClips, 2);
  assert.ok(ctx.calls.strokeRect > 0, 'the transition strip and recording preview are stroked');
});

test('selection highlights come from draw state, not from the scene', () => {
  const scene = buildTimelineScene({
    tracks: TRACKS,
    clips: [clip('a', 0, 4)],
    pixelsPerSecond: 40,
    mediaAssets: [{ id: 'm', url: 'asset://a.wav' }],
  });
  const view = { scrollLeft: 0, scrollTop: 0, width: 400, height: 200 };
  const theme = readTimelineTheme(null);

  const unselected = mockContext();
  drawTimelineScene(unselected, { scene, theme, view, state: {} });
  const selected = mockContext();
  drawTimelineScene(selected, { scene, theme, view, state: { selectedIds: ['a'] } });

  // Same scene object either way — only the draw-time state differs.
  assert.ok(!unselected.strokedWith.includes('#38bdf8'), 'nothing highlighted without a selection');
  assert.ok(selected.strokedWith.includes('#38bdf8'), 'the selected card is stroked with the accent colour');
  assert.equal(selected.calls.stroke, unselected.calls.stroke, 'the same number of shapes is drawn');
});

test('grid lines and lane backgrounds match the DOM classes they replace', () => {
  const theme = readTimelineTheme(null);
  const scene = buildTimelineScene({
    tracks: TRACKS,
    clips: [clip('a', 0, 4)],
    pixelsPerSecond: 40,
    mediaAssets: [{ id: 'm', url: 'asset://a.wav' }],
  });
  const ctx = mockContext();
  drawTimelineScene(ctx, {
    scene,
    theme,
    view: { scrollLeft: 0, scrollTop: 0, width: 200, height: 160 },
    state: {},
  });

  // `.track-grid-pattern` is ONE 1px line per getTickIntervalSeconds tick —
  // 2s at 40px/s, so 80px apart — all in its own rgba(255,255,255,0.14). The
  // canvas used to draw five times as many lines (a minor grid at interval/5 in
  // a fainter colour), which is not what the DOM renderer looks like.
  const grid = ctx.filledRects.filter((r) => r.w === 1 && r.h === 160);
  assert.deepEqual(grid.map((r) => r.x), [0, 80, 160]);
  assert.deepEqual(new Set(grid.map((r) => r.style)), new Set(['rgba(255, 255, 255, 0.14)']));

  // `.track-lane-row`'s rgba(28,28,32,0.4) composited over --unity-darkest.
  assert.equal(theme.laneBackground, '#1a1a1c');
  assert.ok(
    ctx.filledRects.some((r) => r.style === '#1a1a1c' && r.y === 0 && r.h === TRACK_HEIGHT),
    'the lane row is filled with the composited row colour'
  );

  // A locked track: base --unity-darkest plus the 45deg hatch bands, NOT an
  // opaque wash in a single colour.
  const locked = mockContext();
  const lockedScene = buildTimelineScene({
    tracks: [{ ...TRACKS[0], locked: true }],
    clips: [clip('a', 0, 4)],
    pixelsPerSecond: 40,
  });
  drawTimelineScene(locked, {
    scene: lockedScene,
    theme,
    view: { scrollLeft: 0, scrollTop: 0, width: 200, height: 160 },
    state: {},
  });
  assert.ok(locked.filledRects.some((r) => r.style === '#191919'), 'locked rows show the container colour through');
  assert.ok(locked.strokedWith.includes(theme.laneLockedA), 'the 45deg hatch bands are stroked on');
  assert.ok(locked.strokedWith.includes(theme.laneLockedB));
});

test('the drag target lane is highlighted like .track-lane-row.drag-target', () => {
  const theme = readTimelineTheme(null);
  const scene = buildTimelineScene({
    tracks: TRACKS,
    clips: [clip('a', 0, 4)],
    pixelsPerSecond: 40,
  });
  const ctx = mockContext();
  drawTimelineScene(ctx, {
    scene,
    theme,
    view: { scrollLeft: 0, scrollTop: 0, width: 200, height: 160 },
    state: { dragOverTrackId: 't1' },
  });

  assert.ok(
    ctx.filledRects.some((r) => r.style === 'rgba(37, 99, 235, 0.15)' && r.y === 0 && r.h === TRACK_HEIGHT),
    'the row gets the translucent blue drag-target fill'
  );
  const border = ctx.filledRects.filter((r) => r.style === '#2563eb' && r.h === 1);
  assert.deepEqual(border.map((r) => r.y).sort((a, b) => a - b), [0, TRACK_HEIGHT - 1]);

  // With no target lane there is no highlight at all.
  const none = mockContext();
  drawTimelineScene(none, {
    scene,
    theme,
    view: { scrollLeft: 0, scrollTop: 0, width: 200, height: 160 },
    state: {},
  });
  assert.ok(!none.filledRects.some((r) => r.style === 'rgba(37, 99, 235, 0.15)'));
});

test('a locked track draws but reports no interactive handles', () => {
  const scene = buildTimelineScene({
    tracks: [{ id: 't1', name: 'locked', visible: true, locked: true }],
    clips: [clip('a', 0, 3)],
    pixelsPerSecond: 40,
  });
  const item = scene.byId.get('a');
  const ctx = mockContext();

  drawTimelineScene(ctx, {
    scene,
    theme: readTimelineTheme(null),
    view: { scrollLeft: 0, scrollTop: 0, width: 400, height: 160 },
    state: {},
  });

  // The lock glyph is drawn in place of a selection/handle affordance.
  assert.ok(ctx.calls.fillRect > 0);
  assert.equal(item.isLocked, true);
});

test('waveform helpers agree on which clips get a waveform and how many buckets', () => {
  const scene = buildTimelineScene({
    tracks: TRACKS,
    clips: [
      clip('audio', 0, 10),
      clip('video', 12, 10, { components: [{ type: 'VideoRenderer', src: 'asset://v.mp4' }] }),
      // Both components: the DOM's `hasAudio` is true here even though the card
      // is a VIDEO card, so it draws a (purple) waveform like the audio one.
      clip('video-with-audio', 24, 10, {
        components: [
          { type: 'VideoRenderer', src: 'asset://v.mp4' },
          { type: 'AudioSource', src: 'asset://a.wav' },
        ],
      }),
    ],
    pixelsPerSecond: 40,
  });

  const audioItem = scene.byId.get('audio');
  const videoItem = scene.byId.get('video');
  const videoWithAudio = scene.byId.get('video-with-audio');
  assert.equal(wantsWaveform(audioItem), true);
  assert.equal(wantsWaveform(videoItem), false, 'no AudioSource component and no audio-type entity');
  assert.equal(videoWithAudio.category, 'video');
  assert.equal(wantsWaveform(videoWithAudio), true, 'hasAudio, exactly like ClipItem shows it on a video card');

  // A clip narrowed below the DOM's 30px floor loses its waveform, not its name.
  const narrow = { ...audioItem, width: 24 };
  assert.equal(wantsWaveform(narrow), false);

  const rect = waveformRectFor(audioItem);
  assert.ok(rect.width > 0 && rect.height > 0);

  // Bucket counts sit on the power-of-two ladder inside the shared bounds, so
  // neighbouring zoom levels share one envelope instead of each asking for a
  // resolution of its own (the "waveform reloads while zooming" flicker).
  const buckets = bucketsForCard(rect.width, rect.height);
  assert.ok(
    buckets >= MIN_WAVEFORM_BUCKETS && buckets <= MAX_WAVEFORM_BUCKETS,
    'bucket count stays inside the ladder bounds'
  );
  assert.equal(buckets & (buckets - 1), 0, 'bucket count is a power of two');
  assert.ok(
    buckets >= rect.width,
    'a card never asks for fewer buckets than it has pixels to draw across'
  );
  assert.equal(
    bucketsForCard(rect.width + 1, rect.height),
    buckets,
    'a one-pixel width change stays on the same rung'
  );

  // Drawing never throws, with or without an envelope.
  const ctx = mockContext();
  const envelope = envelopeOf(Math.min(4096, buckets));
  drawWaveformEnvelope(ctx, { ...rect, envelope, color: 'rgba(1,2,3,0.5)' });
  drawWaveformEnvelope(ctx, { ...rect, envelope: null, color: 'rgba(1,2,3,0.5)' });
  drawWaveformPlaceholder(ctx, rect);
  assert.ok(ctx.calls.fill > 0, 'a real envelope was filled');

  // Visible-bucket culling: a card far wider than the viewport must cost what is
  // ON SCREEN, not what the clip's whole width is. Same envelope, tiny window.
  const wide = { x: 0, y: rect.y, width: 200000, height: rect.height };
  const wideEnvelope = envelopeOf(16384);
  const full = mockContext();
  drawWaveformEnvelope(full, { ...wide, envelope: wideEnvelope, color: 'rgba(1,2,3,0.5)' });
  const culled = mockContext();
  drawWaveformEnvelope(culled, {
    ...wide,
    envelope: wideEnvelope,
    color: 'rgba(1,2,3,0.5)',
    view: { scrollLeft: 100000, width: 1600 },
  });
  assert.ok(full.calls.lineTo > 1000, 'unculled drawing walks the whole envelope');
  assert.ok(
    culled.calls.lineTo > 0 && culled.calls.lineTo < full.calls.lineTo / 20,
    'culled drawing only walks the buckets inside the viewport'
  );
});
