import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKeyframePreset, presetStats, planPresetApply, applyPresetPlan,
  normalizePreset, serializePresets, parsePresetFile, PRESET_FORMAT,
} from './keyframePresets.js';

const kf = (id, time, value, extra = {}) => ({ id, time, value, ...extra });

// Clip A: Transform (x, y, rotation) + Shape (width, fill)
const targetsA = [
  { trackKey: 'Transform', type: 'Transform', label: 'Transform', fields: [
    { name: 'x', label: 'X', defaultVal: 0 }, { name: 'y', label: 'Y', defaultVal: 0 }, { name: 'rotation', label: 'Rotation', defaultVal: 0 },
  ] },
  { trackKey: 'ShapeRenderer', type: 'ShapeRenderer', label: 'Shape', fields: [
    { name: 'width', label: 'Width', defaultVal: 100 }, { name: 'fill', label: 'Fill', defaultVal: '#fff' },
  ] },
];
const entityA = {
  keyframes: {
    Transform: {
      x: [kf('a', 1, 0), kf('b', 3, 50, { cp1: { x: 0.1, y: 0 }, cp2: { x: 0.9, y: 1 } })],
      y: [kf('c', 1, 5), kf('d', 3, 5)],
      rotation: [kf('e', 9, 90)],
    },
    ShapeRenderer: { width: [kf('f', 2, 100), kf('g', 4, 300)] },
  },
};

test('createKeyframePreset: only selected keys, times relative to the first one', () => {
  const p = createKeyframePreset(entityA, ['a', 'b', 'f'], targetsA, ' Pop ');
  assert.equal(p.format, PRESET_FORMAT);
  assert.equal(p.name, 'Pop');
  assert.equal(p.duration, 2);
  assert.deepEqual(presetStats(p), { keys: 3, params: 2, components: 2 });
  assert.deepEqual(p.tracks[0].fields[0].keyframes.map((k) => k.time), [0, 2]);
  assert.deepEqual(p.tracks[1].fields[0].keyframes.map((k) => k.time), [1]); // 2 - 1
  assert.deepEqual(p.tracks[0].fields[0].keyframes[1].cp1, { x: 0.1, y: 0 });
  assert.equal(p.tracks[1].componentIndex, 1);
  assert.equal(p.tracks[0].fields[0].fieldIndex, 0);
});

test('createKeyframePreset: nothing selected -> null; ids are not stored', () => {
  assert.equal(createKeyframePreset(entityA, [], targetsA, 'x'), null);
  const p = createKeyframePreset(entityA, ['a'], targetsA, 'x');
  assert.equal('id' in p.tracks[0].fields[0].keyframes[0], false);
});

test('plan: same components apply as they are, no issues', () => {
  const p = createKeyframePreset(entityA, ['a', 'b', 'f', 'g'], targetsA, 'p');
  const plan = planPresetApply(p, targetsA);
  assert.equal(plan.issues.length, 0);
  assert.equal(plan.items.length, 2);
  assert.ok(plan.items.every((i) => i.via === 'same'));
});

test('plan: a missing component is a warning, the rest still maps', () => {
  const p = createKeyframePreset(entityA, ['a', 'f'], targetsA, 'p');
  const clipB = [targetsA[0]];
  const plan = planPresetApply(p, clipB);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.unmatchedTracks, 1);
  assert.deepEqual(plan.issues.map((i) => i.kind), ['missing-component']);
});

test('plan: a missing parameter on a matching component is a warning', () => {
  const p = createKeyframePreset(entityA, ['a', 'e'], targetsA, 'p');
  const slim = [{ ...targetsA[0], fields: [targetsA[0].fields[0]] }];
  const plan = planPresetApply(p, slim);
  assert.equal(plan.items.length, 1);
  assert.deepEqual(plan.issues.map((i) => i.kind), ['missing-field']);
});

