import { useRef, useState, useMemo, useCallback, useEffect, memo } from 'react';
import { Plus, ZoomIn, ZoomOut, ArrowLeftToLine, ArrowRightToLine, X } from 'lucide-react';
import { TimeRuler } from './TimeRuler';
import { formatTimecode } from '../../utils/timeFormat';
import { TrackHeader } from './TrackHeader';
import { TrackLane } from './TrackLane';
import { PlayheadHandle, PlayheadLine } from './Playhead';
import { usePlaybackStore } from '../../hooks/PlaybackContext';
const HEADER_WIDTH = 180;

export const Timeline = memo(function Timeline({
  tracks,
  clips,
  totalDuration,
  pixelsPerSecond,
  selectedClipId,
  snappingEnabled,
  recordingTrackId,
  onSeek,
  onSelectClip,
  onUpdateClip,
  onUpdateClips,
  onDuplicateClips,
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
}) {
  const [boxSelect, setBoxSelect] = useState(null); // { startX, startY, endX, endY } for lasso
  const playbackStore = usePlaybackStore();
  const lanesScrollRef = useRef(null);
  const lanesSurfaceRef = useRef(null);
  const rulerScrollRef = useRef(null);
  const scrollAreaRef = useRef(null);
  const justDraggedRef = useRef(false);
  const lastUserScrollTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const smoothScrollAnimIdRef = useRef(null);

  const handleLanesScroll = () => {
    lastUserScrollTimeRef.current = Date.now();
    if (!lanesScrollRef.current) return;
    // Sync horizontal: lanes → ruler
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = lanesScrollRef.current.scrollLeft;
    }
  };

  const snappingPoints = useMemo(() => {
    if (!snappingEnabled) return [];
    const points = new Set();
    points.add(0);
    points.add(playbackStore.getCurrentTime());
    clips.forEach((clip) => {
      points.add(clip.startTime);
      points.add(clip.startTime + clip.duration);
    });
    return Array.from(points);
  }, [clips, snappingEnabled, playbackStore]);

  const totalWidth = Math.max(totalDuration * pixelsPerSecond + 400, 1600);
  const timelineLanesHeight = Math.max(tracks.length * 64, 180);

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

  // Auto-scroll timeline to keep playhead visible ONLY during active playback
  useEffect(() => {
    const unsub = playbackStore.registerFrameCallback((time) => {
      // 1. Only auto-scroll while playing (never when paused or seeking)
      if (!playbackStore.getIsPlaying()) return;

      // 2. Do not auto-scroll if user scrolled or interacted within the last 2 seconds
      if (Date.now() - lastUserScrollTimeRef.current < 2000) return;

      const scroll = lanesScrollRef.current;
      if (!scroll) return;
      const px = HEADER_WIDTH + time * pixelsPerSecond;
      const scrollLeft = scroll.scrollLeft;
      const viewWidth = scroll.clientWidth;

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

      // Ctrl + Wheel: Zoom timeline
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        stopSmoothScroll();
        const zoomDelta = e.deltaY < 0 ? 15 : -15;
        if (onSetPixelsPerSecond) {
          onSetPixelsPerSecond((prev) => Math.max(15, Math.min(240, prev + zoomDelta)));
        } else {
          if (e.deltaY < 0) onZoomIn?.();
          else onZoomOut?.();
        }
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
    };
  }, [onSetPixelsPerSecond, onZoomIn, onZoomOut, startSmoothScroll, stopSmoothScroll]);

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

    // Middle mouse button or Alt/Space drag: Pan
    if (e.button === 1 || e.altKey) {
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
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startScrollLeft = scroller.scrollLeft;
    const startScrollTop = scroller.scrollTop;

    const onMove = (me) => {
      scroller.scrollLeft = startScrollLeft - (me.clientX - startClientX);
      scroller.scrollTop = startScrollTop - (me.clientY - startClientY);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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

      // Edge auto-scroll during lasso
      const scrollEl = lanesScrollRef.current;
      if (scrollEl) {
        const wrapRect = scrollEl.getBoundingClientRect();
        const edgeMargin = 40;
        const scrollSpeed = 10;
        if (me.clientX < wrapRect.left + HEADER_WIDTH + edgeMargin) {
          scrollEl.scrollLeft = Math.max(0, scrollEl.scrollLeft - scrollSpeed);
        } else if (me.clientX > wrapRect.right - edgeMargin) {
          scrollEl.scrollLeft += scrollSpeed;
        }
      }
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
          const trackIdx = tracks.findIndex((t) => t.id === clip.trackId);
          const clipTop = trackIdx * 64;
          const clipBottom = clipTop + 64;
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
      const trackIdx = tracks.findIndex((t) => t.id === clip.trackId);
      const clipTop = trackIdx * 64;
      const clipBottom = clipTop + 64;
      if (clipLeft < x2 && clipRight > x1 && clipTop < y2 && clipBottom > y1) {
        selected.push(clip.id);
      }
    });
    return selected;
  }, [boxSelect, clips, pixelsPerSecond, tracks]);

  return (
    <section className="timeline-editor-panel">
      {/* Top Header of Timeline */}
      <div className="timeline-top-bar">
        <span className="timeline-title-label">TIMELINE</span>
        <div className="timeline-actions-group" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button 
            className="timeline-zoom-btn" 
            onClick={onZoomOut}
            title="Zoom Out (-)"
          >
            <ZoomOut size={12} />
          </button>
          <button 
            className="timeline-zoom-btn" 
            onClick={onZoomIn}
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
            <span>+ Add Clip</span>
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
              {tracks.map((track) => (
                <div key={track.id} className="track-full-row">
                  <div className="track-header-sticky">
                    <TrackHeader
                      track={track}
                      onUpdateTrack={onUpdateTrack}
                      onDeleteTrack={onDeleteTrack}
                      canDeleteTrack={tracks.length > 1}
                      onAddEmptyClip={onAddEmptyClip}
                      isRecordingTarget={recordingTrackId === track.id}
                      isAnyTrackRecording={!!recordingTrackId}
                      onToggleRecordTrack={onToggleRecordTrack}
                    />
                  </div>
                  <TrackLane
                    track={track}
                    tracks={tracks}
                    clips={clips}
                    allClips={clips}
                    pixelsPerSecond={pixelsPerSecond}
                    selectedClipId={selectedClipId}
                    selectedIds={[...new Set([...selectedIds, ...boxSelectedIds])]}
                    onSelectClip={onSelectClip}
                    onToggleSelect={onToggleSelect}
                    onRangeSelect={onRangeSelect}
                    onUpdateClip={onUpdateClip}
                    onUpdateClips={onUpdateClips}
                    onDuplicateClips={onDuplicateClips}
                    onAddEmptyClip={onAddEmptyClip}
                    onDropItemOnTrack={onDropItemOnTrack}
                    snappingPoints={snappingPoints}
                    snappingEnabled={snappingEnabled}
                    totalWidth={totalWidth}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});
 