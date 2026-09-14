/**
 * Type declarations for @blahblah/sdk.
 *
 * This is a TYPES-ONLY convenience file — see index.js in this same
 * folder for the actual runtime classes and utilities that `extends`
 * and `import` resolve against in the browser. Both files are vendored
 * per-project (see projectFileSystem.js) so editor tooling (VS Code,
 * jsconfig.json) works offline and anywhere on disk.
 */

// ─── Script Libraries ────────────────────────────────────────────────────────

/** A loader for on-demand libraries exposed to scripts (see attachLoader / createLibsProxy in canvasRunner.js). */
export interface ScriptLibs {
  /** Three.js r128 (available once loaded). */
  THREE?: any;
  /** GSAP 3.12.5 (available once loaded). */
  gsap?: any;
  /** Explicitly load a canvas library before using it (recommended in onMount). */
  load(name: 'THREE' | 'gsap' | string): Promise<any>;
  [libName: string]: any;
}

// ─── Canvas / Visual Script Lifecycle Args ───────────────────────────────────

export interface ClipTimingArgs {
  /** Total clip duration in seconds. */
  duration?: number;
  /** Total frames in this clip (duration * fps). */
  totalFrames?: number;
  /** Normalized clip progress from 0.0 (start) to 1.0 (end), clamped. */
  progress?: number;
  /** Timeline absolute start time of this clip in seconds. */
  startTime?: number;
  /** Timeline absolute end time of this clip in seconds (`startTime + duration`). */
  endTime?: number;
  /** Remaining time in this clip in seconds (`duration - time`), clamped at 0. */
  timeLeft?: number;
  [key: string]: any;
}

export interface MotionScriptMountArgs extends ClipTimingArgs {
  /** The host element the script owns. Append your own canvas/DOM into this. */
  container?: HTMLElement;
  /** This script's resolved `static props` values (Inspector-editable/keyframeable fields). */
  props?: Record<string, any>;
  /** On-demand library loader (`libs.THREE`, `await libs.load('THREE')`). */
  libs?: ScriptLibs;
  /** Resolved effective canvas width — see resolveCanvasSize in canvasRunner.js. */
  canvasWidth?: number;
  /** Resolved effective canvas height — see resolveCanvasSize in canvasRunner.js. */
  canvasHeight?: number;
  /** Stateless timeline helpers; supplied directly to Canvas lifecycle hooks. */
  tween?: typeof Tween;
  Tween?: typeof Tween;
}

export interface MotionScriptUpdateArgs extends ClipTimingArgs {
  /** The same host element passed to onMount. */
  container?: HTMLElement;
  /** Local clip time in seconds — a pure function of the timeline's playhead. */
  time?: number;
  /** Current frame number at the project's fps. */
  frame?: number;
  /** Project frames-per-second. */
  fps?: number;
  /** This script's resolved `static props` values. */
  props?: Record<string, any>;
  /** Resolved effective canvas width. */
  canvasWidth?: number;
  /** Resolved effective canvas height. */
  canvasHeight?: number;
  /** Stateless timeline helpers; use `tween.between(...)` for deterministic values. */
  tween?: typeof Tween;
  Tween?: typeof Tween;
}

/**
 * Optional hook, called once (before onUpdate) when the playhead
 * jumps more than ~2 frames' worth in either direction (scrub / seek).
 * Use it to reset accumulated state (particles, counters, etc.).
 */
export interface MotionScriptSeekArgs extends ClipTimingArgs {
  container?: HTMLElement;
  time?: number;
  frame?: number;
  fps?: number;
  props?: Record<string, any>;
  canvasWidth?: number;
  canvasHeight?: number;
  tween?: typeof Tween;
  Tween?: typeof Tween;
}

export interface MotionScriptUnmountArgs {
  /** The same host element passed to onMount. */
  container?: HTMLElement;
  [key: string]: any;
}

// ─── Lifecycle Base Classes ──────────────────────────────────────────────────

/**
 * Common base for motion / canvas scripts.
 * All lifecycle methods are optional — implement only what you need.
 */
export class MotionScript {
  /** Called once when the script's host element is mounted into the DOM. */
  onMount?(args: MotionScriptMountArgs): void | Promise<void>;
  /** Called every frame during playback. */
  onUpdate?(args: MotionScriptUpdateArgs): void;
  /** Called when the playhead jumps (scrub/seek) — reset accumulated state here. */
  onSeek?(args: MotionScriptSeekArgs): void;
  /** Called when the script's host element is removed from the DOM. */
  onUnmount?(args: MotionScriptUnmountArgs): void;
}

/**
 * Base for scripts that draw into a 2D <canvas>. Automatically creates and sizes
 * `<canvas>` in `container`, handles resize in `onUpdate`, and removes on unmount.
 */
