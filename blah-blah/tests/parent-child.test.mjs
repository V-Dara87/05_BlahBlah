import assert from 'node:assert/strict';
import { removeEntitiesByIds, createGameObject } from '../src/engine/ecs.js';
import { computeActiveEntitiesAtTime, composeTransform2D } from '../src/engine/renderPipeline.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

console.log('\nParent-Child Feature Tests\n');

// ─── 1. Cascade Deletion (ecs.js) ───────────────────────────────────────────

test('removeEntitiesByIds: flat deletion without parents', () => {
  const entities = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ];
  const remaining = removeEntitiesByIds(entities, ['a']);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'b');
});

test('removeEntitiesByIds: cascades deletion from parent to child', () => {
  const entities = [
    { id: 'parent', name: 'Parent', parentId: null },
    { id: 'child', name: 'Child', parentId: 'parent' },
    { id: 'other', name: 'Other', parentId: null },
  ];
  const remaining = removeEntitiesByIds(entities, ['parent']);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'other');
});

test('removeEntitiesByIds: cascades deletion through multi-level hierarchy (grandchild)', () => {
  const entities = [
    { id: 'root', name: 'Root', parentId: null },
    { id: 'c1', name: 'Child 1', parentId: 'root' },
    { id: 'gc1', name: 'Grandchild 1', parentId: 'c1' },
    { id: 'gc2', name: 'Grandchild 2', parentId: 'c1' },
    { id: 'unrelated', name: 'Unrelated', parentId: null },
  ];
  const remaining = removeEntitiesByIds(entities, ['root']);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'unrelated');
});

test('removeEntitiesByIds: deleting child does not delete parent', () => {
  const entities = [
    { id: 'parent', name: 'Parent', parentId: null },
    { id: 'child', name: 'Child', parentId: 'parent' },
  ];
  const remaining = removeEntitiesByIds(entities, ['child']);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'parent');
});

// ─── 2. 2D Transform Composition (renderPipeline.js) ─────────────────────────

