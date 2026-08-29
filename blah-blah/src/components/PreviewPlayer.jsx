import { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  ChevronLeft, 
  ChevronRight, 
  Repeat, 
  Volume2, 
  VolumeX, 
  Maximize, 
  Film
} from 'lucide-react';
import { formatTimecode, formatSimpleTime } from '../utils/timeFormat';

export function PreviewPlayer({
  tracks,
  clips,
  currentTime,
  totalDuration,
  isPlaying,
  playbackRate,
  isLooping,
  onTogglePlay,
  onSeek,
  onSetPlaybackRate,
  onSetLooping,
}) {
  const [aspectRatio, setAspectRatio] = useState('16/9');
  const [masterVolume, setMasterVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const videoRef = useRef(null);
  const audioElementsRef = useRef({});
  const previewContainerRef = useRef(null);

  // Find active video clips sorted by track priority (V2 above V1)
  const videoTracks = tracks.filter(t => t.type === 'video' && t.visible);
  const sortedVideoTrackIds = videoTracks.map(t => t.id).reverse(); // top tracks first

  // Active video clip at current playhead time
  let activeVideoClip = null;
  for (const trackId of sortedVideoTrackIds) {
    const clip = clips.find(c => 
      c.trackId === trackId && 
      c.type === 'video' && 
      currentTime >= c.startTime && 
      currentTime < (c.startTime + c.duration)
    );
    if (clip) {
      activeVideoClip = clip;
      break;
    }
  }

  // Active text overlays at current playhead time
  const activeTextClips = clips.filter(c => 
    c.type === 'text' && 
    currentTime >= c.startTime && 
    currentTime < (c.startTime + c.duration)
  );

  // Find all active audio sources (both audio track clips and video track clip audios)
  const activeAudioClips = clips.filter(c => {
    if (currentTime < c.startTime || currentTime >= c.startTime + c.duration) return false;
    const track = tracks.find(t => t.id === c.trackId);
    if (!track || track.muted) return false;
    return c.type === 'audio' || (c.type === 'video' && !activeVideoClip);
  });

  // Sync main Video Player
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!activeVideoClip) {
      if (!video.paused) video.pause();
      return;
    }

    const targetMediaTime = ((currentTime - activeVideoClip.startTime) * (activeVideoClip.speed || 1)) + (activeVideoClip.mediaOffset || 0);

    // If source changed, update source
    if (video.src !== activeVideoClip.src && activeVideoClip.src) {
      video.src = activeVideoClip.src;
    }

    // Check drift and sync time
    if (Math.abs(video.currentTime - targetMediaTime) > 0.15) {
      video.currentTime = Math.max(0, targetMediaTime);
    }

    // Set playback rate & volume
    video.playbackRate = (activeVideoClip.speed || 1) * playbackRate;
    const track = tracks.find(t => t.id === activeVideoClip.trackId);
    const trackVol = track ? track.volume : 1;
    video.volume = isMuted ? 0 : masterVolume * (activeVideoClip.volume ?? 1) * trackVol;

    // Play/Pause sync
    if (isPlaying) {
      if (video.paused) {
        video.play().catch(() => {});
      }
    } else {
      if (!video.paused) {
        video.pause();
      }
    }
  }, [currentTime, isPlaying, activeVideoClip, playbackRate, masterVolume, isMuted, tracks]);

  // Sync secondary audio elements (Audio tracks)
  useEffect(() => {
    const audioPool = audioElementsRef.current;

    // Update active audios
    activeAudioClips.forEach(clip => {
      let audio = audioPool[clip.id];
      if (!audio) {
        audio = new Audio(clip.src);
        audioPool[clip.id] = audio;
      }

      const targetMediaTime = ((currentTime - clip.startTime) * (clip.speed || 1)) + (clip.mediaOffset || 0);
      if (Math.abs(audio.currentTime - targetMediaTime) > 0.2) {
        audio.currentTime = Math.max(0, targetMediaTime);
      }

      const track = tracks.find(t => t.id === clip.trackId);
      const trackVol = track ? track.volume : 1;
      audio.playbackRate = (clip.speed || 1) * playbackRate;
      audio.volume = isMuted ? 0 : masterVolume * (clip.volume ?? 1) * trackVol;

      if (isPlaying) {
        if (audio.paused) {
          audio.play().catch(() => {});
        }
      } else {
        if (!audio.paused) {
          audio.pause();
        }
      }
    });

    // Pause any audios that are no longer active
    Object.keys(audioPool).forEach(id => {
      const isStillActive = activeAudioClips.some(c => c.id === id);
      if (!isStillActive) {
        audioPool[id].pause();
      }
    });
  }, [currentTime, isPlaying, activeAudioClips, playbackRate, masterVolume, isMuted, tracks]);

  const toggleFullscreen = () => {
    if (!previewContainerRef.current) return;
    if (!document.fullscreenElement) {
      previewContainerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const stepSeconds = (seconds) => {
    onSeek(currentTime + seconds);
  };

  return (
    <section className="preview-player-panel" ref={previewContainerRef}>
      {/* Viewport Screen */}
      <div className="preview-viewport-wrapper">
        <div 
          className="preview-viewport" 
          style={{ aspectRatio }}
        >
          {activeVideoClip ? (
            <video
              ref={videoRef}
              className="preview-video-element"
              playsInline
              muted={isMuted}
            />
          ) : (
            <div className="empty-preview-screen">
              <Film size={40} className="empty-screen-icon" />
              <p>No video at playhead</p>
              <span>{formatTimecode(currentTime)}</span>
            </div>
          )}

          {/* Text Overlays rendering */}
          {activeTextClips.map((textClip) => (
            <div
              key={textClip.id}
              className={`text-overlay-layer ${textClip.textStyle || 'title'}`}
              style={{
                fontSize: `${textClip.fontSize || 32}px`,
                color: textClip.fontColor || '#ffffff',
                backgroundColor: textClip.bgColor || 'transparent',
              }}
            >
              <span>{textClip.text || textClip.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Control Transport Bar */}
      <div className="preview-controls-bar">
        <div className="playback-buttons-group">
          <button
            className="ctrl-btn"
            title="Jump to Start (Home)"
            onClick={() => onSeek(0)}
          >
            <SkipBack size={16} />
          </button>

          <button
            className="ctrl-btn"
            title="Step 1 Second Back (Shift + ←)"
            onClick={() => stepSeconds(-1)}
          >
            <ChevronLeft size={16} />
          </button>

          <button
            className={`play-main-btn ${isPlaying ? 'playing' : ''}`}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            onClick={onTogglePlay}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
          </button>

          <button
            className="ctrl-btn"
            title="Step 1 Second Forward (Shift + →)"
            onClick={() => stepSeconds(1)}
          >
            <ChevronRight size={16} />
          </button>

          <button
            className="ctrl-btn"
            title="Jump to End (End)"
            onClick={() => onSeek(totalDuration)}
          >
            <SkipForward size={16} />
          </button>

          <button
            className={`ctrl-btn ${isLooping ? 'active' : ''}`}
            title="Loop Playback"
            onClick={() => onSetLooping(!isLooping)}
          >
            <Repeat size={16} />
          </button>
        </div>

        {/* Center Timecode Readout */}
        <div className="preview-time-readout">
          <span className="live-clock">{formatSimpleTime(currentTime)}</span>
          <span className="duration-clock">/ {formatSimpleTime(totalDuration)}</span>
        </div>

        {/* Right Player Options */}
        <div className="player-options-group">
          {/* Aspect Ratio selector */}
          <select
            className="player-select"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            title="Preview Aspect Ratio"
          >
            <option value="16/9">16:9 (Landscape)</option>
            <option value="9/16">9:16 (Reels/TikTok)</option>
            <option value="1/1">1:1 (Square)</option>
            <option value="4/3">4:3 (Classic)</option>
          </select>

          {/* Speed Selector */}
          <select
            className="player-select"
            value={playbackRate}
            onChange={(e) => onSetPlaybackRate(parseFloat(e.target.value))}
            title="Playback Speed"
          >
            <option value="0.5">0.5x</option>
            <option value="1">1.0x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2.0x</option>
          </select>

          {/* Volume Control */}
          <div className="volume-control-wrapper">
            <button
              className="ctrl-btn"
              onClick={() => setIsMuted(!isMuted)}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || masterVolume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : masterVolume}
              onChange={(e) => {
                setMasterVolume(parseFloat(e.target.value));
                if (isMuted) setIsMuted(false);
              }}
              className="volume-slider"
              title={`Master Volume: ${Math.round(masterVolume * 100)}%`}
            />
          </div>

          <button
            className="ctrl-btn"
            title="Toggle Fullscreen"
            onClick={toggleFullscreen}
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
