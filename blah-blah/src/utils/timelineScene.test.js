import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTimelineScene,
  CLIP_TOP_INSET,
  CLIP_ZONES,
  MIN_CLIP_WIDTH_PX,
} from './timelineScene.js';
import { TRACK_HEIGHT } from './timelineLayout.js';

const TRACKS = [
  { id: 't1', name: 'Track 1', visible: true, locked: false },
  { id: 't2', name: 'Track 2', visible: true, locked: true },
];

const clip = (id, trackId, startTime, duration, extra = {}) => ({
  id,
  trackId,
  name: id,
  startTime,
  duration,
  active: true,
  components: [{ type: 'VideoRenderer', src: 'asset://clip.mp4' }],
  ...extra,
});

test('scene rows match computeTrackLanes order and heights', () => {
  const tracks = [{ ...TRACKS[0] }, { ...TRACKS[1], height: 200 }];
  const scene = buildTimelineScene({
    tracks,
    clips: [clip('a', 't1', 0, 2), clip('b', 't2', 1, 2)],
    pixelsPerSecond: 40,
  });

  assert.equal(scene.rows.length, 2);
  assert.deepEqual(scene.rows.map((r) => r.trackId), ['t1', 't2']);
  assert.equal(scene.rows[0].y, 0);
  assert.equal(scene.rows[0].height, TRACK_HEIGHT);
  assert.equal(scene.rows[1].y, TRACK_HEIGHT, 'second row starts below the first');
  assert.equal(scene.rows[1].height, 200);
  assert.equal(scene.totalHeight, TRACK_HEIGHT + 200);
});

test('clip cards land on the same pixels ClipItem computes', () => {
  const scene = buildTimelineScene({
    tracks: [TRACKS[0]],
    clips: [clip('a', 't1', 2, 3)],
    pixelsPerSecond: 40,
  });
  const item = scene.byId.get('a');

  assert.equal(item.x, 80, 'startTime * pixelsPerSecond');
  assert.equal(item.width, 120, 'duration * pixelsPerSecond');
  // availableHeight = max(24, 128 - 10) = 118; laneCount 1 -> card height 118.
  assert.equal(item.height, 118);
  assert.equal(item.y, CLIP_TOP_INSET);
  assert.equal(item.kind, 'clip');
});

test('narrow clips keep the 16px floor so they stay clickable', () => {
  const scene = buildTimelineScene({
    tracks: [TRACKS[0]],
    clips: [clip('tiny', 't1', 0, 0.01)],
    pixelsPerSecond: 10,
  });
  assert.equal(scene.byId.get('tiny').width, MIN_CLIP_WIDTH_PX);
});

test('overlapping clips split the row into sub-lanes like the DOM', () => {
  const scene = buildTimelineScene({
    tracks: [TRACKS[0]],
    clips: [clip('a', 't1', 0, 4), clip('b', 't1', 1, 4), clip('loose', 't1', 20, 1)],
    pixelsPerSecond: 40,
  });

  const a = scene.byId.get('a');
  const b = scene.byId.get('b');
  assert.equal(a.laneCount, 2);
  assert.equal(b.laneCount, 2);
  assert.equal(a.laneIndex + b.laneIndex, 1, 'the two overlapping clips take different half-lanes');
  assert.equal(a.height, 59);
  assert.equal(b.y - a.y, 59, 'the second sub-lane sits directly below the first');
  // A clip with nothing overlapping it keeps the full row height.
  assert.equal(scene.byId.get('loose').laneCount, 1);
  assert.equal(scene.byId.get('loose').height, 118);
});

