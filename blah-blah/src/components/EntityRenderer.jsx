import { useRef, useEffect, useLayoutEffect, useMemo } from 'react';
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
import { updateCanvasComponent, unmountCanvasComponent, pruneCanvasComponents } from '../engine/canvasRunner';
import { RENDERER_REGISTRY } from '../engine/ecs';
import { EntityErrorBoundary } from './EntityErrorBoundary';
 
/**
 * P0 #1 — Renderer unification.
 *
 * This is the single `EntityRenderer` the roadmap calls for, replacing the
 * old `SceneViewport.jsx` (Unity-style scene view, never actually wired
 * into App.jsx) and `PreviewWindow.jsx` (the normal video-preview window
 * that was wired in). Rather than duplicate the active-entity filtering,
 * script evaluation, and video/audio sync logic across two components, all
 * of that now lives here once.
 *
 * `ReactRenderer` intentionally stays on its own dedicated-root style
 * inline JSX path rather than being folded into the CanvasRenderer
 * contract — see engine/ecs.js RENDERER_REGISTRY comment. Merging it later
 * (matching how Remotion itself keeps one big React tree instead of
 * separate roots) is a valid P2 cleanup, not required for core.
 *
 * Renderer type dispatch goes through RENDERER_REGISTRY so adding a new
 * renderer type is a registration in ecs.js, not a new branch here (P0 #2
 * CanvasRenderer is the first consumer of that indirection).
 */
// Fallback used only if a caller doesn't pass `resolution` at all (e.g. an
// older integration/test harness) -- normal app usage always has a real
// project resolution by the time this renders, since App.jsx seeds
// `resolution` state with DEFAULT_RESOLUTION before any project loads.
const FALLBACK_RESOLUTION = { width: 1920, height: 1080 };
 
