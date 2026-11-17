import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

import {
  initProject,
  addScriptEntity,
  setEntityTransform,
  renderFramePng,
  diagnoseFrameLayout,
} from '../src/index.js';

test('renderFramePng — generates valid PNG with text labels', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blahblah-png-'));
  try {
    const { project } = await initProject({ dir: tmpDir, name: 'PNG Test', resolution: '1080p' });
    addScriptEntity(project, {
      name: 'Headline',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      props: { title: 'Welcome to BlahBlah' },
    });

    const pngBuf = renderFramePng(project, 1.5);
    assert.ok(Buffer.isBuffer(pngBuf));
    assert.ok(pngBuf.length > 100);

    // Valid PNG signature
    assert.deepEqual([...pngBuf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    // Valid chunks: IHDR, IDAT, IEND
    assert.ok(pngBuf.indexOf('IHDR') > 0);
    assert.ok(pngBuf.indexOf('IDAT') > 0);
    assert.ok(pngBuf.indexOf('IEND') > 0);

    // Decompress IDAT to verify it uncompresses cleanly
    const idat = pngBuf.indexOf('IDAT');
    const idatLen = pngBuf.readUInt32BE(idat - 4);
    const raw = zlib.inflateSync(pngBuf.subarray(idat + 4, idat + 4 + idatLen));
    assert.equal(raw.length, 1080 * (1 + 1920 * 4));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('diagnoseFrameLayout — detects collisions and out-of-bounds entities', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blahblah-diag-'));
  try {
    const { project } = await initProject({ dir: tmpDir, name: 'Diag Test', resolution: '1080p' });

    // 1. Two overlapping entities in center
    const e1 = addScriptEntity(project, {
      name: 'Box A',
      trackId: 'track-1',
      startTime: 0,
      duration: 10,
    });
    setEntityTransform(project, e1.id, { x: 0, y: 0 });

    const e2 = addScriptEntity(project, {
      name: 'Box B',
      trackId: 'track-2',
      startTime: 0,
      duration: 10,
    });
    setEntityTransform(project, e2.id, { x: 20, y: 10 }); // Mostly overlapping Box A

    // 2. An entity pushed way off the screen to the right
    const e3 = addScriptEntity(project, {
      name: 'Offscreen Box',
      trackId: 'track-3',
      startTime: 0,
      duration: 10,
    });
    setEntityTransform(project, e3.id, { x: 1200, y: 0 }); // 960 + 1200 - 100 = 2060 > 1920

    const diag = diagnoseFrameLayout(project, 2);
    assert.equal(diag.activeEntitiesCount, 3);

    // Check out of bounds
    assert.ok(diag.warnings.some((w) => w.includes('is out of bounds')));
    const offscreen = diag.entities.find((e) => e.name === 'Offscreen Box');
    assert.ok(offscreen);
    assert.equal(offscreen.isOutOfBounds, true);
    assert.ok(offscreen.overflow.right > 0);

    // Check collision / overlap
    assert.ok(diag.overlaps.length >= 1);
    assert.ok(diag.warnings.some((w) => w.includes('Collision: "Box A" and "Box B" overlap')));
    assert.ok(diag.suggestions.length >= 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
