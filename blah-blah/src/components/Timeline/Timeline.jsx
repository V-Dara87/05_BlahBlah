import { useRef, useMemo, memo } from 'react';
import { Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { TimeRuler } from './TimeRuler';
import { TrackHeader } from './TrackHeader';
import { TrackLane } from './TrackLane';
import { Playhead } from './Playhead';
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
}) {
  const playbackStore = usePlaybackStore();
  const lanesScrollRef = useRef(null);
  const rulerScrollRef = useRef(null);
 
  const handleLanesScroll = () => {
    if (lanesScrollRef.current && rulerScrollRef.current) {
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
  }, [clips, snappingEnabled, playbackStore]);
 
  const totalWidth = Math.max(totalDuration * pixelsPerSecond + 400, 1600);
  const timelineLanesHeight = tracks.length * 64;
 
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
        {/* Left Track Headers */}
        <div className="timeline-headers-sidebar">
          {tracks.map((track) => (
            <TrackHeader
              key={track.id}
              track={track}
              onUpdateTrack={onUpdateTrack}
              onAddEmptyClip={onAddEmptyClip}
              isRecordingTarget={recordingTrackId === track.id}
              isAnyTrackRecording={!!recordingTrackId}
              onToggleRecordTrack={onToggleRecordTrack}
            />
          ))}
        </div>
 
        {/* Right Scrollable Area */}
        <div className="timeline-scroll-area">
          <div className="ruler-wrapper" ref={rulerScrollRef}>
            <TimeRuler
              totalDuration={totalDuration}
              pixelsPerSecond={pixelsPerSecond}
              onSeek={onSeek}
            />
          </div>
 
          <div
            className="lanes-wrapper"
            ref={lanesScrollRef}
            onScroll={handleLanesScroll}
            onClick={(e) => {
              if (e.target === e.currentTarget || e.target.classList.contains('track-grid-pattern')) {
                onSelectClip(null);
              }
            }}
          >
            <div className="lanes-surface" style={{ width: `${totalWidth}px` }}>
              <Playhead
                pixelsPerSecond={pixelsPerSecond}
                onSeek={onSeek}
                timelineHeight={timelineLanesHeight + 30}
              />
 
              {tracks.map((track) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  clips={clips}
                  pixelsPerSecond={pixelsPerSecond}
                  selectedClipId={selectedClipId}
                  onSelectClip={onSelectClip}
                  onUpdateClip={onUpdateClip}
                  onAddEmptyClip={onAddEmptyClip}
                  onDropItemOnTrack={onDropItemOnTrack}
                  snappingPoints={snappingPoints}
                  snappingEnabled={snappingEnabled}
                  totalWidth={totalWidth}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});
 