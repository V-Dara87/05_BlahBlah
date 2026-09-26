import { useState, memo, useMemo } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { ClipItem } from './ClipItem';
import { TransitionClipItem } from './TransitionClipItem';
import { ContextMenu } from '../shared/ContextMenu';
import { hasClipboardClips } from '../../utils/clipClipboard';
import { LiveRecordingClipPreview } from './LiveRecordingClipPreview';
import { TRACK_HEIGHT, computeClipSubLanes, getTickIntervalSeconds, isTransitionClipLike } from '../../utils/timelineLayout';
import { spawnDroppedItemOnTrack } from '../../utils/timelineDrop';
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
  onDeleteClip,
  onCopySelected,
  onCutSelected,
  onPasteClips,
  onSeek,
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
 
  // Right-click on EMPTY lane space -> Paste menu. Clips stop their own
  // contextmenu event from bubbling (see ClipItem.handleContextMenu), so
  // this only fires for the bare lane / grid, never on top of a clip.
  // { x, y, time } | null — `time` is the timeline position that was
  // clicked, so "Paste" drops the clips exactly where the user pointed.
  const [laneMenu, setLaneMenu] = useState(null);
  const closeLaneMenu = () => setLaneMenu(null);
 
  const handleLaneContextMenu = (e) => {
    // A locked track can't receive new clips, and there's nothing to
    // offer on it — fall through to the browser default (no menu).
    if (track.locked) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const time = Math.max(0, (e.clientX - rect.left) / pixelsPerSecond);
    setLaneMenu({ x: e.clientX, y: e.clientY, time });
  };
 
  const handleLanePaste = () => {
    const at = laneMenu?.time;
    closeLaneMenu();
    // Paste lands at the playhead, so move the playhead to the clicked
    // spot first. Store updates are synchronous, but the paste handler
    // reads the playhead time when it runs, so defer one tick to be safe.
    if (Number.isFinite(at) && onSeek) onSeek(at);
    setTimeout(() => onPasteClips?.(), 0);
  };
 
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
    return spawnDroppedItemOnTrack({
      event: e,
      dropTime,
      targetTrackId: track.id,
      mediaAssets,
      onAddMediaAsset,
      onDropItemOnTrack,
    });
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
    // Passed through so ClipItem can tell whether its own src still
    // resolves to a real asset in the library — see isMissingSrc there.
    // Previously not threaded past this point, so a clip whose source
    // media had been deleted from the project rendered exactly like a
    // healthy one, with no visual cue that playback/export would break.
    mediaAssets,
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
    onCopySelected,
    onCutSelected,
    onPasteClips,
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
      onContextMenu={handleLaneContextMenu}
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
          // Transition clips are overlays centred on a cut, not packable clips:
          // own component, full row height, no sub-lane (see TransitionClipItem).
          if (isTransitionClipLike(clip)) {
            return (
              <TransitionClipItem
                key={clip.id}
                clip={clip}
                allClips={fullClipList}
                tracks={tracks}
                mediaAssets={mediaAssets}
                isLocked={track.locked}
                pixelsPerSecond={pixelsPerSecond}
                selectedClipId={selectedClipId}
                selectedIds={selectedIds}
                rowHeight={rowHeight}
                onSelectClip={onSelectClip}
                onToggleSelect={onToggleSelect}
                onRangeSelect={onRangeSelect}
                onUpdateClip={onUpdateClip}
                onDeleteClip={onDeleteClip}
              />
            );
          }
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
 
      {laneMenu && (
        <ContextMenu x={laneMenu.x} y={laneMenu.y} onClose={closeLaneMenu} className="clip-context-menu" minWidth={160}>
          <button
            className="ctx-menu-item ctx-menu-row"
            onClick={handleLanePaste}
            disabled={!hasClipboardClips() || !onPasteClips}
          >
            <span className="ctx-menu-label"><ClipboardPaste size={12} /> Paste</span>
            <span className="ctx-menu-hint">Ctrl+V</span>
          </button>
        </ContextMenu>
      )}
    </div>
  );
});