export class CanvasComponent extends MotionScript {
  container: HTMLElement | null;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  canvasWidth: number;
  canvasHeight: number;
  aspect: number;
}

/**
 * Base for Three.js visual scripts. Automatically handles DOM attachment,
 * camera projection matrix and WebGLRenderer resize, and disposal.
 */
export class ThreeComponent extends MotionScript {
  container: HTMLElement | null;
  scene: any;
  camera: any;
  renderer: any;
  canvasWidth: number;
  canvasHeight: number;
  aspect: number;
}

// ─── Transform Motion Scripts (ScriptComponent / onStart / onUpdate) ──────────

export interface TransformPosition {
  x: number;
  y: number;
}

export interface TransformScale {
  x: number;
  y: number;
}

export interface TransformProxy {
  position: TransformPosition;
  scale: TransformScale;
  rotation: number;
  opacity: number;
}

export interface TransformStartArgs {
  transform: TransformProxy;
  tween: MotionTweenContext;
  props: Record<string, any>;
  time: number;
  frame: number;
  fps: number;
  duration: number;
  Math: typeof MathUtils;
  Tween: typeof Tween;
}

export interface TransformUpdateArgs {
  transform: TransformProxy;
  props: Record<string, any>;
  time: number;
  frame: number;
  fps: number;
  duration: number;
  Math: typeof MathUtils;
  lerp: (a: number, b: number, t: number) => number;
  clamp: (val: number, min: number, max: number) => number;
  interpolate: typeof interpolate;
  spring: typeof spring;
  tween: typeof Tween;
  Tween: typeof Tween;
}

// ─── Easing ──────────────────────────────────────────────────────────────────

export type EasingFunction = (t: number) => number;

export interface EasingMap {
  linear: EasingFunction;
  inQuad: EasingFunction;
  outQuad: EasingFunction;
  inOutQuad: EasingFunction;
  inCubic: EasingFunction;
  outCubic: EasingFunction;
  inOutCubic: EasingFunction;
  inSine: EasingFunction;
  outSine: EasingFunction;
  inOutSine: EasingFunction;
  inBack: (t: number, s?: number) => number;
  outBack: (t: number, s?: number) => number;
  inOutBack: (t: number, s?: number) => number;
  inBounce: EasingFunction;
  outBounce: EasingFunction;
  inOutBounce: EasingFunction;
  inElastic: EasingFunction;
  outElastic: EasingFunction;
  inOutElastic: EasingFunction;
  [key: string]: EasingFunction;
}

export const Easing: EasingMap;
export const Ease: EasingMap;
export type EasingName = keyof EasingMap;

export const LoopType: {
  restart: 'restart';
  yoyo: 'yoyo';
  incremental: 'incremental';
  Restart: 'restart';
  Yoyo: 'yoyo';
};

// ─── Math & Vector Helpers ───────────────────────────────────────────────────

