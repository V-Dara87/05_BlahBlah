import test from 'node:test';
import assert from 'node:assert/strict';
import { computeActiveEntitiesAtTime } from './renderPipeline.js';
import { createDefaultCamera, getFocalLength } from './camera3d.js';
import { createGameObject } from './ecs.js';

const VIEWPORT = { width: 1920, height: 1080 };
// The active-entity index only shows clips on visible, unlocked tracks.
const TRACKS = [{ id: 'track-1', name: 'Track 1', visible: true, locked: false }];

/** A game object whose Transform carries the given fields (is3D, x, z, ...). */
function entity(name, { parentId } = {}, transform = {}) {
  const obj = createGameObject({
    name,
    trackId: 'track-1',
    startTime: 0,
    duration: 10,
    parentId,
  });
  obj.components = obj.components.map((c) =>
    c.type === 'Transform' ? { ...c, opacity: 1, scaleX: 1, scaleY: 1, scaleZ: 1, ...transform } : c
  );
  return obj;
}

function project(entities) {
  const items = computeActiveEntitiesAtTime({
    entities,
    tracks: TRACKS,
    time: 1,
    viewport: VIEWPORT,
  });
  return new Map(items.map((item) => [item.entity.name, item]));
}

/** Screen position of a world point, for the default camera at z = -1000. */
function screenFor({ x = 0, y = 0, z = 0 } = {}) {
  const camera = createDefaultCamera();
  const focal = getFocalLength(VIEWPORT.height, camera.fov) * camera.zoom;
  const distance = z - camera.position.z;
  return {
    x: VIEWPORT.width / 2 + (x * focal) / distance,
    y: VIEWPORT.height / 2 + (y * focal) / distance,
  };
}

test('3D hierarchy - a child inherits its parent position exactly once', () => {
  const parent = entity('parent', {}, { x: 200, y: 0, z: 0, is3D: true });
  const child = entity('child', { parentId: parent.id }, { x: 300, y: 0, z: 0, is3D: true });

  const childItem = project([parent, child]).get('child');
  assert.ok(childItem, 'the child must be resolved');
  // 200 + 300 = 500, applied once.
  const expected = screenFor({ x: 500 });
  assert.ok(
    Math.abs(childItem.projectedTransform.screenX - expected.x) < 1e-6,
    `child screen X should be ${expected.x}, got ${childItem.projectedTransform.screenX}`
  );
});

test('3D hierarchy - a child inherits its parent Z once', () => {
  const parent = entity('parent', {}, { x: 0, y: 0, z: -300, is3D: true });
  const child = entity('child', { parentId: parent.id }, { x: 0, y: 0, z: 100, is3D: true });

  const childItem = project([parent, child]).get('child');
  assert.ok(childItem, 'the child must be resolved');
  assert.ok(
    Math.abs(childItem.projectedTransform.screenX - VIEWPORT.width / 2) < 1e-6,
    'X stays centred'
  );

  const camera = createDefaultCamera();
  const focal = getFocalLength(VIEWPORT.height, camera.fov) * camera.zoom;
  // -300 + 100 = -200 world Z => 800px in front of the default camera.
  assert.ok(
    Math.abs(childItem.projectedTransform.scaleFactor - focal / 800) < 1e-6,
    `scale should reflect a single 800px depth, got ${childItem.projectedTransform.scaleFactor}`
  );
});

test('3D hierarchy - a parent rotation reaches the child once', () => {
  const parent = entity('parent', {}, { x: 0, y: 0, z: 0, rotationZ: 90, is3D: true });
  const child = entity('child', { parentId: parent.id }, { x: 300, y: 0, z: 0, is3D: true });

  const childItem = project([parent, child]).get('child');
  assert.ok(childItem, 'the child must be resolved');
  // Rotated 90 degrees about the origin: +300 X becomes +300 Y (down).
  const expected = screenFor({ y: 300 });
  assert.ok(
    Math.abs(childItem.projectedTransform.screenX - VIEWPORT.width / 2) < 1e-6,
    `X should collapse to the centre, got ${childItem.projectedTransform.screenX}`
  );
  assert.ok(
    Math.abs(childItem.projectedTransform.screenY - expected.y) < 1e-6,
    `Y should carry the full 300px offset (${expected.y}), got ${childItem.projectedTransform.screenY}`
  );
});

test('3D hierarchy - a 3D parent makes a 2D child a 3D layer', () => {
  const parent = entity('parent', {}, { x: 0, y: 0, z: 0, is3D: true });
  const child = entity('child', { parentId: parent.id }, { x: 100, y: 0, z: 0 });

  const childItem = project([parent, child]).get('child');
  assert.ok(childItem, 'the child must be resolved');
  assert.equal(childItem.is3D, true);
  assert.ok(childItem.projectedTransform, 'and it must be projected');
});
