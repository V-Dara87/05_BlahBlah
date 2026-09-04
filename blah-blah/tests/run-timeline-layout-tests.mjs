/**
 * Node test harness for the nested sub-track timeline geometry
 * (utils/timelineLayout.js): every child clip gets its own lane row under
 * its parent ("more tracks inside a root track"), depth-first, with the
 * expand/collapse gate and dangling-parent fallback.
 *
 * Usage: `node tests/run-timeline-layout-tests.mjs`
 */
import assert from 'node:assert/strict';

const {
  TRACK_HEIGHT,
  SUB_LANE_HEIGHT,
  computeTrackLanes,
  sortChildrenOf,
} = await import('../src/utils/timelineLayout.js');

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

const tracks = [
  { id: 't1', name: 'Track 1' },
  { id: 't2', name: 'Track 2' },
];

const clip = (id, trackId, parentId = null, order) => ({ id, trackId, parentId, ...(order !== undefined ? { order } : {}) });

// ── basics ──────────────────────────────────────────────────────────────────

await test('empty track: 64px main lane, no sub-lanes', () => {
  const [row] = computeTrackLanes(tracks, [], {});
  assert.equal(row.rowHeight, TRACK_HEIGHT);
  assert.equal(row.subLaneRows.length, 0);
  assert.deepEqual(row.roots, []);
});

await test('flat root clip: main lane only', () => {
  const clips = [clip('a', 't1')];
  const [row] = computeTrackLanes(tracks, clips, {});
  assert.equal(row.rowHeight, TRACK_HEIGHT);
  assert.deepEqual(row.subLaneRows.map((r) => r.clip.id), []);
});

// ── one level of nesting ────────────────────────────────────────────────────

await test('one child = one extra 40px lane under its parent', () => {
  const clips = [clip('video', 't1'), clip('audio', 't1', 'video')];
  const [row] = computeTrackLanes(tracks, clips, {});
  assert.equal(row.rowHeight, TRACK_HEIGHT + SUB_LANE_HEIGHT);
  assert.equal(row.subLaneRows.length, 1);
  assert.equal(row.subLaneRows[0].clip.id, 'audio');
  assert.equal(row.subLaneRows[0].depth, 1);
  assert.equal(row.subLaneRows[0].parentClip.id, 'video');
});

await test('two children of one parent = two sibling lanes', () => {
  const clips = [
    clip('video', 't1'),
    clip('audio', 't1', 'video'),
    clip('subtitle', 't1', 'video'),
  ];
  const [row] = computeTrackLanes(tracks, clips, {});
  assert.equal(row.rowHeight, TRACK_HEIGHT + 2 * SUB_LANE_HEIGHT);
  assert.deepEqual(row.subLaneRows.map((r) => r.clip.id), ['audio', 'subtitle']);
});

// ── multi-level nesting ─────────────────────────────────────────────────────

await test('grandchild nests depth-first under its own child lane', () => {
  const clips = [
    clip('video', 't1'),
    clip('audio', 't1', 'video'),
    clip('eq', 't1', 'audio'), // child of the child
  ];
  const [row] = computeTrackLanes(tracks, clips, {});
  assert.equal(row.rowHeight, TRACK_HEIGHT + 2 * SUB_LANE_HEIGHT);
  assert.deepEqual(row.subLaneRows.map((r) => [r.clip.id, r.depth]), [
    ['audio', 1],
    ['eq', 2],
  ]);
});

await test('deep tree: B (A child) then C (B child) then D (A child)', () => {
  const clips = [
    clip('a', 't1'),
    clip('b', 't1', 'a'),
    clip('c', 't1', 'b'),
    clip('d', 't1', 'a'),
  ];
  const [row] = computeTrackLanes(tracks, clips, {});
  assert.equal(row.rowHeight, TRACK_HEIGHT + 3 * SUB_LANE_HEIGHT);
  assert.deepEqual(row.subLaneRows.map((r) => [r.clip.id, r.depth]), [
    ['b', 1],
    ['c', 2],
    ['d', 1],
  ]);
});

// ── per-track separation + dangling parents ────────────────────────────────

await test('children render in their parent track row regardless of trackId', () => {
  const clips = [clip('a', 't1'), clip('b', 't2', 'a')]; // b has its own trackId
  const rows = computeTrackLanes(tracks, clips, {});
  assert.equal(rows[0].subLaneRows.length, 1);
  assert.equal(rows[1].subLaneRows.length, 0);
});

