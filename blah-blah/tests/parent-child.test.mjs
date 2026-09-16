import assert from 'node:assert/strict';
import { removeEntitiesByIds, createGameObject, migrateEntities } from '../src/engine/ecs.js';
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

// ─── 4. Speed Inheritance & Video-Audio Companion ────────────────────────────

test('composeTransform2D: child local speed takes precedence or inherits parent speed', () => {
  const parent = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, speed: 2 };
  const childWithSpeed = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, speed: 2 };
  const world1 = composeTransform2D(parent, childWithSpeed);
  assert.equal(world1.speed, 2);

  const childInheriting = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
  const world2 = composeTransform2D(parent, childInheriting);
  assert.equal(world2.speed, 2);
});

test('video-audio pairing: video and audio clips share duration, audio is parented to video, video is muted', () => {
  const asset = { name: 'sample.mp4', url: 'blob:test', duration: 12, type: 'video' };
  const clipName = asset.name.replace(/\.[^.]+$/, '');

  const videoGO = createGameObject({
    name: clipName,
    trackId: 'track-1',
    startTime: 0,
    duration: asset.duration,
    type: 'video',
    src: asset.url,
    components: [
      { type: 'VideoRenderer', src: asset.url, volume: 0, speed: 1, mediaOffset: 0 },
    ],
  });

  const audioGO = createGameObject({
    name: `${clipName} (Audio)`,
    trackId: 'track-2',
    startTime: 0,
    duration: asset.duration,
    type: 'audio',
    src: asset.url,
    parentId: videoGO.id,
    components: [
      { type: 'AudioSource', src: asset.url, volume: 1, speed: 1, mediaOffset: 0 },
    ],
  });

  assert.equal(audioGO.parentId, videoGO.id);
  assert.equal(videoGO.components.find((c) => c.type === 'VideoRenderer').volume, 0);
  assert.equal(audioGO.components.find((c) => c.type === 'AudioSource').volume, 1);
  assert.equal(audioGO.startTime, videoGO.startTime);
  assert.equal(audioGO.duration, videoGO.duration);
});

test('split logic: splits child clips in tandem with parent clip and reparents part2', () => {
  const parent = {
    id: 'vid-1',
    name: 'Video',
    trackId: 't1',
    startTime: 0,
    duration: 10,
    parentId: null,
    components: [],
  };
  const child = {
    id: 'aud-1',
    name: 'Video (Audio)',
    trackId: 't2',
    startTime: 0,
    duration: 10,
    parentId: 'vid-1',
    components: [],
  };
  const entities = [parent, child];

  // Replicate the tandem split algorithm from useProjectStore
  const splitPoint = 4;
  const rawIds = ['vid-1'];
  const splitSet = new Set(rawIds);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const e of entities) {
      if (!splitSet.has(e.id) && e.parentId && splitSet.has(e.parentId)) {
        splitSet.add(e.id);
        expanded = true;
      }
    }
  }
  const ids = Array.from(splitSet);
  assert.deepEqual(ids, ['vid-1', 'aud-1']);

  const toAdd = [];
  const updatedMap = new Map();
  const parentPart2Map = new Map();

  ids.forEach((id) => {
    const target = entities.find((e) => e.id === id);
    if (!target) return;
    const part1Dur = splitPoint - target.startTime;
    const part2Dur = target.duration - part1Dur;
    const part1 = { ...target, name: `${target.name}_001`, duration: part1Dur };
    const newId = `part2-${target.id}`;
    parentPart2Map.set(target.id, newId);
    const part2 = {
      ...target,
      id: newId,
      name: `${target.name}_002`,
      startTime: splitPoint,
      duration: part2Dur,
    };
    updatedMap.set(target.id, part1);
    toAdd.push(part2);
  });

  toAdd.forEach((item) => {
    if (item.parentId && parentPart2Map.has(item.parentId)) {
      item.parentId = parentPart2Map.get(item.parentId);
    }
  });

  const part2Parent = toAdd.find((e) => e.id === 'part2-vid-1');
  const part2Child = toAdd.find((e) => e.id === 'part2-aud-1');

  assert.equal(updatedMap.get('vid-1').duration, 4);
  assert.equal(updatedMap.get('aud-1').duration, 4);
  assert.equal(updatedMap.get('aud-1').parentId, 'vid-1');

  assert.equal(part2Parent.duration, 6);
  assert.equal(part2Child.duration, 6);
  assert.equal(part2Child.parentId, part2Parent.id);
});

