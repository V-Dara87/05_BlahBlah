/**
 * Node test harness for the parent-child transform hierarchy
 * (engine/renderPipeline.js world/local composition + parent gating).
 *
 * RenderPipeline is Node-importable (its scriptRunner import falls back to
 * memory/Node-safe paths — see tests/run-bundler-tests.mjs), so these run
 * without a browser, same as the bundler suite.
 *
 * Usage: `node tests/run-hierarchy-tests.mjs` (npm run test:hierarchy)
 */
import assert from 'node:assert/strict';

const {
  computeActiveEntitiesAtTime,
  composeWorldTransform,
  localTransformFromWorld,
  staticWorldTransform,
} = await import('../src/engine/renderPipeline.js');
const {
  collectDescendantIds,
  filterOutSubtrees,
  isDescendantOf,
  getEntityDepth,
} = await import('../src/engine/ecs.js');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.error(`  ✗ ${name}`);
    console.error(`    ${err?.message || err}`);
  }
}

const TRACKS = [
  { id: 't1', name: 'Track 1', type: 'layer', muted: false, locked: false, visible: true, volume: 1 },
  { id: 't2', name: 'Track 2', type: 'layer', muted: false, locked: false, visible: true, volume: 1 },
];

function go(id, { parentId = null, trackId = 't1', startTime = 0, duration = 10, x = 0, y = 0, rotation = 0, scaleX = 1, scaleY = 1, opacity = 1, speed } = {}) {
  const transform = { type: 'Transform', x, y, rotation, scaleX, scaleY, opacity, ...(speed !== undefined ? { speed } : {}) };
  return {
    id,
    name: id,
    active: true,
    trackId,
    startTime,
    duration,
    type: 'shape',
    parentId,
    components: [transform, { type: 'ShapeRenderer', shapeType: 'rect', width: 100, height: 100 }],
  };
}

function activeAt(entities, time) {
  const items = computeActiveEntitiesAtTime({ entities, tracks: TRACKS, scripts: [], time });
  return Object.fromEntries(items.map((i) => [i.entity.id, i]));
}

console.log('\nparent-child transform hierarchy tests\n');

// ─── composeWorldTransform / localTransformFromWorld math ───────────────────

await test('unparented entity: world transform equals local transform', () => {
  const e = go('a', { x: 40, y: -20, rotation: 15, scaleX: 2 });
  const at = activeAt([e], 3);
  assert.ok(at.a, 'entity should be active');
  assert.equal(at.a.transform.x, 40);
  assert.equal(at.a.transform.y, -20);
  assert.equal(at.a.transform.rotation, 15);
  assert.equal(at.a.transform.scaleX, 2);
  assert.equal(at.a.depth, 0);
  assert.deepEqual(at.a.localTransform, at.a.transform);
});

await test('simple child offset: world = parent pos + local offset', () => {
  const parent = go('p', { x: 100, y: 50 });
  const child = go('c', { parentId: 'p', x: 10, y: 5 });
  const at = activeAt([parent, child], 1);
  assert.equal(at.p.transform.x, 100);
  assert.equal(at.c.transform.x, 110, 'child world x = parent x + local x');
  assert.equal(at.c.transform.y, 55);
  assert.equal(at.c.transform.rotation, 0);
  assert.equal(at.c.depth, 1);
});

await test('parent rotation rotates the child offset (90°)', () => {
  const parent = go('p', { rotation: 90 });
  const child = go('c', { parentId: 'p', x: 10, y: 0 });
  const at = activeAt([parent, child], 1);
  assert.ok(Math.abs(at.c.transform.x - 0) < 1e-9, `expected x≈0, got ${at.c.transform.x}`);
  assert.ok(Math.abs(at.c.transform.y - 10) < 1e-9, `expected y≈10, got ${at.c.transform.y}`);
  assert.equal(at.c.transform.rotation, 90);
});

await test('parent scale scales the child offset', () => {
  const parent = go('p', { scaleX: 2, scaleY: 3 });
  const child = go('c', { parentId: 'p', x: 10, y: 5 });
  const at = activeAt([parent, child], 1);
  assert.equal(at.c.transform.x, 20);
  assert.equal(at.c.transform.y, 15);
  assert.equal(at.c.transform.scaleX, 2);
  assert.equal(at.c.transform.scaleY, 3);
});

