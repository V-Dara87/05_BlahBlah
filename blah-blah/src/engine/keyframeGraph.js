/**
 * Keyframe graph helpers — the pure maths behind the Dopesheet's Graph view.
 *
 * The keyframe engine (keyframes.js) stores one cubic bezier per SEGMENT, on
 * the "from" keyframe, in NORMALISED space:
 *   cp.x  = fraction of the segment's time span   (0..1)
 *   cp.y  = fraction of the segment's value change (can overshoot, see CP_Y_*)
 * The Graph view draws the same segment in real space (seconds on X, the
 * parameter's value on Y), so dragging a bezier handle on screen has to be
 * converted back into those normalised numbers. That conversion, plus a few
 * small helpers the view needs, lives here so it can be unit-tested without a
 * DOM.
 *
 * Nothing in this file mutates its inputs.
 */
import { DEFAULT_CP1, DEFAULT_CP2, evaluateField } from './keyframes.js';

/** Same limits the Curves tab enforces on a control point's y. */
export const CP_Y_MIN = -0.5;
export const CP_Y_MAX = 1.5;

const EPS = 1e-9;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round3 = (n) => Math.round(n * 1000) / 1000;

/** Stable id for one (component track, field) curve. */
export const curveId = (trackKey, fieldName) => `${trackKey}::${fieldName}`;

/** Colours handed out to curves in order (cycled when there are more curves). */
export const CURVE_PALETTE = [
  '#ff6b6b', '#4ade80', '#60a5fa', '#fbbf24', '#c084fc',
  '#2dd4bf', '#fb923c', '#f472b6', '#a3e635', '#38bdf8',
];

export const curveColorAt = (index) => CURVE_PALETTE[((index % CURVE_PALETTE.length) + CURVE_PALETTE.length) % CURVE_PALETTE.length];

/**
 * A field can only be drawn as a curve when it has keyframes and EVERY one of
 * them is a finite number. Colours, booleans, selects and strings are held
 * between keys (see evaluateField), so there is no curve to show for them.
 */
export function isNumericCurve(kfs) {
  return (
    Array.isArray(kfs) &&
    kfs.length > 0 &&
    kfs.every((k) => typeof k.value === 'number' && Number.isFinite(k.value))
  );
}

/**
 * Absolute (time, value) position of the two bezier handles of the segment
 * a -> b. `out` is the handle that leaves `a` (cp1), `in` is the one that
 * arrives at `b` (cp2). On a flat segment (a.value === b.value) both handles
 * sit on the line: the engine's y is a fraction of a zero-height change.
 */
export function segmentHandles(a, b) {
  const cp1 = a.cp1 || DEFAULT_CP1;
  const cp2 = a.cp2 || DEFAULT_CP2;
  const span = b.time - a.time;
  const dv = b.value - a.value;
  return {
    out: { time: a.time + cp1.x * span, value: a.value + cp1.y * dv },
    in: { time: a.time + cp2.x * span, value: a.value + cp2.y * dv },
  };
}

/**
 * Inverse of segmentHandles: the normalised control point for a handle the
 * user dropped at (time, value). `which` is 'out' (cp1) or 'in' (cp2).
 *
 * x is clamped to 0..1 so the curve stays a function of time, y to the Curves
 * tab's range. When the segment has no time span or no value change, the
 * matching axis cannot be derived from the pointer, so the handle keeps its
 * current number on that axis instead of jumping to NaN/Infinity.
 */
export function handleToControlPoint(a, b, which, time, value) {
  const current = which === 'out' ? (a.cp1 || DEFAULT_CP1) : (a.cp2 || DEFAULT_CP2);
  const span = b.time - a.time;
  const dv = b.value - a.value;
  const x = span > EPS ? clamp((time - a.time) / span, 0, 1) : current.x;
  const y = Math.abs(dv) > EPS ? clamp((value - a.value) / dv, CP_Y_MIN, CP_Y_MAX) : current.y;
  return { x: round3(x), y: round3(y) };
}

