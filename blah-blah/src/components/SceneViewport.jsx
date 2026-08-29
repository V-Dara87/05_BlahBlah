import { useState, useRef, useEffect } from 'react';
import { 
  Layers, 
  Move, 
  RotateCw, 
  Maximize2, 
  Volume2, 
  VolumeX
} from 'lucide-react';
import { executeCSharpMonoBehaviour } from '../engine/csharpRunner';

export function SceneViewport({
  entities,
  tracks,
  scripts,
  currentTime,
  isPlaying,
  selectedEntityId,
  onSelectEntity,
  onUpdateEntityTransform,
}) {
  const [activeTab, setActiveTab] = useState('Game');
  const [aspectRatio, setAspectRatio] = useState('16/9');
  const [isMuted, setIsMuted] = useState(false);
  const [activeGizmoTool, setActiveGizmoTool] = useState('translate'); // 'translate' | 'scale' | 'rotate'

  const containerRef = useRef(null);
  const videoRefs = useRef({});
  const audioRefs = useRef({});

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

  // Calculate animated transform for each active entity using attached C# MonoBehaviour scripts / BlahTween
  const computedEntities = activeEntities.map((entity) => {
    let currentTransform = entity.components.find((c) => c.type === 'Transform') || {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    };

    const scriptComp = entity.components.find((c) => c.type === 'MonoBehaviour' && c.enabled);
    if (scriptComp) {
      const scriptDef = scripts.find((s) => s.id === scriptComp.scriptId);
      if (scriptDef && scriptDef.code) {
        const localTime = currentTime - entity.startTime;
        currentTransform = executeCSharpMonoBehaviour({
          scriptCode: scriptDef.code,
          transform: currentTransform,
          localTime,
          clipDuration: entity.duration,
          publicValues: scriptComp.props || {},
        });
      }
    }

    return {
      entity,
      transform: currentTransform,
      renderer: entity.components.find((c) =>
        ['VideoRenderer', 'TextRenderer', 'ShapeRenderer', 'AudioSource'].includes(c.type)
      ),
    };
  });

  // Sync Video Elements
  useEffect(() => {
    computedEntities.forEach(({ entity, renderer }) => {
      if (renderer && renderer.type === 'VideoRenderer' && renderer.src) {
        let vid = videoRefs.current[entity.id];
        if (!vid) {
          vid = document.createElement('video');
          vid.src = renderer.src;
          vid.playsInline = true;
          vid.muted = isMuted;
          videoRefs.current[entity.id] = vid;
        }

        const localTime = (currentTime - entity.startTime) * (renderer.speed || 1) + (renderer.mediaOffset || 0);
        if (Math.abs(vid.currentTime - localTime) > 0.15) {
          vid.currentTime = Math.max(0, localTime);
        }

        vid.volume = isMuted ? 0 : (renderer.volume ?? 1);

        if (isPlaying) {
          if (vid.paused) vid.play().catch(() => {});
        } else {
          if (!vid.paused) vid.pause();
        }
      }
    });

    // Clean up inactive videos
    Object.keys(videoRefs.current).forEach((id) => {
      if (!computedEntities.some(({ entity }) => entity.id === id)) {
        videoRefs.current[id].pause();
      }
    });
  }, [currentTime, isPlaying, computedEntities, isMuted]);

  // Sync Audio Elements
  useEffect(() => {
    computedEntities.forEach(({ entity, renderer }) => {
      if (renderer && renderer.type === 'AudioSource' && renderer.src) {
        let aud = audioRefs.current[entity.id];
        if (!aud) {
          aud = new Audio(renderer.src);
          audioRefs.current[entity.id] = aud;
        }

        const localTime = (currentTime - entity.startTime) * (renderer.speed || 1) + (renderer.mediaOffset || 0);
        if (Math.abs(aud.currentTime - localTime) > 0.2) {
          aud.currentTime = Math.max(0, localTime);
        }

        aud.volume = isMuted ? 0 : (renderer.volume ?? 1);

        if (isPlaying) {
          if (aud.paused) aud.play().catch(() => {});
        } else {
          if (!aud.paused) aud.pause();
        }
      }
    });

    // Clean up inactive audios
    Object.keys(audioRefs.current).forEach((id) => {
      if (!computedEntities.some(({ entity }) => entity.id === id)) {
        audioRefs.current[id].pause();
      }
    });
  }, [currentTime, isPlaying, computedEntities, isMuted]);

  // Interactive Transform Gizmo Handlers
  const handleGizmoTranslateDown = (e, entityId, initialTransform) => {
    e.stopPropagation();
    onSelectEntity(entityId);

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = initialTransform.x || 0;
    const origY = initialTransform.y || 0;

    const handlePointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      onUpdateEntityTransform(entityId, {
        x: Math.round(origX + dx),
        y: Math.round(origY + dy),
      });
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleGizmoScaleDown = (e, entityId, initialTransform) => {
    e.stopPropagation();
    onSelectEntity(entityId);

    const startX = e.clientX;
    const origScaleX = initialTransform.scaleX ?? 1;
    const origScaleY = initialTransform.scaleY ?? 1;

    const handlePointerMove = (moveEvent) => {
      const delta = (moveEvent.clientX - startX) * 0.01;
      const newScaleX = Math.max(0.1, parseFloat((origScaleX + delta).toFixed(2)));
      const newScaleY = Math.max(0.1, parseFloat((origScaleY + delta).toFixed(2)));
      onUpdateEntityTransform(entityId, {
        scaleX: newScaleX,
        scaleY: newScaleY,
      });
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleGizmoRotateDown = (e, entityId, initialTransform) => {
    e.stopPropagation();
    onSelectEntity(entityId);

    const startX = e.clientX;
    const origRot = initialTransform.rotation || 0;

    const handlePointerMove = (moveEvent) => {
      const deltaDeg = (moveEvent.clientX - startX) * 0.5;
      onUpdateEntityTransform(entityId, {
        rotation: Math.round(origRot + deltaDeg),
      });
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const selectedComputed = computedEntities.find((c) => c.entity.id === selectedEntityId);

  return (
    <section className="unity-viewport-panel" ref={containerRef}>
      {/* Unity Viewport Tabs & Toolbars */}
      <div className="unity-viewport-toolbar">
        <div className="unity-tab-group">
          <button
            className={`unity-viewport-tab ${activeTab === 'Scene' ? 'active' : ''}`}
            onClick={() => setActiveTab('Scene')}
          >
            Scene
          </button>
          <button
            className={`unity-viewport-tab ${activeTab === 'Game' ? 'active' : ''}`}
            onClick={() => setActiveTab('Game')}
          >
            Game
          </button>
        </div>

        {/* Gizmo Mode Switcher */}
        <div className="unity-gizmo-switcher">
          <button
            className={`unity-gizmo-tool-btn ${activeGizmoTool === 'translate' ? 'active' : ''}`}
            title="Translate Tool (W)"
            onClick={() => setActiveGizmoTool('translate')}
          >
            <Move size={13} />
          </button>
          <button
            className={`unity-gizmo-tool-btn ${activeGizmoTool === 'rotate' ? 'active' : ''}`}
            title="Rotate Tool (E)"
            onClick={() => setActiveGizmoTool('rotate')}
          >
            <RotateCw size={13} />
          </button>
          <button
            className={`unity-gizmo-tool-btn ${activeGizmoTool === 'scale' ? 'active' : ''}`}
            title="Scale Tool (R)"
            onClick={() => setActiveGizmoTool('scale')}
          >
            <Maximize2 size={13} />
          </button>
        </div>

        {/* Aspect Ratio & Volume */}
        <div className="unity-viewport-options">
          <select
            className="unity-select-sm"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            title="Aspect Ratio"
          >
            <option value="16/9">16:9 (1920×1080)</option>
            <option value="9/16">9:16 (1080×1920)</option>
            <option value="1/1">1:1 (1080×1080)</option>
            <option value="4/3">4:3 (Classic)</option>
          </select>

          <button
            className="unity-tool-btn-sm"
            onClick={() => setIsMuted(!isMuted)}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        </div>
      </div>

      {/* Main Canvas Viewport Area */}
      <div 
        className="unity-screen-stage"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onSelectEntity(null);
          }
        }}
      >
        <div
          className="unity-screen-frame"
          style={{ aspectRatio }}
        >
          {/* Render all computed active entities */}
          {computedEntities.map(({ entity, transform }) => {
            const isSelected = entity.id === selectedEntityId;
            const textComp = entity.components.find((c) => c.type === 'TextRenderer');
            const shapeComp = entity.components.find((c) => c.type === 'ShapeRenderer');
            const videoComp = entity.components.find((c) => c.type === 'VideoRenderer');

            return (
              <div
                key={entity.id}
                className={`gameobject-render-layer ${isSelected ? 'selected' : ''}`}
                style={{
                  transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scaleX}, ${transform.scaleY})`,
                  opacity: transform.opacity,
                  zIndex: isSelected ? 30 : 10,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEntity(entity.id);
                }}
              >
                {/* Text Component Rendering */}
                {textComp && (
                  <div
                    className="rendered-text-element"
                    style={{
                      fontSize: `${textComp.fontSize || 32}px`,
                      color: textComp.fontColor || '#ffffff',
                      fontFamily: textComp.fontFamily || 'Inter',
                      textShadow: textComp.shadowColor
                        ? `0 0 ${textComp.shadowBlur || 10}px ${textComp.shadowColor}`
                        : '0 2px 8px rgba(0,0,0,0.8)',
                    }}
                  >
                    {textComp.text || entity.name}
                  </div>
                )}

                {/* Shape Component Rendering */}
                {shapeComp && (
                  <div
                    className="rendered-shape-element"
                    style={{
                      width: `${shapeComp.width || 120}px`,
                      height: `${shapeComp.height || 120}px`,
                      backgroundColor: shapeComp.color || '#4f46e5',
                      borderColor: shapeComp.strokeColor || '#38bdf8',
                      borderWidth: `${shapeComp.strokeWidth || 0}px`,
                      borderStyle: shapeComp.strokeWidth ? 'solid' : 'none',
                      borderRadius:
                        shapeComp.shapeType === 'circle'
                          ? '50%'
                          : shapeComp.borderRadius
                          ? `${shapeComp.borderRadius}px`
                          : '8px',
                    }}
                  />
                )}

                {/* Video Component Rendering */}
                {videoComp && videoComp.src && (
                  <video
                    className="rendered-video-element"
                    src={videoComp.src}
                    playsInline
                    muted={isMuted}
                    autoPlay={isPlaying}
                  />
                )}
              </div>
            );
          })}

          {/* Interactive Transform Gizmo on Selected Entity */}
          {selectedComputed && (
            <div
              className="unity-transform-gizmo"
              style={{
                transform: `translate(${selectedComputed.transform.x}px, ${selectedComputed.transform.y}px) rotate(${selectedComputed.transform.rotation}deg)`,
              }}
            >
              {/* Translate Center Handle */}
              <div
                className="gizmo-handle-center"
                title="Drag to Translate (Position)"
                onPointerDown={(e) =>
                  handleGizmoTranslateDown(e, selectedComputed.entity.id, selectedComputed.transform)
                }
              >
                <div className="gizmo-center-pin" />
              </div>

              {/* Rotation Handle Pin */}
              <div
                className="gizmo-handle-rotate"
                title="Drag to Rotate"
                onPointerDown={(e) =>
                  handleGizmoRotateDown(e, selectedComputed.entity.id, selectedComputed.transform)
                }
              >
                <div className="gizmo-rotate-ball" />
              </div>

              {/* Scale Corner Handle */}
              <div
                className="gizmo-handle-scale"
                title="Drag to Scale"
                onPointerDown={(e) =>
                  handleGizmoScaleDown(e, selectedComputed.entity.id, selectedComputed.transform)
                }
              />
            </div>
          )}

          {computedEntities.length === 0 && (
            <div className="unity-empty-scene">
              <Layers size={36} className="empty-scene-icon" />
              <p>Empty Frame at Playhead</p>
              <span>Add a Prefab from the Project Browser below or press Play!</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
