/**
 * Pure timeline geometry for the FLAT TRACKS + CLIP GROUPING model.
 *
 * In this model:
 *   - Every track is a full, standard track row (height = TRACK_HEIGHT).
 *   - Multiple clips comfortably coexist on any track row.
 *   - Clips can be grouped/linked together (via linkGroupId) or parented (via parentId).
 *   - No restrictive sub-tracks or auto-synthesized tracks.
 */

export const TRACK_HEIGHT = 64;      // Normal track height (px)
export const SUB_LANE_HEIGHT = 64;   // Compatibility export
export const SUB_LANE_INDENT = 0;    // Indent (px)

/**
 * Children of a parent clip, in order. Framework-free helper.
 */
export function sortChildrenOf(clips, parentId) {
  return (clips || [])
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

/**
 * Compatibility export for track hierarchy flatten (returns 1:1 tracks as flat list).
 */
export function flattenTrackHierarchy(tracks = []) {
  return (tracks || []).map((track) => ({
    track,
    depth: 0,
    hasSubTracks: false,
    expanded: true,
    subTrackCount: 0,
  }));
}

/**
 * Computes track rows for the timeline.
 * Each track corresponds to a normal track lane row.
 *
 * @param {Array} tracks  All project tracks
 * @param {Array} clips   All project clips/entities
 * @returns {Array<{ track, depth, hasSubTracks, expanded, clips, parentBoxes, rowHeight }>}
 */
export function computeTrackLanes(tracks = [], clips = []) {
  return (tracks || []).map((track) => {
    const trackClips = (clips || []).filter((c) => c.trackId === track.id);
    return {
      track,
      depth: 0,
      hasSubTracks: false,
      expanded: true,
      clips: trackClips,
      parentBoxes: [],
      rowHeight: TRACK_HEIGHT,
    };
  });
}
