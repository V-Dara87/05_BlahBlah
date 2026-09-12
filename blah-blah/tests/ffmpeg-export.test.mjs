import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FFMPEG_FORMATS,
  FFMPEG_QUALITY_PRESETS,
  buildFfmpegExportArgs,
  executeFfmpegExport,
} from '../src/services/ffmpegExportRunner.js';

test('ffmpegExportRunner - constants & configurations', async (t) => {
  await t.test('defines all supported formats', () => {
    assert.ok(FFMPEG_FORMATS.mp4_h264);
    assert.strictEqual(FFMPEG_FORMATS.mp4_h264.extension, 'mp4');
    assert.ok(FFMPEG_FORMATS.mp4_hevc);
    assert.strictEqual(FFMPEG_FORMATS.mp4_hevc.extension, 'mp4');
    assert.ok(FFMPEG_FORMATS.webm_vp9);
    assert.strictEqual(FFMPEG_FORMATS.webm_vp9.extension, 'webm');
    assert.ok(FFMPEG_FORMATS.mov_prores);
    assert.strictEqual(FFMPEG_FORMATS.mov_prores.extension, 'mov');
    assert.ok(FFMPEG_FORMATS.gif);
    assert.strictEqual(FFMPEG_FORMATS.gif.extension, 'gif');
  });

  await t.test('defines quality presets with ordered CRF values', () => {
    const { ultra, high, standard } = FFMPEG_QUALITY_PRESETS;
    assert.ok(ultra.crf < high.crf, 'Ultra should have lower CRF (higher quality) than High');
    assert.ok(high.crf < standard.crf, 'High should have lower CRF than Standard');
    assert.strictEqual(ultra.preset, 'slow');
    assert.strictEqual(high.preset, 'medium');
    assert.strictEqual(standard.preset, 'fast');
  });
});

test('ffmpegExportRunner - buildFfmpegExportArgs validation', async (t) => {
  await t.test('throws when inputPath or outputPath is missing', () => {
    assert.throws(
      () => buildFfmpegExportArgs({ inputPath: '', outputPath: 'out.mp4' }),
      /Both inputPath and outputPath are required/
    );
    assert.throws(
      () => buildFfmpegExportArgs({ inputPath: 'in.mp4', outputPath: '' }),
      /Both inputPath and outputPath are required/
    );
  });

  await t.test('builds MP4 (H.264) export args with faststart and AAC', () => {
    const args = buildFfmpegExportArgs({
      inputPath: 'C:/temp/input.mp4',
      outputPath: 'C:/output/video.mp4',
      format: 'mp4_h264',
      quality: 'high',
    });

    assert.ok(args.includes('-i') && args.includes('C:/temp/input.mp4'));
    assert.ok(args.includes('-c:v') && args[args.indexOf('-c:v') + 1] === 'libx264');
    assert.ok(args.includes('-crf') && args[args.indexOf('-crf') + 1] === '23');
    assert.ok(args.includes('-preset') && args[args.indexOf('-preset') + 1] === 'medium');
    assert.ok(args.includes('-c:a') && args[args.indexOf('-c:a') + 1] === 'aac');
    assert.ok(args.includes('-b:a') && args[args.indexOf('-b:a') + 1] === '192k');
    assert.ok(args.includes('-movflags') && args[args.indexOf('-movflags') + 1] === '+faststart');
    assert.ok(args.includes('-progress') && args[args.indexOf('-progress') + 1] === 'pipe:1');
    assert.strictEqual(args[args.length - 1], 'C:/output/video.mp4');
  });

  await t.test('builds MP4 (HEVC / H.265) export args with hvc1 tag', () => {
    const args = buildFfmpegExportArgs({
      inputPath: 'C:/temp/input.mp4',
      outputPath: 'C:/output/video.mp4',
      format: 'mp4_hevc',
      quality: 'ultra',
    });

    assert.ok(args.includes('-c:v') && args[args.indexOf('-c:v') + 1] === 'libx265');
    // Ultra CRF 18 + 4 = 22
    assert.ok(args.includes('-crf') && args[args.indexOf('-crf') + 1] === '22');
    assert.ok(args.includes('-preset') && args[args.indexOf('-preset') + 1] === 'slow');
    assert.ok(args.includes('-tag:v') && args[args.indexOf('-tag:v') + 1] === 'hvc1');
    assert.ok(args.includes('-c:a') && args[args.indexOf('-c:a') + 1] === 'aac');
  });

  await t.test('builds WebM (VP9 + Opus) export args', () => {
    const args = buildFfmpegExportArgs({
      inputPath: 'C:/temp/input.mp4',
      outputPath: 'C:/output/video.webm',
      format: 'webm_vp9',
      quality: 'standard',
    });

    assert.ok(args.includes('-c:v') && args[args.indexOf('-c:v') + 1] === 'libvpx-vp9');
    assert.ok(args.includes('-c:a') && args[args.indexOf('-c:a') + 1] === 'libopus');
    assert.ok(args.includes('-b:v') && args[args.indexOf('-b:v') + 1] === '0');
  });

  await t.test('builds QuickTime (ProRes 422 HQ) export args', () => {
    const args = buildFfmpegExportArgs({
      inputPath: 'C:/temp/input.mp4',
      outputPath: 'C:/output/video.mov',
      format: 'mov_prores',
    });

    assert.ok(args.includes('-c:v') && args[args.indexOf('-c:v') + 1] === 'prores_ks');
    assert.ok(args.includes('-profile:v') && args[args.indexOf('-profile:v') + 1] === '3');
    assert.ok(args.includes('-pix_fmt') && args[args.indexOf('-pix_fmt') + 1] === 'yuv422p10le');
    assert.ok(args.includes('-c:a') && args[args.indexOf('-c:a') + 1] === 'pcm_s16le');
  });

  await t.test('builds Animated GIF with palette optimization and width scaling', () => {
    const args = buildFfmpegExportArgs({
      inputPath: 'C:/temp/input.mp4',
      outputPath: 'C:/output/anim.gif',
      format: 'gif',
      fps: 60, // Should be clamped to 24 max for GIF efficiency
      width: 640,
    });

    assert.ok(args.includes('-vf'));
    const vfIndex = args.indexOf('-vf');
    const filterString = args[vfIndex + 1];
    assert.ok(filterString.includes('fps=24'));
    assert.ok(filterString.includes('scale=640:-1:flags=lanczos'));
    assert.ok(filterString.includes('palettegen'));
    assert.ok(filterString.includes('paletteuse'));
  });
});

