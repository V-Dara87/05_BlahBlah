/**
 * Remove gaps between selected timeline clips.
 *
 * Meaning: make the selected clips sit BACK TO BACK — no empty space between
 * them. Selected clips are ordered by start time and each one is moved left
 * so it starts exactly where the previous one ends.
 *
 * Rules
 *  - Works ACROSS tracks. "Clip B is after clip A" is about time, not which
 *    track it is on, so a video on track 1 followed by a title on track 2
 *    followed by a clip on track 3 are all packed into one run.
 *  - Clips only ever move LEFT and never move tracks.
 *  - The earliest selected clip stays where it is (it is the anchor); space
 *    before it and after the last one is untouched.
 *  - Clips that start at the same moment (or overlap) are treated as one
 *    "block" that moves together, so stacked/simultaneous clips are not torn
 *    apart or shoved in front of each other. The next block is packed against
 *    the END of the longest clip in the previous block.
 *  - Linked children (parentId, any depth) move with their parent by the same
 *    amount, exactly like dragging a clip, so a video and its split-off audio
 *    stay in sync. A selected child is treated as part of its parent's move.
 *  - Unselected clips are never touched (no ripple).
 *
 * Pure helpers (no React) so they can be unit-tested.
 */
 
const EPS = 1e-6;
 
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
 
/**
 * Map<clipId, delta> where delta < 0 means "move left by that many seconds".
 * Includes descendants of every moved clip. Empty map = nothing to close.
 */
export function computeGapRemovalShifts(entities, ids) {
  const result = new Map();
  if (!Array.isArray(entities) || !Array.isArray(ids) || ids.length < 2) return result;
 
  const selected = new Set(ids);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const descendantsOf = makeDescendants(entities);
 
  // A selected clip whose ancestor is also selected rides along with that
  // ancestor, so it is not packed as its own independent clip.
  const roots = ids
    .map((id) => byId.get(id))
    .filter((c) => c && Number.isFinite(c.startTime) && Number.isFinite(c.duration))
    .filter((c) => {
      let p = c.parentId;
      const seen = new Set();
      while (p && !seen.has(p)) {
        if (selected.has(p)) return false;
        seen.add(p);
        p = byId.get(p)?.parentId;
      }
      return true;
    })
    .sort((a, b) => a.startTime - b.startTime);
 
  if (roots.length < 2) return result;
 
  // Group clips that start together / overlap into blocks that move as one.
  const blocks = [];
  let cur = { clips: [roots[0]], start: roots[0].startTime, end: roots[0].startTime + roots[0].duration };
  for (let i = 1; i < roots.length; i++) {
    const c = roots[i];
    if (c.startTime < cur.end - EPS) {
      cur.clips.push(c);
      cur.end = Math.max(cur.end, c.startTime + c.duration);
    } else {
      blocks.push(cur);
      cur = { clips: [c], start: c.startTime, end: c.startTime + c.duration };
    }
  }
  blocks.push(cur);
 
  // Pack: each block starts where the previous block (after moving) ends.
  let cursor = blocks[0].end;
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const delta = Math.min(0, cursor - b.start); // never move right
    if (delta < -EPS) {
      for (const c of b.clips) result.set(c.id, delta);
      cursor = b.end + delta;
    } else {
      cursor = b.end;
    }
  }
 
  // Children follow their moved ancestor by the same amount.
  for (const [id, delta] of [...result.entries()]) {
    for (const d of descendantsOf(id)) {
      if (!result.has(d)) result.set(d, delta);
    }
  }
  return result;
}
 
/** handleUpdateClips-ready updates ({ id, updates: { startTime } }), clamped >= 0. */
export function buildGapRemovalUpdates(entities, ids) {
  const shifts = computeGapRemovalShifts(entities, ids);
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
 
/** True when at least one selected clip can be moved closer. */
export function hasRemovableGaps(entities, ids) {
  return computeGapRemovalShifts(entities, ids).size > 0;
}