import { useRef, useState, useMemo, useCallback, useEffect, memo } from 'react';
import { Plus, ZoomIn, ZoomOut, ArrowLeftToLine, ArrowRightToLine, X } from 'lucide-react';
import { TimeRuler } from './TimeRuler';
import { formatTimecode } from '../../utils/timeFormat';
import { TrackHeader } from './TrackHeader';
import { TrackLane } from './TrackLane';
import { PlayheadHandle, PlayheadLine } from './Playhead';
import { usePlaybackStore } from '../../hooks/PlaybackContext';

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
  onUpdateTrack,
  onAddTrack,
  onAddEmptyClip,
  onDropItemOnTrack,
  onToggleRecordTrack,
  onZoomIn,
  onZoomOut,
  exportRange,
  onSetExportRange,
  selectedIds,
  onToggleSelect,
  onRangeSelect,
  onClearSelection,
  setSelectedIds,
  setSelectedEntityId,
}) {
  const [boxSelect, setBoxSelect] = useState(null); // { startX, startY, endX, endY } for lasso
  const playbackStore = usePlaybackStore();
  const lanesScrollRef = useRef(null);
  const rulerScrollRef = useRef(null);
 
  const handleLanesScroll = () => {
    if (!lanesScrollRef.current) return;
    // Sync horizontal: lanes → ruler
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = lanesScrollRef.current.scrollLeft;
    }
  };
 
  // Read playhead position from the playback store at drag-time only — never
  // as a React prop — so this component stays stable during playback.
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
  }, [clips, snappingEnabled, playbackStore]);  const totalWidth = Math.max(totalDuration * pixelsPerSecond + 400, 1600);
  const timelineLanesHeight = tracks.length * 64;

  const handleSetIn = useCallback(() => {
    const t = playbackStore.getCurrentTime();
    const out = exportRange?.out ?? totalDuration;
    onSetExportRange({ in: Math.min(t, out - 0.1), out });
  }, [exportRange, totalDuration, playbackStore, onSetExportRange]);

  const handleSetOut = useCallback(() => {
    const t = playbackStore.getCurrentTime();
    const inp = exportRange?.in ?? 0;
    onSetExportRange({ in: inp, out: Math.max(t, inp + 0.1) });
  }, [exportRange, playbackStore, onSetExportRange]);

  const handleClearRange = useCallback(() => {
    onSetExportRange(null);
  }, [onSetExportRange]);

  // Auto-scroll timeline to keep playhead visible during playback
  useEffect(() => {
    const unsub = playbackStore.registerFrameCallback((time) => {
      const scroll = lanesScrollRef.current;
      if (!scroll) return;
      const px = time * pixelsPerSecond;
      const scrollLeft = scroll.scrollLeft;
      const viewWidth = scroll.clientWidth;
      // If playhead is outside visible area, scroll to keep it centered
      if (px < scrollLeft + 40 || px > scrollLeft + viewWidth - 40) {
        scroll.scrollLeft = Math.max(0, px - viewWidth / 2);
      }
    });
    return unsub;
  }, [playbackStore, pixelsPerSecond]);

  // Box/lasso selection: Ctrl+drag on empty space to select multiple clips.
  // Plain drag (no modifier) on empty space instead pans the timeline
  // horizontally, like a hand/pan tool.
  const handleLanesPointerDown = (e) => {
    if (e.target.closest('.timeline-clip-card')) return;
    if (e.button !== 0) return;

    if (e.ctrlKey || e.metaKey) {
      handleLassoStart(e);
    } else {
      handlePanStart(e);
    }
  };

  const handlePanStart = (e) => {
    const scroller = lanesScrollRef.current;
    if (!scroller) return;
    e.preventDefault();
    const startClientX = e.clientX;
    const startScrollLeft = scroller.scrollLeft;

    const onMove = (me) => {
      const deltaX = me.clientX - startClientX;
      scroller.scrollLeft = startScrollLeft - deltaX;
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
    const scrollLeft = lanesScrollRef.current?.scrollLeft || 0;
    const rect = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX - rect.left + scrollLeft;
    const startY = e.clientY - rect.top;

    setBoxSelect({ startX, startY, endX: startX, endY: startY });
    onClearSelection();

    const onMove = (me) => {
      const endX = me.clientX - rect.left + scrollLeft;
      const endY = me.clientY - rect.top;
      setBoxSelect((prev) => prev ? { ...prev, endX, endY } : null);
    };
    const onUp = (upEvent) => {
      const upRect = e.currentTarget.getBoundingClientRect();
      const ux1 = Math.min(startX, upEvent.clientX - upRect.left + scrollLeft);
      const ux2 = Math.max(startX, upEvent.clientX - upRect.left + scrollLeft);
      const uy1 = Math.min(startY, upEvent.clientY - upRect.top);
      const uy2 = Math.max(startY, upEvent.clientY - upRect.top);
      const boxArea = (ux2 - ux1) * (uy2 - uy1);
      if (boxArea > 100) {
        const hitIds = [];
        clips.forEach((clip) => {
          const clipLeft = clip.startTime * pixelsPerSecond;
          const clipRight = clipLeft + Math.max(16, clip.duration * pixelsPerSecond);
          const trackIdx = tracks.findIndex((t) => t.id === clip.trackId);
          const clipTop = trackIdx * 64;
          const clipBottom = clipTop + 64;
          if (clipLeft < ux2 && clipRight > ux1 && clipTop < uy2 && clipBottom > uy1) {
            hitIds.push(clip.id);
          }
        });
        if (hitIds.length > 0) {
          setSelectedIds(hitIds);
          setSelectedEntityId(hitIds[0]);
        }
      }
      setBoxSelect(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Compute which clips are inside the box selection
  const boxSelectedIds = useMemo(() => {
    if (!boxSelect) return [];
    const x1 = Math.min(boxSelect.startX, boxSelect.endX);
    const x2 = Math.max(boxSelect.startX, boxSelect.endX);
    const y1 = Math.min(boxSelect.startY, boxSelect.endY);
    const y2 = Math.max(boxSelect.startY, boxSelect.endY);
    const selected = [];
    clips.forEach((clip) => {
      const clipLeft = clip.startTime * pixelsPerSecond;
      const clipRight = clipLeft + Math.max(16, clip.duration * pixelsPerSecond);
      const trackIdx = tracks.findIndex((t) => t.id === clip.trackId);
      const clipTop = trackIdx * 64;
      const clipBottom = clipTop + 64;
      // Check overlap
      if (clipLeft < x2 && clipRight > x1 && clipTop < y2 && clipBottom > y1) {
        selected.push(clip.id);
      }
    });
    return selected;
  }, [boxSelect, clips, pixelsPerSecond, tracks]);

  // Apply box selection on mouse up
  const boxSelectRef = useRef(null);
  boxSelectRef.current = boxSelectedIds;

  return (
    <section className="timeline-editor-panel">
      {/* Top Header of Timeline */}
      <div className="timeline-top-bar">
        <span className="timeline-title-label">TIMELINE</span>
        <div className="timeline-actions-group" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button 
            className="timeline-zoom-btn" 
            onClick={onZoomOut}
            title="Zoom Out"
          >
            <ZoomOut size={12} />
          </button>
          <button 
            className="timeline-zoom-btn" 
            onClick={onZoomIn}
            title="Zoom In"
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
                <span>{formatTimecode(exportRange.out - exportRange.in)}</span>
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
        {/* Single scrollable container — headers + lanes scroll together */}
        <div className="timeline-scroll-area">
          {/* Ruler — sticky top so it stays visible when scrolling down.
              The playhead handle lives here too: this element's
              scrollLeft is kept in sync with the lanes, so the handle's
              horizontal position is correct without fighting CSS sticky
              positioning against a transformed ancestor. */}
          <div className="ruler-wrapper" ref={rulerScrollRef}>
            <TimeRuler
              totalDuration={totalDuration}
              pixelsPerSecond={pixelsPerSecond}
              onSeek={onSeek}
            />
            <PlayheadHandle pixelsPerSecond={pixelsPerSecond} onSeek={onSeek} />
          </div>
 
          <div
            className="lanes-wrapper"
            ref={lanesScrollRef}
            onScroll={handleLanesScroll}
            onClick={(e) => {
              if (e.target === e.currentTarget || e.target.classList.contains('track-grid-pattern')) {
                onSelectClip(null);
                onClearSelection();
              }
            }}
          >
            <div
              className="lanes-surface"
              style={{ width: `${totalWidth + 180}px`, position: 'relative' }}
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
              {/* Export range overlay */}
              {exportRange && (
                <>
                  {/* Dimmed area before in-point */}
                  <div
                    className="export-range-dim"
                    style={{
                      left: 0,
                      width: `${exportRange.in * pixelsPerSecond}px`,
                      height: `${timelineLanesHeight}px`,
                    }}
                  />
                  {/* Dimmed area after out-point */}
                  <div
                    className="export-range-dim"
                    style={{
                      left: `${exportRange.out * pixelsPerSecond}px`,
                      width: `${totalWidth - exportRange.out * pixelsPerSecond}px`,
                      height: `${timelineLanesHeight}px`,
                    }}
                  />
                  {/* In-point marker */}
                  <div
                    className="export-range-marker in-marker"
                    style={{ left: `${exportRange.in * pixelsPerSecond}px`, height: `${timelineLanesHeight}px` }}
                    title={`In: ${formatTimecode(exportRange.in)}`}
                  />
                  {/* Out-point marker */}
                  <div
                    className="export-range-marker out-marker"
                    style={{ left: `${exportRange.out * pixelsPerSecond}px`, height: `${timelineLanesHeight}px` }}
                    title={`Out: ${formatTimecode(exportRange.out)}`}
                  />
                </>
              )}

              <PlayheadLine
                pixelsPerSecond={pixelsPerSecond}
                onSeek={onSeek}
                timelineHeight={timelineLanesHeight + 30}
              />

              {/* Each track is one row: sticky header + lane side by side,
                  so they can never drift out of alignment with each other. */}
              {tracks.map((track) => (
                <div key={track.id} className="track-full-row">
                  <div className="track-header-sticky">
                    <TrackHeader
                      track={track}
                      onUpdateTrack={onUpdateTrack}
                      onAddEmptyClip={onAddEmptyClip}
                      isRecordingTarget={recordingTrackId === track.id}
                      isAnyTrackRecording={!!recordingTrackId}
                      onToggleRecordTrack={onToggleRecordTrack}
                    />
                  </div>
                  <TrackLane
                    track={track}
                    clips={clips}
                    allClips={clips}
                    pixelsPerSecond={pixelsPerSecond}
                    selectedClipId={selectedClipId}
                    selectedIds={[...new Set([...selectedIds, ...boxSelectedIds])]}
                    onSelectClip={onSelectClip}
                    onToggleSelect={onToggleSelect}
                    onRangeSelect={onRangeSelect}
                    onUpdateClip={onUpdateClip}
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
 