/**
 * Gap / position helpers for timeline clips.
 *
 * Three operations, all pure (no React) so they can be unit-tested:
 *
 *  1. Remove gaps between SELECTED clips (any tracks)
 *     -> computeGapRemovalShifts / buildGapRemovalUpdates / hasRemovableGaps
 *
 *  2. Remove gaps in ONE TRACK (no selection needed)
 *     -> buildTrackGapRemovalUpdates / hasTrackGaps
 *
 *  3. Bring a TRACK to the front (earliest clip -> 00:00, spacing kept)
 *     -> buildTrackBringToFrontUpdates / canBringTrackToFront
 *
 * Shared rules
 *  - Clips only ever move LEFT and never change tracks.
 *  - Clips that start together / overlap form one "block" that moves as a
 *    unit, so stacked/simultaneous clips are never torn apart.
 *  - Linked children (parentId, any depth) move with their parent by the
 *    same amount, exactly like dragging a clip, so a video and its
 *    split-off audio stay in sync.
 *  - Unselected / other-track clips are never packed (no ripple); they only
 *    move if they are linked children of something that moved.
 */
 
const EPS = 1e-6;
const DEFAULT_TRACK_ID = 'track-1';
 
const isTimed = (c) => c && Number.isFinite(c.startTime) && Number.isFinite(c.duration);
const trackOf = (c) => c?.trackId || DEFAULT_TRACK_ID;
 
/** id -> array of every descendant id (children via parentId, any depth). */
function makeDescendants(entities) {
  const kids = new Map();
  for (const e of entities) {
    if (!e.parentId) continue;
    if (!kids.has(e.parentId)) kids.set(e.parentId, []);
    kids.get(e.parentId).push(e.id);
  }
  return (rootId) => {
    const out = [];
    const seen = new Set([rootId]);
    const stack = [rootId];
    while (stack.length) {
      for (const k of kids.get(stack.pop()) || []) {
        if (seen.has(k)) continue; // cycle guard
        seen.add(k);
        out.push(k);
        stack.push(k);
      }
    }
    return out;
  };
}
 
/** True when no ancestor of `clip` is in `set` (i.e. it moves on its own). */
function hasNoAncestorIn(clip, set, byId) {
  let p = clip.parentId;
  const seen = new Set();
  while (p && !seen.has(p)) {
    if (set.has(p)) return false;
    seen.add(p);
    p = byId.get(p)?.parentId;
  }
  return true;
}
 
/**
 * Groups start-sorted clips into blocks: clips that start together or
 * overlap share a block and move as one. Each block = { clips, start, end }.
 */
function groupIntoBlocks(sortedClips) {
  if (sortedClips.length === 0) return [];
  const blocks = [];
  let cur = {
    clips: [sortedClips[0]],
    start: sortedClips[0].startTime,
    end: sortedClips[0].startTime + sortedClips[0].duration,
  };
  for (let i = 1; i < sortedClips.length; i++) {
    const c = sortedClips[i];
    if (c.startTime < cur.end - EPS) {
      cur.clips.push(c);
      cur.end = Math.max(cur.end, c.startTime + c.duration);
    } else {
      blocks.push(cur);
      cur = { clips: [c], start: c.startTime, end: c.startTime + c.duration };
    }
  }
  blocks.push(cur);
  return blocks;
}
 
/**
 * Packs blocks back to back. The first block is the anchor: it stays put
 * unless `anchorAt` is given, in which case it is moved (left only) to
 * start there. Returns Map<clipId, delta> (delta < 0 = move left).
 */
function packBlocks(blocks, anchorAt = null) {
  const shifts = new Map();
  if (blocks.length === 0) return shifts;
 
  const assign = (block, delta) => {
    if (delta < -EPS) for (const c of block.clips) shifts.set(c.id, delta);
  };
 
  let cursor;
  if (anchorAt === null) {
    cursor = blocks[0].end;
  } else {
    const delta = Math.min(0, anchorAt - blocks[0].start);
    assign(blocks[0], delta);
    cursor = blocks[0].end + delta;
  }
 
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const delta = Math.min(0, cursor - b.start); // never move right
    assign(b, delta);
    cursor = b.end + (delta < -EPS ? delta : 0);
  }
  return shifts;
}
 