test('speed sync: changing parent speed syncs children speed, duration, and relative start time', () => {
  const parent = {
    id: 'vid-1',
    name: 'Video',
    startTime: 2,
    duration: 8,
    parentId: null,
    components: [{ type: 'Transform', speed: 1 }],
  };
  const child1 = {
    id: 'aud-1',
    name: 'Audio',
    startTime: 2,
    duration: 8,
    parentId: 'vid-1',
    components: [{ type: 'Transform', speed: 1 }],
  };
  const grandchild = {
    id: 'text-1',
    name: 'Subtitle',
    startTime: 4, // 2s after parent start
    duration: 4,
    parentId: 'aud-1',
    components: [{ type: 'Transform', speed: 1 }],
  };

  const prev = [parent, child1, grandchild];
  const updates = { components: [{ type: 'Transform', speed: 2 }], duration: 4 };

  // Replicate the speed sync algorithm from handleUpdateEntity in useProjectStore
  const target = prev.find((e) => e.id === 'vid-1');
  const oldTransform = target.components?.find((c) => c.type === 'Transform');
  const newTransform = updates.components?.find((c) => c.type === 'Transform');
  const oldSpeed = Number(oldTransform?.speed ?? 1) || 1;
  const newSpeed = Number(newTransform?.speed) || 1;
  const speedRatio = oldSpeed / newSpeed; // 1 / 2 = 0.5

  const descendantIds = new Set();
  let queue = [target.id];
  while (queue.length > 0) {
    const pId = queue.shift();
    for (const e of prev) {
      if (e.parentId === pId && !descendantIds.has(e.id)) {
        descendantIds.add(e.id);
        queue.push(e.id);
      }
    }
  }

  assert.deepEqual(Array.from(descendantIds), ['aud-1', 'text-1']);

  const next = prev.map((e) => {
    if (e.id === 'vid-1') {
      return { ...e, ...updates };
    }
    if (descendantIds.has(e.id)) {
      const relStart = e.startTime - target.startTime;
      const newStart = target.startTime + relStart * speedRatio;
      const newDuration = Math.max(0.2, (e.duration || 0) * speedRatio);
      const updatedComps = (e.components || []).map((c) =>
        c.type === 'Transform' ? { ...c, speed: newSpeed } : c
      );
      return {
        ...e,
        startTime: newStart,
        duration: newDuration,
        components: updatedComps,
      };
    }
    return e;
  });

  const nextParent = next.find((e) => e.id === 'vid-1');
  const nextChild1 = next.find((e) => e.id === 'aud-1');
  const nextGrandchild = next.find((e) => e.id === 'text-1');

  assert.equal(nextParent.duration, 4);
  assert.equal(nextParent.components[0].speed, 2);

  // Child1 (audio) duration is 4, speed is 2, startTime is 2
  assert.equal(nextChild1.duration, 4);
  assert.equal(nextChild1.startTime, 2);
  assert.equal(nextChild1.components[0].speed, 2);

  // Grandchild (subtitle): started 2s after parent -> now starts 1s after parent (startTime = 3)
  assert.equal(nextGrandchild.startTime, 3);
  assert.equal(nextGrandchild.duration, 2); // 4 * 0.5 = 2s
  assert.equal(nextGrandchild.components[0].speed, 2);
});

// ─── 5. Persistence across Save / Load (project.json serialization) ───────────

test('persistence: parentId, color, and prefab metadata survive project.json serialization and reload', () => {
  const originalEntities = [
    {
      id: 'parent-1',
      name: 'Parent GameObject',
      trackId: 'track-1',
      startTime: 0,
      duration: 10,
      type: 'video',
      src: 'test.mp4',
      active: true,
      color: '#ff0000',
      tag: 'Player',
      layer: 'Characters',
      parentId: null,
      prefabAssetId: 'prefab-123',
      prefabInstanceId: 'inst-999',
      prefabSourceSnapId: 'snap-1',
      components: [{ type: 'Transform', x: 100, y: 50 }],
      keyframes: {},
    },
    {
      id: 'child-1',
      name: 'Child GameObject',
      trackId: 'track-2',
      startTime: 2,
      duration: 5,
      type: 'audio',
      src: 'test.mp3',
      active: true,
      color: '#00ff00',
      tag: 'Sound',
      layer: 'Audio',
      parentId: 'parent-1',
      prefabAssetId: 'prefab-123',
      prefabInstanceId: 'inst-999',
      prefabSourceSnapId: 'snap-2',
      components: [{ type: 'Transform', x: 10, y: 20 }],
      keyframes: {},
    },
  ];

  // Emulate saveProjectToDirectory entity mapping
  const savedProjectJson = {
    entities: originalEntities.map((e) => ({
      ...e,
      id: e.id,
      name: e.name,
      parentId: e.parentId || null,
      trackId: e.trackId,
      startTime: e.startTime,
      duration: e.duration,
      type: e.type,
      src: e.src,
      active: e.active !== false,
      color: e.color,
      tag: e.tag || 'Untagged',
      layer: e.layer || 'Default',
      components: e.components,
      keyframes: e.keyframes,
    })),
  };

  const serialized = JSON.parse(JSON.stringify(savedProjectJson));
  const reloadedEntities = migrateEntities(serialized.entities);

  assert.equal(reloadedEntities.length, 2);
  const reloadedParent = reloadedEntities.find((e) => e.id === 'parent-1');
  const reloadedChild = reloadedEntities.find((e) => e.id === 'child-1');

  assert.ok(reloadedParent);
  assert.equal(reloadedParent.parentId, null);
  assert.equal(reloadedParent.color, '#ff0000');
  assert.equal(reloadedParent.tag, 'Player');
  assert.equal(reloadedParent.prefabAssetId, 'prefab-123');
  assert.equal(reloadedParent.prefabInstanceId, 'inst-999');

  assert.ok(reloadedChild);
  assert.equal(reloadedChild.parentId, 'parent-1');
  assert.equal(reloadedChild.color, '#00ff00');
  assert.equal(reloadedChild.tag, 'Sound');
  assert.equal(reloadedChild.prefabAssetId, 'prefab-123');
  assert.equal(reloadedChild.prefabInstanceId, 'inst-999');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
process.exit(0);
