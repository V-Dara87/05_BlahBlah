import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { runCli } from '../src/cli.js';

test('CLI - End-to-end command execution', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blahblah-cli-test-'));

  try {
    // 1. project init
    await runCli(['project', 'init', 'My Cli Project', '--dir', tmpDir, '--res', '1080p']);
    const projectJsonPath = path.join(tmpDir, 'project.json');
    const projectContent = JSON.parse(await fs.readFile(projectJsonPath, 'utf8'));
    assert.equal(projectContent.name, 'My Cli Project');

    // 2. track add
    await runCli(['track', 'add', 'Graphics Track', '--dir', tmpDir]);
    const afterTrack = JSON.parse(await fs.readFile(projectJsonPath, 'utf8'));
    assert.equal(afterTrack.tracks.length, 5);

    // 3. clip add
    await runCli([
      'clip',
      'add',
      '--file',
      'media/sample.mp4',
      '--name',
      'Sample Video',
      '--track',
      'track-1',
      '--start',
      '0',
      '--duration',
      '6',
      '--dir',
      tmpDir,
    ]);
    const afterClip = JSON.parse(await fs.readFile(projectJsonPath, 'utf8'));
    assert.equal(afterClip.entities.length, 2);

    // 4. entity add
    await runCli([
      'entity',
      'add',
      '--name',
      'Subtitle Overlay',
      '--script',
      'SubtitleOverlay',
      '--track',
      'track-2',
      '--start',
      '1',
      '--duration',
      '4',
      '--props',
      '{"text":"AI Subtitle"}',
      '--dir',
      tmpDir,
    ]);
    const afterEntity = JSON.parse(await fs.readFile(projectJsonPath, 'utf8'));
    assert.equal(afterEntity.entities.length, 3);
    const subtitleEntity = afterEntity.entities[2];

    // 5. entity set-prop
    await runCli([
      'entity',
      'set-prop',
      '--id',
      subtitleEntity.id,
      '--prop',
      'text=Updated AI Subtitle',
      '--dir',
      tmpDir,
    ]);

    // 6. entity set-transform
    await runCli([
      'entity',
      'set-transform',
      '--id',
      subtitleEntity.id,
      '--y',
      '200',
      '--opacity',
      '0.8',
      '--dir',
      tmpDir,
    ]);

    // 7. keyframe add
    await runCli([
      'keyframe',
      'add',
      '--id',
      subtitleEntity.id,
      '--field',
      'y',
      '--time',
      '0',
      '--value',
      '400',
      '--ease',
      'easeInOut',
      '--dir',
      tmpDir,
    ]);

    // 8. script new
    await runCli(['script', 'new', 'Watermark', '--type', 'canvas', '--dir', tmpDir]);
    const scriptPath = path.join(tmpDir, 'scripts', 'Watermark.jsx');
    const scriptText = await fs.readFile(scriptPath, 'utf8');
    assert.ok(scriptText.includes('Watermark extends CanvasComponent'));

    // 9. script check
    await runCli(['script', 'check', 'scripts/Watermark.jsx', '--dir', tmpDir]);

    // 10. render frame to svg
    const outSvg = path.join(tmpDir, 'preview.svg');
    await runCli(['render', 'frame', '--time', '2.5', '--out', outSvg, '--dir', tmpDir]);
    const svgContent = await fs.readFile(outSvg, 'utf8');
    assert.ok(svgContent.includes('<svg'));

    // render frame as PNG
    const pngOutPath = path.join(tmpDir, 'preview.png');
    await runCli(['render', 'frame', '--time', '1.0', '--out', pngOutPath, '--dir', tmpDir]);
    const pngStat = await fs.stat(pngOutPath);
    assert.ok(pngStat.size > 100, 'PNG should be non-trivial size');

    // 11. project inspect
    await runCli(['project', 'inspect', '--dir', tmpDir, '--json']);

    // script new codesnippet
    await runCli(['script', 'new', 'CodeBlock', '--type', 'codesnippet', '--dir', tmpDir]);
    const csFiles = await fs.readdir(path.join(tmpDir, 'scripts'));
    assert.ok(csFiles.some(f => f.includes('CodeBlock')));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
