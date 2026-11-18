import test from 'node:test';
import assert from 'node:assert/strict';
import { placeInViewport } from './viewportPlacement.js';

const vp = { viewportWidth: 1000, viewportHeight: 800 };

test('fits: stays exactly where it was asked to open', () => {
  const r = placeInViewport({ x: 100, y: 200, width: 200, height: 300, ...vp });
  assert.deepEqual(r, { left: 100, top: 200, maxHeight: 788, scrollable: false });
});

test('near the bottom / right edge: pushed back inside', () => {
  const r = placeInViewport({ x: 950, y: 700, width: 200, height: 300, ...vp });
  assert.equal(r.left, 1000 - 200 - 6);
  assert.equal(r.top, 800 - 300 - 6);
  assert.equal(r.scrollable, false);
});

test('taller than the window: pinned to the top margin, capped and scrollable', () => {
  const r = placeInViewport({ x: 100, y: 350, width: 200, height: 1200, ...vp });
  assert.equal(r.top, 6);
  assert.equal(r.maxHeight, 788);
  assert.equal(r.scrollable, true);
});

test('exactly as tall as the usable height is not scrollable', () => {
  const r = placeInViewport({ x: 0, y: 0, width: 100, height: 788, ...vp });
  assert.equal(r.scrollable, false);
  assert.equal(r.top, 6);
});

test('never goes past the left / top margin, even for a tiny window', () => {
  const r = placeInViewport({ x: -50, y: -50, width: 300, height: 300, viewportWidth: 200, viewportHeight: 200 });
  assert.equal(r.left, 6);
  assert.equal(r.top, 6);
  assert.equal(r.scrollable, true);
});