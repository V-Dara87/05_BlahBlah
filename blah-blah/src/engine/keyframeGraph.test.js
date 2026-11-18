import test from 'node:test';
import assert from 'node:assert/strict';
import { setKeyframe, setKeyframeCurve, getFieldKeyframes, evaluateField, DEFAULT_CP1, DEFAULT_CP2 } from './keyframes.js';
import {
  CP_Y_MIN, CP_Y_MAX, curveId, curveColorAt, CURVE_PALETTE, isNumericCurve,
  segmentHandles, handleToControlPoint, linkedHandleControlPoint, snapControlPoint, sampleSegment,
  curveExtent, shiftKeyframeValues, niceStep, stepDecimals, removeUnusedKeyframes,
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
// --- linked (mirrored) handles -------------------------------------------------
// Shared key b = (2, 10). Segment a -> b arrives at it (a = (0, 0)), segment
// b -> c leaves it (c = (6, -10)).

test('linkedHandleControlPoint: dragging the OUT handle mirrors the IN handle through the key', () => {
  const a = kf(0, 0); const b = kf(2, 10);
  // out handle of b dropped at (3, 15): offset (+1, +5) from b
  const cp2 = linkedHandleControlPoint(a, b, 'in', { time: 2, value: 10 }, { time: 3, value: 15 });
  // in handle must sit at offset (-1, -5): (1, 5) => x 0.5, y 0.5
  near(cp2.x, 0.5, 1e-3); near(cp2.y, 0.5, 1e-3);
  const h = segmentHandles({ ...a, cp2 }, b).in;
  near(h.time, 1, 2e-3); near(h.value, 5, 2e-2);
});

test('linkedHandleControlPoint: dragging the IN handle mirrors the OUT handle through the key', () => {
  const b = kf(2, 10); const c = kf(6, -10);
  // in handle of b dropped at (1, 5): offset (-1, -5) from b
  const cp1 = linkedHandleControlPoint(b, c, 'out', { time: 2, value: 10 }, { time: 1, value: 5 });
  // out handle must sit at (3, 15): x 1/4, y 5 / -20
  near(cp1.x, 0.25, 1e-3); near(cp1.y, -0.25, 1e-3);
});

test('linkedHandleControlPoint: both handles end up collinear with the key', () => {
  const a = kf(0, 0); const b = kf(2, 10); const c = kf(6, -10);
  const drag = { time: 3.2, value: 17 }; // out handle of b
  const cp2 = linkedHandleControlPoint(a, b, 'in', b, drag);
  const inH = segmentHandles({ ...a, cp2 }, b).in;
  const slopeOut = (drag.value - b.value) / (drag.time - b.time);
  const slopeIn = (b.value - inH.value) / (b.time - inH.time);
  near(slopeOut, slopeIn, 0.05);
  assert.ok(inH.time < b.time && drag.time > b.time);
});

test('linkedHandleControlPoint: a short neighbouring segment scales the handle instead of bending it', () => {
  const a = kf(0, 0); const b = kf(2, 10);
  // out handle at offset (+4, +8); the in segment is only 2s long
  const cp2 = linkedHandleControlPoint(a, b, 'in', b, { time: 6, value: 18 });
  near(cp2.x, 0, 1e-3);                     // reaches the previous key's time
  near(cp2.y, 0.6, 1e-3);                   // value offset halved too (-4 of 10)
});

test('linkedHandleControlPoint: overshoot limit scales both axes together', () => {
  const a = kf(0, 0); const b = kf(2, 10);
  // out handle at offset (+0.2, +30): mirrored y would be -2 (limit is CP_Y_MIN)
  const cp2 = linkedHandleControlPoint(a, b, 'in', b, { time: 2.2, value: 40 });
  assert.equal(cp2.y, CP_Y_MIN);
  near(cp2.x, 0.95, 1e-3);                  // x scaled by the same 0.5
});

test('linkedHandleControlPoint: a flat neighbouring segment keeps its y (no slope to match)', () => {
  const a = kf(0, 10, { cp2: { x: 0.6, y: 0.9 } }); const b = kf(2, 10);
  const cp2 = linkedHandleControlPoint(a, b, 'in', b, { time: 3, value: 15 });
  near(cp2.x, 0.5, 1e-3);
  assert.equal(cp2.y, 0.9);
});

// --- removeUnusedKeyframes -----------------------------------------------------
const ent = (fields) => ({ keyframes: { Transform: fields } });

test('removeUnusedKeyframes: drops the middle of a hold but keeps its ends', () => {
  const e = ent({ x: [kf(0, 5), kf(1, 5), kf(2, 5), kf(3, 9)] });
  const r = removeUnusedKeyframes(e, 'Transform', ['x']);
  assert.deepEqual(r.keyframes.Transform.x.map((k) => k.time), [0, 2, 3]);
  assert.deepEqual([...r.removedIds], ['k1']);
});

test('removeUnusedKeyframes: a real A-B-A move is untouched and nothing changes by reference', () => {
  const e = ent({ x: [kf(0, 0), kf(1, 10), kf(2, 0)] });
  const r = removeUnusedKeyframes(e, 'Transform', ['x']);
  assert.equal(r.keyframes, e.keyframes);
  assert.equal(r.removedIds.size, 0);
});

test('removeUnusedKeyframes: a constant field equal to the stored value loses all keys', () => {
  const e = ent({ rotation: [kf(0, 0), kf(2, 0)], x: [kf(0, 0), kf(2, 50)] });
  const r = removeUnusedKeyframes(e, 'Transform', ['rotation', 'x'], (n) => (n === 'rotation' ? 0 : -1));
  assert.deepEqual(r.keyframes.Transform.rotation, []);
  assert.equal(r.keyframes.Transform.x.length, 2);
});

test('removeUnusedKeyframes: a constant field that differs from the stored value keeps one key', () => {
  const e = ent({ scale: [kf(0, 2), kf(1, 2), kf(2, 2)] });
  const r = removeUnusedKeyframes(e, 'Transform', ['scale'], () => 1);
  assert.deepEqual(r.keyframes.Transform.scale.map((k) => k.value), [2]);
  assert.equal(evaluateField(r, 'Transform', 'scale', 1.5), 2);
});

test('removeUnusedKeyframes: only touches the listed fields and works for held (non-number) values', () => {
  const e = ent({ color: [kf(0, '#fff'), kf(1, '#fff'), kf(2, '#fff'), kf(3, '#000')], y: [kf(0, 1), kf(1, 1)] });
  const r = removeUnusedKeyframes(e, 'Transform', ['color']);
  assert.deepEqual(r.keyframes.Transform.color.map((k) => k.time), [0, 2, 3]);
  assert.equal(r.keyframes.Transform.y.length, 2);
});