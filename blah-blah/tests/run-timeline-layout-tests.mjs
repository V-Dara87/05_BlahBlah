/**
 * Node test harness for the flat-tracks timeline geometry
 * (utils/timelineLayout.js).
 *
 * Usage: `node tests/run-timeline-layout-tests.mjs`
 */
import assert from 'node:assert/strict';

const {
  TRACK_HEIGHT,
  computeTrackLanes,
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

const baseTracks = [
  { id: 't1', name: 'Track 1', parentTrackId: null },
  { id: 't2', name: 'Track 2', parentTrackId: null },
];

const clip = (id, trackId, startTime = 0, duration = 5) => ({
  id,
  trackId,
  startTime,
  duration,
});

// ── basics ──────────────────────────────────────────────────────────────────

await test('flat tracks: each track produces 1 row of TRACK_HEIGHT', () => {
  const rows = computeTrackLanes(baseTracks, [], {});
  assert.equal(rows.length, 2);
  assert.equal(rows[0].track.id, 't1');
  assert.equal(rows[0].depth, 0);
  assert.equal(rows[0].rowHeight, TRACK_HEIGHT);
  assert.equal(rows[1].track.id, 't2');
  assert.equal(rows[1].depth, 0);
});

await test('multiple clips comfortably coexist on the same track row', () => {
  const clips = [
    clip('c1', 't1', 0, 5),
    clip('c2', 't1', 6, 4),
    clip('c3', 't1', 11, 3),
  ];
  const rows = computeTrackLanes(baseTracks, clips, {});
  assert.equal(rows[0].clips.length, 3);
  assert.deepEqual(rows[0].clips.map((c) => c.id), ['c1', 'c2', 'c3']);
});

// ── flat tracks: parentTrackId is ignored (no sub-track hierarchy) ─────────

await test('tracks with parentTrackId are still rendered as flat rows (depth=0)', () => {
  const tracksWithParent = [
    { id: 't1', name: 'Track 1', parentTrackId: null },
    { id: 't1-sub1', name: 'Sub 1', parentTrackId: 't1' },
    { id: 't1-sub2', name: 'Sub 2', parentTrackId: 't1' },
    { id: 't2', name: 'Track 2', parentTrackId: null },
  ];
  const rows = computeTrackLanes(tracksWithParent, [], {});
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.depth === 0), 'all rows must have depth=0 (flat)');
  assert.deepEqual(rows.map((r) => r.track.id), ['t1', 't1-sub1', 't1-sub2', 't2']);
});

await test('clips on different tracks appear in their respective rows', () => {
  const tracks = [
    { id: 't1', name: 'Track 1', parentTrackId: null },
    { id: 't2', name: 'Track 2', parentTrackId: null },
  ];
  const clips = [
    clip('c1', 't1', 2, 6),
    clip('c2', 't2', 2, 6),
  ];
  const rows = computeTrackLanes(tracks, clips, {});
  assert.equal(rows[0].clips[0].id, 'c1');
  assert.equal(rows[1].clips[0].id, 'c2');
});

await test('no sub-track auto-synthesis: multiple clips on same track remain on same row', () => {
  const tracks = [{ id: 't1', name: 'Track 1', parentTrackId: null }];
  const clips = [
    clip('video', 't1', 0, 10),
    clip('audio', 't1', 0, 10),
  ];
  const rows = computeTrackLanes(tracks, clips, {});
  assert.equal(rows.length, 1, 'no auto-synthesized sub-track');
  assert.equal(rows[0].clips.length, 2, 'both clips on same row');
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