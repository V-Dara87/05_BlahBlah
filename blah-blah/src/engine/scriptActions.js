import { compileScriptModule } from './scriptRunner.js';
import { getMountedCanvasInstance } from './canvasRunner.js';

/**
 * Script *actions*: the engine half of Odin's `[Button]`.
 *
 *   static props = {
 *     bake: { type: 'button', label: 'Bake Curves', action: 'bakeCurves' },
 *   };
 *   bakeCurves({ props, set, entity }) { ... }   // or a static method
 *
 * Which object the method is called on depends on the script kind, and the
 * rule is "the object that owns the state the button acts on":
 *
 *   1. A **mounted canvas** script has a live instance (canvasRunner keeps one
 *      per entity+script while it is on screen) and its method runs there, so
 *      the button sees the same WebGL/Three.js state `onUpdate` sees.
 *   2. A method that exists on the **export itself** — a `static` method on a
 *      class, or a property attached to a function component
 *      (`MyClip.reset = () => …`) — runs on the export.
 *   3. Otherwise a **prototype method** runs on a per-module instance created
 *      once, lazily, and kept in a `WeakMap` keyed by the compiled module.
 *      Motion scripts are instantiated fresh on every evaluation (they are
 *      deterministic functions of `time`), so an action has no live instance
 *      to join; a cached one at least means two clicks share state.
 *
 * The method receives one context object. `props` is the same resolved map the
 * script gets in `onStart`/`onUpdate`, and `set`/`setAll` write props back
 * through the app's own update path — so a button can legitimately transform
 * the component it sits on (randomise a seed, reset to defaults, copy a value),
 * which is what most Odin buttons do.
 *
 * Failures are returned rather than thrown: a button that hits a script error
 * must not take the inspector down with it.
 *
 * Note the two blocklists below. A script export is a class, a function or a
 * plain object, and every one of those inherits methods (`toString`, `call`,
 * `bind`, …) that a button named after one of them would otherwise "find" and
 * call with the wrong receiver.
 */
const INHERITED_METHODS = new Set([
  'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString',
  'toString', 'valueOf', '__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__',
  '__lookupSetter__', 'call', 'apply', 'bind', 'caller', 'callee', 'arguments', 'name', 'length',
  'prototype',
]);

/** Prototype-method instances, keyed by the compiled module they belong to. */
const actionInstances = new WeakMap();

/**
 * Resolve the object an action should run on.
 * @returns {{ fn: Function, thisArg: any, via: 'mounted'|'static'|'instance' }|null}
 */
function resolveActionTarget(compiled, action, mounted) {
  if (!compiled || !action || INHERITED_METHODS.has(action)) return null;

  if (mounted && typeof mounted[action] === 'function') {
    return { fn: mounted[action], thisArg: mounted, via: 'mounted' };
  }

  const isFunction = typeof compiled === 'function';
  // Static method on a class, or a helper attached to a function component —
  // always an own property, never something inherited from Function.prototype.
  if (isFunction && Object.prototype.hasOwnProperty.call(compiled, action)
      && typeof compiled[action] === 'function') {
    return { fn: compiled[action], thisArg: compiled, via: 'static' };
  }
  if (!isFunction && typeof compiled === 'object' && typeof compiled[action] === 'function') {
    return { fn: compiled[action], thisArg: compiled, via: 'static' };
  }

  // Prototype method → one lazily created instance per compiled module.
  if (isFunction && typeof compiled.prototype?.[action] === 'function') {
    let instance = actionInstances.get(compiled);
    if (!instance) {
      try {
        instance = new compiled();
      } catch (err) {
        console.warn(`Script action "${action}": could not instantiate the script`, err);
        return null;
      }
      actionInstances.set(compiled, instance);
    }
    if (typeof instance[action] !== 'function') return null;
    return { fn: instance[action], thisArg: instance, via: 'instance' };
  }

  return null;
}

/** Action names a script's export exposes, for menus and diagnostics. */
export function listScriptActions(scriptCode) {
  const compiled = compileScriptModule(scriptCode);
  if (!compiled) return [];

  const names = new Set();
  const add = (key) => {
    if (!INHERITED_METHODS.has(key)) names.add(key);
  };

  if (typeof compiled === 'function') {
    for (const key of Object.getOwnPropertyNames(compiled)) add(key);
  } else if (typeof compiled === 'object') {
    for (const key of Object.keys(compiled)) add(key);
  }
  for (const key of Object.getOwnPropertyNames(compiled.prototype || {})) add(key);
  names.delete('constructor');

  return [...names].filter((name) => typeof compiled[name] === 'function'
    || typeof compiled.prototype?.[name] === 'function').sort();
}

/**
 * Run one action of one script component.
 *
 * @param {object}   args
 * @param {string}   args.scriptCode   - the script's source
 * @param {string}   args.action       - method name declared on the button
 * @param {object}   args.props        - resolved prop values the script sees
 * @param {string}   [args.entityId]   - owning entity (finds a mounted instance)
 * @param {string}   [args.scriptId]   - the ScriptComponent's script id
 * @param {object}   [args.entity]     - the owning entity object
 * @param {Function} [args.setProp]    - write one prop `(name, value) => void`
 * @param {Function} [args.setProps]   - write several `(patch) => void`
 * @param {Function} [args.refresh]    - ask the host to re-read the component
 * @param {object}   [args.timing]     - `{ time, frame, fps, duration }`
 * @returns {Promise<{ ok: boolean, via?: string, result?: any, error?: string }>}
 */
export async function invokeScriptAction({
  scriptCode,
  action,
  props = {},
  entityId,
  scriptId = '',
  entity = null,
  setProp,
  setProps,
  refresh,
  timing = {},
}) {
  if (!scriptCode) return { ok: false, error: 'script has no code yet' };
  if (!action) return { ok: false, error: 'button has no action' };

  const compiled = compileScriptModule(scriptCode);
  if (!compiled) return { ok: false, error: 'script did not compile' };

  let mounted = null;
  if (entityId) {
    try {
      mounted = getMountedCanvasInstance(entityId, scriptId);
    } catch {
      mounted = null;
    }
  }

  const target = resolveActionTarget(compiled, action, mounted);
  if (!target) return { ok: false, error: `script has no "${action}" method` };

  const context = {
    props,
    set: (name, value) => setProp?.(name, value),
    setAll: (patch) => setProps?.(patch),
    refresh: () => refresh?.(),
    entity,
    entityId,
    scriptId,
    ...timing,
  };

  try {
    const result = await target.fn.call(target.thisArg, context);
    return { ok: true, via: target.via, result };
  } catch (err) {
    console.warn(`Script action "${action}" failed:`, err);
    return { ok: false, via: target.via, error: err?.message || String(err) };
  }
}
