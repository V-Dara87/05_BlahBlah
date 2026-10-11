/**
 * Node test harness for the real-`import` bundling pipeline
 * (engine/moduleCache.js + engine/packageResolver.js + engine/scriptBundler.js
 * + the scriptRunner.js sync/async split).
 *
 * Runs without a browser: moduleCache falls back to memory-only storage
 * (no IndexedDB), the File System Access API is faked with an in-memory
 * directory handle, and esbuild-wasm runs in Node mode (`worker: false`,
 * no wasmURL — see scriptRunner's esbuildInitPromise).
 *
 * Usage: `node tests/run-bundler-tests.mjs` (adds an `npm test` script).
 * Package resolution against esm.sh needs network on the FIRST run of each
 * package; everything is cached in memory for the rest of the process, and
 * on disk in a real browser.
 */
import assert from 'node:assert/strict';

// ─── Fake File System Access handles ────────────────────────────────────────

function makeNotFound() {
  return Object.assign(new Error('A requested file or directory could not be found.'), { name: 'NotFoundError' });
}

/**
 * In-memory scripts/ dir: `files` is a Map of 'path' -> code. Nested paths
 * ('nested/util.js') walk subdirectories like the real File System Access
 * API does.
 */
function makeFakeScriptsDir(files) {
  const fileHandleFor = (name) => ({
    name,
    async getFile() {
      return { text: async () => files.get(name) };
    },
  });

  const dir = {
    name: 'scripts',
    async getFileHandle(name, _opts) {
      if (files.has(name)) return fileHandleFor(name);
      throw makeNotFound();
    },
    async getDirectoryHandle(name, _opts) {
      // Nested dirs are a prefix of a stored path, e.g. 'nested' for
      // 'nested/util.js'.
      const prefix = `${name}/`;
      if (Array.from(files.keys()).some((p) => p.startsWith(prefix))) {
        const subFiles = new Map(
          Array.from(files.entries())
            .filter(([p]) => p.startsWith(prefix))
            .map(([p, code]) => [p.slice(prefix.length), code])
        );
        return makeFakeScriptsDir(subFiles);
      }
      throw makeNotFound();
    },
  };
  return dir;
}

/** In-memory project folder with a scripts/ subdir. */
function makeFakeProjectHandle(scriptsFiles) {
  const scriptsDir = makeFakeScriptsDir(scriptsFiles);
  return {
    name: 'fake-project',
    async getDirectoryHandle(name, _opts) {
      if (name === 'scripts') return scriptsDir;
      throw makeNotFound();
    },
  };
}

// ─── Harness plumbing ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.error(`  ✗ ${name}`);
    console.error(`    ${err?.message || err}`);
  }
}

// ─── The module under test ───────────────────────────────────────────────────

const scriptRunner = await import('../src/engine/scriptRunner.js');
const {
  compileScriptModule,
  executeScriptComponent,
  getCompiledReactComponent,
  getScriptError,
  hasImportStatements,
  extractImportSpecifiers,
  extractScriptProps,
  isScriptBundlePending,
  precompileWithBundler,
  precompileAllProjectScripts,
} = scriptRunner;

// Instantiate a compiled CanvasRenderer-style module and run its onMount,
// exactly like engine/canvasRunner.js does for live preview/export.
function instantiateAndMount(compiled) {
  const instance = typeof compiled === 'function' && compiled.prototype ? new compiled() : compiled;
  instance.onMount?.({ container: {} });
  return instance;
}

console.log('\nreal-import bundling pipeline tests\n');

// ─── 1. Import detection ─────────────────────────────────────────────────────

await test('extractImportSpecifiers finds static imports', () => {
  assert.deepEqual(
    extractImportSpecifiers(`import * as THREE from 'three';\nexport default class A {}`),
    ['three']
  );
  assert.deepEqual(
    extractImportSpecifiers(`import { gsap } from "gsap"; import './polyfill';`),
    ['gsap', './polyfill']
  );
  assert.deepEqual(
    extractImportSpecifiers(`export { double } from './helpers.js';`),
    ['./helpers.js']
  );
});

