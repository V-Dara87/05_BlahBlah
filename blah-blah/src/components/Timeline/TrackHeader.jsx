import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { 
  Volume2, 
  VolumeX, 
  Lock, 
  Unlock, 
  Eye, 
  EyeOff,
  Layers,
  Mic,
  Square,
  Trash2,
  Scissors,
  ArrowLeftToLine,
  ChevronsLeft,
} from 'lucide-react';
import { TRACK_HEIGHT, clampTrackHeight } from '../../utils/timelineLayout';
import { usePlaybackStore } from '../../hooks/PlaybackContext';
import { ContextMenu } from '../shared/ContextMenu';
import {
  buildTrackGapRemovalUpdates,
  buildTrackBringToFrontUpdates,
} from '../../utils/removeGaps';
import './track-header.css';
 
export const TrackHeader = memo(function TrackHeader({
  track,
  rowHeight,
  onUpdateTrack,
  onDeleteTrack,
  canDeleteTrack = false,
  onAddEmptyClip,
  isRecordingTarget,
  recordingStartTime = 0,
  isAnyTrackRecording,
  onToggleRecordTrack,
  onOpenSilenceRemoverForTrack,
  allClips = [],
  onUpdateClips,
}) {
  const recording = !!isRecordingTarget;
  const store = usePlaybackStore();
  const recordingTimerRef = useRef(null);
 
  useEffect(() => {
    if (!recording) return;
    const update = (time) => {
      if (!recordingTimerRef.current) return;
      const elapsed = Math.max(0, time - recordingStartTime);
      const m = Math.floor(elapsed / 60);
      const s = Math.floor(elapsed % 60);
      const tenths = Math.floor((elapsed % 1) * 10);
      recordingTimerRef.current.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
    };
    update(store.getCurrentTime());
    return store.registerFrameCallback(update);
  }, [recording, recordingStartTime, store]);
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(track.name);
  const [prevName, setPrevName] = useState(track.name);
  if (track.name !== prevName) {
    setPrevName(track.name);
    setTempName(track.name);
  }
  const inputRef = useRef(null);
  const effectiveHeight = rowHeight ?? clampTrackHeight(track.height || TRACK_HEIGHT);
 
  // Drag-to-resize — grabbing the handle at the bottom edge of the header
  // adjusts this track's own height (persisted as track.height, same
  // pattern as mute/lock/visible via onUpdateTrack). handleUpdateTrack
  // already coalesces every call (see useProjectStore.js), so a whole drag
  // gesture collapses into one undo step automatically, same as dragging a
  // DragNumber field.
  const resizeDragRef = useRef(null);
  const [isResizing, setIsResizing] = useState(false);
 
  const handleResizePointerDown = (e) => {
    e.stopPropagation();
    e.preventDefault();
    resizeDragRef.current = {
      startClientY: e.clientY,
      startHeight: effectiveHeight,
    };
    setIsResizing(true);
    // Pin the handle to this pointer for the whole gesture — once the
    // drag has started, movement no longer depends on which element
    // happens to be under the cursor, so a collapsed (min-height) track
    // whose neighbors sit close by can't steal the drag mid-move.
    e.currentTarget.setPointerCapture?.(e.pointerId);
 
    const handlePointerMove = (moveEvent) => {
      const drag = resizeDragRef.current;
      if (!drag) return;
      const dy = moveEvent.clientY - drag.startClientY;
      const nextHeight = clampTrackHeight(drag.startHeight + dy);
      onUpdateTrack(track.id, { height: nextHeight });
    };
    const handlePointerUp = () => {
      resizeDragRef.current = null;
      setIsResizing(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };
 
  const handleResizeDoubleClick = (e) => {
    // Double-click the handle to reset back to the default height, same
    // "double-click to reset" convention as most DAW/NLE track headers.
    e.stopPropagation();
    onUpdateTrack(track.id, { height: TRACK_HEIGHT });
  };
 
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);
 
  const handleStartRename = (e) => {
    e.stopPropagation();
    setIsEditing(true);
    setTempName(track.name);
  };
 
  const handleFinishRename = () => {
    setIsEditing(false);
    const trimmed = tempName.trim();
    if (trimmed && trimmed !== track.name) {
      onUpdateTrack(track.id, { name: trimmed });
    } else {
      setTempName(track.name);
    }
  };
 
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleFinishRename();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setTempName(track.name);
    }
  };
 
  // ── Right-click menu: track-level clip arrangement ───────────────
  // Both actions work on EVERY clip in this track, no selection needed:
  //  - Remove Gaps:  pack the track's clips back to back (first one stays).
  //  - Bring to Front: slide the track left so its first clip is at 00:00
  //    (spacing between clips is kept).
  // The menu always opens on a header right-click; an action that can't run
  // is greyed out and says why, instead of the menu silently not appearing.
  const [menu, setMenu] = useState(null); // { x, y } | null
  const closeMenu = () => setMenu(null);
 
  const gapUpdates = useMemo(
    () => (onUpdateClips ? buildTrackGapRemovalUpdates(allClips, track.id) : []),
    [allClips, track.id, onUpdateClips]
  );
  const frontUpdates = useMemo(
    () => (onUpdateClips ? buildTrackBringToFrontUpdates(allClips, track.id) : []),
    [allClips, track.id, onUpdateClips]
  );
 
  const unavailableReason = (updates, emptyReason) => {
    if (!onUpdateClips) return 'Unavailable';
    if (track.locked) return 'Track locked';
    return updates.length === 0 ? emptyReason : null;
  };
  const gapUnavailableReason = unavailableReason(gapUpdates, 'No gaps');
  const frontUnavailableReason = unavailableReason(frontUpdates, 'At 00:00');
 
  const handleContextMenu = (e) => {
    // Let the rename <input> keep its native text menu.
    if (e.target.closest?.('.track-name-input')) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const runUpdates = (updates, reason) => {
    closeMenu();
    if (!reason) onUpdateClips(updates);
  };
 
  return (
    <>
    <div
      className={`track-header-row ${recording ? 'recording-active' : ''} ${track.locked ? 'track-locked' : ''}`}
      style={{ height: effectiveHeight }}
      onContextMenu={handleContextMenu}
    >
      <div className="track-header-controls" style={{ height: effectiveHeight }}>
        <div className="track-header-top-row">
          <div 
            className="track-header-title-box"
            onDoubleClick={handleStartRename}
            title="Double-click to rename track"
          >
            <Layers size={11} className="track-icon" />
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                className="track-name-input"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                onBlur={handleFinishRename}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="track-name" title={track.name}>{track.name}</span>
            )}
          </div>
 
          {canDeleteTrack && onDeleteTrack && (
            <button
              className="track-btn delete-track-btn"
              title={`Delete ${track.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteTrack(track.id);
              }}
            >
              <Trash2 size={9} />
            </button>
          )}
        </div>
 
        <div className="track-header-btns">
          {onToggleRecordTrack && (
            <button
              className={`track-btn record-track-btn ${recording ? 'active-record' : ''}`}
              title={recording ? 'Stop Recording' : `Record Audio into ${track.name}`}
              onClick={() => onToggleRecordTrack(track.id)}
              disabled={!recording && isAnyTrackRecording}
            >
              {recording ? <Square size={9} /> : <Mic size={10} />}
            </button>
          )}
 
          {recording && (
            <span className="track-header-rec-badge" title="Recording in progress">
              <span className="rec-pulse-dot" />
              <span ref={recordingTimerRef}>00:00.0</span>
            </span>
          )}
 
          <button
            className="track-btn add-clip-track-btn"
            style={{ padding: '0 3px', height: '17px', minWidth: '19px' }}
            title={`Add Clip to ${track.name} at Playhead (+C)`}
            onClick={() => onAddEmptyClip && onAddEmptyClip(track.id)}
            disabled={track.locked}
          >
            <span style={{ fontSize: '8px', fontWeight: 700, color: '#38bdf8' }}>+C</span>
          </button>
 
          {onOpenSilenceRemoverForTrack && (
            <button
              className="track-btn cut-silence-track-btn"
              title={`Cut Silence in ${track.name}...`}
              onClick={() => onOpenSilenceRemoverForTrack(track.id)}
              disabled={track.locked}
            >
              <Scissors size={10} />
            </button>
          )}
 
          <button
            className={`track-btn ${!track.visible ? 'active-off' : ''}`}
            title={track.visible ? 'Hide Track' : 'Show Track'}
            onClick={() => onUpdateTrack(track.id, { visible: !track.visible })}
          >
            {track.visible ? <Eye size={10} /> : <EyeOff size={10} />}
          </button>
 
          <button
            className={`track-btn ${track.muted ? 'active-off' : ''}`}
            title={track.muted ? 'Unmute Track' : 'Mute Track'}
            onClick={() => onUpdateTrack(track.id, { muted: !track.muted })}
          >
            {track.muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
          </button>
 
          <button
            className={`track-btn ${track.locked ? 'active-lock' : ''}`}
            title={track.locked ? 'Unlock Track' : 'Lock Track'}
            onClick={() => onUpdateTrack(track.id, { locked: !track.locked })}
          >
            {track.locked ? <Lock size={10} /> : <Unlock size={10} />}
          </button>
        </div>
      </div>
 
      {/* Resize handle — drag to change this track's row height (persisted
          as track.height). Sits over the bottom edge of the header/lane
          row, matching Premiere/Resolve's per-track resize convention.
          Double-click resets back to the default TRACK_HEIGHT. */}
      <div
        className={`track-resize-handle ${isResizing ? 'is-dragging' : ''}`}
        onPointerDown={handleResizePointerDown}
        onDoubleClick={handleResizeDoubleClick}
        title="Drag to resize track (double-click to reset)"
      />
    </div>
 
    {menu && (
      <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu} className="clip-context-menu" minWidth={200}>
        <button
          className="ctx-menu-item ctx-menu-row"
          onClick={() => runUpdates(gapUpdates, gapUnavailableReason)}
          disabled={!!gapUnavailableReason}
          title={gapUnavailableReason
            ? `Remove Gaps: ${gapUnavailableReason}`
            : `Close the empty space between every clip in ${track.name}`}
        >
          <span className="ctx-menu-label"><ArrowLeftToLine size={12} /> Remove Gaps</span>
          {gapUnavailableReason && <span className="ctx-menu-hint">{gapUnavailableReason}</span>}
        </button>
        <button
          className="ctx-menu-item ctx-menu-row"
          onClick={() => runUpdates(frontUpdates, frontUnavailableReason)}
          disabled={!!frontUnavailableReason}
          title={frontUnavailableReason
            ? `Bring to Front: ${frontUnavailableReason}`
            : `Move ${track.name} so its first clip starts at 00:00`}
        >
          <span className="ctx-menu-label"><ChevronsLeft size={12} /> Bring to Front (00:00)</span>
          {frontUnavailableReason && <span className="ctx-menu-hint">{frontUnavailableReason}</span>}
        </button>
      </ContextMenu>
    )}
    </>
  );
});
 
 