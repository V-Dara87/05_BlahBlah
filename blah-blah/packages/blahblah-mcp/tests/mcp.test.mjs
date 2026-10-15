import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { handleToolCall, TOOLS } from '../src/server.js';

test('MCP - Tools definition and tool call execution', async () => {
  assert.ok(TOOLS.length >= 10, 'Should register at least 10 MCP tools');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blahblah-mcp-test-'));

  try {
    // 1. init
    const initRes = await handleToolCall('blahblah_project_init', {
      dir: tmpDir,
      name: 'MCP Automation Project',
      resolution: 'reels',
    });
    assert.equal(initRes.project.name, 'MCP Automation Project');
    assert.equal(initRes.project.resolution.width, 1080);
    assert.equal(initRes.project.resolution.height, 1920);

    // 2. add track
    const trackRes = await handleToolCall('blahblah_track_add', {
      dir: tmpDir,
      name: 'Subtitles',
    });
    assert.equal(trackRes.name, 'Subtitles');

    // 3. add clip
    const clipRes = await handleToolCall('blahblah_clip_add', {
      dir: tmpDir,
      file: 'media/video.mp4',
      name: 'Main Video',
      startTime: 0,
      duration: 10,
    });
    assert.ok(clipRes.video);

    // 4. create script
    const scriptRes = await handleToolCall('blahblah_script_create', {
      dir: tmpDir,
      name: 'CounterOverlay',
      type: 'canvas',
    });
    assert.equal(scriptRes.name, 'CounterOverlay');

    // 5. validate script
    const valRes = await handleToolCall('blahblah_script_validate', {
      filePath: scriptRes.filePath,
    });
    assert.equal(valRes.valid, true);

    // 6. add entity
    const entityRes = await handleToolCall('blahblah_entity_add', {
      dir: tmpDir,
      name: 'Score Counter',
      scriptName: 'CounterOverlay',
      trackId: 'track-2',
      startTime: 1,
      duration: 5,
      props: { count: 10 },
    });
    assert.ok(entityRes.id);

    // 7. set prop
    const propRes = await handleToolCall('blahblah_entity_set_prop', {
      dir: tmpDir,
      entityId: entityRes.id,
      propName: 'count',
      propValue: 42,
    });
    assert.equal(propRes.updatedProps.count, 42);

    // 8. set transform
    const transRes = await handleToolCall('blahblah_entity_set_transform', {
      dir: tmpDir,
      entityId: entityRes.id,
      x: 50,
      y: -100,
      opacity: 0.9,
    });
    assert.equal(transRes.transform.x, 50);

    // 9. add keyframe
    const kfRes = await handleToolCall('blahblah_keyframe_add', {
      dir: tmpDir,
      entityId: entityRes.id,
      field: 'x',
      time: 2,
      value: 200,
      ease: 'bounce',
    });
    assert.ok(kfRes.id);

    // 10. render frame
    const svgPath = path.join(tmpDir, 'frame.svg');
    const renderRes = await handleToolCall('blahblah_render_frame', {
      dir: tmpDir,
      time: 2.0,
      outFile: svgPath,
    });
    assert.ok(renderRes.activeEntitiesCount > 0);
    assert.ok(await fs.stat(svgPath));

    // 10b. render frame PNG
    const pngRes = await handleToolCall('blahblah_render_frame', {
      dir: tmpDir,
      time: 2.0,
      format: 'png',
    });
    assert.ok(pngRes.pngBase64, 'should return base64 PNG');
    assert.ok(pngRes.pngBase64.length > 100, 'base64 should be non-trivial size');
    assert.equal(pngRes.format, 'png');

    // 11. inspect project
    const inspectRes = await handleToolCall('blahblah_project_inspect', { dir: tmpDir });
    assert.equal(inspectRes.entitiesCount, 3);
    assert.equal(inspectRes.resolution.height, 1920);

    // 12. live control
    const controlRes = await handleToolCall('blahblah_live_control', {
      dir: tmpDir,
      command: 'seek',
      arg: 3.5,
    });
    assert.equal(controlRes.status, 'sent');

    // 13. create codesnippet script
    const csRes = await handleToolCall('blahblah_script_create', {
      dir: tmpDir,
      name: 'CodeDemo',
      type: 'codesnippet',
    });
    assert.equal(csRes.name, 'CodeDemo');
    assert.ok(csRes.code.includes('typewriterSpeed'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
