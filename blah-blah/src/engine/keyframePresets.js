/**
 * Keyframe presets — save keyframes from one clip as a reusable file / library
 * entry and apply them to another clip. Pure functions (no DOM, no storage) so
 * the rules can be unit-tested; the Dopesheet's Presets menu does the I/O.
 *
 * A preset can hold keyframes of SEVERAL parameters and SEVERAL components:
 *   {
 *     format: 'blahblah-keyframe-preset', version: 1,
 *     id, name, createdAt, duration,              // duration = span of the keys (s)
 *     tracks: [{
 *       trackKey, type, label,                    // the component it came from
 *       componentIndex,                           // its position on the source clip
 *       fields: [{
 *         name, label,
 *         fieldIndex,                             // its position in the component's parameter list
 *         keyframes: [{ time, value, cp1?, cp2? }]  // time is RELATIVE to the first key
 *       }]
 *     }]
 *   }
 *
 * A "target" describes one component of the clip a preset is applied to, in the
 * order the Dopesheet lists them:
 *   { trackKey, type, label, fields: [{ name, label?, defaultVal? }] }
 *
 * How a preset is matched to a clip (planPresetApply):
 *   1. Same component (same trackKey: 'Transform', 'script:<id>', ...) -> its
 *      parameters are matched BY NAME and applied as they are.
 *   2. A component the clip does not have is reported as a warning.
 *   3. With `byPosition`, such a component is applied to the component at the same
 *      position on the clip (index 0 -> index 0), and its parameters by index
 *      (parameter 0 -> parameter 0), as long as the value types agree.
 */

export const PRESET_FORMAT = 'blahblah-keyframe-preset';
export const PRESET_VERSION = 1;

const clone = (v) => JSON.parse(JSON.stringify(v));
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isCp = (cp) => cp && isFiniteNum(cp.x) && isFiniteNum(cp.y);
const isValue = (v) => isFiniteNum(v) || typeof v === 'string' || typeof v === 'boolean';

const newId = () => `kfp-${crypto.randomUUID().slice(0, 12)}`;

/**
 * Build a preset from the selected keyframes of `entity`. `targets` gives the
 * component and parameter ORDER of that clip (it is what the indices are taken
 * from). Returns null when none of the ids is found.
 */
export function createKeyframePreset(entity, keyframeIds, targets, name) {
  const ids = keyframeIds instanceof Set ? keyframeIds : new Set(keyframeIds);
  const tracks = [];
  let minTime = Infinity;
  let maxTime = -Infinity;

  targets.forEach((target, componentIndex) => {
    const fields = [];
    target.fields.forEach((field, fieldIndex) => {
      const list = entity?.keyframes?.[target.trackKey]?.[field.name] || [];
      const keys = list.filter((k) => ids.has(k.id));
      if (keys.length === 0) return;
      for (const k of keys) {
        if (k.time < minTime) minTime = k.time;
        if (k.time > maxTime) maxTime = k.time;
      }
      fields.push({ name: field.name, label: field.label || field.name, fieldIndex, keys });
    });
    if (fields.length > 0) {
      tracks.push({
        trackKey: target.trackKey,
        type: target.type,
        label: target.label || target.type,
        componentIndex,
        fields,
      });
    }
  });
  if (tracks.length === 0) return null;

  return {
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    id: newId(),
    name: String(name || '').trim() || 'Keyframe preset',
    createdAt: Date.now(),
    duration: round6(maxTime - minTime),
    tracks: tracks.map((t) => ({
      ...t,
      fields: t.fields.map(({ keys, ...f }) => ({
        ...f,
        keyframes: keys.map((k) => {
          const out = { time: round6(k.time - minTime), value: k.value };
          if (isCp(k.cp1) && isCp(k.cp2)) {
            out.cp1 = { x: k.cp1.x, y: k.cp1.y };
            out.cp2 = { x: k.cp2.x, y: k.cp2.y };
          }
          return out;
        }),
      })),
    })),
  };
}

/** How many keyframes / parameters / components a preset holds (for the list UI). */
export function presetStats(preset) {
  let keys = 0;
  let params = 0;
  for (const t of preset.tracks) {
    for (const f of t.fields) {
      params += 1;
      keys += f.keyframes.length;
    }
  }
  return { keys, params, components: preset.tracks.length };
}

/**
 * Decide where each part of `preset` would go on a clip.
 * Returns { items, issues, unmatchedTracks }:
 *   items   [{ trackKey, fieldName, keyframes, from, to, via: 'same' | 'position' }]
 *   issues  [{ kind: 'missing-component' | 'missing-field' | 'type-mismatch' | 'position-taken', message }]
 *   unmatchedTracks  how many components of the preset the clip does not have
 *                    (position mapping can only help when this is > 0)
 */
