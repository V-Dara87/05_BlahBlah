 
import { compileScriptModule, getScriptError, extractScriptProps } from './scriptRunner.js';
import { resolveScriptProps } from './referenceTypes.js';
import { Tween } from './motionTween.js';
 
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
 *     onMount({ container, props, canvasWidth, canvasHeight }) {}
 *     onUpdate({ container, time, frame, props, canvasWidth, canvasHeight }) {}
 *     onUnmount() {}
 *   }
 *
 * External packages (THREE, gsap, etc.) are pulled in via plain ES
 * `import` statements at the top of the script and resolved through
 * packageResolver.js/moduleCache.js — fetched from esm.sh once, then
 * served from IndexedDB on every subsequent load, fully offline. There is
 * no separate `libs` object anymore; the old CANVAS_LIB_SOURCES CDN
 * <script>-tag loader (uncached, always required network) was removed.
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
 *
 * ─── canvasWidth / canvasHeight ────────────────────────────────────────
 * The runner doesn't measure the DOM (`container.clientWidth`) for you —
 * that's often 0 or a CSS-scaled preview size, not the project's real
 * output resolution, which is why scripts used to have to guess. Instead:
 *
 *   - The caller (EntityRenderer.jsx) passes the PROJECT's resolution as
 *     `canvasWidth`/`canvasHeight` on every call — this is the default.
 *   - A script can override it per-instance by declaring `canvasWidth`
 *     and/or `canvasHeight` in its own `static props` (e.g. `{ type:
 *     'number', default: 512 }`). Once declared, that field is a normal
 *     Inspector-editable/keyframeable prop, and its resolved value (from
 *     `props`) wins over the project default for that entity.
 *   - Either way, the effective numbers are handed to the script as
 *     `canvasWidth`/`canvasHeight` in onMount/onUpdate/onSeek — this
 *     function does NOT resize the container or canvas itself; the script
 *     decides what to do with the numbers (size a <canvas>, set a
 *     WebGLRenderer size, ignore them, etc.).
 */
 
// Per-entity+script mounted-instance state, keyed by a mount key of
// `entityId::scriptId` (not just entity id), so we know when to call
// onMount vs onUpdate vs onUnmount as entities enter/leave the active
// window or their script changes — and so multiple canvas-kind scripts on
// one entity each get their own independent lifecycle.
const mountedInstances = new Map();
 
const mountKeyFor = (entityId, scriptId = '') => `${entityId}::${scriptId || ''}`;

/**
 * The live instance of a mounted canvas script, or null when it is not
 * mounted (entity off screen, script not attached, wrong script id).
 *
 * Exists for script *actions* — an inspector button declared with
 * `{ type: 'button', action: 'bake' }` should call the running instance when
 * there is one, since that is the object that owns the state the button is
 * meant to act on (see engine/scriptActions.js).
 */
export function getMountedCanvasInstance(entityId, scriptId = '') {
  return mountedInstances.get(mountKeyFor(entityId, scriptId))?.instance ?? null;
}
 
/**
 * Resolves the effective canvas size for a script call: a script's own
 * declared+resolved `canvasWidth`/`canvasHeight` prop wins (if present and
 * a positive number), otherwise falls back to the project-default value
 * passed in by the caller.
 */
function resolveCanvasSize(props, defaultWidth, defaultHeight) {
  const w = Number(props?.canvasWidth);
  const h = Number(props?.canvasHeight);
  return {
    canvasWidth: Number.isFinite(w) && w > 0 ? w : defaultWidth,
    canvasHeight: Number.isFinite(h) && h > 0 ? h : defaultHeight,
  };
}
 
