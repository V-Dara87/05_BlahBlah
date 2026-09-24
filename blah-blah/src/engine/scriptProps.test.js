import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_LABEL_KEY,
  PROP_HELPER_NAMES,
  Presets,
  asset,
  bool,
  button,
  color,
  derivePropLabel,
  entity,
  font,
  group,
  humanizePropName,
  inferPropType,
  num,
  propHelperValues,
  row,
  select,
  text,
} from './scriptProps.js';
import { buildInspectorLayout, entryLabel } from './inspectorAttributes.js';
import { extractScriptProps } from './scriptRunner.js';
import { FLOWCHART_PROPS_ORIGINAL, FLOWCHART_PROPS_REWRITTEN } from './flowchartProps.fixture.js';

/** The field `extractScriptProps` produces for a single-prop script. */
function fieldFor(propSource) {
  const fields = extractScriptProps(`static props = { ${propSource} };`);
  assert.equal(fields.length, 1, `expected exactly one field from ${propSource}`);
  return fields[0];
}

/**
 * Strip the helper marker, so a helper-produced definition can be compared to
 * the literal it is supposed to replace.
 */
function unmarked(def) {
  const { [AUTO_LABEL_KEY]: _marker, ...rest } = def;
  return rest;
}

// ===========================================================================
// The basic helpers return the plain objects literals always did
// ===========================================================================

test('num/bool/color/text/font return the exact hand-written definition', () => {
  assert.deepEqual(unmarked(num(0.3, { min: 0, max: 30, step: 0.05 })), {
    type: 'number',
    default: 0.3,
    min: 0,
    max: 30,
    step: 0.05,
  });
  assert.deepEqual(unmarked(bool(false)), { type: 'boolean', default: false });
  assert.deepEqual(unmarked(color('#38bdf8')), { type: 'color', default: '#38bdf8' });
  assert.deepEqual(unmarked(font('Inter', { label: 'Font' })), {
    type: 'font',
    default: 'Inter',
    label: 'Font',
  });

  // text is a string unless multiline is asked for, and the flag itself is not
  // an attribute the Inspector knows about, so it never reaches the field.
  assert.deepEqual(unmarked(text('hi')), { type: 'string', default: 'hi' });
  assert.deepEqual(unmarked(text('hi', { multiline: true })), { type: 'textarea', default: 'hi' });
  assert.deepEqual(unmarked(text('hi', { multiline: false })), { type: 'string', default: 'hi' });
});

test('select keeps its options, and button carries an action and no value', () => {
  assert.deepEqual(unmarked(select('a', ['a', 'b'], { selectButton: true })), {
    type: 'select',
    default: 'a',
    options: ['a', 'b'],
    selectButton: true,
  });
  assert.deepEqual(unmarked(button('bake', { label: 'Bake' })), {
    type: 'button',
    action: 'bake',
    label: 'Bake',
  });

  const [bake] = extractScriptProps("static props = { bake: button('bake', { label: 'Bake' }) };");
  assert.equal(bake.type, 'button');
  assert.equal(bake.action, 'bake');
  assert.equal(bake.label, 'Bake');
  assert.equal(bake.defaultVal, undefined, 'a button holds no value');
});

test('asset picks no default, exactly like the literal form it replaces', () => {
  assert.deepEqual(unmarked(asset('audio', { label: 'SFX' })), {
    type: 'asset',
    assetType: 'audio',
    label: 'SFX',
  });
  // asset() with no type is still a valid any-asset slot.
  assert.deepEqual(unmarked(asset()), { type: 'asset' });
  // ...and the object form is accepted so `asset({ label })` reads naturally.
  assert.deepEqual(unmarked(asset({ label: 'Image' })), { type: 'asset', label: 'Image' });

  const [slot] = extractScriptProps("static props = { sfx: asset('audio') };");
  assert.equal(slot.type, 'asset');
  assert.equal(slot.assetType, 'audio');
  assert.equal(slot.defaultVal, null, 'a reference slot starts empty');

  // entity() is the counterpart: same reference kind, filtered by component.
  assert.deepEqual(unmarked(entity({ targetComponent: 'AudioSource' })), {
    type: 'entity',
    targetComponent: 'AudioSource',
  });
  const [target] = extractScriptProps(
    "static props = { target: entity({ targetComponent: 'AudioSource', label: 'Audio Track' }) };",
  );
  assert.equal(target.type, 'entity');
  assert.equal(target.targetComponent, 'AudioSource');
  assert.equal(target.label, 'Audio Track');
  assert.equal(target.defaultVal, null);
});

