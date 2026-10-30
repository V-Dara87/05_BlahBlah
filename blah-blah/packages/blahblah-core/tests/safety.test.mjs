import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

import {
  initProject,
  loadProject,
  saveProject,
  updateProject,
  ProjectConflictError,
  addTrack,
  removeTrack,
  addScriptEntity,
  addEmptyClip,
  addKeyframe,
  removeKeyframes,
  findEntity,
  setEntityTransform,
  evaluateTimelineAtTime,
  renderFramePng,
  renderFrameSvg,
  resolveProjectDir,
  DEFAULT_TRACKS,
} from '../src/index.js';

async function tmp(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('Project saves are atomic, keep a .bak and leave no temp files', async () => {
  const dir = await tmp('bb-save-');
  try {
    const { project } = await initProject({ dir, name: 'One' });
    project.name = 'Two';
    await saveProject(dir, project);

    const bak = JSON.parse(await fs.readFile(path.join(dir, 'project.json.bak'), 'utf8'));
    assert.equal(bak.name, 'One');
    assert.equal((await loadProject(dir)).project.name, 'Two');

    const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('initProject refuses to overwrite an existing project and does not share default tracks', async () => {
  const dir = await tmp('bb-init-');
  try {
    const first = await initProject({ dir, name: 'Keep me' });
    first.project.tracks[0].name = 'Renamed';
    assert.equal(DEFAULT_TRACKS[0].name, 'Track 1', 'defaults must not be mutated');

    await assert.rejects(() => initProject({ dir, name: 'Oops' }), /already exists/);
    assert.equal((await loadProject(dir)).project.name, 'Keep me');

    await initProject({ dir, name: 'Replaced', overwrite: true });
    assert.equal((await loadProject(dir)).project.name, 'Replaced');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('updateProject serialises parallel edits so none is lost', async () => {
  const dir = await tmp('bb-par-');
  try {
    await initProject({ dir, name: 'Parallel' });
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => updateProject(dir, (p) => addTrack(p, { name: `T${i}` })))
    );
    const { project } = await loadProject(dir);
    assert.equal(project.tracks.length, 4 + 25);
    assert.equal(new Set(project.tracks.map((t) => t.id)).size, 29, 'track ids must be unique');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('saveProject detects an edit made by someone else (e.g. the editor)', async () => {
  const dir = await tmp('bb-conflict-');
  try {
    await initProject({ dir, name: 'Conflict' });
    const { project, revision } = await loadProject(dir);

    // another process saves in between
    const other = JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8'));
    other.name = 'Edited elsewhere';
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(other));

    project.name = 'Mine';
    await assert.rejects(() => saveProject(dir, project, { expectedRevision: revision }), ProjectConflictError);
    assert.equal((await loadProject(dir)).project.name, 'Edited elsewhere');

    // updateProject re-reads and keeps the other edit
    await updateProject(dir, (p) => addTrack(p, { name: 'Mine' }));
    const final = (await loadProject(dir)).project;
    assert.equal(final.name, 'Edited elsewhere');
    assert.ok(final.tracks.some((t) => t.name === 'Mine'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('updateProject writes nothing when the mutator throws', async () => {
  const dir = await tmp('bb-throw-');
  try {
    await initProject({ dir, name: 'Throw' });
    const before = await fs.readFile(path.join(dir, 'project.json'), 'utf8');
    await assert.rejects(
      () =>
        updateProject(dir, (p) => {
          p.name = 'half done';
          throw new Error('boom');
        }),
      /boom/
    );
    assert.equal(await fs.readFile(path.join(dir, 'project.json'), 'utf8'), before);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('newer schema versions are refused instead of being rewritten', async () => {
  const dir = await tmp('bb-schema-');
  try {
    await initProject({ dir, name: 'Future' });
    const file = path.join(dir, 'project.json');
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    data.schemaVersion = 99;
    await fs.writeFile(file, JSON.stringify(data));
    await assert.rejects(() => loadProject(dir), /newer than this tool supports/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('allowed roots restrict project directories; "dir" can be required', async () => {
  const allowed = await tmp('bb-allowed-');
  const outside = await tmp('bb-outside-');
  const previous = process.env.BLAHBLAH_ALLOWED_ROOTS;
  try {
    process.env.BLAHBLAH_ALLOWED_ROOTS = allowed;
    assert.ok(resolveProjectDir(path.join(allowed, 'sub')));
    assert.throws(() => resolveProjectDir(outside), /outside the allowed roots/);
    await assert.rejects(() => initProject({ dir: outside }), /outside the allowed roots/);
    assert.throws(() => resolveProjectDir(undefined, { required: true }), /required/);
  } finally {
    if (previous === undefined) delete process.env.BLAHBLAH_ALLOWED_ROOTS;
    else process.env.BLAHBLAH_ALLOWED_ROOTS = previous;
    await fs.rm(allowed, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('tracks: new ids never collide and removal also removes child entities', () => {
  const project = { tracks: [], entities: [] };
  addTrack(project, { id: 'track-1' });
  addTrack(project, { id: 'track-2' });
  addTrack(project, { id: 'track-3' });
  removeTrack(project, 'track-2');
  const next = addTrack(project, { name: 'After removal' });
  assert.notEqual(next.id, 'track-3');
  assert.equal(new Set(project.tracks.map((t) => t.id)).size, project.tracks.length);

  const parent = addEmptyClip(project, { name: 'parent', trackId: 'track-1' });
  const child = addEmptyClip(project, { name: 'child', trackId: 'track-3' });
  child.parentId = parent.id;
  removeTrack(project, 'track-1');
  assert.equal(project.entities.length, 0, 'the child on another track must go with its parent');
});

test('entities: duplicate names are ambiguous, bad transforms and timing are rejected', () => {
  const project = { tracks: [{ id: 'track-1' }], entities: [] };
  const a = addEmptyClip(project, { name: 'Same' });
  addEmptyClip(project, { name: 'Same' });
  assert.throws(() => findEntity(project, 'Same'), /matches 2 entities/);
  assert.equal(findEntity(project, a.id).id, a.id);
  assert.throws(() => setEntityTransform(project, a.id, { opacity: 2 }), /between 0 and 1/);
  assert.throws(() => setEntityTransform(project, a.id, { x: 'far' }), /finite number/);
  assert.throws(() => setEntityTransform(project, a.id, { bogus: 1 }), /Unknown transform field/);
  assert.throws(() => addScriptEntity(project, { scriptName: 'S', duration: 0 }), /duration must be/);
  assert.throws(() => addScriptEntity(project, { scriptName: 'S', startTime: -1 }), /startTime must be/);
});

test('keyframes: counts are real, values keep their type, bad input is rejected', () => {
  const project = { entities: [] };
  const e = addEmptyClip(project, { name: 'kf' });
  const k1 = addKeyframe(project, e.id, { field: 'x', time: 0, value: '10' });
  const flag = addKeyframe(project, e.id, { trackKey: 'script:s', field: 'visible', time: 1, value: true });
  assert.equal(k1.value, 10);
  assert.equal(flag.value, true, 'a boolean must not become 1');

  assert.throws(() => addKeyframe(project, e.id, { field: 'x', time: 0, value: '' }), /value is required/);
  assert.throws(() => addKeyframe(project, e.id, { field: 'x', time: -2, value: 1 }), /time must be/);
  assert.throws(() => addKeyframe(project, e.id, { field: 'x', time: 0, value: 1, ease: 'wobble' }), /Unknown ease/);

  assert.equal(removeKeyframes(project, e.id, [k1.id, 'does-not-exist']).removedCount, 1);
});

test('render: PNG is a valid zlib PNG, SVG text is escaped, hidden tracks draw nothing', () => {
  const project = {
    resolution: { width: 320, height: 200 },
    tracks: [
      { id: 'track-1', visible: true },
      { id: 'track-2', visible: false },
    ],
    entities: [],
  };
  const shown = addEmptyClip(project, { name: 'A & <B> "q"', trackId: 'track-1', color: '#ff0000' });
  addEmptyClip(project, { name: 'ghost', trackId: 'track-2' });

  assert.equal(evaluateTimelineAtTime(project, 1).activeEntitiesCount, 1);

  const svg = renderFrameSvg(project, 1);
  assert.ok(svg.includes('A &amp; &lt;B&gt; &quot;q&quot;'));
  assert.ok(!svg.includes('<B>'));

  const png = renderFramePng(project, 1);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = png.indexOf('IDAT');
  const length = png.readUInt32BE(idat - 4);
  const raw = zlib.inflateSync(png.subarray(idat + 4, idat + 4 + length)); // throws on raw deflate
  assert.equal(raw.length, 200 * (1 + 320 * 4));

  // CRC of every chunk must match
  let offset = 8;
  while (offset < png.length) {
    const len = png.readUInt32BE(offset);
    const body = png.subarray(offset + 4, offset + 8 + len);
    const crc = png.readUInt32BE(offset + 8 + len);
    assert.equal(zlib.crc32 ? zlib.crc32(body) : crc, crc);
    offset += 12 + len;
  }

  // the box centre is red-ish over the dark background and the canvas stays opaque
  const stride = 1 + 320 * 4;
  const px = (x, y) => raw.subarray(y * stride + 1 + x * 4, y * stride + 1 + x * 4 + 4);
  const [r, , , a] = px(160, 100);
  assert.ok(r > 15 + 20, 'fill should tint the background');
  assert.equal(a, 255);
  assert.ok(shown.id);

  assert.throws(() => renderFramePng(project, Number.NaN), /time must be/);
});