import { useRef, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  ChevronLeft, 
  ChevronRight, 
  Repeat, 
  Maximize,
  Layers
} from 'lucide-react';
import { formatSimpleTime } from '../utils/timeFormat';
import { executeScriptComponent, getCompiledReactComponent } from '../engine/scriptRunner';

export function PreviewWindow({
  entities,
  tracks,
  scripts = [],
  currentTime,
  totalDuration,
  isPlaying,
  isLooping,
  selectedEntityId,
  onSelectEntity,
  onTogglePlay,
  onSeek,
  onToggleLoop,
}) {
  const containerRef = useRef(null);
  const videoRefs = useRef({});
  const audioRefs = useRef({});
  const wasPlayingRef = useRef(isPlaying);

  // Filter visible and active entities at currentTime
  const activeEntities = entities.filter((entity) => {
    if (!entity.active) return false;
    if (currentTime < entity.startTime || currentTime >= entity.startTime + entity.duration) {
      return false;
    }
    const track = tracks.find((t) => t.id === entity.trackId);
    if (track && (!track.visible || track.locked)) return false;
    return true;
  });

  // Calculate animated transform for each active entity using attached JS/TS motion scripts
  const computedEntities = activeEntities.map((entity) => {
    let currentTransform = entity.components.find((c) => c.type === 'Transform') || {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    };

    const scriptComp = entity.components.find(
      (c) => (c.type === 'ScriptComponent' || c.type === 'MonoBehaviour') && c.enabled
    );

    if (scriptComp) {
      const scriptDef = scripts.find((s) => s.id === scriptComp.scriptId);
      if (scriptDef && scriptDef.code) {
        const localTime = currentTime - entity.startTime;
        currentTransform = executeScriptComponent({
          scriptCode: scriptDef.code,
          transform: currentTransform,
          localTime,
          clipDuration: entity.duration,
          publicValues: scriptComp.props || {},
          frame: Math.round(localTime * 30),
          fps: 30,
        });
      }
    }

    return {
      entity,
      transform: currentTransform,
    };
  });

  // Separate video clips and overlay graphics/text/react
  const activeVideoItems = computedEntities.filter(
    ({ entity }) => entity.type === 'video' || entity.components.some((c) => c.type === 'VideoRenderer')
  );

  const activeOverlayItems = computedEntities.filter(
    ({ entity }) => entity.type !== 'video' && !entity.components.some((c) => c.type === 'VideoRenderer') && entity.type !== 'audio' && !entity.components.some((c) => c.type === 'AudioSource')
  );

  // Synchronize active Video playback & seeking smoothly
  useEffect(() => {
    const isStateTransition = wasPlayingRef.current !== isPlaying;
    wasPlayingRef.current = isPlaying;

    activeVideoItems.forEach(({ entity }) => {
      const videoComp = entity.components.find((c) => c.type === 'VideoRenderer') || { src: entity.src };
      const vidSrc = videoComp.src || entity.src;
      if (!vidSrc) return;

      const vidEl = videoRefs.current[entity.id];
      if (vidEl) {
        const speed = videoComp.speed || 1;
        const offset = videoComp.mediaOffset || 0;
        const localTime = (currentTime - entity.startTime) * speed + offset;
        
        vidEl.volume = videoComp.volume ?? 1;

        if (isPlaying) {
          // If starting play or heavily drifted, sync once and let hardware play
          if (vidEl.paused || isStateTransition || Math.abs(vidEl.currentTime - localTime) > 0.6) {
            vidEl.currentTime = Math.max(0, localTime);
            vidEl.play().catch(() => {});
          }
        } else {
          // Paused / Scrubbing: immediate smooth seek
          if (!vidEl.paused) vidEl.pause();
          if (Math.abs(vidEl.currentTime - localTime) > 0.05) {
            vidEl.currentTime = Math.max(0, localTime);
          }
        }
      }
    });

    // Pause any removed videos
    Object.keys(videoRefs.current).forEach((id) => {
      if (!activeVideoItems.some(({ entity }) => entity.id === id)) {
        const el = videoRefs.current[id];
        if (el && !el.paused) el.pause();
      }
    });
  }, [currentTime, isPlaying, activeVideoItems]);

  // Synchronize Audio smoothly
  useEffect(() => {
    computedEntities.forEach(({ entity }) => {
      const audioComp = entity.components.find((c) => c.type === 'AudioSource') || (entity.type === 'audio' ? { src: entity.src } : null);
      if (audioComp && audioComp.src) {
        let aud = audioRefs.current[entity.id];
        if (!aud) {
          aud = new Audio(audioComp.src);
          audioRefs.current[entity.id] = aud;
        }

        const speed = audioComp.speed || 1;
        const offset = audioComp.mediaOffset || 0;
        const localTime = (currentTime - entity.startTime) * speed + offset;
        aud.volume = audioComp.volume ?? 1;

        if (isPlaying) {
          if (aud.paused || Math.abs(aud.currentTime - localTime) > 0.6) {
            aud.currentTime = Math.max(0, localTime);
            aud.play().catch(() => {});
          }
        } else {
          if (!aud.paused) aud.pause();
          if (Math.abs(aud.currentTime - localTime) > 0.05) {
            aud.currentTime = Math.max(0, localTime);
          }
        }
      }
    });

    Object.keys(audioRefs.current).forEach((id) => {
      if (!computedEntities.some(({ entity }) => entity.id === id)) {
        const aud = audioRefs.current[id];
        if (aud && !aud.paused) aud.pause();
      }
    });
  }, [currentTime, isPlaying, computedEntities]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <section className="preview-panel" ref={containerRef}>
      {/* Viewport Screen Frame */}
      <div 
        className="preview-viewport-box"
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelectEntity(null);
        }}
      >
        <div className="preview-canvas-frame">
          
          {/* 1. Background Video Layer */}
          {activeVideoItems.map(({ entity, transform }) => {
            const isSelected = entity.id === selectedEntityId;
            const videoComp = entity.components.find((c) => c.type === 'VideoRenderer') || { src: entity.src };
            const vidSrc = videoComp.src || entity.src;

            return (
              <div
                key={entity.id}
                className={`video-layer-container ${isSelected ? 'selected' : ''}`}
                style={{
                  transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scaleX}, ${transform.scaleY})`,
                  opacity: transform.opacity,
                  zIndex: 5,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEntity(entity.id);
                }}
              >
                <video
                  ref={(el) => {
                    if (el) {
                      videoRefs.current[entity.id] = el;
                      if (!isPlaying) {
                        const localTime = (currentTime - entity.startTime) * (videoComp.speed || 1) + (videoComp.mediaOffset || 0);
                        if (Math.abs(el.currentTime - localTime) > 0.05) {
                          el.currentTime = Math.max(0, localTime);
                        }
                      }
                    }
                  }}
                  className="active-video-element"
                  src={vidSrc}
                  playsInline
                  onLoadedMetadata={(e) => {
                    const localTime = (currentTime - entity.startTime) * (videoComp.speed || 1) + (videoComp.mediaOffset || 0);
                    e.target.currentTime = Math.max(0, localTime);
                    if (isPlaying) e.target.play().catch(() => {});
                  }}
                />
              </div>
            );
          })}

          {/* 2. Foreground Overlay GameObjects (React Clips, Text, Shapes, Prefabs) */}
          {activeOverlayItems.map(({ entity, transform }) => {
            const isSelected = entity.id === selectedEntityId;
            const textComp = entity.components.find((c) => c.type === 'TextRenderer');
            const shapeComp = entity.components.find((c) => c.type === 'ShapeRenderer');
            const reactComp = entity.components.find((c) => c.type === 'ReactRenderer');

            // Dynamic React Component rendering
            let ReactComponentNode = null;
            if (reactComp) {
              const scriptDef = scripts.find((s) => s.id === reactComp.scriptId);
              if (scriptDef && scriptDef.code) {
                const CompiledComponent = getCompiledReactComponent(scriptDef.code);
                if (CompiledComponent) {
                  const localTime = currentTime - entity.startTime;
                  ReactComponentNode = (
                    <CompiledComponent
                      {...(reactComp.props || {})}
                      frame={Math.round(localTime * 30)}
                      time={localTime}
                      duration={entity.duration}
                    />
                  );
                }
              }
            }

            return (
              <div
                key={entity.id}
                className={`preview-render-layer ${isSelected ? 'selected' : ''}`}
                style={{
                  transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px)) rotate(${transform.rotation}deg) scale(${transform.scaleX}, ${transform.scaleY})`,
                  opacity: transform.opacity,
                  zIndex: isSelected ? 30 : 15,
                  willChange: 'transform, opacity'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEntity(entity.id);
                }}
              >
                {/* React Component Renderer */}
                {ReactComponentNode}

                {/* Shape Component */}
                {shapeComp && (
                  <div
                    className="rendered-shape-node"
                    style={{
                      width: `${shapeComp.width || 180}px`,
                      height: `${shapeComp.height || 180}px`,
                      backgroundColor: shapeComp.color || '#4f46e5',
                      borderColor: shapeComp.strokeColor || '#38bdf8',
                      borderWidth: `${shapeComp.strokeWidth || 0}px`,
                      borderStyle: shapeComp.strokeWidth ? 'solid' : 'none',
                      borderRadius:
                        shapeComp.shapeType === 'circle'
                          ? '50%'
                          : shapeComp.borderRadius
                          ? `${shapeComp.borderRadius}px`
                          : '12px',
                    }}
                  />
                )}

                {/* Text Component */}
                {textComp && (
                  <div
                    className="rendered-text-node"
                    style={{
                      fontSize: `${textComp.fontSize || 38}px`,
                      color: textComp.fontColor || '#ffffff',
                      fontFamily: textComp.fontFamily || 'Inter',
                      textShadow: textComp.shadowColor
                        ? `0 0 ${textComp.shadowBlur || 14}px ${textComp.shadowColor}`
                        : '0 3px 12px rgba(0,0,0,0.9)',
                    }}
                  >
                    {textComp.text || entity.name}
                  </div>
                )}
              </div>
            );
          })}

          {computedEntities.length === 0 && (
            <div className="preview-empty-screen">
              <Layers size={42} className="text-dim" />
              <p className="empty-text">Playhead at {formatSimpleTime(currentTime)}</p>
              <span className="empty-sub">No active clips at current time. Press Play (Space) or scrub the timeline below.</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Transport Bar */}
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
          <button className="ctrl-icon-btn" title="Fullscreen" onClick={toggleFullscreen}>
            <Maximize size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
