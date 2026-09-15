import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Maximize,
  Crop,
  Expand,
} from 'lucide-react';
import { formatSimpleTime } from '../../utils/timeFormat';
 
/**
 * Bottom playback transport bar — play/pause, step, loop, timecode, the
 * Normal/Extended preview-mode toggle, and fullscreen. Pulled out of
 * EntityRenderer.jsx's JSX return, where this was the trailing
 * `.preview-transport-bar` block.
 *
 * Purely props/callbacks — no state or refs of its own — so this is a
 * plain presentational component, unlike VideoLayer/OverlayLayer which
 * still needed to receive several computed values from EntityRenderer.
 */
export function PlaybackTransportBar({
  currentTime,
  totalDuration,
  isPlaying,
  isLooping,
  onTogglePlay,
  onSeek,
  onToggleLoop,
  previewMode,
  setPreviewMode,
  toggleFullscreen,
}) {
  return (
    <div className="preview-transport-bar">
      <div className="transport-btns">
        <button className="ctrl-icon-btn" title="Jump to Start (0s)" onClick={() => onSeek(0)}>
          <SkipBack size={15} />
        </button>
        <button className="ctrl-icon-btn" title="Step Back 1s" onClick={() => onSeek(currentTime - 1)}>
          <ChevronLeft size={15} />
        </button>
        <button
          className={`play-btn-circle ${isPlaying ? 'playing' : ''}`}
          title="Play / Pause (Space)"
          onClick={onTogglePlay}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-px" />}
        </button>
        <button className="ctrl-icon-btn" title="Step Forward 1s" onClick={() => onSeek(currentTime + 1)}>
          <ChevronRight size={15} />
        </button>
        <button className="ctrl-icon-btn" title="Jump to End" onClick={() => onSeek(totalDuration)}>
          <SkipForward size={15} />
        </button>
        <button
          className={`ctrl-icon-btn ${isLooping ? 'active' : ''}`}
          title="Toggle Loop"
          onClick={onToggleLoop}
        >
          <Repeat size={14} />
        </button>
      </div>
 
      <div className="transport-timecode">
        <span className="current-time">{formatSimpleTime(currentTime)}</span>
        <span className="dur-time">/ {formatSimpleTime(totalDuration)}</span>
      </div>
 
      <div className="transport-options">
        <button
          className={`ctrl-icon-btn ${previewMode === 'extended' ? 'active' : ''}`}
          title={
            previewMode === 'extended'
              ? 'Extended Preview: content outside the frame stays visible. Scroll to zoom, hold Right-mouse to pan. Click for Normal (clips to frame).'
              : 'Normal Preview: clips to frame, like export. Click for Extended (shows content outside the frame, with pan/zoom).'
          }
          onClick={() => setPreviewMode((m) => (m === 'extended' ? 'normal' : 'extended'))}
        >
          {previewMode === 'extended' ? <Expand size={15} /> : <Crop size={15} />}
        </button>
        <button className="ctrl-icon-btn" title="Fullscreen" onClick={toggleFullscreen}>
          <Maximize size={15} />
        </button>
      </div>
    </div>
  );
}