test('transition clips are full-height overlay cards, never sub-lanes', () => {
  const transition = {
    id: 'tr',
    trackId: 't1',
    name: 'transition',
    startTime: 3.5,
    duration: 1,
    type: 'transition',
    components: [{ type: 'TransitionClipComponent', enabled: true }],
  };
  const scene = buildTimelineScene({
    tracks: [TRACKS[0]],
    // Deliberately overlapping a clip: a transition would otherwise squeeze
    // its neighbours into half-lanes.
    clips: [clip('a', 't1', 0, 4), clip('b', 't1', 4, 4), transition],
    pixelsPerSecond: 40,
  });

  const tr = scene.byId.get('tr');
  assert.equal(tr.kind, 'transition');
  assert.equal(tr.laneCount, 1);
  assert.equal(scene.byId.get('a').laneCount, 1, 'the transition does not shrink its neighbours');
  // TransitionClipItem.jsx geometry: top 5px, height max(24, rowHeight - 10),
  // width max(12, duration * pps) — the card overlays the whole row.
  assert.equal(tr.y, CLIP_TOP_INSET);
  assert.equal(tr.height, TRACK_HEIGHT - 10);
  assert.equal(tr.width, 40);
  assert.equal(tr.stripY, undefined, 'the old centred-strip fields are gone');
});

test('a very short transition keeps its own 12px minimum, not the clip 16px', () => {
  const transition = {
    id: 'tr', trackId: 't1', name: 'tr', startTime: 0, duration: 0.05,
    type: 'transition', components: [{ type: 'TransitionClipComponent', enabled: true }],
  };
  const scene = buildTimelineScene({
    tracks: [TRACKS[0]],
    clips: [clip('a', 't1', 0, 4), transition],
    pixelsPerSecond: 40,
  });
  assert.equal(scene.byId.get('tr').width, 12);
  assert.equal(scene.byId.get('a').width, 160);
});

test('itemsInRange finds only intersecting clips, including zero-width windows', () => {
  const clips = [];
  for (let i = 0; i < 500; i++) clips.push(clip(`c${i}`, 't1', i * 10, 5));
  const scene = buildTimelineScene({ tracks: [TRACKS[0]], clips, pixelsPerSecond: 40 });

  const at = (t) => scene.itemsInRange(t, t).map((i) => i.id).sort();
  assert.deepEqual(at(0), ['c0']);
  assert.deepEqual(at(1002), ['c100']);
  assert.deepEqual(at(5000), []);
  // A window spanning the gap between two clips returns both sides, ordered
  // by start (c99 is [990, 995), c100 is [1000, 1005)).
  const span = scene.itemsInRange(994, 1001).map((i) => i.id);
  assert.deepEqual(span, ['c99', 'c100']);
  assert.deepEqual(scene.itemsInRange(996, 999), [], 'the gap between them is empty');
  // Windows outside the project are cheap and empty.
  assert.deepEqual(scene.itemsInRange(60000, 61000), []);
});

test('hitTest resolves card zones: body, trim edges, pickwhip and bare lane', () => {
  const scene = buildTimelineScene({
    tracks: [TRACKS[0]],
    clips: [clip('a', 't1', 1, 4)],
    pixelsPerSecond: 40,
  });
  const item = scene.byId.get('a');
  const midY = item.y + item.height / 2;

  assert.equal(scene.hitTest(item.x + item.width / 2, midY).zone, CLIP_ZONES.BODY);
  assert.equal(scene.hitTest(item.x + 2, midY).zone, CLIP_ZONES.TRIM_LEFT);
  assert.equal(scene.hitTest(item.x + item.width - 2, midY).zone, CLIP_ZONES.TRIM_RIGHT);
  assert.equal(scene.hitTest(item.x + item.width - 6, item.y + 4).zone, CLIP_ZONES.PICKWHIP, 'pickwhip lives in the top-right corner');

  const lane = scene.hitTest(item.x + item.width + 40, midY);
  assert.equal(lane.type, 'lane');
  assert.equal(lane.trackId, 't1');
  assert.equal(lane.time, scene.xToTime(item.x + item.width + 40));

  assert.equal(scene.hitTest(10, -20), null, 'above the first row is empty space');
});

