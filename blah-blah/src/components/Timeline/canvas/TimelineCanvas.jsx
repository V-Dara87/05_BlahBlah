import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Scissors, Copy, ClipboardPaste, ArrowLeftToLine, Unlink, Link2 } from 'lucide-react';
import { buildTimelineScene, CLIP_ZONES } from '../../../utils/timelineScene';
import { readTimelineTheme, drawTimelineScene, waveformRectFor, wantsWaveform, cursorForZone } from './drawTimeline';
import { bucketsForCard } from './drawWaveform';
import { getWaveformPeaks } from '../../../utils/audioWaveform';
import { subscribePeaksUpdated } from '../../../services/peakCache';
import { subscribeThemeChanges } from '../../../services/themeSettings';
import { usePlaybackStore } from '../../../hooks/PlaybackContext';
import { applyEdgeAutoScroll } from '../../../utils/timelineAutoScroll';
import { computeTrimmedOffset } from '../../../utils/mediaOffset';
import { isVideoEntity, isAudioEntity } from '../../../engine/ecs';
import { ContextMenu } from '../../shared/ContextMenu';
import { hasClipboardClips } from '../../../utils/clipClipboard';
import { buildGapRemovalUpdates } from '../../../utils/removeGaps';
import { spawnDroppedItemOnTrack } from '../../../utils/timelineDrop';
import { DRAG_PAYLOAD_MIME } from '../../../utils/dragData';
import {
  findTransitionNeighbours,
  maxTransitionDuration,
  resizeTransitionAboutCut,
  buildMediaDurationsFromAssets,
} from '../../../engine/renderPipeline';
import './canvas-timeline.css';
// .ctx-menu-item/.ctx-menu-row/.ctx-menu-label/.ctx-menu-hint/.ctx-menu-divider
// (all scoped under .clip-context-menu) live in clip-item.css — a leftover
// filename from the removed DOM renderer, kept because the canvas's own clip
// and lane context menus (below) depend on those styles. Without this import
// the menus would render completely unstyled the first time nothing else in
// the app happens to have pulled clip-item.css in already.
import '../clip-item.css';
 
/** Return true if candidateChild is a descendant of ancestorId (cycle guard).
 * Identical to ClipItem.jsx's own isDescendantOf — kept in step so a
 * Ctrl-drag-to-parent gesture rejects the same cycles on both renderers. */
function isDescendantOf(candidateChildId, ancestorId, allClips) {
  if (!candidateChildId || !ancestorId || candidateChildId === ancestorId) return false;
  const visited = new Set();
  let curr = allClips.find((c) => c.id === candidateChildId);
  while (curr?.parentId) {
    if (curr.parentId === ancestorId) return true;
    if (visited.has(curr.parentId)) break;
    visited.add(curr.parentId);
    curr = allClips.find((c) => c.id === curr.parentId);
  }
  return false;
}
 
/**
 * How many distinct (url, bucket-rung, window) envelopes to keep before the
 * oldest are evicted. Envelopes are bounded now (MAX_WAVEFORM_BUCKETS x 3
 * arrays x 4 bytes = 192KB at the ceiling), so even a worst case here is tens
 * of MB rather than the unbounded hundreds the uncapped bucket counts allowed —
 * see bucketsForCard for why the bucket count is capped at all.
 */
const MAX_ENVELOPE_ENTRIES = 160;
/** Same idea for the per-clip "last drawn" fallbacks (a reference each: no copying). */
const MAX_LAST_ENVELOPE_ENTRIES = 400;

/**
 * Source-time granularity the waveform window is snapped to before it becomes a
 * cache key. Trimming a clip changes mediaOffset/duration on every pointer
 * tick, and each distinct pair used to be its own request (a fresh slice and
 * three fresh arrays) — a trim drag would re-slice every frame. A 20ms quantum
 * is far finer than a waveform can show over a multi-second window, and it
 * cuts that request rate several-fold (see waveformRequestFor).
 */
const WAVEFORM_WINDOW_QUANTUM_SEC = 1 / 50;

/** Snap a source-time value onto the window quantum (non-finite passes through). */
function quantiseWindowSec(value) {
  if (!Number.isFinite(value)) return value;
  return Math.round(value / WAVEFORM_WINDOW_QUANTUM_SEC) * WAVEFORM_WINDOW_QUANTUM_SEC;
}

/**
 * TimelineCanvas — the clip/lane area drawn on ONE canvas instead of one
 * React component per clip.
 *
 * WHY. Every clip used to be a `ClipItem` with its own pointer handlers,
 * sub-lane maths and waveform canvas, so a project with thousands of clips
 * meant thousands of components re-rendering on every drag tick and every
 * scroll. Here the tracks' clips are drawn by a single viewport-sized canvas:
 * cost tracks what is ON SCREEN (a scene range query plus a handful of fills),
 * not how long the project is.
 *
 * HOW IT SITS. The canvas is a viewport-pinned overlay inside
 * `.timeline-scroll-area`, offset past the ruler (top) and the track-header
 * column (left), over a full-size spacer that keeps the scrollable extent
 * identical to the DOM path. It never moves with scrolling — only what it
 * draws changes — so there is no one-frame lag between native scroll and the
 * picture, and native scrolling, the minimap scrollbar and zoom anchoring all
 * keep working unchanged. Track headers stay React (see Timeline.jsx) and line
 * up because both read the same row Y values from utils/timelineScene.js.
 *
 * INTERACTIVITY (plan step 1, hover only): the overlay takes pointer events
 * itself and answers "what's under the pointer" with scene.hitTest, driving
 * two things: (1) a per-zone CSS cursor (col-resize on a trim handle, grab on
 * the body/pickwhip), set imperatively on the host div since it depends on the
 * specific zone under the pointer right now, not on a static selector; (2) a
 * `hover` entry passed into drawTimelineScene's state, which
 * drawClipCard/drawTransitionCard already read (hover?.clipId === item.id) to
 * draw the hover border — that draw-side support predates step 1 and needed no
 * changes.
 *
 * INTERACTIVITY (plan step 2, click select + multi-select): plain click on a
 * clip body selects it (onSelectClip), Shift+click range-selects
 * (onRangeSelect), and Ctrl/Cmd+click toggles it into/out of the current
 * multi-selection (onToggleSelect) — the same three callbacks and the same
 * modifier semantics ClipItem.jsx's handleBodyPointerDown already uses for the
 * DOM path, called here from the canvas's own hitTest instead of a per-card
 * DOM handler. Clicking empty lane space (hitTest returns a 'lane' hit or
 * null) clears the selection (onClearSelection), matching `.lanes-wrapper`'s
 * onClick empty-space check in Timeline.jsx.
 *
 * INTERACTIVITY (plan step 3, lasso/box select): a left-button press that
 * starts on empty lane space (a 'lane' hit or null from hitTest) — rather than
 * on a clip body/zone, which step 2 already claims for click-select — begins a
 * box-select gesture, mirroring Timeline.jsx's own handleLassoStart exactly:
 *   - Shift held at press time makes the gesture ADDITIVE (the existing
 *     selection is kept and the box's hits are unioned into it on release);
 *     otherwise the existing selection is cleared immediately, same as the DOM
 *     path clearing on press rather than waiting for release.
 *   - While the pointer moves, the content-space rect is recomputed every
 *     move (content-space, i.e. including scroll offset, since the canvas
 *     itself never moves — see hitTestAtClientPoint) and (a) pushed into
 *     `state.lasso` for drawTimelineScene to render (drawLasso in
 *     drawTimeline.js already exists and needed no changes) and (b) used to
 *     query `scene.itemsInRect` for a LIVE preview of which clips are inside
 *     it, unioned with the base selection and pushed through the same
 *     selection state Timeline.jsx's DOM path writes to (setSelectedIds) so
 *     the preview highlights during the drag exactly like the DOM lasso's
 *     `mergedSelectedIds` (selectedIds ∪ boxSelectedIds) does.
 *   - The same edge-auto-scroll helper the DOM path uses
 *     (utils/timelineAutoScroll.js) is reused verbatim during the drag.
 *   - On release: if the press never moved past the drag threshold (4px, same
 *     threshold as click-vs-drag elsewhere in this file and in the DOM path's
 *     handleLassoStart), it is not a lasso at all — it is a plain click on
 *     empty space, which seeks the playhead to that time (onSeek), matching
 *     Timeline.jsx's onUp branch for a non-dragged lasso start. If it DID
 *     move, the final rect's hits are unioned with the base selection and
 *     committed via setSelectedIds/setSelectedEntityId (first hit becomes the
 *     active entity, matching the DOM path); an empty, non-additive result
 *     clears the selection instead of leaving stale ids around.
 *   - A press that starts ON a clip (hit.type === 'clip') never starts a
 *     lasso — that is still step 2's click/range/toggle-select path, and (for
 *     the BODY zone specifically) step 4's move/duplicate path below claims it
 *     first. TRIM/PICKWHIP zones are a future step's territory.
 *   - Right-click, middle-click and Alt-click remain untouched (pan/context
 *     menu are not this step's concern either, same as step 2's note).
 *
 * INTERACTIVITY (plan step 4, move/drag + Alt-duplicate): a press on a clip's
 * `BODY` zone starts a move, driven from the canvas's own pointermove/up
 * instead of a per-card DOM handler, but otherwise re-implements
 * ClipItem.jsx's `handleBodyPointerDown` verbatim so the two renderers stay
 * behaviourally identical:
 *   - Shift/Ctrl on a press with no movement still means range/toggle-select
 *     (step 2's job), so a move is only ever committed once the pointer has
 *     actually travelled past the 4px threshold — a plain click on a clip
 *     falls through to handlePointerUp's step-2 selection logic unchanged.
 *   - Alt-drag duplicates the pressed clip (`onDuplicateClips`) and parks the
 *     copy on top of the original before dragging it; releasing without ever
 *     moving deletes the still-parked copy again (Alt+click is not a
 *     duplicate).
 *   - Ctrl/Cmd-drag on the clip body means "drag to set parent" rather than a
 *     move: the clip's startTime/trackId are never touched while Ctrl is held,
 *     a floating badge follows the cursor, and the clip hovered at release
 *     becomes the parent (rejecting cycles via isDescendantOf) — the same
 *     gesture ClipItem.jsx offers on its own card body. The badge is a plain
 *     DOM node appended to `document.body` (identical to ClipItem's), since
 *     nothing about the badge is part of the canvas's own draw pass.
 *   - Dragging any other clip already in the current multi-selection moves the
 *     WHOLE selection together (not just the pressed clip), and every clip's
 *     recursive children move with their parent — same `moveIds` expansion as
 *     ClipItem.jsx.
 *   - Horizontal delta snaps through the same `getSnappedTime` closure
 *     ClipItem.jsx uses (both the new left edge AND the new right edge are
 *     tried against `snappingPoints`), and is clamped so no moving clip's
 *     startTime goes below 0.
 *   - Vertical delta retargets the moved clips' track: the row under the
 *     pointer is read straight from `scene.hitTest` (a `'lane'` or `'clip'`
 *     hit both carry a trackId) rather than `elementsFromPoint('[data-track-id]')`
 *     — the canvas draws no per-card DOM nodes for that query to find — and a
 *     track shift is only applied when EVERY moving clip would land on a
 *     valid, unlocked track index, exactly like ClipItem's `canShiftTracks`.
 *   - Updates are coalesced to at most one `onUpdateClips` per animation
 *     frame during the drag (ClipItem's own `scheduleMoveUpdates` pattern) and
 *     flushed on release so the final position always sticks even if a
 *     scheduled frame hasn't fired yet.
 *   - The same edge-auto-scroll helper the DOM path uses is reused verbatim.
 *
 * INTERACTIVITY (plan step 5, trim handles + transition edges): a press on a
 * clip's `TRIM_LEFT`/`TRIM_RIGHT` zone or a transition's
 * `TRANSITION_EDGE_LEFT`/`TRANSITION_EDGE_RIGHT` zone starts a resize once it
 * crosses the same 4px threshold as every other drag here, dispatched from
 * `handlePointerMove`/`handlePointerLeave` right alongside step 4's
 * BODY-zone move dispatch:
 *   - `startTrimDrag` (TRIM_LEFT/TRIM_RIGHT) re-implements ClipItem.jsx's
 *     `handleLeftTrimPointerDown`/`handleRightTrimPointerDown` verbatim: the
 *     same snapping via `getSnappedTime`, the same 0.2s minimum duration, and
 *     the same `computeTrimmedOffset` adjustment to a left-trimmed clip's
 *     VideoRenderer/AudioSource `mediaOffset` so the in-point stays correct
 *     after the edge moves. Updates are coalesced to one `onUpdateClip` per
 *     animation frame and flushed on release, same as the move drag.
 *   - `startTransitionEdgeDrag` (TRANSITION_EDGE_LEFT/RIGHT) re-implements
 *     TransitionClipItem.jsx's `makeEdgePointerDown` verbatim: the resize
 *     stays symmetric about the cut via `resizeTransitionAboutCut`, and the
 *     ceiling is fixed for the whole gesture from `maxTransitionDuration`
 *     against whichever neighbours (`findTransitionNeighbours`) were there
 *     when the drag began — this clip's own geometry changing mid-drag must
 *     not move the goalposts.
 *   - Both zones only ever reach a press in the first place for an unlocked
 *     item (see `handlePointerDown`'s `!press.hit.item.isLocked` guard,
 *     extended from step 4 to cover these zones too) — a transition's own
 *     `hitTest` zone computation does not itself check `isLocked` (only the
 *     ordinary-clip branch does), so this guard is what keeps a locked
 *     transition's edges inert on the canvas, matching TransitionClipItem.jsx
 *     only rendering its edge-handle `div`s when `!isLocked`.
 *   - A press on either zone that never crosses the drag threshold is a
 *     plain click, not a resize: `handlePointerUp` selects the clip
 *     unconditionally in that case (no Shift/Ctrl range/toggle-select),
 *     matching that neither `ClipItem.jsx`'s trim handlers nor
 *     `TransitionClipItem.jsx`'s `makeEdgePointerDown` check modifiers —
 *     only a body-zone click does.
 *
 * INTERACTIVITY (plan step 6, pickwhip / drag-to-parent): a press on a clip's
 * `PICKWHIP` zone starts a link-drag once it crosses the same 4px threshold as
 * every other drag here, dispatched from `handlePointerMove`/
 * `handlePointerLeave` alongside steps 4 and 5's own dispatch:
 *   - `startPickwhipDrag` re-implements ClipItem.jsx's
 *     `handlePickwhipPointerDown` verbatim: drag from the button onto another
 *     clip to set `parentId`, rejecting cycles via the same `isDescendantOf`
 *     guard used everywhere else in this file. The DOM path floats a
 *     `.pickwhip-drag-ghost` badge that follows the cursor and toggles
 *     `.link-drop-target` on whichever card is hovered; since the canvas
 *     draws no per-card DOM node for either to attach to, both become a
 *     single `state.pickwhip` value (`{sourceClipId, x, y, targetClipId,
 *     isCycle}`) read at draw time — drawPickwhipOverlay in drawTimeline.js
 *     draws the link line from the source card's own pickwhip button to the
 *     live cursor position, and drawClipCard draws the drop-target glow on
 *     whichever card `targetClipId` currently names.
 *   - The target clip and the cycle check are re-evaluated on every
 *     pointer-move from `scene.hitTest`, exactly like the DOM path's own
 *     `elementsFromPoint` + `isDescendantOf` re-check on every mousemove.
 *   - On release, a valid (non-cycle, non-self) target commits
 *     `onUpdateClip(sourceClipId, { parentId: targetClipId })`; releasing
 *     over empty space or an invalid target sets nothing, matching the DOM
 *     path's own "drop here to cancel" behaviour.
 *   - A press on the PICKWHIP button that never crosses the drag threshold is
 *     a plain click with NOTHING to do — `handlePointerUp` treats it as a
 *     no-op, matching that `ClipItem.jsx`'s `handlePickwhipPointerDown` only
 *     calls `e.stopPropagation()`/`e.preventDefault()` and never selects the
 *     clip on its own; only a real drag (via `startPickwhipDrag`) selects the
 *     source clip, the same way a body/trim/transition-edge drag does.
 *   - Only reachable for an unlocked item, same as steps 4 and 5 — a locked
 *     card's PICKWHIP zone is never assigned by `timelineScene.js`'s own
 *     hitTest (its zone computation already excludes locked clips), so
 *     nothing further needs to be guarded here.
 *
 * REDRAW MODEL. Nothing here re-renders React per frame: mutations mark the
 * canvas dirty and a single rAF draws at most once per frame, reading the
 * scroll offsets off the scroll element at draw time. Peaks are requested only
 * for the audio clips that are actually visible and wide enough to read.
 */
