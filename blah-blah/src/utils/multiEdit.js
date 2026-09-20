import { isScriptComponent } from '../engine/ecs';
import { trackKeyFor, setKeyframe, getFieldKeyframes, evaluateField } from '../engine/keyframes';
 
/**
 * Multi-clip shared editing helpers (pure functions, no React).
 *
 * Model: when several clips are selected, the Inspector shows only the
 * components that EVERY selected clip has ("same component"), keyed by the
 * same trackKey the keyframe engine uses (`Transform`, `TextRenderer`,
 * `script:<scriptId>`, ...). Editing a field writes the same value to every
 * selected clip in ONE batch (a single undo step).
 *
 * Keyframes: if a field has keyframes on a clip (or Auto Key is on), the
 * value is written as a keyframe at the current time, converted to that
 * clip's own local time (each clip starts at a different startTime).
 */
 
const FPS = 30;
const snapFrame = (t) => Math.round(t * FPS) / FPS;
 
/** The value-holding object for a component: script props live under .props, everything else on the component itself. */
const valuesOf = (comp) => (isScriptComponent(comp) ? (comp.props || {}) : comp);
 
/** Find one clip's component for a trackKey. Transform is synthesized (defaults) when missing, like the single Inspector does. */
export function findComponent(entity, trackKey) {
  if (trackKey === 'Transform') {
    return entity.components?.find((c) => c.type === 'Transform') || null;
  }
  return entity.components?.find((c) => trackKeyFor(c) === trackKey) || null;
}
 
/** Local clip time (seconds from clip start), snapped to a frame. */
export function localTimeFor(entity, currentTime) {
  return snapFrame(Math.max(0, currentTime - entity.startTime));
}
 
/**
 * The value a clip currently shows for a field: the keyframe-evaluated value
 * when animated, otherwise the stored static value, otherwise `fallback`.
 */
export function readFieldValue(entity, trackKey, fieldName, currentTime, fallback) {
  const local = Math.max(0, currentTime - entity.startTime);
  const animated = evaluateField(entity, trackKey, fieldName, local);
  if (animated !== undefined) return animated;
  const comp = findComponent(entity, trackKey);
  const v = comp ? valuesOf(comp)[fieldName] : undefined;
  return v !== undefined ? v : fallback;
}
 
/**
 * Summarize a field across all selected clips.
 * Returns { value, mixed } — `value` is the first clip's value (used as the
 * display value), `mixed` is true when clips disagree.
 */
export function summarizeField(entities, trackKey, fieldName, currentTime, fallback) {
  if (entities.length === 0) return { value: fallback, mixed: false };
  const values = entities.map((e) => readFieldValue(e, trackKey, fieldName, currentTime, fallback));
  const first = values[0];
  const mixed = values.some((v) => !valuesEqual(v, first));
  return { value: first, mixed };
}
 
function valuesEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  return false;
}
 
/**
 * Component trackKeys shared by ALL given clips, in the first clip's
 * component order (Transform is always first and always shared).
 * Each item: { trackKey, comp } where comp is the FIRST clip's component
 * (used for labels / script id lookup).
 */
export function getSharedComponents(entities) {
  if (entities.length === 0) return [];
  const [first, ...rest] = entities;
  const shared = [];
  const seen = new Set();
 
  // Transform: always shared (single Inspector synthesizes it when missing).
  shared.push({ trackKey: 'Transform', comp: findComponent(first, 'Transform') || { type: 'Transform' } });
  seen.add('Transform');
 
  (first.components || []).forEach((c) => {
    const key = trackKeyFor(c);
    if (seen.has(key)) return;
    // Subtitle / transition components carry structured data (phrase lists,
    // preset ids) that has no meaningful "same value for all" edit.
    if (c.type === 'SubtitleTrack' || c.type === 'TransitionComponent') return;
    if (rest.every((e) => (e.components || []).some((oc) => trackKeyFor(oc) === key))) {
      shared.push({ trackKey: key, comp: c });
      seen.add(key);
    }
  });
  return shared;
}
 
