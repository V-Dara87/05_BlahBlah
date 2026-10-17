import test from 'node:test';
import assert from 'node:assert/strict';

import {
  precompileWithBundler,
  compileScriptModule,
  getScriptError,
  extractScriptProps,
  detectScriptKind,
} from './scriptRunner.js';
import { clearConsole } from './scriptConsole.js';

let n = 0;
/** Unique source per test: the compile caches are keyed by the source string. */
const uniq = (code) => `${code}\n// strict-test-${++n}`;

async function compile(code, name = 'T.jsx') {
  clearConsole();
  const src = uniq(code);
  const res = await precompileWithBundler(src, null, name);
  return { src, res, mod: res.ok ? compileScriptModule(src, name) : null };
}

test('strict mode: assigning to an undeclared variable is a runtime error, not a silent global', async () => {
  const { mod } = await compile(`
    export default class A {
      onUpdate() { speeed = 3; }
    }
  `);
  assert.throws(() => new mod().onUpdate(), ReferenceError);
  assert.equal(globalThis.speeed, undefined);
});

test('a script may declare its own self/window/React without a redeclaration error', async () => {
  const { res, mod } = await compile(`
    const self = { ok: true };
    const window = 1;
    const React = 'mine';
    export default class A { v() { return [self.ok, window, React]; } }
  `);
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(new mod().v(), [true, 1, 'mine']);
});

test('sandbox: storage and the desktop bridge are unreachable from a script', async () => {
  const { res, mod } = await compile(`
    export default class A {
      read() { return localStorage.getItem('x'); }
      viaWindow() { return window.__TAURI_INTERNALS__; }
      viaGlobalThis() { return globalThis.indexedDB; }
      ok() { return typeof window.setTimeout; }
    }
  `);
  assert.equal(res.ok, true, res.error);
  const a = new mod();
  assert.throws(() => a.read(), /"localStorage" is blocked/);
  assert.throws(() => a.viaWindow(), /"__TAURI_INTERNALS__" is blocked/);
  assert.throws(() => a.viaGlobalThis(), /"indexedDB" is blocked/);
  assert.equal(a.ok(), 'function');
});

test('a misspelled hook is a compile error, and the script never runs', async () => {
  const { src, res, mod } = await compile(`
    export default class A { onupdate() {} }
  `);
  assert.equal(res.ok, false);
  assert.match(res.error, /did you mean 'onUpdate'/);
  assert.equal(mod, null);
  assert.match(getScriptError(src), /Unknown method 'onupdate'/);
});

test('with-statements and other sloppy-mode-only syntax are rejected', async () => {
  const { res } = await compile(`
    export default class A { m(o) { with (o) { return x; } } }
  `);
  assert.equal(res.ok, false);
});

test('props are found in the function style: canvasScript({ props: {...} })', () => {
  const code = `
    import { canvasScript } from '@blahblah/sdk';
    export default canvasScript({
      props: { size: num(40, { min: 10, max: 200 }), tint: color('#38bdf8') },
      draw({ ctx, props }) { ctx.fillStyle = props.tint; },
    });
  `;
  const names = extractScriptProps(code).map((f) => [f.name, f.type, f.defaultVal]);
  assert.deepEqual(names, [['size', 'number', 40], ['tint', 'color', '#38bdf8']]);
});

test('props: the class style still wins when both appear', () => {
  const code = `class A { static props = { a: num(1) }; }\nfoo({ props: { b: num(2) } })`;
  assert.deepEqual(extractScriptProps(code).map((f) => f.name), ['a']);
});

test('script kind: canvasScript is canvas, motionScript is motion', () => {
  assert.equal(detectScriptKind(`export default canvasScript({ draw() {} })`), 'canvas');
  assert.equal(detectScriptKind(`export default motionScript({ update() {} })`), 'motion');
});