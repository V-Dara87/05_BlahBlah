import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTimelineScene } from './timelineScene.js';
import {
  setDragPreview,
  clearDragPreview,
  getDragPreview,
  subscribeDragPreview,
  dragPreviewUpdates,
  buildDragPreviewOverrides,
  holdPreviewUntilNextScene,
  releaseCommittedPreview,
} from './dragPreview.js';

const tracks = [
  { id: 't1', name: 'Track 1' },
  { id: 't2', name: 'Track 2' },
];
const clips = [
  { id: 'a', trackId: 't1', startTime: 0, duration: 5, name: 'A' },
  { id: 'b', trackId: 't1', startTime: 20, duration: 5, name: 'B' },
  { id: 'c', trackId: 't2', startTime: 0, duration: 4, name: 'C' },
];

function sceneWith(sourceClips = clips) {
  return buildTimelineScene({ tracks, clips: sourceClips, pixelsPerSecond: 10 });
}

test('setDragPreview / clearDragPreview notify subscribers', () => {
  clearDragPreview();
  let calls = 0;
  const unsubscribe = subscribeDragPreview(() => { calls += 1; });

  setDragPreview([{ id: 'a', updates: { startTime: 2 } }]);
  assert.equal(calls, 1);
  assert.equal(getDragPreview().get('a').startTime, 2);

  // Identical content is still a change of preview, but clearing an already
  // empty preview must not fire.
  clearDragPreview();
  assert.equal(calls, 2);
  assert.equal(getDragPreview().size, 0);
  clearDragPreview();
  assert.equal(calls, 2);

  unsubscribe();
  setDragPreview([{ id: 'a', updates: { startTime: 3 } }]);
  assert.equal(calls, 2);
  clearDragPreview();
});

test('dragPreviewUpdates drops no-op values and keeps real changes', () => {
  const preview = new Map([
    ['a', { startTime: 0, duration: 5 }], // identical to committed values
    ['b', { startTime: 22, duration: 5, trackId: 't2' }],
  ]);
  const batch = dragPreviewUpdates(preview, clips);
  assert.deepEqual(batch, [{ id: 'b', updates: { startTime: 22, trackId: 't2' } }]);
});

test('dragPreviewUpdates can be limited to one gesture\'s clips', () => {
  const preview = new Map([
    ['a', { startTime: 2 }],
    ['b', { startTime: 22 }],
  ]);
  assert.deepEqual(dragPreviewUpdates(preview, clips, new Set(['a'])), [
    { id: 'a', updates: { startTime: 2 } },
  ]);
});

test('a move preview shifts x and leaves the lane alone', () => {
  const scene = sceneWith();
  const overrides = buildDragPreviewOverrides(scene, new Map([['a', { startTime: 10 }]]));
  const a = overrides.get('a');
  assert.equal(a.x, 100);
  assert.equal(a.width, 50);
  assert.equal(a.y, scene.byId.get('a').y);
  assert.equal(a.height, scene.byId.get('a').height);
});

test('a track change preview lands on the target row geometry', () => {
  const scene = sceneWith();
  const overrides = buildDragPreviewOverrides(
    scene,
    new Map([['a', { startTime: 30, trackId: 't2' }]])
  );
  const a = overrides.get('a');
  const targetRow = scene.rows.find((row) => row.trackId === 't2');
  assert.equal(a.x, 300);
  assert.equal(a.y, targetRow.y + 5);
  assert.equal(a.height, 118);
  // The row it left is repacked without it, so the remaining clip is full height.
  assert.equal(overrides.get('b').laneCount, 1);
});

test('a move that overlaps another card repacks the row like the drop will', () => {
  const scene = sceneWith();
  const overrides = buildDragPreviewOverrides(scene, new Map([['b', { startTime: 2 }]]));
  assert.equal(overrides.get('b').laneCount, 2);
  assert.equal(overrides.get('a').laneCount, 2);
  // Two sub-lanes split the row's available height.
  assert.equal(overrides.get('a').height, overrides.get('b').height);
  assert.notEqual(overrides.get('a').y, overrides.get('b').y);
});

test('a trim preview shortens the card and the waveform window', () => {
  const scene = sceneWith([
    { id: 'a', trackId: 't1', startTime: 0, duration: 5, name: 'A', type: 'audio' },
  ]);
  const overrides = buildDragPreviewOverrides(scene, new Map([['a', { duration: 2 }]]));
  const a = overrides.get('a');
  assert.equal(a.width, 20);
  assert.equal(a.audioEndSec - a.audioStartSec, 2);
});

test('a committed preview is held until the scene rebuilds', () => {
  setDragPreview([{ id: 'a', updates: { startTime: 3 } }]);
  holdPreviewUntilNextScene(1000);
  // Still drawn while the transition commit renders.
  assert.equal(getDragPreview().size, 1);
  releaseCommittedPreview();
  assert.equal(getDragPreview().size, 0);
});

test('a held preview is dropped by its own fallback timer', async () => {
  setDragPreview([{ id: 'a', updates: { startTime: 3 } }]);
  holdPreviewUntilNextScene(1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(getDragPreview().size, 0);
});

test('releasing with nothing held leaves the preview alone', () => {
  setDragPreview([{ id: 'a', updates: { startTime: 3 } }]);
  releaseCommittedPreview();
  assert.equal(getDragPreview().size, 1);
  clearDragPreview();
});

