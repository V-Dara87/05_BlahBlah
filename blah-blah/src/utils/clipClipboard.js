/**
 * Timeline clip clipboard (Copy / Cut / Paste).
 *
 * The clipboard lives in a plain module variable rather than React state:
 * copying must not re-render the editor, and the copied clips should survive
 * switching projects / prefab mode within the same session.
 *
 * What is stored is a deep-cloned SNAPSHOT of the clips at copy time, so
 * editing or deleting the originals afterwards doesn't change what gets
 * pasted (same as any clipboard).
 *
 * Pure helpers only (no React) — `buildPastedClips` is unit-tested.
 */
 
let clipboard = null; // { clips: Entity[], copiedAt: number } | null
 
const clone = (v) => JSON.parse(JSON.stringify(v));
 
/** All ids in `ids` plus every descendant (children via parentId, any depth). */
export function expandWithDescendants(entities, ids) {
  const byParent = new Map();
  for (const e of entities) {
    if (e.parentId) {
      const list = byParent.get(e.parentId);
      if (list) list.push(e.id);
      else byParent.set(e.parentId, [e.id]);
    }
  }
  const out = new Set(ids);
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.pop();
    const kids = byParent.get(id);
    if (!kids) continue;
    for (const k of kids) {
      if (!out.has(k)) {
        out.add(k);
        queue.push(k);
      }
    }
  }
  return out;
}
 
/**
 * Store the given clips (plus their descendants) on the clipboard.
 * Descendants come along because deleting a clip deletes its children too
 * (removeEntitiesByIds cascades) — so a Cut must not lose them, and a Copy
 * of a parent should paste the whole group.
 * Returns the number of clips stored (0 = nothing copied).
 */
export function copyToClipboard(entities, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const wanted = expandWithDescendants(entities, ids);
  // Keep the timeline's own order so pasted clips keep their stacking order.
  const clips = entities.filter((e) => wanted.has(e.id)).map(clone);
  if (clips.length === 0) return 0;
  clipboard = { clips, copiedAt: Date.now() };
  return clips.length;
}
 
export function hasClipboardClips() {
  return !!clipboard && clipboard.clips.length > 0;
}
 
export function getClipboardClips() {
  return clipboard ? clipboard.clips : [];
}
 
export function clearClipboard() {
  clipboard = null;
}
 
/**
 * Build fresh clips from clipboard `clips`, ready to append to the timeline.
 *
 *  - The group's LEFTMOST start is moved to `pasteTime` (the playhead);
 *    every clip keeps its offset from that leftmost start, so the relative
 *    layout of a multi-clip selection is preserved.
 *  - Each clip stays on its ORIGINAL track (a multi-track selection pastes
 *    across the same tracks). Tracks that no longer exist fall back to the
 *    first available track so a pasted clip is never orphaned.
 *  - Fresh ids. If a clip's parent is also in the pasted set it is re-linked
 *    to the new parent copy; otherwise it becomes independent — the same
 *    rule handleDuplicateClips uses.
 *  - linkGroupId is dropped (a copy is not part of the original link group),
 *    matching handleDuplicateClips.
 *  - Overlaps with existing clips are intentionally left alone.
 *
 * @param {Array}  clips       clipboard snapshot
 * @param {number} pasteTime   timeline time (seconds) for the group's left edge
 * @param {Array}  trackIds    ids of the tracks that currently exist
 * @param {Function} [makeId]  id factory (injectable for tests)
 * @returns {Array} new entities
 */
export function buildPastedClips(clips, pasteTime, trackIds = [], makeId) {
  if (!Array.isArray(clips) || clips.length === 0) return [];
 
  const mint = makeId || (() => `go-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const minStart = Math.min(...clips.map((c) => c.startTime || 0));
  const shift = Math.max(0, pasteTime) - minStart;
 
  const idMap = new Map();
  clips.forEach((c) => idMap.set(c.id, mint()));
 
  const fallbackTrack = trackIds[0] || 'track-1';
  const trackSet = new Set(trackIds);
 
  return clips.map((c) => {
    const { linkGroupId: _linkGroupId, ...rest } = clone(c);
    const trackId = !c.trackId || trackSet.size === 0 || trackSet.has(c.trackId) ? (c.trackId || fallbackTrack) : fallbackTrack;
    return {
      ...rest,
      id: idMap.get(c.id),
      parentId: c.parentId && idMap.has(c.parentId) ? idMap.get(c.parentId) : null,
      trackId,
      startTime: Math.max(0, (c.startTime || 0) + shift),
    };
  });
}