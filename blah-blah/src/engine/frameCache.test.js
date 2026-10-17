import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameCache } from './frameCache.js';

test('FrameCache - stores, retrieves, and updates LRU order', () => {
  const cache = new FrameCache(3);
  const mockCanvas1 = { id: 1 };
  const mockCanvas2 = { id: 2 };
  const mockCanvas3 = { id: 3 };
  const mockCanvas4 = { id: 4 };

  cache.set('e1', 'k1', mockCanvas1, 100, 100);
  cache.set('e1', 'k2', mockCanvas2, 100, 100);
  cache.set('e2', 'k3', mockCanvas3, 100, 100);

  assert.equal(cache.getStats().size, 3);
  assert.ok(cache.get('k1') !== null);

  // Adding 4th item should evict oldest (k2, since k1 was accessed above)
  cache.set('e2', 'k4', mockCanvas4, 100, 100);
  assert.equal(cache.getStats().size, 3);
  assert.equal(cache.get('k2'), null, 'k2 should have been evicted as LRU');
  assert.ok(cache.get('k1') !== null, 'k1 should still exist');
});

test('FrameCache - invalidateEntity clears all keys for that entity', () => {
  const cache = new FrameCache(10);
  cache.set('entity-A', 'k-A1', {}, 100, 100);
  cache.set('entity-A', 'k-A2', {}, 100, 100);
  cache.set('entity-B', 'k-B1', {}, 100, 100);

  assert.equal(cache.getStats().size, 3);

  cache.invalidateEntity('entity-A');
  assert.equal(cache.get('k-A1'), null);
  assert.equal(cache.get('k-A2'), null);
  assert.ok(cache.get('k-B1') !== null, 'entity-B frames should be preserved');
});

test('FrameCache - generateKey generates deterministic unique keys', () => {
  const cache = new FrameCache();
  const k1 = cache.generateKey('e1', 's1', 'codeA', { speed: 1 }, 10, 1920, 1080);
  const k2 = cache.generateKey('e1', 's1', 'codeA', { speed: 1 }, 10, 1920, 1080);
  const k3 = cache.generateKey('e1', 's1', 'codeA', { speed: 2 }, 10, 1920, 1080);
  const k4 = cache.generateKey('e1', 's1', 'codeA', { speed: 1 }, 11, 1920, 1080);

  assert.equal(k1, k2, 'Same parameters must generate identical key');
  assert.notEqual(k1, k3, 'Different props must generate different key');
  assert.notEqual(k1, k4, 'Different frame must generate different key');
});