await test('react-family detection covers esm.sh peer-dep paths', async () => {
  const { reactFamilyKind } = await import('../src/engine/scriptBundler.js');
  assert.equal(reactFamilyKind('react'), 'react');
  assert.equal(reactFamilyKind('react/jsx-runtime'), 'jsx-runtime');
  assert.equal(reactFamilyKind('react-dom/client'), 'react-dom-client');
  assert.equal(reactFamilyKind('/react@18.2.0/es2022/react.mjs'), 'react');
  assert.equal(reactFamilyKind('/react@^18.0.0%20||%20^19.0.0/jsx-runtime?target=es2022'), 'jsx-runtime');
  assert.equal(reactFamilyKind('/react-dom@18.2.0/client.mjs'), 'react-dom-client');
  assert.equal(reactFamilyKind('/three@0.185.1/es2022/three.mjs'), null);
});

await test('comments/strings do not fake an import', () => {
  const code = `
    // import fake from 'nope';
    /* import also from 'nope2'; */
    const s = "import str from 'nope3';";
    export default class A { onUpdate() {} }
  `;
  assert.equal(hasImportStatements(code), false);
  assert.equal(extractImportSpecifiers(code).length, 0);
});

// ─── 2. Sync path unchanged for import-free scripts ──────────────────────────

const plainScript = `
export default class FloatProbe {
  static props = { amplitude: { type: 'number', default: 35 } };
  onStart({ transform, tween, props }) {
    tween.to(transform.position, { y: -props.amplitude }, { duration: 1, ease: 'inOutSine', loop: 'yoyo' });
  }
}`;

await test('import-free script compiles through the esbuild precompile path', async () => {
  // Every script — import-free included — is compiled asynchronously by
  // esbuild; the sync path is "pending" until that lands.
  const result = await precompileWithBundler(plainScript, null, 'Plain.jsx');
  assert.equal(result.ok, true, `compile failed: ${result.error}`);
  assert.equal(isScriptBundlePending(plainScript), false);
  const compiled = compileScriptModule(plainScript);
  assert.ok(compiled, 'compiled module should exist');
  assert.equal(typeof compiled, 'function');
  assert.equal(getScriptError(plainScript), null);
});

await test('import-free motion script executes deterministically', () => {
  const transform = executeScriptComponent({
    scriptCode: plainScript,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
    localTime: 0.5,
    clipDuration: 5,
    publicValues: { amplitude: 40 },
  });
  assert.notEqual(transform.y, 0, 'tween should have moved y');
  assert.ok(Math.abs(transform.y) <= 40, 'y stays within amplitude');
});

// ─── 3. Pending state before bundling ────────────────────────────────────────

const threeScript = `
import * as THREE from 'three';
export default class ThreeProbe {
  static props = { size: { type: 'number', default: 1 } };
  onMount({ container }) {
    this.rendererType = typeof THREE.WebGLRenderer;
    this.scene = new THREE.Scene();
  }
  onUpdate() {}
}`;

await test('import script is pending (not error) until bundled', () => {
  assert.equal(hasImportStatements(threeScript), true);
  assert.equal(compileScriptModule(threeScript), null, 'sync compile must return null');
  assert.equal(isScriptBundlePending(threeScript), true, 'should be marked pending');
  assert.equal(getScriptError(threeScript), null, 'pending is NOT an error');
});

// ─── 4. Real bundling: npm packages ──────────────────────────────────────────

const emptyProject = makeFakeProjectHandle(new Map());

await test('bundles import * as THREE from "three" (real esm.sh fetch)', async () => {
  await precompileWithBundler(threeScript, emptyProject);
  assert.equal(getScriptError(threeScript), null, `no error expected, got: ${getScriptError(threeScript)}`);
  assert.equal(isScriptBundlePending(threeScript), false);
  const compiled = compileScriptModule(threeScript);
  assert.ok(compiled, 'compiled module should now exist');
  const instance = instantiateAndMount(compiled);
  assert.equal(instance.rendererType, 'function', 'THREE.WebGLRenderer should be a function');
  assert.ok(instance.scene, 'THREE.Scene should instantiate');
});

const gsapScript = `
import { gsap } from 'gsap';
export default class GsapProbe {
  onMount() {
    this.hasTo = typeof gsap.to === 'function';
    this.hasVersion = typeof gsap.version === 'string';
  }
}`;

