/**
 * Keyframe engine — GUI keyframing for Inspector-exposed fields (roadmap P1 #6).
 *
 * Storage shape (added to each entity, alongside `components`):
 *   entity.keyframes = {
 *     [trackKey]: {
 *       [fieldName]: [ { id, time, value, easing }, ... ]  // sorted by time, entity-LOCAL time (seconds from clip start)
 *     }
 *   }
 *
 * `trackKey` identifies which component instance owns the field, using the
 * exact same keying convention UnityInspector.jsx already uses for
 * drag-reorder (`dragKeyFor` there): the component `type` for singleton
 * components ('Transform', 'TextRenderer', ...), or `script:<scriptId>` for
 * script components (the ONE type — ScriptComponent, covering motion /
 * React / Canvas kinds) so multiple scripts on one entity keep
 * independent keyframe tracks. Reusing that key means the Dopesheet can
 * address the same "row" the Inspector already knows how to render (via
 * InspectorFieldList / TRANSFORM_FIELD_GROUPS / extractScriptProps), so
 * every exposed Inspector parameter automatically gets a Dopesheet row
 * with no per-component hand-listing.
 *
 * Evaluation is a pure function of local time — no wall-clock, no mutation
 * of the entity — consistent with the script-driven render contract and
 * the export pipeline's determinism requirement (see roadmap #11).
 */
import { Easing } from './motionTween';
import { isScriptComponent } from './ecs';
 
export const trackKeyFor = (component) =>
  isScriptComponent(component)
    ? `script:${component.scriptId}`
    : component.type;
 
/** Get the sorted keyframe list for one field, or an empty array. */
export function getFieldKeyframes(entity, trackKey, fieldName) {
  return entity?.keyframes?.[trackKey]?.[fieldName] || [];
}
 
/** True if any field on this entity has 2+ keyframes (i.e. is actually animated). */
export function entityHasKeyframes(entity) {
  const byTrack = entity?.keyframes;
  if (!byTrack) return false;
  return Object.values(byTrack).some((byField) =>
    Object.values(byField).some((kfs) => kfs.length > 0)
  );
}function resolveEasing(name) {
  return Easing[name] || Easing.linear;
}

/**
 * Evaluate a cubic bezier curve at parameter t ∈ [0,1].
 * cp1 and cp2 are { x, y } control points where x ∈ [0,1] is time
 * and y ∈ [0,1] is progress (can go outside for overshoot).
 */
function cubicBezier(t, cp1, cp2) {
  // Newton-Raphson to solve for the curve parameter given t
  // The curve is defined by P0=(0,0), P1=cp1, P2=cp2, P3=(1,1)
  const cx = 3 * cp1.x;
  const bx = 3 * (cp2.x - cp1.x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * cp1.y;
  const by = 3 * (cp2.y - cp1.y) - cy;
  const ay = 1 - cy - by;

  // Solve for curveX(t) = t using Newton's method
  let curveT = t;
  for (let i = 0; i < 8; i++) {
    const currentX = ((ax * curveT + bx) * curveT + cx) * curveT;
    const delta = currentX - t;
    if (Math.abs(delta) < 1e-6) break;
    const derivative = (3 * ax * curveT + 2 * bx) * curveT + cx;
    if (Math.abs(derivative) < 1e-6) break;
    curveT -= delta / derivative;
  }
  curveT = Math.max(0, Math.min(1, curveT));

  // Evaluate Y at the solved parameter
  return ((ay * curveT + by) * curveT + cy) * curveT;
}

/**
 * Evaluate a field's animated value at local time `t` (seconds from clip
 * start). Returns `undefined` when there are no keyframes for this field,
 * so callers can fall back to the field's static prop value unchanged —
 * keyframing a field is opt-in per field, not all-or-nothing per entity.
 *
 * Supports custom cubic bezier curves: if a keyframe has cp1/cp2 control
 * points, those are used instead of the named easing function.
 */
export function evaluateField(entity, trackKey, fieldName, t) {
  const kfs = getFieldKeyframes(entity, trackKey, fieldName);
  if (kfs.length === 0) return undefined;
  if (kfs.length === 1) return kfs[0].value;

  if (t <= kfs[0].time) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (t >= last.time) return last.value;

  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time;
      const localT = span <= 0 ? 1 : (t - a.time) / span;
      let eased;
      // Easing/curve is stored on the "from" keyframe (a) — the keyframe
      // the user is leaving, not the one they're arriving at. Custom bezier
      // curve (cp1/cp2) takes priority over the named easing preset.
      if (a.cp1 && a.cp2) {
        eased = cubicBezier(Math.max(0, Math.min(1, localT)), a.cp1, a.cp2);
      } else {
        eased = resolveEasing(a.easing)(Math.max(0, Math.min(1, localT)));
      }
      if (typeof a.value === 'number' && typeof b.value === 'number') {
        return a.value + (b.value - a.value) * eased;
      }
      // Non-numeric fields (color/select/boolean/string) can't be
      // interpolated — hold the earlier keyframe's value until the next one.
      return eased < 1 ? a.value : b.value;
    }
  }
  return last.value;
}

