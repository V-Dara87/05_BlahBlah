import test from 'node:test';
import assert from 'node:assert/strict';
import { MathUtils } from './motionTween.js';
import { canvasScript } from '../../packages/blahblah-sdk/index.js';

test('MathUtils - deterministic PRNG produces identical sequences for identical seeds', () => {
  const rngA = MathUtils.createRandom(42);
  const rngB = MathUtils.createRandom(42);

  const seqA = [rngA(), rngA(), rngA(), rngA(), rngA()];
  const seqB = [rngB(), rngB(), rngB(), rngB(), rngB()];

  assert.deepEqual(seqA, seqB, 'Sequences with same seed must be identical');

  const rngC = MathUtils.createRandom(43);
  const seqC = [rngC(), rngC(), rngC(), rngC(), rngC()];
  assert.notDeepEqual(seqA, seqC, 'Sequences with different seeds must differ');
});

test('MathUtils - string seeds work deterministically', () => {
  const rngA = MathUtils.createRandom('my-clip-seed');
  const rngB = MathUtils.createRandom('my-clip-seed');
  assert.equal(rngA(), rngB());
  assert.equal(rngA(), rngB());
});

test('MathUtils - randomRange returns values strictly within bounds', () => {
  for (let i = 0; i < 50; i++) {
    const val = MathUtils.randomRange(10, 20, i);
    assert.ok(val >= 10 && val <= 20, `Value ${val} should be in [10, 20]`);
  }
});

test('MathUtils - noise1D and noise2D are deterministic and bounded', () => {
  const n1 = MathUtils.noise1D(2.5, 100);
  const n2 = MathUtils.noise1D(2.5, 100);
  assert.equal(n1, n2, 'Same position and seed must give identical noise');

  const n3 = MathUtils.noise2D(1.2, 3.4, 55);
  const n4 = MathUtils.noise2D(1.2, 3.4, 55);
  assert.equal(n3, n4, 'Same 2D coordinate must give identical noise');

  assert.ok(n1 >= -1 && n1 <= 1, '1D noise must stay in [-1, 1]');
  assert.ok(n3 >= -1 && n3 <= 1, '2D noise must stay in [-1, 1]');
});

test('canvasScript - passes random and noise to draw args', () => {
  let capturedArgs = null;
  const scriptClass = canvasScript({
    draw(args) {
      capturedArgs = args;
    },
  });

  const instance = new scriptClass();
  instance.onMount({ container: null, canvasWidth: 800, canvasHeight: 600 });
  instance.ctx = { save() {}, restore() {}, clearRect() {}, translate() {} };
  instance.onUpdate({ time: 1.0, canvasWidth: 800, canvasHeight: 600 });

  assert.ok(typeof capturedArgs.random === 'function', 'draw must receive random helper');
  assert.ok(typeof capturedArgs.createRandom === 'function', 'draw must receive createRandom helper');
  assert.ok(typeof capturedArgs.noise1D === 'function', 'draw must receive noise1D helper');
  assert.ok(typeof capturedArgs.noise2D === 'function', 'draw must receive noise2D helper');

  // Verify that random is deterministic when called with time
  const r1 = capturedArgs.random(capturedArgs.time);
  const r2 = capturedArgs.random(capturedArgs.time);
  assert.equal(r1, r2, 'random(time) must be deterministic across calls');
});
