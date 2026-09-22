import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildActiveEntityIndex, computeActiveEntitiesAtTime } from '../src/engine/renderPipeline.js';
import { createTransitionClipEntity, isTransitionClipEntity } from '../src/engine/ecs.js';

/**
 * The ORIGINAL per-call visibility implementation (verbatim, minus the parts
 * this test does not need), kept as the oracle: buildActiveEntityIndex is
 * allowed to be faster, never different. Every randomized assertion compares
 * the index against this and against computeActiveEntitiesAtTime itself.
 */
function referenceActiveEntities({ entities, tracks, time }) {
  const entityMap = new Map((entities || []).map((e) => [e.id, e]));
  const trackMap = new Map((tracks || []).map((t) => [t.id, t]));

  const isSelfActive = (e) => {
    if (!e || e.active === false) return false;
    if (time < e.startTime || time >= e.startTime + e.duration) return false;
    const track = trackMap.get(e.trackId);
    if (track && (!track.visible || track.locked)) return false;
    return true;
  };

  const isEntityVisible = (e) => {
    const visited = new Set();
    let curr = e;
    while (curr) {
      if (visited.has(curr.id)) break; // Cycle guard
      visited.add(curr.id);
      if (!isSelfActive(curr)) return false;
      if (!curr.parentId) break;
      curr = entityMap.get(curr.parentId);
      if (!curr) break; // Orphaned child whose parent doesn't exist
    }
    return true;
  };

  return (entities || []).filter((e) => !isTransitionClipEntity(e) && isEntityVisible(e)).map((e) => e.id);
}

