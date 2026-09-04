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
import { TRACK_HEIGHT } from '../../utils/timelineLayout';
 
export const TrackHeader = memo(function TrackHeader({
  track,
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
      style={{ height: TRACK_HEIGHT }}
    >
      <div className="track-header-controls" style={{ height: TRACK_HEIGHT }}>
        <div className="track-header-top-row">
          <div 
            className="track-header-title-box"
            onDoubleClick={handleStartRename}
            title="Double-click to rename track"
          >
            <Layers size={13} className="track-icon" />
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
              <Trash2 size={11} />
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
              {recording ? <Square size={11} /> : <Mic size={12} />}
            </button>
          )}

          <button
            className="track-btn add-clip-track-btn"
            style={{ padding: '0 4px', height: '20px', minWidth: '24px' }}
            title={`Add Clip to ${track.name} at Playhead (+C)`}
            onClick={() => onAddEmptyClip && onAddEmptyClip(track.id)}
            disabled={track.locked}
          >
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#38bdf8' }}>+C</span>
          </button>

          <button
            className={`track-btn ${!track.visible ? 'active-off' : ''}`}
            title={track.visible ? 'Hide Track' : 'Show Track'}
            onClick={() => onUpdateTrack(track.id, { visible: !track.visible })}
          >
            {track.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>

          <button
            className={`track-btn ${track.muted ? 'active-off' : ''}`}
            title={track.muted ? 'Unmute Track' : 'Mute Track'}
            onClick={() => onUpdateTrack(track.id, { muted: !track.muted })}
          >
            {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
          </button>

          <button
            className={`track-btn ${track.locked ? 'active-lock' : ''}`}
            title={track.locked ? 'Unlock Track' : 'Lock Track'}
            onClick={() => onUpdateTrack(track.id, { locked: !track.locked })}
          >
            {track.locked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
        </div>
      </div>
    </div>
  );
});
 