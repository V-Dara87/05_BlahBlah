import { useState, memo } from 'react';
import { ClipItem } from './ClipItem';
import { TRACK_HEIGHT } from '../../utils/timelineLayout';
import { importMediaFiles } from '../../services/mediaImport';

/**
 * TrackLane — the time-area half of one timeline track row.
 * Each TrackLane is a full, standard track lane:
 *   - Multiple clips comfortably coexist here.
 *   - Double-clicking empty space adds a clip at the clicked time.
 */
export const TrackLane = memo(function TrackLane({
  track,
  tracks = [],
  mediaAssets = [],
  clips = [],
  allClips = [],
  rowHeight = TRACK_HEIGHT,
  pixelsPerSecond,
  selectedClipId,
  selectedIds,
  onSelectClip,
  onToggleSelect,
  onRangeSelect,
  onUpdateClip,
  onUpdateClips,
  onDuplicateClips,
  onAttachScriptToEntity,
  onAddEmptyClip,
  onDropItemOnTrack,
  onAddMediaAsset,
  onSplitVideoAndAudio,
  snappingPoints,
  snappingEnabled,
  totalWidth,
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fullClipList = allClips.length > 0 ? allClips : clips;

  const spawnFromDrop = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dropTime = Math.max(0, (e.clientX - rect.left) / pixelsPerSecond);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0 && onAddMediaAsset && onDropItemOnTrack) {
      const fileList = Array.from(files).filter(
        (f) => f.type?.startsWith('video/') || f.type?.startsWith('audio/')
      );
      if (fileList.length > 0) {
        importMediaFiles({
          files: fileList,
          mediaAssets,
          onAddMediaAsset: (asset, file) => {
            onAddMediaAsset(asset, file);
            onDropItemOnTrack({
              itemType: 'media',
              itemId: asset.id,
              itemData: asset,
              targetTrackId: track.id,
              startTime: dropTime,
            });
          },
        });
        return true;
      }
    }

    // In-app drag (Project panel media/prefab/script, shared library).
    try {
      const dataStr = e.dataTransfer.getData('application/json');
      if (!dataStr) return false;
      const data = JSON.parse(dataStr);
      if (onDropItemOnTrack) {
        onDropItemOnTrack({
          itemType: data.itemType,
          itemId: data.itemData?.id,
          itemData: data.itemData,
          targetTrackId: track.id,
          startTime: dropTime,
        });
      }
      return true;
    } catch {
      return false;
    }
  };

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
    setIsDragOver(false);
    e.preventDefault();
    e.stopPropagation();
    spawnFromDrop(e);
  };

  const handleMainLaneDoubleClick = (e) => {
    if (track.locked) return;
    if (e.target.closest('.timeline-clip-card')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickTime = Math.max(0, (e.clientX - rect.left) / pixelsPerSecond);
    if (onAddEmptyClip) onAddEmptyClip(track.id, clickTime);
  };

  const sharedProps = {
    allClips: fullClipList,
    tracks,
    isLocked: track.locked,
    pixelsPerSecond,
    selectedClipId,
    selectedIds,
    onSelectClip,
    onToggleSelect,
    onRangeSelect,
    onUpdateClip,
    onUpdateClips,
    onDuplicateClips,
    onAttachScriptToEntity,
    onSplitVideoAndAudio,
    snappingPoints,
    snappingEnabled,
  };

  return (
    <div
      data-track-id={track.id}
      className={`track-lane-row ${isDragOver ? 'drag-target' : ''} ${track.locked ? 'lane-locked' : ''}`}
      style={{ width: `${totalWidth}px`, height: rowHeight }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title={track.locked ? `${track.name} is locked` : "Double-click empty track space to add a clip here"}
    >
      <div className="track-grid-pattern" />

      <div
        className="timeline-lane-main"
        style={{ height: TRACK_HEIGHT }}
        onDoubleClick={handleMainLaneDoubleClick}
      >
        {clips.map((clip) => (
          <ClipItem key={clip.id} clip={clip} {...sharedProps} />
        ))}
      </div>
    </div>
  );
});