/** Deterministic PRNG (mulberry32) so a failure is always reproducible. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeProject(rng, { entityCount, trackCount, parentChance, cycleChance }) {
  const tracks = [];
  for (let i = 0; i < trackCount; i++) {
    tracks.push({
      id: `t${i}`,
      // Occasionally omit `visible` entirely: the rule treats a missing
      // visible flag as NOT visible (`!track.visible`), which the index must
      // reproduce rather than "fix".
      ...(rng() < 0.15 ? {} : { visible: rng() < 0.8 }),
      locked: rng() < 0.15,
    });
  }

  const entities = [];
  for (let i = 0; i < entityCount; i++) {
    const startTime = Math.round(rng() * 600) / 10;
    const roll = rng();
    const entity = {
      id: `e${i}`,
      trackId: tracks[Math.floor(rng() * tracks.length)].id,
      startTime,
      // A slice of clips gets a NaN/undefined duration on purpose: the old
      // comparison chain made those never expire, and so must the index.
      duration: roll < 0.08 ? undefined : roll < 0.16 ? 0 : Math.round(rng() * 1000) / 10,
      active: rng() < 0.9,
      components: [],
    };
    if (i > 0 && rng() < parentChance) {
      const parent = entities[Math.floor(rng() * entities.length)];
      entity.parentId = parent.id;
      // Cycles: point a parent at a descendant (or at itself) occasionally.
      if (rng() < cycleChance) parent.parentId = entity.id;
    }
    entities.push(entity);
  }

  // Orphans: some parentIds point at nothing.
  for (const e of entities) {
    if (e.parentId && rng() < 0.1) e.parentId = 'does-not-exist';
  }

  return { entities, tracks };
}

test('buildActiveEntityIndex matches the original filter on randomized projects', () => {
  const rng = makeRng(20260922);

  for (let scenario = 0; scenario < 40; scenario++) {
    const { entities, tracks } = makeProject(rng, {
      entityCount: 5 + Math.floor(rng() * 30),
      trackCount: 1 + Math.floor(rng() * 4),
      parentChance: rng() * 0.6,
      cycleChance: rng() * 0.15,
    });

    const index = buildActiveEntityIndex({ entities, tracks });

    for (let sample = 0; sample < 40; sample++) {
      const time = Math.round(rng() * 7000) / 10;
      const expected = referenceActiveEntities({ entities, tracks, time });
      const fromIndex = index.activeAt(time).map((e) => e.id);
      const fromCompute = computeActiveEntitiesAtTime({ entities, tracks, time, scripts: [], fps: 30 }).map(
        (item) => item.entity.id
      );

      assert.deepEqual(fromIndex, expected, `scenario ${scenario} @ ${time}s: index vs original filter`);
      assert.deepEqual(fromCompute, expected, `scenario ${scenario} @ ${time}s: computeActiveEntitiesAtTime vs filter`);
    }
  }
});

test('buildActiveEntityIndex matches the original filter across a hierarchy matrix', () => {
  const tracks = [
    { id: 'visible', visible: true, locked: false },
    { id: 'hidden', visible: false, locked: false },
    { id: 'locked', visible: true, locked: true },
    { id: 'implicit', locked: false },
  ];

  const entities = [
    { id: 'root', trackId: 'visible', startTime: 0, duration: 10, active: true, components: [] },
    { id: 'child', trackId: 'visible', startTime: 2, duration: 3, active: true, parentId: 'root', components: [] },
    { id: 'grandchild', trackId: 'visible', startTime: 2, duration: 3, active: true, parentId: 'child', components: [] },
    { id: 'childOnHiddenTrack', trackId: 'hidden', startTime: 2, duration: 3, active: true, parentId: 'root', components: [] },
    { id: 'lockedRoot', trackId: 'locked', startTime: 0, duration: 10, active: true, components: [] },
    { id: 'childOfLocked', trackId: 'visible', startTime: 2, duration: 3, active: true, parentId: 'lockedRoot', components: [] },
    { id: 'inactiveRoot', trackId: 'visible', startTime: 0, duration: 10, active: false, components: [] },
    { id: 'childOfInactive', trackId: 'visible', startTime: 2, duration: 3, active: true, parentId: 'inactiveRoot', components: [] },
    { id: 'orphan', trackId: 'visible', startTime: 2, duration: 3, active: true, parentId: 'nope', components: [] },
    { id: 'onImplicitTrack', trackId: 'implicit', startTime: 2, duration: 3, active: true, components: [] },
    { id: 'zeroLength', trackId: 'visible', startTime: 2, duration: 0, active: true, components: [] },
    { id: 'noDuration', trackId: 'visible', startTime: 5, active: true, components: [] },
    { id: 'notYet', trackId: 'visible', startTime: 6, duration: 1, active: true, components: [] },
    { id: 'selfParent', trackId: 'visible', startTime: 1, duration: 5, active: true, parentId: 'selfParent', components: [] },
  ];

  const index = buildActiveEntityIndex({ entities, tracks });

  for (const time of [0, 1, 2, 2.5, 4.5, 5, 5.5, 6, 6.5, 9.5, 10, 20]) {
    const expected = referenceActiveEntities({ entities, tracks, time });
    assert.deepEqual(index.activeAt(time).map((e) => e.id), expected, `t=${time}`);
    assert.deepEqual(
      computeActiveEntitiesAtTime({ entities, tracks, time }).map((i) => i.entity.id),
      expected,
      `t=${time} (computeActiveEntitiesAtTime)`
    );
  }

  // Spot-check the interesting shapes explicitly, so a future oracle edit
  // cannot quietly make both sides wrong the same way.
  // t=0: only `root` — `lockedRoot` sits on a LOCKED track (the rule treats
  // locked exactly like hidden), `inactiveRoot` has active:false, and
  // `selfParent` has not started yet.
  assert.deepEqual(index.activeAt(0).map((e) => e.id), ['root']);
  // `onImplicitTrack` is deliberately ABSENT: its track omits the `visible`
  // flag, and `!track.visible` makes that track hidden — the index keeps that
  // pre-existing behaviour instead of defaulting a missing flag to visible.
  assert.deepEqual(index.activeAt(2.5).map((e) => e.id), [
    'root',
    'child',
    'grandchild',
    'orphan',
    'selfParent',
  ]);
  // t=1: `selfParent` is live despite pointing at itself (cycle guard), while
  // the locked-track root stays out.
  assert.deepEqual(index.activeAt(1).map((e) => e.id), ['root', 'selfParent']);
  // The no-duration clip never expires; everything else has ended by t=20.
  assert.deepEqual(index.activeAt(20).map((e) => e.id), ['noDuration']);
});

test('buildActiveEntityIndex excludes transition clips and preserves entities-array order', () => {
  const tracks = [{ id: 't0', visible: true, locked: false }];
  const transition = createTransitionClipEntity({ trackId: 't0', startTime: 0, duration: 2 });
  const entities = [
    { id: 'clip', trackId: 't0', startTime: 0, duration: 4, active: true, components: [] },
    transition,
    { id: 'long', trackId: 't0', startTime: 0, duration: 30, active: true, components: [] },
  ];

  const index = buildActiveEntityIndex({ entities, tracks });
  assert.equal(index.size, 2);
  // Sorted-by-start entries, but the query returns ORIGINAL array order so
  // preview stacking order cannot change.
  assert.deepEqual(index.activeAt(1).map((e) => e.id), ['clip', 'long']);
  assert.deepEqual(index.activeAt(5).map((e) => e.id), ['long']);
});

test('buildActiveEntityIndex memoizes on array identity and invalidates on a new array', () => {
  const tracks = [{ id: 't0', visible: true, locked: false }];
  const entities = [{ id: 'a', trackId: 't0', startTime: 0, duration: 10, active: true }];

  const first = buildActiveEntityIndex({ entities, tracks });
  assert.equal(buildActiveEntityIndex({ entities, tracks }), first, 'same arrays reuse the cached index');

  const moved = entities.map((e) => ({ ...e, startTime: 100 }));
  const second = buildActiveEntityIndex({ entities: moved, tracks });
  assert.notEqual(second, first, 'a new entities array rebuilds');
  assert.deepEqual(second.activeAt(5).map((e) => e.id), []);
  assert.deepEqual(first.activeAt(5).map((e) => e.id), ['a'], 'the old index is untouched');

  // Same entities, different tracks reference: must rebuild, not serve stale
  // track visibility.
  const hiddenTracks = [{ id: 't0', visible: false, locked: false }];
  const third = buildActiveEntityIndex({ entities, tracks: hiddenTracks });
  assert.notEqual(third, first);
  assert.deepEqual(third.activeAt(5).map((e) => e.id), []);

  // And the original pair still resolves to a live entity afterwards.
  assert.deepEqual(buildActiveEntityIndex({ entities, tracks }).activeAt(5).map((e) => e.id), ['a']);
});

test('computeActiveEntitiesAtTime accepts a precomputed index for the same project', () => {
  const tracks = [{ id: 't0', visible: true, locked: false }];
  const entities = [
    { id: 'a', trackId: 't0', startTime: 0, duration: 2, active: true, components: [] },
    { id: 'b', trackId: 't0', startTime: 1, duration: 2, active: true, components: [] },
  ];
  const index = buildActiveEntityIndex({ entities, tracks });

  for (const time of [0, 0.5, 1, 1.5, 2, 2.5, 3]) {
    assert.deepEqual(
      computeActiveEntitiesAtTime({ entities, tracks, time, index }).map((i) => i.entity.id),
      computeActiveEntitiesAtTime({ entities, tracks, time }).map((i) => i.entity.id),
      `t=${time}`
    );
  }

  // An index for a DIFFERENT entities array must be ignored, not trusted.
  const otherEntities = entities.map((e) => ({ ...e }));
  assert.deepEqual(
    computeActiveEntitiesAtTime({ entities: otherEntities, tracks, time: 1, index }).map((i) => i.entity.id),
    ['a', 'b']
  );
});
