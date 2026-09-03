/**
 * @blahblah/sdk — Type declarations only (no runtime code).
 *
 * Describes the APIs that `scriptRunner.js` injects into script scope at
 * runtime: easing functions, math helpers, motion-tween context, and the
 * three contract shapes (canvas / motion / react) that a script can implement.
 *
 * This package is referenced via `paths` in `scripts/jsconfig.json` so that
 * VS Code / Cursor can provide autocomplete for `@blahblah/sdk` imports
 * inside a project's `scripts/` folder. The runtime injects these globals
 * via `new Function()`; scripts that use real `import` statements are
 * bundled in-browser by esbuild (npm packages resolved once through esm.sh
 * and cached, local `./helpers.js` files read from the project's
 * `scripts/` folder), and the same globals below remain in scope.
 */
 
// Type-only import — this package ships no runtime code, so this must
// never become a value import (there is nothing to import at runtime).
import type * as ReactNamespace from 'react';
 
// ─── Easing ──────────────────────────────────────────────────────────────────
 
/** A single easing function: maps a normalized progress `t` ∈ [0, 1] to an eased value. */
export type EasingFn = (t: number) => number;
 
/**
 * Standard easing functions (lowercase keys).
 * All map `(t: number) => number` where `t` is normalized progress [0, 1].
 */
export interface EasingMap {
  linear: EasingFn;
  inQuad: EasingFn;
  outQuad: EasingFn;
  inOutQuad: EasingFn;
  inCubic: EasingFn;
  outCubic: EasingFn;
  inOutCubic: EasingFn;
  inSine: EasingFn;
  outSine: EasingFn;
  inOutSine: EasingFn;
  inBack: EasingFn;
  outBack: EasingFn;
  inOutBack: EasingFn;
  inBounce: EasingFn;
  outBounce: EasingFn;
  inOutBounce: EasingFn;
  inElastic: EasingFn;
  outElastic: EasingFn;
  inOutElastic: EasingFn;
}
 
export const Easing: EasingMap;
 
/**
 * Uppercase-aliased easing functions (e.g. `Ease.OutBounce`).
 * Each entry exists in both lowercase and Capitalized forms.
 */
export interface EaseMap extends EasingMap {
  Linear: EasingFn;
  InQuad: EasingFn;
  OutQuad: EasingFn;
  InOutQuad: EasingFn;
  InCubic: EasingFn;
  OutCubic: EasingFn;
  InOutCubic: EasingFn;
  InSine: EasingFn;
  OutSine: EasingFn;
  InOutSine: EasingFn;
  InBack: EasingFn;
  OutBack: EasingFn;
  InOutBack: EasingFn;
  InBounce: EasingFn;
  OutBounce: EasingFn;
  InOutBounce: EasingFn;
  InElastic: EasingFn;
  OutElastic: EasingFn;
  InOutElastic: EasingFn;
}
 
export const Ease: EaseMap;
 
// ─── LoopType ────────────────────────────────────────────────────────────────
 
/** Loop behaviour constants for tween tracks. */
export interface LoopTypeMap {
  restart: 'restart';
  yoyo: 'yoyo';
  incremental: 'incremental';
  /** Uppercase aliases */
  Restart: 'restart';
  Yoyo: 'yoyo';
}
 
export const LoopType: LoopTypeMap;
 
// ─── MathUtils ───────────────────────────────────────────────────────────────
 
/** 2D vector. */
export interface Vec2 {
  x: number;
  y: number;
}
 
/** 3D vector. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
 
/** Standard math & vector helper functions. */
export interface MathUtilsStatic {
  /** Linear interpolation clamped to [0, 1]. */
  lerp(a: number, b: number, t: number): number;
  /** Clamp `val` between `min` and `max`. */
  clamp(val: number, min: number, max: number): number;
  /** Clamp `val` between 0 and 1. */
  clamp01(val: number): number;
  /** Remap `val` from range [inMin, inMax] to [outMin, outMax]. */
  remap(val: number, inMin: number, inMax: number, outMin: number, outMax: number): number;
  /** Convert degrees to radians. */
  degToRad(deg: number): number;
  /** Convert radians to degrees. */
  radToDeg(rad: number): number;
  /** Create a 2D vector. */
  vec2(x: number, y: number): Vec2;
  /** Create a 3D vector (z defaults to 0). */
  vec3(x: number, y: number, z?: number): Vec3;
}
 
