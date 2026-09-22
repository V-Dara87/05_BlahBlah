/**
 * Timeline — the clip/lane area of the editor.
 *
 * TWO RENDERERS, ONE MODEL
 * ----------------------------------------------------------------------------
 * With the `canvasTimeline` editor setting OFF (the default) this component
 * renders the classic DOM timeline: one TrackLane per track, one ClipItem per
 * clip, each with its own pointer handlers and waveform canvas. With it ON, the
 * clip/lane area is drawn by components/Timeline/canvas/TimelineCanvas.jsx —
 * one viewport-sized canvas over a spacer of the same size — while everything
 * else here stays React: the toolbar, track headers, minimap scrollbar, zoom
 * and scroll logic, context menus, the Inspector, and the playhead (a DOM
 * element updated through playbackStore without a React render). Both paths
 * read their geometry from the SAME model (utils/timelineScene.js), so a clip
 * is in the same place either way.
 *
 * The canvas path in progress is view-only (selection/move/trim/menus/drops
 * are being ported onto it); the DOM path is the supported default and stays
 * until the canvas has parity.
 *
 * WHEN THE CANVAS BECOMES THE DEFAULT (rollout checklist, plan step 8): once
 * the parity walk-through passes (selection, multi-select, Alt-duplicate,
 * Ctrl-parent, trims, silence cuts, transitions, drops, menus, locked tracks,
 * undo granularity) and the frame-time measurements on a ~1 hour / ~3000 clip
 * test project look right while scrolling, wheel-zooming, dragging, trimming
 * and playing, the DOM renderer can be deleted. Files that then go away:
 *   components/Timeline/ClipItem.jsx        (cards → canvas draw)
 *   components/Timeline/TrackLane.jsx       (lane + drop targets → canvas)
 *   components/Timeline/TransitionClipItem.jsx
 *   components/Timeline/TimeRuler.jsx       (ruler ticks → canvas draw)
 *   components/shared/WaveformCanvas.jsx    (per-clip canvas → drawWaveform)
 * Keeping them one release behind the setting is intentional, so anyone who
 * hits a canvas bug has a working timeline to switch back to.
 */
import { useRef, useState, useMemo, useCallback, useEffect, memo } from 'react';
import { Plus, ZoomIn, ZoomOut, ArrowLeftToLine, ArrowRightToLine, X } from 'lucide-react';
import { TimeRuler } from './TimeRuler';
import { formatTimecode } from '../../utils/timeFormat';
import { TrackHeader } from './TrackHeader';
import { TrackLane } from './TrackLane';
import { PlayheadHandle, PlayheadLine } from './Playhead';
import { usePlaybackStore } from '../../hooks/PlaybackContext';
import { registerTimelineCenterOnPlayhead } from '../../services/timelineViewControls';
import { applyEdgeAutoScroll } from '../../utils/timelineAutoScroll';
import { TimelineCanvas } from './canvas/TimelineCanvas';
const HEADER_WIDTH = 180;
 
// Vertical layout constants + pure lane geometry for the flat timeline
// live in utils/timelineLayout.js (shared with TrackLane / TrackHeader and
// unit-tested). Re-exported here so existing importers stay unchanged.
export { TRACK_HEIGHT } from '../../utils/timelineLayout';
import { TRACK_HEIGHT, computeTrackLanes, isTransitionClipLike } from '../../utils/timelineLayout';
import './timeline.css';
 
