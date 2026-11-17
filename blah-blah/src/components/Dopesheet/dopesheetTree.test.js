import test from 'node:test';
import assert from 'node:assert/strict';
import { isKeyframeableField, buildTransformItems, buildFieldItems } from './dopesheetTree.js';
import { TRANSFORM_FIELD_GROUPS } from '../../engine/transformSchema.js';

const num = (name, extra = {}) => ({ name, type: 'number', defaultVal: 0, ...extra });

test('isKeyframeableField mirrors the Inspector rule', () => {
  for (const t of ['number', 'boolean', 'color', 'select', 'string', 'textarea']) {
    assert.equal(isKeyframeableField({ type: t }), true, t);
  }
  for (const t of ['entity', 'asset', 'struct', 'struct[]', 'array', 'font', 'button', 'number[]']) {
    assert.equal(isKeyframeableField({ type: t }), false, t);
  }
});

test('Transform is a flat list with plain labels', () => {
  const items = buildTransformItems(TRANSFORM_FIELD_GROUPS);
  assert.deepEqual(items.map((i) => i.label), [
    'X', 'Y', 'Rotation', 'Scale X', 'Scale Y', 'Pivot X', 'Pivot Y', 'Opacity', 'Speed',
  ]);
  assert.deepEqual(items.map((i) => i.field.name), [
    'x', 'y', 'rotation', 'scaleX', 'scaleY', 'pivotX', 'pivotY', 'opacity', 'speed',
  ]);
});

test('buildFieldItems keeps declaration order, ignores box/foldout, drops non-animatable', () => {
  const items = buildFieldItems([
    num('a', { label: 'A' }),
    { name: 'go', type: 'button' },
    num('b', { box: 'Motion' }),
    { name: 'target', type: 'entity' },
    num('c', { foldout: 'Other' }),
  ]);
  assert.deepEqual(items.map((i) => i.field.name), ['a', 'b', 'c']);
  assert.deepEqual(items.map((i) => i.label), ['A', 'b', 'c']);
});