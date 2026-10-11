import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeScriptAction, listScriptActions } from './scriptActions.js';
import { updateCanvasComponent } from './canvasRunner.js';
import { precompileWithBundler } from './scriptRunner.js';

/** Silence the dispatcher's own warnings — these tests assert the result. */
function quiet(fn) {
  const original = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = original;
  }
}

const CLASS_SCRIPT = `
export default class Demo {
  constructor() { this.count = 0; }
  static describe({ props }) { return 'static:' + props.seed; }
  bump() { this.count += 1; return this.count; }
  write({ set, setAll }) { set('seed', 5); setAll({ other: 1 }); }
  async slow() { return 'done'; }
  boom() { throw new Error('nope'); }
}
`;

const OBJECT_SCRIPT = `
export default {
  ping({ props }) { return 'object:' + props.seed; },
};
`;

const COMPONENT_SCRIPT = `
export default function Clip({ props }) { return props.label; }
Clip.randomise = ({ set }) => set('seed', Math.random());
`;

// The engine compiles EVERY script through esbuild on the async precompile
// path, so the sync compile path is "pending" until that lands. Warm the
// cache for these fixtures before the tests below run.
await Promise.all([
  precompileWithBundler(CLASS_SCRIPT, null, 'Demo.jsx'),
  precompileWithBundler(OBJECT_SCRIPT, null, 'Object.jsx'),
  precompileWithBundler(COMPONENT_SCRIPT, null, 'Clip.jsx'),
]);

test('invokeScriptAction - a static method runs on the export', async () => {
  const res = await invokeScriptAction({
    scriptCode: CLASS_SCRIPT, action: 'describe', props: { seed: 7 },
  });
  assert.deepEqual(res, { ok: true, via: 'static', result: 'static:7' });
});

test('invokeScriptAction - a prototype method runs on a cached instance', async () => {
  const first = await invokeScriptAction({ scriptCode: CLASS_SCRIPT, action: 'bump', props: {} });
  const second = await invokeScriptAction({ scriptCode: CLASS_SCRIPT, action: 'bump', props: {} });
  assert.equal(first.via, 'instance');
  assert.equal(first.result, 1);
  assert.equal(second.result, 2, 'clicks share the instance, so state accumulates');
});

test('invokeScriptAction - an object export uses its own methods', async () => {
  const res = await invokeScriptAction({
    scriptCode: OBJECT_SCRIPT, action: 'ping', props: { seed: 3 },
  });
  assert.equal(res.result, 'object:3');
  assert.equal(res.via, 'static');
});

test('invokeScriptAction - a property attached to a component is callable', async () => {
  const seen = [];
  const res = await invokeScriptAction({
    scriptCode: COMPONENT_SCRIPT,
    action: 'randomise',
    props: {},
    setProp: (name, value) => seen.push([name, typeof value]),
  });
  assert.equal(res.ok, true);
  assert.equal(res.via, 'static');
  assert.equal(seen[0][0], 'seed');
});

test('invokeScriptAction - set and setAll write through to the host', async () => {
  const written = [];
  const res = await invokeScriptAction({
    scriptCode: CLASS_SCRIPT,
    action: 'write',
    props: {},
    setProp: (name, value) => written.push([name, value]),
    setProps: (patch) => written.push(['patch', patch]),
  });
  assert.equal(res.ok, true);
  assert.deepEqual(written, [['seed', 5], ['patch', { other: 1 }]]);
});

test('invokeScriptAction - awaits async actions', async () => {
  const res = await invokeScriptAction({ scriptCode: CLASS_SCRIPT, action: 'slow', props: {} });
  assert.deepEqual(res, { ok: true, via: 'instance', result: 'done' });
});

test('invokeScriptAction - a thrown action is reported, not propagated', async () => {
  const res = await quiet(() => invokeScriptAction({
    scriptCode: CLASS_SCRIPT, action: 'boom', props: {},
  }));
  assert.equal(res.ok, false);
  assert.equal(res.error, 'nope');
});

test('invokeScriptAction - reports what is missing instead of throwing', async () => {
  assert.equal((await invokeScriptAction({ scriptCode: CLASS_SCRIPT, action: 'nope', props: {} })).ok, false);
  assert.equal((await invokeScriptAction({ action: 'x', props: {} })).error, 'script has no code yet');
  assert.equal((await invokeScriptAction({ scriptCode: CLASS_SCRIPT, props: {} })).error, 'button has no action');
  assert.equal((await quiet(() => invokeScriptAction({
    scriptCode: 'export default undefined;', action: 'x', props: {},
  }))).ok, false);
});

test('invokeScriptAction - prefers a live mounted canvas instance', async () => {
  const code = `
    export default class Canvas {
      onMount() { this.live = true; }
      onUpdate() {}
      probe() { return this.live ? 'live' : 'cold'; }
    }
  `;
  await precompileWithBundler(code, null, 'Canvas.jsx');
  updateCanvasComponent({
    entityId: 'entity-1', scriptId: 'script-1', scriptCode: code,
    container: {}, localTime: 0, frame: 0, fps: 30, props: {},
    canvasWidth: 64, canvasHeight: 64,
  });

  const mounted = await invokeScriptAction({
    scriptCode: code, action: 'probe', props: {}, entityId: 'entity-1', scriptId: 'script-1',
  });
  assert.equal(mounted.via, 'mounted');
  assert.equal(mounted.result, 'live');

  // A different entity has no mounted instance, so it falls back to a cold one.
  const cold = await invokeScriptAction({
    scriptCode: code, action: 'probe', props: {}, entityId: 'entity-2', scriptId: 'script-1',
  });
  assert.equal(cold.via, 'instance');
  assert.equal(cold.result, 'cold');
});

test('listScriptActions - lists the export’s own methods, not inherited ones', () => {
  const names = listScriptActions(CLASS_SCRIPT);
  assert.deepEqual(names, ['boom', 'bump', 'describe', 'slow', 'write']);
  assert.equal(names.includes('toString'), false);
  assert.equal(names.includes('call'), false);
  assert.equal(names.includes('prototype'), false);
});

test('listScriptActions - a broken script lists nothing', () => {
  assert.deepEqual(listScriptActions('export default ;;;'), []);
  assert.deepEqual(listScriptActions(''), []);
});
