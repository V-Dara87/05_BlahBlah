/**
 * Keyframe engine — GUI keyframing for Inspector-exposed fields (roadmap P1 #6).
 *
 * Storage shape (added to each entity, alongside `components`):
 *   entity.keyframes = {
 *     [trackKey]: {
 *       [fieldName]: [ { id, time, value, cp1?, cp2? }, ... ]  // sorted by time, entity-LOCAL time (seconds from clip start)
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
 *
 * Interpolation: every segment is a cubic bezier defined by cp1/cp2 stored
 * on the "from" keyframe (the one the user is leaving). A keyframe with no
 * cp1/cp2 set defaults to a straight linear ramp (see DEFAULT_CP1/CP2
 * below) — so plain keyframing without ever touching the Curves tab
 * behaves exactly like the old linear-only engine.
 */
import { isScriptComponent } from './ecs.js';
 
export const trackKeyFor = (component) =>
  isScriptComponent(component)
    ? `script:${component.scriptId}`
    : component.type;
 
/** Default control points — a straight line (linear interpolation). */
export const DEFAULT_CP1 = { x: 0.25, y: 0.25 };
export const DEFAULT_CP2 = { x: 0.75, y: 0.75 };
 
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
}
 
/**
 * Evaluate a cubic bezier curve at parameter t ∈ [0,1].
 * cp1 and cp2 are { x, y } control points where x ∈ [0,1] is time
 * and y ∈ [0,1] is progress (can go outside for overshoot).
 * Uses Newton-Raphson to solve for the curve parameter given t.
 */
function cubicBezier(t, cp1, cp2) {
  const cx = 3 * cp1.x;
  const bx = 3 * (cp2.x - cp1.x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * cp1.y;
  const by = 3 * (cp2.y - cp1.y) - cy;
  const ay = 1 - cy - by;
 
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
 
  return ((ay * curveT + by) * curveT + cy) * curveT;
}
 
/**
 * Evaluate a field's animated value at local time `t` (seconds from clip
 * start). Returns `undefined` when there are no keyframes for this field,
 * so callers can fall back to the field's static prop value unchanged —
 * keyframing a field is opt-in per field, not all-or-nothing per entity.
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
      const clampedT = Math.max(0, Math.min(1, localT));
      // Curve/easing is stored on the "from" keyframe (a) — the keyframe
      // the user is leaving, not the one they're arriving at.
      const cp1 = a.cp1 || DEFAULT_CP1;
      const cp2 = a.cp2 || DEFAULT_CP2;
      const eased = cubicBezier(clampedT, cp1, cp2);
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
 * Returns { a, b, cp1, cp2 } — cp1/cp2 come from keyframe `a` (falling
 * back to the default linear control points if unset).
 */
export function getCurveSegment(a, b) {
  if (a && b) {
    return {
      a,
      b,
      cp1: a.cp1 || DEFAULT_CP1,
      cp2: a.cp2 || DEFAULT_CP2,
    };
  }
  return null;
}
 
/** Preset curve shapes for the curve editor. */
export const CURVE_PRESETS = [
  { name: 'Linear',      cp1: { x: 0.25, y: 0.25 }, cp2: { x: 0.75, y: 0.75 } },
  { name: 'Ease In',     cp1: { x: 0.42, y: 0    }, cp2: { x: 1,    y: 1    } },
  { name: 'Ease Out',    cp1: { x: 0,    y: 0    }, cp2: { x: 0.58, y: 1    } },
  { name: 'Ease In Out', cp1: { x: 0.42, y: 0    }, cp2: { x: 0.58, y: 1    } },
  { name: 'Sharp In',    cp1: { x: 0.7,  y: 0    }, cp2: { x: 1,    y: 1    } },
  { name: 'Sharp Out',   cp1: { x: 0,    y: 0    }, cp2: { x: 0.3,  y: 1    } },
  { name: 'Snap',        cp1: { x: 0.05, y: 0.9  }, cp2: { x: 0.1,  y: 1    } },
  { name: 'Elastic In',  cp1: { x: 0.5,  y: -0.4 }, cp2: { x: 0.6,  y: 1.2  } },
  { name: 'Bounce Out',  cp1: { x: 0.2,  y: 1.2  }, cp2: { x: 0.4,  y: 0.8  } },
  { name: 'Overshoot',   cp1: { x: 0.15, y: 1.2  }, cp2: { x: 0.3,  y: 1    } },
  { name: 'Anticipate',  cp1: { x: 0.35, y: -0.2 }, cp2: { x: 0.65, y: 1    } },
  { name: 'Smooth',      cp1: { x: 0.25, y: 0.1  }, cp2: { x: 0.25, y: 1    } },
  { name: 'Spring',      cp1: { x: 0.17, y: 0.67 }, cp2: { x: 0.68, y: -0.33 } },
];

/**
 * The six curves used most often while blocking an animation. Keep this
 * deliberately small: it powers the one-click choices in the Curves panel,
 * while CURVE_PRESETS remains the complete library for expressive motion.
 */
export const QUICK_CURVE_PRESETS = [
  'Linear',
  'Ease In',
  'Ease Out',
  'Ease In Out',
  'Snap',
  'Bounce Out',
].map((name) => CURVE_PRESETS.find((preset) => preset.name === name));
 
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
 
    const isScript = isScriptComponent(comp);
    const overrides = {};
    let propOverrides = null;

    Object.keys(byField).forEach((fieldName) => {
      const val = evaluateField(entity, trackKey, fieldName, t);
      if (val === undefined) return;
      if (isScript) {
        propOverrides = propOverrides || { ...(comp.props || {}) };
        propOverrides[fieldName] = val;
      } else {
        // Transform, TextRenderer, ShapeRenderer, … — values live on the
        // component itself, not under `.props`.
        overrides[fieldName] = val;
      }
    });

    if (Object.keys(overrides).length > 0) {
      return { ...comp, ...overrides };
    }
    if (propOverrides) {
      return { ...comp, props: propOverrides };
    }
    return comp;
  });
}
 
