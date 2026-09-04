import { useState, useRef, useEffect, memo } from 'react';
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
  Square,
  Trash2,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { TRACK_HEIGHT, SUB_LANE_HEIGHT } from './Timeline';
 
export const TrackHeader = memo(function TrackHeader({
  track,
  onUpdateTrack,
  onDeleteTrack,
  canDeleteTrack = false,
  onAddEmptyClip,
  onAddChildClip,
  onReorderChild,
  isRecordingTarget,
  isAnyTrackRecording,
  onToggleRecordTrack,
  hasChildTracks = false,
  subTracksExpanded = true,
  onToggleSubTracks,
  // Depth-first { clip, depth } rows for every child clip of this track's
  // roots — rendered as mini track headers under the root controls, aligned
  // 1:1 with the sub-lane rows in the lanes area (see Timeline.jsx layout).
  subLaneRows = [],
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
    <div className={`track-header-row ${recording ? 'recording-active' : ''} ${track.locked ? 'track-locked' : ''}`}>
      {/* Root track controls (fixed TRACK_HEIGHT tall — child sub-lane
          labels stack below, aligned to their lanes). */}
      <div className="track-header-controls" style={{ height: TRACK_HEIGHT }}>
        <div className="track-header-top-row">
          {hasChildTracks && onToggleSubTracks && (
            <button
              className={`track-btn sub-track-toggle-btn ${subTracksExpanded ? 'active-sub-open' : ''}`}
              title={subTracksExpanded ? 'Collapse child sub-tracks' : 'Expand child sub-tracks (children stay active while collapsed)'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSubTracks();
              }}
            >
              {subTracksExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          )}

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
            title={`Add Clip to ${track.name} at Playhead`}
            onClick={() => onAddEmptyClip && onAddEmptyClip(track.id)}
            disabled={track.locked}
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

      {/* Sub-lane headers — every child clip of this track's roots gets a
          mini track header row aligned to its lane: name + an "add child"
          chip so the hierarchy can keep nesting (more tracks inside a track). */}
      {subTracksExpanded &&
        subLaneRows.map((row) => {
          // Sibling index within this parent's box — for the ↑/↓ reorder
          // buttons ("rearrange the nested sub-tracks").
          const siblings = subLaneRows.filter((r) => r.parentClip.id === row.parentClip.id);
          const idx = siblings.findIndex((r) => r.clip.id === row.clip.id);
          return (
            <div
              key={row.clip.id}
              className="sub-lane-header"
              style={{ height: SUB_LANE_HEIGHT, paddingLeft: 6 + Math.min(row.depth, 8) * 14 }}
              title={track.locked ? 'Track is locked' : `Sub-track: ${row.clip.name}`}
            >
              <span className="sub-lane-name" title={row.clip.name}>{row.clip.name}</span>
              <span className="sub-lane-actions">
                {!track.locked && onReorderChild && (
                  <>
                    <button
                      className="track-btn sub-lane-reorder-btn"
                      title={`Move ${row.clip.name} up`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReorderChild(row.parentClip.id, row.clip.id, idx - 1);
                      }}
                    >
                      <ArrowUp size={9} />
                    </button>
                    <button
                      className="track-btn sub-lane-reorder-btn"
                      title={`Move ${row.clip.name} down`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReorderChild(row.parentClip.id, row.clip.id, idx + 1);
                      }}
                    >
                      <ArrowDown size={9} />
                    </button>
                  </>
                )}
                {!track.locked && onAddChildClip && (
                  <button
                    className="track-btn sub-lane-add-btn"
                    title={`Add a child clip under ${row.clip.name} (nested sub-track)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddChildClip(row.clip);
                    }}
                  >
                    <Plus size={9} />
                  </button>
                )}
              </span>
            </div>
          );
        })}
    </div>
  );
});
 