export const MathUtils: MathUtilsStatic;
 
// ─── interpolate ─────────────────────────────────────────────────────────────
 
/** Extrapolation mode for `interpolate()`. */
export type ExtrapolateMode = 'extend' | 'clamp' | 'identity';
 
/** Options for `interpolate()`. */
export interface InterpolateOptions {
  extrapolateLeft?: ExtrapolateMode;
  extrapolateRight?: ExtrapolateMode;
  easing?: EasingFn | string;
}
 
/**
 * Remotion-style `interpolate()` helper.
 * Maps a `value` from `inputRange` to `outputRange` with optional easing.
 */
export function interpolate(
  value: number,
  inputRange: number[],
  outputRange: number[],
  options?: InterpolateOptions,
): number;
 
// ─── spring ──────────────────────────────────────────────────────────────────
 
/** Configuration for `spring()`. */
export interface SpringConfig {
  damping?: number;
  mass?: number;
  stiffness?: number;
  initialVelocity?: number;
}
 
/** Options for `spring()`. */
export interface SpringOptions {
  frame?: number;
  fps?: number;
  config?: SpringConfig;
}
 
/**
 * Remotion-style spring physics evaluation.
 * Returns a value that oscillates towards 1 based on the spring config.
 */
export function spring(options: SpringOptions): number;
 
// ─── MotionTweenContext ──────────────────────────────────────────────────────
 
/** The resolved transform object used by `MotionTweenContext.evaluate()`. */
export interface ResolvedTransform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}
 
/** Options for tween `to()` / `from()` calls. */
export interface TweenOptions {
  duration?: number;
  delay?: number;
  ease?: EasingFn | string;
  loop?: number | 'yoyo';
  yoyo?: boolean;
  loopType?: 'restart' | 'yoyo' | 'incremental';
  relative?: boolean;
  from?: number;
}
 
/** Options for spring tween calls. */
export interface TweenSpringOptions {
  duration?: number;
  delay?: number;
  from?: number;
}
 
/** Options for punch calls. */
export interface PunchOptions {
  duration?: number;
  delay?: number;
  vibrato?: number;
}
 
/** Options for shake calls. */
export interface ShakeOptions {
  intensity?: number;
  duration?: number;
  delay?: number;
}
 
/** Options for sine wave calls. */
export interface SineOptions {
  frequency?: number;
  phase?: number;
}
 
/**
 * Deterministic tween context provided to `onStart()` / `onUpdate()`.
 * Accumulates tween tracks and evaluates them at a given local time.
 */
export class MotionTweenContext {
  constructor(baseTransform: Partial<ResolvedTransform>);
 
  /**
   * Animate properties towards target values.
   * @example tween.to(transform.position, { y: -50 }, { duration: 1, ease: 'outBounce' })
   */
  to(targetObj: Record<string, any>, props: Record<string, number>, options?: TweenOptions): this;
 
  /**
   * Animate from initial values towards current values.
   * @example tween.from(transform.position, { y: -200 }, { duration: 1, ease: 'outBounce' })
   */
  from(targetObj: Record<string, any>, props: Record<string, number>, options?: TweenOptions): this;
 
  /**
   * Spring physics animation.
   */
  spring(targetObj: Record<string, any>, props: Record<string, number>, config?: TweenSpringOptions): this;
 
  /**
   * Elastic punch animation.
   */
  punch(targetObj: Record<string, any>, props: Record<string, number>, options?: PunchOptions): this;
 
  /**
   * Shake animation.
   */
  shake(targetObj: Record<string, any>, options?: ShakeOptions): this;
 
  /**
   * Continuous sine wave oscillator.
   */
  sine(targetObj: Record<string, any>, props: Record<string, number>, options?: SineOptions): this;
 
  /**
   * Deterministically evaluate all accumulated tweens at `localTime`.
   */
  evaluate(localTime: number, baseTransform: ResolvedTransform): ResolvedTransform;
}
 
// ─── Runtime Contract Types ──────────────────────────────────────────────────
 
