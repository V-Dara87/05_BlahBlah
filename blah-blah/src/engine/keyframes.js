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
 * components ('Transform', 'ReactRenderer', 'CanvasRenderer', ...), or
 * `script:<scriptId>` for ScriptComponent/MonoBehaviour so multiple motion
 * scripts on one entity keep independent keyframe tracks. Reusing that key
 * means the Dopesheet can address the same "row" the Inspector already
 * knows how to render (via InspectorFieldList / TRANSFORM_FIELD_GROUPS /
 * extractScriptProps), so every exposed Inspector parameter automatically
 * gets a Dopesheet row with no per-component hand-listing.
 *
 * Evaluation is a pure function of local time — no wall-clock, no mutation
 * of the entity — consistent with the CanvasRenderer/#2 contract and the
 * export pipeline's determinism requirement (see roadmap #11).
 */
import { Easing } from './motionTween';
 
export const trackKeyFor = (component) =>
  (component.type === 'ScriptComponent' || component.type === 'MonoBehaviour')
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
}
 
function resolveEasing(name) {
  return Easing[name] || Easing.linear;
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
      const eased = resolveEasing(b.easing)(Math.max(0, Math.min(1, localT)));
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
 