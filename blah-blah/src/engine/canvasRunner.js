import { compileScriptModule, getScriptError } from './scriptRunner';
import { CANVAS_LIB_SOURCES } from './ecs';
 
/**
 * P0 #2 — canvas-kind script lifecycle runner.
 *
 * Canvas-kind scripts (detected via detectScriptKind in scriptRunner.js —
 * the runtime sees ONE component type, ScriptComponent, and dispatches
 * here when the script implements the canvas contract) follow this
 * contract:
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
 * entity.startTime), never wall-clock/rAF-accumulated, so scrubbing and
 * export both "just work" the same way the motion-script onUpdate does
 * for the render pipeline.
 *
 * Reuses compileScriptModule/extractScriptProps from scriptRunner.js
 * unchanged — canvas-kind scripts don't need their own compile/props
 * pipeline.
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
}// Per-entity+script mounted-instance state, keyed by a mount key of
// `entityId::scriptId` (not just entity id), so we know when to call
// onMount vs onUpdate vs onUnmount as entities enter/leave the active
// window or their script changes — and so multiple canvas-kind scripts on
// one entity each get their own independent lifecycle.
const mountedInstances = new Map();

const mountKeyFor = (entityId, scriptId = '') => `${entityId}::${scriptId || ''}`;

/**
 * Mounts (if needed) and updates a CanvasRenderer component for one frame.
 * Call this every render tick for every active canvas-kind script;
 * call `unmountCanvasComponent(entityId, scriptId)` when the entity becomes
 * inactive or is removed.
 */
export function updateCanvasComponent({
  entityId,
  scriptId = '',
  scriptCode,
  container,
  localTime = 0,
  frame = 0,
  fps = 30,
  props = {},
}) {
  if (!scriptCode || !container) return;

  const mountKey = mountKeyFor(entityId, scriptId);
  let mounted = mountedInstances.get(mountKey);

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

    mounted = { instance, scriptCode, container, libs, lastLocalTime: null };
    mountedInstances.set(mountKey, mounted);

    safeCall(instance, 'onMount', { container, props, libs });
  }
 
  // Scrub/seek detection. onMount only fires once per (scriptCode,
  // container) pair (see mount/remount logic above), which is correct for
  // "container/scriptCode changed" but leaves no natural reset point for a
  // script that accumulates state across onUpdate calls (particle trails,
  // counters, anything that isn't a pure function of `time`) when the user
  // drags the playhead backward, or jumps it forward past where a normal
  // playback tick would land. A normal forward-playback tick advances
  // roughly one frame at a time; anything bigger than ~2 frames' worth, in
  // either direction, is treated as a scrub rather than playback. When
  // that happens we call an optional `onSeek({ container, time, frame,
  // fps, props })` hook *before* onUpdate, so a script can reset its own
  // internal state if it wants to. This is additive: scripts that don't
  // define onSeek behave exactly as before.
  const frameDuration = 1 / (fps || 30);
  const scrubThreshold = frameDuration * 2;
  const isScrub =
    mounted.lastLocalTime !== null && Math.abs(localTime - mounted.lastLocalTime) > scrubThreshold;
 
  if (isScrub) {
    safeCall(mounted.instance, 'onSeek', { container, time: localTime, frame, fps, props });
  }
 
  mounted.lastLocalTime = localTime;
 
  safeCall(mounted.instance, 'onUpdate', {
    container,
    time: localTime,
    frame,
    fps,
    props,
  });
}

export function unmountCanvasComponent(entityId, scriptId = '') {
  const mountKey = mountKeyFor(entityId, scriptId);
  const mounted = mountedInstances.get(mountKey);
  if (!mounted) return;
  safeCall(mounted.instance, 'onUnmount', { container: mounted.container });
  mountedInstances.delete(mountKey);
}

/**
 * Unmount every tracked instance whose mount key is not in the given set
 * of still-active keys (`entityId::scriptId` strings — pass the exact keys
 * the active instances were updated with).
 */
export function pruneCanvasComponents(activeMountKeys) {
  const activeSet = new Set(activeMountKeys);
  for (const mountKey of mountedInstances.keys()) {
    if (!activeSet.has(mountKey)) {
      const [entityId, scriptId = ''] = mountKey.split('::');
      unmountCanvasComponent(entityId, scriptId);
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