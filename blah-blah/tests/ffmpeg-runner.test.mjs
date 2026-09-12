import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFfmpegAvailable,
  getFfmpegVersion,
  runFfmpeg,
} from '../src/services/ffmpegRunner.js';

test('ffmpegRunner - non-Tauri browser fallback behavior', async (t) => {
  // Ensure we start with a clean non-Tauri environment
  delete globalThis.isTauri;
  delete globalThis.window;

  await t.test('isFfmpegAvailable returns false in non-Tauri environment without throwing', async () => {
    const available = await isFfmpegAvailable();
    assert.strictEqual(available, false);
  });

  await t.test('getFfmpegVersion throws descriptive error in non-Tauri environment', async () => {
    await assert.rejects(
      async () => {
        await getFfmpegVersion();
      },
      {
        name: 'Error',
        message: /only supported.*Tauri desktop app/i,
      }
    );
  });

  await t.test('runFfmpeg throws descriptive error in non-Tauri environment', async () => {
    await assert.rejects(
      async () => {
        await runFfmpeg(['-version']);
      },
      {
        name: 'Error',
        message: /only supported.*Tauri desktop app/i,
      }
    );
  });
});

test('ffmpegRunner - simulated Tauri IPC behavior', async (t) => {
  const mockCalls = [];
  const eventListeners = new Map();

  // Setup mock Tauri environment
  globalThis.isTauri = true;
  globalThis.window = {
    isTauri: true,
    __TAURI_INTERNALS__: {
      invoke: async (cmd, args) => {
        mockCalls.push({ cmd, args });
        if (cmd === 'ffmpeg_version') {
          return 'ffmpeg version 7.1-static https://johnvansickle.com/ffmpeg/';
        }
        if (cmd === 'run_ffmpeg') {
          // Simulate progress emission if listener exists
          const listener = eventListeners.get('ffmpeg-progress');
          if (listener) {
            listener({
              payload: {
                session_id: args.sessionId,
                line: 'frame=100',
                key: 'frame',
                value: '100',
              },
            });
            listener({
              payload: {
                session_id: args.sessionId,
                line: 'progress=end',
                key: 'progress',
                value: 'end',
              },
            });
          }
          return 'Complete output';
        }
        throw new Error(`Unknown mock command: ${cmd}`);
      },
      plugins: {},
    },
    __TAURI_EVENT_LISTENERS__: eventListeners,
  };

  await t.test('getFfmpegVersion returns the version string from Tauri backend', async () => {
    mockCalls.length = 0;
    const version = await getFfmpegVersion();
    assert.match(version, /^ffmpeg version 7\.1/);
    assert.strictEqual(mockCalls[0].cmd, 'ffmpeg_version');
  });

  await t.test('isFfmpegAvailable returns true when backend responds', async () => {
    const available = await isFfmpegAvailable();
    assert.strictEqual(available, true);
  });

  await t.test('runFfmpeg rejects non-array arguments', async () => {
    await assert.rejects(
      async () => {
        await runFfmpeg('invalid args');
      },
      {
        name: 'TypeError',
        message: /must be an array of strings/i,
      }
    );
  });

  await t.test('runFfmpeg executes command and passes args correctly', async () => {
    mockCalls.length = 0;
    const output = await runFfmpeg(['-i', 'input.mp4', '-f', 'null', '-']);
    assert.strictEqual(output, 'Complete output');
    assert.strictEqual(mockCalls[0].cmd, 'run_ffmpeg');
    assert.deepStrictEqual(mockCalls[0].args.args, ['-i', 'input.mp4', '-f', 'null', '-']);
    assert.ok(mockCalls[0].args.sessionId.startsWith('ffmpeg-'));
  });

  await t.test('backend error handling in getFfmpegVersion and isFfmpegAvailable', async () => {
    // Override invoke to simulate missing sidecar binary
    globalThis.window.__TAURI_INTERNALS__.invoke = async () => {
      throw 'Failed to execute ffmpeg sidecar: executable not found';
    };

    const available = await isFfmpegAvailable();
    assert.strictEqual(available, false);

    await assert.rejects(
      async () => {
        await getFfmpegVersion();
      },
      {
        name: 'Error',
        message: /Failed to check FFmpeg version.*executable not found/i,
      }
    );
  });

  // Cleanup mocks
  delete globalThis.isTauri;
  delete globalThis.window;
});