export const TimelineCanvas = memo(function TimelineCanvas({
  tracks = [],
  clips = [],
  mediaAssets = [],
  pixelsPerSecond = 40,
  selectedIds = [],
  exportRange = null,
  recordingTrackId = null,
  recordingStartTime = 0,
  recordingLevel = 0,
  silenceCuts = null,
  /** The `.lanes-wrapper` scroll element — source of scrollLeft/scrollTop. */
  scrollRef,
  className = '',
  // ── Selection (plan step 2) ──────────────────────────────────────────
  // Same callbacks Timeline.jsx already passes to the DOM path's TrackLane /
  // ClipItem — reused as-is so selection state stays a single source of
  // truth regardless of which renderer produced the click.
  onSelectClip,
  onToggleSelect,
  onRangeSelect,
  onClearSelection,
  // ── Lasso / box-select (plan step 3) ─────────────────────────────────
  // The DOM path's handleLassoStart writes directly to these rather than
  // going through onSelectClip/onRangeSelect/onToggleSelect (a lasso can
  // select many clips at once, which those three single-id callbacks don't
  // express), so the canvas path reuses the SAME setters instead of
  // inventing a parallel multi-select callback.
  setSelectedIds,
  setSelectedEntityId,
  onSeek,
  // ── Move / Alt-duplicate / Ctrl-parent (plan step 4) ─────────────────
  // Same callbacks and inputs ClipItem.jsx's handleBodyPointerDown already
  // uses for the DOM path — reused as-is so a drag committed from the canvas
  // writes through the exact same mutation path a DOM drag would.
  allClips = clips,
  onUpdateClip,
  onUpdateClips,
  onDuplicateClips,
  snappingPoints = [],
  snappingEnabled = true,
  // ── Right-click context menu ──────────────────────────────────────────
  // Same callbacks ClipItem.jsx's handleContextMenu/<ContextMenu> already
  // use for the DOM path — Timeline.jsx already passes all of these to this
  // component (they were previously unused here, since nothing on the
  // canvas ever opened a menu).
  onDeleteClip,
  onCopySelected,
  onCutSelected,
  onPasteClips,
  onSplitVideoAndAudio,
  onOpenSilenceRemover,
  // ── Drag & drop onto a lane ───────────────────────────────────────────
  // The same callbacks the DOM path's TrackLane receives. In canvas mode the
  // canvas layer is the topmost surface over the lanes, so a media/asset drop
  // lands HERE — the `.track-lane-spacer` rows underneath never see the event
  // (the overlay has pointer-events: auto and sits above them).
  onDropItemOnTrack,
  onAddMediaAsset,
}) {
  const playbackStore = usePlaybackStore();
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  // windowKey -> { status: 'pending' | 'ready' | 'empty', envelope }. A per-key
  // status (rather than one global "something is loading" flag) is what makes
  // the hatched placeholder mean "peaks for THIS clip are still being built" —
  // with a global flag, every clip whose peaks came back empty (long media on
  // Tauri) also showed a hatch whenever any other clip was still decoding.
  const envelopeRef = useRef(new Map());
  const pendingRef = useRef(new Set()); // windowKeys in flight
  // clipId -> the last envelope that actually drew for that clip. Used as a
  // fallback while a NEWER request (a different bucket rung, or a new trim
  // window) is in flight, so the card never drops back to the placeholder and
  // back on a zoom step or a trim drag — see ensureEnvelope. Bounded like
  // envelopeRef: only clips that have drawn something ever get an entry.
  const lastEnvelopeRef = useRef(new Map());
  const [stateVersion, setStateVersion] = useState(0); // bumps when async peaks land
 
  // Current hover result from scene.hitTest, or null when the pointer is off
  // the canvas / over empty space below the last track. Kept in a ref (read by
  // the rAF draw, same as every other draw input below) with `hoverVersion`
  // only bumped when the ANSWER actually changes — hitTest runs on every
  // pointer-move, but re-triggering the draw effect on every one of those
  // would mean a redraw per pixel of mouse travel instead of per hover
  // transition (entering/leaving a clip or zone).
  const hoverRef = useRef(null);
  const [hoverVersion, setHoverVersion] = useState(0);
 
  // Current lasso rect (content-space) while a box-select drag is in
  // progress, or null. Same ref+version pattern as hover: the rAF draw reads
  // the ref, and the version state only exists to make the draw effect re-run
  // on a real change (every pointer-move during a lasso, which is expected —
  // unlike hover, a lasso rect legitimately changes on every move while it's
  // live).
  const lassoRef = useRef(null);
  const [lassoVersion, setLassoVersion] = useState(0);

  // In-progress pickwhip (drag-to-parent) link, or null (plan step 6). Same
  // ref+version pattern as lasso: the pointer moves every frame while a
  // pickwhip drag is live, so — like the lasso rect and unlike hover — this
  // is expected to change on every pointer-move, not just on a transition.
  // Shape: { sourceClipId, x, y, targetClipId, isCycle }.
  const pickwhipRef = useRef(null);
  const [pickwhipVersion, setPickwhipVersion] = useState(0);

  // Track currently under an in-progress drop drag (OS file drop or in-app
  // asset drag), or null. Drives the same blue lane highlight the DOM path
  // gets from `.track-lane-row.drag-target`. Ref+state for the same reason as
  // hover: the rAF draw reads the ref, and the state only re-runs the draw
  // effect when the target lane actually changes rather than on every
  // dragover tick.
  const dragOverTrackIdRef = useRef(null);
  const [dragOverTrackId, setDragOverTrackId] = useState(null);

  // The scene depends ONLY on what changes geometry. `selectedIds` is
  // deliberately NOT here: selection is a draw-time highlight (state.selectedIds
  // below), and keying the layout on it meant every click and every lasso tick
  // re-ran computeTrackLanes (O(tracks x clips)) + computeClipSubLanes over the
  // whole project just to recolour one card. On a long project that is the
  // difference between one rAF redraw and a full re-layout per pointer move.
  const scene = useMemo(
    () => buildTimelineScene({ tracks, clips, pixelsPerSecond, mediaAssets }),
    [tracks, clips, pixelsPerSecond, mediaAssets]
  );
 
  // Latest inputs, read by the rAF draw without making it a dependency (so
  // scroll/peaks redraws don't need React state churn).
  //
  // Written DIRECTLY during render (not inside a useEffect, despite every
  // other ref-mirror in this file using that pattern deliberately — see
  // hoverRef/lassoRef/pickwhipRef above) because this one specifically has
  // to be the freshest value the instant ANY draw() call can fire,
  // including ones triggered synchronously by a DOM 'scroll' event outside
  // React's own commit cycle (see the scroll listener below). A
  // useEffect — even a bare one with no deps array — still only runs
  // AFTER paint, so there was a window on every zoom tick where
  // applyZoomStep (Timeline.jsx) had already written the new scrollLeft
  // (dispatching a synchronous native 'scroll' event -> schedule() ->
  // draw()) before this effect had run to update pixelsPerSecond/scene
  // here — draw() would then paint the NEW scroll position against the
  // OLD zoom level for one frame, then snap to correct a frame later.
  // That mismatch was the reported "canvas mode zoom glitch": writing
  // this inline during render closes the window entirely, since it's
  // guaranteed current by the time any effect (including the scroll
  // listener's synchronous dispatch) can observe it.
  const latestRef = useRef({});
  latestRef.current = {
    scene,
    tracks,
    clips,
    mediaAssets,
    pixelsPerSecond,
    selectedIds,
    exportRange,
    recordingTrackId,
    recordingStartTime,
    recordingLevel,
    silenceCuts,
    dragOverTrackId,
  };
  const themeRef = useRef(null);
 
  /**
   * Remember the newest envelope that drew for a clip, for ensureEnvelope's
   * fallback while the NEXT request for that clip is in flight. Only the
   * reference is kept (the arrays live on in envelopeRef), and the map is
   * bounded by evicting the oldest clip, so a project with hundreds of audio
   * clips cannot grow it without limit.
   */
  const rememberEnvelope = useCallback((clipId, envelope) => {
    if (!clipId) return;
    const store = lastEnvelopeRef.current;
    // Re-insert so Map order stays least-recently-used-first.
    if (store.has(clipId)) store.delete(clipId);
    store.set(clipId, envelope);
    while (store.size > MAX_LAST_ENVELOPE_ENTRIES) {
      store.delete(store.keys().next().value);
    }
  }, []);

  /**
   * Everything needed to identify one clip's waveform request, or null.
   *
   * The url and the media window (the clip's in-point through the amount of
   * SOURCE it consumes) now come straight off the scene item, which resolves
   * them with ClipItem's own rules — see timelineScene.js mediaInfoFor /
   * audioSpeedFor. Deriving them here as well meant two places to keep in step,
   * and the old derivation re-scanned the WHOLE clip array for the parent's
   * Transform speed once per visible audio clip per frame (O(visible x clips) at
   * 60fps on a project with thousands of clips).
   *
   * The bucket count comes from the shared bucketsForCard policy
   * (utils/waveformResolution.js) — the same one WaveformCanvas asks for — so
   * the two renderers, and every zoom level inside one ladder rung, share ONE
   * envelope instead of building a redundant set each.
   */
  const waveformRequestFor = useCallback((item) => {
    if (!wantsWaveform(item)) return null;
    const rect = waveformRectFor(item);
    if (!rect) return null;
    const numPeaks = bucketsForCard(rect.width, rect.height);
    // Quantised so a trim drag (which changes the in/out points every frame)
    // reuses one envelope for a whole run of frames instead of issuing a slice
    // per frame. A clip shorter than the quantum keeps its exact window, so the
    // guard can never collapse it to a zero-width (empty) request.
    let startSec = quantiseWindowSec(item.audioStartSec);
    let endSec = quantiseWindowSec(item.audioEndSec);
    if (!(endSec > startSec)) {
      startSec = item.audioStartSec;
      endSec = item.audioEndSec;
    }
    const url = item.audioUrl;
    return { url, numPeaks, startSec, endSec, key: `${url}::${numPeaks}::${startSec}::${endSec}` };
  }, []);

  /**
   * The envelope for this clip if it is ready, else the last one this clip DID
   * draw (else null, and start loading).
   *
   * Returning a stale envelope rather than null is what removes the "waveform
   * looks like it reloads while I zoom" flicker: a new bucket rung (or a new
   * trim window) is requested asynchronously, and hatching the card until it
   * lands meant every zoom step swapped a real waveform for the placeholder and
   * back. Stretching the previous shape for the frame or two a slice takes is
   * far less jarring — and the previous shape is usually the SAME window at a
   * neighbouring resolution, so it is barely even wrong. (The DOM renderer has
   * done the equivalent for a while: WaveformCanvas debounces its inputs and
   * keeps its last envelope on screen while they settle.)
   */
  const ensureEnvelope = useCallback((item) => {
    const request = waveformRequestFor(item);
    if (!request) return null;
    const { url, numPeaks, startSec, endSec, key } = request;

    const entry = envelopeRef.current.get(key);
    if (entry) {
      if (entry.status === 'ready') return entry.envelope;
      if (entry.status === 'empty') return null; // genuinely no peaks: draw nothing
      // 'pending' falls through to the last-ready fallback below.
    }

    if (!pendingRef.current.has(key)) {
      // Bound the mirror cache by EVICTING the oldest entries. It used to clear
      // the whole map past the cap, which made every clip on screen fall back to
      // the hatch at once (and re-issue its slice) after a long session — the
      // same "waveform reloads" symptom from the other direction.
      if (envelopeRef.current.size > MAX_ENVELOPE_ENTRIES) {
        let toDrop = Math.ceil(MAX_ENVELOPE_ENTRIES / 4);
        for (const stale of envelopeRef.current.keys()) {
          envelopeRef.current.delete(stale);
          if (--toDrop <= 0) break;
        }
      }
      pendingRef.current.add(key);
      envelopeRef.current.set(key, { status: 'pending', envelope: null });
      getWaveformPeaks(url, numPeaks, startSec, endSec)
        .then((envelope) => {
          const ready = Boolean(envelope?.mins?.length);
          envelopeRef.current.set(key, {
            status: ready ? 'ready' : 'empty',
            envelope: ready ? envelope : null,
          });
          if (ready) rememberEnvelope(item.id, envelope);
        })
        .catch(() => {
          envelopeRef.current.set(key, { status: 'empty', envelope: null });
        })
        .finally(() => {
          pendingRef.current.delete(key);
          setStateVersion((v) => v + 1); // schedule a redraw with the real shape
        });
    }
    // Still building: draw this clip's previous shape rather than hatching.
    return lastEnvelopeRef.current.get(item.id) || null;
  }, [waveformRequestFor, rememberEnvelope]);
 
  /** True while THIS clip's waveform is still being fetched/built. */
  const isEnvelopePending = useCallback(
    (item) => {
      const request = waveformRequestFor(item);
      if (!request) return false;
      const entry = envelopeRef.current.get(request.key);
      return !entry || entry.status === 'pending';
    },
    [waveformRequestFor]
  );
 
  /** Draw one frame from the latest inputs. */
  const draw = useCallback(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const scrollEl = scrollRef?.current;
    if (!host || !canvas || !scrollEl) return;
 
    const { scene: currentScene, exportRange: range, recordingTrackId: recTrack, recordingStartTime: recStart, recordingLevel: recLevel, silenceCuts: cuts } = latestRef.current;
    if (!currentScene) return;
 
    if (!themeRef.current) themeRef.current = readTimelineTheme(host);
 
    // Size the backing store to the VISIBLE CONTENT area in device pixels; only
    // touch it when it actually changes (assigning width/height clears the
    // canvas).
    //
    // clientWidth/clientHeight are the content box — the area the scroll offsets
    // apply to — whereas getBoundingClientRect() includes the scrollbar gutters.
    // Sizing from the rect (as this used to) made the canvas 6px taller and
    // wider than the visible content, which painted the lane background straight
    // over .lanes-wrapper's own horizontal scrollbar and drew 6px of lane that
    // is actually scrolled out of view.
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(scrollEl.clientWidth));
    const height = Math.max(1, Math.round(scrollEl.clientHeight));
    const size = sizeRef.current;
    if (size.width !== width || size.height !== height || size.dpr !== dpr) {
      sizeRef.current = { width, height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
 
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
 
    drawTimelineScene(ctx, {
      scene: currentScene,
      theme: themeRef.current,
      view: { scrollLeft: scrollEl.scrollLeft, scrollTop: scrollEl.scrollTop, width, height },
      state: {
        selectedIds: latestRef.current.selectedIds,
        exportRange: range,
        // hoverRef, not hoverVersion: the ref always holds the latest answer,
        // while the version state only exists to trigger this callback's
        // surrounding effect to re-run (see the hover effect below).
        hover: hoverRef.current,
        // Same pattern as hover: the ref holds the live rect, the version
        // state only forces this draw effect to re-run on each change.
        lasso: lassoRef.current,
        // Same pattern again: the ref holds the live pickwhip drag, the
        // version state only forces this draw effect to re-run on each
        // change (every pointer-move while a pickwhip drag is in progress).
        pickwhip: pickwhipRef.current,
        recording: recTrack
          ? {
              trackId: recTrack,
              startTime: recStart,
              // Live playhead time, so the recording bar keeps growing while the
              // user records (LiveRecordingClipPreview reads the same store).
              currentTime: playbackStore?.getCurrentTime?.() ?? recStart,
              level: recLevel,
            }
          : null,
        silenceCuts: cuts,
        // Which lane an in-progress drop is hovering, so drawLaneBackground can
        // paint the same blue `drag-target` highlight the DOM path gets from
        // `.track-lane-row.drag-target`.
        dragOverTrackId: latestRef.current.dragOverTrackId,
        peaksFor: (item) => (wantsWaveform(item) ? ensureEnvelope(item) : null),
        peaksPending: (item) => (wantsWaveform(item) ? isEnvelopePending(item) : false),
      },
    });
  }, [scrollRef, ensureEnvelope, isEnvelopePending, playbackStore]);
 
  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }, [draw]);
 
  // themeRef is filled ONCE (see draw(), `if (!themeRef.current) ...`) so that
  // getComputedStyle isn't paid every frame. That means it never notices a
  // theme change applied later via CSS custom properties on <html> — same
  // problem useWaveformColor.js solves for the per-clip waveform colour (see
  // its header comment): React can't observe a `:root` CSS variable changing,
  // so services/themeSettings.js broadcasts THEME_CHANGED_EVENT after
  // applying one. Subscribe here too, drop the stale cache, and redraw so
  // Settings -> Appearance actually reaches the canvas timeline instead of
  // only the DOM-based one.
  useEffect(() => subscribeThemeChanges(() => {
    themeRef.current = null;
    schedule();
  }), [schedule]);
 
  // Redraw when anything structural changes, and keep the canvas sized to its
  // box (dockview shows/hides panels, so the size can change without a scroll).
  useEffect(() => {
    schedule();
  }, [schedule, scene, selectedIds, exportRange, recordingTrackId, recordingStartTime, recordingLevel, silenceCuts, stateVersion, hoverVersion, lassoVersion, pickwhipVersion, dragOverTrackId]);
 
  // While recording, the preview bar grows with the playhead, which moves
  // without any React re-render — so subscribe to the playback store's frame
  // callbacks exactly like LiveRecordingClipPreview does and redraw. Without
  // this the bar would be frozen at whatever time the layer last re-rendered.
  useEffect(() => {
    if (!recordingTrackId || !playbackStore?.registerFrameCallback) return undefined;
    return playbackStore.registerFrameCallback(() => schedule());
  }, [playbackStore, recordingTrackId, schedule]);
 
  useEffect(() => {
    const scrollEl = scrollRef?.current;
    const host = hostRef.current;
    if (!scrollEl || !host) return undefined;
 
    const onScroll = () => schedule();
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
 
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => schedule());
      observer.observe(host);
    } else {
      window.addEventListener('resize', onScroll);
    }
 
    // Peaks generated in the background (peakCache) arrive after the first
    // draw — redraw so a clip swaps its placeholder for the real waveform.
    const unsubscribePeaks = subscribePeaksUpdated(() => schedule());
 
    schedule();
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', onScroll);
      unsubscribePeaks();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [scrollRef, schedule]);
 
  /**
   * hitTest at this client point, in the scene's content-space coordinates:
   * the pointer's position relative to the canvas element, PLUS the scroll
   * offset (the canvas itself never moves/scrolls — see the file header — so
   * clientX/clientY alone would answer for the wrong, unscrolled content).
   */
  const hitTestAtClientPoint = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    const scrollEl = scrollRef?.current;
    const currentScene = latestRef.current.scene;
    if (!canvas || !scrollEl || !currentScene) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left + scrollEl.scrollLeft;
    const y = clientY - rect.top + scrollEl.scrollTop;
    return currentScene.hitTest(x, y);
  }, [scrollRef]);
 
  /**
   * Same content-space point as hitTestAtClientPoint, but returned as raw
   * {x, y} rather than run through hitTest — the lasso needs the actual
   * coordinate (to build a rect), not what's under it.
   */
  const contentPointAtClientPoint = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    const scrollEl = scrollRef?.current;
    if (!canvas || !scrollEl) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left + scrollEl.scrollLeft, y: clientY - rect.top + scrollEl.scrollTop };
  }, [scrollRef]);
 
  /**
   * Same shape check the draw-time hover comparison needs: two hitTest
   * results count as "the same hover" when they refer to the same clip AND
   * the same zone on it (moving from a clip's body to its trim handle is a
   * real hover change — the cursor differs), or when both are lane hits on
   * the same track (moving along empty lane space is not a change worth a
   * redraw for). Two nulls (pointer off any row) are also equal.
   */
  const sameHover = (a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    if (a.type === 'clip') return a.clipId === b.clipId && a.zone === b.zone;
    if (a.type === 'lane') return a.trackId === b.trackId;
    return false;
  };
 
  // Non-null while a lasso drag (started on empty space) is in progress —
  // checked by handlePointerMove/handlePointerLeave below so their hover
  // bookkeeping steps aside for the window-level drag listeners the lasso
  // installs (startLasso, further down).
  const lassoDragRef = useRef(false);
  // Tracks a left-button press from pointerdown through to pointerup so a
  // click can be told apart from the start of a drag gesture (move, and in a
  // future step trim). Only the DISTANCE matters here, not time: ClipItem.jsx's
  // own drag threshold is like this too, and a slow click should never be
  // mistaken for a drag. This is only used for presses that START ON A CLIP —
  // a press on empty space goes straight to startLasso below instead. A BODY
  // press additionally hands off to startMoveDrag (below) the moment it
  // crosses the drag threshold, at which point handlePointerUp's click
  // handling is skipped for that press (see startMoveDrag's own pointerup).
  const pressRef = useRef(null); // { clientX, clientY, hit } | null
 
  /**
   * Snap a raw content-space time to the nearest snapping point within
   * threshold, identical to ClipItem.jsx's own inline getSnappedTime (same
   * 10px-in-content-space threshold, same "first point within range wins").
   * Kept as a closure over pixelsPerSecond/snappingPoints/snappingEnabled the
   * same way ClipItem.jsx closes over its own props, rather than importing
   * the unrelated segmentDragHelpers.js snap helper written for a different
   * (sub-strip) editing surface.
   */
  const getSnappedTime = useCallback((rawTime) => {
    const { pixelsPerSecond: pps } = latestRef.current;
    if (!snappingEnabled || snappingPoints.length === 0 || !pps) return rawTime;
    const snapThresholdSec = 10 / pps;
    for (const point of snappingPoints) {
      if (Math.abs(rawTime - point) < snapThresholdSec) return point;
    }
    return rawTime;
  }, [snappingEnabled, snappingPoints]);
 
  /**
   * Begin a clip move (or Ctrl-drag-to-parent) from a BODY-zone press,
   * mirroring ClipItem.jsx's handleBodyPointerDown as closely as the two
   * renderers' different DOM shapes allow — see the file header for the
   * behavioural summary. `hit` is the BODY-zone hitTest result from
   * handlePointerDown; `event` is the originating pointerdown event.
   */
  const startMoveDrag = useCallback((event, hit) => {
    const { tracks: currentTracks, clips: currentClips, selectedIds: currentSelectedIds, pixelsPerSecond: pps } = latestRef.current;
    const clip = hit.item.clip;
    if (!clip || !pps) return;
 
    const isSelectedMulti = currentSelectedIds.includes(clip.id);
    const ctrlHeldOnDown = event.ctrlKey || event.metaKey;
 
    // ── Alt/Option + drag = duplicate ────────────────────────────────────
    let isAltDuplicate = false;
    let dupIds = [];
    if (event.altKey && onDuplicateClips) {
      const newIds = onDuplicateClips([clip.id]);
      if (!newIds || newIds.length === 0) return;
      isAltDuplicate = true;
      dupIds = newIds;
      const parkUpdates = newIds.map((newId) => ({ id: newId, updates: { startTime: clip.startTime } }));
      if (parkUpdates.length > 0 && onUpdateClips) onUpdateClips(parkUpdates);
    }
 
    // Keep a multi-selection active when dragging a clip that's part of it
    // (alt-drag always starts from just the pressed clip). Skipped when Ctrl
    // is held on down: a Ctrl+drag must not disturb selection, and a plain
    // Ctrl+click's toggle is handled in handlePointerUp instead.
    if (!isAltDuplicate && !isSelectedMulti && !ctrlHeldOnDown) {
      onSelectClip?.(clip.id);
    }
 
    const startX = event.clientX;
    const startY = event.clientY;
    const origStartTime = clip.startTime;
    let draggedMoved = false;
 
    const allSelectedIds = new Set(isAltDuplicate ? dupIds : (isSelectedMulti ? currentSelectedIds : [clip.id]));
    const moveIds = new Set(allSelectedIds);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const c of currentClips) {
        if (!moveIds.has(c.id) && c.parentId && moveIds.has(c.parentId)) {
          moveIds.add(c.id);
          expanded = true;
        }
      }
    }
 
    const moveOriginals = currentClips
      .filter((c) => moveIds.has(c.id))
      .map((c) => ({
        id: c.id,
        origStartTime: c.startTime,
        origTrackId: c.trackId,
        trackIdx: currentTracks.findIndex((t) => t.id === c.trackId),
      }));
    const minStartTime = Math.min(...moveOriginals.map((mo) => mo.origStartTime));
    const origTrackIdx = currentTracks.findIndex((t) => t.id === clip.trackId);
 
    // ── Ctrl+drag = drag-to-parent ─────────────────────────────────────
    let ctrlParentTargetId = null;
    let ctrlParentBadge = null;
    let ctrlParentActive = false;
    const updateCtrlParentBadgePos = (ev) => {
      if (ctrlParentBadge) {
        ctrlParentBadge.style.left = `${ev.clientX + 14}px`;
        ctrlParentBadge.style.top = `${ev.clientY + 14}px`;
      }
    };
 
    let pendingMoveUpdates = null;
    let moveFrameId = null;
    const flushMoveUpdates = () => {
      moveFrameId = null;
      if (!pendingMoveUpdates) return;
      const updates = pendingMoveUpdates;
      pendingMoveUpdates = null;
      if (onUpdateClips) onUpdateClips(updates);
      else updates.forEach((u) => onUpdateClip?.(u.id, u.updates));
    };
    const scheduleMoveUpdates = (updates) => {
      pendingMoveUpdates = updates;
      if (moveFrameId == null) moveFrameId = requestAnimationFrame(flushMoveUpdates);
    };
 
    const onMove = (moveEvent) => {
      const deltaPx = moveEvent.clientX - startX;
      const deltaTime = deltaPx / pps;
 
      if (Math.abs(deltaPx) > 4 || Math.abs(moveEvent.clientY - startY) > 4) {
        draggedMoved = true;
      }
 
      if (moveEvent.ctrlKey || moveEvent.metaKey) {
        ctrlParentActive = true;
        if (!ctrlParentBadge) {
          ctrlParentBadge = document.createElement('div');
          ctrlParentBadge.className = 'pickwhip-drag-ghost';
          document.body.appendChild(ctrlParentBadge);
        }
        updateCtrlParentBadgePos(moveEvent);
 
        const targetHit = hitTestAtClientPoint(moveEvent.clientX, moveEvent.clientY);
        const targetId = targetHit?.type === 'clip' && targetHit.clipId !== clip.id ? targetHit.clipId : null;
 
        if (targetId) {
          const isCycle = isDescendantOf(targetId, clip.id, currentClips);
          if (!isCycle) {
            ctrlParentTargetId = targetId;
            const targetClip = currentClips.find((c) => c.id === targetId);
            ctrlParentBadge.textContent = `🔗 Set parent: "${targetClip?.name || 'Clip'}"`;
            ctrlParentBadge.classList.add('valid');
          } else {
            ctrlParentTargetId = null;
            ctrlParentBadge.textContent = `⚠️ Cannot link to descendant (Circular)`;
            ctrlParentBadge.classList.remove('valid');
          }
        } else {
          ctrlParentTargetId = null;
          ctrlParentBadge.textContent = `🔗 Drag onto another clip to set parent`;
          ctrlParentBadge.classList.remove('valid');
        }
        return; // Ctrl held: skip normal move/track-retarget logic entirely.
      } else if (ctrlParentBadge) {
        ctrlParentBadge.remove();
        ctrlParentBadge = null;
        ctrlParentTargetId = null;
      }
 
      applyEdgeAutoScroll(moveEvent.clientX, { lanesEl: scrollRef?.current, rulerEl: null, headerWidth: 0, edgeMargin: 60, scrollSpeed: 10 });
 
      const clampedDeltaTime = Math.max(-minStartTime, deltaTime);
      let rawNewStart = origStartTime + clampedDeltaTime;
 
      let finalNewStart = getSnappedTime(rawNewStart);
      const rightEdge = rawNewStart + clip.duration;
      const snappedRight = getSnappedTime(rightEdge);
      if (snappedRight !== rightEdge) {
        finalNewStart = Math.max(0, snappedRight - clip.duration);
      }
 
      const timeDelta = Math.max(-minStartTime, finalNewStart - origStartTime);
 
      // Target track under the pointer, read from the scene's own hitTest
      // (a 'lane' or 'clip' hit both carry a trackId) rather than
      // elementsFromPoint('[data-track-id]') — the canvas draws no per-card
      // DOM node for that query to find.
      const overHit = hitTestAtClientPoint(moveEvent.clientX, moveEvent.clientY);
      const overTrackId = overHit?.type === 'lane' ? overHit.trackId : overHit?.type === 'clip' ? overHit.item.trackId : null;
      let targetTrackIdx = origTrackIdx;
      if (overTrackId) {
        const idx = currentTracks.findIndex((t) => t.id === overTrackId);
        if (idx >= 0) targetTrackIdx = idx;
      }
 
      const trackDelta = (targetTrackIdx >= 0 && origTrackIdx >= 0) ? (targetTrackIdx - origTrackIdx) : 0;
      const canShiftTracks = moveOriginals.every((mo) => {
        const newIdx = mo.trackIdx + trackDelta;
        return newIdx >= 0 && newIdx < currentTracks.length && !currentTracks[newIdx]?.locked;
      });
 
      const batchUpdates = moveOriginals.map((mo) => {
        const newStart = Math.max(0, mo.origStartTime + timeDelta);
        const newTrackId = (canShiftTracks && trackDelta !== 0 && currentTracks[mo.trackIdx + trackDelta])
          ? currentTracks[mo.trackIdx + trackDelta].id
          : mo.origTrackId;
        return { id: mo.id, updates: { startTime: newStart, trackId: newTrackId } };
      });
 
      scheduleMoveUpdates(batchUpdates);
    };
 
    const onUp = () => {
      if (moveFrameId != null) {
        cancelAnimationFrame(moveFrameId);
        moveFrameId = null;
      }
      flushMoveUpdates();
 
      if (ctrlParentBadge) {
        ctrlParentBadge.remove();
        ctrlParentBadge = null;
      }
      if (ctrlParentTargetId) {
        if (ctrlParentTargetId !== clip.id && !isDescendantOf(ctrlParentTargetId, clip.id, currentClips)) {
          onUpdateClip?.(clip.id, { parentId: ctrlParentTargetId });
        }
        ctrlParentTargetId = null;
      }
 
      if (ctrlHeldOnDown && !ctrlParentActive && !draggedMoved) {
        onToggleSelect?.(clip.id);
      }
 
      if (isAltDuplicate && !draggedMoved) {
        // Alt+click with no actual drag: remove the copy parked on the original.
        dupIds.forEach((id) => onUpdateClip?.(id, { _delete: true }));
      }
 
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
 
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [scrollRef, hitTestAtClientPoint, getSnappedTime, onSelectClip, onToggleSelect, onUpdateClip, onUpdateClips, onDuplicateClips]);

  /**
   * Begin an ordinary clip's trim (TRIM_LEFT / TRIM_RIGHT zone), mirroring
   * ClipItem.jsx's `handleLeftTrimPointerDown`/`handleRightTrimPointerDown`
   * verbatim (plan step 5) — see the file header for the behavioural
   * summary. `hit` is the TRIM_LEFT/TRIM_RIGHT-zone hitTest result from
   * handlePointerDown; `side` is `'left'` or `'right'`; `event` is the
   * originating pointerdown event.
   */
  const startTrimDrag = useCallback((event, hit, side) => {
    const clip = hit.item.clip;
    const { pixelsPerSecond: pps } = latestRef.current;
    if (!clip || !pps) return;

    onSelectClip?.(clip.id);

    const startX = event.clientX;
    const origStartTime = clip.startTime;
    const origDuration = clip.duration;

    // Coalesce trim commits to at most one per animation frame (same
    // rationale as startMoveDrag's scheduleMoveUpdates), flushed on release
    // so the final size always sticks even if a scheduled frame hasn't
    // fired yet.
    let pendingTrimUpdate = null;
    let trimFrameId = null;
    const flushTrimUpdate = () => {
      trimFrameId = null;
      if (!pendingTrimUpdate) return;
      const next = pendingTrimUpdate;
      pendingTrimUpdate = null;
      onUpdateClip?.(clip.id, next);
    };
    const scheduleTrimUpdate = (updates) => {
      pendingTrimUpdate = updates;
      if (trimFrameId == null) trimFrameId = requestAnimationFrame(flushTrimUpdate);
    };

    const onMove = (moveEvent) => {
      applyEdgeAutoScroll(moveEvent.clientX, { lanesEl: scrollRef?.current, rulerEl: null, headerWidth: 0, edgeMargin: 60, scrollSpeed: 8 });

      const deltaPx = moveEvent.clientX - startX;
      const deltaTime = deltaPx / pps;

      if (side === 'left') {
        let newStartTime = Math.max(0, origStartTime + deltaTime);
        newStartTime = getSnappedTime(newStartTime);

        const appliedDeltaTime = newStartTime - origStartTime;
        const newDuration = origDuration - appliedDeltaTime;

        if (newDuration >= 0.2) {
          // Adjust mediaOffset for VideoRenderer / AudioSource components.
          // appliedDeltaTime is a TIMELINE delta, so it must be scaled by the
          // component's own speed to get the correct SOURCE-time offset —
          // see utils/mediaOffset.js for why this matters.
          const updatedComps = clip.components?.map((c) => {
            if (c.type === 'VideoRenderer' || c.type === 'AudioSource') {
              const origOffset = c.mediaOffset || 0;
              const speed = c.speed || 1;
              return {
                ...c,
                mediaOffset: computeTrimmedOffset(origOffset, appliedDeltaTime, speed),
              };
            }
            return c;
          });
          scheduleTrimUpdate({
            startTime: newStartTime,
            duration: newDuration,
            components: updatedComps || clip.components,
          });
        }
      } else {
        let rawNewDuration = Math.max(0.2, origDuration + deltaTime);

        const targetEnd = origStartTime + rawNewDuration;
        const snappedEnd = getSnappedTime(targetEnd);
        if (snappedEnd !== targetEnd) {
          rawNewDuration = Math.max(0.2, snappedEnd - origStartTime);
        }

        scheduleTrimUpdate({ duration: rawNewDuration });
      }
    };

    const onUp = () => {
      if (trimFrameId != null) {
        cancelAnimationFrame(trimFrameId);
        trimFrameId = null;
      }
      flushTrimUpdate();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [scrollRef, getSnappedTime, onSelectClip, onUpdateClip]);

  /**
   * Begin a transition's edge resize (TRANSITION_EDGE_LEFT / _RIGHT zone),
   * mirroring TransitionClipItem.jsx's `makeEdgePointerDown` verbatim (plan
   * step 5) — see the file header for the behavioural summary. `hit` is the
   * TRANSITION_EDGE_LEFT/_RIGHT-zone hitTest result from handlePointerDown;
   * `edge` is `'start'` or `'end'` (resizeTransitionAboutCut's own naming);
   * `event` is the originating pointerdown event.
   */
  const startTransitionEdgeDrag = useCallback((event, hit, edge) => {
    const clip = hit.item.clip;
    const { pixelsPerSecond: pps, clips: currentClips, mediaAssets: currentMediaAssets } = latestRef.current;
    if (!clip || !pps) return;

    onSelectClip?.(clip.id);

    const origStart = clip.startTime;
    const origDuration = clip.duration;
    const startX = event.clientX;
    const edgeStartTime = edge === 'start' ? origStart : origStart + origDuration;
    // The ceiling is fixed for the whole gesture: the neighbours are the ones
    // that were there when the drag began (this clip's own geometry changing
    // must not move the goalposts mid-drag) — same reasoning as
    // TransitionClipItem.jsx's own makeEdgePointerDown.
    const mediaDurations = buildMediaDurationsFromAssets(currentClips, currentMediaAssets);
    const { a, b } = findTransitionNeighbours(clip, currentClips);
    const ceiling = a && b ? maxTransitionDuration(a, b, mediaDurations) : Infinity;

    const onMove = (moveEvent) => {
      applyEdgeAutoScroll(moveEvent.clientX, { lanesEl: scrollRef?.current, rulerEl: null, headerWidth: 0, edgeMargin: 60, scrollSpeed: 8 });

      const dx = moveEvent.clientX - startX;
      const { startTime, duration } = resizeTransitionAboutCut({
        edge,
        origStart,
        origDuration,
        rawEdgeTime: edgeStartTime + dx / pps,
        maxDuration: ceiling,
      });
      onUpdateClip?.(clip.id, { startTime, duration });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [scrollRef, onSelectClip, onUpdateClip]);

  /**
   * Begin a pickwhip (drag-to-parent) link from the PICKWHIP-zone button
   * (plan step 6), mirroring ClipItem.jsx's `handlePickwhipPointerDown`
   * verbatim: drag from the button to another clip to set `parentId`,
   * rejecting cycles via `isDescendantOf` exactly as the DOM path does. The
   * DOM path floats a `.pickwhip-drag-ghost` badge and toggles
   * `.link-drop-target` on the hovered card's own element; the canvas has no
   * per-card DOM node for either, so both become a single `state.pickwhip`
   * value — {sourceClipId, x, y, targetClipId, isCycle} — read at draw time
   * by drawPickwhipOverlay (the link line) and drawClipCard (the drop-target
   * glow on whichever card `targetClipId` names). `hit` is the PICKWHIP-zone
   * hitTest result from handlePointerDown; `event` is the originating
   * pointerdown event.
   */
  const startPickwhipDrag = useCallback((event, hit) => {
    const clip = hit.item.clip;
    if (!clip) return;

    onSelectClip?.(clip.id);

    const setPickwhip = (next) => {
      pickwhipRef.current = next;
      setPickwhipVersion((v) => v + 1);
    };
    setPickwhip({ sourceClipId: clip.id, x: 0, y: 0, targetClipId: null, isCycle: false });

    const onMove = (moveEvent) => {
      const point = contentPointAtClientPoint(moveEvent.clientX, moveEvent.clientY);
      if (!point) return;
      const { clips: currentClips } = latestRef.current;
      const targetHit = hitTestAtClientPoint(moveEvent.clientX, moveEvent.clientY);
      const targetId = targetHit?.type === 'clip' && targetHit.clipId !== clip.id ? targetHit.clipId : null;
      const isCycle = targetId ? isDescendantOf(targetId, clip.id, currentClips) : false;
      setPickwhip({
        sourceClipId: clip.id,
        x: point.x,
        y: point.y,
        targetClipId: targetId,
        isCycle,
      });
    };

    const onUp = () => {
      const pending = pickwhipRef.current;
      const { clips: currentClips } = latestRef.current;
      if (pending?.targetClipId && pending.targetClipId !== clip.id && !isDescendantOf(pending.targetClipId, clip.id, currentClips)) {
        onUpdateClip?.(clip.id, { parentId: pending.targetClipId });
      }
      setPickwhip(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [contentPointAtClientPoint, hitTestAtClientPoint, onSelectClip, onUpdateClip]);
 
  const handlePointerMove = useCallback((event) => {
    if (lassoDragRef.current) return;
 
    // A pending BODY/TRIM/TRANSITION_EDGE-zone press (see
    // handlePointerDown/pressRef) becomes a real move/trim/transition-resize
    // drag the instant it crosses the same 4px threshold ClipItem.jsx /
    // TransitionClipItem.jsx use — handed off to the matching startXxxDrag
    // here rather than in handlePointerDown itself, since a plain click must
    // NOT start a drag, only a press that actually moves. Once claimed,
    // pressRef is cleared so this only fires once per press and so
    // handlePointerUp's own movedPx check (for the case a drag never
    // happens) still applies to presses this function never touches.
    const press = pressRef.current;
    if (press && press.hit?.type === 'clip' && !press.hit.item.isLocked) {
      const movedPx = Math.abs(event.clientX - press.clientX) + Math.abs(event.clientY - press.clientY);
      if (movedPx > 4) {
        const zone = press.hit.zone;
        if (zone === CLIP_ZONES.BODY) {
          pressRef.current = null;
          startMoveDrag(event, press.hit);
          return;
        }
        if (zone === CLIP_ZONES.TRIM_LEFT || zone === CLIP_ZONES.TRIM_RIGHT) {
          pressRef.current = null;
          startTrimDrag(event, press.hit, zone === CLIP_ZONES.TRIM_LEFT ? 'left' : 'right');
          return;
        }
        if (zone === CLIP_ZONES.TRANSITION_EDGE_LEFT || zone === CLIP_ZONES.TRANSITION_EDGE_RIGHT) {
          pressRef.current = null;
          startTransitionEdgeDrag(event, press.hit, zone === CLIP_ZONES.TRANSITION_EDGE_LEFT ? 'start' : 'end');
          return;
        }
        if (zone === CLIP_ZONES.PICKWHIP) {
          pressRef.current = null;
          startPickwhipDrag(event, press.hit);
          return;
        }
      }
    }
 
    const hit = hitTestAtClientPoint(event.clientX, event.clientY);
    const host = hostRef.current;
    if (host) {
      // Cursor is set imperatively rather than through a CSS class: it has to
      // reflect the specific zone under the pointer RIGHT NOW (trim handle vs.
      // card body vs. pickwhip vs. bare lane), which is exactly what
      // cursorForZone already encodes for the DOM path — reused here so a
      // pointer that would grab a handle in the DOM path shows the same
      // cursor in the canvas path.
      host.style.cursor = hit?.type === 'clip' ? cursorForZone(hit.zone) : 'default';
    }
    if (!sameHover(hoverRef.current, hit)) {
      hoverRef.current = hit && hit.type === 'clip' ? { clipId: hit.clipId, zone: hit.zone } : null;
      setHoverVersion((v) => v + 1);
    }
  }, [hitTestAtClientPoint, startMoveDrag, startTrimDrag, startTransitionEdgeDrag, startPickwhipDrag]);
 
  const handlePointerLeave = useCallback((event) => {
    if (lassoDragRef.current) return;
 
    // A pending BODY/TRIM/TRANSITION_EDGE press whose pointer leaves the
    // canvas before crossing the drag threshold (React's onPointerMove only
    // fires while the pointer is over the host div) still needs to become a
    // real drag once it's clearly moved — the threshold check here mirrors
    // handlePointerMove's, using this leave event's own coordinates. Once
    // the matching startXxxDrag installs its own window-level listeners the
    // drag keeps tracking the pointer fine even outside the canvas bounds
    // (same reasoning as the lasso's window listeners).
    const press = pressRef.current;
    if (press && press.hit?.type === 'clip' && !press.hit.item.isLocked) {
      const movedPx = Math.abs(event.clientX - press.clientX) + Math.abs(event.clientY - press.clientY);
      if (movedPx > 4) {
        const zone = press.hit.zone;
        pressRef.current = null;
        if (zone === CLIP_ZONES.BODY) {
          startMoveDrag(event, press.hit);
        } else if (zone === CLIP_ZONES.TRIM_LEFT || zone === CLIP_ZONES.TRIM_RIGHT) {
          startTrimDrag(event, press.hit, zone === CLIP_ZONES.TRIM_LEFT ? 'left' : 'right');
        } else if (zone === CLIP_ZONES.TRANSITION_EDGE_LEFT || zone === CLIP_ZONES.TRANSITION_EDGE_RIGHT) {
          startTransitionEdgeDrag(event, press.hit, zone === CLIP_ZONES.TRANSITION_EDGE_LEFT ? 'start' : 'end');
        } else if (zone === CLIP_ZONES.PICKWHIP) {
          startPickwhipDrag(event, press.hit);
        }
      }
    }
 
    const host = hostRef.current;
    if (host) host.style.cursor = 'default';
    if (hoverRef.current !== null) {
      hoverRef.current = null;
      setHoverVersion((v) => v + 1);
    }
  }, [startMoveDrag, startTrimDrag, startTransitionEdgeDrag, startPickwhipDrag]);
 
 
  /**
   * Begin a box-select drag, mirroring Timeline.jsx's handleLassoStart:
   * Shift makes it additive (keep the current selection, union into it on
   * release); otherwise the selection is cleared immediately. Listens on
   * `window` for move/up rather than the canvas host, same reasoning as the
   * DOM path — the pointer can leave the canvas bounds mid-drag (dragging a
   * lasso toward the edge to trigger auto-scroll) and the gesture must not
   * end just because the cursor crossed the element boundary.
   */
  const startLasso = useCallback((event, startPoint) => {
    lassoDragRef.current = true;
    const isAdditive = event.shiftKey;
    const baseSelected = isAdditive ? [...(latestRef.current.selectedIds || [])] : [];
    let hasMoved = false;
 
    lassoRef.current = { x0: startPoint.x, y0: startPoint.y, x1: startPoint.x, y1: startPoint.y };
    setLassoVersion((v) => v + 1);
    if (!isAdditive) {
      setSelectedIds?.([]);
      onClearSelection?.();
    }
 
    const onMove = (me) => {
      const point = contentPointAtClientPoint(me.clientX, me.clientY);
      if (!point) return;
      if (Math.abs(point.x - startPoint.x) > 4 || Math.abs(point.y - startPoint.y) > 4) {
        hasMoved = true;
      }
      const rect = { x0: startPoint.x, y0: startPoint.y, x1: point.x, y1: point.y };
      lassoRef.current = rect;
      setLassoVersion((v) => v + 1);
 
      // Live preview: union the base selection with whatever the box
      // currently covers, same as the DOM path's mergedSelectedIds
      // (selectedIds ∪ boxSelectedIds) recomputed on every lasso tick.
      const currentScene = latestRef.current.scene;
      if (currentScene && setSelectedIds) {
        const hitIds = currentScene.itemsInRect(rect).map((item) => item.id);
        setSelectedIds([...new Set([...baseSelected, ...hitIds])]);
      }
 
      // Edge auto-scroll during the drag, same helper/behavior as the DOM
      // lasso (utils/timelineAutoScroll.js). headerWidth is 0 here (unlike
      // the DOM path's HEADER_WIDTH): the canvas's own scroll element is
      // already the lanes-only viewport, with the track-header column laid
      // out separately (see the file header), so there is no header offset
      // to subtract from the pointer's clientX. rulerEl is left null since
      // this component has no reference to the ruler's own scroll element —
      // Timeline.jsx keeps the two scrolled in sync elsewhere regardless.
      applyEdgeAutoScroll(me.clientX, {
        lanesEl: scrollRef?.current,
        rulerEl: null,
        headerWidth: 0,
        edgeMargin: 40,
        scrollSpeed: 10,
      });
    };
 
    const onUp = (upEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      lassoDragRef.current = false;
      lassoRef.current = null;
      setLassoVersion((v) => v + 1);
 
      // A cancelled gesture (touch taken over by the OS, window lost the
      // pointer) has no meaningful end point: drop the lasso, don't select.
      if (upEvent.type === 'pointercancel') return;
 
      if (hasMoved) {
        const point = contentPointAtClientPoint(upEvent.clientX, upEvent.clientY) || startPoint;
        const rect = { x0: startPoint.x, y0: startPoint.y, x1: point.x, y1: point.y };
        const currentScene = latestRef.current.scene;
        const hitIds = currentScene ? currentScene.itemsInRect(rect).map((item) => item.id) : [];
        const finalIds = [...new Set([...baseSelected, ...hitIds])];
        if (finalIds.length > 0) {
          setSelectedIds?.(finalIds);
          setSelectedEntityId?.(finalIds[0]);
        } else if (!isAdditive) {
          setSelectedIds?.([]);
          setSelectedEntityId?.(null);
        }
      } else {
        // No movement past the threshold: this was a plain click on empty
        // lane space, not a lasso — seek the playhead there, matching the
        // DOM path's onUp branch for a non-dragged lasso start.
        const currentScene = latestRef.current.scene;
        if (currentScene) onSeek?.(Math.max(0, currentScene.xToTime(startPoint.x)));
      }
    };
 
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [contentPointAtClientPoint, scrollRef, setSelectedIds, setSelectedEntityId, onClearSelection, onSeek]);
 
  /**
   * Right-click / middle-click / Alt-drag pan, reimplemented verbatim from
   * Timeline.jsx's own handlePanStart.
   *
   * WHY THIS EXISTS. Panning used to be handled by `.lanes-wrapper`'s own
   * onPointerDown (handleLanesPointerDown -> handlePanStart) further down in
   * the DOM. That worked fine back when `.timeline-canvas-layer` had
   * `pointer-events: none` (see canvas-timeline.css's history): every
   * pointer event landing in the lanes area passed straight through the
   * (inert) canvas overlay to `.lanes-wrapper` underneath, pan included.
   *
   * Once the canvas layer became the real interactive surface
   * (`pointer-events: auto`, needed for click-select/move-drag/etc. to work
   * at all), it started winning the browser's hit-test for every pointer in
   * that region. `.lanes-wrapper` is a SIBLING of this overlay, not an
   * ancestor (see the file header), so its onPointerDown can no longer fire
   * for anything landing on the canvas — pan silently died the same way
   * click-select did before `pointer-events: auto` was added, just for a
   * different gesture. This re-implements the same scroll-drag mechanics
   * here so the canvas, now that it owns the surface, is responsible for
   * forwarding to it.
   */
  const startPanDrag = useCallback((event) => {
    const scroller = scrollRef?.current;
    if (!scroller) return;
    event.preventDefault();
    const isRightButton = event.button === 2;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startScrollLeft = scroller.scrollLeft;
    const startScrollTop = scroller.scrollTop;
    let hasMoved = false;

    const onMove = (me) => {
      if (!hasMoved) {
        const movedPx = Math.abs(me.clientX - startClientX) + Math.abs(me.clientY - startClientY);
        if (movedPx > 2) hasMoved = true;
      }
      scroller.scrollLeft = startScrollLeft - (me.clientX - startClientX);
      scroller.scrollTop = startScrollTop - (me.clientY - startClientY);
    };
    // Right-click-drag needs its context menu suppressed only for the
    // gesture that actually panned — a right-click with no movement should
    // still open the menu normally, same as Timeline.jsx's own
    // handlePanStart.
    const onContextMenu = (ce) => {
      if (isRightButton && hasMoved) {
        ce.preventDefault();
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (isRightButton) {
        // 'contextmenu' fires right after 'pointerup' for the same
        // right-click, so this listener must still be attached when it
        // fires — remove it on the next tick instead of now.
        setTimeout(() => {
          window.removeEventListener('contextmenu', onContextMenu, true);
        }, 0);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    if (isRightButton) {
      window.addEventListener('contextmenu', onContextMenu, true);
    }
  }, [scrollRef]);

  /**
   * Right-click clip menu (cut/copy/paste/duplicate/split audio/cut
   * silence/parent linking), ported from the old DOM ClipItem.jsx's own
   * handleContextMenu/<ContextMenu>. The canvas is the only renderer now —
   * ClipItem.jsx has been removed — so this is the sole implementation of
   * that menu. Same menu items, same enable/disable conditions, same
   * selection-then-act sequencing (right-clicking a clip outside the
   * current selection selects it first, deferring the copy/cut/paste
   * handler by one tick so it sees the updated selection — same as
   * ClipItem.jsx's own selectionWillChange ref).
   */
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, clipId } | null
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
  const ctxSelectionWillChangeRef = useRef(false);

  // Bare-lane right-click menu, ported from TrackLane.handleLaneContextMenu:
  // { x, y, time } | null. Clips stop their own contextmenu at the hit test
  // above, so this only ever opens on empty lane space.
  const [laneMenu, setLaneMenu] = useState(null);
  const closeLaneMenu = useCallback(() => setLaneMenu(null), []);

  const handleContextMenu = useCallback((event) => {
    const hit = hitTestAtClientPoint(event.clientX, event.clientY);

    // Empty lane space -> Paste menu at the clicked time. A locked track can't
    // receive new clips, so it falls through to the browser default.
    if (hit?.type === 'lane') {
      if (hit.track?.locked) return;
      event.preventDefault();
      setCtxMenu(null);
      setLaneMenu({ x: event.clientX, y: event.clientY, time: hit.time });
      return;
    }

    if (hit?.type !== 'clip' || hit.item.kind === 'transition') return; // No menu for transitions, or empty space past the last track.
    event.preventDefault();
    setLaneMenu(null);

    const { selectedIds: currentSelectedIds } = latestRef.current;
    const clipId = hit.clipId;
    const alreadySelected = currentSelectedIds.includes(clipId);
    if (!alreadySelected) {
      ctxSelectionWillChangeRef.current = true;
      onSelectClip?.(clipId);
    } else {
      ctxSelectionWillChangeRef.current = false;
    }

    setCtxMenu({ x: event.clientX, y: event.clientY, clipId });
  }, [hitTestAtClientPoint, onSelectClip]);

  const runOnCtxSelection = useCallback((fn) => {
    closeCtxMenu();
    if (!fn) return;
    if (ctxSelectionWillChangeRef.current) setTimeout(fn, 0);
    else fn();
  }, [closeCtxMenu]);

  const handlePointerDown = useCallback((event) => {
    // Right mouse button or middle mouse button: pan, not select/move/lasso
    // — matches Timeline.jsx's own handleLanesPointerDown ordering (pan
    // claims these buttons unconditionally; only a plain left-button press
    // falls through to click/move/lasso below). Alt is checked separately
    // below (after the clip-hit test) since Alt+drag on a CLIP body is still
    // step 4's duplicate-drag gesture, not pan.
    if (event.button === 2 || event.button === 1) {
      startPanDrag(event);
      return;
    }
    if (event.button !== 0) return;
    const hit = hitTestAtClientPoint(event.clientX, event.clientY);

    // A press on a clip (any zone) is step 2's click/range/toggle-select
    // territory, and — for the BODY zone specifically — step 4's
    // move/Alt-duplicate/Ctrl-parent territory. Either way, never a lasso.
    if (hit?.type === 'clip') {
      if (event.altKey && hit.zone !== CLIP_ZONES.BODY) return; // Alt only means something on BODY.
      pressRef.current = { clientX: event.clientX, clientY: event.clientY, hit };
      return;
    }
    if (event.altKey) {
      // Alt-drag on empty space is pan (matches handleLanesPointerDown's own
      // e.altKey check), not this step's concern otherwise.
      startPanDrag(event);
      return;
    }

    // Empty lane space or off any row: start a lasso. Whether this ends up
    // being a real box-select or just a click-to-seek is decided on release
    // inside startLasso (the `hasMoved` check there).
    const startPoint = contentPointAtClientPoint(event.clientX, event.clientY);
    if (!startPoint) return;
    pressRef.current = null;
    startLasso(event, startPoint);
  }, [hitTestAtClientPoint, contentPointAtClientPoint, startLasso, startPanDrag]);
 
  const handlePointerUp = useCallback((event) => {
    const press = pressRef.current;
    pressRef.current = null;
    // A BODY-zone press that crossed the drag threshold was already claimed
    // by handlePointerMove (which calls startMoveDrag and clears pressRef) —
    // so if pressRef is still set here, either no drag ever started (a plain
    // click) or the press was on a non-move-eligible target (a locked clip,
    // or a non-BODY zone) with nothing to do yet. Either way, a press that
    // DID move more than a few pixels without being claimed above is a drag
    // attempt with nothing to do, so it stays inert rather than silently
    // selecting whatever was under the ORIGINAL pointer-down point — same
    // threshold spirit as ClipItem.jsx's own drag detection.
    if (!press || event.button !== 0) return;
 
    const hit = press.hit;
    const movedPx = Math.abs(event.clientX - press.clientX) + Math.abs(event.clientY - press.clientY);
    if (movedPx > 4) return;
 
    if (hit?.type === 'clip') {
      // Locked clips can still be selected (ClipItem.jsx allows selecting a
      // locked clip — only its drag/trim are blocked), so isLocked is not
      // checked here.
      //
      // Trim/transition-edge handles select unconditionally on a plain
      // click, matching ClipItem.jsx's handleLeftTrimPointerDown /
      // handleRightTrimPointerDown and TransitionClipItem.jsx's
      // makeEdgePointerDown — none of which check Shift/Ctrl. Those
      // modifiers only mean range/toggle-select on a BODY-zone click.
      if (
        hit.zone === CLIP_ZONES.TRIM_LEFT ||
        hit.zone === CLIP_ZONES.TRIM_RIGHT ||
        hit.zone === CLIP_ZONES.TRANSITION_EDGE_LEFT ||
        hit.zone === CLIP_ZONES.TRANSITION_EDGE_RIGHT
      ) {
        onSelectClip?.(hit.clipId);
        return;
      }
      // A plain click (no drag) on the PICKWHIP button is a no-op — matching
      // ClipItem.jsx's handlePickwhipPointerDown, which calls
      // e.stopPropagation() and never selects the clip on its own; only an
      // actual pickwhip DRAG (handled by startPickwhipDrag once the 4px
      // threshold is crossed) selects the source clip.
      if (hit.zone === CLIP_ZONES.PICKWHIP) return;
      if (event.shiftKey) {
        onRangeSelect?.(hit.clipId);
      } else if (event.ctrlKey || event.metaKey) {
        onToggleSelect?.(hit.clipId);
      } else {
        onSelectClip?.(hit.clipId);
      }
      return;
    }
 
    // A press that reaches here without a `hit.type === 'clip'` no longer
    // happens in practice (handlePointerDown routes any non-clip press
    // through startLasso instead of pressRef above) — kept as a safe
    // fallback matching `.lanes-wrapper`'s onClick empty-space check for the
    // DOM path in Timeline.jsx.
    onSelectClip?.(null);
    onClearSelection?.();
  }, [onSelectClip, onToggleSelect, onRangeSelect, onClearSelection]);

  // Context menu item content, derived once per open menu. Same conditions
  // ClipItem.jsx's own menu uses, just read off the scene item (isLocked,
  // hasAudio, hasVideo) instead of ClipItem's own props, since the canvas
  // has no per-clip component to read them from directly.
  const ctxClip = ctxMenu ? (scene?.byId?.get(ctxMenu.clipId)?.clip ?? null) : null;
  const ctxItem = ctxMenu ? scene?.byId?.get(ctxMenu.clipId) : null;
  const ctxIsLocked = !!ctxItem?.isLocked;
  const ctxIsMulti = ctxMenu ? selectedIds.includes(ctxMenu.clipId) && selectedIds.length > 1 : false;
  const ctxActiveTargetIds = ctxMenu ? (ctxIsMulti ? selectedIds : [ctxMenu.clipId]) : [];
  const ctxHasAudioChild = ctxClip ? allClips.some((c) => c.parentId === ctxClip.id && isAudioEntity(c)) : false;
  const ctxShowSplitAudio = ctxClip && !ctxIsLocked && isVideoEntity(ctxClip) && !ctxHasAudioChild && !!onSplitVideoAndAudio;
  const ctxEligibleParents = ctxClip
    ? allClips.filter((c) => c.id !== ctxClip.id && c.id !== ctxClip.parentId && !isDescendantOf(c.id, ctxClip.id, allClips))
    : [];
  const ctxShowQuickLinks = ctxClip && !ctxIsLocked && ctxEligibleParents.length > 0 && ctxEligibleParents.length <= 6;
  const ctxGapUpdates = useMemo(
    () => (ctxIsMulti && onUpdateClips ? buildGapRemovalUpdates(allClips, selectedIds) : []),
    [ctxIsMulti, onUpdateClips, allClips, selectedIds]
  );
  const ctxShowRemoveGaps = ctxClip && !ctxIsLocked && ctxIsMulti && !!onUpdateClips && ctxGapUpdates.length > 0;

  const handleCtxCut = () => runOnCtxSelection(onCutSelected);
  const handleCtxCopy = () => runOnCtxSelection(onCopySelected);
  const handleCtxPaste = () => runOnCtxSelection(onPasteClips);
  const handleCtxRemoveGaps = () => {
    closeCtxMenu();
    if (ctxGapUpdates.length > 0) onUpdateClips(ctxGapUpdates);
  };
  const handleCtxDuplicate = () => {
    const newIds = onDuplicateClips?.(ctxActiveTargetIds);
    if (newIds && newIds.length > 0) onSelectClip?.(newIds[0]);
    closeCtxMenu();
  };
  const handleCtxSplitAudio = () => {
    onSplitVideoAndAudio?.(ctxClip.id);
    closeCtxMenu();
  };
  const handleCtxUnlinkParent = () => {
    onUpdateClip?.(ctxClip.id, { parentId: null });
    closeCtxMenu();
  };
  const handleCtxSetParent = (parentId) => {
    onUpdateClip?.(ctxClip.id, { parentId });
    closeCtxMenu();
  };

  const handleLanePaste = () => {
    const at = laneMenu?.time;
    closeLaneMenu();
    // Paste lands at the playhead, so move the playhead to the clicked spot
    // first. Store updates are synchronous, but the paste handler reads the
    // playhead time when it runs, so defer one tick to be safe.
    if (Number.isFinite(at) && onSeek) onSeek(at);
    setTimeout(() => onPasteClips?.(), 0);
  };

  // ── Drag & drop onto a lane ───────────────────────────────────────────
  // The canvas layer is the topmost surface over the lanes, so in this mode a
  // dragged media asset / project item lands here — Timeline.jsx's per-row
  // `.track-lane-spacer` divs never receive the event. Same payload handling
  // as the DOM path, via the shared spawnDroppedItemOnTrack helper.

  /** The scene row whose Y range contains a content-space y, or null. */
  const trackRowAtContentY = useCallback((y) => {
    const currentScene = latestRef.current.scene;
    if (!currentScene) return null;
    return currentScene.rows.find((row) => y >= row.y && y < row.y + row.height) || null;
  }, []);

  /** Is this drag one the timeline handles (in-app JSON payload or OS files)? */
  const isTrackDrop = (event) => {
    const dt = event.dataTransfer;
    if (!dt) return false;
    if (dt.files && dt.files.length > 0) return true;
    return typeof dt.types?.includes === 'function' && dt.types.includes(DRAG_PAYLOAD_MIME);
  };

  const handleDragOver = useCallback((event) => {
    if (!isTrackDrop(event)) return;
    event.preventDefault();
    const point = contentPointAtClientPoint(event.clientX, event.clientY);
    const row = point ? trackRowAtContentY(point.y) : null;
    const trackId = row && !row.track?.locked ? row.trackId : null;
    if (event.dataTransfer) event.dataTransfer.dropEffect = trackId ? 'copy' : 'none';
    if (dragOverTrackIdRef.current !== trackId) {
      dragOverTrackIdRef.current = trackId;
      setDragOverTrackId(trackId);
    }
  }, [contentPointAtClientPoint, trackRowAtContentY]);

  const handleDragLeave = useCallback((event) => {
    // Moving between the layer and its own <canvas> child also fires dragleave,
    // so only clear when the pointer actually leaves the overlay.
    if (event.currentTarget.contains(event.relatedTarget)) return;
    if (dragOverTrackIdRef.current === null) return;
    dragOverTrackIdRef.current = null;
    setDragOverTrackId(null);
  }, []);

  const handleDrop = useCallback((event) => {
    const point = contentPointAtClientPoint(event.clientX, event.clientY);
    const row = point ? trackRowAtContentY(point.y) : null;
    if (dragOverTrackIdRef.current !== null) {
      dragOverTrackIdRef.current = null;
      setDragOverTrackId(null);
    }
    if (!row || row.track?.locked) return;
    event.preventDefault();
    // Stop the drop reaching useOsFileDrop's document-level listener, which
    // would otherwise import an OS file a second time (and without a track).
    event.stopPropagation();
    const pps = latestRef.current.pixelsPerSecond || 1;
    const dropTime = Math.max(0, (point?.x ?? 0) / pps);
    spawnDroppedItemOnTrack({
      event,
      dropTime,
      targetTrackId: row.trackId,
      mediaAssets: latestRef.current.mediaAssets,
      onAddMediaAsset,
      onDropItemOnTrack,
    });
  }, [contentPointAtClientPoint, trackRowAtContentY, onAddMediaAsset, onDropItemOnTrack]);

  return (
    <div
      ref={hostRef}
      className={`timeline-canvas-layer ${className}`.trim()}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <canvas ref={canvasRef} className="timeline-canvas" />
      {laneMenu && (
        <ContextMenu x={laneMenu.x} y={laneMenu.y} onClose={closeLaneMenu} className="clip-context-menu" minWidth={160}>
          <button
            className="ctx-menu-item ctx-menu-row"
            onClick={handleLanePaste}
            disabled={!hasClipboardClips() || !onPasteClips}
          >
            <span className="ctx-menu-label"><ClipboardPaste size={12} /> Paste</span>
            <span className="ctx-menu-hint">Ctrl+V</span>
          </button>
        </ContextMenu>
      )}
      {ctxMenu && ctxClip && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={closeCtxMenu} className="clip-context-menu" minWidth={170}>
          {onCutSelected && !ctxIsLocked && (
            <button className="ctx-menu-item ctx-menu-row" onClick={handleCtxCut}>
              <span className="ctx-menu-label"><Scissors size={12} /> Cut</span>
              <span className="ctx-menu-hint">Ctrl+X</span>
            </button>
          )}
          {onCopySelected && (
            <button className="ctx-menu-item ctx-menu-row" onClick={handleCtxCopy}>
              <span className="ctx-menu-label"><Copy size={12} /> Copy</span>
              <span className="ctx-menu-hint">Ctrl+C</span>
            </button>
          )}
          {onPasteClips && !ctxIsLocked && (
            <button
              className="ctx-menu-item ctx-menu-row"
              onClick={handleCtxPaste}
              disabled={!hasClipboardClips()}
            >
              <span className="ctx-menu-label"><ClipboardPaste size={12} /> Paste</span>
              <span className="ctx-menu-hint">Ctrl+V</span>
            </button>
          )}
          {(onCutSelected || onCopySelected || onPasteClips) && <div className="ctx-menu-divider" />}
          {ctxShowRemoveGaps && (
            <button
              className="ctx-menu-item ctx-menu-row"
              onClick={handleCtxRemoveGaps}
              title="Close the empty space between the selected clips"
            >
              <span className="ctx-menu-label"><ArrowLeftToLine size={12} /> Remove Gaps</span>
            </button>
          )}
          {onDuplicateClips && !ctxIsLocked && (
            <button className="ctx-menu-item" onClick={handleCtxDuplicate}>
              <Copy size={12} /> Duplicate
            </button>
          )}
          {ctxShowSplitAudio && (
            <button className="ctx-menu-item" onClick={handleCtxSplitAudio}>
              <Scissors size={12} /> Split Video &amp; Audio
            </button>
          )}
          {onOpenSilenceRemover && !ctxIsLocked && (ctxItem?.hasAudio || ctxItem?.hasVideo) && (
            <button className="ctx-menu-item" onClick={() => { closeCtxMenu(); onOpenSilenceRemover(ctxClip.id); }}>
              <Scissors size={12} /> Cut Silence...
            </button>
          )}
          {!ctxIsLocked && ctxClip.parentId && (
            <button className="ctx-menu-item" onClick={handleCtxUnlinkParent}>
              <Unlink size={12} /> Unlink Parent
            </button>
          )}
          {ctxShowQuickLinks && ctxEligibleParents.map((p) => (
            <button key={p.id} className="ctx-menu-item" onClick={() => handleCtxSetParent(p.id)}>
              <Link2 size={12} /> Set Parent: {p.name}
            </button>
          ))}
        </ContextMenu>
      )}
    </div>
  );
});