test('ffmpegExportRunner - executeFfmpegExport simulated execution & progress', async (t) => {
  const progressCallbacks = [];
  const invokedCommands = [];

  // Mock global Tauri environment with event listeners support
  globalThis.isTauri = true;
  globalThis.window = {
    isTauri: true,
    __TAURI_INTERNALS__: {
      transformCallback: (cb) => {
        progressCallbacks.push(cb);
        return progressCallbacks.length;
      },
      invoke: async (cmd, args) => {
        invokedCommands.push({ cmd, args });
        if (cmd === 'plugin:event|listen') {
          return 1;
        }
        if (cmd === 'plugin:event|unlisten') {
          return;
        }
        if (cmd === 'run_ffmpeg') {
          for (const cb of progressCallbacks) {
            cb({
              payload: {
                session_id: args.sessionId,
                key: 'frame',
                value: '60',
              },
            });
            cb({
              payload: {
                session_id: args.sessionId,
                key: 'speed',
                value: '2.5x',
              },
            });
            cb({
              payload: {
                session_id: args.sessionId,
                key: 'out_time_us',
                value: '2000000', // 2 seconds
              },
            });
            cb({
              payload: {
                session_id: args.sessionId,
                key: 'progress',
                value: 'end',
              },
            });
          }
          return 'Encoding complete';
        }
        throw new Error(`Unexpected command: ${cmd}`);
      },
      plugins: {},
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: {
      unregisterListener: () => {},
    },
  };

  await t.test('executes export and receives parsed progress updates', async () => {
    const progressEvents = [];

    const result = await executeFfmpegExport({
      inputPath: 'C:/temp/test.mp4',
      outputPath: 'C:/output/test.mp4',
      format: 'mp4_h264',
      quality: 'high',
      totalDurationSec: 4,
      onProgress: (p) => {
        progressEvents.push({ ...p });
      },
    });

    assert.strictEqual(result, 'Encoding complete');
    assert.ok(invokedCommands.some((c) => c.cmd === 'run_ffmpeg'));

    // Check that progress callbacks were received
    assert.ok(progressEvents.length >= 2);

    // Intermediate update at 2 seconds of a 4-second export (50%)
    const midProgress = progressEvents.find((p) => p.timeSec === 2);
    assert.ok(midProgress);
    assert.strictEqual(midProgress.frame, 60);
    assert.strictEqual(midProgress.speed, '2.5x');
    assert.strictEqual(midProgress.percent, 50);

    // Final update on progress=end
    const lastProgress = progressEvents[progressEvents.length - 1];
    assert.strictEqual(lastProgress.percent, 100);
  });

  // Clean up mocks
  delete globalThis.isTauri;
  delete globalThis.window;
});
