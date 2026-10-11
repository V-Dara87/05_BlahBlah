import assert from 'node:assert/strict';
import { updateCanvasComponent, unmountCanvasComponent, pruneCanvasComponents } from '../src/engine/canvasRunner.js';
import { precompileWithBundler, isScriptDisabled, resetScriptDisabled } from '../src/engine/scriptRunner.js';
import { getConsoleEntries, clearConsole } from '../src/engine/scriptConsole.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

// Simple DOM node mock
function createMockElement(tagName = 'div') {
  const children = [];
  return {
    tagName,
    childNodes: children,
    parentNode: null,
    get firstChild() {
      return children[0] || null;
    },
    appendChild(child) {
      if (child.parentNode && child.parentNode !== this) {
        child.parentNode.removeChild(child);
      }
      children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) {
        children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },
  };
}

console.log('\nCanvas Runner Container Re-attachment Tests\n');

// Reset before tests
pruneCanvasComponents([]);

const scriptCode = `
export default class TextRenderer {
  onMount({ container }) {
    this.mountCount = (this.mountCount || 0) + 1;
    this.container = container;
    this.canvas = { tagName: 'CANVAS', parentNode: null };
    container.appendChild(this.canvas);
  }
  onUpdate({ container, time }) {
    this.updateCount = (this.updateCount || 0) + 1;
    this.lastTime = time;
  }
  onUnmount() {
    this.unmountCount = (this.unmountCount || 0) + 1;
  }
}
`;

const codeA = `
export default class ScriptA {
  onMount({ container }) {
    container.appendChild({ tagName: 'CANVAS_A', parentNode: null });
  }
}
`;
const codeB = `
export default class ScriptB {
  onMount({ container }) {
    container.appendChild({ tagName: 'CANVAS_B', parentNode: null });
  }
}
`;

const disappearingCode = `
export default class DisappearingScript {
  onMount({ container }) {}
  onUnmount() {
    globalThis.testUnmounted = true;
  }
}
`;

const asyncScriptCode = `
export default class AsyncFontScript {
  onMount({ container }) {
    globalThis.asyncScriptMounted = (globalThis.asyncScriptMounted || 0) + 1;
    this.renderer = { domElement: { tagName: 'CANVAS_THREE', parentNode: null } };
    container.appendChild(this.renderer.domElement);

    // Simulate async FontLoader callback arriving later
    this.simulateFontLoad = () => {
      globalThis.mockFontLoaded = true;
    };
    globalThis.activeInstance = this;
  }
  onUnmount() {
    globalThis.asyncScriptUnmounted = (globalThis.asyncScriptUnmounted || 0) + 1;
  }
}
`;

const abortScriptCode = `
export default class AbortableScript {
  onMount({ container, signal }) {
    globalThis.capturedSignal = signal;
  }
  onUnmount() {}
}
`;

// A 600ms onMount used to trip the old single 500ms freeze-guard budget and
// pause the script on its FIRST frame, even though one-time setup (a Three.js
// scene, a shader compile, an asset load) is legitimately slow.
const slowMountCode = `
export default class SlowMount {
  onMount({ container }) {
    const end = Date.now() + 600;
    while (Date.now() < end) { /* busy */ }
    this.canvas = { tagName: 'CANVAS_SLOW', parentNode: null };
    container.appendChild(this.canvas);
  }
  onUpdate() { globalThis.slowMountFrames = (globalThis.slowMountFrames || 0) + 1; }
}
`;

// Counts every constructor attempt so the test can prove a failed constructor
// is not retried frame after frame.
const throwingCtorCode = `
export default class BoomCtor {
  constructor() {
    globalThis.ctorAttempts = (globalThis.ctorAttempts || 0) + 1;
    throw new Error('ctor boom');
  }
  onMount() { globalThis.ctorMountCount = (globalThis.ctorMountCount || 0) + 1; }
}
`;
const throwingCtorCodeEdited = `${throwingCtorCode}\n// edited\n`;

const badMountCode = `
export default class BadMount {
  onMount() { throw new Error('mount boom'); }
  onUpdate() { globalThis.badMountUpdates = (globalThis.badMountUpdates || 0) + 1; }
  onSeek() { globalThis.badMountSeeks = (globalThis.badMountSeeks || 0) + 1; }
}
`;

