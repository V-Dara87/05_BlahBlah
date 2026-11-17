import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setKeyframe,
  setKeyframeValue,
  setKeyframeCurve,
  getFieldKeyframes,
  evaluateField,
} from './keyframes.js';

const entityWith = (keyframes) => ({ id: 'e1', components: [], keyframes });

test('setKeyframeValue creates a keyframe when none is at that time', () => {
  const e = entityWith(undefined);
  const kfs = setKeyframeValue(e, 'script:s1', 'speed', 1, 5);
  const list = kfs['script:s1'].speed;
  assert.equal(list.length, 1);
  assert.equal(list[0].time, 1);
  assert.equal(list[0].value, 5);
});

test('setKeyframeValue updates the keyframe at that time, keeping id and curve', () => {
  let e = entityWith(setKeyframe(entityWith(undefined), 'Transform', 'x', 1, 10));
  const id = getFieldKeyframes(e, 'Transform', 'x')[0].id;
  const cp1 = { x: 0.1, y: 0.2 };
  const cp2 = { x: 0.9, y: 0.8 };
  e = entityWith(setKeyframeCurve(e, 'Transform', 'x', id, cp1, cp2));

  // A drag tick lands within half a frame of the existing key.
  const next = setKeyframeValue(e, 'Transform', 'x', 1 + 1 / 120, 42);
  const list = next.Transform.x;
  assert.equal(list.length, 1, 'updated in place, not duplicated');
  assert.equal(list[0].id, id, 'id preserved so a selected key stays selected');
  assert.equal(list[0].value, 42);
  assert.equal(list[0].time, 1, 'time is not moved');
  assert.deepEqual(list[0].cp1, cp1, 'easing preserved');
  assert.deepEqual(list[0].cp2, cp2);
});

test('setKeyframeValue adds a second key between existing ones and evaluates', () => {
  let e = entityWith(setKeyframe(entityWith(undefined), 'Transform', 'x', 0, 0));
  e = entityWith(setKeyframe(e, 'Transform', 'x', 2, 100));
  e = entityWith(setKeyframeValue(e, 'Transform', 'x', 1, 500));
  assert.equal(getFieldKeyframes(e, 'Transform', 'x').length, 3);
  assert.equal(evaluateField(e, 'Transform', 'x', 1), 500);
});

test('setKeyframeValue does not mutate the input entity', () => {
  const e = entityWith(setKeyframe(entityWith(undefined), 'Transform', 'x', 1, 10));
  const before = JSON.stringify(e);
  setKeyframeValue(e, 'Transform', 'x', 1, 99);
  assert.equal(JSON.stringify(e), before);
});