export interface Vector2 {
  x: number;
  y: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export const MathUtils: {
  /** Linear interpolation clamped to [0, 1]. */
  lerp(a: number, b: number, t: number): number;
  /** Clamps a value between min and max. */
  clamp(val: number, min: number, max: number): number;
  /** Clamps a value between 0 and 1. */
  clamp01(val: number): number;
  /** Remaps a number from an input range to an output range. */
  remap(val: number, inMin: number, inMax: number, outMin: number, outMax: number): number;
  /** Converts degrees to radians. */
  degToRad(deg: number): number;
  /** Converts radians to degrees. */
  radToDeg(rad: number): number;
  /** Creates a 2D vector object `{ x, y }`. */
  vec2(x: number, y: number): Vector2;
  /** Creates a 3D vector object `{ x, y, z }`. */
  vec3(x: number, y: number, z?: number): Vector3;
};

export interface TweenWindowOptions {
  at?: number;
  duration?: number;
  ease?: EasingFunction | EasingName;
}

/** Stateless, deterministic helpers shared by Canvas, React, and motion scripts. */
export const Tween: {
  clamp: typeof MathUtils.clamp;
  clamp01: typeof MathUtils.clamp01;
  lerp: typeof MathUtils.lerp;
  remap: typeof MathUtils.remap;
  ease(t: number, ease?: EasingFunction | EasingName): number;
  progress(time: number, options?: TweenWindowOptions): number;
  between(from: number, to: number, time: number, options?: TweenWindowOptions): number;
  loop(time: number, duration?: number, mode?: 'restart' | 'yoyo' | 'pingpong'): number;
  pingPong(time: number, duration?: number): number;
  stagger(index: number, each?: number): number;
};

// ─── Interpolate & Spring ────────────────────────────────────────────────────

export interface InterpolateOptions {
  extrapolateLeft?: 'extend' | 'clamp' | 'identity';
  extrapolateRight?: 'extend' | 'clamp' | 'identity';
  easing?: EasingFunction | EasingName;
}

/**
 * Remotion-style interpolation function.
 * Maps an input value from `inputRange` to `outputRange` with optional easing.
 */
export function interpolate(
  value: number,
  inputRange: number[],
  outputRange: number[],
  options?: InterpolateOptions
): number;

export interface SpringConfig {
  damping?: number;
  mass?: number;
  stiffness?: number;
  initialVelocity?: number;
  duration?: number;
  delay?: number;
  from?: number;
}

export interface SpringOptions {
  frame?: number;
  fps?: number;
  config?: SpringConfig;
}

/**
 * Remotion-style spring physics evaluator. Returns a value from 0 to 1 (or beyond if bouncing).
 */
export function spring(options?: SpringOptions): number;

// ─── MotionTweenContext ──────────────────────────────────────────────────────

export interface TweenOptions {
  duration?: number;
  delay?: number;
  ease?: EasingFunction | EasingName;
  loop?: 'yoyo' | 'restart' | string;
  yoyo?: boolean;
  loops?: number;
  loopType?: string;
  relative?: boolean;
  from?: number;
}

export interface PunchOptions {
  duration?: number;
  delay?: number;
  vibrato?: number;
}

export interface ShakeOptions {
  duration?: number;
  delay?: number;
  intensity?: number;
}

export interface SineOptions {
  frequency?: number;
  phase?: number;
}

export class MotionTweenContext {
  constructor(baseTransform?: Record<string, any>);
  /** Animate properties towards target values. */
  to(targetObj: any, props: Record<string, any>, options?: TweenOptions): this;
  /** Animate properties from initial values towards current values. */
  from(targetObj: any, props: Record<string, any>, options?: TweenOptions): this;
  /** Spring physics animation. */
  spring(targetObj: any, props: Record<string, any>, config?: SpringConfig): this;
  /** Elastic punch vibration animation. */
  punch(targetObj: any, props: Record<string, any>, options?: PunchOptions): this;
  /** Camera/object shake animation. */
  shake(targetObj: any, options?: ShakeOptions): this;
  /** Continuous sine wave oscillation. */
  sine(targetObj: any, props: Record<string, any>, options?: SineOptions): this;
  evaluate(localTime: number, baseTransform: Record<string, any>): Record<string, any>;
}

// ─── Reference Types ─────────────────────────────────────────────────────────

export interface EntityRefTransform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  speed: number;
}

/**
 * A reference to another clip/entity on the BlahBlah timeline.
 * Obtained when a script prop is declared with `type: 'entity'`.
 */
export interface EntityRef {
  /** The entity's unique ID string. */
  readonly id: string | null;
  /** The entity's display name on the timeline. */
  readonly name: string | null;
  /** Seconds at which the clip starts on the timeline. */
  readonly startTime: number;
  /** Duration of the clip in seconds. */
  readonly duration: number;
  /** Parent entity ID, or null. */
  readonly parentId: string | null;
  /** Returns true when the referenced entity exists in the current project. */
  exists(): boolean;
  /**
   * Returns the entity's raw local Transform values.
   * @returns {EntityRefTransform | null}
   */
  getTransform(): EntityRefTransform | null;
  /**
   * Returns the first component of the given type attached to the entity, or null.
   * Common types: 'VideoRenderer', 'AudioSource', 'TextRenderer', 'ShapeRenderer'
   */
  getComponent(type: string): Record<string, any> | null;
}

/**
 * A reference to a media asset (video, audio, or image) in the BlahBlah project.
 * Obtained when a script prop is declared with `type: 'asset'`.
 */
export interface AssetRef {
  /** The asset's unique ID string. */
  readonly id: string | null;
  /** The filename / display name of the asset. */
  readonly name: string | null;
  /** URL or path to the actual media file. */
  readonly src: string | null;
  /** Media type: 'video', 'audio', or 'image'. */
  readonly type: 'video' | 'audio' | 'image' | null;
  /** Duration in seconds (video/audio), or null for images. */
  readonly duration: number | null;
  /** Returns true when the asset exists in the current project. */
  exists(): boolean;
}

// ─── SubtitleTrack ────────────────────────────────────────────────────────────

/** A single word with sub-phrase timing (from Whisper-style transcription). */
export interface SubtitleWord {
  word: string;
  start: number;
  end: number;
}

/**
 * A single timed phrase in a SubtitleTrack component.
 *
 * Per-phrase `mode` controls whether this phrase starts a new sentence (`'set'`)
 * or accumulates onto the previous phrase(s) (`'add'`).
 *
 * In `timingMode: 'duration'` the `duration` field is the source of truth and
 * `startTime`/`endTime` are derived automatically by `recalculateSequentialPhrases`.
 */
