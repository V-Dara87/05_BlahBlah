import test from 'node:test';
import assert from 'node:assert/strict';
import { setKeyframe, setKeyframeCurve, getFieldKeyframes, evaluateField, DEFAULT_CP1, DEFAULT_CP2 } from './keyframes.js';
import {
  CP_Y_MIN, CP_Y_MAX, curveId, curveColorAt, CURVE_PALETTE, isNumericCurve,
  segmentHandles, handleToControlPoint, snapControlPoint, sampleSegment,
  curveExtent, shiftKeyframeValues, niceStep, stepDecimals,
} from './keyframeGraph.js';

const kf = (time, value, extra = {}) => ({ id: `k${time}`, time, value, ...extra });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('curveId is stable and distinguishes track and field', () => {
  assert.equal(curveId('Transform', 'x'), 'Transform::x');
  assert.notEqual(curveId('Transform', 'x'), curveId('script:a', 'x'));
});

test('curveColorAt cycles through the palette and tolerates negatives', () => {
  assert.equal(curveColorAt(0), CURVE_PALETTE[0]);
  assert.equal(curveColorAt(CURVE_PALETTE.length), CURVE_PALETTE[0]);
  assert.equal(curveColorAt(-1), CURVE_PALETTE[CURVE_PALETTE.length - 1]);
});

test('isNumericCurve: needs keys and every value a finite number', () => {
  assert.equal(isNumericCurve([]), false);
  assert.equal(isNumericCurve(undefined), false);
  assert.equal(isNumericCurve([kf(0, 1), kf(1, 2)]), true);
  assert.equal(isNumericCurve([kf(0, 1), kf(1, '#fff')]), false);
  assert.equal(isNumericCurve([kf(0, true)]), false);
  assert.equal(isNumericCurve([kf(0, NaN)]), false);
});

test('segmentHandles places default (linear) handles on the straight line', () => {
  const h = segmentHandles(kf(1, 10), kf(3, 30));
  near(h.out.time, 1 + 0.25 * 2); near(h.out.value, 10 + 0.25 * 20);
  near(h.in.time, 1 + 0.75 * 2); near(h.in.value, 10 + 0.75 * 20);
});

test('segmentHandles honours custom control points incl. overshoot', () => {
  const a = kf(0, 0, { cp1: { x: 0.2, y: 1.2 }, cp2: { x: 0.4, y: 0.8 } });
  const h = segmentHandles(a, kf(2, 10));
  near(h.out.time, 0.4); near(h.out.value, 12);
  near(h.in.time, 0.8); near(h.in.value, 8);
});

test('handleToControlPoint round-trips segmentHandles', () => {
  const a = kf(1, -5, { cp1: { x: 0.31, y: 0.12 }, cp2: { x: 0.77, y: 1.2 } });
  const b = kf(4, 25);
  const h = segmentHandles(a, b);
  const out = handleToControlPoint(a, b, 'out', h.out.time, h.out.value);
  const inn = handleToControlPoint(a, b, 'in', h.in.time, h.in.value);
  near(out.x, 0.31, 1e-3); near(out.y, 0.12, 1e-3);
  near(inn.x, 0.77, 1e-3); near(inn.y, 1.2, 1e-3);
});

test('handleToControlPoint works for a falling segment (negative change)', () => {
  const a = kf(0, 100); const b = kf(2, 0);
  const cp = handleToControlPoint(a, b, 'out', 1, 50);
  near(cp.x, 0.5); near(cp.y, 0.5);
});

test('handleToControlPoint clamps x to 0..1 and y to the Curves tab range', () => {
  const a = kf(0, 0); const b = kf(1, 10);
  const far = handleToControlPoint(a, b, 'out', 99, 9999);
  assert.equal(far.x, 1); assert.equal(far.y, CP_Y_MAX);
  const low = handleToControlPoint(a, b, 'in', -99, -9999);
  assert.equal(low.x, 0); assert.equal(low.y, CP_Y_MIN);
});

test('handleToControlPoint keeps y on a flat segment and x on a zero-length one', () => {
  const flat = handleToControlPoint(kf(0, 5, { cp1: { x: 0.1, y: 0.6 } }), kf(2, 5), 'out', 1, 80);
  near(flat.x, 0.5); near(flat.y, 0.6);
  const zero = handleToControlPoint(kf(1, 0, { cp2: { x: 0.9, y: 0.4 } }), kf(1, 10), 'in', 1, 5);
  near(zero.x, 0.9); near(zero.y, 0.5);
  assert.ok(Number.isFinite(flat.x) && Number.isFinite(flat.y) && Number.isFinite(zero.x) && Number.isFinite(zero.y));
});

