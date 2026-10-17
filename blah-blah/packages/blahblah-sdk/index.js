/**
 * Runtime for @blahblah/sdk. This is what `extends CanvasComponent` (or
 * `extends MotionScript`) and helpers like `interpolate`, `spring`, `MathUtils`,
 * `Easing` resolve to when a script imports them — see scriptBundler.js's
 * `blahblah-sdk` virtual-module resolution.
 */

// ─── Lifecycle base classes ──────────────────────────────────────────────────

export class MotionScript {
  /** Called once when the script's host element is mounted into the DOM. @param {import('./index.d.ts').MotionScriptMountArgs} args */
  onMount(args) {}
  /** Called every frame during playback. @param {import('./index.d.ts').MotionScriptUpdateArgs} args */
  onUpdate(args) {}
  /** Called when the playhead jumps (scrub/seek) — reset accumulated state here. @param {import('./index.d.ts').MotionScriptSeekArgs} args */
  onSeek(args) {}
  /** Called when the script's host element is removed from the DOM. @param {import('./index.d.ts').MotionScriptUnmountArgs} args */
  onUnmount(args) {}
}

export class CanvasComponent extends MotionScript {
  /** @type {HTMLElement | null} */
  container = null;
  /** @type {HTMLCanvasElement | null} */
  canvas = null;
  /** @type {CanvasRenderingContext2D | null} */
  ctx = null;
  /** @type {number} */
  canvasWidth = 0;
  /** @type {number} */
  canvasHeight = 0;
  /** @type {number} */
  aspect = 1;

  onMount(args) {
    this.container = args.container;
    this.canvasWidth = args.canvasWidth || 0;
    this.canvasHeight = args.canvasHeight || 0;
    this.aspect = args.aspect || (this.canvasHeight > 0 ? this.canvasWidth / this.canvasHeight : 1);

    if (this.container && !this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.canvasWidth;
      this.canvas.height = this.canvasHeight;
      this.ctx = this.canvas.getContext('2d');
      this.container.appendChild(this.canvas);
    }
  }

  onUpdate(args) {
    this.canvasWidth = args.canvasWidth || this.canvasWidth;
    this.canvasHeight = args.canvasHeight || this.canvasHeight;
    this.aspect = args.aspect || (this.canvasHeight > 0 ? this.canvasWidth / this.canvasHeight : 1);

    if (this.container && !this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.canvasWidth;
      this.canvas.height = this.canvasHeight;
      this.ctx = this.canvas.getContext('2d');
      this.container.appendChild(this.canvas);
    }

    if (this.canvas && (this.canvas.width !== this.canvasWidth || this.canvas.height !== this.canvasHeight)) {
      this.canvas.width = this.canvasWidth;
      this.canvas.height = this.canvasHeight;
    }
  }

  onUnmount() {
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
    this.container = null;
  }

  /**
   * Converts center-origin coordinates (where 0,0 is canvas center)
   * to canvas pixel coordinates (where 0,0 is top-left).
   * @param {number} x Offset from canvas center X
   * @param {number} y Offset from canvas center Y
   * @returns {{ x: number, y: number }}
   */
  toScreen(x, y) {
    return {
      x: (this.canvasWidth / 2) + (Number(x) || 0),
      y: (this.canvasHeight / 2) + (Number(y) || 0),
    };
  }

  /**
   * Converts canvas pixel coordinates (where 0,0 is top-left)
   * to center-origin coordinates (where 0,0 is canvas center).
   * @param {number} x
   * @param {number} y
   * @returns {{ x: number, y: number }}
   */
  fromScreen(x, y) {
    return {
      x: (Number(x) || 0) - (this.canvasWidth / 2),
      y: (Number(y) || 0) - (this.canvasHeight / 2),
    };
  }

  /**
   * Centers the 2D canvas context origin so (0, 0) is at the center of the canvas.
   * Call `this.restoreOrigin()` or `this.ctx.restore()` when done.
   */
  centerOrigin() {
    if (!this.ctx) return;
    this.ctx.save();
    this.ctx.translate(this.canvasWidth / 2, this.canvasHeight / 2);
  }

  /**
   * Restores canvas transform previously saved by `centerOrigin()`.
   */
  restoreOrigin() {
    if (!this.ctx) return;
    this.ctx.restore();
  }
}

export class ThreeComponent extends MotionScript {
  /** @type {HTMLElement | null} */
  container = null;
  /** @type {any} THREE.Scene */
  scene = null;
  /** @type {any} THREE.Camera */
  camera = null;
  /** @type {any} THREE.WebGLRenderer */
  renderer = null;
  /** @type {number} */
  canvasWidth = 0;
  /** @type {number} */
  canvasHeight = 0;
  /** @type {number} */
  aspect = 1;

  onMount(args) {
    this.container = args.container;
    this.canvasWidth = args.canvasWidth || 0;
    this.canvasHeight = args.canvasHeight || 0;
    this.aspect = args.aspect || (this.canvasHeight > 0 ? this.canvasWidth / this.canvasHeight : 1);

    // If subclass created this.renderer during or before onMount, attach its DOM
    if (this.renderer && this.renderer.domElement && this.container) {
      if (this.renderer.domElement.parentNode !== this.container) {
        this.container.appendChild(this.renderer.domElement);
      }
    }
  }

  onUpdate(args) {
    this.canvasWidth = args.canvasWidth || this.canvasWidth;
    this.canvasHeight = args.canvasHeight || this.canvasHeight;
    this.aspect = args.aspect || (this.canvasHeight > 0 ? this.canvasWidth / this.canvasHeight : 1);

    // Automatic camera & renderer resize
    if (this.renderer && typeof this.renderer.setSize === 'function') {
      const dom = this.renderer.domElement;
      if (dom && (dom.width !== this.canvasWidth || dom.height !== this.canvasHeight)) {
        this.renderer.setSize(this.canvasWidth, this.canvasHeight, false);
        if (this.camera && this.camera.isPerspectiveCamera) {
          this.camera.aspect = this.canvasWidth / this.canvasHeight;
          this.camera.updateProjectionMatrix();
        }
      }
    }
  }

  onUnmount() {
    this.renderer?.dispose?.();
    this.renderer?.domElement?.remove?.();
    this.renderer = null;
    this.camera = null;
    this.scene = null;
    this.container = null;
  }
}

// ─── Function-style scripts (the easy way) ───────────────────────────────────
//
//   export default canvasScript({
//     props: { size: num(40, { min: 10, max: 200 }), tint: color('#38bdf8') },
//     draw({ ctx, width, height, time, props }) {
//       ctx.fillStyle = props.tint;                     // (0, 0) is the center
//       ctx.fillRect(-props.size / 2, -props.size / 2, props.size, props.size);
//     },
//   });
//
// One object, no class, no canvas plumbing. Under the hood it builds a normal
// CanvasComponent / MotionScript subclass, so everything the class style can do
// (props, gizmos, the Inspector, keyframes, export) works the same way.
//
// STRICT: an unknown key (`drwa`, `update` in a canvasScript) or a missing
// `draw` is an error that names the fix, instead of a script that quietly does
// nothing.

