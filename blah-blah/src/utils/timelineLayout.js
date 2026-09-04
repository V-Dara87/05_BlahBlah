/**
 * Pure timeline geometry for the NESTED SUB-TRACK (clip hierarchy) model.
 *
 * Every TRACK row = a root main lane (root clips) plus one SUB-LANE ROW per
 * child clip below it — each child gets its own mini track ("more tracks
 * inside a root track"), nested depth-first so a child clip's own children
 * become lanes under its lane. This module is the single source of truth for
 * that geometry: Timeline.jsx consumes it for vertical layout / hit-testing,
 * TrackLane.jsx renders exactly these rows, and TrackHeader.jsx renders the
 * matching sub-lane labels. Keeping it framework-free lets the layout math
 * be unit-tested (see tests/run-timeline-layout-tests.mjs).
 *
 * Row semantics:
 *   - Roots of a track are clips whose trackId matches AND that have no live
 *     parent (a dangling parentId — deleted parent — falls back to root,
 *     matching renderPipeline).
 *   - children are resolved by parentId regardless of their own trackId: a
 *     child clip renders inside its parent's sub-lane rows.
 *   - Collapsing a track (collapsedTracks[track.id]) removes ALL its child
 *     rows from view — children stay runtime-active, this is purely
 *     vertical-space bookkeeping.
 */
export const TRACK_HEIGHT = 64;      // root main lane height (px)
export const SUB_LANE_HEIGHT = 40;   // one child clip lane row (px)
export const SUB_LANE_INDENT = 18;   // visual indent per hierarchy depth (header labels)

/**
 * Children of a parent, in lane order. Each child may carry an `order`
 * number (assigned when lanes are rearranged — see handleReorderChild in
 * useProjectStore); ties fall back to entity-array order so projects that
 * never reordered render exactly as before. Stable sort, framework-free.
 */
export function sortChildrenOf(clips, parentId) {
  return (clips || [])
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

/**
 * @param {Array} tracks        project track records [{ id }]
 * @param {Array} clips         all entities [{ id, trackId, parentId }]
 * @param {Object} [collapsedTracks] trackId -> true when that track's child
 *                                sub-lanes are collapsed
 * @returns {Array<{ track, nodes, roots, expanded, subLaneRows, rowHeight }>}
 *   nodes = the nested clip tree (roots only, via parentId); subLaneRows =
 *   depth-first list of { clip, depth, parentClip } — one entry per child clip
 *   of ANY depth (the lane rows to render); rowHeight = TRACK_HEIGHT +
 *   SUB_LANE_HEIGHT * subLaneRows.length (0 when collapsed / no children).
 */
export function computeTrackLanes(tracks, clips, collapsedTracks = {}) {
  const byId = new Map((clips || []).map((c) => [c.id, c]));
  const buildNode = (clip) => ({
    clip,
    children: sortChildrenOf(clips, clip.id).map(buildNode),
  });

  return (tracks || []).map((track) => {
    const roots = (clips || []).filter(
      (c) => c.trackId === track.id && (!c.parentId || !byId.has(c.parentId))
    );
    const nodes = roots.map(buildNode);
    const expanded = !collapsedTracks[track.id];

    // Depth-first flatten of every descendant clip into its own lane row.
    const subLaneRows = [];
    const walk = (node, depth) => {
      for (const child of node.children) {
        subLaneRows.push({ clip: child.clip, depth, parentClip: node.clip });
        walk(child, depth + 1);
      }
    };
    nodes.forEach((node) => walk(node, 1));

    return {
      track,
      nodes,
      roots,
      expanded,
      subLaneRows,
      rowHeight: TRACK_HEIGHT + (expanded ? subLaneRows.length * SUB_LANE_HEIGHT : 0),
    };
  });
}