// The engine compiles every script through esbuild on the async precompile
// path; compileScriptModule is "pending" until that lands. Warm the cache for
// each inline script before the synchronous assertions below run.
await Promise.all([
  precompileWithBundler(scriptCode, null, 'TextRenderer.jsx'),
  precompileWithBundler(codeA, null, 'ScriptA.jsx'),
  precompileWithBundler(codeB, null, 'ScriptB.jsx'),
  precompileWithBundler(disappearingCode, null, 'DisappearingScript.jsx'),
  precompileWithBundler(asyncScriptCode, null, 'AsyncFontScript.jsx'),
  precompileWithBundler(abortScriptCode, null, 'AbortableScript.jsx'),
  precompileWithBundler(slowMountCode, null, 'SlowMount.jsx'),
  precompileWithBundler(throwingCtorCode, null, 'BoomCtor.jsx'),
  precompileWithBundler(throwingCtorCodeEdited, null, 'BoomCtor.jsx'),
  precompileWithBundler(badMountCode, null, 'BadMount.jsx'),
]);

test('First update mounts script and calls onMount', () => {
  const container1 = createMockElement('div');
  updateCanvasComponent({
    entityId: 'e1',
    scriptId: 's1',
    scriptCode,
    container: container1,
    localTime: 0,
  });

  assert.equal(container1.childNodes.length, 1);
  assert.equal(container1.childNodes[0].tagName, 'CANVAS');
});

test('Container change re-attaches DOM children without remounting script', () => {
  const container1 = createMockElement('div');
  updateCanvasComponent({
    entityId: 'e2',
    scriptId: 's2',
    scriptCode,
    container: container1,
    localTime: 0,
  });

  assert.equal(container1.childNodes.length, 1);
  const canvasNode = container1.childNodes[0];

  // Next frame: React replaced container1 with container2
  const container2 = createMockElement('div');
  updateCanvasComponent({
    entityId: 'e2',
    scriptId: 's2',
    scriptCode,
    container: container2,
    localTime: 0.033,
  });

  // Canvas element should have been transferred to container2
  assert.equal(container1.childNodes.length, 0);
  assert.equal(container2.childNodes.length, 1);
  assert.equal(container2.childNodes[0], canvasNode);
});

test('Script code change properly triggers onUnmount and remounts', () => {
  const container = createMockElement('div');

  updateCanvasComponent({
    entityId: 'e3',
    scriptId: 's3',
    scriptCode: codeA,
    container,
    localTime: 0,
  });
  assert.equal(container.childNodes.length, 1);
  assert.equal(container.childNodes[0].tagName, 'CANVAS_A');

  updateCanvasComponent({
    entityId: 'e3',
    scriptId: 's3',
    scriptCode: codeB,
    container,
    localTime: 0.033,
  });
  // The old instance's canvas is removed on remount: exactly one canvas left,
  // and it is the new script's. (Before, the old <canvas> stayed and a second
  // one was appended next to it — one leaked canvas per edit.)
  assert.equal(container.childNodes.length, 1);
  assert.equal(container.childNodes[0].tagName, 'CANVAS_B');
});

test('a slow onMount does not pause the script (5s budget, one strike forgiven)', () => {
  const container = createMockElement('div');
  globalThis.slowMountFrames = 0;

  updateCanvasComponent({
    entityId: 'e9',
    scriptId: 's9',
    scriptCode: slowMountCode,
    scriptName: 'SlowMount.jsx',
    container,
    localTime: 0,
  });

  assert.equal(isScriptDisabled(slowMountCode), false, 'a 600ms onMount is well under the 5s budget');
  assert.equal(container.childNodes.length, 1);

  // Later frames still run it. (onUpdate also runs on the mount frame itself,
  // so reset the counter before the next frame.)
  globalThis.slowMountFrames = 0;
  updateCanvasComponent({
    entityId: 'e9',
    scriptId: 's9',
    scriptCode: slowMountCode,
    scriptName: 'SlowMount.jsx',
    container,
    localTime: 0.033,
  });
  assert.equal(globalThis.slowMountFrames, 1, 'onUpdate keeps running after a slow onMount');

  unmountCanvasComponent('e9', 's9');
  resetScriptDisabled(slowMountCode);
});

test('a throwing constructor is tried once and not retried every frame', () => {
  const container = createMockElement('div');
  globalThis.ctorAttempts = 0;
  globalThis.ctorMountCount = 0;
  clearConsole();

  const mount = (scriptCode) => updateCanvasComponent({
    entityId: 'e7',
    scriptId: 's7',
    scriptCode,
    scriptName: 'BoomCtor.jsx',
    container,
    localTime: 0,
  });

  mount(throwingCtorCode);
  mount(throwingCtorCode);
  mount(throwingCtorCode);
  assert.equal(globalThis.ctorAttempts, 1, 'the constructor must not be retried every frame');
  assert.equal(globalThis.ctorMountCount, 0, 'onMount never runs for a failed constructor');
  assert.equal(container.childNodes.length, 0);

  // Editing the code is the retry trigger.
  mount(throwingCtorCodeEdited);
  assert.equal(globalThis.ctorAttempts, 2, 'a code change retries the constructor');

  unmountCanvasComponent('e7', 's7');
});