export function EntityRenderer({
  entities,
  tracks,
  scripts = [],
  currentTime,
  totalDuration,
  isPlaying,
  isLooping,
  selectedEntityId,
  onSelectEntity,
  onUpdateEntity,
  onTogglePlay,
  onSeek,
  onToggleLoop,
  resolution = FALLBACK_RESOLUTION,
}) {
  const containerRef = useRef(null);
  const canvasFrameRef = useRef(null);
  const videoRefs = useRef({});
  const audioRefs = useRef({});
  const canvasContainerRefs = useRef({});
  const wasPlayingRef = useRef(isPlaying);
  const gizmoDragRef = useRef(null);
 
  // P0 perf fix -- computedEntities used to be rebuilt as a brand-new array
  // literal on every single render (regardless of whether entities, tracks,
  // scripts, or currentTime had actually changed), and that array sat in
  // the dependency list of the video/audio-sync effects below plus the
  // CanvasRenderer-driving useLayoutEffect further down. A new reference
  // every render meant React's dependency-array bail-out never actually
  // fired: dragging a gizmo, selecting a different entity, editing an
  // unrelated script, or any other EditorContext-driven re-render forced a
  // full script re-execution + canvas redraw + audio/video sync pass, even
  // when playback wasn't running and nothing relevant had changed. Wrapping
  // this in useMemo, keyed on the actual inputs that matter (entities,
  // tracks, scripts, currentTime -- not prop identity/selection state),
  // lets those effects skip their work when only unrelated UI state changes.
  const computedEntities = useMemo(() => {
    // Filter visible and active entities at currentTime.
    //
    // NOTE -- clip-duration vs. tween-duration boundary: a non-looping
    // tween (via executeScriptComponent -> MotionTweenContext.evaluate)
    // correctly clamps its own progress to 1 and settles at its final value
    // once localTime passes the tween's own duration -- that math is sound.
    // But this active-entity check only knows about the *clip's* own
    // duration (entity.startTime + entity.duration), not the tween's. If a
    // script's declared tween duration outlasts the clip (e.g. after
    // trimming the clip shorter with Split), the entity simply stops being
    // "active" and disappears from the preview before the tween ever gets
    // to settle -- it vanishes mid-animation instead of landing on its
    // final frame. This isn't a bug in the tween math or in this filter
    // individually; it's an authoring trap at the boundary between the
    // two. Extending the active window to cover the tween's duration isn't
    // correct either (a clip's duration is supposed to be an authoritative
    // boundary), so this is intentionally left as documented behavior
    // rather than "fixed" -- the right long-term fix is an authoring-time
    // warning in the Script Editor / Inspector when a script's tween
    // duration exceeds the clip's own duration, not a change here.
    const activeEntities = entities.filter((entity) => {
      if (!entity.active) return false;
      if (currentTime < entity.startTime || currentTime >= entity.startTime + entity.duration) {
        return false;
      }
      const track = tracks.find((t) => t.id === entity.trackId);
      if (track && (!track.visible || track.locked)) return false;
      return true;
    });
 
    // Calculate animated transform for each active entity using attached JS/TS motion scripts.
    // localTime is always (currentTime - entity.startTime): absolute timeline
    // time, not wall-clock/rAF accumulation, so scrubbing stays deterministic.
    return activeEntities.map((entity) => {
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
 
      const localTime = currentTime - entity.startTime;
 
      if (scriptComp) {
        const scriptDef = scripts.find((s) => s.id === scriptComp.scriptId);
        if (scriptDef && scriptDef.code) {
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
        localTime,
      };
    });
  }, [entities, tracks, scripts, currentTime]);
 
  // Separate video clips (background layer) from overlay graphics/text/react/canvas.
  // Derived from computedEntities (already memoized above), so these only
  // recompute when computedEntities itself actually changes.
  const activeVideoItems = useMemo(
    () =>
      computedEntities.filter(
        ({ entity }) => entity.type === 'video' || entity.components.some((c) => c.type === 'VideoRenderer')
      ),
    [computedEntities]
  );
 
  const activeOverlayItems = useMemo(
    () =>
      computedEntities.filter(
        ({ entity }) =>
          entity.type !== 'video' &&
          !entity.components.some((c) => c.type === 'VideoRenderer') &&
          entity.type !== 'audio' &&
          !entity.components.some((c) => c.type === 'AudioSource')
      ),
    [computedEntities]
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
          if (vidEl.paused || isStateTransition || Math.abs(vidEl.currentTime - localTime) > 0.6) {
            vidEl.currentTime = Math.max(0, localTime);
            vidEl.play().catch(() => {});
          }
        } else {
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
      const audioComp =
        entity.components.find((c) => c.type === 'AudioSource') ||
        (entity.type === 'audio' ? { src: entity.src } : null);
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
 
  // P0 #2 — Drive CanvasRenderer components every frame: mount on first
  // appearance, onUpdate with absolute-timeline localTime every tick,
  // unmount+prune when an entity leaves the active window.
  //
  // FLICKER FIX: this was a plain `useEffect`. Passive effects run
  // asynchronously *after* the browser has already painted the current
  // commit, so during playback (a rAF-driven `currentTime` state update
  // every frame) there's a real window where the browser can paint before
  // this effect's ctx.clearRect()/redraw calls run for the new time — i.e.
  // it briefly shows the *previous* frame's canvas pixels before this
  // effect catches up. That reads as flicker/glitching, and gets worse the
  // higher a CanvasRenderer script's `speed`-style prop is (more visual
  // change per frame makes the stale frame more noticeable). This is not a
  // bug in individual CanvasRenderer scripts (RandomBoxes/CanvasOrbit are
  // both pure functions of absolute `time`, exactly per the P0 #2
  // contract) — it's the renderer's effect timing.
  //
  // `useLayoutEffect` runs synchronously right after DOM mutations but
  // *before* the browser paints, so the canvas is fully redrawn for the
  // current `currentTime` before anything hits the screen — this is the
  // fix React's own docs recommend for any imperative canvas/DOM paint
  // that's driven by props/state (see https://react.dev/reference/react/useLayoutEffect).
  useLayoutEffect(() => {
    computedEntities.forEach(({ entity, localTime }) => {
      const canvasComp = entity.components.find((c) => c.type === 'CanvasRenderer');
      if (!canvasComp) return;
      const container = canvasContainerRefs.current[entity.id];
      if (!container) return;
      const scriptDef = scripts.find((s) => s.id === canvasComp.scriptId);
      if (!scriptDef || !scriptDef.code) return;
 
      updateCanvasComponent({
        entityId: entity.id,
        scriptCode: scriptDef.code,
        container,
        localTime,
        frame: Math.round(localTime * 30),
        fps: 30,
        props: canvasComp.props || {},
      });
    });
 
    pruneCanvasComponents(computedEntities.map(({ entity }) => entity.id));
  }, [computedEntities, scripts, currentTime]);
 
  // Unmount every CanvasRenderer instance when the whole EntityRenderer unmounts.
  useEffect(() => {
    return () => {
      pruneCanvasComponents([]);
    };
  }, []);
 
  // Viewport gizmo — drag-to-move / drag-to-rotate directly on the
  // selected clip in the preview, matching Unity's Scene view move/rotate
  // handles. `x`/`y`/`rotation` are stored in the Transform component in
  // the same logical-pixel space used by the render `translate(...)`
  // above (see App.css .preview-canvas-frame, up to max-width: 860px) —
  // but the frame can render smaller than that on narrow windows, so
  // screen-space drag deltas are divided by the frame's actual on-screen
  // size vs its intrinsic logical width to stay accurate at any zoom.
  const updateSelectedTransform = (entityId, updates) => {
    if (!onUpdateEntity) return;
    const entity = entities.find((e) => e.id === entityId);
    if (!entity) return;
    const hasTransform = entity.components.some((c) => c.type === 'Transform');
    const updatedComponents = hasTransform
      ? entity.components.map((c) => (c.type === 'Transform' ? { ...c, ...updates } : c))
      : [{ type: 'Transform', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, ...updates }, ...entity.components];
    onUpdateEntity(entityId, { components: updatedComponents });
  };
 
  const handleMoveGizmoPointerDown = (e, entity, transform) => {
    if (!onUpdateEntity) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectEntity(entity.id);
 
    const frameEl = canvasFrameRef.current;
    const frameRect = frameEl ? frameEl.getBoundingClientRect() : null;
    // Screen px -> logical px ratio: the frame's rendered width vs the
    // logical coordinate space (its own clientWidth, since x/y positions
    // are defined relative to this element regardless of CSS scaling).
    const scale = frameRect && frameEl.clientWidth ? frameRect.width / frameEl.clientWidth : 1;
 
    gizmoDragRef.current = {
      mode: 'move',
      entityId: entity.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: transform.x,
      startY: transform.y,
      scale,
    };
 
    const handlePointerMove = (moveEvent) => {
      const drag = gizmoDragRef.current;
      if (!drag || drag.mode !== 'move') return;
      const dx = (moveEvent.clientX - drag.startClientX) / (drag.scale || 1);
      const dy = (moveEvent.clientY - drag.startClientY) / (drag.scale || 1);
      updateSelectedTransform(drag.entityId, { x: drag.startX + dx, y: drag.startY + dy });
    };
    const handlePointerUp = () => {
      gizmoDragRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };
 
  const handleRotateGizmoPointerDown = (e, entity, transform) => {
    if (!onUpdateEntity) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectEntity(entity.id);
 
    const frameEl = canvasFrameRef.current;
    if (!frameEl) return;
    const frameRect = frameEl.getBoundingClientRect();
    // Rotation pivot is the entity's own center on screen: frame origin
    // (top-left) + frame center + the entity's current logical x/y scaled
    // to screen px (mirrors the translate(-50%, -50%) + x/y used to render it).
    const scale = frameEl.clientWidth ? frameRect.width / frameEl.clientWidth : 1;
    const pivotX = frameRect.left + frameRect.width / 2 + transform.x * scale;
    const pivotY = frameRect.top + frameRect.height / 2 + transform.y * scale;
 
    const startAngle = Math.atan2(e.clientY - pivotY, e.clientX - pivotX) * (180 / Math.PI);
 
    gizmoDragRef.current = {
      mode: 'rotate',
      entityId: entity.id,
      pivotX,
      pivotY,
      startAngle,
      startRotation: transform.rotation || 0,
    };
 
    const handlePointerMove = (moveEvent) => {
      const drag = gizmoDragRef.current;
      if (!drag || drag.mode !== 'rotate') return;
      const angle = Math.atan2(moveEvent.clientY - drag.pivotY, moveEvent.clientX - drag.pivotX) * (180 / Math.PI);
      let nextRotation = drag.startRotation + (angle - drag.startAngle);
      // Shift snaps to 15-degree increments, same modifier convention as
      // most design tools (Figma, Unity's rotate gizmo with Shift held).
      if (moveEvent.shiftKey) nextRotation = Math.round(nextRotation / 15) * 15;
      updateSelectedTransform(drag.entityId, { rotation: nextRotation });
    };
    const handlePointerUp = () => {
      gizmoDragRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };
 
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };
 
  // Guard against a malformed/zero resolution (e.g. a hand-edited
  // project.json with resolution.width: 0) producing an invalid CSS
  // `aspect-ratio` value, which would collapse the whole frame to nothing.
  const safeResWidth = resolution?.width > 0 ? resolution.width : FALLBACK_RESOLUTION.width;
  const safeResHeight = resolution?.height > 0 ? resolution.height : FALLBACK_RESOLUTION.height;
 
  return (
    <section className="preview-panel" ref={containerRef}>
      {/* Viewport Screen Frame */}
      <div
        className="preview-viewport-box"
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelectEntity(null);
        }}
      >
        {/* aspectRatio is set inline (not via a CSS class/variable) because
            it's per-project data, not a design-time constant -- the CSS
            fallback in App.css (.preview-canvas-frame { aspect-ratio: 16/9 })
            only applies before this first renders with a real resolution. */}
        <div
          className="preview-canvas-frame"
          ref={canvasFrameRef}
          style={{ aspectRatio: `${safeResWidth} / ${safeResHeight}` }}
        >
          {/* Resolution badge -- confirms at a glance that the preview is
              actually locked to the project's resolution, not just a fixed
              16:9 default. */}
          <div className="preview-resolution-badge">
            {safeResWidth}×{safeResHeight}
          </div>
 
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
                <EntityErrorBoundary entityName={entity.name} resetKey={vidSrc}>
                  <video
                    ref={(el) => {
                      if (el) {
                        videoRefs.current[entity.id] = el;
                        if (!isPlaying) {
                          const localTime =
                            (currentTime - entity.startTime) * (videoComp.speed || 1) + (videoComp.mediaOffset || 0);
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
                      const localTime =
                        (currentTime - entity.startTime) * (videoComp.speed || 1) + (videoComp.mediaOffset || 0);
                      e.target.currentTime = Math.max(0, localTime);
                      if (isPlaying) e.target.play().catch(() => {});
                    }}
                  />
                </EntityErrorBoundary>
              </div>
            );
          })}
 
          {/* 2. Foreground Overlay GameObjects (React Clips, Text, Shapes, Canvas, Prefabs) */}
          {activeOverlayItems.map(({ entity, transform }) => {
            const isSelected = entity.id === selectedEntityId;
            const textComp = entity.components.find((c) => c.type === 'TextRenderer');
            const shapeComp = entity.components.find((c) => c.type === 'ShapeRenderer');
            const reactComp = entity.components.find((c) => c.type === 'ReactRenderer');
            const canvasComp = entity.components.find((c) => c.type === 'CanvasRenderer');
 
            // Dynamic React Component rendering. ReactRenderer stays a
            // dedicated inline-JSX path, separate from the CanvasRenderer
            // contract below (see file header comment).
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
                className={`preview-render-layer ${isSelected ? 'selected' : ''} ${onUpdateEntity ? 'gizmo-draggable' : ''}`}
                style={{
                  transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px)) rotate(${transform.rotation}deg) scale(${transform.scaleX}, ${transform.scaleY})`,
                  opacity: transform.opacity,
                  zIndex: isSelected ? 30 : 15,
                  willChange: 'transform, opacity',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEntity(entity.id);
                }}
                onPointerDown={(e) => {
                  // Only the currently-selected entity is draggable directly;
                  // a first click just selects (matches onClick above) and a
                  // second press-drag on an already-selected clip moves it —
                  // avoids fighting with the plain-click-to-select gesture.
                  if (isSelected && onUpdateEntity) {
                    handleMoveGizmoPointerDown(e, entity, transform);
                  }
                }}
              >
                <EntityErrorBoundary entityName={entity.name} resetKey={reactComp?.scriptId || canvasComp?.scriptId}>
                  {/* React Component Renderer */}
                  {ReactComponentNode}
 
                  {/* P0 #2 — CanvasRenderer mount target. The actual drawing
                      happens imperatively inside engine/canvasRunner.js via
                      onMount/onUpdate against this <div>; React only owns
                      the container element and its position. */}
                  {canvasComp && (
                    <div
                      className="canvas-render-container"
                      ref={(el) => {
                        if (el) {
                          canvasContainerRefs.current[entity.id] = el;
                        } else {
                          delete canvasContainerRefs.current[entity.id];
                          unmountCanvasComponent(entity.id);
                        }
                      }}
                    />
                  )}
 
                  {/* Shape Component */}
                  {shapeComp && (
                    <div
                      className="rendered-shape-node"
                      style={{
                        width: `${shapeComp.width || 180}px`,
                        height: `${shapeComp.height || 180}px`,
                        backgroundColor: shapeComp.color || '#ffffff',
                        borderColor: shapeComp.strokeColor || '#38bdf8',
                        borderWidth: `${shapeComp.strokeWidth || 0}px`,
                        borderStyle: shapeComp.strokeWidth ? 'solid' : 'none',
                        // Roundness — `?? 0` (not `||`) so an explicit 0 is
                        // respected instead of silently falling back to a
                        // default radius. Previously `shapeComp.borderRadius
                        // ? ... : '12px'` meant a shape could never actually
                        // render with sharp corners: 0 is falsy in JS, so it
                        // always fell through to the 12px default regardless
                        // of what the Inspector's Roundness field was set to.
                        borderRadius:
                          shapeComp.shapeType === 'circle'
                            ? '50%'
                            : `${shapeComp.borderRadius ?? 0}px`,
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
                </EntityErrorBoundary>
 
                {/* Rotate handle — small circle above the clip, drag to
                    rotate around the clip's own center. Only shown on the
                    selected clip so unselected clips stay uncluttered. */}
                {isSelected && onUpdateEntity && (
                  <>
                    <div className="gizmo-rotate-stem" />
                    <div
                      className="gizmo-rotate-handle"
                      title="Drag to rotate (hold Shift to snap to 15°)"
                      onPointerDown={(e) => handleRotateGizmoPointerDown(e, entity, transform)}
                    />
                  </>
                )}
              </div>
            );
          })}
 
          {computedEntities.length === 0 && (
            <div className="preview-empty-screen">
              <Layers size={42} className="text-dim" />
              <p className="empty-text">Playhead at {formatSimpleTime(currentTime)}</p>
              <span className="empty-sub">
                No active clips at current time. Press Play (Space) or scrub the timeline below.
              </span>
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
 
// Referenced for documentation/registry-driven dispatch clarity; not used
// directly in this file's JSX branches yet since DOM renderer types are
// still hand-rendered above (P0 #3 unifies their Inspector fields, not
// their preview markup, which stays type-specific by design here).
void RENDERER_REGISTRY;