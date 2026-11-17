import { performance } from 'node:perf_hooks';
import { computeTrackLanes } from '../src/utils/timelineLayout.js';
import { buildTimelineScene } from '../src/utils/timelineScene.js';
import { drawTimelineScene } from '../src/components/Timeline/canvas/drawTimeline.js';
import { buildActiveEntityIndex } from '../src/engine/renderPipeline.js';

function makeRng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mockContext() {
  const noop = () => {};
  return {
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    rect: noop,
    roundRect: noop,
    clip: noop,
    translate: noop,
    setTransform: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    stroke: noop,
    fill: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    fillText: noop,
    measureText: (str) => ({ width: (str?.length || 0) * 8 }),
    setLineDash: noop,
    getLineDash: () => [],
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '12px sans-serif',
    globalAlpha: 1,
  };
}

function generateProject(clipCount, trackCount, durationSec = 3600) {
  const rng = makeRng(clipCount);
  const tracks = [];
  for (let i = 0; i < trackCount; i++) {
    tracks.push({
      id: `t${i}`,
      name: `Track ${i + 1}`,
      type: i % 2 === 0 ? 'video' : 'audio',
      parentTrackId: null,
      height: 128,
      visible: true,
      locked: false,
    });
  }

  const clips = [];
  for (let i = 0; i < clipCount; i++) {
    const track = tracks[i % tracks.length];
    const startTime = Math.round(rng() * (durationSec - 30) * 10) / 10;
    const duration = Math.round((2 + rng() * 15) * 10) / 10;
    clips.push({
      id: `clip-${i}`,
      name: `Clip ${i}`,
      trackId: track.id,
      startTime,
      duration,
      type: track.type,
      active: true,
      parentId: null,
      components: [
        { type: 'Transform', x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      ],
      keyframes: {},
    });
  }

  return { tracks, clips, durationSec };
}

function bench(name, iterations, fn) {
  // Warmup
  for (let i = 0; i < Math.min(iterations, 20); i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const total = performance.now() - start;
  const avg = total / iterations;
  return { name, iterations, totalMs: total, avgMs: avg };
}

console.log('='.repeat(78));
console.log('          BLAHBLAH TIMELINE COMPREHENSIVE OVERHEAD BENCHMARK');
console.log('='.repeat(78));

const scales = [
  { label: 'Normal Project', clips: 100, tracks: 4 },
  { label: 'Large Project', clips: 1000, tracks: 8 },
  { label: 'Heavy/Stress Project', clips: 5000, tracks: 16 },
];

for (const scale of scales) {
  console.log(`\n▶ [${scale.label}] - ${scale.clips} clips across ${scale.tracks} tracks:`);
  const project = generateProject(scale.clips, scale.tracks);

  // 1. computeTrackLanes
  const rLanes = bench('1. computeTrackLanes (Layout)', 500, () => {
    computeTrackLanes(project.tracks, project.clips);
  });

  // 2. buildTimelineScene (Scene geometry & hit-test bounds)
  const pps = 40; // 40 px / sec
  const rScene = bench('2. buildTimelineScene (Geometry Cache)', 200, () => {
    buildTimelineScene({
      tracks: project.tracks,
      clips: project.clips,
      pixelsPerSecond: pps,
      defaultTrackHeight: 128,
    });
  });

  // Prepare a scene for hit testing & drawing
  const scene = buildTimelineScene({
    tracks: project.tracks,
    clips: project.clips,
    pixelsPerSecond: pps,
    defaultTrackHeight: 128,
  });

  // 3. Hit testing (Cursor hover / click resolution)
  const rHit = bench('3. scene.hitTest (Mouse hover / click)', 10000, () => {
    scene.hitTest(1200, 150);
  });

  // 4. Lasso / Rect selection query
  const rRect = bench('4. scene.itemsInRect (Lasso box selection)', 2000, () => {
    scene.itemsInRect({ x: 500, y: 50, width: 400, height: 200 });
  });

  // 5. Canvas Drawing overhead (60fps render loop with mock context)
  const ctx = mockContext();
  const view = { scrollLeft: 800, scrollTop: 0, width: 1920, height: 800 };
  const state = {
    currentTime: 25.0,
    selectedIds: new Set(['clip-1', 'clip-5']),
    selectionBox: null,
    dragState: null,
    isRecording: false,
    exportRange: null,
  };

  const rDraw = bench('5. drawTimelineScene (Canvas Draw Call Overhead)', 200, () => {
    drawTimelineScene(ctx, {
      scene,
      view,
      state,
    });
  });

  // 6. Active Entity Lookup (renderPipeline per-frame playback)
  const activeIndex = buildActiveEntityIndex({ entities: project.clips, tracks: project.tracks });
  const rPlayback = bench('6. activeIndex.activeAt (Playback 60fps)', 10000, () => {
    activeIndex.activeAt(25.4);
  });

  const results = [rLanes, rScene, rHit, rRect, rDraw, rPlayback];
  for (const r of results) {
    const budgetPct = (r.avgMs / 16.667 * 100).toFixed(2);
    const speed = r.avgMs < 0.001 
      ? `${(r.avgMs * 1000).toFixed(1)} µs` 
      : `${r.avgMs.toFixed(3)} ms`;
    console.log(`  - ${r.name.padEnd(46)} : ${speed.padStart(10)} / call  (60fps budget: ${budgetPct.padStart(6)}%)`);
  }
}

console.log('\n' + '='.repeat(78));