await test('bundles named import from "gsap"', async () => {
  await precompileWithBundler(gsapScript, emptyProject);
  assert.equal(getScriptError(gsapScript), null, `no error expected, got: ${getScriptError(gsapScript)}`);
  const instance = instantiateAndMount(compileScriptModule(gsapScript));
  assert.equal(instance.hasTo, true, 'gsap.to should exist');
  assert.equal(instance.hasVersion, true, 'gsap.version should exist');
});

// animejs v3 (3.2.2) is pinned explicitly — v4's freshly-published esm.sh
// build currently exports nothing (an upstream dist issue), whereas v3 has
// the classic `import anime from 'animejs'` default export.
const animeScript = `
import anime from 'animejs@3.2.2';
export default class AnimeProbe {
  onMount() {
    this.isFunction = typeof anime === 'function';
    this.hasTimeline = typeof anime.timeline === 'function';
    this.hasStagger = typeof anime.stagger === 'function';
  }
}`;

await test('bundles default import from "animejs@3.2.2" (explicit version)', async () => {
  await precompileWithBundler(animeScript, emptyProject);
  assert.equal(getScriptError(animeScript), null, `no error expected, got: ${getScriptError(animeScript)}`);
  const instance = instantiateAndMount(compileScriptModule(animeScript));
  assert.equal(instance.isFunction, true, 'anime default export should be the callable function');
  assert.equal(instance.hasTimeline, true, 'anime.timeline should exist');
  assert.equal(instance.hasStagger, true, 'anime.stagger should exist');
});

// ─── 5. Explicit version + offline reuse ─────────────────────────────────────

const threeVersionedScript = `
import * as THREE from 'three@0.160.0';
export default class ThreeV160 {
  onMount() { this.version = THREE.REVISION; }
}`;

await test('bundles explicitly-versioned import (three@0.160.0)', async () => {
  await precompileWithBundler(threeVersionedScript, emptyProject);
  assert.equal(getScriptError(threeVersionedScript), null, `no error expected, got: ${getScriptError(threeVersionedScript)}`);
  const instance = instantiateAndMount(compileScriptModule(threeVersionedScript));
  assert.equal(instance.version, '160', 'THREE.REVISION should be 160 for 0.160.0');
});

await test('second bundle of same script works from cache', async () => {
  await precompileWithBundler(threeScript, emptyProject);
  assert.equal(getScriptError(threeScript), null);
  assert.ok(compileScriptModule(threeScript));
});

// ─── 6. Relative imports from scripts/ folder ────────────────────────────────

const helpersProject = makeFakeProjectHandle(
  new Map([
    ['helper.js', 'export function double(x) { return x * 2; }\nexport const greeting = "hi";'],
    ['nested/util.js', 'export const flag = true;'],
  ])
);

const relScript = `
import { double, greeting } from './helper.js';
import { flag } from './nested/util.js';
export default class RelProbe {
  onMount() {
    this.doubled = double(21);
    this.greeting = greeting;
    this.flag = flag;
  }
}`;

await test('bundles relative imports (with subdirectories, no network)', async () => {
  await precompileWithBundler(relScript, helpersProject);
  assert.equal(getScriptError(relScript), null, `no error expected, got: ${getScriptError(relScript)}`);
  const instance = instantiateAndMount(compileScriptModule(relScript));
  assert.equal(instance.doubled, 42);
  assert.equal(instance.greeting, 'hi');
  assert.equal(instance.flag, true);
});

await test('missing relative import produces a clear error', async () => {
  const bad = `import { x } from './does-not-exist';\nexport default class A { onMount() { this.x = x; } }`;
  await precompileWithBundler(bad, emptyProject);
  const err = getScriptError(bad);
  assert.ok(err, 'should have an error');
  assert.match(err, /Could not resolve relative import/, `unexpected: ${err}`);
  assert.equal(isScriptBundlePending(bad), false, 'failed bundle is not pending');
});

// ─── 7. React imports resolve to the app's own React ─────────────────────────

const reactScript = `
import React, { useState } from 'react';
export default function CounterBadge() {
  return React.createElement('div', { className: 'badge' }, 'hi');
}`;

