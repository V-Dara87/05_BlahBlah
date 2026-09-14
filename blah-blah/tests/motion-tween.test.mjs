import assert from 'node:assert/strict';
import test from 'node:test';
import { Tween } from '../src/engine/motionTween.js';

test('Tween.between evaluates an eased timeline window without state', () => {
  assert.equal(Tween.between(10, 30, 0, { at: 1, duration: 2 }), 10);
  assert.equal(Tween.between(10, 30, 2, { at: 1, duration: 2 }), 20);
  assert.equal(Tween.between(10, 30, 3, { at: 1, duration: 2 }), 30);
  assert.equal(Tween.between(0, 100, 0.5, { duration: 1, ease: 'inQuad' }), 25);
});

test('Tween loop helpers are deterministic and support yoyo', () => {
  assert.equal(Tween.loop(0.25, 1), 0.25);
  assert.equal(Tween.loop(1.25, 1, 'yoyo'), 0.75);
  assert.equal(Tween.pingPong(2.25, 1), 0.25);
  assert.equal(Tween.stagger(3, 0.08), 0.24);
});