test('type and default cannot be smuggled in through opts', () => {
  // `num(1, { type: 'select', default: 99 })` must still be the number 1:
  // opts carries LAYOUT, and letting it rewrite the helper's own arguments
  // would make the helper lie about what it returns.
  assert.deepEqual(unmarked(num(1, { type: 'select', default: 99 })), { type: 'number', default: 1 });
});

// ===========================================================================
// Labels are derived from the key, not guessed by the helper
// ===========================================================================

test('humanizePropName splits camelCase and separators', () => {
  assert.equal(humanizePropName('flow'), 'Flow');
  assert.equal(humanizePropName('startDelay'), 'Start Delay');
  assert.equal(humanizePropName('animDuration'), 'Anim Duration');
  assert.equal(humanizePropName('fitToDuration'), 'Fit To Duration');
  assert.equal(humanizePropName('offsetX'), 'Offset X');
  assert.equal(humanizePropName('cornerRadius'), 'Corner Radius');
  assert.equal(humanizePropName('node_fill'), 'Node Fill');
  assert.equal(humanizePropName('edge-color'), 'Edge Color');
  // Acronyms are NOT expanded — 'sfx' becomes 'Sfx', not 'SFX'. Guessing at an
  // acronym table would eventually mangle a word; those fields say their label.
  assert.equal(humanizePropName('sfxVolume'), 'Sfx Volume');
  assert.equal(humanizePropName(''), '');
});

test('a helper field gets its label from the key, with opts.unit appended', () => {
  assert.equal(fieldFor('startDelay: num(0.3, { unit: "s" })').label, 'Start Delay (s)');
  assert.equal(fieldFor('padding: num(80, { unit: "px" })').label, 'Padding (px)');
  assert.equal(fieldFor('nodeWidth: num(200, { unit: "px" })').label, 'Node Width (px)');
  assert.equal(fieldFor('animDuration: num(1)').label, 'Anim Duration');
  assert.equal(fieldFor('curved: bool(true)').label, 'Curved');
});

test('an explicit label wins, and unit does not leak into the field', () => {
  const field = fieldFor('gapX: num(90, { unit: "px", label: "Flow Gap" })');
  assert.equal(field.label, 'Flow Gap');
  assert.equal(field.unit, undefined, 'unit is a label hint, not an attribute');
  assert.equal(field[AUTO_LABEL_KEY], undefined, 'the marker is stripped too');
});

test('derivePropLabel leaves anything unmarked completely alone', () => {
  // THE backward-compatibility guarantee: an old-style literal that omits
  // `label` keeps getting its raw key, exactly as before the helpers existed.
  const literal = { type: 'number', default: 1 };
  assert.equal(derivePropLabel('startDelay', literal), literal, 'same object, untouched');
  assert.equal(fieldFor('startDelay: { type: "number", default: 1 }').label, 'startDelay');
  assert.equal(fieldFor('startDelay: 1').label, 'startDelay');
  assert.equal(fieldFor('tags: ["a"]').label, 'tags');

  // Non-objects are returned as-is rather than being wrapped.
  assert.equal(derivePropLabel('x', ['a', 'b']).length, 2);
  assert.equal(derivePropLabel('x', undefined), undefined);
});

test('inferPropType matches what the shorthand form already inferred', () => {
  assert.equal(inferPropType(2.5), 'number');
  assert.equal(inferPropType(true), 'boolean');
  assert.equal(inferPropType('#ff0000'), 'color');
  assert.equal(inferPropType('hi'), 'string');
  // The shorthand path in extractScriptProps uses the same three- or six-digit
  // hex test, so `group`/`row` normalisation cannot disagree with it.
  assert.equal(fieldFor('tint: "#0af"').type, 'color');
});

// ===========================================================================
// group / row
// ===========================================================================

test('group applies one tab (and box) to a whole block, preserving order', () => {
  const block = group('Timing', { box: 'Delays' }, {
    startDelay: num(0.3),
    stepDelay: num(0.45),
  });
  assert.deepEqual(Object.keys(block), ['startDelay', 'stepDelay'], 'order is preserved');
  for (const def of Object.values(block)) {
    assert.equal(def.tab, 'Timing');
    assert.equal(def.box, 'Delays');
  }

  // The two-argument form (no attributes) is the common case.
  const plain = group('Flow', { direction: select('horizontal', ['horizontal', 'vertical']) });
  assert.equal(plain.direction.tab, 'Flow');
  assert.equal(plain.direction.box, undefined);
});

