/**
 * timelineScene — the pure geometry model behind the canvas timeline.
 *
 * Everything the timeline needs to draw itself or answer "what is under this
 * point" is derived here from `tracks` + `clips` + zoom, with NO React and no
 * DOM. That keeps the expensive parts (row layout, sub-lane packing, sorting
 * for range queries) unit-testable and lets both the drawing code and the hit
 * testing read one shared definition of where a clip is, instead of the two
 * drifting apart (which is the classic failure mode of a canvas rewrite).
 *
 * Geometry conventions — deliberately identical to the DOM timeline this
 * canvas renderer replaced, so the canvas draws every clip exactly where the
 * old DOM renderer put it:
 *
 *   - Content-space X is `time * pixelsPerSecond` (the lanes area's own
 *     coordinate space; the track-header column and the container's scroll
 *     offset are the caller's business — see TimelineCanvas.jsx).
 *   - Content-space Y is the vertical offset of the track rows, in the same
 *     order as `computeTrackLanes` produces (top to bottom).
 *   - A clip card sits at `row.y + CLIP_TOP_INSET + laneIndex * laneHeight`,
 *     with `laneHeight = max(16, max(24, rowHeight - CLIP_VERTICAL_MARGIN) /
 *     laneCount)` — the exact maths ClipItem.jsx uses for its own inline
 *     `top`/`height`, including the 16px minimum width and the sub-lane split
 *     for clips that overlap in time (computeClipSubLanes).
 *   - A transition clip is NOT a sub-lane clip: it is drawn as an overlay card
 *     across the full row on top of its neighbours (see timelineLayout.js
 *     getPackableClips / TransitionClipItem.jsx), so it is modelled as
 *     kind: 'transition' with `top: 5px` and `height: max(24, rowHeight - 10)`
 *     and `width: max(12, duration * pps)` — TransitionClipItem's own maths,
 *     not the sub-lane split.
 *
 * WHAT THIS DELIBERATELY DOES NOT KNOW: SELECTION. Nothing about "which clips
 * are selected" changes a clip's position or size, so selection is NOT an input
 * here — it is passed to drawTimelineScene at DRAW time (state.selectedIds) and
 * applied as a highlight. Baking it into the scene would mean every click and
 * every lasso tick re-ran the whole layout (computeTrackLanes is O(tracks x
 * clips) and computeClipSubLanes sorts per track), i.e. re-laying out a
 * 3000-clip project to change the colour of one card. Keep the scene's inputs
 * limited to what actually moves geometry: tracks, clips, zoom, media library.
 *
 * Zone constants (trim edges, pickwhip button) mirror the DOM equivalents in
 * clip-item.css (`.clip-trim-handle` is 7px wide; the pickwhip button is a
 * ~16px control in the card's top-right corner) so a pointer that would have
 * grabbed a handle in the DOM path grabs the same handle here.
 */
import {
  computeTrackLanes,
  computeClipSubLanes,
  isTransitionClipLike,
  clampTrackHeight,
} from './timelineLayout.js';
// The transition ORPHAN flag (see below) is the one piece of transition
// semantics worth reusing rather than re-deriving: ClipItem/TransitionClipItem,
// export and the resolver all agree through this function, so the canvas must
// not grow its own second opinion about "is this still on a cut".
import { findTransitionNeighbours } from '../engine/renderPipeline.js';
import { getTransitionClipComponent } from '../engine/ecs.js';
import { getTransitionPreset } from '../engine/glTransitions.js';

/** Top margin inside a row, matching `.timeline-clip-card`'s `top: 5px`. */
export const CLIP_TOP_INSET = 5;
/** Total vertical margin (5px top + 5px bottom), matching ClipItem.jsx. */
export const CLIP_VERTICAL_MARGIN = 10;
/** Narrowest a card may be drawn, matching ClipItem's `Math.max(16, ...)`. */
export const MIN_CLIP_WIDTH_PX = 16;
/** Width of the DOM trim handles (`.clip-trim-handle`), reused for hit zones. */
export const TRIM_HANDLE_WIDTH_PX = 7;
/** Click target size of the card's pickwhip/link button. */
export const PICKWHIP_SIZE_PX = 16;
/**
 * Narrowest a transition card may be. TransitionClipItem.jsx uses 12 (not the
 * 16 the clip cards use), so a very short blend stays clickable and matches the
 * DOM path's own hit box exactly.
 */