test('hitTest prefers the transition card and ignores handles on a locked track', () => {
  const transition = {
    id: 'tr', trackId: 't1', name: 'tr', startTime: 2, duration: 1,
    type: 'transition', components: [{ type: 'TransitionClipComponent', enabled: true }],
  };
  const scene = buildTimelineScene({
    tracks: [TRACKS[0]],
    clips: [clip('a', 't1', 0, 8), transition],
    pixelsPerSecond: 40,
  });
  const tr = scene.byId.get('tr');
  const a = scene.byId.get('a');

  // The transition card covers the row over its whole time range, so anywhere
  // inside it grabs the transition (matching the DOM, where the card sits on
  // top of its neighbours at a higher z-index).
  for (const y of [tr.y + 2, tr.y + tr.height / 2, tr.y + tr.height - 2]) {
    const hit = scene.hitTest(tr.x + tr.width / 2, y);
    assert.equal(hit.clipId, 'tr', `y=${y}`);
    assert.equal(hit.zone, CLIP_ZONES.BODY);
  }

  // Outside the transition's own time range the clip underneath is hit.
  assert.equal(scene.hitTest(tr.x + tr.width + 20, a.y + a.height / 2).clipId, 'a');

  // A locked track's clips have no trim/pickwhip zones — only their body.
  const lockedClip = clip('locked', 't2', 0, 4);
  const lockedScene = buildTimelineScene({
    tracks: TRACKS,
    clips: [lockedClip],
    pixelsPerSecond: 40,
  });
  const lockedItem = lockedScene.byId.get('locked');
  assert.equal(
    lockedScene.hitTest(lockedItem.x + 2, lockedItem.y + lockedItem.height / 2).zone,
    CLIP_ZONES.BODY
  );
});

test('itemsInRect answers lasso selection from scene geometry', () => {
  const scene = buildTimelineScene({
    tracks: [TRACKS[0], { ...TRACKS[1], locked: false }],
    clips: [
      clip('a', 't1', 0, 2),
      clip('b', 't1', 3, 2),
      clip('c', 't2', 0, 2),
    ],
    pixelsPerSecond: 40,
  });

  // One row tall, spanning only the first clip's time range on track 1.
  const rowOne = scene.rows[0];
  const inFirst = scene.itemsInRect({ x0: 0, y0: rowOne.y, x1: 79, y1: rowOne.y + rowOne.height });
  assert.deepEqual(inFirst.map((i) => i.id), ['a']);

  // Whole surface: everything.
  const all = scene.itemsInRect({ x0: 0, y0: 0, x1: 2000, y1: scene.totalHeight });
  assert.deepEqual(all.map((i) => i.id).sort(), ['a', 'b', 'c']);
});

test('selection is NOT a scene input: geometry is independent of selection', () => {
  const clips = [clip('a', 't1', 0, 2), clip('b', 't1', 3, 2)];
  const geometryOf = (scene) =>
    scene.items.map((i) => ({ id: i.id, x: i.x, y: i.y, width: i.width, height: i.height, lane: i.laneIndex }));

  const base = buildTimelineScene({ tracks: [TRACKS[0]], clips, pixelsPerSecond: 40 });
  // `selectedIds` is not even an argument any more — this is the regression
  // guard that it must never come back, because a selectedIds dependency made
  // every click and lasso tick re-lay-out the whole project.
  const withSelectionArg = buildTimelineScene({
    tracks: [TRACKS[0]],
    clips,
    pixelsPerSecond: 40,
    selectedIds: ['a'],
  });

  assert.deepEqual(geometryOf(withSelectionArg), geometryOf(base));
  assert.ok(
    base.items.every((item) => item.isSelected === undefined),
    'items carry no selection state — drawing applies it from state.selectedIds'
  );
});

test('missing-media flag mirrors ClipItem: unknown src is flagged, blob is not', () => {
  const scene = buildTimelineScene({
    tracks: [TRACKS[0]],
    clips: [
      clip('gone', 't1', 0, 1, { components: [{ type: 'VideoRenderer', src: 'asset://gone.mp4' }] }),
      clip('known', 't1', 2, 1, { components: [{ type: 'VideoRenderer', src: 'asset://there.mp4' }] }),
      clip('recording', 't1', 4, 1, { components: [{ type: 'AudioSource', src: 'blob:abc' }] }),
    ],
    mediaAssets: [{ id: 'm1', url: 'asset://there.mp4' }],
    pixelsPerSecond: 40,
  });

  assert.equal(scene.byId.get('gone').isMissingMedia, true);
  assert.equal(scene.byId.get('known').isMissingMedia, false);
  assert.equal(scene.byId.get('recording').isMissingMedia, false, 'a live recording is not "missing"');
});