await test('import React from "react" bundles and produces elements', async () => {
  await precompileWithBundler(reactScript, emptyProject);
  assert.equal(getScriptError(reactScript), null, `no error expected, got: ${getScriptError(reactScript)}`);
  const CompiledComponent = getCompiledReactComponent(reactScript);
  assert.equal(typeof CompiledComponent, 'function');
  const el = CompiledComponent({});
  assert.equal(el.type, 'div');
  assert.equal(el.props.className, 'badge');
});

// ─── 7b. React-family shims (react/jsx-runtime, react-dom/client) ──────────

await test('react/jsx-runtime and react-dom/client shims stay single-React', async () => {
  const jsxRuntimeScript = `
import { createElement, Fragment } from 'react';
import { jsx as runtimeJsx } from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
export default class JsxShimProbe {
  onMount() {
    this.createElementIsFn = typeof createElement === 'function';
    this.fragmentIsSymbol = typeof Fragment === 'symbol';
    this.runtimeJsxIsFn = typeof runtimeJsx === 'function';
    this.createRootIsFn = typeof createRoot === 'function';
    this.sameReact = createElement === React.createElement;
  }
}`;
  await precompileWithBundler(jsxRuntimeScript, emptyProject);
  assert.equal(getScriptError(jsxRuntimeScript), null, `no error expected, got: ${getScriptError(jsxRuntimeScript)}`);
  const instance = instantiateAndMount(compileScriptModule(jsxRuntimeScript));
  assert.equal(instance.createElementIsFn, true);
  assert.equal(instance.fragmentIsSymbol, true);
  assert.equal(instance.runtimeJsxIsFn, true);
  assert.equal(instance.createRootIsFn, true);
  // The shim must hand back the APP's React, never a bundled second copy.
  assert.equal(instance.sameReact, true, 'react shim must resolve to the injected React instance');
});

// ─── 7c. Prop helpers (globals AND the 'blahblah' import) in bundled scripts ─

await test('prop helpers are globals in a script that uses real imports', async () => {
  // The helpers are injected into the module wrapper runCompiledModule builds,
  // which is ALSO where a bundled script's code ends up — so a script that
  // mixes an npm/relative import with a helper-built `static props` must
  // compile (the class body evaluates the helpers the moment it is defined)
  // and must produce the same Inspector schema as an import-free one.
  const script = `
import { double } from './helper.js';
export default class HelperProbe {
  static props = {
    ...Presets.timing,
    amplitude: num(35, { min: 0, max: 100, unit: '%' }),
    tint: color('#38bdf8'),
  };
  onMount() {
    this.doubled = double(21);
    this.amplitude = HelperProbe.props.amplitude.default;
  }
}`;
  await precompileWithBundler(script, helpersProject);
  assert.equal(getScriptError(script), null, `no error expected, got: ${getScriptError(script)}`);

  const instance = instantiateAndMount(compileScriptModule(script));
  assert.equal(instance.doubled, 42, 'the bundled class body evaluated the helpers');
  assert.equal(instance.amplitude, 35);

  const fields = extractScriptProps(script);
  assert.equal(fields.find((f) => f.name === 'amplitude').label, 'Amplitude (%)');
  assert.equal(fields.find((f) => f.name === 'startDelay').label, 'Start Delay (s)');
  assert.equal(fields.find((f) => f.name === 'ease').type, 'select');
});

await test("import { num } from 'blahblah' resolves to the same helpers", async () => {
  // The explicit-import form is served by the bundler as a virtual module,
  // backed by the very same source file the engine injects — so this cannot
  // drift from the globals.
  const script = `
import { num, Presets, group } from 'blahblah';
export default class ImportedHelpers {
  static props = {
    ...group('Main', { speed: num(3, { min: 0 }), ...Presets.colors }),
  };
  onMount() { this.speed = ImportedHelpers.props.speed.default; }
}`;
  await precompileWithBundler(script, emptyProject);
  assert.equal(getScriptError(script), null, `no error expected, got: ${getScriptError(script)}`);

  const instance = instantiateAndMount(compileScriptModule(script));
  assert.equal(instance.speed, 3);

  const fields = extractScriptProps(script);
  assert.equal(fields.find((f) => f.name === 'nodeFill').label, 'Node Fill');
  assert.equal(fields.find((f) => f.name === 'speed').tab, 'Main');
});

// ─── 8. Failure modes degrade gracefully ─────────────────────────────────────

