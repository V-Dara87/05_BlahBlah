import test from 'node:test';
import assert from 'node:assert/strict';

import { canvasScript, motionScript, CanvasComponent, MotionScript } from '../../packages/blahblah-sdk/index.js';

/** A recording stand-in for CanvasRenderingContext2D. */
function fakeCtx() {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_t, key) => (key === 'calls' ? calls : (...a) => { calls.push([String(key), ...a]); }),
    set: () => true,
  });
  return ctx;
}

/** Mount a canvasScript class against a fake canvas, the way CanvasRenderer does. */
function mount(Script, props = {}) {
  const ctx = fakeCtx();
  const inst = new Script();
  inst.onMount({ container: null, canvasWidth: 800, canvasHeight: 600, props });
  inst.ctx = ctx; // container is null in this test, so supply the context directly
  return { inst, ctx };
}

test('canvasScript builds a CanvasComponent subclass that carries its props', () => {
  const props = { size: { type: 'number', default: 10 } };
  const S = canvasScript({ props, draw() {} });
  assert.ok(new S() instanceof CanvasComponent);
  assert.equal(S.props, props);
});

test('draw receives ctx/width/height/time/props, clears first, and is centered by default', () => {
  let seen;
  const S = canvasScript({ draw(frame) { seen = frame; } });
  const { inst, ctx } = mount(S);
  inst.onUpdate({ time: 1.5, canvasWidth: 800, canvasHeight: 600, props: { a: 1 } });
  assert.equal(seen.ctx, ctx);
  assert.equal(seen.width, 800);
  assert.equal(seen.height, 600);
  assert.equal(seen.time, 1.5);
  assert.deepEqual(seen.props, { a: 1 });
  const names = ctx.calls.map((c) => c[0]);
  assert.deepEqual(names, ['clearRect', 'save', 'translate', 'restore']);
  assert.deepEqual(ctx.calls[2], ['translate', 400, 300]);
});

test("origin: 'top-left' skips the translate, clear: false skips the clear", () => {
  const S = canvasScript({ origin: 'top-left', clear: false, draw() {} });
  const { inst, ctx } = mount(S);
  inst.onUpdate({ time: 0, canvasWidth: 800, canvasHeight: 600, props: {} });
  assert.deepEqual(ctx.calls.map((c) => c[0]), ['save', 'restore']);
});

test('the context is restored even when draw throws', () => {
  const S = canvasScript({ draw() { throw new Error('boom'); } });
  const { inst, ctx } = mount(S);
  assert.throws(() => inst.onUpdate({ time: 0, canvasWidth: 8, canvasHeight: 8, props: {} }), /boom/);
  assert.equal(ctx.calls.at(-1)[0], 'restore');
});

test('`this` is the instance, so setup state is visible in draw', () => {
  let seen;
  const S = canvasScript({
    setup() { this.particles = [1, 2, 3]; },
    draw() { seen = this.particles; },
  });
  const { inst } = mount(S);
  inst.onUpdate({ time: 0, canvasWidth: 8, canvasHeight: 8, props: {} });
  assert.deepEqual(seen, [1, 2, 3]);
});

test('seek and cleanup hooks are wired', () => {
  const log = [];
  const S = canvasScript({ draw() {}, seek({ time }) { log.push(['seek', time]); }, cleanup() { log.push('cleanup'); } });
  const { inst } = mount(S);
  inst.onSeek({ time: 7, props: {} });
  inst.onUnmount({});
  assert.deepEqual(log, [['seek', 7], 'cleanup']);
  assert.equal(inst.ctx, null);
});

test('strict: missing draw, unknown keys (with a suggestion) and wrong types are errors', () => {
  assert.throws(() => canvasScript({}), /missing `draw`/);
  assert.throws(() => canvasScript({ drwa() {} }), /unknown key 'drwa' — did you mean 'draw'/);
  assert.throws(() => canvasScript({ Draw() {} }), /did you mean 'draw'/);
  assert.throws(() => canvasScript({ update() {}, draw() {} }), /unknown key 'update'/);
  assert.throws(() => canvasScript({ draw: 5 }), /'draw' must be a function/);
  assert.throws(() => canvasScript({ draw() {}, props: [] }), /'props' must be an object/);
  assert.throws(() => canvasScript({ draw() {}, origin: 'middle' }), /origin must be/);
  assert.throws(() => canvasScript(), /expects one object/);
  assert.throws(() => canvasScript(() => {}), /expects one object/);
});

test('motionScript maps start/update to onStart/onUpdate and validates its keys', () => {
  const log = [];
  const S = motionScript({
    props: { s: { type: 'number', default: 1 } },
    start(a) { log.push(['start', a.x]); },
    update(a) { log.push(['update', a.x]); },
  });
  const inst = new S();
  assert.ok(inst instanceof MotionScript);
  inst.onStart({ x: 1 });
  inst.onUpdate({ x: 2 });
  assert.deepEqual(log, [['start', 1], ['update', 2]]);
  assert.throws(() => motionScript({}), /add `update/);
  assert.throws(() => motionScript({ updat() {} }), /did you mean 'update'/);
  assert.throws(() => motionScript({ draw() {}, update() {} }), /unknown key 'draw'/);
});

test('props always carry their declared defaults; the Inspector value wins when given', () => {
  let seen;
  const S = canvasScript({
    props: { size: { type: 'number', default: 40 }, tint: { type: 'color', default: '#fff' }, n: 5 },
    draw({ props }) { seen = props; },
  });
  const { inst } = mount(S);
  inst.onUpdate({ time: 0, canvasWidth: 8, canvasHeight: 8 }); // no props at all
  assert.deepEqual(seen, { size: 40, tint: '#fff', n: 5 });
  inst.onUpdate({ time: 0, canvasWidth: 8, canvasHeight: 8, props: { size: 99, tint: undefined } });
  assert.deepEqual(seen, { size: 99, tint: '#fff', n: 5 });
});

test('motionScript fills prop defaults too', () => {
  let seen;
  const S = motionScript({ props: { speed: { type: 'number', default: 2 } }, update({ props }) { seen = props; } });
  new S().onUpdate({});
  assert.deepEqual(seen, { speed: 2 });
});