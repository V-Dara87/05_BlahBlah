/**
 * Pure timeline geometry for the FLAT TRACKS model.
 *
 * Every track is a full track row, no sub-tracks, no parent-child
 * hierarchy, no clip grouping. A track's row height defaults to
 * TRACK_HEIGHT but is independently resizable per-track (drag the handle
 * at the bottom of a TrackHeader — see TrackHeader.jsx) and persisted as
 * `track.height` on the track object itself, the same way mute/lock/
 * visible already persist per-track state.
 */
 
export const TRACK_HEIGHT = 128;      // Default/normal track height (px)
export const MIN_TRACK_HEIGHT = 40;  // Collapsed floor — stays tall enough for the header controls row
export const MAX_TRACK_HEIGHT = 320; // Ceiling — plenty tall for full-detail waveforms without one track eating the whole timeline
 
/** Clamp a candidate track height into the supported resize range. */
export function clampTrackHeight(height) {
  return Math.min(MAX_TRACK_HEIGHT, Math.max(MIN_TRACK_HEIGHT, Math.round(height)));
}
 
/**
 * Picks the ruler's major-tick spacing (in seconds) for a given zoom
 * level — shared by TimeRuler (tick marks) and TrackLane (background
 * grid lines), so the faint grid running through the track lanes always
 * lines up with the ruler's ticks above it instead of staying a fixed
 * 40px regardless of zoom.
 */
export function getTickIntervalSeconds(pixelsPerSecond) {
  if (pixelsPerSecond >= 100) return 0.5;
  if (pixelsPerSecond >= 60) return 1;
  if (pixelsPerSecond >= 30) return 2;
  if (pixelsPerSecond >= 15) return 5;
  return 10;
}
 
/**
 * Computes track rows for the timeline.
 * Each track corresponds to a track lane row, sized to its own
 * `track.height` (falling back to TRACK_HEIGHT for tracks saved before
 * this field existed, or any track that hasn't been resized).
 *
 * @param {Array} tracks  All project tracks
 * @param {Array} clips   All project clips/entities
 * @returns {Array<{ track, clips, rowHeight }>}
 */
export function computeTrackLanes(tracks = [], clips = []) {
  // ONE pass over `clips` into per-track buckets, instead of re-filtering the
  // whole array once per track. The result is identical (each row's `clips`
  // keeps the array's own order) but the cost drops from O(tracks x clips) to
  // O(clips + tracks), which matters because this runs on every project change
  // for both timeline renderers — and a long project is thousands of clips
  // across a couple of dozen tracks.
  const byTrack = new Map();
  for (const clip of clips || []) {
    if (!clip) continue;
    const bucket = byTrack.get(clip.trackId);
    if (bucket) bucket.push(clip);
    else byTrack.set(clip.trackId, [clip]);
  }

  return (tracks || []).map((track) => {
    const trackClips = byTrack.get(track.id) || [];
    return {
      track,
      clips: trackClips,
      rowHeight: clampTrackHeight(track.height || TRACK_HEIGHT),
      depth: 0,
    };
  });
}
 
/** Gap (px worth of seconds, converted by caller) two clips must clear to NOT be considered overlapping. */
const OVERLAP_EPSILON = 1e-6;
 
/**
 * Compresses overlapping clips within a single track into stacked
 * "sub-lanes" — same idea as DaVinci Resolve's clip stacking: clips that
 * overlap in time split the track's row height evenly between them
 * instead of drawing on top of one another. Clips that don't overlap
 * anything stay full-height (laneCount 1) and fill the whole row, same
 * as before.
 *
 * Overlap groups are found via a sweep over sorted clip ranges (like
 * merging intervals): consecutive clips are folded into the same group
 * as long as each new clip starts before the group's current furthest
 * end. Within a group, clips are greedily packed into the fewest
 * concurrent sub-lanes needed at any instant (a classic interval
 * partitioning / min-meeting-rooms pass), so 3 clips where only 2 ever
 * overlap at once still only split into 2 lanes, not 3.
 *
 * @param {Array} clips  Clips belonging to ONE track (already filtered)
 * @returns {Map<string, { laneIndex: number, laneCount: number }>}
 *          clipId -> which sub-lane it occupies and how many sub-lanes
 *          its overlap group needs in total.
 */
/**
 * True for a TransitionClip entity (ecs.js isTransitionClipEntity). Repeated
 * here, deliberately, so this file stays dependency-free like the rest of the
 * layout math; it is the same two-way check (entity type OR component type),
 * so a stale `type` cannot make the two disagree.
 */
export function isTransitionClipLike(clip) {
  return clip?.type === 'transition'
    || Boolean(clip?.components?.some((c) => c?.type === 'TransitionClipComponent'));
}