test('plan byPosition: component N -> component N, parameter N -> parameter N', () => {
  const p = createKeyframePreset(entityA, ['f', 'g'], targetsA, 'p'); // Shape width (component 1, param 0)
  const clipB = [
    targetsA[0],
    { trackKey: 'TextRenderer', type: 'TextRenderer', label: 'Text', fields: [{ name: 'fontSize', label: 'Size', defaultVal: 24 }] },
  ];
  assert.equal(planPresetApply(p, clipB).items.length, 0); // without the option: warning only
  const plan = planPresetApply(p, clipB, { byPosition: true });
  assert.equal(plan.issues.length, 0);
  assert.equal(plan.items[0].trackKey, 'TextRenderer');
  assert.equal(plan.items[0].fieldName, 'fontSize');
  assert.equal(plan.items[0].via, 'position');
});

test('plan byPosition: type mismatch, too few components and a taken target are reported', () => {
  const p = createKeyframePreset(entityA, ['f', 'g', 'a'], targetsA, 'p'); // Shape width + Transform x
  // clip with only a text component at position 0: Transform is missing, Shape (position 1) does not exist
  const clipB = [{ trackKey: 'TextRenderer', type: 'TextRenderer', label: 'Text', fields: [{ name: 'content', label: 'Content', defaultVal: 'hi' }] }];
  const plan = planPresetApply(p, clipB, { byPosition: true });
  assert.equal(plan.items.length, 0);
  assert.ok(plan.issues.some((i) => i.kind === 'type-mismatch'));   // Transform x (number) -> Content (string)
  assert.ok(plan.issues.some((i) => i.kind === 'missing-component')); // no component at position 2
});

test('plan byPosition: does not stack two parts of a preset on one component', () => {
  const clipB = [{ trackKey: 'Transform', type: 'Transform', label: 'Transform', fields: targetsA[0].fields }];
  const preset = createKeyframePreset(entityA, ['a', 'f'], targetsA, 'p');
  preset.tracks[1].componentIndex = 0; // pretend Shape sat at position 0
  const plan = planPresetApply(preset, clipB, { byPosition: true });
  assert.ok(plan.issues.some((i) => i.kind === 'position-taken'));
});

test('applyPresetPlan: lands at startTime, replaces a key at the same time, keeps curves', () => {
  const p = createKeyframePreset(entityA, ['a', 'b'], targetsA, 'p');
  const plan = planPresetApply(p, targetsA);
  const target = { keyframes: { Transform: { x: [kf('old', 10, 99), kf('keep', 20, 1)] } } };
  const { keyframes, count } = applyPresetPlan(target, plan.items, 10);
  assert.equal(count, 2);
  const xs = keyframes.Transform.x;
  assert.deepEqual(xs.map((k) => k.time), [10, 12, 20]);
  assert.equal(xs[0].value, 0);              // the key at 10 was replaced
  assert.ok(xs[0].id !== 'old' && xs[1].id !== xs[0].id);
  assert.deepEqual(xs[1].cp2, { x: 0.9, y: 1 });
  assert.equal(target.keyframes.Transform.x.length, 2); // input untouched
});

test('serialize / parse round trip, and bad input', () => {
  const p = createKeyframePreset(entityA, ['a', 'b', 'f'], targetsA, 'Pop');
  const back = parsePresetFile(serializePresets([p, p]));
  assert.equal(back.length, 2);
  assert.deepEqual(back[0].tracks, p.tracks);
  assert.notEqual(back[0].id, back[1].id);
  assert.equal(parsePresetFile(JSON.stringify(p)).length, 1); // a bare preset
  assert.throws(() => parsePresetFile('nope'), /valid JSON/);
  assert.throws(() => parsePresetFile('{"presets":[{"tracks":[]}]}'), /No keyframe presets/);
});

test('normalizePreset drops broken keyframes and empty parts', () => {
  const n = normalizePreset({
    name: '  ',
    tracks: [
      { trackKey: 'Transform', fields: [{ name: 'x', keyframes: [{ time: 0, value: 1 }, { time: -1, value: 2 }, { time: 'a', value: 3 }, { time: 1, value: {} }] }] },
      { trackKey: 5, fields: [] },
      { trackKey: 'Empty', fields: [{ name: 'y', keyframes: [] }] },
    ],
  });
  assert.equal(n.tracks.length, 1);
  assert.equal(n.tracks[0].fields[0].keyframes.length, 1);
  assert.equal(n.name, 'Imported preset');
});