/**
 * Linked ("mirrored") handles, Spine style. The two handles that hang off one
 * keyframe live in DIFFERENT segments (the one arriving is the previous key's
 * cp2, the one leaving is this key's cp1). When the user drags one, this returns
 * the control point the OTHER one must take so that it sits exactly opposite:
 * same distance, opposite direction, measured in real (seconds, value) space
 * from the shared keyframe. Both handles therefore lie on one straight line
 * through the key, which is what makes the curve pass through it smoothly.
 *
 *   a, b    the segment that owns the handle to be moved (a -> b)
 *   which   'out' (a.cp1, anchored on a) or 'in' (a.cp2, anchored on b)
 *   anchor  the shared keyframe { time, value } (a for 'out', b for 'in')
 *   handle  where the dragged handle now is { time, value }
 *
 * The neighbouring segment can be shorter, or have a smaller value change, than
 * the dragged one, so the mirrored handle may not fit inside the limits a control
 * point has (x 0..1, y within CP_Y_MIN..CP_Y_MAX). Instead of clamping each axis
 * on its own (which would bend the line), both components are scaled by the same
 * factor, so the handles stay collinear and only get shorter. On an axis that
 * cannot be derived (zero time span / flat segment) the handle keeps its
 * current number, same as handleToControlPoint.
 */
export function linkedHandleControlPoint(a, b, which, anchor, handle) {
  const span = b.time - a.time;
  const dv = b.value - a.value;
  // Offset of the opposite handle from the shared key.
  const ot = anchor.time - handle.time;
  const ov = anchor.value - handle.value;

  let s = 1;
  // How far the mirrored handle reaches into its segment along time.
  const along = (which === 'out' ? 1 : -1) * ot;
  if (span > EPS && along > span) s = span / along;
  if (Math.abs(dv) > EPS) {
    const base = which === 'out' ? 0 : 1; // y of the control point at the anchor
    const c = ov / dv;                    // y change per unit of scale
    if (Math.abs(c) > EPS) {
      const limit = c > 0 ? CP_Y_MAX : CP_Y_MIN;
      s = Math.min(s, (limit - base) / c);
    }
  }
  return handleToControlPoint(a, b, which, anchor.time + s * ot, anchor.value + s * ov);
}

/** Snap a control point to a grid (the Curves tab uses 0.05 on Shift). */
export function snapControlPoint(cp, step = 0.05) {
  return {
    x: round3(clamp(Math.round(cp.x / step) * step, 0, 1)),
    y: round3(clamp(Math.round(cp.y / step) * step, CP_Y_MIN, CP_Y_MAX)),
  };
}

/**
 * Sample the real curve of segment a -> b as [{ time, value }]. It runs the
 * engine's own evaluator on a two-key probe, so what the Graph view draws is
 * exactly what the renderer plays back, easing included.
 */
export function sampleSegment(a, b, steps = 24) {
  const n = Math.max(1, Math.floor(steps));
  const probe = { keyframes: { t: { f: [a, b] } } };
  const span = b.time - a.time;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const time = span > 0 ? a.time + (span * i) / n : a.time;
    out.push({ time, value: evaluateField(probe, 't', 'f', time) });
  }
  return out;
}

/**
 * Lowest and highest value a curve reaches, overshoot included (a bouncy ease
 * leaves the range spanned by its keys). Used to frame the view.
 */
export function curveExtent(kfs, stepsPerSegment = 16) {
  let min = Infinity;
  let max = -Infinity;
  for (const k of kfs) {
    if (k.value < min) min = k.value;
    if (k.value > max) max = k.value;
  }
  for (let i = 0; i < kfs.length - 1; i++) {
    for (const s of sampleSegment(kfs[i], kfs[i + 1], stepsPerSegment)) {
      if (s.value < min) min = s.value;
      if (s.value > max) max = s.value;
    }
  }
  return { min, max };
}

