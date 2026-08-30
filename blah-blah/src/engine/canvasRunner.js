import { compileScriptModule, getScriptError } from './scriptRunner';
import { CANVAS_LIB_SOURCES } from './ecs';
 
/**
 * P0 #2 — CanvasRenderer lifecycle runner.
 *
 * Contract (see engine/ecs.js RENDERER_REGISTRY.CanvasRenderer for the
 * canonical doc comment):
 *
 *   export default class MyThing {
 *     static props = { speed: { type: 'number', default: 1, min: 0, max: 10 } };
 *     onMount({ container, props, libs }) {}
 *     onUpdate({ container, time, frame, props }) {}
 *     onUnmount() {}
 *   }
 *
 * `container` is a plain <div> owned by EntityRenderer for this entity.
 * `time`/`frame` are ABSOLUTE-TIMELINE-derived (localTime = currentTime -
 * entity.startTime), never wall-clock/rAF-accumulated, so scrubbing and a
 * future deterministic export pass both "just work" the same way #2's
 * onUpdate does for the render pipeline.
 *
 * Reuses compileScriptModule/extractScriptProps from scriptRunner.js
 * unchanged, per the roadmap note that CanvasRenderer shouldn't need its
 * own compile/props pipeline.
 */
 
// Cache of loaded lib globals, keyed by lib name, so multiple CanvasRenderer
// instances on the same page don't each inject their own <script> tag.
const libLoadPromises = new Map();
 
function loadLib(name) {
  if (libLoadPromises.has(name)) return libLoadPromises.get(name);
 
  const src = CANVAS_LIB_SOURCES[name];
  if (!src) {
    return Promise.reject(new Error(`Unknown canvas lib "${name}" — add it to CANVAS_LIB_SOURCES in ecs.js`));
  }
 
  const promise = new Promise((resolve, reject) => {
    // If a global with this name already exists (e.g. loaded by another
    // instance, or the page itself), use it immediately.
    if (window[name]) {
      resolve(window[name]);
      return;
    }
 
    const existingTag = document.querySelector(`script[data-canvas-lib="${name}"]`);
    if (existingTag) {
      existingTag.addEventListener('load', () => resolve(window[name]));
      existingTag.addEventListener('error', () => reject(new Error(`Failed to load lib "${name}"`)));
      return;
    }
 
    const tag = document.createElement('script');
    tag.src = src;
    tag.async = true;
    tag.dataset.canvasLib = name;
    tag.onload = () => resolve(window[name]);
    tag.onerror = () => reject(new Error(`Failed to load lib "${name}" from ${src}`));
    document.head.appendChild(tag);
  });
 
  libLoadPromises.set(name, promise);
  return promise;
}
 
/**
 * Lazily builds a `libs` proxy object. Accessing `libs.THREE` triggers a
 * load (and returns undefined until it resolves) rather than eagerly
 * loading every registered library up front — most CanvasRenderer scripts
 * only need one or two.
 *
 * Because script access to `libs.X` is synchronous, we resolve libs
 * up-front (awaited by the caller before onMount runs) for the small,
 * known set of libs a script's compiled module was written for. Since we
 * can't statically know which libs a script needs, EntityRenderer instead
 * calls `preloadLibs(names)` for the libs it was told about via a
 * `static libs = ['THREE']` convention (optional) and always exposes a
 * live-binding proxy so a lib that finishes loading slightly late still
 * becomes available on the next onUpdate tick.
 */
function createLibsProxy() {
  const cache = {};
  return new Proxy(cache, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (target[prop]) return target[prop];
      if (window[prop]) {
        target[prop] = window[prop];
        return target[prop];
      }
      // Kick off a load in the background; script will see it appear on a
      // subsequent onUpdate call once resolved (libs with their own
      // rAF/ticker will pick it up naturally; static onMount-time use of
      // an unloaded lib should call `await libs.load('X')` — see below).
      if (CANVAS_LIB_SOURCES[prop]) {
        loadLib(prop).then((mod) => {
          target[prop] = mod;
        });
      }
      return undefined;
    },
  });
}
 
/**
 * Explicit async loader exposed as `libs.load(name)` for scripts that need
 * to `await` a library before using it in onMount (recommended pattern for
 * anything beyond the simplest raw Canvas 2D scripts).
 */
function attachLoader(libs) {
  libs.load = (name) => loadLib(name);
  return libs;
}
 
// Per-entity mounted-instance state, keyed by entity id, so we know when to
// call onMount vs onUpdate vs onUnmount as entities enter/leave the active
// window or their script changes.
const mountedInstances = new Map();
 
/**
 * Mounts (if needed) and updates a CanvasRenderer component for one frame.
 * Call this every render tick for every active CanvasRenderer entity;
 * call `unmountCanvasComponent(entityId)` when the entity becomes inactive
 * or is removed.
 */
export function updateCanvasComponent({
  entityId,
  scriptCode,
  container,
  localTime = 0,
  frame = 0,
  fps = 30,
  props = {},
}) {
  if (!scriptCode || !container) return;
 
  let mounted = mountedInstances.get(entityId);
 
  const compiled = compileScriptModule(scriptCode);
  if (!compiled) return; // compile error already recorded in scriptRunner's lastErrorCache
 
  const needsRemount = !mounted || mounted.scriptCode !== scriptCode || mounted.container !== container;
 
  if (needsRemount) {
    if (mounted) {
      safeCall(mounted.instance, 'onUnmount', { container: mounted.container });
    }
 
    let instance = null;
    try {
      if (typeof compiled === 'function' && compiled.prototype) {
        instance = new compiled();
      } else if (typeof compiled === 'object') {
        instance = compiled;
      }
    } catch (err) {
      console.warn('CanvasRenderer instantiation error:', err);
      return;
    }
 
    const libs = attachLoader(createLibsProxy());
 
    mounted = { instance, scriptCode, container, libs };
    mountedInstances.set(entityId, mounted);
 
    safeCall(instance, 'onMount', { container, props, libs });
  }
 
  safeCall(mounted.instance, 'onUpdate', {
    container,
    time: localTime,
    frame,
    fps,
    props,
  });
}
 
export function unmountCanvasComponent(entityId) {
  const mounted = mountedInstances.get(entityId);
  if (!mounted) return;
  safeCall(mounted.instance, 'onUnmount', { container: mounted.container });
  mountedInstances.delete(entityId);
}
 
/** Unmount every tracked instance not present in the given set of still-active entity ids. */
export function pruneCanvasComponents(activeEntityIds) {
  const activeSet = new Set(activeEntityIds);
  for (const entityId of mountedInstances.keys()) {
    if (!activeSet.has(entityId)) {
      unmountCanvasComponent(entityId);
    }
  }
}
 
function safeCall(instance, methodName, args) {
  const fn = instance?.[methodName];
  if (typeof fn !== 'function') return;
  try {
    fn.call(instance, args);
  } catch (err) {
    console.warn(`CanvasRenderer ${methodName}() error:`, err);
  }
}
 
export { getScriptError };