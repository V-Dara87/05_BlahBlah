/**
 * dragPreview — where a clip move / trim / transition-edge drag lives while it
 * is in progress.
 *
 * WHY. Every drag frame used to call `onUpdateClips` / `onUpdateClip`, which
 * rewrites the undo-scoped project state: one App render pass of the whole dock
 * (Timeline, Inspector, Dopesheet, Project, headers, ...) for every frame of the
 * gesture. The new positions are only needed to DRAW the timeline while the
 * pointer is down; nothing else has to know about them until the drop.
 *
 * So a drag now writes its pending geometry here — a plain module-level Map,
 * no React state, no re-render — and TimelineCanvas draws it on top of its
 * (unchanged, memoized) scene. On pointerup the preview is turned into ONE
 * batch update, which is what produces exactly one Undo step.
 *
 * SHAPE. `clipId -> partial updates`, the same object a drag would have passed
 * to `onUpdateClips` (`{ startTime, duration, trackId, components }`).
 *
 * `buildDragPreviewOverrides` resolves those partial updates to the drawn
 * geometry (x/width/y/height + the waveform's source window). It recomputes the
 * sub-lane packing of any track the drag touches, using the same
 * computeClipSubLanes helper the scene itself uses, so overlap stacking during
 * the drag matches what the drop will actually produce.
 */
import {
  CLIP_TOP_INSET,
  CLIP_VERTICAL_MARGIN,
  MIN_CLIP_WIDTH_PX,
  MIN_TRANSITION_WIDTH_PX,
} from './timelineScene.js';
import { computeClipSubLanes } from './timelineLayout.js';

let entries = new Map();
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

