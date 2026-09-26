import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MathUtils,
  Tween,
  tween,
  wait,
  offset,
  chain,
  all,
  stagger,
  applyAt,
  memoizeByProps,
  shapes,
  svgList,
  mergeManualOverrides,
} from '../packages/blahblah-sdk/index.js';

const approx = (actual, expected, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} ≈ ${expected}`);
};

test('MathUtils.bezier point and tangent match the closed form', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 0, y: 100 };
  const p2 = { x: 100, y: 100 };
  const p3 = { x: 100, y: 0 };

  assert.deepEqual(MathUtils.bezierPointAt(p0, p1, p2, p3, 0), { x: 0, y: 0 });
  assert.deepEqual(MathUtils.bezierPointAt(p0, p1, p2, p3, 1), { x: 100, y: 0 });

  const mid = MathUtils.bezierPointAt(p0, p1, p2, p3, 0.5);
  approx(mid.x, 50);
  approx(mid.y, 75);

  // Tangent at t=0 points straight up (p1 - p0) times 3.
  const tangent = MathUtils.bezierTangentAt(p0, p1, p2, p3, 0);
  approx(tangent.x, 0);
  approx(tangent.y, 300);
});

test('Tween.stagger keeps the scalar form and adds the items form', () => {
  approx(Tween.stagger(2, 0.08), 0.16);
  approx(Tween.stagger(3), 0.3);

  const seq = Tween.stagger([10, 20, 30], (item) => tween({ from: 0, to: item, duration: 1 }), { each: 0.5 });
  // 3 items, each 1s, offset by 0.5s: the last item ends at 0.5*2 + 1 = 2s.
  assert.equal(seq.duration, 2);
  // At t=0.5 item 0 is half-way to 10; item 1 has just started at 0.
  const values = seq.valueAt(0.5);
  approx(values[0], 5);
  approx(values[1], 0);
});

test('chain / all / wait / offset / applyAt compose purely', () => {
  const first = tween({ from: 0, to: 10, duration: 1 });
  const second = tween({ from: 100, to: 200, duration: 1 });
  const seq = chain(first, wait(0.5), second);

  assert.equal(seq.duration, 2.5);
  approx(seq.valueAt(0.5)[0], 5);
  assert.equal(seq.valueAt(1)[1], undefined);
  approx(seq.valueAt(2.5)[2], 200);

  const par = all(tween({ from: 0, to: 1, duration: 1 }), tween({ from: 0, to: 2, duration: 2 }));
  assert.equal(par.duration, 2);
  const parAt1 = par.valueAt(1);
  approx(parAt1[0], 1);
  approx(parAt1[1], 1);

  const shifted = offset(0.25, tween({ from: 0, to: 1, duration: 1 }));
  assert.equal(shifted.duration, 1.25);
  approx(shifted.valueAt(0.25), 0);
  approx(shifted.valueAt(1.25), 1);

  let seen = null;
  const returned = applyAt(first, 0.5, (value) => { seen = value; });
  approx(seen, 5);
  approx(returned, 5);
});

test('stagger delays each item by i * each and accepts held values', () => {
  const seq = stagger(['a', 'b', 'c'], (item, i, delay) => tween({ from: delay, to: delay + 1, duration: 1 }), { each: 0.25 });
  assert.equal(seq.duration, 1.5);
  approx(seq.valueAt(0)[0], 0);
  approx(seq.valueAt(0.25)[1], 0.25);
  const mid = seq.valueAt(0.5);
  approx(mid[0], 0.5);
  approx(mid[1], 0.5);
  approx(mid[2], 0.5);
});

test('memoizeByProps rebuilds only when the chosen keys change', () => {
  let builds = 0;
  const build = memoizeByProps((props) => { builds += 1; return props.nodes.length; }, ['nodes']);
  const nodes = [1, 2];
  const wider = [1, 2, 3];
  assert.equal(build({ nodes, edgeStyle: 'a' }), 2);
  assert.equal(build({ nodes, edgeStyle: 'b' }), 2, 'same nodes ref -> cached');
  assert.equal(builds, 1, 'a non-key prop change must not rebuild');
  assert.equal(build({ nodes: wider, edgeStyle: 'a' }), 3);
  assert.equal(builds, 2);
  build.invalidate();
  build({ nodes: wider });
  assert.equal(builds, 3);
});

test('shapes produces SVG paths and draws rounded rects on a 2D ctx', () => {
  assert.match(shapes.roundedRect(0, 0, 10, 10, 0), /^M 0 0 H 10 V 10 H 0 Z$/);
  assert.match(shapes.pill(0, 0, 20, 10), /^M 5 0 H 15/);
  assert.match(shapes.diamond(0, 0, 10, 10), /^M 0 -5 L 5 0 L 0 5 L -5 0 Z$/);
  const arrow = shapes.arrowPath({ x: 0, y: 0 }, { x: 100, y: 0 }, { arrowSize: 10 });
  assert.match(arrow, /^M 0 0 L 90 0 M /);

  const calls = [];
  const ctx = {
    beginPath: () => calls.push('beginPath'),
    moveTo: () => calls.push('moveTo'),
    arcTo: () => calls.push('arcTo'),
    closePath: () => calls.push('closePath'),
    fill: () => calls.push('fill'),
  };
  shapes.drawRoundedRect(ctx, 0, 0, 10, 10, 2);
  assert.ok(calls.includes('fill'));
});

test('mergeManualOverrides merges the listed fields and appends orphans', () => {
  const auto = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 10, y: 0 },
  ];
  const manual = [
    { id: 'a', x: 99, label: 'A' },
    { id: 'c', x: 42 },
  ];
  const merged = mergeManualOverrides(auto, manual, 'id', ['x']);
  assert.deepEqual(merged, [
    { id: 'a', x: 99, y: 0 },
    { id: 'b', x: 10, y: 0 },
    { id: 'c', x: 42 },
  ]);
});

test('svgList keeps nodes by key and cleans up exits', () => {
  const created = [];
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElementNS: (_ns, tag) => {
      const node = { tag, children: [], appendChild: (c) => node.children.push(c), remove() { node.removed = true; } };
      created.push(node);
      return node;
    },
  };
  try {
    const layer = { appended: [], appendChild(c) { layer.appended.push(c); } };
    const enter = (node, datum) => { node.label = datum; };
    const nodes1 = svgList(layer, [{ id: 'a' }, { id: 'b' }], (d) => d.id, { tag: 'circle', enter });
    assert.equal(nodes1.length, 2);
    assert.equal(nodes1[0].tag, 'circle');

    // Re-render with one item removed and one added; the kept node is reused.
    const nodes2 = svgList(layer, [{ id: 'b' }, { id: 'c' }], (d) => d.id, { tag: 'circle', enter });
    assert.equal(nodes2[0], nodes1[1], 'existing node reused by key');
    assert.equal(nodes1[0].removed, true, 'removed node cleaned up');
  } finally {
    globalThis.document = originalDocument;
  }
});