await test('dangling parentId (deleted parent) falls back to a root', () => {
  const clips = [clip('orphan', 't1', 'gone')];
  const [row] = computeTrackLanes(tracks, clips, {});
  assert.deepEqual(row.roots.map((c) => c.id), ['orphan']);
  assert.deepEqual(row.nodes.map((n) => n.clip.id), ['orphan']);
  assert.equal(row.rowHeight, TRACK_HEIGHT);
});

// ── expand / collapse ───────────────────────────────────────────────────────

await test('collapsed track hides ALL child lanes but keeps 64px row', () => {
  const clips = [
    clip('a', 't1'),
    clip('b', 't1', 'a'),
    clip('c', 't1', 'b'),
  ];
  const [row] = computeTrackLanes(tracks, clips, { t1: true });
  assert.equal(row.expanded, false);
  assert.equal(row.rowHeight, TRACK_HEIGHT);
  // subLaneRows still describe the tree (layout consumers gate rendering on
  // `expanded`), but the row is one lane tall.
  assert.equal(row.subLaneRows.length, 2);
});

await test('collapse is per track: other tracks stay expanded', () => {
  const clips = [clip('a', 't1'), clip('b', 't1', 'a'), clip('x', 't2'), clip('y', 't2', 'x')];
  const rows = computeTrackLanes(tracks, clips, { t1: true });
  assert.equal(rows[0].rowHeight, TRACK_HEIGHT);
  assert.equal(rows[1].rowHeight, TRACK_HEIGHT + SUB_LANE_HEIGHT);
});

await test('expanded flag defaults true when track not in collapsed map', () => {
  const clips = [clip('a', 't1'), clip('b', 't1', 'a')];
  const [row] = computeTrackLanes(tracks, clips, {});
  assert.equal(row.expanded, true);
});

// ── lane rearrangement (child `order`) ─────────────────────────────────────

await test('sortChildrenOf orders by explicit `order` numbers', () => {
  const clips = [
    clip('a', 't1'),
    clip('c', 't1', 'a', 2),
    clip('b', 't1', 'a', 1),
    clip('d', 't1', 'a', 0),
  ];
  assert.deepEqual(sortChildrenOf(clips, 'a').map((c) => c.id), ['d', 'b', 'c']);
});

await test('sortChildrenOf is stable for ties (falls back to array order)', () => {
  const clips = [
    clip('a', 't1'),
    clip('x', 't1', 'a'),
    clip('y', 't1', 'a'),
    clip('z', 't1', 'a'),
  ];
  assert.deepEqual(sortChildrenOf(clips, 'a').map((c) => c.id), ['x', 'y', 'z']);
});

await test('lane row order follows child `order` after a rearrangement', () => {
  // a has children x (order 1) and y (order 0) — after reorder, y's lane
  // comes first, mirroring the store's handleReorderChild renumbering.
  const clips = [
    { ...clip('a', 't1'), id: 'a' },
    { ...clip('x', 't1', 'a'), order: 1 },
    { ...clip('y', 't1', 'a'), order: 0 },
  ];
  const [row] = computeTrackLanes(tracks, clips, {});
  assert.deepEqual(row.subLaneRows.map((r) => r.clip.id), ['y', 'x']);
});

// ── surface stacking (rows sum across tracks) ──────────────────────────────

await test('row heights stack across tracks', () => {
  const clips = [
    clip('a', 't1'),
    clip('b', 't1', 'a'),
    clip('x', 't2'),
    clip('y', 't2', 'x'),
    clip('z', 't2', 'y'),
  ];
  const rows = computeTrackLanes(tracks, clips, {});
  const total = rows.reduce((sum, r) => sum + r.rowHeight, 0);
  assert.equal(total, (TRACK_HEIGHT + SUB_LANE_HEIGHT) + (TRACK_HEIGHT + 2 * SUB_LANE_HEIGHT));
});

// ── summary ─────────────────────────────────────────────────────────────────

if (failed > 0) {
  console.error(`\n${failed} of ${passed + failed} timeline layout tests failed`);
  for (const { name, err } of failures) {
    console.error(`\n--- ${name} ---`);
    console.error(err?.stack || err);
  }
  process.exit(1);
}
console.log(`\n${passed} passed, 0 failed`);
