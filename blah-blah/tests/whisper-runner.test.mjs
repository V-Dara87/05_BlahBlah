import test from 'node:test';
import assert from 'node:assert/strict';
import { isWhisperAvailable, getWhisperVersion, runWhisper } from '../src/services/whisperRunner.js';
import { generateSubtitlesFromEntity } from '../src/engine/subtitleAutoGenerate.js';

test('whisperRunner - degrades gracefully when not in Tauri environment', async () => {
  const available = await isWhisperAvailable();
  assert.equal(available, false);

  await assert.rejects(
    async () => {
      await getWhisperVersion();
    },
    {
      name: 'Error',
      message: /Tauri desktop app/,
    }
  );

  await assert.rejects(
    async () => {
      await runWhisper('test.wav', 'model.bin');
    },
    {
      name: 'Error',
      message: /Tauri desktop app/,
    }
  );
});

test('subtitleAutoGenerate - rejects when media source cannot be resolved', async () => {
  await assert.rejects(
    async () => {
      await generateSubtitlesFromEntity({
        entity: { name: 'Empty Clip', components: [] },
      });
    },
    {
      name: 'Error',
      message: /Could not find media source file/,
    }
  );
});

test('subtitleAutoGenerate - rejects when model is not installed', async () => {
  await assert.rejects(
    async () => {
      await generateSubtitlesFromEntity({
        entity: { name: 'Video Clip', filePath: 'C:/sample.mp4' },
        modelId: 'whisper-uninstalled-model',
      });
    },
    (err) => {
      assert.equal(err.code, 'MODEL_NOT_INSTALLED');
      return true;
    }
  );
});