/** Called whenever the preview changes (TimelineCanvas redraws from this). */
export function subscribeDragPreview(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The live preview map (`clipId -> updates`). Never mutate it. */
export function getDragPreview() {
  return entries;
}

/** True while a drag preview is being drawn. */
export function isDragPreviewActive() {
  return entries.size > 0;
}

/**
 * Replace the preview with `[{ id, updates }]` (the same shape
 * `onUpdateClips` takes). Passing an empty list clears it.
 */
export function setDragPreview(updatesList) {
  const next = new Map();
  for (const entry of updatesList || []) {
    if (!entry || !entry.id) continue;
    next.set(entry.id, entry.updates || {});
  }
  if (next.size === 0 && entries.size === 0) return;
  entries = next;
  emit();
}

/** Drop the preview (drop committed, or the gesture was cancelled). */
export function clearDragPreview() {
  if (entries.size === 0) return;
  entries = new Map();
  emit();
}

/**
 * Turn a preview into the batch `onUpdateClips` should receive on drop.
 *
 * Values identical to the clip's committed ones are dropped, so a drag that
 * ends where it started commits nothing (and adds no Undo step). `onlyIds`
 * limits the batch to the clips this gesture actually owns.
 */
export function dragPreviewUpdates(previews, clips, onlyIds = null) {
  if (!previews || previews.size === 0) return [];
  const byId = new Map();
  for (const clip of clips || []) {
    if (clip && clip.id) byId.set(clip.id, clip);
  }

  const batch = [];
  for (const [id, updates] of previews) {
    if (onlyIds && !onlyIds.has(id)) continue;
    if (!updates) continue;
    const clip = byId.get(id);
    const next = {};
    if (Number.isFinite(updates.startTime) && (!clip || updates.startTime !== clip.startTime)) {
      next.startTime = updates.startTime;
    }
    if (Number.isFinite(updates.duration) && (!clip || updates.duration !== clip.duration)) {
      next.duration = updates.duration;
    }
    if (updates.trackId && (!clip || updates.trackId !== clip.trackId)) {
      next.trackId = updates.trackId;
    }
    // A left trim carries the adjusted VideoRenderer/AudioSource mediaOffset,
    // which has no cheap equality check (a fresh array each frame) — always
    // kept when present.
    if (updates.components) next.components = updates.components;
    if (Object.keys(next).length === 0) continue;
    batch.push({ id, updates: next });
  }
  return batch;
}

/**
 * Drawn geometry for every card the preview touches, as `clipId -> overrides`,
 * or null when nothing is being dragged.
 *
 * Overridable fields are the ones drawTimeline.js reads: startTime/duration/
 * trackId plus the resolved x/width/y/height and the waveform's source window.
 * Cards in a repacked track that are NOT being dragged are included too (their
 * sub-lane can change while a neighbour moves over them).
 */
export function buildDragPreviewOverrides(scene, previews = entries) {
  if (!scene || !previews || previews.size === 0) return null;
  const pps = scene.pixelsPerSecond || 1;

  const previewed = [];
  for (const [id, updates] of previews) {
    const item = scene.byId.get(id);
    if (!item) continue;
    const clipDuration = Number.isFinite(item.clip?.duration) ? item.clip.duration : 0;
    previewed.push({
      item,
      updates: updates || {},
      startTime: Number.isFinite(updates?.startTime) ? updates.startTime : item.startTime,
      duration: Number.isFinite(updates?.duration) ? updates.duration : clipDuration,
      trackId: updates?.trackId || item.trackId,
    });
  }
  if (previewed.length === 0) return null;

  const rowsByTrackId = new Map();
  for (const row of scene.rows) rowsByTrackId.set(row.trackId, row);

  // A previewed clip affects the packing of the track it lands on AND (when it
  // changes track) the one it left.
  const previewById = new Map(previewed.map((entry) => [entry.item.id, entry]));
  const rowsToRepack = new Set();
  for (const entry of previewed) {
    rowsToRepack.add(entry.trackId);
    rowsToRepack.add(entry.item.trackId);
  }

  const overrides = new Map();
  for (const trackId of rowsToRepack) {
    const row = rowsByTrackId.get(trackId);
    const rowItems = row ? row.clipIds.map((id) => scene.byId.get(id)).filter(Boolean) : [];

    // Every card that will sit on this track once the preview is applied.
    const staying = new Map();
    for (const item of rowItems) {
      const preview = previewById.get(item.id);
      if (preview) {
        // Moved to another track: it no longer packs into this row.
        if (preview.trackId === trackId) staying.set(item.id, preview);
        continue;
      }
      staying.set(item.id, {
        item,
        updates: null,
        startTime: item.startTime,
        duration: Number.isFinite(item.clip?.duration) ? item.clip.duration : 0,
        trackId,
      });
    }
    for (const entry of previewed) {
      if (entry.trackId !== trackId) continue;
      if (!staying.has(entry.item.id)) staying.set(entry.item.id, entry);
    }

    const packable = [];
    for (const entry of staying.values()) {
      if (entry.item.kind === 'transition') continue;
      packable.push({ id: entry.item.id, startTime: entry.startTime, duration: entry.duration });
    }
    const lanes = computeClipSubLanes(packable);

    for (const entry of staying.values()) {
      const lane = lanes.get(entry.item.id) || { laneIndex: 0, laneCount: 1 };
      overrides.set(entry.item.id, previewGeometry(entry, lane, row, pps));
    }
  }

  return overrides;
}

/** Resolve one preview entry to the geometry drawTimeline.js draws with. */
function previewGeometry(entry, lane, row, pps) {
  const { item } = entry;
  const isTransition = item.kind === 'transition';
  const rowY = row ? row.y : item.rowY;
  const rowHeight = row ? row.height : item.rowHeight;
  const availableHeight = Math.max(24, rowHeight - CLIP_VERTICAL_MARGIN);
  const laneCount = isTransition ? 1 : Math.max(1, lane.laneCount);
  const laneIndex = isTransition ? 0 : Math.min(Math.max(0, lane.laneIndex), laneCount - 1);
  const height = isTransition
    ? Math.max(24, rowHeight - CLIP_VERTICAL_MARGIN)
    : Math.max(16, availableHeight / laneCount);
  const startTime = Number.isFinite(entry.startTime) ? entry.startTime : item.startTime;
  const duration = Number.isFinite(entry.duration) ? entry.duration : 0;
  const width = Math.max(
    isTransition ? MIN_TRANSITION_WIDTH_PX : MIN_CLIP_WIDTH_PX,
    duration * pps
  );

  return {
    startTime,
    duration,
    endTime: startTime + duration,
    trackId: entry.trackId || item.trackId,
    x: startTime * pps,
    width,
    y: rowY + CLIP_TOP_INSET + (isTransition ? 0 : laneIndex * height),
    height,
    rowY,
    rowHeight,
    laneIndex,
    laneCount,
    ...audioWindowFor(item, duration, entry.updates),
  };
}

/**
 * The waveform's source window after the preview: a right trim consumes more or
 * less source, and a left trim also moves the in-point (the drag carries the
 * adjusted mediaOffset on the clip's media component).
 */
function audioWindowFor(item, duration, updates) {
  const clipDuration = Number.isFinite(item.clip?.duration) ? item.clip.duration : 0;
  const startSec = item.audioStartSec;
  const endSec = item.audioEndSec;
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return {};

  // Source seconds consumed per timeline second (Transform/AudioSource speed).
  const speed = clipDuration > 0 ? (endSec - startSec) / clipDuration : 1;
  const mediaOffset = updates?.components?.find(
    (c) => c && (c.type === 'AudioSource' || c.type === 'VideoRenderer') && c.mediaOffset !== undefined
  )?.mediaOffset;
  const audioStartSec = Number.isFinite(mediaOffset) ? mediaOffset : startSec;
  return { audioStartSec, audioEndSec: audioStartSec + duration * speed };
}