/**
 * Mounts (if needed) and updates a CanvasRenderer component for one frame.
 * Call this every render tick for every active canvas-kind script;
 * call `unmountCanvasComponent(entityId, scriptId)` when the entity becomes
 * inactive or is removed.
 *
 * `canvasWidth`/`canvasHeight` should be the project's current output
 * resolution (e.g. `resolution.width`/`resolution.height` from
 * App.jsx/EntityRenderer) — used as the default a script receives unless
 * it overrides via its own `static props`. See file header for details.
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
  canvasWidth = 0,
  canvasHeight = 0,
  duration = 5,
  startTime = 0,
  allEntities = [],
  allAssets = [],
}) {
  if (!scriptCode || !container) return;
 
  const mountKey = mountKeyFor(entityId, scriptId);
  let mounted = mountedInstances.get(mountKey);
 
  const compiled = compileScriptModule(scriptCode);
  if (!compiled) return; // compile error already recorded in scriptRunner's lastErrorCache
 
  const needsRemount = !mounted || mounted.scriptCode !== scriptCode;

  // Container re-attachment: if the DOM container changed (e.g. React reconciliation,
  // Dockview panel layout change or remount) while the script code is identical, do NOT
  // tear down the script instance. Preserve all state, WebGL context, geometries, and
  // in-flight async loading (such as FontLoader or textures).
  if (mounted && mounted.container !== container) {
    const prevContainer = mounted.container;
    mounted.prevContainer = prevContainer;
    mounted.container = container;

    // Reparent any canvas or DOM nodes from the old container to the new one
    if (prevContainer && prevContainer !== container) {
      while (prevContainer.firstChild) {
        container.appendChild(prevContainer.firstChild);
      }
    }

    if (mounted.instance && typeof mounted.instance === 'object' && 'container' in mounted.instance) {
      mounted.instance.container = container;
    }

    safeCall(mounted.instance, 'onContainerReattach', { container, prevContainer });
  }
 
 
  const schema = extractScriptProps(scriptCode);
  const effProps = resolveScriptProps(props, schema, allEntities, allAssets);
 
  const { canvasWidth: effWidth, canvasHeight: effHeight } = resolveCanvasSize(effProps, canvasWidth, canvasHeight);
 
  // Clip timing metadata for animation convenience
  const effDuration = Number.isFinite(duration) && duration > 0 ? duration : 5;
  const effStartTime = Number.isFinite(startTime) ? startTime : 0;
  const effEndTime = effStartTime + effDuration;
  const effectiveFps = fps || 30;
  const totalFrames = Math.max(1, Math.round(effDuration * effectiveFps));
  const progress = effDuration > 0 ? Math.max(0, Math.min(1, localTime / effDuration)) : 0;
  const timeLeft = Math.max(0, effDuration - localTime);
 
  const timingArgs = {
    duration: effDuration,
    totalFrames,
    progress,
    startTime: effStartTime,
    endTime: effEndTime,
    timeLeft,
    timelineTime: effStartTime + localTime,
  };
 
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
 
    mounted = { instance, scriptCode, container, prevContainer: null, lastLocalTime: null, controller: new AbortController() };
    mountedInstances.set(mountKey, mounted);
 
    // Expose size and aspect directly on the instance so user scripts can access
    // this.canvasWidth / this.canvasHeight / this.aspect without manual boilerplate
    if (instance && typeof instance === 'object') {
      instance.canvasWidth = effWidth;
      instance.canvasHeight = effHeight;
      instance.aspect = effHeight > 0 ? effWidth / effHeight : 1;
    }

    safeCall(instance, 'onMount', {
      container,
      signal: mounted.controller.signal,
      props: effProps,
      canvasWidth: effWidth,
      canvasHeight: effHeight,
      aspect: effHeight > 0 ? effWidth / effHeight : 1,
      tween: Tween,
      Tween,
      ...timingArgs,
    });
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
    safeCall(mounted.instance, 'onSeek', {
      container,
      time: localTime,
      frame,
      fps,
      props: effProps,
      canvasWidth: effWidth,
      canvasHeight: effHeight,
      tween: Tween,
      Tween,
      ...timingArgs,
    });
  }
 
  mounted.lastLocalTime = localTime;

  // If the script created a canvas or WebGLRenderer domElement after onMount (e.g. inside an
  // async callback like FontLoader), ensure it is attached to the active container if not already.
  const canvasEl = mounted.instance?.renderer?.domElement || mounted.instance?.canvas;
  if (canvasEl && canvasEl.parentNode !== container) {
    container.appendChild(canvasEl);
  } else if (mounted.prevContainer && mounted.prevContainer !== container && mounted.prevContainer.firstChild) {
    while (mounted.prevContainer.firstChild) {
      container.appendChild(mounted.prevContainer.firstChild);
    }
  }

  // Keep size updated directly on instance
  if (mounted.instance && typeof mounted.instance === 'object') {
    mounted.instance.canvasWidth = effWidth;
    mounted.instance.canvasHeight = effHeight;
    mounted.instance.aspect = effHeight > 0 ? effWidth / effHeight : 1;

    // Automatic resize helper for Three.js WebGLRenderer & Camera if present
    const inst = mounted.instance;
    if (inst.autoResize !== false && inst.renderer && typeof inst.renderer.setSize === 'function') {
      const dom = inst.renderer.domElement;
      if (dom && (dom.width !== effWidth || dom.height !== effHeight)) {
        inst.renderer.setSize(effWidth, effHeight, false);
        if (inst.camera && inst.camera.isPerspectiveCamera) {
          inst.camera.aspect = effWidth / effHeight;
          inst.camera.updateProjectionMatrix();
        }
      }
    }
  }

  safeCall(mounted.instance, 'onUpdate', {
    container,
    time: localTime,
    frame,
    fps,
    props: effProps,
    canvasWidth: effWidth,
    canvasHeight: effHeight,
    aspect: effHeight > 0 ? effWidth / effHeight : 1,
    tween: Tween,
    Tween,
    ...timingArgs,
  });
}
 
export function unmountCanvasComponent(entityId, scriptId = '') {
  const mountKey = mountKeyFor(entityId, scriptId);
  const mounted = mountedInstances.get(mountKey);
  if (!mounted) return;
  mounted.controller?.abort();
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
 