function oneEditApart(a, b) {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    // one substitution, or two adjacent letters swapped ("drwa" -> "draw")
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

function suggestKey(name, allowed) {
  const lower = String(name).toLowerCase();
  for (const key of allowed) {
    if (key.toLowerCase() === lower) return key;
  }
  for (const key of allowed) {
    if (oneEditApart(String(name), key)) return key;
  }
  return null;
}

function checkDefinition(fnName, def, allowed) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) {
    throw new TypeError(`${fnName}(...) expects one object, e.g. ${fnName}({ props: {…}, ${allowed.includes('draw') ? 'draw' : 'update'}() {…} }).`);
  }
  for (const key of Object.keys(def)) {
    if (allowed.includes(key)) continue;
    const hint = suggestKey(key, allowed);
    throw new TypeError(
      `${fnName}: unknown key '${key}'${hint ? ` — did you mean '${hint}'?` : '.'} Allowed keys: ${allowed.join(', ')}.`,
    );
  }
  for (const key of allowed) {
    if (key === 'props' || key === 'origin' || key === 'clear') continue;
    if (def[key] !== undefined && typeof def[key] !== 'function') {
      throw new TypeError(`${fnName}: '${key}' must be a function, got ${typeof def[key]}.`);
    }
  }
  if (def.props !== undefined && (def.props === null || typeof def.props !== 'object' || Array.isArray(def.props))) {
    throw new TypeError(`${fnName}: 'props' must be an object, e.g. props: { speed: num(1) }.`);
  }
}

/**
 * The plain default value of every simple prop in `props` (`num(2)` -> 2,
 * `color('#fff')` -> '#fff', a bare `5` -> 5). Reference props (entity/asset)
 * and structs have no simple default and are left out.
 */
function propDefaults(propsDef) {
  const out = {};
  for (const [key, def] of Object.entries(propsDef || {})) {
    if (def && typeof def === 'object' && !Array.isArray(def)) {
      if ('default' in def && def.type !== 'struct' && def.type !== 'struct[]') out[key] = def.default;
    } else if (typeof def === 'number' || typeof def === 'boolean' || typeof def === 'string') {
      out[key] = def;
    }
  }
  return out;
}

/** `props` as the script sees it: the declared defaults, overridden by whatever the Inspector supplied. */
function withDefaults(defaults, given) {
  const out = { ...defaults };
  if (given && typeof given === 'object') {
    for (const [key, value] of Object.entries(given)) {
      if (value !== undefined) out[key] = value;
    }
  }
  return out;
}

const CANVAS_SCRIPT_KEYS = ['props', 'setup', 'draw', 'seek', 'cleanup', 'origin', 'clear'];
const MOTION_SCRIPT_KEYS = ['props', 'start', 'update'];

/**
 * A 2D canvas script as one object.
 *
 *   props    Inspector fields (`num`, `color`, `text`, … or long-hand objects).
 *            Inside the functions, `props` always has every declared default
 *            filled in, so `props.size` is never undefined.
 *   setup    optional, once, after the canvas exists.   setup({ ctx, width, height, props })
 *   draw     required, every frame.                     draw({ ctx, width, height, time, props, … })
 *   seek     optional, when the playhead jumps.         seek({ time, props })
 *   cleanup  optional, when the script is removed.
 *   origin   'center' (default: 0,0 is the middle) or 'top-left'.
 *   clear    true (default): the canvas is cleared before every draw.
 *
 * Inside every function `this` is the script instance, so state set in
 * `setup` (`this.particles = []`) is available in `draw`. Use method syntax
 * (not arrow functions) if you want `this`.
 */
export function canvasScript(def) {
  checkDefinition('canvasScript', def, CANVAS_SCRIPT_KEYS);
  if (typeof def.draw !== 'function') {
    throw new TypeError('canvasScript: missing `draw`. Add draw({ ctx, width, height, time, props }) { … }.');
  }
  if (def.origin !== undefined && def.origin !== 'center' && def.origin !== 'top-left') {
    throw new TypeError(`canvasScript: origin must be 'center' or 'top-left', got '${def.origin}'.`);
  }
  const centered = def.origin !== 'top-left';
  const clear = def.clear !== false;

  const defaults = propDefaults(def.props);
  const frameArgs = (self, args) => ({
    ...args,
    ctx: self.ctx,
    canvas: self.canvas,
    width: self.canvasWidth,
    height: self.canvasHeight,
    props: withDefaults(defaults, args && args.props),
    random: MathUtils.random,
    createRandom: MathUtils.createRandom,
    noise1D: MathUtils.noise1D,
    noise2D: MathUtils.noise2D,
    wiggle: MathUtils.wiggle,
    wiggle2D: MathUtils.wiggle2D,
    drawCube3D: (opts) => drawCube3D(self.ctx, opts),
    drawPyramid3D: (opts) => drawPyramid3D(self.ctx, opts),
    drawCylinder3D: (opts) => drawCylinder3D(self.ctx, opts),
    drawSphere3D: (opts) => drawSphere3D(self.ctx, opts),
  });

  class DefinedCanvasScript extends CanvasComponent {
    static props = def.props || {};

    onMount(args) {
      super.onMount(args);
      if (def.setup) def.setup.call(this, frameArgs(this, args));
    }

    onUpdate(args) {
      super.onUpdate(args);
      const { ctx } = this;
      if (!ctx) return;
      if (clear) ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
      ctx.save();
      try {
        if (centered) ctx.translate(this.canvasWidth / 2, this.canvasHeight / 2);
        def.draw.call(this, frameArgs(this, args));
      } finally {
        ctx.restore();
      }
    }

    onSeek(args) {
      if (def.seek) def.seek.call(this, frameArgs(this, args));
    }

    onUnmount(args) {
      try {
        if (def.cleanup) def.cleanup.call(this, args);
      } finally {
        super.onUnmount(args);
      }
    }
  }
  return DefinedCanvasScript;
}

/**
 * A transform (motion) script as one object.
 *
 *   props   Inspector fields.
 *   start   optional, once: set up tweens.  start({ transform, tween, props, … })
 *   update  optional, every frame.          update({ transform, props, time, … })
 *
 * At least one of `start` / `update` is required.
 */
export function motionScript(def) {
  checkDefinition('motionScript', def, MOTION_SCRIPT_KEYS);
  if (typeof def.start !== 'function' && typeof def.update !== 'function') {
    throw new TypeError('motionScript: add `update({ transform, props, time }) { … }` and/or `start({ transform, tween }) { … }`.');
  }
  const defaults = propDefaults(def.props);
  class DefinedMotionScript extends MotionScript {
    static props = def.props || {};

    onStart(args) {
      if (def.start) def.start.call(this, { ...args, props: withDefaults(defaults, args && args.props) });
    }

    onUpdate(args) {
      if (def.update) def.update.call(this, { ...args, props: withDefaults(defaults, args && args.props) });
    }
  }
  return DefinedMotionScript;
}

// ─── Easing & Interpolation helpers ──────────────────────────────────────────

export const Easing = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => --t * t * t + 1,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  inBack: (t, s = 1.70158) => t * t * ((s + 1) * t - s),
  outBack: (t, s = 1.70158) => --t * t * ((s + 1) * t + s) + 1,
  inOutBack: (t, s = 1.70158 * 1.525) => {
    return (t *= 2) < 1
      ? 0.5 * (t * t * ((s + 1) * t - s))
      : 0.5 * ((t -= 2) * t * ((s + 1) * t + s) + 2);
  },
  inBounce: (t) => 1 - Easing.outBounce(1 - t),
  outBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75;
    } else if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375;
    } else {
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  },
  inOutBounce: (t) =>
    t < 0.5 ? (1 - Easing.outBounce(1 - 2 * t)) / 2 : (1 + Easing.outBounce(2 * t - 1)) / 2,
  inElastic: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return -Math.pow(2, 10 * (t - 1)) * Math.sin(((t - 1.1) * 5 * Math.PI) / 0.4);
  },
  outElastic: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin(((t - 0.1) * 5 * Math.PI) / 0.4) + 1;
  },
  inOutElastic: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    t *= 2;
    if (t < 1) {
      return -0.5 * Math.pow(2, 10 * (t - 1)) * Math.sin(((t - 1.1) * 5 * Math.PI) / 0.4);
    }
    return 0.5 * Math.pow(2, -10 * (t - 1)) * Math.sin(((t - 1.1) * 5 * Math.PI) / 0.4) + 1;
  }
};