test('a throwing onMount pauses the script instead of calling onUpdate/onSeek', () => {
  const container = createMockElement('div');
  globalThis.badMountUpdates = 0;
  globalThis.badMountSeeks = 0;
  clearConsole();

  updateCanvasComponent({
    entityId: 'e8',
    scriptId: 's8',
    scriptCode: badMountCode,
    scriptName: 'BadMount.jsx',
    container,
    localTime: 0,
  });
  // A scrub jump would call onSeek — it must not, either.
  updateCanvasComponent({
    entityId: 'e8',
    scriptId: 's8',
    scriptCode: badMountCode,
    scriptName: 'BadMount.jsx',
    container,
    localTime: 0.5,
  });

  assert.equal(globalThis.badMountUpdates || 0, 0, 'onUpdate must not run after a failed onMount');
  assert.equal(globalThis.badMountSeeks || 0, 0, 'onSeek must not run after a failed onMount');
  assert.ok(
    getConsoleEntries().some((e) => e.message.includes('onMount failed — script paused until you edit it')),
    `expected a clear pause message, got ${JSON.stringify(getConsoleEntries().map((e) => e.message))}`,
  );

  unmountCanvasComponent('e8', 's8');
});

test('pruneCanvasComponents unmounts inactive entities', () => {
  const container = createMockElement('div');
  globalThis.testUnmounted = false;

  updateCanvasComponent({
    entityId: 'e4',
    scriptId: 's4',
    scriptCode: disappearingCode,
    container,
    localTime: 0,
  });

  // Prune without e4::s4
  pruneCanvasComponents([]);
  assert.equal(globalThis.testUnmounted, true);
});

test('Async asset loading completes safely after container change without restart', () => {
  const container1 = createMockElement('div');
  globalThis.mockFontLoaded = false;

  // 1. Initial mount on frame 0
  updateCanvasComponent({
    entityId: 'e5',
    scriptId: 's5',
    scriptCode: asyncScriptCode,
    container: container1,
    localTime: 0,
  });
  assert.equal(globalThis.asyncScriptMounted, 1);
  assert.equal(container1.childNodes.length, 1);

  // 2. Playback advances: container replaces container1 with container2 before font finishes
  const container2 = createMockElement('div');
  updateCanvasComponent({
    entityId: 'e5',
    scriptId: 's5',
    scriptCode: asyncScriptCode,
    container: container2,
    localTime: 0.033,
  });

  // Script MUST NOT have remounted or unmounted!
  assert.equal(globalThis.asyncScriptMounted, 1);
  assert.equal(globalThis.asyncScriptUnmounted || 0, 0);
  assert.equal(container2.childNodes.length, 1);
  assert.equal(container2.childNodes[0].tagName, 'CANVAS_THREE');

  // 3. Now the async font loader callback completes
  globalThis.activeInstance.simulateFontLoad();
  assert.equal(globalThis.mockFontLoaded, true);

  // 4. Another playback frame on container2
  updateCanvasComponent({
    entityId: 'e5',
    scriptId: 's5',
    scriptCode: asyncScriptCode,
    container: container2,
    localTime: 0.066,
  });

  // Still 1 mount, 0 unmounts, canvas still safely in container2
  assert.equal(globalThis.asyncScriptMounted, 1);
  assert.equal(globalThis.asyncScriptUnmounted || 0, 0);
  assert.equal(container2.childNodes.length, 1);
  assert.equal(container2.childNodes[0].tagName, 'CANVAS_THREE');
});

test('AbortSignal is aborted on true unmount but NOT on container swap', () => {
  const container1 = createMockElement('div');
  let capturedSignal = null;

  // 1. Mount — signal should be live
  updateCanvasComponent({
    entityId: 'e6',
    scriptId: 's6',
    scriptCode: abortScriptCode,
    container: container1,
    localTime: 0,
  });

  capturedSignal = globalThis.capturedSignal;
  assert.ok(capturedSignal, 'signal should be passed to onMount');
  assert.equal(capturedSignal.aborted, false, 'signal should be live after mount');

  // 2. Container swap — signal must stay live (no abort on Option A re-attach)
  const container2 = createMockElement('div');
  updateCanvasComponent({
    entityId: 'e6',
    scriptId: 's6',
    scriptCode: abortScriptCode,
    container: container2,
    localTime: 0.033,
  });

  assert.equal(capturedSignal.aborted, false, 'signal must stay live after container swap');

  // 3. True unmount (clip deleted / leaves timeline) — NOW signal must abort
  pruneCanvasComponents([]);
  assert.equal(capturedSignal.aborted, true, 'signal must be aborted after true unmount');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