/**
 * Get the curve segment between two consecutive keyframes.
 * Returns { a, b, cp1, cp2 } where cp1/cp2 are the bezier control points
 * (falling back to defaults derived from the easing preset if none set).
 */
export function getCurveSegment(a, b) {
  if (a && b) {
    // If custom bezier curve is set, use it directly.
    // Otherwise derive approximate bezier from the named easing preset.
    const bezier = (a.cp1 && a.cp2)
      ? { cp1: a.cp1, cp2: a.cp2 }
      : easingToBezier(a.easing || 'linear');
    return {
      a,
      b,
      cp1: bezier.cp1,
      cp2: bezier.cp2,
      easing: a.easing || 'linear',
    };
  }
  return null;
}

/**
 * Approximate cubic bezier control points for each named easing.
 * Used by the Curve Editor to visualize named easings as curves.
 */
const EASING_TO_BEZIER = {
  linear:      { cp1: { x: 0.25, y: 0.25 }, cp2: { x: 0.75, y: 0.75 } },
  inQuad:      { cp1: { x: 0.55, y: 0.085 }, cp2: { x: 0.68, y: 0.53 } },
  outQuad:     { cp1: { x: 0.25, y: 0.46 }, cp2: { x: 0.45, y: 0.94 } },
  inOutQuad:   { cp1: { x: 0.455, y: 0.03 }, cp2: { x: 0.515, y: 0.955 } },
  inCubic:     { cp1: { x: 0.55, y: 0.055 }, cp2: { x: 0.675, y: 0.19 } },
  outCubic:    { cp1: { x: 0.215, y: 0.61 }, cp2: { x: 0.355, y: 1 } },
  inOutCubic:  { cp1: { x: 0.645, y: 0.045 }, cp2: { x: 0.355, y: 1 } },
  inSine:      { cp1: { x: 0.47, y: 0 }, cp2: { x: 0.735, y: 0.085 } },
  outSine:     { cp1: { x: 0.39, y: 0.575 }, cp2: { x: 0.565, y: 1 } },
  inOutSine:   { cp1: { x: 0.445, y: 0.05 }, cp2: { x: 0.55, y: 0.95 } },
  inBack:      { cp1: { x: 0.6, y: -0.28 }, cp2: { x: 0.735, y: 0.045 } },
  outBack:     { cp1: { x: 0.175, y: 0.885 }, cp2: { x: 0.32, y: 1.275 } },
  inOutBack:   { cp1: { x: 0.68, y: -0.55 }, cp2: { x: 0.265, y: 1.55 } },
  inBounce:    { cp1: { x: 0.36, y: 0 }, cp2: { x: 0.66, y: -0.56 } },
  outBounce:   { cp1: { x: 0.22, y: 1.36 }, cp2: { x: 0.36, y: 1 } },
  inOutBounce: { cp1: { x: 0.68, y: -0.6 }, cp2: { x: 0.32, y: 1.6 } },
  inElastic:   { cp1: { x: 0.5, y: -0.5 }, cp2: { x: 0.5, y: 1.2 } },
  outElastic:  { cp1: { x: 0.5, y: -0.2 }, cp2: { x: 0.5, y: 1.5 } },
  inOutElastic:{ cp1: { x: 0.5, y: -0.6 }, cp2: { x: 0.5, y: 1.6 } },
};

/**
 * Get approximate bezier control points for a named easing.
 * Falls back to linear if the easing name isn't mapped.
 */
export function easingToBezier(easingName) {
  return EASING_TO_BEZIER[easingName] || EASING_TO_BEZIER.linear;
}

/** Preset curve shapes for the curve editor */
export const CURVE_PRESETS = [
  { name: 'Linear',    cp1: { x: 0.25, y: 0.25 }, cp2: { x: 0.75, y: 0.75 } },
  { name: 'Ease In',   cp1: { x: 0.42, y: 0    }, cp2: { x: 1    , y: 1     } },
  { name: 'Ease Out',  cp1: { x: 0    , y: 0    }, cp2: { x: 0.58, y: 1      } },
  { name: 'Ease In Out', cp1: { x: 0.42, y: 0  }, cp2: { x: 0.58, y: 1      } },
  { name: 'Sharp In',  cp1: { x: 0.7 , y: 0    }, cp2: { x: 1    , y: 1      } },
  { name: 'Sharp Out', cp1: { x: 0    , y: 0    }, cp2: { x: 0.3 , y: 1      } },
  { name: 'Snap',      cp1: { x: 0.05, y: 0.9  }, cp2: { x: 0.1  , y: 1      } },
  { name: 'Elastic In', cp1: { x: 0.5 , y: -0.4 }, cp2: { x: 0.6  , y: 1.2    } },
  { name: 'Bounce Out', cp1: { x: 0.2 , y: 1.2  }, cp2: { x: 0.4  , y: 0.8    } },
  { name: 'Overshoot', cp1: { x: 0.15, y: 1.2  }, cp2: { x: 0.3  , y: 1      } },
  { name: 'Anticipate', cp1: { x: 0.35, y: -0.2 }, cp2: { x: 0.65, y: 1      } },
  { name: 'Smooth',    cp1: { x: 0.25, y: 0.1  }, cp2: { x: 0.25, y: 1      } },
  { name: 'Spring',    cp1: { x: 0.17, y: 0.67 }, cp2: { x: 0.68, y: -0.33 } },
];
 