export const MIN_TRANSITION_WIDTH_PX = 12;
/** Hit zones a clip card can report. */
export const CLIP_ZONES = Object.freeze({
  BODY: 'body',
  TRIM_LEFT: 'trim-left',
  TRIM_RIGHT: 'trim-right',
  PICKWHIP: 'pickwhip',
  TRANSITION_EDGE_LEFT: 'transition-edge-left',
  TRANSITION_EDGE_RIGHT: 'transition-edge-right',
});

/** Drag/resize cursors per zone — one definition, used by the canvas component. */
export function cursorForZone(zone) {
  if (zone === CLIP_ZONES.TRIM_LEFT || zone === CLIP_ZONES.TRIM_RIGHT) return 'col-resize';
  if (zone === CLIP_ZONES.TRANSITION_EDGE_LEFT || zone === CLIP_ZONES.TRANSITION_EDGE_RIGHT) return 'col-resize';
  if (zone === CLIP_ZONES.PICKWHIP) return 'grab';
  return 'grab';
}

/**
 * Everything ClipItem.jsx derives from a clip's media components, computed
 * ONCE per clip here so the drawing code and the waveform loader can never
 * disagree with the DOM path about it:
 *
 *   hasVideo/hasAudio — ecs.js isVideoEntity / isAudioEntity, INCLUDING the
 *     entity's own `type` field. Checking components only (which this file used
 *     to do) mis-coloured any clip saved with `type: 'video'` but an unusual
 *     component set, and dropped its waveform entirely.
 *   url — ClipItem's `audioUrl`: the entity's own `src` wins, then the first
 *     AudioSource/VideoRenderer component's (array order, not VideoRenderer
 *     first). Using a different precedence can resolve to a URL that is not the
 *     one playback uses, which showed a waveform for the wrong file.
 *   isMissingMedia — ClipItem's `isMissingSrc`: only video/audio entities can
 *     be missing, and blob: URLs are legitimately transient (a live recording
 *     still being persisted) so they are never flagged.
 */
function mediaInfoFor(clip, mediaAssets) {
  const comps = clip.components || [];
  const hasAudio = clip.type === 'audio' || comps.some((c) => c.type === 'AudioSource');
  const hasVideo = clip.type === 'video' || comps.some((c) => c.type === 'VideoRenderer');
  const comp = comps.find((c) => c.type === 'AudioSource' || c.type === 'VideoRenderer');
  const url = clip.src || comp?.src || null;
  const isMissingMedia = Boolean(
    url && (hasVideo || hasAudio) && !url.startsWith('blob:') && !(mediaAssets || []).some((a) => a?.url === url)
  );
  return { hasAudio, hasVideo, comp, url, isMissingMedia };
}

/** Lightweight category used to pick the card's colour, matching ClipItem. */
function categoryOf(clip) {
  const has = (type) => Boolean(clip.components?.some((c) => c.type === type));
  if (clip.type === 'video' || has('VideoRenderer')) return 'video';
  if (clip.type === 'audio' || has('AudioSource')) return 'audio';
  if (has('TextRenderer')) return 'text';
  if (has('ShapeRenderer')) return 'shape';
  return 'prefab';
}

/**
 * Effective playback rate of a clip's audio: AudioSource/VideoRenderer.speed ×
 * Transform.speed (inherited from the parent entity when this clip has none),
 * exactly as ClipItem.jsx, mixdownAudio and the preview resolve it. A 2x clip
 * consumes twice as much SOURCE per second of timeline, which is what the
 * waveform window (audioStartSec → audioEndSec) has to reflect.
 */