await test('unknown npm package produces a clear error, not a hang', async () => {
  const bad = `import x from 'definitely-not-a-real-package-xyz-12345';\nexport default class A { onMount() { this.x = x; } }`;
  await precompileWithBundler(bad, emptyProject);
  const err = getScriptError(bad);
  assert.ok(err, 'should have an error');
  assert.match(err, /Could not fetch package/, `unexpected: ${err}`);
  assert.equal(isScriptBundlePending(bad), false);
  assert.equal(compileScriptModule(bad), null);
});

await test('node builtin import is rejected with a clear message', async () => {
  const bad = `import fs from 'fs';\nexport default class A { onMount() { this.x = fs; } }`;
  await precompileWithBundler(bad, emptyProject);
  const err = getScriptError(bad);
  assert.ok(err, 'should have an error');
  assert.match(err, /Node\.js built-in module "fs"/, `unexpected: ${err}`);
});

// ─── 9. precompileAllProjectScripts skips import-free scripts ────────────────

await test('precompileAllProjectScripts compiles import-free scripts too', async () => {
  await precompileAllProjectScripts([{ name: 'Plain.jsx', code: plainScript }], emptyProject);
  assert.equal(isScriptBundlePending(plainScript), false);
  assert.equal(getScriptError(plainScript), null);
  assert.ok(compileScriptModule(plainScript), 'compiled module should exist');
});

// ─── 10. Old-project migration (ReactRenderer/CanvasRenderer/MonoBehaviour → ScriptComponent) ──

const {
  migrateEntities,
  migrateProjectSchema,
  readProjectSchemaVersion,
  warnIfSchemaVersionTooNew,
} = await import('../src/engine/ecs.js');
const { CURRENT_SCHEMA_VERSION } = await import('../src/types.js');

// An old-format project entity mixing every pre-merge component type,
// with keyframes stored under the old per-type track keys ('ReactRenderer',
// 'CanvasRenderer') plus a motion script's 'script:<id>' track and the
// Transform's own track — exactly what a project saved before the type
// merge looks like on disk.
const OLD_ENTITY = {
  id: 'go-1',
  name: 'Old Clip',
  components: [
    { type: 'Transform', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
    { type: 'ReactRenderer', scriptId: 'script-glass-card', scriptName: 'GlassCard.jsx', props: { title: 'A' } },
    { type: 'CanvasRenderer', scriptId: 'script-canvas-orbit', scriptName: 'CanvasOrbit.jsx', props: { radius: 80 } },
    { type: 'MonoBehaviour', scriptId: 'script-pulse-scale', scriptName: 'PulseScale.jsx', enabled: false, props: {} },
  ],
  keyframes: {
    Transform: { x: [{ id: 'k1', time: 0, value: 10, easing: 'linear' }] },
    ReactRenderer: { title: [{ id: 'k2', time: 0, value: 'B', easing: 'linear' }] },
    CanvasRenderer: { radius: [{ id: 'k3', time: 1, value: 120, easing: 'linear' }] },
    'script:script-pulse-scale': { maxScale: [{ id: 'k4', time: 0, value: 1.2, easing: 'linear' }] },
  },
};

await test('migrateEntities: all old component types become ScriptComponent', () => {
  const [entity] = migrateEntities([OLD_ENTITY]);
  const types = entity.components.map((c) => c.type);
  assert.deepEqual(types, ['Transform', 'ScriptComponent', 'ScriptComponent', 'ScriptComponent']);
});

await test('migrateEntities: adds enabled:true to React/Canvas, preserves MonoBehaviour enabled', () => {
  const [entity] = migrateEntities([OLD_ENTITY]);
  const [react, canvas, mono] = entity.components.slice(1);
  assert.equal(react.enabled, true);
  assert.equal(canvas.enabled, true);
  assert.equal(mono.enabled, false); // explicitly disabled must stay disabled
});

await test('migrateEntities: keyframes re-keyed from old type tracks to script:<id>', () => {
  const [entity] = migrateEntities([OLD_ENTITY]);
  const keys = Object.keys(entity.keyframes).sort();
  assert.deepEqual(keys, [
    'Transform',
    'script:script-canvas-orbit',
    'script:script-glass-card',
    'script:script-pulse-scale',
  ]);
  // The keyframe data itself is preserved verbatim, just moved.
  assert.equal(entity.keyframes['script:script-glass-card'].title[0].value, 'B');
  assert.equal(entity.keyframes['script:script-canvas-orbit'].radius[0].value, 120);
  assert.equal(entity.keyframes['script:script-pulse-scale'].maxScale[0].value, 1.2);
  assert.equal(entity.keyframes.Transform.x[0].value, 10);
});

await test('migrateEntities: props survive untouched', () => {
  const [entity] = migrateEntities([OLD_ENTITY]);
  const [react] = entity.components.slice(1);
  assert.deepEqual(react.props, { title: 'A' });
});

await test('migrateEntities: already-migrated entities pass through unchanged (idempotent)', () => {
  const once = migrateEntities([OLD_ENTITY]);
  const twice = migrateEntities(once);
  assert.deepEqual(twice, once);
});

await test('migrateEntities: prefab-style component lists migrate the same way', () => {
  const prefab = {
    name: 'OldPrefab',
    components: [
      { type: 'Transform', x: 0, y: 0 },
      { type: 'ReactRenderer', scriptId: 'script-glass-card', props: {} },
    ],
  };
  const migrated = migrateEntities([prefab])[0];
  assert.equal(migrated.components[1].type, 'ScriptComponent');
  assert.equal(migrated.components[1].enabled, true);
});

await test('migrateEntities: null/non-array input is safe', () => {
  assert.deepEqual(migrateEntities(null), []);
  assert.deepEqual(migrateEntities(undefined), []);
});

// ─── 11. project schemaVersion (0/1 boundary + future-version gate) ────────

await test('schemaVersion helpers: missing reads as 0, current is 1', () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 1);
  assert.equal(readProjectSchemaVersion({}), 0);
  assert.equal(readProjectSchemaVersion({ schemaVersion: 1 }), 1);
  assert.equal(readProjectSchemaVersion({ schemaVersion: '1' }), 0); // hand-typed junk → 0
});