/**
 * Add `deltaV` to the value of every selected NUMERIC keyframe and return the
 * new `keyframes` object. `deltaV` is either a number or a function
 * (trackKey, fieldName) => number, so each curve can move by its own amount
 * (the Graph view's Normalize mode shows every curve on its own scale).
 * Keyframes keep their ids, times and curves.
 */
export function shiftKeyframeValues(entity, keyframeIds, deltaV) {
  const ids = keyframeIds instanceof Set ? keyframeIds : new Set(keyframeIds);
  const keyframes = entity?.keyframes;
  if (!keyframes || ids.size === 0) return keyframes || {};

  const deltaFor = typeof deltaV === 'function' ? deltaV : () => deltaV;
  const next = {};
  for (const trackKey of Object.keys(keyframes)) {
    const byField = keyframes[trackKey];
    const nextByField = {};
    for (const fieldName of Object.keys(byField)) {
      const delta = deltaFor(trackKey, fieldName);
      const list = byField[fieldName] || [];
      nextByField[fieldName] =
        delta && Number.isFinite(delta)
          ? list.map((k) =>
              ids.has(k.id) && typeof k.value === 'number' ? { ...k, value: k.value + delta } : k
            )
          : list;
    }
    next[trackKey] = nextByField;
  }
  return next;
}

const sameValue = (a, b) =>
  (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 : a === b);

/**
 * Clean up keyframes that do nothing, for the listed fields of one component
 * track. Playback is unchanged by every removal:
 *   - a key in the middle of a hold (same value as the key before AND after it)
 *     is dropped; the two ends of the hold stay;
 *   - a field that never changes value is not really animated. If that value is
 *     the same as the one stored on the component (`staticValueOf(fieldName)`),
 *     all its keys go and the stored value takes over; otherwise one key stays
 *     so the keyed value keeps winning.
 * Returns the new `keyframes` object (the same object when nothing changed) and
 * the ids that were removed.
 */
export function removeUnusedKeyframes(entity, trackKey, fieldNames, staticValueOf = () => undefined) {
  const all = entity?.keyframes || {};
  const byField = all[trackKey];
  const removedIds = new Set();
  if (!byField) return { keyframes: all, removedIds };

  const nextByField = { ...byField };
  for (const name of fieldNames) {
    const list = byField[name];
    if (!Array.isArray(list) || list.length === 0) continue;
    let kept = list.filter((k, i) => (
      i === 0 || i === list.length - 1
      || !(sameValue(k.value, list[i - 1].value) && sameValue(k.value, list[i + 1].value))
    ));
    if (kept.every((k) => sameValue(k.value, kept[0].value))) {
      const stored = staticValueOf(name);
      kept = stored !== undefined && sameValue(stored, kept[0].value) ? [] : kept.slice(0, 1);
    }
    if (kept.length === list.length) continue;
    const keptIds = new Set(kept.map((k) => k.id));
    for (const k of list) if (!keptIds.has(k.id)) removedIds.add(k.id);
    nextByField[name] = kept;
  }
  if (removedIds.size === 0) return { keyframes: all, removedIds };
  return { keyframes: { ...all, [trackKey]: nextByField }, removedIds };
}

/**
 * A "nice" grid step (1, 2 or 5 x 10^n) so that `range` holds roughly
 * `targetCount` lines. Used for the horizontal value grid.
 */
export function niceStep(range, targetCount = 6) {
  if (!Number.isFinite(range) || range <= 0 || targetCount <= 0) return 1;
  const raw = range / targetCount;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / pow;
  const mult = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return mult * pow;
}

/** Number of decimals needed to print multiples of `step` without noise. */
export function stepDecimals(step) {
  if (!Number.isFinite(step) || step <= 0 || step >= 1) return 0;
  return Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
}