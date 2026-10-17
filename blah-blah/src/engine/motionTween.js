/**
 * MotionTween Engine - A deterministic, timeline-compatible motion & tweening engine
 * inspired by Unity DOTween, Remotion, and Motion Canvas.
 * 
 * Supports pure time-based evaluations: (localTime) => transform.
 */

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

// Aliases for uppercase compatibility (Ease.OutBounce, Ease.InOutSine, etc.)
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

/**
 * Standard Math & Vector Helpers
 */
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
   * Creates a deterministic pseudorandom number generator (Mulberry32).
   * Given the same seed, returns the identical sequence of numbers in [0, 1).
   * @param {number|string} seed
   * @returns {() => number} Generator returning floats in [0, 1)
   */
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

  /**
   * Deterministic random float in [0, 1) for a specific seed or (time, index).
   * @param {number|string} seed
   * @returns {number} Float in [0, 1)
   */
  random: (seed = 0) => {
    return MathUtils.createRandom(seed)();
  },

  /**
   * Deterministic random float between min and max for a specific seed.
   * @param {number} min
   * @param {number} max
   * @param {number|string} seed
   * @returns {number}
   */
  randomRange: (min, max, seed = 0) => {
    return min + (max - min) * MathUtils.random(seed);
  },

  /**
   * Deterministic 1D Smooth Noise in [-1, 1].
   * @param {number} x
   * @param {number|string} seed
   * @returns {number}
   */
  noise1D: (x, seed = 0) => {
    const s = typeof seed === 'number' ? seed : 0;
    const x0 = Math.floor(x);
    const x1 = x0 + 1;
    const f = x - x0;
    // Smoothstep interpolation curve: 3f^2 - 2f^3
    const u = f * f * (3 - 2 * f);
    const v0 = MathUtils.createRandom(x0 * 374761393 + s * 668265263)() * 2 - 1;
    const v1 = MathUtils.createRandom(x1 * 374761393 + s * 668265263)() * 2 - 1;
    return v0 + (v1 - v0) * u;
  },

  /**
   * Deterministic 2D Smooth Noise in [-1, 1].
   * @param {number} x
   * @param {number} y
   * @param {number|string} seed
   * @returns {number}
   */
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
};

/**
 * Stateless timeline helpers for every script kind.
 *
 * Unlike MotionTweenContext (the legacy onStart() transform-track builder),
 * this object never retains state or writes to a target.  A Canvas, React, or
 * motion script can therefore derive a value from the current timeline time
 * and produce the exact same result after a seek or during export.
 */
function resolveEase(ease) {
  if (typeof ease === 'function') return ease;
  return Easing[ease] || Ease[ease] || Easing.linear;
}

