/**
 * Timeline — the clip/lane area of the editor.
 *
 * ONE RENDERER
 * ----------------------------------------------------------------------------
 * The clip/lane area is drawn by components/Timeline/canvas/TimelineCanvas.jsx
 * — one viewport-sized canvas over a spacer of the same size. Everything else
 * here stays React: the toolbar, track headers, ruler, minimap scrollbar, zoom
 * and scroll logic, and the playhead (a DOM element updated through
 * playbackStore without a React render). Geometry comes from the shared model
 * (utils/timelineScene.js).
 */
import { useRef, useState, useMemo, useCallback, useEffect, useLayoutEffect, memo } from 'react';
import { Plus, ZoomIn, ZoomOut, ArrowLeftToLine, ArrowRightToLine, X } from 'lucide-react';
import { TimeRuler } from './TimeRuler';
import { formatTimecode } from '../../utils/timeFormat';
import { TrackHeader } from './TrackHeader';
import { PlayheadHandle, PlayheadLine } from './Playhead';
import { usePlaybackStore } from '../../hooks/PlaybackContext';
import { registerTimelineCenterOnPlayhead } from '../../services/timelineViewControls';
import { TimelineCanvas } from './canvas/TimelineCanvas';
// The zoom bounds + step live with the view state itself
// (dock/TimelineViewContext owns pixelsPerSecond), so the clamp here can never
// drift away from the range those setters actually allow.
import {
  MIN_PIXELS_PER_SECOND,
  MAX_PIXELS_PER_SECOND,
  ZOOM_STEP,
} from '../../dock/TimelineViewContext';
const HEADER_WIDTH = 180;

/**
 * Eased zoom. A wheel notch (or a toolbar +/- click) adds its step to a TARGET
 * zoom level, and the ease loop walks pixelsPerSecond toward it over the next
 * few frames instead of applying the whole step in one repaint.
 *
 * ZOOM_EASE_TIME_CONSTANT_MS is the time constant of the exponential ease-out
 * (how long it takes to cover ~63% of the remaining distance). It is a TIME,
 * not a per-frame fraction, so a 60Hz and a 120Hz display settle in the same
 * ~150ms instead of one of them taking twice as long.
 */
const ZOOM_EASE_TIME_CONSTANT_MS = 45;
/** Below this many px/s of remaining travel the ease settles: invisible. */
const ZOOM_EASE_MIN_STEP = 0.4;
/** Zoom impulse per wheel event, applied after deltaMode normalisation. */
const ZOOM_WHEEL_IMPULSE = 0.5;
/** Cap on one wheel event's impulse, so a violent flick can't teleport zoom. */
const ZOOM_WHEEL_MAX_DELTA = 60;
 
// Vertical layout constants + pure lane geometry for the flat timeline
// live in utils/timelineLayout.js (shared with TrackHeader and unit-tested).
// Re-exported here so existing importers stay unchanged.
export { TRACK_HEIGHT } from '../../utils/timelineLayout';
import { computeTrackLanes, isTransitionClipLike } from '../../utils/timelineLayout';
import './timeline.css';
 