export const Ease = {};
Object.entries(Easing).forEach(([key, fn]) => {
  const capitalized = key.charAt(0).toUpperCase() + key.slice(1);
  Ease[capitalized] = fn;
  Ease[key] = fn;
});

export const LoopType = {
  restart: 'restart',
  yoyo: 'yoyo',
  incremental: 'incremental',
  Restart: 'restart',
  Yoyo: 'yoyo',
};

// ─── Math & Vector Helpers ───────────────────────────────────────────────────

export const MathUtils = {
  lerp: (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t)),
  clamp: (val, min, max) => Math.max(min, Math.min(max, val)),
  clamp01: (val) => Math.max(0, Math.min(1, val)),
  remap: (val, inMin, inMax, outMin, outMax) => {
    const t = (val - inMin) / (inMax - inMin || 1);
    return outMin + (outMax - outMin) * t;
  },
  degToRad: (deg) => (deg * Math.PI) / 180,
  radToDeg: (rad) => (rad * 180) / Math.PI,
  vec2: (x, y) => ({ x, y }),
  vec3: (x, y, z = 0) => ({ x, y, z }),
  createRandom: (seed = 1) => {
    let s = 0;
    if (typeof seed === 'string') {
      for (let i = 0; i < seed.length; i++) {
        s = (Math.imul(31, s) + seed.charCodeAt(i)) >>> 0;
      }
    } else {
      s = (Number(seed) || 1) >>> 0;
    }
    if (s === 0) s = 1;

    return function next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  random: (seed = 0) => {
    return MathUtils.createRandom(seed)();
  },
  randomRange: (min, max, seed = 0) => {
    return min + (max - min) * MathUtils.random(seed);
  },
  noise1D: (x, seed = 0) => {
    const s = typeof seed === 'number' ? seed : 0;
    const x0 = Math.floor(x);
    const x1 = x0 + 1;
    const f = x - x0;
    const u = f * f * (3 - 2 * f);
    const v0 = MathUtils.createRandom(x0 * 374761393 + s * 668265263)() * 2 - 1;
    const v1 = MathUtils.createRandom(x1 * 374761393 + s * 668265263)() * 2 - 1;
    return v0 + (v1 - v0) * u;
  },
  noise2D: (x, y, seed = 0) => {
    const s = typeof seed === 'number' ? seed : 0;
    const x0 = Math.floor(x);
    const x1 = x0 + 1;
    const y0 = Math.floor(y);
    const y1 = y0 + 1;
    const fx = x - x0;
    const fy = y - y0;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const hash = (ix, iy) => (ix * 374761393 + iy * 668265263 + s * 1274126177) >>> 0;
    const v00 = MathUtils.createRandom(hash(x0, y0))() * 2 - 1;
    const v10 = MathUtils.createRandom(hash(x1, y0))() * 2 - 1;
    const v01 = MathUtils.createRandom(hash(x0, y1))() * 2 - 1;
    const v11 = MathUtils.createRandom(hash(x1, y1))() * 2 - 1;
    const top = v00 + (v10 - v00) * ux;
    const btm = v01 + (v11 - v01) * ux;
    return top + (btm - top) * uy;
  },
  /**
   * Point on a cubic Bézier at `t` (0..1), given four control points `{x,y}`.
   * Pure math — unlike SVG's `getPointAtLength()`, this never forces a reflow,
   * so it is safe to call every frame while drawing a curve on a timeline.
   */
  bezierPointAt(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return {
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    };
  },
  /**
   * Tangent (velocity direction) of the same cubic Bézier at `t`.
   * Normalise it for a unit direction, or scale by `1 / |derivative|` for
   * constant-speed sampling.
   */
  bezierTangentAt(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const a = 3 * u * u;
    const b = 6 * u * t;
    const c = 3 * t * t;
    return {
      x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
      y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y),
    };
  },
};

// Stateless timeline helpers. These intentionally never retain state or mutate
// a target, so Canvas/React/Motion scripts remain seek- and export-safe.
function resolveEase(ease) {
  if (typeof ease === 'function') return ease;
  return Easing[ease] || Ease[ease] || Easing.linear;
}

export const Tween = Object.freeze({
  clamp: MathUtils.clamp,
  clamp01: MathUtils.clamp01,
  lerp: MathUtils.lerp,
  remap: MathUtils.remap,
  ease(t, ease = 'linear') {
    return resolveEase(ease)(MathUtils.clamp01(t));
  },
  progress(time, { at = 0, duration = 1, ease = 'linear' } = {}) {
    const normalized = duration <= 0 ? (time >= at ? 1 : 0) : (time - at) / duration;
    return resolveEase(ease)(MathUtils.clamp01(normalized));
  },
  between(from, to, time, options = {}) {
    return MathUtils.lerp(from, to, Tween.progress(time, options));
  },
  loop(time, duration = 1, mode = 'restart') {
    if (duration <= 0) return 0;
    const cycles = Math.floor(time / duration);
    const value = ((time % duration) + duration) % duration / duration;
    return (mode === 'yoyo' || mode === 'pingpong') && Math.abs(cycles) % 2 === 1 ? 1 - value : value;
  },
  pingPong(time, duration = 1) {
    return Tween.loop(time, duration, 'pingpong');
  },
  /**
   * Two forms:
   *   `stagger(index, each)`               - delay in seconds for one item.
   *   `stagger(items, factory, options)`   - a `chain()` of per-item nodes, each
   *                                          delayed by `i * each` (the
   *                                          multi-target form; identical to
   *                                          the top-level `stagger`).
   */
  stagger(indexOrItems, eachOrFactory = 0.1, options) {
    if (Array.isArray(indexOrItems)) {
      return stagger(indexOrItems, eachOrFactory, options);
    }
    const each = typeof eachOrFactory === 'number' ? eachOrFactory : 0.1;
    return Math.max(0, indexOrItems) * each;
  },
  wiggle(time, freq = 2, amp = 20, octaves = 1, seed = 0) {
    if (amp === 0 || freq === 0) return 0;
    let sum = 0;
    let max = 0;
    let currentFreq = freq;
    let currentAmp = amp;
    const s = typeof seed === 'number' ? seed : 0;
    for (let i = 0; i < octaves; i++) {
      sum += MathUtils.noise1D(time * currentFreq, s + i * 31) * currentAmp;
      max += currentAmp;
      currentFreq *= 2;
      currentAmp *= 0.5;
    }
    return max > 0 ? (sum / max) * amp : 0;
  },
  wiggle2D(time, freq = 2, amp = 20, octaves = 1, seed = 0) {
    const s = typeof seed === 'number' ? seed : 0;
    return {
      x: Tween.wiggle(time, freq, amp, octaves, s),
      y: Tween.wiggle(time, freq, amp, octaves, s + 1000),
    };
  },
});

export const wiggle = Tween.wiggle;
export const wiggle2D = Tween.wiggle2D;

// ─── interpolate & spring ────────────────────────────────────────────────────

