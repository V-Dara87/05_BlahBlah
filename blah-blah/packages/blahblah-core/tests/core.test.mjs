import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  initProject,
  loadProject,
  saveProject,
  inspectProject,
  addTrack,
  listTracks,
  removeTrack,
  addVideoClip,
  addScriptEntity,
  setEntityProp,
  setEntityTransform,
  removeEntity,
  addKeyframe,
  createScript,
  validateScript,
  evaluateTimelineAtTime,
  renderFrameSvg,
} from '../src/index.js';

test('Core - Project lifecycle & inspection', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blahblah-test-'));

  try {
    // 1. Init
    const initRes = await initProject({
      dir: tmpDir,
      name: 'Test Project',
      resolution: '1080p',
    });
    assert.equal(initRes.project.name, 'Test Project');
    assert.equal(initRes.project.resolution.width, 1920);
    assert.equal(initRes.project.resolution.height, 1080);
    assert.equal(initRes.project.tracks.length, 4);

    // 2. Add track
    const newTrack = addTrack(initRes.project, { name: 'Overlay Track' });
    assert.equal(newTrack.name, 'Overlay Track');
    assert.equal(initRes.project.tracks.length, 5);

    // 3. Add video clip
    const clipRes = addVideoClip(initRes.project, {
      name: 'Intro Video',
      trackId: 'track-1',
      file: 'media/intro.mp4',
      startTime: 0,
      duration: 10,
    });
    assert.ok(clipRes.video);
    assert.ok(clipRes.audio);
    assert.equal(initRes.project.entities.length, 2);

    // 4. Add script entity
    const scriptEntity = addScriptEntity(initRes.project, {
      name: 'Header Banner',
      scriptName: 'BannerScript',
      trackId: 'track-2',
      startTime: 2,
      duration: 5,
      props: { text: 'Hello AI' },
    });
    assert.ok(scriptEntity.id);
    assert.equal(initRes.project.entities.length, 3);

    // 5. Set prop & transform
    setEntityProp(initRes.project, scriptEntity.id, 'text', 'Updated Text');
    setEntityTransform(initRes.project, scriptEntity.id, { y: -100 });

    // 6. Add Keyframe
    const kf = addKeyframe(initRes.project, scriptEntity.id, {
      trackKey: 'Transform',
      field: 'y',
      time: 2,
      value: 0,
      ease: 'easeInOut',
    });
    assert.ok(kf.id);

    // 7. Save and Load
    await saveProject(tmpDir, initRes.project);
    const loaded = await loadProject(tmpDir);
    assert.equal(loaded.project.name, 'Test Project');
    assert.equal(loaded.project.entities.length, 3);

    // 8. Inspect
    const inspected = await inspectProject(tmpDir);
    assert.equal(inspected.entitiesCount, 3);
    assert.equal(inspected.totalDurationSeconds, 10);

    // 9. Evaluate timeline at time t = 3
    const evalFrame = evaluateTimelineAtTime(loaded.project, 3);
    assert.ok(evalFrame.activeEntities.length > 0);

    // 10. Render SVG snapshot
    const svg = renderFrameSvg(loaded.project, 3);
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('1920'));

    // 11. Script creation & validation
    const script = await createScript({
      dir: tmpDir,
      name: 'TestCanvas',
      type: 'canvas',
    });
    assert.ok(script.code.includes('CanvasComponent'));

    const validation = await validateScript(script.filePath);
    assert.equal(validation.valid, true);
    assert.ok(validation.detectedProps.includes('title'));

    // 12. Remove entity
    const rmRes = removeEntity(loaded.project, clipRes.video.id);
    // Should remove both video and child audio
    assert.equal(rmRes.removedIds.length, 2);
    assert.equal(loaded.project.entities.length, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