test('group overrides a tab already on the field, which is what makes it compose with presets', () => {
  const regrouped = group('Extra', Presets.timing);
  for (const def of Object.values(regrouped)) {
    assert.equal(def.tab, 'Extra');
  }
  // ...and the presets themselves are untouched (group works on copies).
  assert.equal(Presets.timing.startDelay.tab, 'Timing');
  assert.notEqual(regrouped.startDelay, Presets.timing.startDelay);
});

test('group/row normalise shorthand values so they can carry layout', () => {
  const block = row({ speed: 2.5, tint: '#ff0000', on: true, name: 'x' });
  assert.deepEqual(Object.keys(block), ['speed', 'tint', 'on', 'name']);
  assert.equal(block.speed.type, 'number');
  assert.equal(block.tint.type, 'color');
  assert.equal(block.on.type, 'boolean');
  assert.equal(block.name.type, 'string');
  for (const def of Object.values(block)) assert.equal(def.inline, true);
});

test('row shares one Inspector row, and a non-inline field closes it', () => {
  const fields = extractScriptProps(`
    static props = {
      ...row({ startDelay: num(0.3), stepDelay: num(0.45) }),
      animDuration: num(0.45),
      ...row({ nodeFill: color('#1e293b'), nodeStroke: color('#38bdf8') }),
    };
  `);
  const { tabs } = buildInspectorLayout(fields, {});
  const [entries] = tabs[0].sections[0].entries;
  assert.equal(entries.kind, 'row');
  assert.deepEqual(entries.fields.map((f) => f.name), ['startDelay', 'stepDelay']);
  assert.equal(tabs[0].sections[0].entries[1].kind, 'field', 'the non-inline field starts a new row');
  assert.equal(tabs[0].sections[0].entries[2].kind, 'row');
  assert.equal(entryLabel(tabs[0].sections[0].entries[0]), 'Start Delay', 'a row is labelled by its first field');
});

// ===========================================================================
// Presets
// ===========================================================================

test('the presets cover the reusable blocks, with their shipped defaults', () => {
  assert.deepEqual(Object.keys(Presets), ['timing', 'audioFx', 'typography', 'colors', 'fitTransform']);
  assert.deepEqual(
    Object.fromEntries(Object.entries(Presets).map(([name, block]) => [name, Object.keys(block).length])),
    { timing: 8, audioFx: 4, typography: 3, colors: 6, fitTransform: 6 },
  );

  // Defaults are the Flowchart's, unchanged. The helper must not "improve" one.
  assert.equal(Presets.timing.startDelay.default, 0.3);
  assert.equal(Presets.timing.startDelay.max, 30);
  assert.equal(Presets.timing.ease.default, 'outBack');
  assert.deepEqual(Presets.timing.ease.options, ['linear', 'outCubic', 'outBack', 'outElastic', 'outBounce', 'inOutCubic']);
  assert.equal(Presets.audioFx.sfxVolume.default, 0.7);
  assert.equal(Presets.audioFx.previewSfx.action, 'testSfx');
  assert.equal(Presets.colors.nodeStroke.default, '#38bdf8');
  assert.equal(Presets.typography.fontFamily.default, 'Inter');
  assert.equal(Presets.fitTransform.padding.default, 80);
  assert.equal(Presets.fitTransform.offsetX.min, -3000);
});

test('a later key overrides a preset field, and keeps its place in the tab', () => {
  const fields = extractScriptProps(`
    static props = {
      ...Presets.timing,
      startDelay: num(1.5, { unit: 's' }),
    };
  `);
  const names = fields.map((f) => f.name);
  assert.equal(names[0], 'fitToDuration');
  assert.equal(names[1], 'startDelay', 'the override re-uses the preset key slot, so it does not reshuffle the UI');

  const startDelay = fields[1];
  assert.equal(startDelay.defaultVal, 1.5, 'the override wins');
  assert.equal(startDelay.label, 'Start Delay (s)');
  // A field added on the end really is new, and the preset is not mutated.
  assert.ok(!names.includes('extra'));
  assert.equal(Presets.timing.startDelay.default, 0.3, 'the preset itself is untouched');
});