/** Makes every descendant of a moved clip follow it by the same delta. */
function addDescendantShifts(shifts, entities) {
  const descendantsOf = makeDescendants(entities);
  for (const [id, delta] of [...shifts.entries()]) {
    for (const d of descendantsOf(id)) {
      if (!shifts.has(d)) shifts.set(d, delta);
    }
  }
  return shifts;
}
 
/** Shifts -> handleUpdateClips-ready updates, clamped so startTime >= 0. */
function shiftsToUpdates(entities, shifts) {
  if (shifts.size === 0) return [];
  const byId = new Map(entities.map((e) => [e.id, e]));
  const updates = [];
  for (const [id, delta] of shifts) {
    const e = byId.get(id);
    if (!e) continue;
    updates.push({ id, updates: { startTime: Math.max(0, e.startTime + delta) } });
  }
  return updates;
}
 
/* ────────────────────────────────────────────────────────────────────
 * 1. Selected clips (any tracks)
 * ──────────────────────────────────────────────────────────────────── */
 
/**
 * Map<clipId, delta> for packing the selected clips back to back.
 * Includes descendants of every moved clip. Empty map = nothing to close.
 */
export function computeGapRemovalShifts(entities, ids) {
  if (!Array.isArray(entities) || !Array.isArray(ids) || ids.length < 2) return new Map();
 
  const selected = new Set(ids);
  const byId = new Map(entities.map((e) => [e.id, e]));
 
  // A selected clip whose ancestor is also selected rides along with that
  // ancestor, so it is not packed as its own independent clip.
  const roots = ids
    .map((id) => byId.get(id))
    .filter(isTimed)
    .filter((c) => hasNoAncestorIn(c, selected, byId))
    .sort((a, b) => a.startTime - b.startTime);
 
  if (roots.length < 2) return new Map();
 
  return addDescendantShifts(packBlocks(groupIntoBlocks(roots)), entities);
}
 
/** handleUpdateClips-ready updates ({ id, updates: { startTime } }). */
export function buildGapRemovalUpdates(entities, ids) {
  return shiftsToUpdates(entities, computeGapRemovalShifts(entities, ids));
}
 
/** True when at least one selected clip can be moved closer. */
export function hasRemovableGaps(entities, ids) {
  return computeGapRemovalShifts(entities, ids).size > 0;
}
 
/* ────────────────────────────────────────────────────────────────────
 * 2 + 3. Whole track (no selection needed)
 * ──────────────────────────────────────────────────────────────────── */
 
/**
 * Top-level clips of one track, sorted by start time. A clip whose parent
 * is ALSO on this track is left out (it rides along with the parent);
 * a child whose parent lives on another track still counts as this
 * track's own clip, since nothing else would position it.
 */
function trackRoots(entities, trackId) {
  if (!Array.isArray(entities)) return [];
  const byId = new Map(entities.map((e) => [e.id, e]));
  const onTrack = new Set(entities.filter((e) => isTimed(e) && trackOf(e) === trackId).map((e) => e.id));
 
  return entities
    .filter((c) => onTrack.has(c.id))
    .filter((c) => hasNoAncestorIn(c, onTrack, byId))
    .sort((a, b) => a.startTime - b.startTime);
}
 
/** Pack every clip on the track back to back; the first clip stays put. */
export function buildTrackGapRemovalUpdates(entities, trackId) {
  const roots = trackRoots(entities, trackId);
  if (roots.length < 2) return [];
  const shifts = addDescendantShifts(packBlocks(groupIntoBlocks(roots)), entities);
  return shiftsToUpdates(entities, shifts);
}
 
/** True when the track has at least one gap to close. */
export function hasTrackGaps(entities, trackId) {
  return buildTrackGapRemovalUpdates(entities, trackId).length > 0;
}
 
/**
 * Move the whole track left so its earliest clip starts at 00:00. Spacing
 * between the track's clips (including gaps) is preserved.
 */
export function buildTrackBringToFrontUpdates(entities, trackId) {
  const roots = trackRoots(entities, trackId);
  if (roots.length === 0) return [];
 
  const first = roots[0].startTime;
  if (first <= EPS) return [];
 
  const shifts = new Map();
  for (const c of roots) shifts.set(c.id, -first);
  return shiftsToUpdates(entities, addDescendantShifts(shifts, entities));
}
 
/** True when the track's earliest clip is not already at 00:00. */
export function canBringTrackToFront(entities, trackId) {
  return buildTrackBringToFrontUpdates(entities, trackId).length > 0;
}