/**
 * Evaluate every keyframed field on an entity at local time `t`, merged
 * over the entity's static component props. Returns a new `components`
 * array — does not mutate `entity`. Call once per render tick alongside
 * transform/prop resolution (mirrors updateCanvasComponent's per-tick
 * `props` merge in canvasRunner.js).
 */
export function resolveKeyframedComponents(entity, t) {
  if (!entity?.keyframes) return entity.components;
  return entity.components.map((comp) => {
    const trackKey = trackKeyFor(comp);
    const byField = entity.keyframes[trackKey];
    if (!byField) return comp;
 
    const isTransform = comp.type === 'Transform';
    const overrides = {};
    let propOverrides = null;
 
    Object.keys(byField).forEach((fieldName) => {
      const val = evaluateField(entity, trackKey, fieldName, t);
      if (val === undefined) return;
      if (isTransform) {
        overrides[fieldName] = val;
      } else {
        propOverrides = propOverrides || { ...(comp.props || {}) };
        propOverrides[fieldName] = val;
      }
    });
 
    if (isTransform && Object.keys(overrides).length > 0) {
      return { ...comp, ...overrides };
    }
    if (propOverrides) {
      return { ...comp, props: propOverrides };
    }
    return comp;
  });
}
 
/** Add or move a keyframe at `time` for a field, replacing one already at that exact time (snapped to whole frames upstream). */
export function setKeyframe(entity, trackKey, fieldName, time, value, easing = 'linear') {
  const keyframes = entity.keyframes || {};
  const byField = { ...(keyframes[trackKey] || {}) };
  const existing = byField[fieldName] || [];
  const withoutSameTime = existing.filter((k) => k.time !== time);
  const id = `kf-${trackKey}-${fieldName}-${time}-${Math.random().toString(36).slice(2, 8)}`;
  const next = [...withoutSameTime, { id, time, value, easing }].sort((a, b) => a.time - b.time);
  byField[fieldName] = next;
  return { ...keyframes, [trackKey]: byField };
}
 
/** Remove a single keyframe by id. */
export function removeKeyframe(entity, trackKey, fieldName, keyframeId) {
  const keyframes = entity.keyframes || {};
  const byField = { ...(keyframes[trackKey] || {}) };
  byField[fieldName] = (byField[fieldName] || []).filter((k) => k.id !== keyframeId);
  return { ...keyframes, [trackKey]: byField };
}
 
/** Move an existing keyframe to a new time (drag in the Dopesheet). */
export function moveKeyframe(entity, trackKey, fieldName, keyframeId, newTime) {
  const keyframes = entity.keyframes || {};
  const byField = { ...(keyframes[trackKey] || {}) };
  const list = byField[fieldName] || [];
  const moved = list.find((k) => k.id === keyframeId);
  if (!moved) return keyframes;
  const rest = list.filter((k) => k.id !== keyframeId && k.time !== newTime);
  byField[fieldName] = [...rest, { ...moved, time: newTime }].sort((a, b) => a.time - b.time);
  return { ...keyframes, [trackKey]: byField };
}

/** Change the easing preset of a single keyframe. */
export function setKeyframeEasing(entity, trackKey, fieldName, keyframeId, easing) {
  const keyframes = entity.keyframes || {};
  const byField = { ...(keyframes[trackKey] || {}) };
  const list = byField[fieldName] || [];
  byField[fieldName] = list.map((k) => k.id === keyframeId ? { ...k, easing } : k);
  return { ...keyframes, [trackKey]: byField };
}

/** Set custom bezier control points on a keyframe (or clear them). */
export function setKeyframeCurve(entity, trackKey, fieldName, keyframeId, cp1, cp2) {
  const keyframes = entity.keyframes || {};
  const byField = { ...(keyframes[trackKey] || {}) };
  const list = byField[fieldName] || [];
  byField[fieldName] = list.map((k) => {
    if (k.id !== keyframeId) return k;
    if (cp1 && cp2) {
      return { ...k, cp1, cp2 };
    }
    // Clear custom curve
    const { cp1: _, cp2: __, ...rest } = k;
    return rest;
  });
  return { ...keyframes, [trackKey]: byField };
}

/** Get the list of all available easing preset names. */
export const EASING_PRESETS = Object.keys(Easing);
 