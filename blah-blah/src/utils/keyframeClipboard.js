/**
 * Dopesheet keyframe clipboard (Copy / Cut / Paste / Duplicate).
 *
 * Module-level storage mirroring clipClipboard.js:
 * Keyframes copied in the Dopesheet survive deselecting/re-selecting entities
 * within the same editor session.
 */

let clipboard = null; // { keyframes: Array<{ trackKey, fieldName, keyframe }>, copiedAt: number } | null

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Copy specified keyframe IDs from the entity to the clipboard.
 * Returns the count of copied keyframes.
 */
export function copyKeyframesToClipboard(entity, keyframeIds) {
  const idSet = keyframeIds instanceof Set ? keyframeIds : new Set(keyframeIds);
  if (!entity?.keyframes || idSet.size === 0) return 0;

  const copied = [];
  for (const trackKey of Object.keys(entity.keyframes)) {
    const byField = entity.keyframes[trackKey];
    for (const fieldName of Object.keys(byField)) {
      for (const k of byField[fieldName] || []) {
        if (idSet.has(k.id)) {
          copied.push({
            trackKey,
            fieldName,
            keyframe: clone(k),
          });
        }
      }
    }
  }

  if (copied.length === 0) return 0;
  clipboard = { keyframes: copied, copiedAt: Date.now() };
  return copied.length;
}

/** Check if there are keyframes currently copied. */
export function hasClipboardKeyframes() {
  return !!clipboard && clipboard.keyframes.length > 0;
}

/** Get snapshot of copied keyframes. */
export function getClipboardKeyframes() {
  return clipboard ? clone(clipboard.keyframes) : [];
}

/** Clear keyframe clipboard. */
export function clearKeyframeClipboard() {
  clipboard = null;
}

/**
 * Paste clipboard keyframes onto an entity at targetTime.
 * If targetTrackKey and targetFieldName are specified, single-field keyframes can be pasted into that field.
 * Returns the new keyframes object for the entity.
 */
export function pasteKeyframesOntoEntity(entity, targetTime, targetTrackKey = null, targetFieldName = null) {
  if (!clipboard || clipboard.keyframes.length === 0 || !entity) {
    return entity?.keyframes || {};
  }

  const items = clipboard.keyframes;
  const minTime = Math.min(...items.map((it) => it.keyframe.time));
  const timeOffset = targetTime - minTime;

  // Single-property copy pasted into a specific lane:
  const isSingleSource = new Set(items.map((it) => `${it.trackKey}:${it.fieldName}`)).size === 1;
  const canMapToTarget = isSingleSource && targetTrackKey && targetFieldName;

  const nextKeyframes = clone(entity.keyframes || {});

  items.forEach((it) => {
    const tk = canMapToTarget ? targetTrackKey : it.trackKey;
    const fn = canMapToTarget ? targetFieldName : it.fieldName;

    if (!nextKeyframes[tk]) nextKeyframes[tk] = {};
    if (!nextKeyframes[tk][fn]) nextKeyframes[tk][fn] = [];

    const newTime = Math.max(0, it.keyframe.time + timeOffset);
    const newId = `kf-${tk}-${fn}-${newTime.toFixed(3)}-${Math.random().toString(36).slice(2, 7)}`;

    // Remove any existing keyframe at the exact same timestamp to avoid overlapping dupes
    nextKeyframes[tk][fn] = nextKeyframes[tk][fn].filter(
      (k) => Math.abs(k.time - newTime) > 0.001
    );

    nextKeyframes[tk][fn].push({
      ...clone(it.keyframe),
      id: newId,
      time: newTime,
    });

    nextKeyframes[tk][fn].sort((a, b) => a.time - b.time);
  });

  return nextKeyframes;
}