function audioSpeedFor(clip, clipById) {
  const comp = (clip.components || []).find(
    (c) => c.type === 'AudioSource' || c.type === 'VideoRenderer'
  );
  const contentSpeed = comp?.speed || 1;
  const localTransformSpeed = (clip.components || []).find((c) => c.type === 'Transform')?.speed;
  const parentTransformSpeed = clip.parentId
    ? (clipById.get(clip.parentId)?.components || []).find((c) => c.type === 'Transform')?.speed
    : undefined;
  return contentSpeed * (localTransformSpeed ?? parentTransformSpeed ?? 1);
}

/**
 * Build the scene for one timeline state.
 *
 * @param {object} params
 * @param {Array}  params.tracks
 * @param {Array}  params.clips
 * @param {number} params.pixelsPerSecond
 * @param {Array}  [params.mediaAssets] used only for the missing-media flag
 * @returns {{
 *   rows: Array<{ trackId: string, track: object, y: number, height: number, clipIds: string[] }>,
 *   items: Array<object>,
 *   byId: Map<string, object>,
 *   totalHeight: number,
 *   timeToX: (t: number) => number,
 *   xToTime: (x: number) => number,
 *   itemsInRange: (startSec: number, endSec: number) => Array<object>,
 *   itemsInRect: (rect: { x0: number, y0: number, x1: number, y1: number }) => Array<object>,
 *   hitTest: (x: number, y: number) => object | null,
 * }}
 */
