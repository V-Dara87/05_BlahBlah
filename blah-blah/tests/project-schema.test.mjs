import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateProjectJson,
  MAX_PROJECT_JSON_BYTES,
  MAX_KEYFRAMES_PER_ENTITY,
  MAX_COMPONENTS_PER_ENTITY,
} from '../src/services/projectSchema.js';

const track = { id: 'track-1', name: 'Video' };
const entity = {
  id: 'go-1',
  type: 'VideoRenderer',
  trackId: 'track-1',
  startTime: 0,
  duration: 5,
};

test('project schema — accepts a well-formed project unchanged', () => {
  const { project, warnings } = validateProjectJson({
    name: 'Demo',
    schemaVersion: 1,
    tracks: [track],
    entities: [entity],
    scriptIndex: [{ name: 'Intro.jsx', id: 'script-intro' }],
  });

  assert.equal(project.name, 'Demo');
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.tracks.length, 1);
  assert.equal(project.entities.length, 1);
  assert.equal(project.scriptIndex[0].id, 'script-intro');
  assert.deepEqual(warnings, []);
});

test('project schema — rejects a non-object file', () => {
  assert.throws(() => validateProjectJson(null), /must contain a JSON object/);
  assert.throws(() => validateProjectJson([]), /must contain a JSON object/);
  assert.throws(() => validateProjectJson('nope'), /must contain a JSON object/);
});

test('project schema — drops unusable entities and coerces bad values without losing the project', () => {
  const { project, warnings } = validateProjectJson({
    schemaVersion: 1,
    tracks: [track],
    entities: [
      entity,
      { ...entity }, // duplicate id
      { ...entity, id: 'go-2', trackId: 'missing-track' },
      { ...entity, id: 'go-3', duration: 0, startTime: -4 },
      { id: '' },
      'not-an-object',
    ],
  });

  assert.deepEqual(project.entities.map((e) => e.id), ['go-1', 'go-2', 'go-3']);
  assert.equal(project.entities[2].duration, 1);
  assert.equal(project.entities[2].startTime, 0);
  assert.ok(warnings.length >= 4);
});

test('project schema — coerces numeric timing and keeps unknown optional fields', () => {
  const { project } = validateProjectJson({
    tracks: [{ id: 't', name: 'T', custom: true }],
    entities: [{ id: 'e', trackId: 't', startTime: '1.5', duration: '2', color: '#fff' }],
  });

  assert.equal(project.entities[0].startTime, 1.5);
  assert.equal(project.entities[0].duration, 2);
  assert.equal(project.entities[0].color, '#fff');
  assert.equal(project.tracks[0].custom, true);
});

test('project schema — rejects scriptIndex entries that are not plain filenames', () => {
  const { project, warnings } = validateProjectJson({
    schemaVersion: 1,
    tracks: [track],
    entities: [],
    scriptIndex: [
      { name: '../escape.jsx', id: 'a' },
      { name: 'C:evil.jsx', id: 'b' },
      { name: 'ok.jsx', id: 'c' },
      { name: 'ok.jsx', id: 'd' },
    ],
  });

  assert.deepEqual(project.scriptIndex.map((entry) => entry.id), ['c']);
  assert.ok(warnings.some((warning) => warning.includes('invalid scriptIndex')));
  assert.ok(warnings.some((warning) => warning.includes('duplicate scriptIndex')));
});

test('project schema — clears parent links to entities that did not survive', () => {
  const { project, warnings } = validateProjectJson({
    tracks: [track],
    entities: [
      { ...entity, parentId: 'go-2' },
      { ...entity, id: 'go-2', parentId: 'missing-parent' },
      { ...entity, id: 'go-3', parentId: 'go-3' },
    ],
  });

  assert.equal(project.entities[0].parentId, 'go-2');
  assert.equal(project.entities[1].parentId, undefined);
  assert.equal(project.entities[2].parentId, undefined);
  assert.ok(warnings.some((warning) => warning.includes('unknown parent')));
});

test('project schema — warns about script components pointing at unknown scripts', () => {
  const { project, warnings } = validateProjectJson({
    tracks: [track],
    entities: [
      {
        ...entity,
        components: [{ type: 'ScriptComponent', scriptId: 'script-missing' }],
      },
    ],
    scriptIndex: [{ name: 'Intro.jsx', id: 'script-intro' }],
  });

  assert.equal(project.entities[0].components[0].scriptId, 'script-missing');
  assert.ok(warnings.some((warning) => warning.includes('unknown script')));
});

test('project schema — drops duplicate keyframe ids and clamps bad times', () => {
  const { project, warnings } = validateProjectJson({
    tracks: [track],
    entities: [
      {
        ...entity,
        keyframes: {
          Transform: {
            y: [
              { id: 'kf-1', time: 0, value: 10 },
              { id: 'kf-1', time: 1, value: 20 },
              { id: 'kf-2', time: -2, value: 30 },
              { id: 'kf-3', time: 'not-a-number', value: 40 },
            ],
          },
        },
      },
    ],
  });

  const keyframes = project.entities[0].keyframes.Transform.y;
  assert.deepEqual(keyframes.map((kf) => kf.id), ['kf-1', 'kf-2']);
  assert.equal(keyframes[0].time, 0);
  assert.equal(keyframes[1].time, 0);
  assert.ok(warnings.some((warning) => warning.includes('duplicate keyframe')));
});

test('project schema — caps components and keyframes per entity', () => {
  const components = Array.from({ length: MAX_COMPONENTS_PER_ENTITY + 3 }, () => ({
    type: 'ShapeRenderer',
    shape: 'rect',
  }));
  const keyframes = Array.from({ length: MAX_KEYFRAMES_PER_ENTITY + 5 }, (_, i) => ({
    id: `kf-${i}`,
    time: i,
    value: i,
  }));

  const { project, warnings } = validateProjectJson({
    tracks: [track],
    entities: [
      {
        ...entity,
        components,
        keyframes: { Transform: { y: keyframes } },
      },
    ],
  });

  assert.equal(project.entities[0].components.length, MAX_COMPONENTS_PER_ENTITY);
  assert.equal(
    project.entities[0].keyframes.Transform.y.length,
    MAX_KEYFRAMES_PER_ENTITY
  );
  assert.ok(warnings.some((warning) => warning.includes('more than')));
});

test('project schema — exposes the project.json size cap', () => {
  assert.equal(MAX_PROJECT_JSON_BYTES, 64 * 1024 * 1024);
});