export function planPresetApply(preset, targets, { byPosition = false } = {}) {
  const items = [];
  const issues = [];
  const used = new Set();
  const pending = [];

  const mapFields = (track, target, mode) => {
    for (const field of track.fields) {
      const from = `${track.label} › ${field.label || field.name}`;
      const tf = mode === 'same'
        ? target.fields.find((f) => f.name === field.name)
        : target.fields[field.fieldIndex];
      if (!tf) {
        issues.push({
          kind: 'missing-field',
          message: mode === 'same'
            ? `"${field.label || field.name}" does not exist on ${target.label || target.type}.`
            : `${target.label || target.type} has no parameter at position ${field.fieldIndex + 1} for "${field.label || field.name}".`,
        });
        continue;
      }
      const sample = field.keyframes[0]?.value;
      if (tf.defaultVal !== undefined && sample !== undefined && typeof tf.defaultVal !== typeof sample) {
        issues.push({
          kind: 'type-mismatch',
          message: `${from} holds ${typeof sample} values but ${target.label || target.type} › ${tf.label || tf.name} takes ${typeof tf.defaultVal}.`,
        });
        continue;
      }
      items.push({
        trackKey: target.trackKey,
        fieldName: tf.name,
        keyframes: field.keyframes,
        from,
        to: `${target.label || target.type} › ${tf.label || tf.name}`,
        via: mode,
      });
    }
  };

  for (const track of preset.tracks) {
    const target = targets.find((t) => t.trackKey === track.trackKey);
    if (!target) {
      pending.push(track);
      continue;
    }
    used.add(target.trackKey);
    mapFields(track, target, 'same');
  }

  for (const track of pending) {
    if (!byPosition) {
      issues.push({
        kind: 'missing-component',
        message: `This clip has no "${track.label}" component.`,
      });
      continue;
    }
    const target = targets[track.componentIndex];
    if (!target) {
      issues.push({
        kind: 'missing-component',
        message: `"${track.label}" was component ${track.componentIndex + 1}, but this clip has only ${targets.length}.`,
      });
    } else if (used.has(target.trackKey)) {
      issues.push({
        kind: 'position-taken',
        message: `"${track.label}" would go onto ${target.label || target.type}, which already receives another part of the preset.`,
      });
    } else {
      used.add(target.trackKey);
      mapFields(track, target, 'position');
    }
  }

  return { items, issues, unmatchedTracks: pending.length };
}

/**
 * Write a plan's keyframes onto `entity`, starting at `startTime` (the preset's
 * first key lands there). A key already at the same time on a parameter is
 * replaced. Returns { keyframes, count } — the entity's new `keyframes` object.
 */
export function applyPresetPlan(entity, items, startTime) {
  const next = clone(entity?.keyframes || {});
  let count = 0;
  for (const item of items) {
    if (!next[item.trackKey]) next[item.trackKey] = {};
    let list = next[item.trackKey][item.fieldName] || [];
    for (const key of item.keyframes) {
      const time = Math.max(0, startTime + key.time);
      list = list.filter((k) => Math.abs(k.time - time) > 0.001);
      list.push({
        ...clone(key),
        id: `kf-${item.trackKey}-${item.fieldName}-${time.toFixed(3)}-${crypto.randomUUID().slice(0, 8)}`,
        time,
      });
      count += 1;
    }
    next[item.trackKey][item.fieldName] = list.sort((a, b) => a.time - b.time);
  }
  return { keyframes: next, count };
}

/** Validate and clean one preset read from a file. Returns null when unusable. */
export function normalizePreset(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tracks)) return null;
  const tracks = [];
  for (const t of raw.tracks) {
    if (!t || typeof t.trackKey !== 'string' || !Array.isArray(t.fields)) continue;
    const fields = [];
    for (const f of t.fields) {
      if (!f || typeof f.name !== 'string' || !Array.isArray(f.keyframes)) continue;
      const keyframes = f.keyframes
        .filter((k) => k && isFiniteNum(k.time) && k.time >= 0 && isValue(k.value))
        .map((k) => {
          const out = { time: k.time, value: k.value };
          if (isCp(k.cp1) && isCp(k.cp2)) {
            out.cp1 = { x: k.cp1.x, y: k.cp1.y };
            out.cp2 = { x: k.cp2.x, y: k.cp2.y };
          }
          return out;
        })
        .sort((a, b) => a.time - b.time);
      if (keyframes.length === 0) continue;
      fields.push({
        name: f.name,
        label: typeof f.label === 'string' ? f.label : f.name,
        fieldIndex: Number.isInteger(f.fieldIndex) && f.fieldIndex >= 0 ? f.fieldIndex : 0,
        keyframes,
      });
    }
    if (fields.length === 0) continue;
    tracks.push({
      trackKey: t.trackKey,
      type: typeof t.type === 'string' ? t.type : t.trackKey,
      label: typeof t.label === 'string' ? t.label : t.trackKey,
      componentIndex: Number.isInteger(t.componentIndex) && t.componentIndex >= 0 ? t.componentIndex : 0,
      fields,
    });
  }
  if (tracks.length === 0) return null;
  const span = tracks.flatMap((t) => t.fields.flatMap((f) => f.keyframes.map((k) => k.time)));
  return {
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    id: newId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Imported preset',
    createdAt: isFiniteNum(raw.createdAt) ? raw.createdAt : Date.now(),
    duration: round6(Math.max(...span) - Math.min(...span)),
    tracks,
  };
}

/** Text of a preset file holding one or more presets. */
export function serializePresets(presets) {
  return JSON.stringify({ format: PRESET_FORMAT, version: PRESET_VERSION, presets }, null, 2);
}

/**
 * Read a preset file: a file written by serializePresets, a bare preset, or an
 * array of presets. Throws an Error with a readable message when nothing usable
 * is in it. Every returned preset gets a fresh id.
 */
export function parsePresetFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const rawList = Array.isArray(data) ? data : Array.isArray(data?.presets) ? data.presets : [data];
  const presets = rawList.map(normalizePreset).filter(Boolean);
  if (presets.length === 0) throw new Error('No keyframe presets found in that file.');
  return presets;
}