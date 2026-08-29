import { useState, memo } from 'react';
import { ClipItem } from './ClipItem';

export const TrackLane = memo(function TrackLane({
  track,
  clips,
  pixelsPerSecond,
  selectedClipId,
  onSelectClip,
  onUpdateClip,
  onDropItemOnTrack,
  snappingPoints,
  snappingEnabled,
  totalWidth,
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const trackClips = clips.filter((c) => c.trackId === track.id);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    try {
      const dataStr = e.dataTransfer.getData('application/json');
      if (!dataStr) return;
      const data = JSON.parse(dataStr);

      const rect = e.currentTarget.getBoundingClientRect();
      const dropX = e.clientX - rect.left;
      const dropTime = Math.max(0, dropX / pixelsPerSecond);

      if (onDropItemOnTrack) {
        onDropItemOnTrack({
          itemType: data.type,
          itemId: data.id,
          targetTrackId: track.id,
          startTime: dropTime,
        });
      }
    } catch {
      // Ignore drop parse error
    }
  };

  return (
    <div
      data-track-id={track.id}
      className={`track-lane-row ${isDragOver ? 'drag-target' : ''}`}
      style={{ width: `${totalWidth}px` }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="track-grid-pattern" />
      {trackClips.map((clip) => (
        <ClipItem
          key={clip.id}
          clip={clip}
          pixelsPerSecond={pixelsPerSecond}
          isSelected={selectedClipId === clip.id}
          onSelectClip={onSelectClip}
          onUpdateClip={onUpdateClip}
          snappingPoints={snappingPoints}
          snappingEnabled={snappingEnabled}
        />
      ))}
    </div>
  );
});