export const Timeline = memo(function Timeline({
  tracks,
  clips,
  mediaAssets = [],
  totalDuration,
  pixelsPerSecond,
  selectedClipId,
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
  // been passed down from panels.jsx (and TrackLane/ClipItem have always
  // declared them) but were never declared HERE, so they arrived as
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
  onAttachScriptToEntity,
  onAddMediaAsset,
  onSplitVideoAndAudio,
  onOpenSilenceRemover,
  onOpenSilenceRemoverForTrack,
  silencePreviewData = null,
  // Draw the clip/lane area on a canvas instead of one ClipItem per clip
  // (services/editorSettings.js -> canvasTimeline). Off = today's DOM path.
  canvasTimeline = false,
}) {
  const [boxSelect, setBoxSelect] = useState(null); // { startX, startY, endX, endY } for lasso
  const playbackStore = usePlaybackStore();
  const lanesScrollRef = useRef(null);
  const lanesSurfaceRef = useRef(null);
  const rulerScrollRef = useRef(null);
  const scrollAreaRef = useRef(null);
  const justDraggedRef = useRef(false);
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
  // ── Ctrl/Cmd+wheel zoom coalescing ─────────────────────────────
  // A trackpad or a fast mouse wheel fires many 'wheel' events per
  // visual frame. Previously each one synchronously called
  // setPixelsPerSecond AND scheduled its own requestAnimationFrame to
  // re-anchor scroll position — so a single zoom gesture could queue up
  // several competing rAF callbacks per frame, each recalculating
  // scrollLeft against a scrollWidth that hadn't caught up yet. That's
  // what made zoom feel stepped/jittery instead of smooth. Now we just
  // accumulate the raw wheel delta here and flush it once per animation
  // frame (zoomFrameRef), so there is at most one pps update + one
  // scroll re-anchor per rendered frame, matching the visual refresh
  // rate the eye actually sees.
  const zoomAccumRef = useRef(0);
  const zoomFrameRef = useRef(null);
  const zoomAnchorTimeRef = useRef(null);
 
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
    const clipPositions = new Map(); // clipId -> { top, height }
    let surfaceY = 0;
 
    for (const row of trackRows) {
      row.y = surfaceY;
      row.clips.forEach((clip) => {
        // BUG FIX: this previously hardcoded TRACK_HEIGHT regardless of
        // the row's actual (possibly resized) height, so box-select's
        // vertical hit-test against pos.top + pos.height silently used
        // the wrong bottom edge for any track the user had resized —
        // clips in a taller track could fail to box-select past 64px in,
        // and clips in a shorter track had a hit-box taller than the row.
        clipPositions.set(clip.id, { top: surfaceY, height: row.rowHeight });
      });
      surfaceY += row.rowHeight;
    }
 
    return { trackRows, clipPositions, surfaceY };
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
  // and the toolbar zoom in/out buttons, so both paths keep the same
  // instant (the playhead/seekbar position) under the same screen x
  // instead of drifting the view — previously the toolbar buttons just
  // called setPixelsPerSecond with no scroll compensation at all, so
  // clicking them shifted the whole view relative to the left edge
  // rather than staying centered on the seekbar.
  const applyZoomStep = useCallback((delta) => {
    const scroller = lanesScrollRef.current;
    const anchorTime = playbackStore.getCurrentTime();
    const anchorScreenX = scroller
      ? HEADER_WIDTH + anchorTime * pixelsPerSecond - scroller.scrollLeft
      : null;
 
    const nextPps = Math.max(4, Math.min(240, pixelsPerSecond + delta));
 
    const reanchor = () => {
      if (!scroller || anchorScreenX === null) return;
      // Wait one more frame so totalWidth/scrollWidth have repainted for
      // the new pixelsPerSecond before we clamp against them.
      requestAnimationFrame(() => {
        const s = lanesScrollRef.current;
        // Skip the re-anchor while the panel is hidden (clientWidth 0): the
        // clamp would be computed against a meaningless maxScroll.
        if (!s || s.clientWidth === 0) return;
        const maxScroll = Math.max(0, s.scrollWidth - s.clientWidth);
        const desiredScrollLeft = HEADER_WIDTH + anchorTime * nextPps - anchorScreenX;
        s.scrollLeft = Math.max(0, Math.min(maxScroll, desiredScrollLeft));
        if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = s.scrollLeft;
        updateScrollMetrics();
      });
    };
 
    if (onSetPixelsPerSecond) {
      onSetPixelsPerSecond(nextPps);
    } else if (delta > 0) {
      onZoomIn?.();
    } else {
      onZoomOut?.();
    }
    reanchor();
  }, [pixelsPerSecond, playbackStore, onSetPixelsPerSecond, onZoomIn, onZoomOut, updateScrollMetrics]);
 
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
  // used (15), just routed through applyZoomStep so they re-center on the
  // seekbar the same way the wheel gesture does.
  const handleZoomInBtn = useCallback(() => {
    stopSmoothScroll();
    applyZoomStep(15);
  }, [applyZoomStep, stopSmoothScroll]);
 
  const handleZoomOutBtn = useCallback(() => {
    stopSmoothScroll();
    applyZoomStep(-15);
  }, [applyZoomStep, stopSmoothScroll]);

  // Center the view on the playhead WITHOUT changing zoom. Same anchor math
  // as applyZoomStep, but solved so the playhead lands in the middle of the
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
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }
 
    const onMove = (me) => scrollToClientX(me.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
 
      // Ctrl + Wheel: Zoom timeline, anchored on the playhead/seekbar
      // position (not the mouse, not the left edge) so the same instant
      // in time stays under the same screen x while pixelsPerSecond
      // changes — instead of the zoom appearing to happen at a "random"
      // spot (previously it just changed pps with no scroll compensation
      // at all, so the whole view shifted relative to the left edge).
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        stopSmoothScroll();
 
        // Scale the step to how hard the user is scrolling instead of a
        // fixed +/-15 per notch — a fast flick zooms faster, a gentle
        // nudge zooms gently, which reads as smooth instead of steppy.
        const rawDelta = Math.max(-60, Math.min(60, -e.deltaY));
        zoomAccumRef.current += rawDelta * 0.5;
 
        // Capture the anchor instant once per gesture (first tick after
        // the previous frame flushed), not on every wheel event -- the
        // anchor must stay fixed for the whole gesture or the "same
        // instant under the cursor" guarantee drifts tick to tick.
        if (zoomAnchorTimeRef.current === null) {
          zoomAnchorTimeRef.current = playbackStore.getCurrentTime();
        }
 
        if (zoomFrameRef.current) return; // already scheduled for this frame
 
        zoomFrameRef.current = requestAnimationFrame(() => {
          zoomFrameRef.current = null;
          const pending = zoomAccumRef.current;
          zoomAccumRef.current = 0;
          zoomAnchorTimeRef.current = null;
          if (pending === 0) return;
          // Delegate to the same re-anchor logic the toolbar buttons use,
          // so wheel-zoom and button-zoom behave identically.
          applyZoomStep(pending);
        });
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
        zoomFrameRef.current = null;
      }
      zoomAccumRef.current = 0;
      zoomAnchorTimeRef.current = null;
    };
  }, [onSetPixelsPerSecond, onZoomIn, onZoomOut, applyZoomStep, startSmoothScroll, stopSmoothScroll, pixelsPerSecond, playbackStore, updateScrollMetrics]);
 
  const handleLanesPointerDown = (e) => {
    stopSmoothScroll();
    if (
      e.target.closest('.timeline-clip-card') ||
      e.target.closest('.track-header-sticky') ||
      e.target.closest('.track-btn') ||
      e.target.closest('.track-name-input')
    ) {
      return;
    }
 
    // Right mouse button, middle mouse button, or Alt/Space drag: Pan.
    // Right-click pan suppresses the browser's native context menu for
    // the duration of the gesture (see handlePanStart) so a right-drag
    // never flashes the OS menu on release — a plain right-click with no
    // movement still lets the menu through as normal.
    if (e.button === 2 || e.button === 1 || e.altKey) {
      handlePanStart(e);
      return;
    }
 
    // Left mouse button: Marquee/Lasso Selection
    if (e.button === 0) {
      handleLassoStart(e);
    }
  };
 
  const handlePanStart = (e) => {
    const scroller = lanesScrollRef.current;
    if (!scroller) return;
    e.preventDefault();
    const isRightButton = e.button === 2;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
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
    // gesture that actually panned — a right-click with no movement
    // should still open the menu normally, same as anywhere else.
    const onContextMenu = (ce) => {
      if (isRightButton && hasMoved) {
        ce.preventDefault();
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (isRightButton) {
        // The 'contextmenu' event fires right after 'pointerup' for the
        // same right-click, so this listener has to still be attached
        // when it fires — remove it on the next tick instead of now.
        setTimeout(() => {
          window.removeEventListener('contextmenu', onContextMenu, true);
        }, 0);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    if (isRightButton) {
      window.addEventListener('contextmenu', onContextMenu, true);
    }
  };
 
  const handleLassoStart = (e) => {
    e.preventDefault();
    const surfaceEl = lanesSurfaceRef.current;
    if (!surfaceEl) return;
    const surfaceRect = surfaceEl.getBoundingClientRect();
    const startX = e.clientX - surfaceRect.left;
    const startY = e.clientY - surfaceRect.top;
    const isAdditive = e.shiftKey;
    const baseSelected = isAdditive ? [...selectedIds] : [];
    let hasMoved = false;
 
    setBoxSelect({ startX, startY, endX: startX, endY: startY });
    if (!isAdditive) {
      onClearSelection();
    }
 
    const onMove = (me) => {
      if (!lanesSurfaceRef.current) return;
      const curRect = lanesSurfaceRef.current.getBoundingClientRect();
      const endX = me.clientX - curRect.left;
      const endY = me.clientY - curRect.top;
 
      if (Math.abs(endX - startX) > 4 || Math.abs(endY - startY) > 4) {
        hasMoved = true;
        justDraggedRef.current = true;
      }
      setBoxSelect({ startX, startY, endX, endY });
 
      // Edge auto-scroll during lasso. The shared helper also mirrors the
      // scroll onto the ruler so its tick marks stay aligned with the lanes.
      applyEdgeAutoScroll(me.clientX, {
        lanesEl: lanesScrollRef.current,
        rulerEl: rulerScrollRef.current,
        headerWidth: HEADER_WIDTH,
        edgeMargin: 40,
        scrollSpeed: 10,
      });
    };
 
    const onUp = (upEvent) => {
      if (hasMoved && lanesSurfaceRef.current) {
        const curRect = lanesSurfaceRef.current.getBoundingClientRect();
        const ux1 = Math.min(startX, upEvent.clientX - curRect.left);
        const ux2 = Math.max(startX, upEvent.clientX - curRect.left);
        const uy1 = Math.min(startY, upEvent.clientY - curRect.top);
        const uy2 = Math.max(startY, upEvent.clientY - curRect.top);
 
        const hitIds = [];
        clips.forEach((clip) => {
          const clipLeft = HEADER_WIDTH + clip.startTime * pixelsPerSecond;
          const clipRight = clipLeft + Math.max(16, clip.duration * pixelsPerSecond);
          const pos = layout.clipPositions.get(clip.id);
          if (!pos) return;
          const clipTop = pos.top;
          const clipBottom = pos.top + pos.height;
          if (clipLeft < ux2 && clipRight > ux1 && clipTop < uy2 && clipBottom > uy1) {
            hitIds.push(clip.id);
          }
        });
 
        const finalIds = [...new Set([...baseSelected, ...hitIds])];
        if (finalIds.length > 0) {
          setSelectedIds(finalIds);
          setSelectedEntityId(finalIds[0]);
        } else if (!isAdditive) {
          setSelectedIds([]);
          setSelectedEntityId(null);
        }
      } else if (!hasMoved) {
        // Plain left-click (no drag) on empty lane space: move the
        // playhead to that position, same as clicking the ruler —
        // startX is already in lanes-surface coordinates, which bake in
        // HEADER_WIDTH the same way the clip hit-test above does.
        const clickTime = Math.max(0, (startX - HEADER_WIDTH) / pixelsPerSecond);
        if (onSeek) onSeek(clickTime);
      }
 
      setBoxSelect(null);
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 50);
 
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
 
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
 
  // Compute which clips are inside the box selection in real-time
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

  const boxSelectedIds = useMemo(() => {
    if (!boxSelect) return [];
    const x1 = Math.min(boxSelect.startX, boxSelect.endX);
    const x2 = Math.max(boxSelect.startX, boxSelect.endX);
    const y1 = Math.min(boxSelect.startY, boxSelect.endY);
    const y2 = Math.max(boxSelect.startY, boxSelect.endY);
    if (x2 - x1 < 4 && y2 - y1 < 4) return [];
 
    const selected = [];
    clips.forEach((clip) => {
      const clipLeft = HEADER_WIDTH + clip.startTime * pixelsPerSecond;
      const clipRight = clipLeft + Math.max(16, clip.duration * pixelsPerSecond);
      const pos = layout.clipPositions.get(clip.id);
      if (!pos) return;
      const clipTop = pos.top;
      const clipBottom = pos.top + pos.height;
      if (clipLeft < x2 && clipRight > x1 && clipTop < y2 && clipBottom > y1) {
        selected.push(clip.id);
      }
    });
    return selected;
  }, [boxSelect, clips, pixelsPerSecond, layout]);

  // PERF FIX: previously this merge was built inline as
  // `[...new Set([...selectedIds, ...boxSelectedIds])]` at the TrackLane
  // call site below, which allocates a brand-new array every single
  // Timeline render regardless of whether the actual selection changed.
  // Every ClipItem is wrapped in React.memo and compares this array by
  // reference, so a new array each render meant every clip on every track
  // re-rendered on any Timeline re-render (zoom, scroll, playhead tick,
  // unrelated state changes) — not just on real selection changes. Memoizing
  // it here means ClipItem's memo comparison actually holds when the
  // selection hasn't changed, which is the single biggest win available
  // without restructuring the component tree.
  const mergedSelectedIds = useMemo(
    () => [...new Set([...selectedIds, ...boxSelectedIds])],
    [selectedIds, boxSelectedIds]
  );

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
            onClick={(e) => {
              if (justDraggedRef.current) return;
              if (
                e.target === e.currentTarget ||
                e.target.classList.contains('track-grid-pattern') ||
                // Canvas renderer: the lanes are spacers, so the empty space
                // a user clicks is `.track-lane-spacer` — without this, click
                // -to-clear-selection silently stops working with the canvas
                // on, since the old class checks never match.
                e.target.classList.contains('track-lane-spacer') ||
                e.target.classList.contains('track-lane-row')
              ) {
                onSelectClip(null);
                onClearSelection();
              }
            }}
          >
            <div
              ref={lanesSurfaceRef}
              className="lanes-surface"
              style={{ width: `${totalWidth + HEADER_WIDTH}px`, position: 'relative' }}
              onPointerDown={handleLanesPointerDown}
            >
              {/* Box selection overlay */}
              {boxSelect && (
                <div
                  className="timeline-box-select"
                  style={{
                    position: 'absolute',
                    left: Math.min(boxSelect.startX, boxSelect.endX),
                    top: Math.min(boxSelect.startY, boxSelect.endY),
                    width: Math.abs(boxSelect.endX - boxSelect.startX),
                    height: Math.abs(boxSelect.endY - boxSelect.startY),
                    pointerEvents: 'none',
                    zIndex: 50,
                  }}
                />
              )}
 
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
                  {canvasTimeline ? (
                    // Canvas renderer: the row keeps its exact size so native
                    // scrolling, the minimap scrollbar and zoom anchoring are
                    // untouched, but the clips are drawn by TimelineCanvas
                    // instead of being DOM nodes.
                    <div
                      className="track-lane-spacer"
                      style={{ width: `${totalWidth}px`, height: row.rowHeight, flexShrink: 0 }}
                    />
                  ) : (
                  <TrackLane
                    track={row.track}
                    tracks={tracks}
                    mediaAssets={mediaAssets}
                    clips={row.clips}
                    allClips={clips}
                    rowHeight={row.rowHeight}
                    pixelsPerSecond={pixelsPerSecond}
                    isRecordingTarget={recordingTrackId === row.track.id}
                    recordingStartTime={recordingStartTime}
                    recordingLevel={recordingLevel}
                    selectedClipId={selectedClipId}
                    selectedIds={mergedSelectedIds}
                    onSelectClip={onSelectClip}
                    onToggleSelect={onToggleSelect}
                    onRangeSelect={onRangeSelect}
                    onUpdateClip={onUpdateClip}
                    onUpdateClips={onUpdateClips}
                    onDuplicateClips={onDuplicateClips}
                    onDeleteClip={onDeleteClip}
                    onCopySelected={onCopySelected}
                    onCutSelected={onCutSelected}
                    onPasteClips={onPasteClips}
                    onAttachScriptToEntity={onAttachScriptToEntity}
                    onDropItemOnTrack={onDropItemOnTrack}
                    onAddMediaAsset={onAddMediaAsset}
                    onSplitVideoAndAudio={onSplitVideoAndAudio}
                    onOpenSilenceRemover={onOpenSilenceRemover}
                    silencePreviewData={silencePreviewData}
                    snappingPoints={snappingPoints}
                    snappingEnabled={snappingEnabled}
                    totalWidth={totalWidth}
                  />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Canvas renderer: a viewport-pinned overlay over the lanes area.

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
          {canvasTimeline && (
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
            />
          )}
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