/** Add or move a keyframe at `time` for a field, replacing one already at that exact time (snapped to whole frames upstream). */
export function setKeyframe(entity, trackKey, fieldName, time, value) {
  const keyframes = entity.keyframes || {};
  const byField = { ...(keyframes[trackKey] || {}) };
  const existing = byField[fieldName] || [];
  const withoutSameTime = existing.filter((k) => k.time !== time);
  const id = `kf-${trackKey}-${fieldName}-${time}-${Math.random().toString(36).slice(2, 8)}`;
  const next = [...withoutSameTime, { id, time, value }].sort((a, b) => a.time - b.time);
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
 
/** Remove multiple keyframes by their IDs (Set or Array). */
export function removeKeyframesByIds(entity, keyframeIds) {
  const idSet = keyframeIds instanceof Set ? keyframeIds : new Set(keyframeIds);
  if (idSet.size === 0 || !entity?.keyframes) return entity?.keyframes || {};

  const keyframes = entity.keyframes;
  const nextKeyframes = {};
  for (const trackKey of Object.keys(keyframes)) {
    const byField = keyframes[trackKey];
    const nextByField = {};
    for (const fieldName of Object.keys(byField)) {
      const list = byField[fieldName] || [];
      nextByField[fieldName] = list.filter((k) => !idSet.has(k.id));
    }
    nextKeyframes[trackKey] = nextByField;
  }
  return nextKeyframes;
}

/** Move multiple keyframes by time delta dt with optional snap and clamp (maintains relative spacing). */
export function moveKeyframesDelta(entity, keyframeIds, deltaT, snapFn = (t) => t) {
  const idSet = keyframeIds instanceof Set ? keyframeIds : new Set(keyframeIds);
  if (idSet.size === 0 || !entity?.keyframes) return entity?.keyframes || {};

  let minTime = Infinity;
  for (const trackKey of Object.keys(entity.keyframes)) {
    const byField = entity.keyframes[trackKey];
    for (const fieldName of Object.keys(byField)) {
      for (const k of byField[fieldName] || []) {
        if (idSet.has(k.id)) {
          if (k.time < minTime) minTime = k.time;
        }
      }
    }
  }
  if (!Number.isFinite(minTime)) return entity.keyframes;

  let effectiveDelta = deltaT;
  if (minTime + effectiveDelta < 0) {
    effectiveDelta = -minTime;
  }

  const keyframes = entity.keyframes;
  const nextKeyframes = {};
  for (const trackKey of Object.keys(keyframes)) {
    const byField = keyframes[trackKey];
    const nextByField = {};
    for (const fieldName of Object.keys(byField)) {
      const list = byField[fieldName] || [];
      const updated = list.map((k) => {
        if (!idSet.has(k.id)) return k;
        const newTime = Math.max(0, snapFn(k.time + effectiveDelta));
        return { ...k, time: newTime };
      });
      nextByField[fieldName] = updated.sort((a, b) => a.time - b.time);
    }
    nextKeyframes[trackKey] = nextByField;
  }
  return nextKeyframes;
}

/** Set custom bezier control points on a keyframe (or clear them back to default linear). */
export function setKeyframeCurve(entity, trackKey, fieldName, keyframeId, cp1, cp2) {
  const keyframes = entity.keyframes || {};
  const byField = { ...(keyframes[trackKey] || {}) };
  const list = byField[fieldName] || [];
  byField[fieldName] = list.map((k) => {
    if (k.id !== keyframeId) return k;
    if (cp1 && cp2) {
      return { ...k, cp1, cp2 };
    }
    const { cp1: _, cp2: __, ...rest } = k;
    return rest;
  });
  return { ...keyframes, [trackKey]: byField };
}
 
/**
 * Find a keyframe anywhere on an entity by its id, without already
 * knowing which track/field it lives on. Used by the Curves dock tab,
 * which only receives the bare selectedKeyId (shared with the Dopesheet
 * via EditorContext) and needs the full keyframe object + its track/field
 * to render and edit its curve.
 *
 * Returns { trackKey, fieldName, keyframe, index, list } or null.
 */
export function findKeyframeById(entity, keyframeId) {
  if (!entity?.keyframes || !keyframeId) return null;
  for (const trackKey of Object.keys(entity.keyframes)) {
    const byField = entity.keyframes[trackKey];
    for (const fieldName of Object.keys(byField)) {
      const list = byField[fieldName];
      const index = list.findIndex((k) => k.id === keyframeId);
      if (index !== -1) {
        return { trackKey, fieldName, keyframe: list[index], index, list };
      }
    }
  }
  return null;
}