export function interpolate(value, inputRange, outputRange, options = {}) {
  const {
    extrapolateLeft = 'extend',
    extrapolateRight = 'extend',
    easing = Easing.linear,
  } = options;

  if (inputRange.length < 2 || outputRange.length < 2 || inputRange.length !== outputRange.length) {
    return outputRange[0] ?? 0;
  }

  if (value < inputRange[0]) {
    if (extrapolateLeft === 'clamp') return outputRange[0];
    if (extrapolateLeft === 'identity') return value;
  }

  const lastIdx = inputRange.length - 1;
  if (value > inputRange[lastIdx]) {
    if (extrapolateRight === 'clamp') return outputRange[lastIdx];
    if (extrapolateRight === 'identity') return value;
  }

  let i = 0;
  while (i < lastIdx && value >= inputRange[i + 1]) {
    i++;
  }

  const inMin = inputRange[i];
  const inMax = inputRange[i + 1];
  const outMin = outputRange[i];
  const outMax = outputRange[i + 1];

  const t = Math.max(0, Math.min(1, (value - inMin) / (inMax - inMin || 1)));
  const easedT = typeof easing === 'function' ? easing(t) : (Easing[easing] ? Easing[easing](t) : t);

  return outMin + (outMax - outMin) * easedT;
}

export function spring({ frame = 0, fps = 30, config = {} }) {
  const {
    damping = 10,
    mass = 1,
    stiffness = 100,
    initialVelocity = 0,
  } = config;

  const t = frame / (fps || 30);
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const a = 1;
    const b = (zeta * w0 - initialVelocity) / wd;
    const envelope = Math.exp(-zeta * w0 * t);
    return 1 - envelope * (a * Math.cos(wd * t) + b * Math.sin(wd * t));
  } else {
    const envelope = Math.exp(-w0 * t);
    return 1 - envelope * (1 + (w0 - initialVelocity) * t);
  }
}

// ─── Seekable sequence API ───────────────────────────────────────────────────
//
// A small, PURE animation-composition layer. Every node is a plain object with
// a `duration` and `valueAt(localTime)` that returns the value at that moment,
// so a sequence can be evaluated at ANY time as often as you like (scrub,
// seek, export) without retaining state — the same guarantee the rest of the
// SDK makes:
//
//   const shot = chain(
//     tween({ from: 0, to: 120, duration: 0.6, ease: 'outCubic' }),
//     wait(0.2),
//     tween({ from: 0, to: 1, duration: 0.4 }),
//   );
//   shot.valueAt(time);                  // [x, undefined, opacity] at `time`
//   shot.applyAt(time, (v) => { ... });  // same, plus your apply callback
//
// `stagger(items, factory, { each })` builds a chain of per-item nodes, so a
// factory never has to compute `i * each` itself.

/** Wrap a sampler as a sequence node. Methods are bound for ergonomic use. */
function makeNode(duration, sample) {
  const total = Math.max(0, Number.isFinite(duration) ? duration : 0);
  const node = {
    duration: total,
    /** Value at `time`, clamped to [0, duration]. */
    valueAt(time) {
      return sample(Math.max(0, Math.min(total, Number.isFinite(time) ? time : 0)));
    },
    /** Alias for `valueAt`. */
    at(time) {
      return node.valueAt(time);
    },
    /** Evaluate at `time` and hand the value to `apply(value, time)`. */
    applyAt(time, apply) {
      const value = node.valueAt(time);
      if (typeof apply === 'function') apply(value, time);
      return value;
    },
  };
  return node;
}

/** Interpolate numbers, arrays and plain objects of numbers. */
function interpolateValue(from, to, t) {
  if (typeof from === 'number' && typeof to === 'number') return from + (to - from) * t;
  if (Array.isArray(from) && Array.isArray(to)) return to.map((v, i) => interpolateValue(from[i], v, t));
  if (from && to && typeof from === 'object' && typeof to === 'object') {
    const out = {};
    for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) {
      out[k] = interpolateValue(from[k], to[k], t);
    }
    return out;
  }
  return t >= 1 ? to : from;
}

/**
 * A single value tween as a sequence node.
 *
 * @param {object} spec
 * @param {number|Array|object} [spec.from=0]
 * @param {number|Array|object} [spec.to=1]
 * @param {number} [spec.duration=1] seconds
 * @param {number} [spec.delay=0]
 * @param {string|function} [spec.ease='linear']
 * @param {number} [spec.loop=1] finite number of passes
 * @param {boolean} [spec.yoyo=false] alternate direction on each pass
 * @param {(time:number)=>any} [spec.sample] override the eased interpolation
 */
export function tween(spec = {}) {
  const {
    from = 0,
    to = 1,
    duration = 1,
    delay = 0,
    ease = 'linear',
    loop = 1,
    yoyo = false,
    sample,
  } = spec;

  const easeFn = resolveEase(ease);
  const d = Math.max(0, duration);
  const loops = Number.isFinite(loop) && loop > 1 ? Math.floor(loop) : 1;
  const total = Math.max(0, delay) + d * loops;

  return makeNode(total, (time) => {
    const local = time - delay;
    if (typeof sample === 'function') return sample(Math.max(0, local));
    if (local <= 0) return from;
    if (d <= 0) return to;
    let p;
    if (loops > 1) {
      const i = Math.floor(local / d);
      if (i >= loops) {
        p = yoyo && loops % 2 === 0 ? 0 : 1;
      } else {
        p = (local % d) / d;
        if (yoyo && i % 2 === 1) p = 1 - p;
      }
    } else {
      p = local / d;
    }
    return interpolateValue(from, to, easeFn(Math.max(0, Math.min(1, p))));
  });
}

/** A node that holds for `duration` seconds (value `undefined`). */
export function wait(duration = 0) {
  return makeNode(duration, () => undefined);
}

/** A node that returns `value` for `duration` seconds. */
export function hold(value, duration = 0) {
  return makeNode(duration, () => value);
}

/** Shift a node later by `delay` seconds. */
export function offset(delay, child) {
  const d = Math.max(0, delay);
  return makeNode(d + (child?.duration || 0), (time) => child?.valueAt(time - d));
}

/** Run nodes one after another; `valueAt` returns each child's value as an array. */
export function chain(...nodes) {
  const children = nodes.flat().filter(Boolean);
  const duration = children.reduce((sum, n) => sum + n.duration, 0);
  return makeNode(duration, (time) => {
    let acc = 0;
    return children.map((n) => {
      const local = time - acc;
      acc += n.duration;
      return n.valueAt(local);
    });
  });
}

/** Run nodes in parallel; duration is the longest child, `valueAt` returns an array. */
export function all(...nodes) {
  const children = nodes.flat().filter(Boolean);
  const duration = children.reduce((max, n) => Math.max(max, n.duration), 0);
  return makeNode(duration, (time) => children.map((n) => n.valueAt(time)));
}

/**
 * Build a chain where each item's node starts `i * each` seconds after the
 * previous one. The factory receives `(item, index, delaySeconds)` and returns
 * a sequence node (a number is accepted too, and is held as a value).
 */
export function stagger(items, factory, { each = 0.1, start = 0 } = {}) {
  const list = Array.isArray(items) ? items : [];
  const children = list.map((item, i) => {
    const at = Math.max(0, start) + i * each;
    const child = typeof factory === 'function' ? factory(item, i, at) : item;
    if (child && typeof child.valueAt === 'function') return offset(at, child);
    if (typeof child === 'number') return offset(at, hold(child, 0));
    return offset(at, wait(0));
  });
  // Parallel, like a staggered row of objects: `valueAt(t)` returns an array
  // of each item's value at `t`, and the total duration is the last item's end.
  return all(children);
}