/**
 * Clips that take part in DaVinci-style sub-lane packing. A transition clip
 * is NOT one of them: it sits centred on a cut, so it always overlaps its two
 * neighbours by design, and packing it would squeeze both of them to half
 * height around every cut. It is drawn as an overlay strip on top of the row
 * instead (see TransitionClipItem.jsx).
 */
export function getPackableClips(clips = []) {
  return (clips || []).filter((c) => !isTransitionClipLike(c));
}

export function computeClipSubLanes(clips = []) {
  const result = new Map();
  const valid = getPackableClips(clips).filter((c) => Number.isFinite(c?.startTime) && Number.isFinite(c?.duration));
  if (valid.length === 0) return result;
 
  const sorted = [...valid].sort((a, b) => a.startTime - b.startTime);
 
  // 1. Partition into overlap groups via an interval-merge sweep.
  const groups = [];
  let currentGroup = [sorted[0]];
  let groupEnd = sorted[0].startTime + sorted[0].duration;
 
  for (let i = 1; i < sorted.length; i++) {
    const clip = sorted[i];
    if (clip.startTime < groupEnd - OVERLAP_EPSILON) {
      // Starts before the group's current furthest end: still part of it.
      currentGroup.push(clip);
      groupEnd = Math.max(groupEnd, clip.startTime + clip.duration);
    } else {
      groups.push(currentGroup);
      currentGroup = [clip];
      groupEnd = clip.startTime + clip.duration;
    }
  }
  groups.push(currentGroup);
 
  // 2. Within each group, greedily assign the fewest sub-lanes needed
  //    (interval partitioning): track each open lane's current end time,
  //    reuse the first lane that's already free, else open a new one.
  for (const group of groups) {
    if (group.length === 1) {
      result.set(group[0].id, { laneIndex: 0, laneCount: 1 });
      continue;
    }
 
    const laneEnds = []; // laneEnds[i] = end time currently occupied in lane i
    const assignment = new Map(); // clipId -> laneIndex
 
    for (const clip of group) {
      const start = clip.startTime;
      let placedLane = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= start + OVERLAP_EPSILON) {
          placedLane = i;
          break;
        }
      }
      if (placedLane === -1) {
        placedLane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[placedLane] = start + clip.duration;
      assignment.set(clip.id, placedLane);
    }
 
    const laneCount = laneEnds.length;
    for (const clip of group) {
      result.set(clip.id, { laneIndex: assignment.get(clip.id), laneCount });
    }
  }
 
  return result;
}
 
 
 
/**
 * Lays out generic sub-strip segments (see engine/subStripRegistry.js) as
 * left/width pixel boxes, clamped to the owning clip's own start/duration
 * so a segment can never visually escape its clip's card — same defensive
 * clamping spirit as computeClipSubLanes above, just for the sub-strip
 * row instead of the main clip lane.
 *
 * @param {Array<{id, startTime, endTime}>} segments  Entity-local times.
 * @param {number} clipStartTime   Clip's own startTime (timeline seconds).
 * @param {number} clipDuration    Clip's own duration (seconds).
 * @param {number} pixelsPerSecond Current timeline zoom.
 * @returns {Map<string, { leftPx: number, widthPx: number }>}
 *          segmentId -> position/size relative to the clip card's own
 *          left edge (i.e. NOT yet offset by the clip's timeline position
 *          — add clipStartTime * pixelsPerSecond if placing in world
 *          space; ClipSubStrip renders inside the clip card already
 *          positioned, so relative-to-card is what it needs).
 */
export function computeSubStripSegmentLayout(segments = [], clipStartTime = 0, clipDuration = 0, pixelsPerSecond = 1) {
  const result = new Map();
  const clipEndTime = clipStartTime + Math.max(0, clipDuration);
 
  for (const seg of segments || []) {
    if (!seg || !Number.isFinite(seg.startTime) || !Number.isFinite(seg.endTime)) continue;
 
    // Segment times are entity-local (same convention as the owning
    // component's own data, e.g. SubtitleTrack phrases) — for a
    // top-level clip, entity-local time already lines up with the
    // clip's own [0, duration) span, so clamp directly against it.
    const clampedStart = Math.max(0, Math.min(seg.startTime, clipDuration));
    const clampedEnd = Math.max(clampedStart, Math.min(seg.endTime, clipDuration));
 
    const leftPx = clampedStart * pixelsPerSecond;
    const widthPx = Math.max(4, (clampedEnd - clampedStart) * pixelsPerSecond);
 
    result.set(seg.id, { leftPx, widthPx });
  }
 
  // clipEndTime currently unused beyond documenting intent above; kept as
  // a named value (rather than an inline expression) so a future caller
  // that needs world-space clamping against sibling clips has it ready.
  void clipEndTime;
 
  return result;
}