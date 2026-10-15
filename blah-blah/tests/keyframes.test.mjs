import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setKeyframe,
  removeKeyframe,
  removeKeyframesByIds,
  moveKeyframesDelta,
  getFieldKeyframes,
  CURVE_PRESETS,
  QUICK_CURVE_PRESETS,
} from '../src/engine/keyframes.js';

test('quick curve presets are a stable, useful subset of the full easing library', () => {
  assert.deepEqual(QUICK_CURVE_PRESETS.map((preset) => preset.name), [
    'Linear', 'Ease In', 'Ease Out', 'Ease In Out', 'Snap', 'Bounce Out',
  ]);
  assert.ok(QUICK_CURVE_PRESETS.every((preset) => CURVE_PRESETS.includes(preset)));
});

test('removeKeyframesByIds removes multiple keyframes across tracks/fields', () => {
  let entity = {
    keyframes: {
      Transform: {
        x: [
          { id: 'k1', time: 0, value: 10 },
          { id: 'k2', time: 1, value: 20 },
          { id: 'k3', time: 2, value: 30 },
        ],
        y: [
          { id: 'k4', time: 0.5, value: 5 },
          { id: 'k5', time: 1.5, value: 15 },
        ],
      },
    },
  };

  const next = removeKeyframesByIds(entity, new Set(['k2', 'k4']));
  assert.equal(next.Transform.x.length, 2);
  assert.deepEqual(next.Transform.x.map((k) => k.id), ['k1', 'k3']);
  assert.equal(next.Transform.y.length, 1);
  assert.deepEqual(next.Transform.y.map((k) => k.id), ['k5']);
});

test('moveKeyframesDelta moves multiple keyframes preserving relative distance and clamping at 0', () => {
  let entity = {
    keyframes: {
      Transform: {
        x: [
          { id: 'k1', time: 1, value: 10 },
          { id: 'k2', time: 3, value: 20 },
        ],
        y: [
          { id: 'k3', time: 2, value: 5 },
        ],
      },
    },
  };

  // Move right by +0.5s
  let next = moveKeyframesDelta(entity, new Set(['k1', 'k2', 'k3']), 0.5);
  assert.equal(next.Transform.x[0].time, 1.5);
  assert.equal(next.Transform.x[1].time, 3.5);
  assert.equal(next.Transform.y[0].time, 2.5);

  // Move left by -2s: since minTime was 1, maximum left shift is -1s
  next = moveKeyframesDelta(entity, new Set(['k1', 'k2', 'k3']), -2);
  assert.equal(next.Transform.x[0].time, 0); // clamped at 0
  assert.equal(next.Transform.x[1].time, 2); // 3 - 1 = 2
  assert.equal(next.Transform.y[0].time, 1); // 2 - 1 = 1
});

test('moveKeyframesDelta respects snap function', () => {
  let entity = {
    keyframes: {
      Transform: {
        x: [
          { id: 'k1', time: 1.0, value: 10 },
        ],
      },
    },
  };

  const snapToHalf = (t) => Math.round(t * 2) / 2;
  const next = moveKeyframesDelta(entity, new Set(['k1']), 0.41, snapToHalf);
  assert.equal(next.Transform.x[0].time, 1.5);
});