test('card category follows the entity type, like ecs.isVideoEntity/isAudioEntity', () => {
  const scene = buildTimelineScene({
    tracks: [TRACKS[0]],
    clips: [
      // Typed, with no renderer component at all: ClipItem still categories
      // this as a VIDEO card, so the canvas must too (it used to fall through
      // to 'prefab' and paint a text-style clip pink).
      { id: 'typed-video', trackId: 't1', name: 'typed', type: 'video', startTime: 0, duration: 2 },
      { id: 'typed-audio', trackId: 't1', name: 'typed', type: 'audio', startTime: 3, duration: 2, components: [] },
      clip('component-video', 't1', 6, 2),
    ],
    pixelsPerSecond: 40,
  });

  assert.equal(scene.byId.get('typed-video').category, 'video');
  assert.equal(scene.byId.get('typed-audio').category, 'audio');
  assert.equal(scene.byId.get('component-video').category, 'video');
});

test('the waveform url and window come from ClipItem\'s own rules', () => {
  const scene = buildTimelineScene({
    tracks: [TRACKS[0]],
    clips: [
      {
        id: 'both',
        trackId: 't1',
        name: 'both',
        // ClipItem's audioUrl: the entity's own src wins over the component's.
        src: 'asset://own.wav',
        startTime: 0,
        duration: 4,
        components: [{ type: 'AudioSource', src: 'asset://comp.wav', mediaOffset: 2, speed: 2 }],
      },
    ],
    mediaAssets: [{ id: 'a', url: 'asset://comp.wav' }],
    pixelsPerSecond: 40,
  });
  const item = scene.byId.get('both');

  assert.equal(item.audioUrl, 'asset://own.wav');
  assert.equal(item.hasAudio, true);
  assert.equal(item.audioStartSec, 2, 'the mediaOffset in-point');
  // 4s on the timeline at 2x consumes 8s of SOURCE, so the window is 8s wide.
  assert.equal(item.audioEndSec, 2 + 8);
  assert.equal(item.isMissingMedia, true, 'the winning url is the one that must resolve');
});

test('the audio window inherits a parent Transform speed when it has none of its own', () => {
  const scene = buildTimelineScene({
    tracks: [TRACKS[0]],
    clips: [
      clip('parent', 't1', 0, 4, {
        components: [{ type: 'VideoRenderer', src: 'asset://v.mp4' }, { type: 'Transform', speed: 3 }],
      }),
      clip('child', 't1', 0, 1, {
        parentId: 'parent',
        components: [{ type: 'AudioSource', src: 'asset://a.wav', mediaOffset: 1 }],
      }),
    ],
    pixelsPerSecond: 40,
  });

  assert.equal(scene.byId.get('child').audioEndSec, 1 + 3);
});

test('a transition off the cut is flagged as an orphan; one on it is not', () => {
  const transition = (id, startTime) => ({
    id,
    trackId: 't1',
    name: id,
    startTime,
    duration: 1,
    type: 'transition',
    components: [{ type: 'TransitionClipComponent', preset: 'crossfade' }],
  });
  const scene = buildTimelineScene({
    // a ends at 4s, b starts at 4s: that is the cut `onCut` straddles.
    tracks: [TRACKS[0]],
    clips: [clip('a', 't1', 0, 4), clip('b', 't1', 4, 4), transition('onCut', 3.5), transition('offCut', 20)],
    pixelsPerSecond: 40,
  });

  assert.equal(scene.byId.get('onCut').isOrphanTransition, false);
  assert.equal(scene.byId.get('offCut').isOrphanTransition, true, 'no neighbour on this cut — export will not blend it');
  // The label the DOM shows, not the raw preset id.
  assert.equal(scene.byId.get('onCut').transitionLabel, 'Crossfade');
  assert.equal(scene.byId.get('onCut').transitionPreset, 'crossfade');
});