/**
 * Build the batch update list for `handleUpdateClips`:
 *   [{ id, updates: { components?, keyframes?, duration? } }, ...]
 *
 * @param {Array}  entities     the selected clips (current state)
 * @param {string} trackKey     which component ('Transform', 'TextRenderer', 'script:<id>', ...)
 * @param {object} patch        { fieldName: value, ... } to write to every clip
 * @param {object} opts         { currentTime, autoKeyEnabled }
 */
export function buildSharedUpdates(entities, trackKey, patch, { currentTime = 0, autoKeyEnabled = false } = {}) {
  const isScriptTrack = trackKey.startsWith('script:');
  const scriptId = isScriptTrack ? trackKey.slice('script:'.length) : null;
 
  return entities.map((entity) => {
    let keyframes = entity.keyframes || {};
    let kfChanged = false;
    const staticPatch = {};
    let durationUpdate = null;
    const local = localTimeFor(entity, currentTime);
 
    Object.keys(patch).forEach((fieldName) => {
      const value = patch[fieldName];
      const tempEntity = { ...entity, keyframes };
      const hasKfs = getFieldKeyframes(tempEntity, trackKey, fieldName).length > 0;
 
      // Animated field (or Auto Key on): write a keyframe at THIS clip's
      // local time — the static prop would be overridden by the evaluator.
      if (hasKfs || autoKeyEnabled) {
        keyframes = setKeyframe(tempEntity, trackKey, fieldName, local, value);
        kfChanged = true;
        return;
      }
 
      staticPatch[fieldName] = value;
 
      // Transform.speed also resizes the clip (same rule as the single
      // Inspector's updateTransform): duration × (oldSpeed / newSpeed).
      if (trackKey === 'Transform' && fieldName === 'speed') {
        const tr = findComponent(entity, 'Transform');
        const oldSpeed = Number(tr?.speed ?? 1) || 1;
        const newSpeed = Number(value) || 1;
        if (oldSpeed > 0 && newSpeed > 0 && oldSpeed !== newSpeed) {
          durationUpdate = Math.max(0.2, (entity.duration || 0) * (oldSpeed / newSpeed));
        }
      }
    });
 
    const updates = {};
    if (kfChanged) updates.keyframes = keyframes;
    if (durationUpdate !== null) updates.duration = durationUpdate;
 
    if (Object.keys(staticPatch).length > 0) {
      const comps = entity.components || [];
      let found = false;
      const nextComps = comps.map((c) => {
        if (isScriptTrack) {
          if (isScriptComponent(c) && c.scriptId === scriptId) {
            found = true;
            return { ...c, props: { ...(c.props || {}), ...staticPatch } };
          }
          return c;
        }
        if (c.type === trackKey) {
          found = true;
          return { ...c, ...staticPatch };
        }
        return c;
      });
      // Legacy clips without a Transform: create it, same as the single Inspector.
      if (!found && trackKey === 'Transform') nextComps.unshift({ type: 'Transform', ...staticPatch });
      updates.components = nextComps;
    }
 
    return { id: entity.id, updates };
  }).filter((u) => Object.keys(u.updates).length > 0);
}
 
/**
 * Component-level (non-keyframeable) fields such as Enabled / text / font /
 * shape type / media volume: written to the component directly for all clips.
 */
export function buildSharedComponentUpdates(entities, trackKey, patch) {
  const isScriptTrack = trackKey.startsWith('script:');
  const scriptId = isScriptTrack ? trackKey.slice('script:'.length) : null;
  return entities.map((entity) => {
    const nextComps = (entity.components || []).map((c) => {
      if (isScriptTrack) {
        return isScriptComponent(c) && c.scriptId === scriptId ? { ...c, ...patch } : c;
      }
      return c.type === trackKey ? { ...c, ...patch } : c;
    });
    return { id: entity.id, updates: { components: nextComps } };
  });
}
 
/** Read a component-level (non-keyframed) field across clips: { value, mixed }. */
export function summarizeComponentField(entities, trackKey, fieldName, fallback) {
  if (entities.length === 0) return { value: fallback, mixed: false };
  const values = entities.map((e) => {
    const c = findComponent(e, trackKey);
    const v = c ? c[fieldName] : undefined;
    return v !== undefined ? v : fallback;
  });
  const first = values[0];
  return { value: first, mixed: values.some((v) => !valuesEqual(v, first)) };
}