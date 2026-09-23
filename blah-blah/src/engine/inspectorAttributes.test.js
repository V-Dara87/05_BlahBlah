import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFieldAttributes,
  subfieldSchema,
  evaluateCondition,
  isFieldVisible,
  isFieldEnabled,
  buildInspectorLayout,
  entryLabel,
} from './inspectorAttributes.js';

test('parseFieldAttributes - is empty for an attribute-free field', () => {
  assert.deepEqual(parseFieldAttributes({ type: 'number', default: 1 }), {});
  assert.deepEqual(parseFieldAttributes(2.5), {});
  assert.deepEqual(parseFieldAttributes(null), {});
});

test('parseFieldAttributes - reads the grouping attributes and their aliases', () => {
  assert.deepEqual(
    parseFieldAttributes({ box: 'Motion', tab: 'Body', inline: true, title: 'Speed', space: 12 }),
    { box: 'Motion', tab: 'Body', inline: true, title: 'Speed', space: 12 },
  );
  assert.deepEqual(parseFieldAttributes({ boxGroup: 'A' }), { box: 'A' });
  assert.deepEqual(parseFieldAttributes({ foldoutGroup: 'B' }), { foldout: 'B' });
  assert.deepEqual(parseFieldAttributes({ horizontal: true }), { inline: true });
});

test('parseFieldAttributes - space accepts true (default gap) or a pixel count', () => {
  assert.deepEqual(parseFieldAttributes({ space: true }), { space: 6 });
  assert.deepEqual(parseFieldAttributes({ space: 0 }), {});
});

test('parseFieldAttributes - reads condition, toggle and enum attributes', () => {
  assert.deepEqual(
    parseFieldAttributes({
      showIf: 'enabled',
      disableIf: 'locked',
      toggleLeft: true,
      enumButtons: true,
    }),
    { showIf: 'enabled', disableIf: 'locked', toggleLeft: true, selectButton: true },
  );
});

test('parseFieldAttributes - a group controller accepts the Odin spellings', () => {
  assert.deepEqual(parseFieldAttributes({ controls: 'Motion' }), { controls: 'Motion' });
  assert.deepEqual(parseFieldAttributes({ toggleGroup: 'Motion' }), { controls: 'Motion' });
  assert.deepEqual(parseFieldAttributes({ group: 'Motion' }), { controls: 'Motion' });
});

test('parseFieldAttributes - normalises both button spellings', () => {
  assert.deepEqual(parseFieldAttributes({ button: 'bake' }), {
    button: { label: 'bake', action: 'bake' },
  });
  assert.deepEqual(
    parseFieldAttributes({ button: { label: 'Bake Curves', action: 'bake', variant: 'primary' } }),
    { button: { label: 'Bake Curves', action: 'bake', variant: 'primary' } },
  );
  assert.deepEqual(parseFieldAttributes({ button: { label: 'no action' } }), {});
});

test('subfieldSchema - applies attributes to struct subfields too', () => {
  const schema = subfieldSchema({
    speed: { type: 'number', default: 2, label: 'Speed', showIf: 'on', inline: true },
    plain: 5,
  });
  assert.equal(schema.length, 2);
  assert.equal(schema[0].label, 'Speed');
  assert.equal(schema[0].showIf, 'on');
  assert.equal(schema[0].inline, true);
  assert.deepEqual(schema[1], { name: 'plain', label: 'plain', type: 'number', defaultVal: 5 });
});

test('evaluateCondition - runs against sibling prop values', () => {
  const values = { enabled: true, speed: 4, mode: 'ease' };
  assert.equal(evaluateCondition('enabled', values), true);
  assert.equal(evaluateCondition('enabled && speed > 2', values), true);
  assert.equal(evaluateCondition("mode === 'linear'", values), false);
  assert.equal(evaluateCondition('!enabled', values), false);
});