await test('migrateProjectSchema placeholder passes the project through unchanged', () => {
  const p = { name: 'x', entities: [1, 2] };
  assert.equal(migrateProjectSchema(p, 0, CURRENT_SCHEMA_VERSION), p);
});

// A schemaVersion-less legacy project — exactly the loader's path
// (projectFileSystem.js): read version (0) → warn gate (no-op at 0/1) →
// migrateProjectSchema (pass-through) → migrateEntities (0 → 1 component
// migration). projectFileSystem.js itself can't be imported in Node (its
// `?raw` SDK import), so the chained pure steps are asserted here.
await test('schemaVersion-less legacy project loads through the 0→1 path', () => {
  const legacyProject = {
    name: 'legacy',
    tracks: [],
    entities: [
      {
        id: 'go-1',
        name: 'Old Clip',
        components: [
          { type: 'Transform', x: 0 },
          { type: 'ReactRenderer', scriptId: 's1', scriptName: 'A.jsx', props: {} },
        ],
      },
    ],
  };
  const fromVersion = readProjectSchemaVersion(legacyProject);
  assert.equal(fromVersion, 0);
  assert.equal(warnIfSchemaVersionTooNew(legacyProject), false);
  const schemaMigrated = migrateProjectSchema(legacyProject, fromVersion, CURRENT_SCHEMA_VERSION);
  const migrated = migrateEntities(schemaMigrated.entities);
  assert.equal(migrated[0].components[1].type, 'ScriptComponent');
  assert.equal(migrated[0].components[1].enabled, true);
  assert.equal(migrated[0].components[0].type, 'Transform');
});

await test('schemaVersion 1 project passes the same chain unchanged', () => {
  const v1 = {
    schemaVersion: 1,
    entities: [{ id: 'e', components: [{ type: 'Transform', x: 0 }] }],
  };
  assert.equal(readProjectSchemaVersion(v1), 1);
  assert.equal(warnIfSchemaVersionTooNew(v1), false);
  assert.deepEqual(migrateProjectSchema(v1, 1, CURRENT_SCHEMA_VERSION), v1);
  assert.deepEqual(migrateEntities(v1.entities), v1.entities);
});

