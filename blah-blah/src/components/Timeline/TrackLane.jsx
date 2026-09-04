import { useState, memo } from 'react';
import { ClipItem } from './ClipItem';

export const TrackLane = memo(function TrackLane({
  track,
  tracks = [],
  clips,
  allClips,
  pixelsPerSecond,
  selectedClipId,
  selectedIds,
  onSelectClip,
  onToggleSelect,
  onRangeSelect,
  onUpdateClip,
  onUpdateClips,
  onDuplicateClips,
  onAddEmptyClip,
  onDropItemOnTrack,
  snappingPoints,
  snappingEnabled,
  totalWidth,
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const trackClips = clips.filter((c) => c.trackId === track.id);
  const fullClipList = allClips || clips;

  const handleDragOver = (e) => {
    if (track.locked) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    if (track.locked) return;
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

  const handleDoubleClick = (e) => {
    if (track.locked) return;
    if (e.target.closest('.timeline-clip-card')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickTime = Math.max(0, clickX / pixelsPerSecond);
    if (onAddEmptyClip) {
      onAddEmptyClip(track.id, clickTime);
    }
  };

  return (
    <div
      data-track-id={track.id}
      className={`track-lane-row ${isDragOver ? 'drag-target' : ''} ${track.locked ? 'lane-locked' : ''}`}
      style={{ width: `${totalWidth}px` }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDoubleClick={handleDoubleClick}
      title={track.locked ? `${track.name} is locked` : "Double-click empty track space to add a clip here"}
    >
      <div className="track-grid-pattern" />
      {trackClips.map((clip) => (
        <ClipItem
          key={clip.id}
          clip={clip}
          allClips={fullClipList}
          tracks={tracks}
          isLocked={track.locked}
          pixelsPerSecond={pixelsPerSecond}
          isSelected={selectedClipId === clip.id}
          selectedIds={selectedIds}
          onSelectClip={onSelectClip}
          onToggleSelect={onToggleSelect}
          onRangeSelect={onRangeSelect}
          onUpdateClip={onUpdateClip}
          onUpdateClips={onUpdateClips}
          onDuplicateClips={onDuplicateClips}
          snappingPoints={snappingPoints}
          snappingEnabled={snappingEnabled}
        />
      ))}
    </div>
  );
});
