/**
 * Pure timeline geometry for the FLAT TRACKS model.
 *
 * Every track is a full track row, no sub-tracks, no parent-child
 * hierarchy, no clip grouping. A track's row height defaults to
 * TRACK_HEIGHT (or the user's "default track height" setting, passed into
 * computeTrackLanes) but is independently resizable per-track (drag the handle
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
 * @param {number} [defaultHeight]  Row height for tracks with no `track.height`
 *   (the "default track height" setting). Falls back to TRACK_HEIGHT.
 * @returns {Array<{ track, clips, rowHeight }>}
 */
export function computeTrackLanes(tracks = [], clips = [], defaultHeight = TRACK_HEIGHT) {
  const fallbackHeight = typeof defaultHeight === 'number' && !Number.isNaN(defaultHeight)
    ? defaultHeight
    : TRACK_HEIGHT;

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
      rowHeight: clampTrackHeight(track.height || fallbackHeight),
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
  if (!clips || clips.length === 0) return result;

  // Single pass filtering valid packable clips without multiple array copies
  const sorted = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (c && !isTransitionClipLike(c) && Number.isFinite(c.startTime) && Number.isFinite(c.duration)) {
      sorted.push(c);
    }
  }
  if (sorted.length === 0) return result;
  if (sorted.length === 1) {
    result.set(sorted[0].id, { laneIndex: 0, laneCount: 1 });
    return result;
  }

  sorted.sort((a, b) => a.startTime - b.startTime);

  // Greedily assign sub-lanes across overlap groups without intermediate group array allocations
  function processGroup(startIdx, endIdx) {
    const len = endIdx - startIdx + 1;
    if (len === 1) {
      result.set(sorted[startIdx].id, { laneIndex: 0, laneCount: 1 });
      return;
    }

    const laneEnds = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const clip = sorted[i];
      const start = clip.startTime;
      let placedLane = -1;
      for (let j = 0; j < laneEnds.length; j++) {
        if (laneEnds[j] <= start + OVERLAP_EPSILON) {
          placedLane = j;
          break;
        }
      }
      if (placedLane === -1) {
        placedLane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[placedLane] = start + clip.duration;
      result.set(clip.id, { laneIndex: placedLane, laneCount: 0 });
    }

    const laneCount = laneEnds.length;
    for (let i = startIdx; i <= endIdx; i++) {
      result.get(sorted[i].id).laneCount = laneCount;
    }
  }

  let groupStartIdx = 0;
  let groupEnd = sorted[0].startTime + sorted[0].duration;

  for (let i = 1; i < sorted.length; i++) {
    const clip = sorted[i];
    if (clip.startTime < groupEnd - OVERLAP_EPSILON) {
      groupEnd = Math.max(groupEnd, clip.startTime + clip.duration);
    } else {
      processGroup(groupStartIdx, i - 1);
      groupStartIdx = i;
      groupEnd = clip.startTime + clip.duration;
    }
  }
  processGroup(groupStartIdx, sorted.length - 1);

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