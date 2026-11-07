import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearMemoryFallback,
  hasItem,
  readJson,
  readString,
  removeItem,
  writeJson,
  writeString,
} from '../src/utils/appStorage.js';

test('appStorage — writes and reads JSON even without localStorage', () => {
  clearMemoryFallback();
  removeItem('test.json');

  assert.equal(writeJson('test.json', { a: 1 }), false); // memory fallback in Node
  assert.deepEqual(readJson('test.json', null), { a: 1 });
  assert.equal(hasItem('test.json'), true);
});

test('appStorage — corrupt values fall back instead of throwing', () => {
  clearMemoryFallback();
  removeItem('test.corrupt');
  writeString('test.corrupt', '{not json');

  assert.equal(readJson('test.corrupt', { ok: true }).ok, true);
  assert.equal(readString('test.corrupt'), '{not json');
});

test('appStorage — missing keys return the fallback and remove works', () => {
  clearMemoryFallback();
  removeItem('test.missing');

  assert.equal(readString('test.missing'), null);
  assert.equal(readString('test.missing', 'default'), 'default');
  assert.deepEqual(readJson('test.missing', []), []);

  writeString('test.missing', 'x');
  assert.equal(hasItem('test.missing'), true);
  removeItem('test.missing');
  assert.equal(hasItem('test.missing'), false);
});
