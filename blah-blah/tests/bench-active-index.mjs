/**
 * Micro-benchmark for the playback perf fix (renderPipeline.js).
 *
 * Measures the CPU-side cost of "which entities are active at this frame" on a
 * large synthetic project, the old way (rebuild Maps + full-array filter with a
 * parent-chain walk on every call — what the preview did 60x/sec) versus the
 * indexed way (build once, binary-search + short walk per frame).
 *
 * This is a pure-function benchmark: it does NOT include React/DOM/canvas work,
 * so it is a lower bound on the win, not an in-app frame time. Run it with
 *
 *   npm run bench:index
 *
 * Node has a live JIT here, so treat the numbers as order-of-magnitude only —
 * they move with warmup. The point is the ratio, which holds regardless.
 */
import { buildActiveEntityIndex } from '../src/engine/renderPipeline.js';
import { isTransitionClipEntity } from '../src/engine/ecs.js';

const CLIP_COUNT = Number(process.env.BENCH_CLIPS || 3000);
const DURATION_SEC = 3600;
const FRAMES = Number(process.env.BENCH_FRAMES || 600);
const FPS = 60;

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

/** A one-hour project: many clips across several tracks, plus parented audio. */
function makeProject() {
  const rng = makeRng(7);
  const tracks = [];
  for (let i = 0; i < 6; i++) tracks.push({ id: `t${i}`, visible: true, locked: false });

  const entities = [];
  for (let i = 0; i < CLIP_COUNT; i++) {
    const trackId = tracks[i % tracks.length].id;
    const startTime = Math.round(rng() * DURATION_SEC * 10) / 10;
    const duration = Math.round((1 + rng() * 20) * 10) / 10;
    entities.push({
      id: `go-video-${i}`,
      name: `clip ${i}`,
      trackId,
      startTime,
      duration,
      active: true,
      components: [{ type: 'Transform' }],
    });
    // Every 4th clip has an audio child parented to it — this is what made the
    // old per-call walk traverse a parent chain for each of thousands of clips.
    if (i % 4 === 0) {
      entities.push({
        id: `go-audio-${i}`,
        name: `clip ${i} audio`,
        trackId,
        startTime,
        duration,
        active: true,
        parentId: `go-video-${i}`,
        components: [{ type: 'AudioSource' }],
      });
    }
  }
  return { entities, tracks };
}

/** The OLD implementation, verbatim, as the "before" side. */
function oldActiveEntities({ entities, tracks, time }) {
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
      if (visited.has(curr.id)) break;
      visited.add(curr.id);
      if (!isSelfActive(curr)) return false;
      if (!curr.parentId) break;
      curr = entityMap.get(curr.parentId);
      if (!curr) break;
    }
    return true;
  };

  return entities.filter((e) => !isTransitionClipEntity(e) && isEntityVisible(e));
}

const { entities, tracks } = makeProject();
const playbackTimes = Array.from({ length: FRAMES }, (_, i) => (i / FPS) * (DURATION_SEC / FRAMES));
const scrubTimes = Array.from({ length: FRAMES }, () => Math.round(makeRng(99)() * DURATION_SEC * 10) / 10);

function time(label, fn) {
  fn(); // warmup
  const t0 = process.hrtime.bigint();
  fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${label}: ${ms.toFixed(1)} ms total, ${(ms / FRAMES).toFixed(3)} ms/call`);
  return ms;
}

console.log(
  `Project: ${entities.length} entities (${CLIP_COUNT} video clips + parented audio), ${tracks.length} tracks, ${DURATION_SEC}s`
);
console.log(`Frames measured: ${FRAMES}\n`);

const oldPlayback = time('BEFORE  linear playback  (old: rebuild maps + filter every call)', () => {
  for (const t of playbackTimes) oldActiveEntities({ entities, tracks, time: t });
});
const oldScrub = time('BEFORE  random scrubbing (old)', () => {
  for (const t of scrubTimes) oldActiveEntities({ entities, tracks, time: t });
});

const buildStart = process.hrtime.bigint();
const index = buildActiveEntityIndex({ entities, tracks });
console.log(`\nIndex build (one-off, per project change): ${(Number(process.hrtime.bigint() - buildStart) / 1e6).toFixed(1)} ms`);

const newPlayback = time('AFTER   linear playback  (new: memoized index + binary search)', () => {
  for (const t of playbackTimes) index.activeAt(t);
});
const newScrub = time('AFTER   random scrubbing (new)', () => {
  for (const t of scrubTimes) index.activeAt(t);
});

console.log(
  `\nPlayback speedup: ${(oldPlayback / Math.max(newPlayback, 1e-6)).toFixed(1)}x   Scrub speedup: ${(oldScrub / Math.max(newScrub, 1e-6)).toFixed(1)}x`
);
console.log(
  `Playback cost per frame: ${(oldPlayback / FRAMES).toFixed(3)} ms -> ${(newPlayback / FRAMES).toFixed(3)} ms (budget at 60fps: 16.7 ms)`
);
