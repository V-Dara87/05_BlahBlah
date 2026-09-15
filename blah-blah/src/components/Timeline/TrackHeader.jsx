import { useState, useRef, useEffect, memo } from 'react';
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
  Trash2
} from 'lucide-react';
import { TRACK_HEIGHT, clampTrackHeight } from '../../utils/timelineLayout';
import './track-header.css';
 
export const TrackHeader = memo(function TrackHeader({
  track,
  rowHeight,
  onUpdateTrack,
  onDeleteTrack,
  canDeleteTrack = false,
  onAddEmptyClip,
  isRecordingTarget,
  isAnyTrackRecording,
  onToggleRecordTrack,
}) {
  const recording = !!isRecordingTarget;
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
 
  return (
    <div
      className={`track-header-row ${recording ? 'recording-active' : ''} ${track.locked ? 'track-locked' : ''}`}
      style={{ height: effectiveHeight }}
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
 
          <button
            className="track-btn add-clip-track-btn"
            style={{ padding: '0 3px', height: '17px', minWidth: '19px' }}
            title={`Add Clip to ${track.name} at Playhead (+C)`}
            onClick={() => onAddEmptyClip && onAddEmptyClip(track.id)}
            disabled={track.locked}
          >
            <span style={{ fontSize: '8px', fontWeight: 700, color: '#38bdf8' }}>+C</span>
          </button>
 
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
  );
});
 
 