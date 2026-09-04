import { useState, memo } from 'react';
import { ClipItem } from './ClipItem';
import { TRACK_HEIGHT, SUB_LANE_HEIGHT } from './Timeline';
import { importMediaFiles } from '../../services/mediaImport';

/**
 * TrackLane — the time-area half of one timeline track row.
 *
 * NESTED SUB-TRACK MODEL: below the main lane (root clips) every CHILD clip
 * of every root renders as its own sub-lane row — the equivalent of \"more
 * tracks inside this root track\". A parent clip with several children shows
 * one lane per child (depth-first, mirroring Timeline.jsx's layout math and
 * the TrackHeader sub-lane labels), so each child has its own track strip.
 *
 * Each sub-lane row is itself a drop target / double-click target:
 *   - dropping a media/prefab/script (in-app or OS file) onto a sub-lane row
 *     spawns it as a CHILD of that lane's clip (clamped into its window);
 *   - double-clicking empty space in a sub-lane row adds an empty child clip
 *     under that lane's clip (\"add another nested track\").
 * Drops/double-clicks on the main lane keep their root-track behavior.
 */
export const TrackLane = memo(function TrackLane({
  track,
  tracks = [],
  clips,
  allClips,
  laneNodes = [],
  subLaneRows = [],
  parentBoxes = [],
  subTracksExpanded = true,
  rowHeight,
  pixelsPerSecond,
  selectedClipId,
  selectedIds,
  onSelectClip,
  onToggleSelect,
  onRangeSelect,
  onUpdateClip,
  onUpdateClips,
  onDuplicateClips,
  onReparentEntity,
  onAttachScriptToEntity,
  onAddEmptyClip,
  onAddChildClip,
  onReorderChild,
  onDropItemOnTrack,
  onAddMediaAsset,
  snappingPoints,
  snappingEnabled,
  totalWidth,
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fullClipList = allClips || clips;

  // Shared spawn path for HTML5 drops (root lane OR a specific sub-lane row):
  // OS video/audio files are imported on the fly (itemData carries the fresh
  // asset — the media list state may not have flushed yet, so the store falls
  // back to the object when the id lookup misses); in-app payloads carry
  // { itemType, itemData } JSON. `parentEntityId` spawns the content as a
  // child of that clip instead of a root track clip.
  const spawnFromDrop = (e, parentEntityId = null) => {
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
          onAddMediaAsset: (asset, file) => {
            onAddMediaAsset(asset, file);
            onDropItemOnTrack({
              itemType: 'media',
              itemId: asset.id,
              itemData: asset,
              targetTrackId: track.id,
              startTime: dropTime,
              parentEntityId,
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
          parentEntityId,
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

  // Root-track drop (main lane empty space / collapsed track background).
  const handleDrop = (e) => {
    if (track.locked) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    spawnFromDrop(e, null);
  };

  // ── Sub-lane row handlers — the lane of one child clip ──────────────────
  const handleSubLaneDragOver = (e) => {
    if (track.locked) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleSubLaneDrop = (e, clip) => {
    if (track.locked) return;
    e.preventDefault();
    e.stopPropagation();
    spawnFromDrop(e, clip.id);
  };

  const handleSubLaneDoubleClick = (e, clip) => {
    if (track.locked) return;
    if (e.target.closest('.timeline-clip-card')) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const clickTime = Math.max(0, (e.clientX - rect.left) / pixelsPerSecond);
    if (onAddChildClip) onAddChildClip(clip, { startTime: clickTime });
  };

  // Main lane double-click → new ROOT clip on this track at the click time.
  const handleMainLaneDoubleClick = (e) => {
    if (track.locked) return;
    if (e.target.closest('.timeline-clip-card')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickTime = Math.max(0, (e.clientX - rect.left) / pixelsPerSecond);
    if (onAddEmptyClip) onAddEmptyClip(track.id, clickTime);
  };

  // Shared props passed to every ClipItem in this lane (roots + sub-lanes).
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
    onReparentEntity,
    onAttachScriptToEntity,
    snappingPoints,
    snappingEnabled,
    onAddChildClip,
    onReorderChild,
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
      {/* Boxes around each expanded parent's child lanes — the visual group
          that shows "this sub clip lives under this clip" even inside the
          same root track. The box spans the parent's time window, so a
          child sticking out beyond it is visibly outside (see the
          out-of-parent-window styling on ClipItem). */}
      {subTracksExpanded &&
        parentBoxes.map((box) => (
          <div
            key={box.parentClip.id}
            className="timeline-parent-box"
            style={{
              left: `${box.parentClip.startTime * pixelsPerSecond}px`,
              width: `${Math.max(16, box.parentClip.duration * pixelsPerSecond)}px`,
              top: `${box.top}px`,
              height: `${box.height}px`,
            }}
          >
            <span className="timeline-parent-box-label" title={box.parentClip.name}>
              {box.parentClip.name}
            </span>
          </div>
        ))}
      <div
        className="timeline-lane-main"
        style={{ height: TRACK_HEIGHT }}
        onDoubleClick={handleMainLaneDoubleClick}
      >
        {laneNodes.map((node) => (
          <ClipItem key={node.clip.id} clip={node.clip} {...sharedProps} />
        ))}
      </div>
      {/* Child clips — one lane row per clip (nested sub-tracks). */}
      {subTracksExpanded &&
        subLaneRows.map((row) => (
          <div
            key={row.clip.id}
            className="timeline-sub-lane-row"
            data-sub-lane-of={row.clip.id}
            style={{ height: SUB_LANE_HEIGHT }}
            onDragOver={handleSubLaneDragOver}
            onDrop={(e) => handleSubLaneDrop(e, row.clip)}
            onDoubleClick={(e) => handleSubLaneDoubleClick(e, row.clip)}
          >
            <ClipItem key={row.clip.id} clip={row.clip} compact {...sharedProps} />
          </div>
        ))}
    </div>
  );
});
