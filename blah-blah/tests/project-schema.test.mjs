import test from 'node:test';
import assert from 'node:assert/strict';

import { validateProjectJson } from '../src/services/projectSchema.js';

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