await test('opacity multiplies down the chain', () => {
  const parent = go('p', { opacity: 0.5 });
  const child = go('c', { parentId: 'p', opacity: 0.5 });
  const at = activeAt([parent, child], 1);
  assert.equal(at.c.transform.opacity, 0.25);
});

await test('world speed carries the CHILD own clip speed, never the parent s', () => {
  const parent = go('p', { speed: 3 });
  const child = go('c', { parentId: 'p', speed: 2 });
  const at = activeAt([parent, child], 1);
  assert.equal(at.p.transform.speed, 3);
  assert.equal(at.c.transform.speed, 2, 'speed is per-clip, not composed');
});

await test('grandchild composes through two levels (rotation+offset)', () => {
  const root = go('root', { x: 0, y: 0 });
  const mid = go('mid', { parentId: 'root', x: 50, y: 0 });
  const leaf = go('leaf', { parentId: 'mid', x: 0, y: 25 });
  const at = activeAt([root, mid, leaf], 1);
  assert.equal(at.leaf.transform.x, 50, 'leaf world x = mid offset');
  assert.equal(at.leaf.transform.y, 25, 'leaf world y = mid 0 + leaf 25');
  assert.equal(at.leaf.depth, 2);
});

await test('compose is associative across rotations (matches pipeline)', () => {
  const parent = go('p', { x: 10, y: 20, rotation: 45 });
  const childLocal = { x: 30, y: -15, rotation: 30, scaleX: 1.5, scaleY: 0.5, opacity: 0.8 };
  const at = activeAt([parent, go('c', { parentId: 'p', ...childLocal, rotation: 30, scaleX: 1.5, scaleY: 0.5, opacity: 0.8 })], 1);
  const viaCompose = composeWorldTransform({ ...parent.components[0] }, childLocal);
  assert.equal(at.c.transform.x, viaCompose.x);
  assert.equal(at.c.transform.y, viaCompose.y);
  assert.equal(at.c.transform.rotation, 75);
});

await test('localTransformFromWorld inverts composeWorldTransform exactly', () => {
  const parent = { x: 100, y: 200, rotation: 30, scaleX: 2, scaleY: 0.5, opacity: 0.9 };
  const childWorld = composeWorldTransform(parent, { x: 12, y: -8, rotation: 15, scaleX: 1.2, scaleY: 1.4, opacity: 0.7 });
  const local = localTransformFromWorld(childWorld, parent);
  const roundTrip = composeWorldTransform(parent, local);
  for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity']) {
    assert.ok(Math.abs(roundTrip[key] - childWorld[key]) < 1e-9, `${key}: round-trip mismatch`);
  }
});

await test('identity parent leaves a transform unchanged (unparenting)', () => {
  const local = localTransformFromWorld({ x: 55, y: 66, rotation: 12, scaleX: 1.4, scaleY: 1.4, opacity: 0.9 }, null);
  assert.equal(local.x, 55);
  assert.equal(local.y, 66);
  assert.equal(local.rotation, 12);
});

// ─── Parent-gated visibility ────────────────────────────────────────────────

await test('child hidden while parent clip is not playing', () => {
  // Parent only plays 0..5; child clip window extends to 10.
  const parent = go('p', { duration: 5 });
  const child = go('c', { parentId: 'p', duration: 10 });
  const at = activeAt([parent, child], 2);
  assert.ok(at.p, 'parent visible inside its window');
  assert.ok(at.c, 'child visible while parent plays');
  const after = activeAt([parent, child], 7);
  assert.ok(!after.p, 'parent ended');
  assert.ok(!after.c, 'child is parent-gated and hidden once parent ends');
});

await test('child not returned before parent starts', () => {
  const parent = go('p', { startTime: 5, duration: 5 });
  const child = go('c', { parentId: 'p', startTime: 0, duration: 20 });
  const at = activeAt([parent, child], 2);
  assert.ok(!at.c, 'child hidden before parent starts');
  const during = activeAt([parent, child], 6);
  assert.ok(during.c, 'child visible with parent');
});

