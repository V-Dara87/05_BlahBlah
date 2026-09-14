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
  stagger(index, each = 0.1) {
    return Math.max(0, index) * each;
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
};

