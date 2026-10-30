import crypto from 'node:crypto';
import { findEntity } from './entities.js';

export const CURVE_PRESETS = {
  linear: { name: 'Linear', cp1: { x: 0.25, y: 0.25 }, cp2: { x: 0.75, y: 0.75 } },
  easeIn: { name: 'Ease In', cp1: { x: 0.42, y: 0 }, cp2: { x: 1, y: 1 } },
  easeOut: { name: 'Ease Out', cp1: { x: 0, y: 0 }, cp2: { x: 0.58, y: 1 } },
  easeInOut: { name: 'Ease In Out', cp1: { x: 0.42, y: 0 }, cp2: { x: 0.58, y: 1 } },
  snap: { name: 'Snap', cp1: { x: 0.05, y: 0.9 }, cp2: { x: 0.1, y: 1 } },
  bounce: { name: 'Bounce Out', cp1: { x: 0.2, y: 1.2 }, cp2: { x: 0.4, y: 0.8 } },
  overshoot: { name: 'Overshoot', cp1: { x: 0.15, y: 1.2 }, cp2: { x: 0.3, y: 1 } },
};

// Numeric strings (from the CLI) become numbers; booleans, colors and other
// strings are kept as they are. `Number(true)` and `Number('')` must not turn
// into 1 and 0.
function coerceKeyframeValue(value) {
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return value;
}

export function addKeyframe(
  project,
  entityId,
  {
    trackKey = 'Transform',
    field,
    time = 0,
    value,
    ease = 'linear',
  } = {}
) {
  const entity = findEntity(project, entityId);
  if (!entity) {
    throw new Error(`Entity "${entityId}" not found.`);
  }

  if (!field) {
    throw new Error('Keyframe field name is required (e.g. x, y, scaleX, opacity).');
  }

  entity.keyframes = entity.keyframes || {};
  entity.keyframes[trackKey] = entity.keyframes[trackKey] || {};
  const fieldList = entity.keyframes[trackKey][field] || [];

  if (!Object.prototype.hasOwnProperty.call(CURVE_PRESETS, ease)) {
    throw new Error(
      `Unknown ease "${ease}". Use one of: ${Object.keys(CURVE_PRESETS).join(', ')}.`
    );
  }
  const preset = CURVE_PRESETS[ease];
  const timeNum = Number(time);
  if (!Number.isFinite(timeNum) || timeNum < 0) {
    throw new Error(`Keyframe time must be a number >= 0 (got ${JSON.stringify(time)}).`);
  }
  if (value === undefined || value === null || value === '') {
    throw new Error('Keyframe value is required.');
  }
  const withoutSameTime = fieldList.filter((k) => k.time !== timeNum);

  const kfId = `kf-${trackKey}-${field}-${timeNum}-${crypto.randomUUID().slice(0, 6)}`;
  const newKf = {
    id: kfId,
    time: timeNum,
    value: coerceKeyframeValue(value),
    cp1: preset.cp1,
    cp2: preset.cp2,
  };

  entity.keyframes[trackKey][field] = [...withoutSameTime, newKf].sort((a, b) => a.time - b.time);
  return newKf;
}

export function removeKeyframes(project, entityId, keyframeIds) {
  const entity = findEntity(project, entityId);
  if (!entity) {
    throw new Error(`Entity "${entityId}" not found.`);
  }

  const idsToRemove = new Set(Array.isArray(keyframeIds) ? keyframeIds : [keyframeIds]);
  const keyframes = entity.keyframes || {};
  let removedCount = 0;

  for (const trackKey of Object.keys(keyframes)) {
    const byField = keyframes[trackKey];
    for (const field of Object.keys(byField)) {
      const before = byField[field] || [];
      const after = before.filter((k) => !idsToRemove.has(k.id));
      removedCount += before.length - after.length;
      byField[field] = after;
    }
  }

  return { removedCount };
}

export function listKeyframes(project, entityId) {
  const entity = findEntity(project, entityId);
  if (!entity) {
    throw new Error(`Entity "${entityId}" not found.`);
  }

  return entity.keyframes || {};
}