export const Timeline = memo(function Timeline({
  tracks,
  clips,
  mediaAssets = [],
  totalDuration,
  pixelsPerSecond,
  snappingEnabled,
  recordingTrackId,
  recordingStartTime = 0,
  recordingLevel = 0,
  onSeek,
  onSelectClip,
  onUpdateClip,
  onUpdateClips,
  onDuplicateClips,
  onDeleteClip,
  // Clipboard actions for the timeline's right-click menus. These have always
  // been passed down from panels.jsx (and the removed TrackLane/ClipItem used
  // to declare them) but were never declared HERE, so they arrived as
  // `undefined` and Copy / Cut / Paste silently never appeared in either menu.
  onCopySelected,
  onCutSelected,
  onPasteClips,
  onUpdateTrack,
  onDeleteTrack,
  onAddTrack,
  onAddEmptyClip,
  onDropItemOnTrack,
  onToggleRecordTrack,
  onZoomIn,
  onZoomOut,
  onSetPixelsPerSecond,
  exportRange,
  onSetExportRange,
  selectedIds = [],
  onToggleSelect,
  onRangeSelect,
  onClearSelection,
  setSelectedIds,
  setSelectedEntityId,
  onAddMediaAsset,
  onSplitVideoAndAudio,
  onOpenSilenceRemover,
  onOpenSilenceRemoverForTrack,
  silencePreviewData = null,
  // What screen position Ctrl/Cmd+wheel zoom holds fixed while pixelsPerSecond
  // changes (services/editorSettings.js -> zoomAnchorMode). 'cursor' (default)
  // anchors on the mouse position over the lanes; 'playhead' anchors on the
  // seekbar/playhead position instead, which is the old (and only) behavior.
  // The toolbar +/- buttons and keyboard shortcuts have no mouse position to
  // anchor to, so they always use the playhead regardless of this setting.
  zoomAnchorMode = 'cursor',
}) {
  const playbackStore = usePlaybackStore();
  const lanesScrollRef = useRef(null);
  const rulerScrollRef = useRef(null);
  const scrollAreaRef = useRef(null);
  const lastUserScrollTimeRef = useRef(0);
  // Raw last-observed scrollLeft plus a short "restoring" flag — see
  // handleLanesScroll / restoreScrollPosition below. dockview hides panels
  // (display:none / zero-size) rather than unmounting them, and some
  // browsers reset an element's scrollLeft to 0 while it is hidden.
  const lastScrollLeftRef = useRef(0);
  const restoringScrollRef = useRef(false);
  const velocityRef = useRef(0);
  const smoothScrollAnimIdRef = useRef(null);
  const miniScrollbarTrackRef = useRef(null);
  // ── Eased zoom ─────────────────────────────────────────────────
  // A wheel notch or a toolbar click asks for a zoom STEP; the step is added
  // to a target and a rAF loop walks pixelsPerSecond toward that target a
  // fraction at a time (see runZoomEase), re-anchoring the view every frame.
  // Applying a whole step in one frame is what read as "glitchy": one wheel
  // notch moved the zoom level by up to 30 px/s (a ~75% jump at 40 px/s) and
  // the whole timeline snapped to it in a single repaint.
  //
  // pixelsPerSecond as last REQUESTED, which mid-ease is a frame or two ahead
  // of the prop React has committed so far. The ease always steps from THIS,
  // never from the prop, so consecutive frames of a fast gesture can't each
  // start from the same stale base (which erased deltas and made the zoom run
  // behind the wheel).
  const livePpsRef = useRef(pixelsPerSecond);
  // The px/s the running ease is heading for, or null when no ease is running.
  const zoomTargetRef = useRef(null);
  // Animation frame id of the running ease (0 when idle).
  const zoomFrameRef = useRef(0);
  // Wall-clock timestamp of the previous ease frame, for the time-based ease
  // curve (see runZoomEase).
  const zoomEaseTimeRef = useRef(0);
  // The anchor captured for the CURRENT gesture: a fixed time (seconds) that
  // must stay under a fixed screen x while pixelsPerSecond changes. Captured
  // once on the first wheel tick of a gesture and reused for EVERY frame of it
  // — including every frame of the ease — so the instant under the cursor
  // cannot drift tick to tick.
  const zoomAnchorRef = useRef(null); // { time, screenX, isCursor } | null
  // A re-anchor this zoom wants but cannot write yet: `{ pps, left }`, applied
  // by the post-commit pass (see the useLayoutEffect below runZoomEase) once
  // React has committed `pps` and the scroll extent that goes with it.
  const pendingZoomScrollRef = useRef(null);
 
  // ── Custom horizontal minimap scrollbar ────────────────────────
  // Mirrors lanesScrollRef's scrollLeft/scrollWidth/clientWidth as a
  // 0..1 thumb position + width so it stays visually in sync with
  // whatever scrolled the lanes (wheel, pan-drag, playhead auto-scroll).
  const [scrollMetrics, setScrollMetrics] = useState({ left: 0, thumbRatio: 1, scrollRatio: 0 });
 
  const updateScrollMetrics = useCallback(() => {
    const el = lanesScrollRef.current;
    if (!el) return;
    // Hidden/collapsed panel: clientWidth is 0, so maxScroll/thumbRatio below
    // are meaningless and would (a) clamp the minimap thumb to a wrong spot
    // and (b) let callers derive a bogus scroll target. Keep the last good
    // metrics instead of overwriting them with garbage.
    if (el.clientWidth === 0) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const thumbRatio = el.clientWidth > 0 ? Math.min(1, el.clientWidth / el.scrollWidth) : 1;
    const scrollRatio = maxScroll > 0 ? el.scrollLeft / maxScroll : 0;
    setScrollMetrics({ left: el.scrollLeft, thumbRatio, scrollRatio });
  }, []);
 
  // ── Track lane layout ──────────────────────────────────────────
  // Pure flat track layout from utils/timelineLayout.js (computeTrackLanes):
  // each row's height comes from that track's own (independently
  // resizable) rowHeight, not a single shared TRACK_HEIGHT constant — see
  // TrackHeader.jsx's resize handle and track.height in types.js.
  const layout = useMemo(() => {
    const trackRows = computeTrackLanes(tracks, clips);
    let surfaceY = 0;
    for (const row of trackRows) {
      surfaceY += row.rowHeight;
    }
    return { trackRows, surfaceY };
  }, [tracks, clips]);
 
  const timelineLanesHeight = Math.max(layout.surfaceY, 180);
  const totalWidth = Math.max(totalDuration * pixelsPerSecond + 400, 1600);
 
  const handleLanesScroll = () => {
    lastUserScrollTimeRef.current = Date.now();
    const el = lanesScrollRef.current;
    if (!el) return;
    // Remember the raw last-observed position. This is deliberately NOT
    // recomputed from clientWidth/scrollWidth (which are meaningless while
    // hidden), and it is skipped during the restore window so the browser's
    // own "scrollLeft reset to 0 while hidden" event can't clobber the real
    // value before restoreScrollPosition re-applies it.
    if (el.clientWidth > 0 && !restoringScrollRef.current) {
      lastScrollLeftRef.current = el.scrollLeft;
    }
    // Sync horizontal: lanes → ruler
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = el.scrollLeft;
    }
    updateScrollMetrics();
  };
 
  // Re-apply the last user scroll position after the panel comes back from
  // being hidden. Waiting one frame lets layout settle so the clamp uses the
  // real clientWidth (a clamp against clientWidth === 0 either pins the view
  // to 0 or leaves it over-scrolled).
  const restoreScrollPosition = useCallback(() => {
    restoringScrollRef.current = true;
    requestAnimationFrame(() => {
      const el = lanesScrollRef.current;
      if (el && el.clientWidth > 0) {
        const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
        const target = Math.max(0, Math.min(lastScrollLeftRef.current, maxScroll));
        if (Math.abs(el.scrollLeft - target) > 0.5) {
          el.scrollLeft = target;
          if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = target;
        }
        updateScrollMetrics();
      }
      restoringScrollRef.current = false;
    });
  }, [updateScrollMetrics]);
 
  // Recompute the minimap thumb whenever the scrollable content's size
  // could have changed (zoom, track/clip changes, panel resize) — not
  // just on scroll, so the thumb width stays accurate even when the
  // user never touches the scrollbar directly.
  useEffect(() => {
    updateScrollMetrics();
  }, [updateScrollMetrics, totalWidth, layout.surfaceY]);
 
  // Detect "was hidden, is now visible again" from two independent signals:
  // a ResizeObserver whose clientWidth goes 0 -> >0, and an
  // IntersectionObserver that reports the element intersecting again.
  // IntersectionObserver is the reliable cross-browser signal for a dockview
  // tab switch (which may hide by display:none and/or collapsing size);
  // ResizeObserver covers the size-driven case. Both funnel into the same
  // idempotent restore, so a double-fire is harmless.
  useEffect(() => {
    const el = lanesScrollRef.current;
    if (!el) return undefined;
 
    let wasHidden = el.clientWidth === 0;
    let wasIntersecting = true;
 
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        const hidden = el.clientWidth === 0;
        if (wasHidden && !hidden) restoreScrollPosition();
        wasHidden = hidden;
        updateScrollMetrics();
      });
      resizeObserver.observe(el);
    }
 
    let intersectionObserver = null;
    if (typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver((entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible && !wasIntersecting) restoreScrollPosition();
        wasIntersecting = visible;
      });
      intersectionObserver.observe(el);
    }
 
    return () => {
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
    };
  }, [restoreScrollPosition, updateScrollMetrics]);
 
  const snappingPoints = useMemo(() => {
    if (!snappingEnabled) return [];
    const points = new Set();
    points.add(0);
    points.add(playbackStore.getCurrentTime());
    clips.forEach((clip) => {
      // A transition's edges are not meaningful edit points: it is centred on
      // a cut, so its start/end sit half a transition either side of one and
      // would pull other clips to an arbitrary offset from the real cut.
      if (isTransitionClipLike(clip)) return;
      points.add(clip.startTime);
      points.add(clip.startTime + clip.duration);
    });
    return Array.from(points);
  }, [clips, snappingEnabled, playbackStore]);
 
  const handleSetIn = useCallback(() => {
    const t = playbackStore.getCurrentTime();
    const out = exportRange?.out ?? totalDuration;
    const finalOut = t >= out ? Math.max(t + 1, totalDuration) : out;
    onSetExportRange({ in: t, out: finalOut });
  }, [exportRange, totalDuration, playbackStore, onSetExportRange]);
 
  const handleSetOut = useCallback(() => {
    const t = playbackStore.getCurrentTime();
    const inp = exportRange?.in ?? 0;
    const finalIn = t <= inp ? Math.max(0, t - 1) : inp;
    onSetExportRange({ in: finalIn, out: t });
  }, [exportRange, playbackStore, onSetExportRange]);
 
  const handleClearRange = useCallback(() => {
    onSetExportRange(null);
  }, [onSetExportRange]);
 
  // Shared zoom-and-reanchor: used by both the ctrl+wheel gesture handler
  // and the toolbar zoom in/out buttons, so both paths keep some instant
  // under the same screen x instead of drifting the view — previously the
  // toolbar buttons just called setPixelsPerSecond with no scroll
  // compensation at all, so clicking them shifted the whole view relative
  // to the left edge rather than staying anchored.
  //
  // `anchor`, when passed, is `{ time, screenX }` — the exact instant and
  // screen position to hold fixed, captured once by the caller (e.g. once
  // per wheel gesture, at the cursor). When omitted (toolbar buttons,
  // keyboard shortcuts — nothing to anchor to a cursor with) this falls
  // back to the playhead/seekbar position, same as before.
  //
  // Cursor mode + not currently playing: instead of just visually holding
  // the cursor's instant in place, this also MOVES THE PLAYHEAD to that
  // instant (a seek), so "zoom under my mouse" doubles as "and take me
  // there". This never happens during active playback — seeking mid-
  // playback on every wheel tick would be jarring and nobody asked for
  // that; playing back just keeps the existing visual-only anchor.
  //
  // The re-anchor is written in TWO passes, and the split is the whole point:
  // pixelsPerSecond is React state, but `.lanes-surface`'s width (and so the
  // element's scrollWidth) only changes when React COMMITS that state, which
  // is a frame or more after this call. Writing scrollLeft here, against the
  // still-old scrollWidth, meant the browser clamped it to the previous zoom
  // level's extent (dropping the re-anchor entirely when zooming out past the
  // old max) and then silently re-clamped it once the new width landed — two
  // different scroll positions for one zoom step. Canvas mode drew both: the
  // scroll event from the first write repainted the canvas while
  // TimelineCanvas still held the PREVIOUS zoom level's scene (its React
  // render hadn't happened yet), so for a frame the clips were painted at the
  // old zoom at the new offset. Deferring the write to the post-commit pass
  // below makes (pixelsPerSecond, scrollLeft) atomic: the canvas can never
  // observe a scroll position belonging to a different zoom level, and the
  // browser paints the final state once.
  const requestZoom = useCallback((targetPps, anchor) => {
    const scroller = lanesScrollRef.current;
    const isCursorAnchor = Boolean(anchor?.isCursor);
    const anchorTime = anchor ? anchor.time : playbackStore.getCurrentTime();
    // No anchor passed (the toolbar +/- buttons): fall back to the playhead,
    // held at the CENTER of the visible lanes area — not its current screen
    // position, which could be anywhere (including right at an edge) and
    // would just stay pinned there through the zoom.
    const anchorScreenX = anchor
      ? anchor.screenX
      : scroller
        ? scroller.clientWidth / 2
        : null;

    // Current zoom as last REQUESTED, not as committed: mid-ease this is a
    // frame or two ahead of the pixelsPerSecond prop, and stepping from the
    // prop instead made consecutive frames of a fast gesture start from the
    // same stale base — half the wheel deltas got erased and the zoom ran
    // slower than the wheel was turned.
    const previousPps = livePpsRef.current;
    const nextPps = Math.max(MIN_PIXELS_PER_SECOND, Math.min(MAX_PIXELS_PER_SECOND, targetPps));
    livePpsRef.current = nextPps;
    // Whether React still has a commit to make for this zoom level. If it
    // doesn't (the clamp above threw the request away, or the ease already
    // applied this value) the DOM's scrollWidth already matches nextPps, so
    // the re-anchor can be written straight away.
    const zoomChanged = nextPps !== previousPps;

    if (onSetPixelsPerSecond) {
      onSetPixelsPerSecond(nextPps);
    } else if (nextPps > previousPps) {
      onZoomIn?.();
    } else if (nextPps < previousPps) {
      onZoomOut?.();
    }

    if (!scroller || anchorScreenX === null) return;

    /**
     * Write the re-anchor, now or in the post-commit pass — never against a
     * scrollWidth that still describes a different zoom level. See the note
     * above requestZoom for why the deferred case exists.
     */
    const commitScrollLeft = (value) => {
      if (zoomChanged) {
        pendingZoomScrollRef.current = { pps: nextPps, left: value };
        return;
      }
      scroller.scrollLeft = value;
      if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = value;
      updateScrollMetrics();
    };

    // Same formula as `totalWidth` above, evaluated at nextPps instead of
    // the current pixelsPerSecond — computed here rather than read off the
    // DOM so it's available in this same synchronous pass.
    const nextTotalWidth = Math.max(totalDuration * nextPps + 400, 1600);
    const maxScroll = Math.max(0, nextTotalWidth + HEADER_WIDTH - scroller.clientWidth);
    // Skip while the panel is hidden (clientWidth 0): the clamp above would
    // be computed against a meaningless maxScroll.
    if (scroller.clientWidth === 0) return;

    // Nothing to anchor when there's nowhere to scroll (maxScroll 0 — the
    // whole project already fits in the visible width, e.g. fully zoomed
    // out or a short project on a wide screen). In that case scrollLeft is
    // always going to be clamped to 0 regardless of what the anchor math
    // below computes, so just go there directly and skip the rest —
    // running the full anchor/playhead-visibility math only to have its
    // result thrown away by the clamp was producing a different
    // (irrelevant, since it gets clamped anyway) desiredScrollLeft on
    // almost every frame near this boundary, which is what showed up as
    // rapid flicker/snapping right around the fit-to-view zoom level.
    if (maxScroll === 0) {
      commitScrollLeft(0);
      return;
    }

    let desiredScrollLeft = HEADER_WIDTH + anchorTime * nextPps - anchorScreenX;

    const wasPlaying = playbackStore.getIsPlaying();
    if (isCursorAnchor && !wasPlaying && onSeek) {
      // Move the playhead itself to the cursor's instant — this also makes
      // the later "keep playhead visible" check below a no-op most of the
      // time, since the playhead now IS the anchor.
      onSeek(Math.max(0, anchorTime));
    } else {
      // Either playhead-anchor mode, or cursor-anchor mode while playing
      // (where we deliberately don't seek): the playhead can still end up
      // far from the cursor, so keep the existing visibility safety net —
      // nudge just enough to bring it back into view if it would otherwise
      // be scrolled off-screen, without fighting the cursor anchor the
      // user is actively controlling by recentering it outright.
      const playbackTime = playbackStore.getCurrentTime();
      const playheadContentX = HEADER_WIDTH + playbackTime * nextPps;
      const margin = 24; // px — keep the line clear of the very edge
      const visibleLeft = desiredScrollLeft + HEADER_WIDTH + margin;
      const visibleRight = desiredScrollLeft + scroller.clientWidth - margin;
      if (playheadContentX < visibleLeft) {
        desiredScrollLeft -= (visibleLeft - playheadContentX);
      } else if (playheadContentX > visibleRight) {
        desiredScrollLeft += (playheadContentX - visibleRight);
      }
    }

    const clampedScrollLeft = Math.max(0, Math.min(maxScroll, desiredScrollLeft));

    // Final safety check: the clamp above (forced by maxScroll, i.e. the
    // project's actual scrollable range) can undo the playhead-visibility
    // nudge from the block above it if that nudge asked for a scrollLeft
    // outside [0, maxScroll] — e.g. nudging left to reveal a playhead near
    // time 0 can ask for a negative scrollLeft, which then gets clamped
    // back to 0 and could once again cut the playhead off depending on
    // zoom level. Reported bug: "playhead teleports off-screen during
    // zoom." Only re-check when we didn't just seek the playhead to the
    // anchor (in that case the playhead IS the anchor and anchorScreenX
    // already guarantees it's on-screen, modulo the same maxScroll clamp,
    // which is unavoidable — there's nowhere further to scroll).
    let finalScrollLeft = clampedScrollLeft;
    if (!(isCursorAnchor && !wasPlaying && onSeek)) {
      const playbackTime = playbackStore.getCurrentTime();
      const playheadContentX = HEADER_WIDTH + playbackTime * nextPps;
      const margin = 24;
      if (playheadContentX < finalScrollLeft + HEADER_WIDTH + margin) {
        finalScrollLeft = Math.max(0, Math.min(maxScroll, playheadContentX - HEADER_WIDTH - margin));
      } else if (playheadContentX > finalScrollLeft + scroller.clientWidth - margin) {
        finalScrollLeft = Math.max(0, Math.min(maxScroll, playheadContentX - scroller.clientWidth + margin));
      }
    }

    commitScrollLeft(finalScrollLeft);
  }, [playbackStore, onSetPixelsPerSecond, onZoomIn, onZoomOut, updateScrollMetrics, totalDuration, onSeek]);

  /**
   * Walk pixelsPerSecond toward zoomTargetRef, one frame at a time, until it
   * settles — the eased half of zoomBy. Every frame goes back through
   * requestZoom, so the view is re-anchored on EVERY frame of the glide: the
   * instant that was under the cursor stays under it for the whole animation,
   * not just once it lands.
   *
   * The curve is exponential ease-out, expressed per MILLISECOND rather than
   * per frame so a 60Hz and a 120Hz display converge in the same ~150ms. dt is
   * capped because a long stall (a busy frame, a background tab) must not turn
   * into one huge step — small steps are the entire point of this loop — and
   * the loop always re-reads livePpsRef, so it can never step backwards from a
   * lagging prop.
   */
  const runZoomEase = useCallback(() => {
    if (zoomFrameRef.current) return;
    zoomEaseTimeRef.current = 0;
    zoomFrameRef.current = requestAnimationFrame(function zoomEaseFrame(now) {
      zoomFrameRef.current = 0;
      const target = zoomTargetRef.current;
      if (target === null) return;

      const dt = zoomEaseTimeRef.current ? Math.min(48, now - zoomEaseTimeRef.current) : 16;
      zoomEaseTimeRef.current = now;
      const k = 1 - Math.exp(-dt / ZOOM_EASE_TIME_CONSTANT_MS);

      const current = livePpsRef.current;
      const stepped = current + (target - current) * k;
      const settled = Math.abs(target - stepped) < ZOOM_EASE_MIN_STEP;
      const pps = settled ? target : stepped;

      requestZoom(pps, zoomAnchorRef.current);

      if (settled) {
        zoomTargetRef.current = null;
        // The gesture is over, so the next one captures a fresh anchor (the
        // cursor for a wheel tick, playhead-centered for a button).
        zoomAnchorRef.current = null;
        zoomEaseTimeRef.current = 0;
        return;
      }
      zoomFrameRef.current = requestAnimationFrame(zoomEaseFrame);
    });
  }, [requestZoom]);

  /**
   * Ask for a zoom step of `delta` px/s, applied as an eased glide.
   *
   * Used by both the wheel gesture and the toolbar +/- buttons, so the two
   * behave identically. The step is ADDED TO A TARGET rather than applied in
   * one frame, and the target accumulates for as long as the gesture lasts, so
   * a fast flick still reaches the far end of the range — it just gets there
   * in ~150ms of easing instead of a single repaint.
   */
  const zoomBy = useCallback(
    (delta) => {
      if (!delta) return;
      const base = zoomTargetRef.current ?? livePpsRef.current;
      const target = Math.max(MIN_PIXELS_PER_SECOND, Math.min(MAX_PIXELS_PER_SECOND, base + delta));
      // Already there and no ease running to re-anchor: nothing to do. Drop
      // the anchor the caller just captured too — at a zoom bound no gesture
      // is under way, and a lingering cursor anchor would be picked up by the
      // next toolbar +/- click instead of its own playhead-centered one.
      if (target === livePpsRef.current && zoomTargetRef.current === null) {
        zoomAnchorRef.current = null;
        return;
      }
      zoomTargetRef.current = target;
      runZoomEase();
    },
    [runZoomEase]
  );

  /**
   * The deferred half of requestZoom: apply a zoom's scroll re-anchor once
   * React has committed the new pixelsPerSecond (and therefore the new
   * scrollWidth), but BEFORE the browser paints — a layout effect runs after
   * DOM mutation and before paint, which is exactly the window this needs.
   *
   * Reading scrollWidth here also forces the fresh layout, so the clamp below
   * agrees with what the browser is about to do anyway; that is why a zoom to
   * the far edge settles in place instead of being pulled back a frame later.
   *
   * `pending.pps` is compared against the committed pixelsPerSecond because a
   * fast gesture can queue a newer re-anchor before this one lands — applying
   * the older one would move the view by a zoom level that no longer exists
   * (the next pass writes the right one a frame later).
   */
  useLayoutEffect(() => {
    // While no ease is running the committed prop IS the current zoom level,
    // so it is the authoritative base for the next gesture.
    if (zoomTargetRef.current === null) livePpsRef.current = pixelsPerSecond;

    const pending = pendingZoomScrollRef.current;
    if (!pending || pending.pps !== pixelsPerSecond) return;
    pendingZoomScrollRef.current = null;

    const scroller = lanesScrollRef.current;
    if (!scroller || scroller.clientWidth === 0) return;
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const left = Math.max(0, Math.min(maxScroll, pending.left));
    scroller.scrollLeft = left;
    if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = left;
    updateScrollMetrics();
  }, [pixelsPerSecond, updateScrollMetrics]);
 
  // Defined BEFORE handleZoomInBtn/handleZoomOutBtn: a useCallback dependency
  // array is evaluated during render, so referencing a `const` declared further
  // down throws "Cannot access 'stopSmoothScroll' before initialization" (TDZ)
  // and crashes the whole Timeline. It only depends on refs, so its position
  // among the other hooks doesn't change behavior.
  const stopSmoothScroll = useCallback(() => {
    if (smoothScrollAnimIdRef.current) {
      cancelAnimationFrame(smoothScrollAnimIdRef.current);
      smoothScrollAnimIdRef.current = null;
    }
    velocityRef.current = 0;
  }, []);
 
  useEffect(() => {
    return () => {
      if (smoothScrollAnimIdRef.current) {
        cancelAnimationFrame(smoothScrollAnimIdRef.current);
      }
    };
  }, []);

  // Toolbar +/- buttons: same fixed step the old handleZoomIn/handleZoomOut
  // used (15), just routed through zoomBy so they glide to the new level the
  // same way the wheel gesture does and re-center on the seekbar while they
  // do it.
  const handleZoomInBtn = useCallback(() => {
    stopSmoothScroll();
    zoomBy(ZOOM_STEP);
  }, [zoomBy, stopSmoothScroll]);

  const handleZoomOutBtn = useCallback(() => {
    stopSmoothScroll();
    zoomBy(-ZOOM_STEP);
  }, [zoomBy, stopSmoothScroll]);
 
  // Center the view on the playhead WITHOUT changing zoom. Same anchor math
  // as requestZoom, but solved so the playhead lands in the middle of the
  // visible lanes area instead of staying under a fixed screen x. The ruler's
  // scroll is kept in sync exactly like every other scroll-writing path here.
  const handleCenterOnPlayhead = useCallback(() => {
    const scroller = lanesScrollRef.current;
    // Nothing meaningful to center while hidden (clientWidth 0).
    if (!scroller || scroller.clientWidth === 0) return;
    stopSmoothScroll();
    const anchorTime = playbackStore.getCurrentTime();
    const playheadX = HEADER_WIDTH + anchorTime * pixelsPerSecond;
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const desiredScrollLeft = playheadX - scroller.clientWidth / 2;
    scroller.scrollLeft = Math.max(0, Math.min(maxScroll, desiredScrollLeft));
    if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = scroller.scrollLeft;
    // Treat this as user scroll activity so playback auto-scroll doesn't
    // immediately drag the view back off-center.
    lastUserScrollTimeRef.current = Date.now();
    updateScrollMetrics();
  }, [pixelsPerSecond, playbackStore, updateScrollMetrics, stopSmoothScroll]);
 
  // Publish the command so the global shortcut dispatcher can call it. The
  // Timeline owns the scroll element; EditorPlaybackShortcuts only resolves
  // the keybinding (see services/timelineViewControls.js).
  useEffect(
    () => registerTimelineCenterOnPlayhead(handleCenterOnPlayhead),
    [handleCenterOnPlayhead]
  );
 
  // Auto-scroll timeline to keep playhead visible ONLY during active playback
  useEffect(() => {
    const unsub = playbackStore.registerFrameCallback((time) => {
      // 1. Only auto-scroll while playing (never when paused or seeking)
      if (!playbackStore.getIsPlaying()) return;
 
      // 2. Do not auto-scroll if user scrolled or interacted within the last 2 seconds
      if (Date.now() - lastUserScrollTimeRef.current < 2000) return;
 
      const scroll = lanesScrollRef.current;
      if (!scroll) return;
      const viewWidth = scroll.clientWidth;
      // Panel hidden/collapsed — clientWidth is 0 and any scroll write here
      // would be clamped against a meaningless max. Leave the position alone.
      if (viewWidth <= 0) return;
      const px = HEADER_WIDTH + time * pixelsPerSecond;
      const scrollLeft = scroll.scrollLeft;
 
      // Push view forward smoothly only when playhead approaches the right edge
      if (px > scrollLeft + viewWidth - 80) {
        scroll.scrollLeft = Math.max(0, px - 120);
      } else if (px < scrollLeft) {
        // Playhead looped or jumped before current visible range
        scroll.scrollLeft = Math.max(0, px - 120);
      }
    });
    return unsub;
  }, [playbackStore, pixelsPerSecond]);
 
  // Drag the minimap thumb (or click-to-jump on its track) to scroll.
  const handleMiniScrollbarPointerDown = useCallback((e) => {
    const track = miniScrollbarTrackRef.current;
    const scroller = lanesScrollRef.current;
    if (!track || !scroller) return;
    stopSmoothScroll();
    e.preventDefault();
 
    const trackRect = track.getBoundingClientRect();
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
 
    const scrollToClientX = (clientX) => {
      const ratio = Math.max(0, Math.min(1, (clientX - trackRect.left) / trackRect.width));
      scroller.scrollLeft = ratio * maxScroll;
      if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = scroller.scrollLeft;
      lastUserScrollTimeRef.current = Date.now();
      updateScrollMetrics();
    };
 
    // Clicking directly on the thumb pans relative to grab point;
    // clicking empty track space jumps the view straight there.
    const isThumb = e.target.closest('.timeline-mini-scrollbar-thumb');
    if (!isThumb) {
      scrollToClientX(e.clientX);
    } else {
      const startClientX = e.clientX;
      const startScrollLeft = scroller.scrollLeft;
      const onMove = (me) => {
        const deltaRatio = (me.clientX - startClientX) / trackRect.width;
        scroller.scrollLeft = Math.max(0, Math.min(maxScroll, startScrollLeft + deltaRatio * maxScroll));
        if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = scroller.scrollLeft;
        lastUserScrollTimeRef.current = Date.now();
        updateScrollMetrics();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      return;
    }
 
    const onMove = (me) => scrollToClientX(me.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [stopSmoothScroll, updateScrollMetrics]);
 
  const startSmoothScroll = useCallback((delta) => {
    const scroller = lanesScrollRef.current;
    if (!scroller) return;
 
    // Instant direct step (40%) gives 0ms latency tactile feedback per wheel notch
    const immediateRatio = 0.4;
    const immediateMove = delta * immediateRatio;
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    scroller.scrollLeft = Math.max(0, Math.min(maxScroll, scroller.scrollLeft + immediateMove));
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = scroller.scrollLeft;
    }
 
    // Remaining impulse glides out smoothly via velocity friction decay
    const glideImpulse = delta * (1 - immediateRatio);
    if (Math.sign(velocityRef.current) !== Math.sign(glideImpulse)) {
      velocityRef.current = 0;
    }
    velocityRef.current = Math.max(-1200, Math.min(1200, velocityRef.current + glideImpulse * 5.5));
 
    if (smoothScrollAnimIdRef.current) return;
 
    let lastTime = performance.now();
 
    const step = (now) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
 
      const s = lanesScrollRef.current;
      if (!s) {
        stopSmoothScroll();
        return;
      }
 
      if (Math.abs(velocityRef.current) < 1) {
        stopSmoothScroll();
        return;
      }
 
      const currentMax = Math.max(0, s.scrollWidth - s.clientWidth);
      const stepMove = velocityRef.current * dt;
      const targetScroll = s.scrollLeft + stepMove;
 
      if (targetScroll <= 0) {
        s.scrollLeft = 0;
        if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = 0;
        stopSmoothScroll();
        return;
      } else if (targetScroll >= currentMax) {
        s.scrollLeft = currentMax;
        if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = currentMax;
        stopSmoothScroll();
        return;
      } else {
        s.scrollLeft = targetScroll;
        if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = targetScroll;
      }
 
      // Smooth exponential friction decay (never changes sign, mathematically cannot bounce back)
      const friction = Math.pow(0.0005, dt);
      velocityRef.current *= friction;
 
      smoothScrollAnimIdRef.current = requestAnimationFrame(step);
    };
 
    smoothScrollAnimIdRef.current = requestAnimationFrame(step);
  }, [stopSmoothScroll]);
 
  // Non-passive wheel listener attached directly to the DOM element
  // Guarantees e.preventDefault() works so browser and JS scrolling never fight
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
 
    const handleWheel = (e) => {
      lastUserScrollTimeRef.current = Date.now();
 
      // Ctrl + Wheel: Zoom timeline, anchored on the mouse cursor by default
      // (zoomAnchorMode 'cursor') or the playhead/seekbar (zoomAnchorMode
      // 'playhead') so the same instant in time stays under the same screen
      // x while pixelsPerSecond changes — instead of the zoom appearing to
      // happen at a "random" spot (previously it just changed pps with no
      // scroll compensation at all, so the whole view shifted relative to
      // the left edge).
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        stopSmoothScroll();

        // Wheel deltas come in one of three units — pixels, lines or pages —
        // and only the pixel case used to be handled, so the same physical
        // notch zoomed ~16x slower on a browser that reports lines. Normalise
        // to pixels first, then cap the impulse so a violent flick cannot
        // teleport the zoom level.
        let rawDelta = -e.deltaY;
        if (e.deltaMode === 1) rawDelta *= 16;
        else if (e.deltaMode === 2) rawDelta *= 100;
        const impulse =
          Math.max(-ZOOM_WHEEL_MAX_DELTA, Math.min(ZOOM_WHEEL_MAX_DELTA, rawDelta)) * ZOOM_WHEEL_IMPULSE;
        if (impulse === 0) return;

        // Capture the anchor once per gesture — while no ease is running, so
        // one gesture keeps ONE anchor — not on every wheel event: the anchor
        // must stay fixed for the whole gesture or the "same instant under
        // the same screen point" guarantee drifts tick to tick. In cursor
        // mode the anchor point is where the mouse is RIGHT NOW (converted
        // to a timeline instant); in playhead mode it's the seekbar's
        // current instant, held at the CENTER of the visible lanes area.
        if (zoomAnchorRef.current === null) {
          const scroller = lanesScrollRef.current;
          if (zoomAnchorMode === 'cursor' && scroller) {
            // scroller.getBoundingClientRect().left is the scroll
            // VIEWPORT's left edge (unaffected by scrollLeft), so
            // screenX here is already in the same "0 = left edge of
            // visible lanes" space that anchorScreenX means in
            // requestZoom below — matching the playhead branch's
            // HEADER_WIDTH + time*pps - scrollLeft formula. The current
            // zoom level comes from livePpsRef (not the prop), because
            // mid-ease the prop lags the zoom level actually on screen.
            const scrollerRect = scroller.getBoundingClientRect();
            const screenX = e.clientX - scrollerRect.left;
            const contentX = screenX + scroller.scrollLeft;
            const time = Math.max(0, (contentX - HEADER_WIDTH) / livePpsRef.current);
            // isCursor: true only for this branch, so requestZoom can
            // tell "anchored on the cursor" apart from "anchored on the
            // playhead" (falls into the else branch below) — they need
            // different follow-up behavior (seek-on-zoom vs not).
            zoomAnchorRef.current = { time, screenX, isCursor: true };
          } else {
            // Playhead mode: anchor to the CENTER of the visible lanes
            // area, not wherever the playhead currently happens to sit on
            // screen. Anchoring to its current screen x (as this used to)
            // means if the playhead started near an edge before the zoom
            // gesture, it stays pinned to that same edge afterward instead
            // of settling toward the middle — reported bug: "seekbar goes
            // to edge instead of center."
            const time = playbackStore.getCurrentTime();
            const screenX = scroller ? scroller.clientWidth / 2 : null;
            zoomAnchorRef.current = { time, screenX, isCursor: false };
          }
        }

        // Add the impulse to the ease's target (starting one if needed).
        // Nothing is applied here: runZoomEase walks pixelsPerSecond toward
        // it over the next frames, re-anchoring on every one of them, so one
        // notch glides in instead of jumping.
        zoomBy(impulse);
        return;
      }
 
      // Shift + Wheel or horizontal trackpad swipe: Horizontal scroll
      const isHorizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
 
      if (isHorizontal) {
        const scroller = lanesScrollRef.current;
        if (!scroller) return;
 
        // Prevent browser's native horizontal scroll so it never fights our JS handler
        e.preventDefault();
 
        let delta = e.shiftKey ? (e.deltaY || e.deltaX) : e.deltaX;
        if (e.deltaMode === 1) {
          delta *= 28;
        } else if (e.deltaMode === 2) {
          delta *= scroller.clientWidth;
        }
 
        // For small trackpad gestures (pixel deltaMode, small delta, no Shift): direct 1:1 scroll
        if (e.deltaMode === 0 && !e.shiftKey && Math.abs(delta) < 35) {
          stopSmoothScroll();
          scroller.scrollLeft += delta;
          if (rulerScrollRef.current) {
            rulerScrollRef.current.scrollLeft = scroller.scrollLeft;
          }
        } else {
          // For stepped wheel notches or shift+wheel: smooth glide (mathematically bounce-free)
          startSmoothScroll(delta);
        }
        return;
      }
 
      // Normal vertical wheel scroll (no Shift, no Ctrl)
      stopSmoothScroll();
      // If cursor is over ruler bar, forward vertical scroll to lanes
      if (rulerScrollRef.current && rulerScrollRef.current.contains(e.target)) {
        const scroller = lanesScrollRef.current;
        if (scroller && e.deltaY !== 0) {
          e.preventDefault();
          scroller.scrollTop += e.deltaY;
        }
      }
      // Over lanes-wrapper: let native vertical scroll proceed naturally
    };
 
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel, { passive: false });
      stopSmoothScroll();
      if (zoomFrameRef.current) {
        cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = 0;
      }
      zoomTargetRef.current = null;
      zoomAnchorRef.current = null;
      zoomEaseTimeRef.current = 0;
      // No pendingZoomScrollRef reset here: it belongs to the committed pass
      // above, which drops it as soon as it applies (or sees a newer zoom).
    };
    // Deliberately NOT keyed on pixelsPerSecond any more: the handler reads the
    // live zoom from livePpsRef and delegates the actual zoom to zoomBy (which
    // owns the eased loop), so a zoom gesture no longer tears down and
    // re-attaches this listener once per frame.
  }, [startSmoothScroll, stopSmoothScroll, zoomBy, playbackStore, zoomAnchorMode]);

  // Silence-cut preview for the canvas renderer: TrackLane matches cuts to a
  // clip per row (clip / its children / its parent / the whole track); the
  // canvas needs the same matching keyed by clip id, so it can overlay them
  // while drawing.
  const canvasSilenceCuts = useMemo(() => {
    const map = new Map();
    if (!silencePreviewData?.cuts?.length) return map;
    const rootId = silencePreviewData.targetId;
    const rootParentId = clips.find((c) => c.id === rootId)?.parentId;
    for (const clip of clips) {
      if (silencePreviewData.targetType === 'clip') {
        if (clip.id === rootId || clip.parentId === rootId || rootParentId === clip.id) {
          map.set(clip.id, silencePreviewData.cuts);
        }
      } else if (silencePreviewData.targetType === 'track' && clip.trackId === rootId) {
        map.set(clip.id, silencePreviewData.cuts);
      }
    }
    return map;
  }, [silencePreviewData, clips]);
  const mergedSelectedIds = selectedIds;

 
  return (
    <section className="timeline-editor-panel">
      {/* Top Header of Timeline */}
      <div className="timeline-top-bar">
        <span className="timeline-title-label">TIMELINE</span>
        <div className="timeline-actions-group" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button 
            className="timeline-zoom-btn" 
            onClick={handleZoomOutBtn}
            title="Zoom Out (-)"
          >
            <ZoomOut size={12} />
          </button>
          <button 
            className="timeline-zoom-btn" 
            onClick={handleZoomInBtn}
            title="Zoom In (+)"
          >
            <ZoomIn size={12} />
          </button>
          {/* Export range controls */}
          <div className="timeline-range-group">
            <button
              className="timeline-zoom-btn"
              onClick={handleSetIn}
              title="Set Export In Point at Playhead (I)"
            >
              <ArrowLeftToLine size={12} />
              <span>In</span>
            </button>
            <button
              className="timeline-zoom-btn"
              onClick={handleSetOut}
              title="Set Export Out Point at Playhead (O)"
            >
              <ArrowRightToLine size={12} />
              <span>Out</span>
            </button>
            {exportRange && (
              <button
                className="timeline-zoom-btn range-active"
                onClick={handleClearRange}
                title="Clear Export Range"
              >
                <X size={11} />
                <span>{formatTimecode(Math.max(0, exportRange.out - exportRange.in))}</span>
              </button>
            )}
          </div>
 
          <button 
            className="add-clip-action-btn" 
            onClick={() => onAddEmptyClip && onAddEmptyClip(tracks[0]?.id || 'track-1', playbackStore.getCurrentTime())}
            title="Create New Clip at Playhead"
          >
            <Plus size={12} className="text-cyan" />
            <span>Add Clip</span>
          </button>
          <button 
            className="add-track-action-btn" 
            onClick={onAddTrack}
            title="Add New Layer Track"
          >
            <Plus size={12} />
            <span>Add Track</span>
          </button>
        </div>
      </div>
 
      <div className="timeline-split-wrapper">
        <div className="timeline-scroll-area" ref={scrollAreaRef}>
          {/* Time Ruler */}
          <div className="ruler-wrapper" ref={rulerScrollRef}>
            <TimeRuler
              totalDuration={totalDuration}
              pixelsPerSecond={pixelsPerSecond}
              totalWidth={totalWidth}
              onSeek={onSeek}
              exportRange={exportRange}
              snappingPoints={snappingPoints}
              snappingEnabled={snappingEnabled}
            />
            <PlayheadHandle pixelsPerSecond={pixelsPerSecond} onSeek={onSeek} />
          </div>
 
          <div
            className="lanes-wrapper"
            ref={lanesScrollRef}
            onScroll={handleLanesScroll}
          >
            <div
              className="lanes-surface"
              style={{ width: `${totalWidth + HEADER_WIDTH}px`, position: 'relative' }}
            >
 
              {/* Export range overlay on track lanes */}
              {exportRange && (
                <>
                  {/* Dimmed area before in-point */}
                  <div
                    className="export-range-dim"
                    style={{
                      left: `${HEADER_WIDTH}px`,
                      width: `${Math.max(0, exportRange.in * pixelsPerSecond)}px`,
                      height: `${timelineLanesHeight}px`,
                    }}
                  />
                  {/* Dimmed area after out-point */}
                  <div
                    className="export-range-dim"
                    style={{
                      left: `${HEADER_WIDTH + exportRange.out * pixelsPerSecond}px`,
                      width: `${Math.max(0, totalWidth - exportRange.out * pixelsPerSecond)}px`,
                      height: `${timelineLanesHeight}px`,
                    }}
                  />
                  {/* In-point marker line */}
                  <div
                    className="export-range-marker in-marker"
                    style={{ 
                      left: `${HEADER_WIDTH + exportRange.in * pixelsPerSecond}px`, 
                      height: `${timelineLanesHeight}px` 
                    }}
                    title={`Export In: ${formatTimecode(exportRange.in)}`}
                  />
                  {/* Out-point marker line */}
                  <div
                    className="export-range-marker out-marker"
                    style={{ 
                      left: `${HEADER_WIDTH + exportRange.out * pixelsPerSecond}px`, 
                      height: `${timelineLanesHeight}px` 
                    }}
                    title={`Export Out: ${formatTimecode(exportRange.out)}`}
                  />
                </>
              )}
 
              <PlayheadLine
                pixelsPerSecond={pixelsPerSecond}
                onSeek={onSeek}
                timelineHeight={timelineLanesHeight + 30}
              />
 
              {/* Each track row */}
              {layout.trackRows.map((row) => (
                <div key={row.track.id} className="track-full-row" style={{ height: row.rowHeight }}>
                  <div className="track-header-sticky" style={{ height: row.rowHeight }}>
                    <TrackHeader
                      track={row.track}
                      rowHeight={row.rowHeight}
                      onUpdateTrack={onUpdateTrack}
                      onDeleteTrack={onDeleteTrack}
                      canDeleteTrack={tracks.length > 1}
                      onAddEmptyClip={onAddEmptyClip}
                      isRecordingTarget={recordingTrackId === row.track.id}
                      recordingStartTime={recordingStartTime}
                      recordingLevel={recordingLevel}
                      isAnyTrackRecording={!!recordingTrackId}
                      onToggleRecordTrack={onToggleRecordTrack}
                      onOpenSilenceRemoverForTrack={onOpenSilenceRemoverForTrack}
                    />
                  </div>
                  {/* The row keeps its exact size so native scrolling, the
                      minimap scrollbar and zoom anchoring stay untouched,
                      while the clips are drawn by TimelineCanvas. */}
                  <div
                    className="track-lane-spacer"
                    style={{ width: `${totalWidth}px`, height: row.rowHeight, flexShrink: 0 }}
                  />
                </div>
              ))}
            </div>
          </div>
          {/* The viewport-pinned canvas overlay over the lanes area.

              It is a SIBLING of `.lanes-wrapper`, not a child: an absolutely
              positioned element inside a scroll container is scrolled with
              that container's content, so nesting it there moved the overlay
              by scrollLeft/scrollTop and then the draw pass offset the canvas
              content by the same amount — everything visibly drifted twice as
              fast as the scroll while dragging. `.timeline-scroll-area` is the
              positioned ancestor (`position: relative`), it does not scroll,
              and canvas-timeline.css offsets the layer past the ruler and the
              sticky track-header column, so the overlay stays exactly over
              the lanes viewport and only what it DRAWS changes with scroll. */}
          {/* setSelectedIds / setSelectedEntityId / onSeek: the canvas's lasso
              writes selection directly (a box can select many clips at once,
              which onSelectClip/onRangeSelect/onToggleSelect don't express)
              and falls back to onSeek for a press-release with no drag. */}
          <TimelineCanvas

              tracks={tracks}
              clips={clips}
              mediaAssets={mediaAssets}
              pixelsPerSecond={pixelsPerSecond}
              selectedIds={mergedSelectedIds}
              exportRange={exportRange}
              recordingTrackId={recordingTrackId}
              recordingStartTime={recordingStartTime}
              recordingLevel={recordingLevel}
              silenceCuts={canvasSilenceCuts}
              scrollRef={lanesScrollRef}
              onSelectClip={onSelectClip}
              onToggleSelect={onToggleSelect}
              onRangeSelect={onRangeSelect}
              onClearSelection={onClearSelection}
              setSelectedIds={setSelectedIds}
              setSelectedEntityId={setSelectedEntityId}
              onSeek={onSeek}
              allClips={clips}
              onUpdateClip={onUpdateClip}
              onUpdateClips={onUpdateClips}
              onDuplicateClips={onDuplicateClips}
              snappingPoints={snappingPoints}
              snappingEnabled={snappingEnabled}
              // ── Context menu / locked-track behavior (plan step 7) ────
              onDeleteClip={onDeleteClip}
              onCopySelected={onCopySelected}
              onCutSelected={onCutSelected}
              onPasteClips={onPasteClips}
              onSplitVideoAndAudio={onSplitVideoAndAudio}
              onOpenSilenceRemover={onOpenSilenceRemover}
              // Drop handling: the canvas layer is the top surface over the
              // lanes in this mode, so it owns a drop that the (clip-less)
              // `.track-lane-spacer` rows can't receive.
              onDropItemOnTrack={onDropItemOnTrack}
              onAddMediaAsset={onAddMediaAsset}
            />
        </div>
 
        {/* Always-visible horizontal minimap scrollbar. Its thumb width
            reflects how much of the total timeline is currently in view
            (scrollMetrics.thumbRatio), and its position shows where that
            view sits relative to the full track content — so at a glance
            you can tell whether a track's clips further out (like the
            ones past 00:20 in a long timeline) are off-screen, and drag
            or click the bar to jump straight there. */}
        <div
          className="timeline-mini-scrollbar-track"
          ref={miniScrollbarTrackRef}
          onPointerDown={handleMiniScrollbarPointerDown}
        >
          <div
            className="timeline-mini-scrollbar-thumb"
            style={{
              width: `${scrollMetrics.thumbRatio * 100}%`,
              left: `${scrollMetrics.scrollRatio * (1 - scrollMetrics.thumbRatio) * 100}%`,
            }}
          />
        </div>
      </div>
    </section>
  );
});