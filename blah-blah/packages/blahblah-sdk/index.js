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
});

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

export default {
  MotionScript,
  CanvasComponent,
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
};