test('evaluateCondition - a broken condition never hides anything', () => {
  const values = { speed: 4 };
  const original = console.warn;
  console.warn = () => {};
  try {
    // Compile error, and a reference to something that does not exist.
    assert.equal(evaluateCondition('speed >>>', values), undefined);
    assert.equal(evaluateCondition('missingThing.x', values), undefined);
  } finally {
    console.warn = original;
  }
});

test('evaluateCondition - accepts a function condition', () => {
  const values = { speed: 4 };
  assert.equal(evaluateCondition((v) => v.speed > 2, values), true);
});

test('isFieldVisible - showIf and hideIf', () => {
  const values = { on: false, hidden: true };
  assert.equal(isFieldVisible({ name: 'a' }, values), true);
  assert.equal(isFieldVisible({ name: 'a', showIf: 'on' }, values), false);
  assert.equal(isFieldVisible({ name: 'a', hideIf: 'hidden' }, values), false);
  // A condition that cannot be evaluated leaves the field shown.
  assert.equal(isFieldVisible({ name: 'a', showIf: 'nonsense >>>' }, values), true);
});

test('isFieldEnabled - enableIf and disableIf', () => {
  const values = { on: false, locked: true };
  assert.equal(isFieldEnabled({ name: 'a' }, values), true);
  assert.equal(isFieldEnabled({ name: 'a', enableIf: 'on' }, values), false);
  assert.equal(isFieldEnabled({ name: 'a', disableIf: 'locked' }, values), false);
});

test('buildInspectorLayout - plain fields stay single rows in order', () => {
  const fields = [
    { name: 'a', label: 'A' },
    { name: 'b', label: 'B' },
  ];
  const layout = buildInspectorLayout(fields, {});
  assert.equal(layout.isEmpty, false);
  assert.equal(layout.tabs.length, 1);
  assert.equal(layout.tabs[0].name, '');
  assert.equal(layout.tabs[0].sections.length, 1);
  const [section] = layout.tabs[0].sections;
  assert.equal(section.kind, 'plain');
  assert.deepEqual(section.entries.map((e) => e.kind), ['field', 'field']);
  assert.deepEqual(section.entries.map(entryLabel), ['A', 'B']);
});

test('buildInspectorLayout - hidden fields are dropped, empty tabs disappear', () => {
  const fields = [
    { name: 'a', label: 'A' },
    { name: 'b', label: 'B', tab: 'Extras', showIf: 'a' },
  ];
  const layout = buildInspectorLayout(fields, { a: false });
  assert.equal(layout.tabs.length, 1, 'the tab whose only field is hidden should be gone');
  assert.equal(layout.tabs[0].name, '');
  assert.deepEqual(layout.visibleFields.map((f) => f.name), ['a']);
});

test('buildInspectorLayout - a tab appears once it has visible fields', () => {
  const fields = [
    { name: 'a', label: 'A' },
    { name: 'b', label: 'B', tab: 'Extras', showIf: 'a' },
  ];
  const layout = buildInspectorLayout(fields, { a: true });
  assert.deepEqual(layout.tabs.map((t) => t.name), ['', 'Extras']);
  assert.equal(layout.tabs[1].sections[0].entries[0].field.name, 'b');
});

test('buildInspectorLayout - box members group by name from wherever they are declared', () => {
  const fields = [
    { name: 'a', label: 'A', box: 'Stats' },
    { name: 'b', label: 'B' },
    { name: 'c', label: 'C', box: 'Stats' },
  ];
  const [tab] = buildInspectorLayout(fields, {}).tabs;
  assert.deepEqual(tab.sections.map((s) => [s.kind, s.name]), [
    ['box', 'Stats'],
    ['plain', null],
  ]);
  const stats = tab.sections[0];
  assert.deepEqual(stats.entries.map((e) => e.field.name), ['a', 'c']);
  assert.deepEqual(tab.sections[1].entries.map((e) => e.field.name), ['b']);
});

