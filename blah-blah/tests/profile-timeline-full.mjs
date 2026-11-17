import { performance } from 'node:perf_hooks';
import v8 from 'node:v8';
import fs from 'node:fs';
import path from 'node:path';
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

function createGpuMockContext() {
  const stats = {
    drawCalls: 0,
    rectFills: 0,
    rectStrokes: 0,
    pathCurves: 0,
    clipsPushed: 0,
    textDraws: 0,
    totalDrawnAreaPx: 0,
  };

  const noop = () => {};
  return {
    stats,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    rect: (x, y, w, h) => {
      stats.drawCalls++;
    },
    roundRect: noop,
    clip: () => {
      stats.clipsPushed++;
    },
    translate: noop,
    setTransform: noop,
    clearRect: noop,
    fillRect: (x, y, w, h) => {
      stats.drawCalls++;
      stats.rectFills++;
      stats.totalDrawnAreaPx += Math.abs((w || 0) * (h || 0));
    },
    strokeRect: (x, y, w, h) => {
      stats.drawCalls++;
      stats.rectStrokes++;
    },
    stroke: () => {
      stats.drawCalls++;
    },
    fill: () => {
      stats.drawCalls++;
    },
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: () => {
      stats.pathCurves++;
    },
    arc: noop,
    fillText: (text, x, y) => {
      stats.drawCalls++;
      stats.textDraws++;
    },
    measureText: (str) => ({ width: (str?.length || 0) * 7 }),
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

function forceGC() {
  if (global.gc) {
    global.gc();
  }
}

async function profileTimeline() {
  const report = {
    timestamp: new Date().toISOString(),
    system: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      v8Version: process.versions.v8,
    },
    scales: {},
  };

  const testCases = [
    { name: 'Normal', clips: 100, tracks: 4 },
    { name: 'Large', clips: 1000, tracks: 8 },
    { name: 'HeavyStress', clips: 5000, tracks: 16 },
  ];

  for (const tc of testCases) {
    forceGC();
    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    const t0 = performance.now();

    const project = generateProject(tc.clips, tc.tracks);

    // 1. Layout
    const tLayout0 = performance.now();
    const lanes = computeTrackLanes(project.tracks, project.clips);
    const layoutDurationMs = performance.now() - tLayout0;

    // 2. Scene Geometry & Spatial Cache
    const tScene0 = performance.now();
    const scene = buildTimelineScene({
      tracks: project.tracks,
      clips: project.clips,
      pixelsPerSecond: 40,
      defaultTrackHeight: 128,
    });
    const sceneDurationMs = performance.now() - tScene0;

    // 3. Playback resolution over 600 frames (10 seconds at 60fps)
    const activeIndex = buildActiveEntityIndex({ entities: project.clips, tracks: project.tracks });
    const frames = 600;
    const tPlay0 = performance.now();
    for (let f = 0; f < frames; f++) {
      const time = (f / 60);
      activeIndex.activeAt(time);
    }
    const playbackTotalMs = performance.now() - tPlay0;
    const playbackAvgMsPerFrame = playbackTotalMs / frames;

    // 4. Hit Testing & Lasso
    const tQuery0 = performance.now();
    for (let q = 0; q < 500; q++) {
      scene.hitTest(1200 + q, 150);
      scene.itemsInRect({ x: 100 + q, y: 50, x1: 500 + q, y1: 250 });
    }
    const queryDurationMs = performance.now() - tQuery0;

    // 5. Canvas Drawing (GPU / Render Pipeline)
    const ctx = createGpuMockContext();
    const view = { scrollLeft: 800, scrollTop: 0, width: 1920, height: 800 };
    const state = {
      currentTime: 25.0,
      selectedIds: new Set(['clip-1', 'clip-5']),
      selectionBox: null,
      dragState: null,
      isRecording: false,
      exportRange: null,
    };

    const tDraw0 = performance.now();
    // Simulate 60 frame draws
    const drawFrames = 60;
    for (let d = 0; d < drawFrames; d++) {
      drawTimelineScene(ctx, { scene, view, state });
    }
    const drawTotalMs = performance.now() - tDraw0;
    const drawAvgMsPerFrame = drawTotalMs / drawFrames;

    // Measurements end
    const tTotal = performance.now() - t0;
    const cpuAfter = process.cpuUsage(cpuBefore);
    const memAfter = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();

    // GPU pipeline stats (normalized per frame)
    const gpuStats = {
      drawCallsPerFrame: Math.round(ctx.stats.drawCalls / drawFrames),
      rectFillsPerFrame: Math.round(ctx.stats.rectFills / drawFrames),
      pathCurvesPerFrame: Math.round(ctx.stats.pathCurves / drawFrames),
      textDrawsPerFrame: Math.round(ctx.stats.textDraws / drawFrames),
      renderedAreaMpxPerFrame: (ctx.stats.totalDrawnAreaPx / drawFrames / 1e6).toFixed(3),
      viewportCullingRate: ((1 - (scene.itemsInRange(800 / 40, (800 + 1920) / 40).length / tc.clips)) * 100).toFixed(1) + '%',
    };

    const scaleReport = {
      config: { clips: tc.clips, tracks: tc.tracks, durationSec: 3600 },
      cpu: {
        totalExecutionWallTimeMs: tTotal.toFixed(2),
        userCpuTimeMs: (cpuAfter.user / 1000).toFixed(2),
        systemCpuTimeMs: (cpuAfter.system / 1000).toFixed(2),
        layoutMs: layoutDurationMs.toFixed(3),
        sceneBuildMs: sceneDurationMs.toFixed(3),
        playbackPerFrameMs: playbackAvgMsPerFrame.toFixed(4),
        playbackFpsPotential: Math.round(1000 / (playbackAvgMsPerFrame + drawAvgMsPerFrame)),
        canvasDrawPerFrameMs: drawAvgMsPerFrame.toFixed(4),
        percentOf60FpsBudget: (((playbackAvgMsPerFrame + drawAvgMsPerFrame) / 16.667) * 100).toFixed(2) + '%',
      },
      ram: {
        heapUsedBeforeMB: (memBefore.heapUsed / 1024 / 1024).toFixed(2),
        heapUsedAfterMB: (memAfter.heapUsed / 1024 / 1024).toFixed(2),
        heapDeltaMB: ((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2),
        bytesPerClip: Math.round(Math.max(0, memAfter.heapUsed - memBefore.heapUsed) / tc.clips),
        rssMB: (memAfter.rss / 1024 / 1024).toFixed(2),
        heapLimitMB: (heapStats.heap_size_limit / 1024 / 1024).toFixed(2),
      },
      gpuPipeline: gpuStats,
    };

    report.scales[tc.name] = scaleReport;
  }

  const outPath = path.resolve(process.cwd(), 'tests/timeline-profile-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(JSON.stringify(report, null, 2));
}

profileTimeline();