test('snapControlPoint snaps to the grid and stays in range', () => {
  assert.deepEqual(snapControlPoint({ x: 0.43, y: 0.98 }), { x: 0.45, y: 1 });
  assert.deepEqual(snapControlPoint({ x: 2, y: -3 }), { x: 1, y: CP_Y_MIN });
});

test('sampleSegment matches the engine evaluator exactly (easing included)', () => {
  const a = kf(0, 0, { cp1: { x: 0.42, y: 0 }, cp2: { x: 0.58, y: 1 } });
  const b = kf(2, 100);
  const e = { keyframes: { T: { f: [a, b] } } };
  const s = sampleSegment(a, b, 10);
  assert.equal(s.length, 11);
  for (const p of s) near(p.value, evaluateField(e, 'T', 'f', p.time), 1e-9);
  assert.equal(s[0].value, 0); assert.equal(s[10].value, 100);
});

test('sampleSegment survives a zero-length segment', () => {
  const s = sampleSegment(kf(1, 0), kf(1, 5), 4);
  assert.ok(s.every((p) => Number.isFinite(p.value)));
});

test('curveExtent includes overshoot beyond the key values', () => {
  const a = kf(0, 0, { cp1: { x: 0.15, y: 1.2 }, cp2: { x: 0.3, y: 1 } });
  const ext = curveExtent([a, kf(1, 10)]);
  assert.ok(ext.max > 10, `expected overshoot, got ${ext.max}`);
  assert.equal(ext.min, 0);
});

test('curveExtent of a single key is that value', () => {
  assert.deepEqual(curveExtent([kf(0, 7)]), { min: 7, max: 7 });
});

test('shiftKeyframeValues moves only selected numeric keys, keeps ids/times/curves', () => {
  let kfs = setKeyframe({ keyframes: {} }, 'Transform', 'x', 0, 10);
  kfs = setKeyframe({ keyframes: kfs }, 'Transform', 'x', 1, 20);
  kfs = setKeyframe({ keyframes: kfs }, 'Transform', 'color', 0, '#ff0000');
  const e = { keyframes: kfs };
  const [k0, k1] = getFieldKeyframes(e, 'Transform', 'x');
  const colorKey = getFieldKeyframes(e, 'Transform', 'color')[0];
  const e2 = { keyframes: setKeyframeCurve(e, 'Transform', 'x', k0.id, { x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }) };
  const next = shiftKeyframeValues(e2, new Set([k0.id, colorKey.id]), 5);
  const [n0, n1] = next.Transform.x;
  assert.equal(n0.value, 15); assert.equal(n0.id, k0.id); assert.deepEqual(n0.cp1, { x: 0.1, y: 0.2 });
  assert.equal(n1.value, 20); assert.equal(n1.id, k1.id);
  assert.equal(next.Transform.color[0].value, '#ff0000');
  assert.equal(e2.keyframes.Transform.x[0].value, 10, 'input must not be mutated');
});

test('shiftKeyframeValues accepts a per-curve delta function', () => {
  const e = { keyframes: { T: { a: [kf(0, 0)], b: [kf(0, 0, { id: 'kb' })] } } };
  const next = shiftKeyframeValues(e, ['k0', 'kb'], (tk, fn) => (fn === 'a' ? 2 : 0));
  assert.equal(next.T.a[0].value, 2);
  assert.equal(next.T.b[0].value, 0);
});

test('shiftKeyframeValues with nothing selected returns the keyframes untouched', () => {
  const e = { keyframes: { T: { a: [kf(0, 1)] } } };
  assert.equal(shiftKeyframeValues(e, new Set(), 3), e.keyframes);
  assert.deepEqual(shiftKeyframeValues({}, new Set(['x']), 3), {});
});

test('niceStep returns 1/2/5 x 10^n and guards bad input', () => {
  assert.equal(niceStep(10, 5), 2);
  assert.equal(niceStep(1, 5), 0.2);
  assert.equal(niceStep(1000, 4), 200);
  assert.equal(niceStep(0, 5), 1);
  assert.equal(niceStep(NaN, 5), 1);
  for (const r of [0.013, 0.7, 3, 42, 880, 12345]) {
    const s = niceStep(r, 6);
    const m = s / Math.pow(10, Math.floor(Math.log10(s)));
    assert.ok([1, 2, 5].some((v) => Math.abs(m - v) < 1e-9), `${r} -> ${s}`);
  }
});

test('stepDecimals', () => {
  assert.equal(stepDecimals(5), 0);
  assert.equal(stepDecimals(0.5), 1);
  assert.equal(stepDecimals(0.2), 1);
  assert.equal(stepDecimals(0.05), 2);
  assert.equal(stepDecimals(0.001), 3);
});

test('default control points are unchanged (guards the engine contract this relies on)', () => {
  assert.deepEqual(DEFAULT_CP1, { x: 0.25, y: 0.25 });
  assert.deepEqual(DEFAULT_CP2, { x: 0.75, y: 0.75 });
});