await test('child of an inactive (active:false) parent is hidden', () => {
  const parent = { ...go('p', {}), active: false };
  const child = go('c', { parentId: 'p' });
  const at = activeAt([parent, child], 2);
  assert.ok(!at.c, 'child must not render under a disabled parent');
});

await test('child of a locked/hidden parent track is hidden', () => {
  const parent = go('p', { trackId: 't2' });
  const child = go('c', { parentId: 'p', trackId: 't2' });
  const lockedTracks = TRACKS.map((t) => (t.id === 't2' ? { ...t, locked: true } : t));
  const at = computeActiveEntitiesAtTime({ entities: [parent, child], tracks: lockedTracks, scripts: [], time: 2 });
  assert.equal(at.length, 0, 'neither parent nor child visible on locked track');
});

await test('dangling parentId (deleted parent) falls back to standalone root', () => {
  const child = go('c', { parentId: 'gone', x: 77 });
  const at = activeAt([child], 2);
  assert.ok(at.c, 'orphan still renders');
  assert.equal(at.c.transform.x, 77, 'orphan uses its own transform as world');
});

await test('parent active but child window outside → only parent renders', () => {
  const parent = go('p', { duration: 10 });
  const child = go('c', { parentId: 'p', startTime: 4, duration: 2 });
  const at = activeAt([parent, child], 1);
  assert.ok(at.p);
  assert.ok(!at.c);
});

// ─── staticWorldTransform (Inspector preserve-position fallback) ────────────

await test('staticWorldTransform walks the chain without keyframes', () => {
  const parent = go('p', { x: 10, y: 10, rotation: 90 });
  const child = go('c', { parentId: 'p', x: 5, y: 0 });
  const world = staticWorldTransform(child, [parent, child]);
  assert.ok(Math.abs(world.x - 10) < 1e-9);
  assert.ok(Math.abs(world.y - 15) < 1e-9);
});

// ─── ecs hierarchy helpers ──────────────────────────────────────────────────

await test('collectDescendantIds gathers nested children in order', () => {
  const e = [go('r'), go('a', { parentId: 'r' }), go('b', { parentId: 'a' }), go('solo')];
  assert.deepEqual(collectDescendantIds(e, 'r'), ['a', 'b']);
  assert.deepEqual(collectDescendantIds(e, 'a'), ['b']);
  assert.deepEqual(collectDescendantIds(e, 'solo'), []);
});

await test('filterOutSubtrees removes a root and all descendants', () => {
  const e = [go('r'), go('a', { parentId: 'r' }), go('b', { parentId: 'a' }), go('solo', { parentId: 'a' }), go('other')];
  const next = filterOutSubtrees(e, ['r']);
  assert.deepEqual(next.map((x) => x.id), ['other']);
});

await test('filterOutSubtrees with multiple roots + child-only', () => {
  const e = [go('r'), go('a', { parentId: 'r' }), go('x'), go('y', { parentId: 'x' })];
  const next = filterOutSubtrees(e, ['r', 'x']);
  assert.deepEqual(next.map((x) => x.id), []);
  const childOnly = filterOutSubtrees([go('r'), go('a', { parentId: 'r' }), go('solo')], ['a']);
  assert.deepEqual(childOnly.map((x) => x.id), ['r', 'solo']);
});

await test('isDescendantOf / getEntityDepth / cycle guards', () => {
  const e = [go('r'), go('a', { parentId: 'r' }), go('b', { parentId: 'a' })];
  assert.equal(isDescendantOf(e, 'b', 'r'), true);
  assert.equal(isDescendantOf(e, 'r', 'b'), false);
  assert.equal(isDescendantOf(e, 'a', 'a'), false);
  assert.equal(getEntityDepth(e, 'b'), 2);
  assert.equal(getEntityDepth(e, 'r'), 0);
  // Hand-edited cycle must not hang or crash
  const cycle = [go('c1', { parentId: 'c2' }), go('c2', { parentId: 'c1' })];
  assert.equal(getEntityDepth(cycle, 'c1'), 1);
  const at = activeAt(cycle, 1);
  assert.ok(at.c1 || at.c2, 'cyclic entities still resolve without hanging');
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const { name, err } of failures) {
    console.error(`  - ${name}: ${err?.message || err}`);
  }
  process.exit(1);
}
process.exit(0);
