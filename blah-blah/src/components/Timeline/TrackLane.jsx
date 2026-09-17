import { useState, memo, useMemo } from 'react';
import { ClipItem } from './ClipItem';
import { LiveRecordingClipPreview } from './LiveRecordingClipPreview';
import { TRACK_HEIGHT, computeClipSubLanes, getTickIntervalSeconds } from '../../utils/timelineLayout';
import { importMediaFiles, detectMediaKind } from '../../services/mediaImport';
import './track-lane.css';
 
/**
 * TrackLane — the time-area half of one timeline track row.
 * Each TrackLane is a full, standard track lane:
 *   - Multiple clips comfortably coexist here.
 *   - Left-click empty space seeks the playhead there (handled by the
 *     parent Timeline's lane pointer-down, not here) — this lane no
 *     longer creates or deletes clips via mouse clicks; use the "+C"
 *     button on the track header, or drag media in, to add clips.
 */
export const TrackLane = memo(function TrackLane({
  track,
  tracks = [],
  mediaAssets = [],
  clips = [],
  allClips = [],
  rowHeight = TRACK_HEIGHT,
  pixelsPerSecond,
  isRecordingTarget = false,
  recordingStartTime = 0,
  recordingLevel = 0,
  selectedClipId,
  selectedIds,
  onSelectClip,
  onToggleSelect,
  onRangeSelect,
  onUpdateClip,
  onUpdateClips,
  onDuplicateClips,
  onAttachScriptToEntity,
  onDropItemOnTrack,
  onAddMediaAsset,
  onSplitVideoAndAudio,
  onOpenSilenceRemover,
  silencePreviewData = null,
  snappingPoints,
  snappingEnabled,
  totalWidth,
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fullClipList = allClips.length > 0 ? allClips : clips;
 
  // DaVinci-style compression: clips that overlap in time on this track
  // split the row height evenly between them (sub-lanes) instead of
  // drawing on top of one another. A clip with nothing overlapping it
  // gets laneCount 1 and fills the whole row, same as before.
  const subLanes = useMemo(() => computeClipSubLanes(clips), [clips]);
 
  // Background grid spacing follows the same zoom-dependent interval as
  // the ruler's major ticks above it (see getTickIntervalSeconds), so
  // the lines running through the track lane always line up with the
  // ruler instead of staying a fixed 40px regardless of zoom.
  const gridSpacingPx = getTickIntervalSeconds(pixelsPerSecond) * pixelsPerSecond;
 
  const spawnFromDrop = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dropTime = Math.max(0, (e.clientX - rect.left) / pixelsPerSecond);
 
    const files = e.dataTransfer?.files;
    if (files && files.length > 0 && onAddMediaAsset && onDropItemOnTrack) {
      // FIXED — same MIME-only filter bug as mediaImport.js: some
      // platforms (Tauri drag&drop especially) report an empty file.type
      // for formats like .wav, which silently dropped them here before
      // importMediaFiles ever got a chance to run its own (now also
      // extension-aware) check. detectMediaKind falls back to the file
      // extension when the MIME type is missing/unrecognized.
      const fileList = Array.from(files).filter((f) => detectMediaKind(f) !== null);
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
 
  const sharedProps = {
    allClips: fullClipList,
    tracks,
    isLocked: track.locked,
    pixelsPerSecond,
    selectedClipId,
    selectedIds,
    rowHeight,
    onSelectClip,
    onToggleSelect,
    onRangeSelect,
    onUpdateClip,
    onUpdateClips,
    onDuplicateClips,
    onAttachScriptToEntity,
    onSplitVideoAndAudio,
    onOpenSilenceRemover,
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
      title={track.locked ? `${track.name} is locked` : undefined}
    >
      <div className="track-grid-pattern" style={{ backgroundSize: `${gridSpacingPx}px 100%` }} />
 
      {/* Divider between this track and the one below it — plain
          straight line at the row's bottom edge, same color as the
          vertical grid lines. */}
      <div className="track-divider-line" style={{ width: totalWidth }} />
 
      <div
        className="timeline-lane-main"
        style={{ height: rowHeight }}
      >
        {clips.map((clip) => {
          const lane = subLanes.get(clip.id) || { laneIndex: 0, laneCount: 1 };
          let clipSilenceCuts = null;
          let clipSilenceAdjustHandler = null;
          if (silencePreviewData && silencePreviewData.cuts?.length > 0) {
            if (silencePreviewData.targetType === 'clip') {
              if (
                clip.id === silencePreviewData.targetId ||
                clip.parentId === silencePreviewData.targetId ||
                (fullClipList.find((c) => c.id === silencePreviewData.targetId)?.parentId === clip.id)
              ) {
                clipSilenceCuts = silencePreviewData.cuts;
                clipSilenceAdjustHandler = silencePreviewData.onAdjustCutEdge || null;
              }
            } else if (silencePreviewData.targetType === 'track') {
              if (clip.trackId === silencePreviewData.targetId) {
                clipSilenceCuts = silencePreviewData.cuts;
                clipSilenceAdjustHandler = silencePreviewData.onAdjustCutEdge || null;
              }
            }
          }
 
          return (
            <ClipItem
              key={clip.id}
              clip={clip}
              laneIndex={lane.laneIndex}
              laneCount={lane.laneCount}
              silencePreviewCuts={clipSilenceCuts}
              onAdjustSilenceCutEdge={clipSilenceAdjustHandler}
              {...sharedProps}
            />
          );
        })}
 
        {isRecordingTarget && (
          <LiveRecordingClipPreview
            startTime={recordingStartTime}
            pixelsPerSecond={pixelsPerSecond}
            rowHeight={rowHeight}
            level={recordingLevel}
          />
        )}
      </div>
    </div>
  );
});