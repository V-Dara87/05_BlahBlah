import assert from 'node:assert/strict';
import { updateCanvasComponent, unmountCanvasComponent, pruneCanvasComponents } from '../src/engine/canvasRunner.js';

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
  assert.equal(container.childNodes.length, 2);
  assert.equal(container.childNodes[1].tagName, 'CANVAS_B');
});

test('pruneCanvasComponents unmounts inactive entities', () => {
  const container = createMockElement('div');
  globalThis.testUnmounted = false;
  const code = `
  export default class DisappearingScript {
    onMount({ container }) {}
    onUnmount() {
      globalThis.testUnmounted = true;
    }
  }
  `;

  updateCanvasComponent({
    entityId: 'e4',
    scriptId: 's4',
    scriptCode: code,
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

  const abortScriptCode = `
  export default class AbortableScript {
    onMount({ container, signal }) {
      globalThis.capturedSignal = signal;
    }
    onUnmount() {}
  }
  `;

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