/**
 * The `libs` object passed to CanvasRenderer scripts.
 * Keys correspond to CDN-loaded globals (e.g. `libs.THREE`, `libs.gsap`).
 * Use `libs.load(name)` to await a specific library before using it.
 */
export interface CanvasLibs {
  [libName: string]: any;
  /** Explicitly await a library by name (returns the loaded global). */
  load(name: string): Promise<any>;
}
 
/**
 * Argument object for `onMount()`.
 */
export interface CanvasOnMountArgs {
  container: HTMLElement;
  props: Record<string, any>;
  libs: CanvasLibs;
}
 
/**
 * Argument object for `onUpdate()` / `onSeek()`.
 */
export interface CanvasOnUpdateArgs {
  container: HTMLElement;
  time: number;
  frame: number;
  fps: number;
  props: Record<string, any>;
}
 
/**
 * CanvasRenderer contract — implement this in a class default-exported from a script.
 *
 * NOTE on libraries with their own internal clock (GSAP, some Three.js
 * patterns): once a library is really `import`-ed, its own ticker (e.g.
 * `gsap.ticker`) still runs independently of the timeline `time`/`frame`
 * values passed into `onUpdate`, so free-running tweens won't scrub or
 * export correctly. Use a seek-safe pattern instead — create a paused
 * timeline and drive it from the deterministic `time` argument:
 *
 * ```js
 * this.tl = gsap.timeline({ paused: true });
 * this.tl.to(el, { x: 100, duration: 1 });
 * // in onUpdate / onSeek:
 * this.tl.seek(time);
 * ```
 *
 * @example
 * ```js
 * export default class MyThing {
 *   onMount({ container, props, libs }) { /* set up DOM *\/ }
 *   onUpdate({ container, time, frame, props }) { /* animate *\/ }
 *   onUnmount() { /* clean up *\/ }
 * }
 * ```
 */
export interface CanvasScript {
  onMount?(args: CanvasOnMountArgs): void;
  onUpdate?(args: CanvasOnUpdateArgs): void;
  onSeek?(args: CanvasOnUpdateArgs): void;
  onUnmount?(): void;
}
 
/**
 * Transform proxy used by motion scripts.
 * `position` and `scale` are sub-objects with `_isPosition` / `_isScale` markers.
 */
export interface MotionTransformProxy {
  position: { x: number; y: number; _isPosition: true };
  scale: { x: number; y: number; _isScale: true };
  rotation: number;
  opacity: number;
}
 
/**
 * Argument object for motion script `onStart()`.
 */
export interface MotionOnStartArgs {
  transform: MotionTransformProxy;
  tween: MotionTweenContext;
  props: Record<string, any>;
  time: number;
  frame: number;
  fps: number;
  duration: number;
  Math: MathUtilsStatic;
}
 
/**
 * Argument object for motion script `onUpdate()`.
 */
export interface MotionOnUpdateArgs {
  transform: MotionTransformProxy;
  props: Record<string, any>;
  time: number;
  frame: number;
  fps: number;
  duration: number;
  Math: MathUtilsStatic;
  lerp: MathUtilsStatic['lerp'];
  clamp: MathUtilsStatic['clamp'];
  interpolate: typeof interpolate;
  spring: typeof spring;
}
 
/**
 * Motion script contract (ScriptComponent) — implement this in a class.
 *
 * `onStart()` is called once to set up tween tracks on the `tween` context.
 * `onUpdate()` is called every frame for custom frame-based math.
 *
 * @example
 * ```js
 * export default class FloatAndBounce {
 *   onStart({ transform, tween, props }) {
 *     tween.to(transform.position, { y: -props.amplitude }, {
 *       duration: props.duration, ease: 'outBounce', yoyo: true, loop: Infinity
 *     });
 *   }
 * }
 * ```
 */
export interface MotionScript {
  onStart?(args: MotionOnStartArgs): void;
  onUpdate?(args: MotionOnUpdateArgs): void;
}
 
/**
 * React script contract — a function component returning JSX / React elements.
 *
 * @example
 * ```jsx
 * export default function GlassCard({ title, badge, accentColor }) {
 *   return <div>{title}</div>;
 * }
 * ```
 */
export type ReactScript = ReactNamespace.FC<Record<string, any>>;
 
// ─── Re-export React types for convenience ────────────────────────────────────
 
export { ReactNamespace as React };
 