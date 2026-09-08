/**
 * Pure timeline geometry for the FLAT TRACKS model.
 *
 * Every track is a full, standard track row (height = TRACK_HEIGHT), and
 * multiple clips comfortably coexist on any track row. No sub-tracks, no
 * parent-child hierarchy, no clip grouping.
 */

export const TRACK_HEIGHT = 64;      // Normal track height (px)

/**
 * Computes track rows for the timeline.
 * Each track corresponds to a normal track lane row.
 *
 * @param {Array} tracks  All project tracks
 * @param {Array} clips   All project clips/entities
 * @returns {Array<{ track, clips, rowHeight }>}
 */
export function computeTrackLanes(tracks = [], clips = []) {
  return (tracks || []).map((track) => {
    const trackClips = (clips || []).filter((c) => c.trackId === track.id);
    return {
      track,
      clips: trackClips,
      rowHeight: TRACK_HEIGHT,
    };
  });
}