/** Evaluate a node at `time` and hand the value to `apply(value, time)`. */
export function applyAt(node, time, apply) {
  return node?.applyAt ? node.applyAt(time, apply) : undefined;
}

/**
 * Memoise a function by a chosen set of props. The classic use is a canvas
 * script that rebuilds an expensive parse/layout only when the STRUCTURAL
 * props change, while tween evaluation runs every frame:
 *
 *   const layout = memoizeByProps((props) => buildGraph(props.nodes), ['nodes', 'edges']);
 *   onUpdate({ props, time }) {
 *     const graph = layout(props);        // rebuilt only when nodes/edges change
 *     draw(graph, time);
 *   }
 *
 * @param {(props: object) => any} fn
 * @param {string[]} [keys] props to compare; defaults to every own key of `props`
 */
export function memoizeByProps(fn, keys) {
  let lastDeps = null;
  let lastValue;
  let hasValue = false;
  const memoized = (props) => {
    const source = props || {};
    const deps = (Array.isArray(keys) ? keys : Object.keys(source)).map((k) => source[k]);
    if (hasValue && lastDeps && deps.length === lastDeps.length && deps.every((v, i) => Object.is(v, lastDeps[i]))) {
      return lastValue;
    }
    lastDeps = deps;
    lastValue = fn(source);
    hasValue = true;
    return lastValue;
  };
  /** Drop the cached value so the next call rebuilds. */
  memoized.invalidate = () => {
    hasValue = false;
    lastDeps = null;
    lastValue = undefined;
  };
  return memoized;
}

// ─── Shape helpers ───────────────────────────────────────────────────────────