await test('newer schemaVersion warns but never blocks the load', () => {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const warned = warnIfSchemaVersionTooNew({ schemaVersion: 99, entities: [] });
    assert.equal(warned, true);
    assert.ok(
      warnings.some((w) => /newer version of blahblah/i.test(w)),
      `expected a newer-build warning, got: ${JSON.stringify(warnings)}`
    );
  } finally {
    console.warn = origWarn;
  }
});

// ─── 12. Transform.speed on motion scripts (follow + ignoreParentSpeed) ────

const { computeActiveEntitiesAtTime } = await import('../src/engine/renderPipeline.js');

// A motion script whose onUpdate writes transform.y = time * 100, so the
// resolved y IS the localTime the script received × 100 — a direct probe
// of the speed-scaling contract.
const RAMP_CODE = `export default class RampY {
  onUpdate({ transform, time }) {
    transform.position.y = time * 100;
  }
}`;
// Every script is compiled by esbuild on the async precompile path now, so
// warm the cache before computeActiveEntitiesAtTime executes it synchronously.
await precompileWithBundler(RAMP_CODE, null, 'RampY.jsx');
const RAMP_SCRIPTS = [{ id: 's-ramp', name: 'RampY.jsx', code: RAMP_CODE }];
const RAMP_TRACKS = [
  { id: 't1', name: 'Track 1', type: 'layer', muted: false, locked: false, visible: true, volume: 1.0 },
];

function rampEntity(transformExtra = {}, compExtra = {}, keyframes = undefined) {
  return {
    id: 'go-motion',
    name: 'Motion Clip',
    active: true,
    trackId: 't1',
    startTime: 0,
    duration: 10,
    type: 'shape',
    keyframes,
    components: [
      { type: 'Transform', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, ...transformExtra },
      { type: 'ScriptComponent', scriptId: 's-ramp', scriptName: 'RampY.jsx', enabled: true, props: {}, ...compExtra },
    ],
  };
}

const resolvedY = (entity, time = 1) =>
  computeActiveEntitiesAtTime({ entities: [entity], tracks: RAMP_TRACKS, scripts: RAMP_SCRIPTS, time })[0]
    .transform.y;

await test('motion script localTime is unscaled when Transform has no speed (legacy default)', () => {
  assert.equal(resolvedY(rampEntity({})), 100, 'speed absent → script sees raw timeline time');
});

await test('Transform.speed 2 doubles the motion script localTime', () => {
  assert.equal(resolvedY(rampEntity({ speed: 2 })), 200);
});

await test('ignoreParentSpeed keeps a script on raw timeline time under speed 2', () => {
  assert.equal(resolvedY(rampEntity({ speed: 2 }, { ignoreParentSpeed: true })), 100);
});

await test('ignoreParentSpeed absent (false/undefined) follows speed', () => {
  assert.equal(resolvedY(rampEntity({ speed: 2 }, { ignoreParentSpeed: false })), 200);
});

// Keyframed speed resolves through the keyframe engine first, so the speed
// curve itself can animate what time the script runs at (preview + video
// export follow per-frame; the one-shot audio mixdown can't — documented in
// exportRunner.js). Keyframes: speed 1 @0s → 4 @4s (linear); at t=2 the
// resolved speed is 2.5 → script sees localTime 5 → y = 500.
await test('keyframed Transform.speed animates the motion-script scale', () => {
  const entity = rampEntity({}, {}, {
    Transform: {
      speed: [
        { id: 'k0', time: 0, value: 1, easing: 'linear' },
        { id: 'k4', time: 4, value: 4, easing: 'linear' },
      ],
    },
  });
  assert.equal(resolvedY(entity, 2), 500);
});

await test('returned localTime stays unscaled (react/canvas consumers unaffected)', () => {
  const [item] = computeActiveEntitiesAtTime({
    entities: [rampEntity({ speed: 2 })],
    tracks: RAMP_TRACKS,
    scripts: RAMP_SCRIPTS,
    time: 1,
  });
  assert.equal(item.localTime, 1, 'callers render react/canvas at timeline time, not scaled');
});

// ─── 13. mediaAudio volume control & Web Audio gain chain ────────────────────

const {
  clampVolume,
  setMediaElementVolume,
  setMediaElementRate,
  ensureMediaGainChain,
  disconnectMediaGainChain,
} = await import('../src/utils/mediaAudio.js');