test('presets and plain literals mix in one object without either changing', () => {
  const fields = extractScriptProps(`
    static props = {
      ...Presets.colors,
      custom: { type: 'string', default: 'plain literal', label: 'Custom' },
      speed: num(2),
    };
  `);
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
  assert.equal(byName.nodeFill.defaultVal, '#1e293b');
  assert.equal(byName.nodeFill.box, 'Colors');
  assert.equal(byName.custom.type, 'string');
  assert.equal(byName.custom.label, 'Custom');
  assert.equal(byName.speed.label, 'Speed', 'the helper field is still labelled');
});

// ===========================================================================
// Availability in the props evaluator
// ===========================================================================

test('the helpers are in scope when the props object is evaluated', () => {
  // Before the helpers were injected, every one of these threw inside
  // `new Function`, and extractScriptProps fell through to its regex fallback —
  // which does not understand select/asset/struct and would return a wrong or
  // partial schema with no error visible in the UI.
  const fields = extractScriptProps(`
    static props = {
      delay: num(0.5, { min: 0, max: 5 }),
      on: bool(true),
      tint: color('#123456'),
      note: text('hi', { multiline: true }),
      mode: select('a', ['a', 'b']),
      sfx: asset('audio'),
      face: font('Inter'),
      go: button('run'),
    };
  `);
  assert.deepEqual(
    fields.map((f) => [f.name, f.type]),
    [
      ['delay', 'number'],
      ['on', 'boolean'],
      ['tint', 'color'],
      ['note', 'textarea'],
      ['mode', 'select'],
      ['sfx', 'asset'],
      ['face', 'font'],
      ['go', 'button'],
    ],
  );
  assert.deepEqual(fields.find((f) => f.name === 'mode').options, ['a', 'b']);
  assert.equal(fields.find((f) => f.name === 'sfx').assetType, 'audio');
});

test('a script with real imports still declares its props with the helpers', () => {
  // Import statements are irrelevant to the props evaluator (it slices out the
  // object literal), so a bundled script — Flowchart imports d3 — resolves
  // helpers here exactly like an import-free one.
  const fields = extractScriptProps(`
    import * as d3 from 'd3';
    export default class Chart {
      static props = { ...Presets.timing, width: num(200) };
      onMount() {}
    }
  `);
  assert.equal(fields.length, 9);
  assert.equal(fields[8].label, 'Width');
});

test('PROP_HELPER_NAMES and propHelperValues stay in step', () => {
  // scriptRunner.js spreads the names as `new Function` parameters and passes
  // the values positionally, so a mismatch here would silently bind the wrong
  // helper (or undefined) in every script.
  assert.deepEqual(PROP_HELPER_NAMES, [
    'num', 'bool', 'color', 'text', 'select', 'asset', 'entity', 'font', 'button', 'group', 'row', 'Presets',
  ]);
  const values = propHelperValues();
  assert.equal(values.length, PROP_HELPER_NAMES.length);
  const table = { num, bool, color, text, select, asset, entity, font, button, group, row, Presets };
  PROP_HELPER_NAMES.forEach((name, i) => assert.equal(values[i], table[name], `${name} is bound in order`));
});

// ===========================================================================
// The Flowchart rewrite is a pure refactor
// ===========================================================================

test('the rewritten Flowchart props produce byte-identical Inspector fields', () => {
  const before = extractScriptProps(FLOWCHART_PROPS_ORIGINAL);
  const after = extractScriptProps(FLOWCHART_PROPS_REWRITTEN);

  assert.ok(before.length > 30, 'the fixture really declares the whole props block');
  assert.deepEqual(after, before);
});

test('the rewritten Flowchart props lay out identically', () => {
  // Same tabs, same boxes in the same order, same inline rows. deepEqual on the
  // fields above already implies this, but the layout is what the user SEES, so
  // it is asserted directly rather than left as an inference.
  const before = buildInspectorLayout(extractScriptProps(FLOWCHART_PROPS_ORIGINAL), {});
  const after = buildInspectorLayout(extractScriptProps(FLOWCHART_PROPS_REWRITTEN), {});

  assert.deepEqual(after, before);
  assert.deepEqual(before.tabs.map((t) => t.name), ['Flow', 'Timing', 'Audio FX', 'Style']);
  assert.deepEqual(
    before.tabs[3].sections.map((s) => s.name),
    ['Dimensions', 'Transform', 'Colors', 'Typography', null],
    'the Style tab still reads Dimensions -> Transform -> Colors -> Typography -> plain',
  );
});
