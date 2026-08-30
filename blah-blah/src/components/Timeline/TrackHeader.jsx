import { memo } from 'react';
import { 
  Volume2, 
  VolumeX, 
  Lock, 
  Unlock, 
  Eye, 
  EyeOff,
  Layers,
  Plus,
  Mic,
  Square
} from 'lucide-react';
 
export const TrackHeader = memo(function TrackHeader({
  track,
  onUpdateTrack,
  onAddEmptyClip,
  isRecordingTarget,
  isAnyTrackRecording,
  onToggleRecordTrack,
}) {
  const recording = !!isRecordingTarget;
 
  return (
    <div className={`track-header-row ${recording ? 'recording-active' : ''}`}>
      <div className="track-header-title-box">
        <Layers size={13} className="track-icon" />
        <span className="track-name">{track.name}</span>
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
          title={`Add Clip to ${track.name} at Playhead`}
          onClick={() => onAddEmptyClip && onAddEmptyClip(track.id)}
        >
          <Plus size={11} className="text-cyan" />
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
  );
});
 