await test('clampVolume clamps to [0, 100] with safe defaults', () => {
  assert.equal(clampVolume(1), 1);
  assert.equal(clampVolume(0), 0);
  assert.equal(clampVolume(-0.5), 0);
  assert.equal(clampVolume(100), 100);
  assert.equal(clampVolume(150), 100);
  assert.equal(clampVolume('2.5'), 2.5);
  assert.equal(clampVolume(NaN), 1);
  assert.equal(clampVolume(undefined), 1);
});

await test('setMediaElementVolume fallback (without AudioContext) sets volume and muted state', () => {
  const el = { volume: 1, muted: false, tagName: 'AUDIO' };
  setMediaElementVolume(el, 0);
  assert.equal(el.volume, 0);
  assert.equal(el.muted, true);

  setMediaElementVolume(el, 0.7);
  assert.equal(el.volume, 0.7);
  assert.equal(el.muted, false);

  setMediaElementVolume(el, 2.5);
  assert.equal(el.volume, 1, 'values > 1 clamped to 1 in element.volume fallback');
  assert.equal(el.muted, false);
});

await test('setMediaElementRate clamps playback rate to safe [0.0625, 16] range', () => {
  const el = { playbackRate: 1 };
  setMediaElementRate(el, 2);
  assert.equal(el.playbackRate, 2);

  setMediaElementRate(el, 0.01);
  assert.equal(el.playbackRate, 0.0625);

  setMediaElementRate(el, 32);
  assert.equal(el.playbackRate, 16);

  setMediaElementRate(el, -1);
  assert.equal(el.playbackRate, 16, 'invalid rate ignored');
});

await test('setMediaElementVolume with Web Audio: properly updates gain.gain.value on subsequent calls (volume 0 and increase)', () => {
  const sourceConnectedTo = [];
  const gainConnectedTo = [];
  let sourceDisconnected = false;
  let gainDisconnected = false;

  const mockGainNode = {
    gain: { value: 1 },
    connect(dest) { gainConnectedTo.push(dest); },
    disconnect() { gainDisconnected = true; },
  };

  const mockSourceNode = {
    connect(dest) { sourceConnectedTo.push(dest); },
    disconnect() { sourceDisconnected = true; },
  };

  const mockCtx = {
    state: 'running',
    destination: { name: 'destination' },
    createGain() { return mockGainNode; },
    createMediaElementSource(el) { return mockSourceNode; },
  };

  // Set up mock window and AudioContext
  globalThis.window = {
    AudioContext: function() { return mockCtx; },
  };

  const el = { volume: 1, muted: false, tagName: 'AUDIO' };

  // 1. Initial volume set to 1.0
  setMediaElementVolume(el, 1.0);
  assert.equal(mockGainNode.gain.value, 1.0);
  assert.equal(el.muted, false);
  assert.equal(el.volume, 1);
  assert.equal(sourceConnectedTo[0], mockGainNode);
  assert.equal(gainConnectedTo[0], mockCtx.destination);

  // 2. Subsequent volume set to 0 (the exact bug: muted and gain value 0)
  setMediaElementVolume(el, 0);
  assert.equal(mockGainNode.gain.value, 0, 'gain.gain.value MUST be 0 when volume is 0');
  assert.equal(el.muted, true, 'element MUST be muted when volume is 0');
  assert.equal(mockGainNode.value, undefined, 'GainNode.value dummy property should NOT be set');

  // 3. Subsequent volume increase to 3.0 (the exact bug: gain value increases above 1)
  setMediaElementVolume(el, 3.0);
  assert.equal(mockGainNode.gain.value, 3.0, 'gain.gain.value MUST be 3.0 when volume increased');
  assert.equal(el.muted, false, 'element MUST NOT be muted when volume > 0');
  assert.equal(el.volume, 1, 'element.volume pinned to 1 to allow full gain boost');

  // 4. Clean up gain chain
  disconnectMediaGainChain(el);
  assert.equal(sourceDisconnected, true);
  assert.equal(gainDisconnected, true);

  delete globalThis.window;
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const { name, err } of failures) {
    console.error(`  - ${name}: ${err?.message || err}`);
  }
  process.exit(1);
}
process.exit(0);