test('buildInspectorLayout - foldouts are their own kind and can nest under a tab', () => {
  const fields = [
    { name: 'a', label: 'A', tab: 'T', foldout: 'Advanced' },
    { name: 'b', label: 'B', tab: 'T', foldout: 'Advanced' },
  ];
  const [tab] = buildInspectorLayout(fields, {}).tabs;
  assert.equal(tab.name, 'T');
  assert.equal(tab.sections.length, 1);
  assert.equal(tab.sections[0].kind, 'foldout');
  assert.equal(tab.sections[0].entries.length, 2);
});

test('buildInspectorLayout - title and space become their own entries', () => {
  const fields = [{ name: 'a', label: 'A', title: 'Heading', space: 10 }];
  const [entry] = buildInspectorLayout(fields, {}).tabs[0].sections[0].entries;
  assert.deepEqual(entry, { kind: 'title', key: 'title:a', label: 'Heading' });
});

test('buildInspectorLayout - runs of inline fields collapse into one row', () => {
  const fields = [
    { name: 'x', label: 'X', inline: true },
    { name: 'y', label: 'Y', inline: true },
    { name: 'z', label: 'Z' },
    { name: 'w', label: 'W', inline: true },
  ];
  const entries = buildInspectorLayout(fields, {}).tabs[0].sections[0].entries;
  assert.deepEqual(entries.map((e) => e.kind), ['row', 'field', 'row']);
  assert.deepEqual(entries[0].fields.map((f) => f.name), ['x', 'y']);
  assert.equal(entryLabel(entries[0]), 'X');
  assert.deepEqual(entries[2].fields.map((f) => f.name), ['w']);
});

test('buildInspectorLayout - a boolean can control a group, disabling its members', () => {
  const fields = [
    { name: 'on', label: 'Motion', type: 'boolean', box: 'Motion', controls: 'Motion' },
    { name: 'amount', label: 'Amount', type: 'number', box: 'Motion' },
  ];
  const [section] = buildInspectorLayout(fields, { on: true }).tabs[0].sections;
  assert.deepEqual(section.controller, { name: 'on', label: 'Motion' });
  assert.equal(section.entries.every((e) => e.enabled === undefined || e.enabled === true), true);
});

test('buildInspectorLayout - a controller declared before its group still binds', () => {
  const fields = [
    { name: 'on', label: 'Motion', type: 'boolean', controls: 'Motion' },
    { name: 'amount', label: 'Amount', type: 'number', box: 'Motion' },
  ];
  const [tab] = buildInspectorLayout(fields, { on: true }).tabs;
  // The boolean is not in the box, so it keeps its own row and the box still
  // gets a header switch to control it.
  assert.deepEqual(tab.sections[0].entries.map((e) => e.kind), ['field']);
  assert.deepEqual(tab.sections[1].controller, { name: 'on', label: 'Motion' });
  assert.equal(tab.sections[1].name, 'Motion');
});

test('buildInspectorLayout - a non-boolean cannot control a group', () => {
  const fields = [
    { name: 'amount', label: 'Amount', type: 'number', controls: 'Motion' },
    { name: 'speed', label: 'Speed', type: 'number', box: 'Motion' },
  ];
  const [tab] = buildInspectorLayout(fields, {}).tabs;
  assert.equal(tab.sections[0].controller, null);
});

test('buildInspectorLayout - an inline row reports enabled only when all its fields are', () => {
  const fields = [
    { name: 'x', inline: true },
    { name: 'y', inline: true, disableIf: 'locked' },
  ];
  const [row] = buildInspectorLayout(fields, { locked: true }).tabs[0].sections[0].entries;
  assert.equal(row.kind, 'row');
  assert.equal(row.enabled, false);
});

test('buildInspectorLayout - an empty schema is empty, not a stray empty tab', () => {
  const layout = buildInspectorLayout([], {});
  assert.equal(layout.isEmpty, true);
  assert.deepEqual(layout.tabs, []);
  assert.equal(buildInspectorLayout(null, {}).isEmpty, true);
});
