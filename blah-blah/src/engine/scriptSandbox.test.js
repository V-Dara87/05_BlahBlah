import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLOCKED_GLOBALS,
  ScriptSandboxError,
  createGuardedGlobal,
  findLifecycleTypo,
  assertNoLifecycleTypos,
} from './scriptSandbox.js';

// A stand-in "real global" so the tests do not depend on a browser.
function fakeGlobal() {
  const g = {
    innerWidth: 1280,
    localStorage: { getItem: () => 'secret' },
    __TAURI_INTERNALS__: { invoke: () => 'pwned' },
    requestAnimationFrame(cb) {
      return this === g ? 42 : -1; // proves it was called with the REAL global as `this`
    },
    URL: class FakeURL {},
    fetch: (input) => Promise.resolve({ ok: true, input }),
    location: { href: 'http://localhost:1420/' },
  };
  return g;
}

test('guarded global: plain properties pass through', () => {
  const w = createGuardedGlobal(fakeGlobal());
  assert.equal(w.innerWidth, 1280);
});

test('guarded global: blocked names throw a clear error', () => {
  const w = createGuardedGlobal(fakeGlobal());
  for (const name of ['localStorage', '__TAURI_INTERNALS__', 'WebSocket']) {
    assert.throws(() => w[name], (e) => e instanceof ScriptSandboxError && e.message.includes(name));
  }
});

test('guarded global: writes to blocked names throw, `in` checks see them as absent', () => {
  const w = createGuardedGlobal(fakeGlobal());
  assert.throws(() => { w.localStorage = {}; }, ScriptSandboxError);
  assert.equal('localStorage' in w, false);
  assert.equal('innerWidth' in w, true);
});

test('guarded global: window/self/globalThis all resolve to the same guard', () => {
  const w = createGuardedGlobal(fakeGlobal());
  assert.equal(w.window, w);
  assert.equal(w.self, w);
  assert.equal(w.globalThis, w);
});

test('guarded global: native methods run against the real global, constructors stay constructors', () => {
  const real = fakeGlobal();
  const w = createGuardedGlobal(real);
  assert.equal(w.requestAnimationFrame(() => {}), 42);
  assert.equal(w.requestAnimationFrame, w.requestAnimationFrame, 'stable identity');
  assert.equal(w.URL, real.URL, 'classes are returned untouched');
});

test('guarded fetch: ordinary URLs work, desktop-bridge and file targets are refused', async () => {
  const w = createGuardedGlobal(fakeGlobal());
  assert.equal((await w.fetch('https://esm.sh/three')).ok, true);
  assert.equal((await w.fetch('/fonts/inter.woff2')).ok, true);
  for (const bad of ['ipc://localhost/plugin%3Afs%7Cread_file', 'http://ipc.localhost/cmd', 'file:///etc/passwd']) {
    await assert.rejects(() => w.fetch(bad), ScriptSandboxError, bad);
  }
});

test('the blocked list covers storage, sockets and the desktop bridge', () => {
  for (const must of ['localStorage', 'indexedDB', 'WebSocket', 'XMLHttpRequest', '__TAURI__', '__TAURI_INTERNALS__']) {
    assert.ok(BLOCKED_GLOBALS.includes(must), must);
  }
});

test('lifecycle typos: case and one-letter mistakes are caught, real helpers are not', () => {
  assert.deepEqual(findLifecycleTypo(['onupdate']), { name: 'onupdate', suggestion: 'onUpdate' });
  assert.deepEqual(findLifecycleTypo(['onUpdat']), { name: 'onUpdat', suggestion: 'onUpdate' });
  assert.deepEqual(findLifecycleTypo(['OnMount']), { name: 'OnMount', suggestion: 'onMount' });
  assert.deepEqual(findLifecycleTypo(['onUpdaet']), { name: 'onUpdaet', suggestion: 'onUpdate' });
  assert.deepEqual(findLifecycleTypo(['getgizmos']), { name: 'getgizmos', suggestion: 'getGizmos' });
  // real hooks, helpers and legacy names are fine
  assert.equal(findLifecycleTypo(['constructor', 'onMount', 'onUpdate', 'getGizmos', 'Start', 'Update', 'update', 'draw', 'spawnParticle', 'onClickHandler']), null);
});

test('assertNoLifecycleTypos reads class prototypes and plain objects', () => {
  class Bad { onupdate() {} }
  class Good { onUpdate() {} helper() {} }
  assert.throws(() => assertNoLifecycleTypos(Bad), /did you mean 'onUpdate'/);
  assert.doesNotThrow(() => assertNoLifecycleTypos(Good));
  assert.throws(() => assertNoLifecycleTypos({ onSeeek() {} }), /did you mean 'onSeek'/);
  assert.doesNotThrow(() => assertNoLifecycleTypos(function ReactComponent() {}));
});