export interface SubtitlePhrase {
  /** Unique stable ID (crypto.randomUUID format). */
  id: string;
  /** Phrase start time in seconds, entity-local. */
  startTime: number;
  /** Phrase end time in seconds, entity-local. */
  endTime: number;
  /** The displayed text for this phrase. */
  text: string;
  /**
   * Per-phrase display mode.
   * - `'set'` (default): replace — this phrase begins a new sentence group.
   * - `'add'`: accumulate — this phrase is appended to the previous sentence group.
   */
  mode: 'set' | 'add';
  /**
   * Duration in seconds. Present only when `timingMode === 'duration'`.
   * `startTime`/`endTime` are derived from this by the engine.
   */
  duration?: number;
  /** Word-level timing array. Only present when available (e.g. from Whisper). */
  words?: SubtitleWord[];
  /** Styling hint: indicates this phrase should be visually differentiated. */
  emphasis?: boolean;
  /** Reserved for future multi-language support. Not surfaced in UI yet. */
  language?: string;
}

/**
 * The SubtitleTrack component data object.
 *
 * `timingMode` controls how phrase timing is authored:
 * - `'duration'` (default): each phrase has a `duration`; times are chained sequentially.
 * - `'range'`: each phrase has explicit `startTime` / `endTime` (manual).
 *
 * `displayMode` is the **track-level** fallback default when individual phrases have no
 * per-phrase `mode` override:
 * - `'set'` (default): each phrase replaces the previous one.
 * - `'add'`: all phrases accumulate into an ever-growing sentence.
 *
 * Per-phrase `mode` on each `SubtitlePhrase` takes precedence over `displayMode`.
 */
export interface SubtitleTrackComponent {
  type: 'SubtitleTrack';
  phrases: SubtitlePhrase[];
  /**
   * How phrase timing is authored in the Inspector.
   * @default 'duration'
   */
  timingMode: 'duration' | 'range';
  /**
   * Track-level default display mode (fallback when phrase has no per-phrase override).
   * @default 'set'
   */
  displayMode: 'set' | 'add';
}

/**
 * Result of `getPhraseContextAt(component, t)` — the full display context at a given time.
 *
 * `text` is the "smart" display text and is what most scripts should render:
 * - During an active phrase with `mode === 'set'`: only that phrase's text.
 * - During an active phrase with `mode === 'add'`: accumulated sentence up to and including
 *   that phrase (`sentenceText`).
 * - In a gap after an `'add'` phrase: holds the last sentence text.
 * - In all other gaps: empty string.
 *
 * The raw sentence / accumulated arrays are provided for advanced rendering
 * (e.g. animating each word, highlighting the current phrase, karaoke-style display).
 */
export interface SubtitlePhraseContext {
  /**
   * The recommended display string. Use this for simple subtitle rendering.
   * Respects per-phrase and track-level `mode` automatically.
   */
  text: string;
  /**
   * All phrases from the nearest `'set'` boundary up to the current phrase
   * (the "current sentence group").
   */
  sentencePhrases: SubtitlePhrase[];
  /**
   * The concatenated text of `sentencePhrases` (joined with spaces, empty phrases filtered).
   */
  sentenceText: string;
  /**
   * All phrases from the beginning of the track up to and including the current phrase.
   */
  accumulatedPhrases: SubtitlePhrase[];
  /**
   * The concatenated text of all phrases seen so far (`accumulatedPhrases`).
   */
  accumulatedText: string;
  /**
   * Effective display mode of the active phrase.
   * `'set'` means this phrase starts fresh; `'add'` means it accumulates.
   */
  mode: 'set' | 'add';
  /** Zero-based index of the active phrase in the track's phrase array. Null during a gap. */
  index: number | null;
  /** The currently active phrase object. Null during a gap. */
  phrase: SubtitlePhrase | null;
  /** The phrase immediately before the active one (or before the gap). Null if none. */
  prev: SubtitlePhrase | null;
  /** The phrase immediately after the active one (or after the gap). Null if none. */
  next: SubtitlePhrase | null;
}

/**
 * Resolves subtitle display context for an entity's SubtitleTrack component at a given local time.
 * Provided on `EntityRef` when the entity has a SubtitleTrack.
 *
 * @example
 * ```js
 * // In a canvas script:
 * const sub = props.subtitleSource;   // EntityRef (entity prop)
 * const ctx = sub.getPhraseAt(localTime);
 * if (ctx) {
 *   drawText(ctx.text);               // smart display text
 * }
 * ```
 */
export interface SubtitleEntityRef extends EntityRef {
  /**
   * Returns the subtitle context at the given entity-local time,
   * or `null` if the entity has no SubtitleTrack or no phrases.
   */
  getPhraseAt(localTime: number): SubtitlePhraseContext | null;
}