export function buildTimelineScene({
  tracks = [],
  clips = [],
  pixelsPerSecond = 1,
  mediaAssets = [],
} = {}) {
  const pps = pixelsPerSecond > 0 ? pixelsPerSecond : 1;
  const rows = [];
  const items = [];
  const byId = new Map();
  // Lookup over the WHOLE clip array (not just the clips that landed in a
  // track row): a parent on a track that no longer exists still has to resolve
  // for the inherited-speed lookup, same as ClipItem's `allClips.find`. Built in
  // one pass so the per-clip parent lookup below is O(1) rather than O(clips) —
  // which is what made this O(visible x clips) per frame in the caller.
  const clipById = new Map();
  for (const c of clips || []) if (c && !clipById.has(c.id)) clipById.set(c.id, c);

  // One pass per row: row Y comes from computeTrackLanes (the same helper the
  // DOM path uses), sub-lanes from computeClipSubLanes.
  const lanes = computeTrackLanes(tracks, clips);
  let y = 0;
  lanes.forEach((row, rowIndex) => {
    const rowHeight = clampTrackHeight(row.rowHeight);
    const rowClips = row.clips || [];
    const subLanes = computeClipSubLanes(rowClips);
    const availableHeight = Math.max(24, rowHeight - CLIP_VERTICAL_MARGIN);

    const rowRecord = { trackId: row.track?.id, track: row.track, y, height: rowHeight, rowIndex, clipIds: [] };
    rows.push(rowRecord);

    for (const clip of rowClips) {
      if (!clip) continue;
      const isTransition = isTransitionClipLike(clip);
      const lane = subLanes.get(clip.id) || { laneIndex: 0, laneCount: 1 };
      const laneCount = Math.max(1, isTransition ? 1 : lane.laneCount);
      const laneIndex = isTransition ? 0 : Math.min(Math.max(0, lane.laneIndex), laneCount - 1);
      const cardHeight = isTransition
        ? Math.max(24, rowHeight - CLIP_VERTICAL_MARGIN)
        : Math.max(16, availableHeight / laneCount);
      const widthPx = Math.max(
        isTransition ? MIN_TRANSITION_WIDTH_PX : MIN_CLIP_WIDTH_PX,
        (Number.isFinite(clip.duration) ? clip.duration : 0) * pps
      );
      const startTime = Number.isFinite(clip.startTime) ? clip.startTime : 0;
      const duration = Number.isFinite(clip.duration) ? clip.duration : 0;
      const media = mediaInfoFor(clip, mediaAssets);
      const mediaOffset = media.comp?.mediaOffset || 0;

      const item = {
        id: clip.id,
        clip,
        kind: isTransition ? 'transition' : 'clip',
        trackId: clip.trackId,
        track: row.track,
        rowIndex,
        rowY: y,
        rowHeight,
        laneIndex,
        laneCount,
        isLocked: Boolean(row.track?.locked),
        isMissingMedia: isTransition ? false : media.isMissingMedia,
        category: categoryOf(clip),
        startTime,
        endTime: startTime + duration,
        // Card geometry in content space. The transition card is a full-height
        // overlay at the top of the row (TransitionClipItem's `top: 5px`), so it
        // takes the plain inset instead of a sub-lane offset.
        x: startTime * pps,
        width: widthPx,
        y: y + CLIP_TOP_INSET + (isTransition ? 0 : laneIndex * cardHeight),
        height: cardHeight,

        // ── Media, resolved once per clip (see mediaInfoFor) ──────────────
        hasAudio: media.hasAudio,
        hasVideo: media.hasVideo,
        audioUrl: media.url,
        // Source window the waveform shows (ClipItem -> WaveformCanvas): the
        // clip's in-point through the amount of SOURCE it consumes.
        audioStartSec: mediaOffset,
        audioEndSec: duration > 0 ? mediaOffset + duration * audioSpeedFor(clip, clipById) : mediaOffset,
      };

      if (isTransition) {
        // Preset label + orphan warning, matching TransitionClipItem.jsx: an
        // orphan sits on no real cut (a neighbour was moved or trimmed away),
        // export refuses to blend it, and the DOM card turns red-dashed rather
        // than looking healthy. Resolved here so drawing stays a pure read.
        const preset = getTransitionClipComponent(clip)?.preset || 'crossfade';
        item.transitionPreset = preset;
        item.transitionLabel = getTransitionPreset(preset)?.name || preset;
        const neighbours = findTransitionNeighbours(clip, rowClips);
        item.isOrphanTransition = !neighbours.a || !neighbours.b;
      }

      items.push(item);
      byId.set(clip.id, item);
      rowRecord.clipIds.push(clip.id);
    }

    y += rowHeight;
  });

  // Sorted-by-start index for range queries (a project can hold thousands of
  // clips, so "which clips intersect this window" must not scan them all).
  // Sorted by start with a prefix-max of `end` — the same trick as
  // renderPipeline.js buildActiveEntityIndex: entries before the binary-search
  // cursor can be skipped outright once no earlier entry can still overlap.
  const sorted = [...items].sort(
    (a, b) => a.startTime - b.startTime || String(a.id).localeCompare(String(b.id))
  );
  const starts = new Float64Array(sorted.length);
  const prefixMaxEnd = new Float64Array(sorted.length);
  let maxEnd = -Infinity;
  for (let i = 0; i < sorted.length; i++) {
    starts[i] = sorted[i].startTime;
    if (sorted[i].endTime > maxEnd) maxEnd = sorted[i].endTime;
    prefixMaxEnd[i] = maxEnd;
  }

  const timeToX = (t) => t * pps;
  const xToTime = (x) => x / pps;

  /** Every item whose [startTime, endTime) intersects [startSec, endSec). */
  const itemsInRange = (startSec, endSec) => {
    if (sorted.length === 0) return [];
    const lo = Number.isFinite(startSec) ? startSec : -Infinity;
    const hi = Number.isFinite(endSec) ? endSec : Infinity;
    // Rightmost item starting before the window ends.
    let low = 0;
    let high = sorted.length - 1;
    let last = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (starts[mid] <= hi) {
        last = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const out = [];
    // Walked backwards (so the prefix-max prune can stop early), then
    // reversed: callers get a stable, ascending-by-start result.
    for (let i = last; i >= 0; i--) {
      if (prefixMaxEnd[i] <= lo) break;
      if (sorted[i].endTime > lo) out.push(sorted[i]);
    }
    out.reverse();
    return out;
  };

  /** Items whose box intersects a content-space rectangle (lasso select). */
  const itemsInRect = (rect) => {
    const x0 = Math.min(rect.x0, rect.x1);
    const x1 = Math.max(rect.x0, rect.x1);
    const y0 = Math.min(rect.y0, rect.y1);
    const y1 = Math.max(rect.y0, rect.y1);
    return itemsInRange(xToTime(x0), xToTime(x1)).filter(
      (item) => item.y + item.height >= y0 && item.y <= y1 && item.x + item.width >= x0 && item.x <= x1
    );
  };

  /**
   * What is at this content-space point?
   *   { type: 'clip', item, clipId, zone }   a card (any zone)
   *   { type: 'lane', trackId, track, time } bare lane space
   *   null                                   outside any row
   * Clips are tested topmost-last (transition strips first, since they are
   * drawn over the row) so the answer matches what the user sees.
   */
  const hitTest = (x, y) => {
    let row = null;
    for (const r of rows) {
      if (y >= r.y && y < r.y + r.height) {
        row = r;
        break;
      }
    }

    // itemsInRange indexes by TIME (startTime/endTime), but a card's drawn
    // pixel box can be wider than its time span — short clips/transitions are
    // floored to MIN_CLIP_WIDTH_PX/MIN_TRANSITION_WIDTH_PX so they stay
    // clickable when zoomed out or trimmed very short (see the item-building
    // loop above). A zero-width time query at exactly xToTime(x) misses those
    // padded pixels entirely, so a press anywhere in the padding (which can be
    // most or all of a short card at low zoom) finds no candidate and falls
    // through to a 'lane' hit instead — clicking/dragging that clip silently
    // does nothing. Padding the query window by the widest possible pad (in
    // time, at the current zoom) pulls those items back in as candidates; the
    // exact pixel-box check just below (`x < item.x || x > item.x + item.width`)
    // still does the real filtering, so this only widens the candidate set,
    // never the hit itself.
    const widestPadTime = Math.max(MIN_CLIP_WIDTH_PX, MIN_TRANSITION_WIDTH_PX) / pps;
    const candidates = itemsInRange(xToTime(x) - widestPadTime, xToTime(x) + widestPadTime);
    // Transition strips sit on top of the row, so they win ties.
    const ordered = [...candidates].sort((a, b) => {
      const rank = (item) => (item.kind === 'transition' ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return b.y - a.y;
    });

    for (const item of ordered) {
      // Every card — transition included — is hit on its full box, which is
      // exactly what the DOM does (`.timeline-transition-card` is a real
      // full-height element sitting on top of its neighbours, so clicking
      // anywhere in it grabs the transition, not the clip underneath).
      const boxTop = item.y;
      const boxBottom = item.y + item.height;
      if (x < item.x || x > item.x + item.width) continue;
      if (y < boxTop || y > boxBottom) continue;

      let zone = CLIP_ZONES.BODY;
      if (item.kind === 'transition') {
        if (x <= item.x + TRIM_HANDLE_WIDTH_PX) zone = CLIP_ZONES.TRANSITION_EDGE_LEFT;
        else if (x >= item.x + item.width - TRIM_HANDLE_WIDTH_PX) zone = CLIP_ZONES.TRANSITION_EDGE_RIGHT;
      } else if (!item.isLocked) {
        const pickwhipLeft = item.x + item.width - PICKWHIP_SIZE_PX - 2;
        if (y <= boxTop + PICKWHIP_SIZE_PX + 2 && x >= pickwhipLeft) {
          zone = CLIP_ZONES.PICKWHIP;
        } else if (x <= item.x + TRIM_HANDLE_WIDTH_PX) {
          zone = CLIP_ZONES.TRIM_LEFT;
        } else if (x >= item.x + item.width - TRIM_HANDLE_WIDTH_PX) {
          zone = CLIP_ZONES.TRIM_RIGHT;
        }
      }
      return { type: 'clip', item, clipId: item.id, zone, clip: item.clip };
    }

    if (row) return { type: 'lane', trackId: row.trackId, track: row.track, time: Math.max(0, xToTime(x)) };
    return null;
  };

  return {
    rows,
    items,
    byId,
    totalHeight: y,
    pixelsPerSecond: pps,
    timeToX,
    xToTime,
    itemsInRange,
    itemsInRect,
    hitTest,
  };
}