test('composeTransform2D: simple translation', () => {
  const parent = { x: 200, y: 300, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
  const child = { x: 50, y: -20, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
  const world = composeTransform2D(parent, child);
  assert.equal(world.x, 250);
  assert.equal(world.y, 280);
  assert.equal(world.rotation, 0);
});

test('composeTransform2D: 90-degree rotation translates child accordingly', () => {
  const parent = { x: 0, y: 0, rotation: 90, scaleX: 1, scaleY: 1, opacity: 1 };
  const child = { x: 100, y: 0, rotation: 15, scaleX: 1, scaleY: 1, opacity: 1 };
  const world = composeTransform2D(parent, child);
  assert(Math.abs(world.x - 0) < 1e-4);
  assert(Math.abs(world.y - 100) < 1e-4);
  assert.equal(world.rotation, 105);
});

test('composeTransform2D: scale and opacity multiply', () => {
  const parent = { x: 10, y: 20, rotation: 0, scaleX: 2, scaleY: 3, opacity: 0.5 };
  const child = { x: 10, y: 10, rotation: 0, scaleX: 1.5, scaleY: 2, opacity: 0.8 };
  const world = composeTransform2D(parent, child);
  assert.equal(world.x, 30); // 10 + 10 * 2
  assert.equal(world.y, 50); // 20 + 10 * 3
  assert.equal(world.scaleX, 3);
  assert.equal(world.scaleY, 6);
  assert(Math.abs(world.opacity - 0.4) < 1e-5);
});

// ─── 3. Parent-Scoped Visibility (renderPipeline.js) ─────────────────────────

test('computeActiveEntitiesAtTime: child is visible when parent is active', () => {
  const tracks = [{ id: 't1', visible: true, locked: false }];
  const parent = createGameObject({ name: 'P', trackId: 't1', startTime: 2, duration: 4 });
  const child = createGameObject({ name: 'C', trackId: 't1', startTime: 2, duration: 4, parentId: parent.id });

  const active = computeActiveEntitiesAtTime({
    entities: [parent, child],
    tracks,
    time: 3,
  });

  assert.equal(active.length, 2);
  const childActive = active.find((a) => a.entity.id === child.id);
  assert(childActive);
  assert.equal(childActive.depth, 1);
});

test('computeActiveEntitiesAtTime: child is NOT visible when parent is outside active duration', () => {
  const tracks = [{ id: 't1', visible: true, locked: false }];
  // Parent active from 2s to 4s
  const parent = createGameObject({ name: 'P', trackId: 't1', startTime: 2, duration: 2 });
  // Child on timeline from 1s to 6s
  const child = createGameObject({ name: 'C', trackId: 't1', startTime: 1, duration: 5, parentId: parent.id });

  // At time 1.5s: child's clip is present, but parent is NOT yet active -> child must be hidden
  const activeAt1_5 = computeActiveEntitiesAtTime({
    entities: [parent, child],
    tracks,
    time: 1.5,
  });
  assert.equal(activeAt1_5.length, 0);

  // At time 2.5s: parent IS active -> child is visible
  const activeAt2_5 = computeActiveEntitiesAtTime({
    entities: [parent, child],
    tracks,
    time: 2.5,
  });
  assert.equal(activeAt2_5.length, 2);

  // At time 4.5s: parent has ended -> child must be hidden
  const activeAt4_5 = computeActiveEntitiesAtTime({
    entities: [parent, child],
    tracks,
    time: 4.5,
  });
  assert.equal(activeAt4_5.length, 0);
});

test('computeActiveEntitiesAtTime: child is NOT visible when parent track is hidden or locked', () => {
  const tracks = [
    { id: 't-parent', visible: false, locked: false },
    { id: 't-child', visible: true, locked: false },
  ];
  const parent = createGameObject({ name: 'P', trackId: 't-parent', startTime: 0, duration: 5 });
  const child = createGameObject({ name: 'C', trackId: 't-child', startTime: 0, duration: 5, parentId: parent.id });

  const active = computeActiveEntitiesAtTime({
    entities: [parent, child],
    tracks,
    time: 2,
  });
  assert.equal(active.length, 0);
});

test('computeActiveEntitiesAtTime: multi-level hierarchy depth and world transform', () => {
  const tracks = [{ id: 't1', visible: true, locked: false }];
  const root = {
    id: 'root',
    name: 'Root',
    active: true,
    trackId: 't1',
    startTime: 0,
    duration: 10,
    parentId: null,
    components: [{ type: 'Transform', x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 }],
  };
  const child = {
    id: 'child',
    name: 'Child',
    active: true,
    trackId: 't1',
    startTime: 0,
    duration: 10,
    parentId: 'root',
    components: [{ type: 'Transform', x: 50, y: 0, rotation: 0, scaleX: 2, scaleY: 2, opacity: 0.5 }],
  };
  const grandchild = {
    id: 'grandchild',
    name: 'Grandchild',
    active: true,
    trackId: 't1',
    startTime: 0,
    duration: 10,
    parentId: 'child',
    components: [{ type: 'Transform', x: 10, y: 10, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 }],
  };

  const active = computeActiveEntitiesAtTime({
    entities: [root, child, grandchild],
    tracks,
    time: 1,
  });

  assert.equal(active.length, 3);
  const gc = active.find((a) => a.entity.id === 'grandchild');
  assert.equal(gc.depth, 2);
  // Root = (100, 100), Child = (150, 100) with scale 2
  // Grandchild local (10, 10) * childScale 2 = (20, 20) -> world (170, 120)
  assert.equal(gc.transform.x, 170);
  assert.equal(gc.transform.y, 120);
  assert.equal(gc.transform.scaleX, 2);
  assert.equal(gc.transform.opacity, 0.5);
});

test('computeActiveEntitiesAtTime: circular parenting does not crash and breaks cycle', () => {
  const tracks = [{ id: 't1', visible: true, locked: false }];
  const a = {
    id: 'a',
    name: 'A',
    active: true,
    trackId: 't1',
    startTime: 0,
    duration: 5,
    parentId: 'b',
    components: [{ type: 'Transform', x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 }],
  };
  const b = {
    id: 'b',
    name: 'B',
    active: true,
    trackId: 't1',
    startTime: 0,
    duration: 5,
    parentId: 'a',
    components: [{ type: 'Transform', x: 20, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 }],
  };

  // Must not throw or hang
  const active = computeActiveEntitiesAtTime({
    entities: [a, b],
    tracks,
    time: 2,
  });
  assert.equal(active.length, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
process.exit(0);