/** Build the SVG path `d` string for a rounded rectangle. */
function roundedRectPath(x, y, w, h, r = 0) {
  const radius = Math.max(0, Math.min(r, Math.min(Math.abs(w), Math.abs(h)) / 2));
  if (radius <= 0) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  return [
    `M ${x + radius} ${y}`,
    `H ${x + w - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + w} ${y + radius}`,
    `V ${y + h - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + w - radius} ${y + h}`,
    `H ${x + radius}`,
    `A ${radius} ${radius} 0 0 1 ${x} ${y + h - radius}`,
    `V ${y + radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
    'Z',
  ].join(' ');
}

/**
 * Pure shape geometry: SVG path-string builders plus Canvas2D draw functions.
 * Stateless, so both halves are usable from canvas and DOM/SVG scripts alike.
 */
export const shapes = Object.freeze({
  /** SVG path for a rounded rectangle. */
  roundedRect(x, y, w, h, r = 0) {
    return roundedRectPath(x, y, w, h, r);
  },
  /** SVG path for a fully rounded (pill) rectangle. */
  pill(x, y, w, h) {
    return roundedRectPath(x, y, w, h, Math.min(Math.abs(w), Math.abs(h)) / 2);
  },
  /** SVG path for a diamond centred on (cx, cy). */
  diamond(cx, cy, w, h) {
    const hw = Math.abs(w) / 2;
    const hh = Math.abs(h) / 2;
    return `M ${cx} ${cy - hh} L ${cx + hw} ${cy} L ${cx} ${cy + hh} L ${cx - hw} ${cy} Z`;
  },
  /** SVG path for an arrow from `from` to `to` ({x,y}), optionally curved. */
  arrowPath(from, to, { curved = false, curvature = 0.25, arrowSize = 10 } = {}) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // Shorten the shaft so the head never overlaps the tip.
    const shaftX = to.x - ux * arrowSize;
    const shaftY = to.y - uy * arrowSize;
    const nx = -uy;
    const ny = ux;
    const bow = curved ? curvature * len : 0;
    const midX = (from.x + shaftX) / 2 + nx * bow;
    const midY = (from.y + shaftY) / 2 + ny * bow;
    const headBack1 = `${shaftX + nx * arrowSize * 0.5} ${shaftY + ny * arrowSize * 0.5}`;
    const headBack2 = `${shaftX - nx * arrowSize * 0.5} ${shaftY - ny * arrowSize * 0.5}`;
    const shaft = curved
      ? `M ${from.x} ${from.y} Q ${midX} ${midY} ${shaftX} ${shaftY}`
      : `M ${from.x} ${from.y} L ${shaftX} ${shaftY}`;
    return `${shaft} M ${headBack1} L ${to.x} ${to.y} L ${headBack2}`;
  },
  /** Canvas2D: fill a rounded rectangle using the current ctx styles. */
  drawRoundedRect(ctx, x, y, w, h, r = 0) {
    if (!ctx) return;
    const radius = Math.max(0, Math.min(r, Math.min(Math.abs(w), Math.abs(h)) / 2));
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, radius);
    } else {
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    }
    ctx.fill();
  },
  /** Canvas2D: draw a straight arrow with a triangular head. */
  drawArrow(ctx, from, to, { arrowSize = 10 } = {}) {
    if (!ctx) return;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const shaftX = to.x - Math.cos(angle) * arrowSize;
    const shaftY = to.y - Math.sin(angle) * arrowSize;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(shaftX, shaftY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - Math.cos(angle - Math.PI / 6) * arrowSize * 0.6, to.y - Math.sin(angle - Math.PI / 6) * arrowSize * 0.6);
    ctx.lineTo(to.x - Math.cos(angle + Math.PI / 6) * arrowSize * 0.6, to.y - Math.sin(angle + Math.PI / 6) * arrowSize * 0.6);
    ctx.closePath();
    ctx.fill();
  },
});

/**
 * d3-style enter / update / exit for a list of elements inside `layer`, so a
 * script drawing N shapes from an array does not hand-roll the bookkeeping.
 *
 * @param {Element} layer            parent to append into
 * @param {Array} data
 * @param {(datum:any, index:number)=>string|number} keyFn  stable identity
 * @param {object} [handlers]
 * @param {string} [handlers.tag='g'] SVG tag used when creating an element
 * @param {(node:Element, datum:any, index:number)=>void} [handlers.enter]
 * @param {(node:Element, datum:any, index:number)=>void} [handlers.update]
 * @param {(node:Element)=>void} [handlers.exit]
 * @returns {Element[]} the nodes, in `data` order
 */
export function svgList(layer, data, keyFn, handlers = {}) {
  if (!layer) return [];
  const { tag = 'g', enter, update, exit } = handlers;
  const prev = layer.__blahblahList instanceof Map ? layer.__blahblahList : new Map();
  const next = new Map();
  const list = Array.isArray(data) ? data : [];
  const nodes = list.map((datum, i) => {
    const key = String(keyFn ? keyFn(datum, i) : i);
    let node = prev.get(key);
    if (node) {
      prev.delete(key);
      if (update) update(node, datum, i);
    } else {
      node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      if (enter) enter(node, datum, i);
      layer.appendChild(node);
    }
    next.set(key, node);
    return node;
  });
  for (const node of prev.values()) {
    if (exit) exit(node);
    node.remove?.();
  }
  layer.__blahblahList = next;
  return nodes;
}

/**
 * Merge human-edited entries onto an auto-generated list, keyed by `key`.
 *
 *   const merged = mergeManualOverrides(autoNodes, props.nodeOverrides, 'id', ['label', 'x', 'y']);
 *
 * Auto entries win on structure; the listed `fields` are taken from the manual
 * entry when present. Manual entries with no auto counterpart are appended, and
 * when `fields` is omitted every manual key is copied.
 */
export function mergeManualOverrides(autoList = [], manualList = [], key = 'id', fields) {
  const manual = new Map();
  for (const entry of Array.isArray(manualList) ? manualList : []) {
    const k = entry && entry[key];
    if (k != null) manual.set(String(k), entry);
  }
  const keys = Array.isArray(fields) && fields.length > 0 ? fields : null;
  const seen = new Set();
  const result = [];
  for (const auto of Array.isArray(autoList) ? autoList : []) {
    const k = auto && auto[key];
    const override = k != null ? manual.get(String(k)) : undefined;
    if (override) {
      seen.add(String(k));
      const merged = { ...auto };
      if (keys) {
        for (const f of keys) if (override[f] !== undefined) merged[f] = override[f];
      } else {
        for (const [f, v] of Object.entries(override)) if (f !== key) merged[f] = v;
      }
      result.push(merged);
    } else {
      result.push({ ...auto });
    }
  }
  for (const [k, entry] of manual) {
    if (!seen.has(k)) result.push({ ...entry });
  }
  return result;
}

// ─── MotionTweenContext ──────────────────────────────────────────────────────

class PropertyTweenTrack {
  constructor(path, targetVal, options = {}) {
    this.path = path;
    this.targetVal = targetVal;
    this.startVal = options.from !== undefined ? options.from : null;
    this.duration = Math.max(0.001, options.duration || 1.0);
    this.delay = Math.max(0, options.delay || 0);
    this.easeFn = typeof options.ease === 'function'
      ? options.ease
      : (Easing[options.ease] || Ease[options.ease] || Easing.outQuad);
    this.loops = options.loop === 'yoyo' || options.yoyo ? -1 : (options.loops || 1);
    this.loopType = options.loop === 'yoyo' || options.yoyo ? LoopType.yoyo : (options.loopType || LoopType.restart);
    this.isRelative = options.relative || false;
  }

  evaluate(localTime, initialVal) {
    const baseVal = this.startVal !== null ? this.startVal : initialVal;
    const target = this.isRelative ? baseVal + this.targetVal : this.targetVal;
    const effectiveTime = localTime - this.delay;

    if (effectiveTime <= 0) return baseVal;

    let progress = 0;
    const singleDur = this.duration;

    if (this.loops === -1 || this.loops > 1) {
      const currentLoopIndex = Math.floor(effectiveTime / singleDur);
      if (this.loops !== -1 && currentLoopIndex >= this.loops) {
        progress = (this.loopType === LoopType.yoyo && this.loops % 2 === 0) ? 0 : 1;
      } else {
        const loopLocalTime = effectiveTime % singleDur;
        progress = loopLocalTime / singleDur;
        if (this.loopType === LoopType.yoyo && currentLoopIndex % 2 === 1) {
          progress = 1 - progress;
        }
      }
    } else {
      progress = Math.min(1, effectiveTime / singleDur);
    }

    const eased = this.easeFn(progress);
    if (typeof baseVal === 'number' && typeof target === 'number') {
      return baseVal + (target - baseVal) * eased;
    }
    return target;
  }
}

export class MotionTweenContext {
  constructor(baseTransform = {}) {
    this.baseTransform = { ...baseTransform };
    this.tracks = [];
    this.sineTracks = [];
    this.shakeTracks = [];
    this.punchTracks = [];
  }

  to(targetObj, props, options = {}) {
    this._addTracks(targetObj, props, options, false);
    return this;
  }

  from(targetObj, props, options = {}) {
    this._addTracks(targetObj, props, options, true);
    return this;
  }

  spring(targetObj, props, config = {}) {
    const dur = config.duration || 1.2;
    Object.entries(props).forEach(([key, targetVal]) => {
      const path = this._resolvePath(targetObj, key);
      const startVal = config.from !== undefined ? config.from : null;
      const track = new PropertyTweenTrack(path, targetVal, {
        duration: dur,
        delay: config.delay || 0,
        from: startVal,
        ease: (t) => spring({ frame: t * dur * 30, fps: 30, config }),
      });
      this.tracks.push(track);
    });
    return this;
  }

  punch(targetObj, props, options = {}) {
    const dur = options.duration || 0.6;
    const vibrato = options.vibrato || 8;
    Object.entries(props).forEach(([key, punchAmount]) => {
      const path = this._resolvePath(targetObj, key);
      this.punchTracks.push({
        path,
        amount: punchAmount,
        duration: dur,
        delay: options.delay || 0,
        vibrato,
      });
    });
    return this;
  }

  shake(targetObj, options = {}) {
    const intensity = options.intensity || 15;
    const dur = options.duration || 0.6;
    this.shakeTracks.push({
      duration: dur,
      delay: options.delay || 0,
      intensity,
    });
    return this;
  }

  sine(targetObj, props, options = {}) {
    const frequency = options.frequency || 2.0;
    const phase = options.phase || 0;
    Object.entries(props).forEach(([key, amplitude]) => {
      const path = this._resolvePath(targetObj, key);
      this.sineTracks.push({
        path,
        amplitude,
        frequency,
        phase,
      });
    });
    return this;
  }

  _resolvePath(targetObj, key) {
    if (targetObj && targetObj._isPosition) return key === 'y' ? 'y' : 'x';
    if (targetObj && targetObj._isScale) return key === 'y' ? 'scaleY' : 'scaleX';
    if (key === 'positionX' || key === 'posX') return 'x';
    if (key === 'positionY' || key === 'posY') return 'y';
    if (key === 'scale') return 'scale';
    return key;
  }

  _addTracks(targetObj, props, options, isFrom = false) {
    Object.entries(props).forEach(([key, val]) => {
      const path = this._resolvePath(targetObj, key);
      if (path === 'scale') {
        const sxOpts = isFrom ? { ...options, from: val } : options;
        const syOpts = isFrom ? { ...options, from: val } : options;
        this.tracks.push(new PropertyTweenTrack('scaleX', isFrom ? (this.baseTransform.scaleX ?? 1) : val, sxOpts));
        this.tracks.push(new PropertyTweenTrack('scaleY', isFrom ? (this.baseTransform.scaleY ?? 1) : val, syOpts));
      } else {
        const trackOpts = isFrom ? { ...options, from: val } : options;
        const targetVal = isFrom
          ? (path === 'x' ? this.baseTransform.x : path === 'y' ? this.baseTransform.y : path === 'rotation' ? (this.baseTransform.rotation || 0) : path === 'opacity' ? (this.baseTransform.opacity ?? 1) : (this.baseTransform[path] ?? 0))
          : val;
        this.tracks.push(new PropertyTweenTrack(path, targetVal, trackOpts));
      }
    });
  }

  evaluate(localTime, baseTransform) {
    const result = {
      x: baseTransform.x ?? 0,
      y: baseTransform.y ?? 0,
      rotation: baseTransform.rotation ?? 0,
      scaleX: baseTransform.scaleX ?? 1,
      scaleY: baseTransform.scaleY ?? 1,
      opacity: baseTransform.opacity ?? 1,
    };

    for (const track of this.tracks) {
      if (track.path === 'x') result.x = track.evaluate(localTime, baseTransform.x ?? 0);
      else if (track.path === 'y') result.y = track.evaluate(localTime, baseTransform.y ?? 0);
      else if (track.path === 'rotation') result.rotation = track.evaluate(localTime, baseTransform.rotation ?? 0);
      else if (track.path === 'scaleX') result.scaleX = track.evaluate(localTime, baseTransform.scaleX ?? 1);
      else if (track.path === 'scaleY') result.scaleY = track.evaluate(localTime, baseTransform.scaleY ?? 1);
      else if (track.path === 'opacity') result.opacity = track.evaluate(localTime, baseTransform.opacity ?? 1);
    }

    for (const s of this.sineTracks) {
      const val = Math.sin(localTime * s.frequency * Math.PI * 2 + s.phase) * s.amplitude;
      if (s.path === 'x') result.x += val;
      else if (s.path === 'y') result.y += val;
      else if (s.path === 'rotation') result.rotation += val;
      else if (s.path === 'scaleX') result.scaleX += val;
      else if (s.path === 'scaleY') result.scaleY += val;
      else if (s.path === 'opacity') result.opacity = Math.max(0, Math.min(1, result.opacity + val));
    }

    for (const p of this.punchTracks) {
      const effectiveTime = localTime - p.delay;
      if (effectiveTime > 0 && effectiveTime < p.duration) {
        const progress = effectiveTime / p.duration;
        const decay = Math.exp(-progress * 4);
        const osc = Math.sin(progress * Math.PI * p.vibrato);
        const offset = p.amount * decay * osc;
        if (p.path === 'x') result.x += offset;
        else if (p.path === 'y') result.y += offset;
        else if (p.path === 'rotation') result.rotation += offset;
      }
    }

    for (const s of this.shakeTracks) {
      const effectiveTime = localTime - s.delay;
      if (effectiveTime > 0 && effectiveTime < s.duration) {
        const progress = effectiveTime / s.duration;
        const decay = 1 - progress;
        const seedX = Math.sin(Math.floor(effectiveTime * 40) * 127.1);
        const seedY = Math.cos(Math.floor(effectiveTime * 40) * 311.7);
        result.x += seedX * s.intensity * decay;
        result.y += seedY * s.intensity * decay;
      }
    }

    return result;
  }
}

// ─── Reference Types ─────────────────────────────────────────────────────────

export class EntityRef {
  id = null;
  name = null;
  startTime = 0;
  duration = 0;
  parentId = null;
  exists() { return false; }
  getTransform() { return null; }
  getComponent(type) { return null; }
}

export class AssetRef {
  id = null;
  name = null;
  src = null;
  type = null;
  duration = null;
  exists() { return false; }
}

// ─── 3D Geometry & Procedural Mesh Helpers ────────────────────────────────────

const DEG2RAD = Math.PI / 180;

export function shadeColor(hex, factor) {
  let c = hex ? String(hex).replace('#', '') : 'ffffff';
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c, 16);
  if (Number.isNaN(num)) return hex;

  const r = Math.min(255, Math.max(0, Math.round(((num >> 16) & 255) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((num >> 8) & 255) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((num & 255) * factor)));

  return `rgb(${r}, ${g}, ${b})`;
}

export function rotateVertex([x, y, z], rxDeg = 0, ryDeg = 0, rzDeg = 0) {
  const rx = rxDeg * DEG2RAD;
  const ry = ryDeg * DEG2RAD;
  const rz = rzDeg * DEG2RAD;

  let y1 = y * Math.cos(rx) - z * Math.sin(rx);
  let z1 = y * Math.sin(rx) + z * Math.cos(rx);
  let x1 = x;

  let x2 = x1 * Math.cos(ry) + z1 * Math.sin(ry);
  let z2 = -x1 * Math.sin(ry) + z1 * Math.cos(ry);
  let y2 = y1;

  let x3 = x2 * Math.cos(rz) - y2 * Math.sin(rz);
  let y3 = x2 * Math.sin(rz) + y2 * Math.cos(rz);
  let z3 = z2;

  return [x3, y3, z3];
}

export function calculateNormal(v0, v1, v2) {
  const ax = v1[0] - v0[0];
  const ay = v1[1] - v0[1];
  const az = v1[2] - v0[2];

  const bx = v2[0] - v0[0];
  const by = v2[1] - v0[1];
  const bz = v2[2] - v0[2];

  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;

  const len = Math.hypot(nx, ny, nz) || 1e-6;
  return [nx / len, ny / len, nz / len];
}

export function createCubeMesh(w = 140, h = 140, d = 140) {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;

  const vertices = [
    [-hw, -hh, -hd],
    [hw, -hh, -hd],
    [hw, hh, -hd],
    [-hw, hh, -hd],
    [-hw, -hh, hd],
    [hw, -hh, hd],
    [hw, hh, hd],
    [-hw, hh, hd],
  ];

  const faces = [
    [0, 1, 2, 3],
    [5, 4, 7, 6],
    [4, 5, 1, 0],
    [3, 2, 6, 7],
    [4, 0, 3, 7],
    [1, 5, 6, 2],
  ];

  return { vertices, faces };
}

export function createPyramidMesh(w = 140, h = 140, d = 140) {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;

  const vertices = [
    [0, -hh, 0],
    [-hw, hh, -hd],
    [hw, hh, -hd],
    [hw, hh, hd],
    [-hw, hh, hd],
  ];

  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [0, 4, 3],
    [0, 1, 4],
    [1, 2, 3, 4],
  ];

  return { vertices, faces };
}

export function createCylinderMesh(radius = 70, height = 140, segments = 16) {
  const vertices = [];
  const hh = height / 2;
  const step = (Math.PI * 2) / segments;

  for (let i = 0; i < segments; i++) {
    const angle = i * step;
    vertices.push([Math.cos(angle) * radius, -hh, Math.sin(angle) * radius]);
  }

  for (let i = 0; i < segments; i++) {
    const angle = i * step;
    vertices.push([Math.cos(angle) * radius, hh, Math.sin(angle) * radius]);
  }

  const faces = [];

  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    faces.push([i, next, next + segments, i + segments]);
  }

  const topCap = [];
  for (let i = segments - 1; i >= 0; i--) topCap.push(i);
  faces.push(topCap);

  const bottomCap = [];
  for (let i = 0; i < segments; i++) bottomCap.push(i + segments);
  faces.push(bottomCap);

  return { vertices, faces };
}

export function createSphereMesh(radius = 70, rings = 10, segments = 14) {
  const vertices = [];
  const faces = [];

  for (let r = 0; r <= rings; r++) {
    const theta = (r * Math.PI) / rings;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let s = 0; s <= segments; s++) {
      const phi = (s * 2 * Math.PI) / segments;
      const x = Math.cos(phi) * sinTheta * radius;
      const y = -cosTheta * radius;
      const z = Math.sin(phi) * sinTheta * radius;
      vertices.push([x, y, z]);
    }
  }

  const stride = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const first = r * stride + s;
      const second = first + stride;

      if (r === 0) {
        faces.push([first, second, second + 1]);
      } else if (r === rings - 1) {
        faces.push([first, second, first + 1]);
      } else {
        faces.push([first, second, second + 1, first + 1]);
      }
    }
  }

  return { vertices, faces };
}

export function renderMesh3D(ctx, mesh, {
  x = 0,
  y = 0,
  rotationX = 0,
  rotationY = 0,
  rotationZ = 0,
  scaleX = 1,
  scaleY = 1,
  scaleZ = 1,
  color = '#38bdf8',
  strokeColor = '#0284c7',
  strokeWidth = 1,
  shading = 'lit',
  lightDir = [0.4, -0.6, -0.7],
  ambient = 0.35,
  diffuse = 0.65,
  focalLength = 1000,
} = {}) {
  if (!mesh || !mesh.vertices || !mesh.faces || !ctx) return;

  const lightLen = Math.hypot(...lightDir) || 1;
  const lx = lightDir[0] / lightLen;
  const ly = lightDir[1] / lightLen;
  const lz = lightDir[2] / lightLen;

  const transformed = mesh.vertices.map((v) => {
    const sx = v[0] * scaleX;
    const sy = v[1] * scaleY;
    const sz = v[2] * scaleZ;
    const [rx, ry, rz] = rotateVertex([sx, sy, sz], rotationX, rotationY, rotationZ);
    return [rx + x, ry + y, rz];
  });

  const projected = transformed.map(([vx, vy, vz]) => {
    const dist = focalLength + vz;
    const factor = dist > 1 ? focalLength / dist : 1;
    return [vx * factor, vy * factor, vz];
  });

  const sortedFaces = mesh.faces.map((indices) => {
    let avgZ = 0;
    for (const idx of indices) {
      avgZ += transformed[idx][2];
    }
    avgZ /= indices.length;

    const v0 = transformed[indices[0]];
    const v1 = transformed[indices[1]];
    const v2 = transformed[indices[2]];
    const normal = calculateNormal(v0, v1, v2);

    return { indices, avgZ, normal };
  });

  sortedFaces.sort((a, b) => b.avgZ - a.avgZ);

  ctx.save();

  for (const { indices, normal } of sortedFaces) {
    if (indices.length < 3) continue;

    const dot = Math.max(0, normal[0] * lx + normal[1] * ly + normal[2] * lz);
    const intensity = shading === 'lit' ? Math.min(1.0, ambient + diffuse * dot) : 1.0;
    const faceFill = shading === 'lit' ? shadeColor(color, intensity) : color;

    ctx.beginPath();
    const first = projected[indices[0]];
    ctx.moveTo(first[0], first[1]);

    for (let i = 1; i < indices.length; i++) {
      const pt = projected[indices[i]];
      ctx.lineTo(pt[0], pt[1]);
    }
    ctx.closePath();

    if (shading !== 'wireframe') {
      ctx.fillStyle = faceFill;
      ctx.fill();
    }

    if (strokeWidth > 0 || shading === 'wireframe') {
      ctx.strokeStyle = strokeColor || shadeColor(color, 0.7);
      ctx.lineWidth = strokeWidth || 1;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  ctx.restore();
}

export function drawCube3D(ctx, options = {}) {
  const { width = 140, height = 140, depth = 140 } = options;
  const mesh = createCubeMesh(width, height, depth);
  renderMesh3D(ctx, mesh, options);
}

export function drawPyramid3D(ctx, options = {}) {
  const { width = 140, height = 140, depth = 140 } = options;
  const mesh = createPyramidMesh(width, height, depth);
  renderMesh3D(ctx, mesh, options);
}

export function drawCylinder3D(ctx, options = {}) {
  const { width = 140, height = 140, segments = 16 } = options;
  const radius = width / 2;
  const mesh = createCylinderMesh(radius, height, segments);
  renderMesh3D(ctx, mesh, options);
}

export function drawSphere3D(ctx, options = {}) {
  const { width = 140, rings = 10, segments = 14 } = options;
  const radius = width / 2;
  const mesh = createSphereMesh(radius, rings, segments);
  renderMesh3D(ctx, mesh, options);
}

// ─── 3D Camera & Matrix Utilities ─────────────────────────────────────────────

export function createDefaultCamera(overrides = {}) {
  return {
    type: 'Camera',
    position: { x: 0, y: 0, z: -1000, ...(overrides.position || {}) },
    target: { x: 0, y: 0, z: 0, ...(overrides.target || {}) },
    roll: overrides.roll ?? 0,
    fov: overrides.fov ?? 50,
    zoom: overrides.zoom ?? 1.0,
    enabled: overrides.enabled !== false,
  };
}

export function getFocalLength(viewportHeight, fovDegrees = 50) {
  const fovRad = (Math.max(1, Math.min(170, fovDegrees)) * Math.PI) / 180;
  return (viewportHeight / 2) / Math.tan(fovRad / 2);
}

export function orbitCamera(target, distance, azimuthDeg, elevationDeg) {
  const azRad = (azimuthDeg * Math.PI) / 180;
  const elRad = (elevationDeg * Math.PI) / 180;
  return {
    x: target.x + distance * Math.cos(elRad) * Math.sin(azRad),
    y: target.y - distance * Math.sin(elRad),
    z: target.z - distance * Math.cos(elRad) * Math.cos(azRad),
  };
}

export function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function mat4Multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4 + 0], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

export function mat4LookAt(eye, target, rollRad = 0) {
  const ex = eye?.x ?? 0, ey = eye?.y ?? 0, ez = eye?.z ?? -1000;
  const tx = target?.x ?? 0, ty = target?.y ?? 0, tz = target?.z ?? 0;
  let fx = tx - ex, fy = ty - ey, fz = tz - ez;
  let len = Math.hypot(fx, fy, fz);
  if (len < 1e-6) { fx = 0; fy = 0; fz = 1; } else { fx /= len; fy /= len; fz /= len; }
  let refDx = 0, refDy = 1, refDz = 0;
  if (Math.abs(fy) > 0.9999) { refDx = 0; refDy = 0; refDz = fy > 0 ? -1 : 1; }
  let rx = refDy * fz - refDz * fy, ry = refDz * fx - refDx * fz, rz = refDx * fy - refDy * fx;
  let rlen = Math.hypot(rx, ry, rz);
  if (rlen < 1e-6) { rx = 1; ry = 0; rz = 0; } else { rx /= rlen; ry /= rlen; rz /= rlen; }
  let dx = fy * rz - fz * ry, dy = fz * rx - fx * rz, dz = fx * ry - fy * rx;
  if (rollRad !== 0) {
    const cosR = Math.cos(rollRad), sinR = Math.sin(rollRad);
    const nrx = rx * cosR + dx * sinR, nry = ry * cosR + dy * sinR, nrz = rz * cosR + dz * sinR;
    const ndx = -rx * sinR + dx * cosR, ndy = -ry * sinR + dy * cosR, ndz = -rz * sinR + dz * cosR;
    rx = nrx; ry = nry; rz = nrz; dx = ndx; dy = ndy; dz = ndz;
  }
  return [
    rx, dx, fx, 0,
    ry, dy, fy, 0,
    rz, dz, fz, 0,
    -(rx * ex + ry * ey + rz * ez),
    -(dx * ex + dy * ey + dz * ez),
    -(fx * ex + fy * ey + fz * ez),
    1,
  ];
}

export function mat4ToCSS(m) {
  const formatted = m.map((v) => (Math.abs(v) < 1e-7 ? 0 : Number(v.toFixed(6))));
  return `matrix3d(${formatted.join(',')})`;
}

export default {
  MotionScript,
  CanvasComponent,
  canvasScript,
  motionScript,
  Easing,
  Ease,
  LoopType,
  MathUtils,
  Tween,
  interpolate,
  spring,
  MotionTweenContext,
  EntityRef,
  AssetRef,
  // Seekable sequence API + composition helpers
  tween,
  wait,
  hold,
  offset,
  chain,
  all,
  stagger,
  applyAt,
  memoizeByProps,
  shapes,
  svgList,
  mergeManualOverrides,
  wiggle,
  wiggle2D,
  createCubeMesh,
  createPyramidMesh,
  createCylinderMesh,
  createSphereMesh,
  rotateVertex,
  shadeColor,
  renderMesh3D,
  drawCube3D,
  drawPyramid3D,
  drawCylinder3D,
  drawSphere3D,
  createDefaultCamera,
  getFocalLength,
  orbitCamera,
  mat4Identity,
  mat4Multiply,
  mat4LookAt,
  mat4ToCSS,
};