export const Tween = Object.freeze({
  clamp: MathUtils.clamp,
  clamp01: MathUtils.clamp01,
  lerp: MathUtils.lerp,
  remap: MathUtils.remap,

  /** Apply a named (or custom) easing function to progress. */
  ease(t, ease = 'linear') {
    return resolveEase(ease)(MathUtils.clamp01(t));
  },

  /**
   * Normalized progress for a time window. `time` and `at` are seconds.
   * Values outside the window clamp to 0/1, which is the usual authoring
   * behaviour for enter/exit animations.
   */
  progress(time, { at = 0, duration = 1, ease = 'linear' } = {}) {
    const normalized = duration <= 0 ? (time >= at ? 1 : 0) : (time - at) / duration;
    return resolveEase(ease)(MathUtils.clamp01(normalized));
  },

  /** Return an eased value between two numbers at an absolute local time. */
  between(from, to, time, options = {}) {
    return MathUtils.lerp(from, to, Tween.progress(time, options));
  },

  /** Repeating 0..1 progress. `mode: 'yoyo'`/`'pingpong'` returns 1..0 every other loop. */
  loop(time, duration = 1, mode = 'restart') {
    if (duration <= 0) return 0;
    const cycles = Math.floor(time / duration);
    const value = ((time % duration) + duration) % duration / duration;
    return (mode === 'yoyo' || mode === 'pingpong') && Math.abs(cycles) % 2 === 1 ? 1 - value : value;
  },

  /** Convenience form of `loop(time, duration, 'pingpong')`. */
  pingPong(time, duration = 1) {
    return Tween.loop(time, duration, 'pingpong');
  },

  /** Offset in seconds for item `index` in a staggered sequence. */
  stagger(index, each = 0.1) {
    return Math.max(0, index) * each;
  },

  /**
   * After Effects-style organic jitter / wiggle function.
   * Deterministic, continuous, and seedable.
   * @param {number} time - Current timeline/local time in seconds
   * @param {number} [freq=2] - Frequency in wiggles per second (Hz)
   * @param {number} [amp=20] - Amplitude / magnitude of wiggle
   * @param {number} [octaves=1] - Noise octaves for fine detail
   * @param {number|string} [seed=0] - Random seed
   * @returns {number} Offset value in [-amp, amp]
   */
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

  /**
   * After Effects-style 2D vector wiggle (returns `{ x, y }`).
   */
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

/**
 * Remotion-style interpolate() helper
 */
export function interpolate(value, inputRange, outputRange, options = {}) {
  const {
    extrapolateLeft = 'extend',
    extrapolateRight = 'extend',
    easing = Easing.linear,
  } = options;

  if (inputRange.length < 2 || outputRange.length < 2 || inputRange.length !== outputRange.length) {
    return outputRange[0] ?? 0;
  }

  // Handle out of bounds left
  if (value < inputRange[0]) {
    if (extrapolateLeft === 'clamp') return outputRange[0];
    if (extrapolateLeft === 'identity') return value;
  }

  // Handle out of bounds right
  const lastIdx = inputRange.length - 1;
  if (value > inputRange[lastIdx]) {
    if (extrapolateRight === 'clamp') return outputRange[lastIdx];
    if (extrapolateRight === 'identity') return value;
  }

  // Find active segment
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

/**
 * Remotion-style spring() physics evaluation
 */
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
    // Under-damped spring
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const a = 1;
    const b = (zeta * w0 - initialVelocity) / wd;
    const envelope = Math.exp(-zeta * w0 * t);
    return 1 - envelope * (a * Math.cos(wd * t) + b * Math.sin(wd * t));
  } else {
    // Critically damped or over-damped
    const envelope = Math.exp(-w0 * t);
    return 1 - envelope * (1 + (w0 - initialVelocity) * t);
  }
}

/**
 * Represents a single tween track on a specific property (e.g. 'position.x', 'rotation', 'scale.x')
 */
class PropertyTweenTrack {
  constructor(path, targetVal, options = {}) {
    this.path = path; // e.g. 'x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'
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

    if (effectiveTime <= 0) {
      return baseVal;
    }

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

/**
 * Deterministic Tween Context provided to onStart() and scripts
 */
export class MotionTweenContext {
  constructor(baseTransform) {
    this.baseTransform = { ...baseTransform };
    this.tracks = [];
    this.sineTracks = [];
    this.shakeTracks = [];
    this.punchTracks = [];
  }

  /**
   * Animate properties towards target values
   * Usage: tween.to(transform.position, { y: -50 }, { duration: 1, ease: 'outBounce' })
   *    or: tween.to(transform, { rotation: 45, opacity: 0.5 }, { duration: 0.8 })
   */
  to(targetObj, props, options = {}) {
    this._addTracks(targetObj, props, options, false);
    return this;
  }

  /**
   * Animate properties from initial values towards current values
   * Usage: tween.from(transform.position, { y: -200 }, { duration: 1, ease: 'outBounce' })
   */
  from(targetObj, props, options = {}) {
    this._addTracks(targetObj, props, options, true);
    return this;
  }

  /**
   * Spring physics animation
   */
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

  /**
   * Elastic Punch animation
   */
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

  /**
   * Shake animation
   */
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

  /**
   * Continuous Sine Wave Oscillator
   */
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

  /**
   * Deterministically evaluate all tweens at localTime
   */
  evaluate(localTime, baseTransform) {
    const result = {
      x: baseTransform.x ?? 0,
      y: baseTransform.y ?? 0,
      rotation: baseTransform.rotation ?? 0,
      scaleX: baseTransform.scaleX ?? 1,
      scaleY: baseTransform.scaleY ?? 1,
      opacity: baseTransform.opacity ?? 1,
    };

    // 1. Evaluate Property Tweens
    for (const track of this.tracks) {
      if (track.path === 'x') {
        result.x = track.evaluate(localTime, baseTransform.x ?? 0);
      } else if (track.path === 'y') {
        result.y = track.evaluate(localTime, baseTransform.y ?? 0);
      } else if (track.path === 'rotation') {
        result.rotation = track.evaluate(localTime, baseTransform.rotation ?? 0);
      } else if (track.path === 'scaleX') {
        result.scaleX = track.evaluate(localTime, baseTransform.scaleX ?? 1);
      } else if (track.path === 'scaleY') {
        result.scaleY = track.evaluate(localTime, baseTransform.scaleY ?? 1);
      } else if (track.path === 'opacity') {
        result.opacity = track.evaluate(localTime, baseTransform.opacity ?? 1);
      }
    }

    // 2. Evaluate Sine Waves
    for (const s of this.sineTracks) {
      const val = Math.sin(localTime * s.frequency * Math.PI * 2 + s.phase) * s.amplitude;
      if (s.path === 'x') result.x += val;
      else if (s.path === 'y') result.y += val;
      else if (s.path === 'rotation') result.rotation += val;
      else if (s.path === 'scaleX') result.scaleX += val;
      else if (s.path === 'scaleY') result.scaleY += val;
      else if (s.path === 'opacity') result.opacity = Math.max(0, Math.min(1, result.opacity + val));
    }

    // 3. Evaluate Punches
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

    // 4. Evaluate Shakes
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
