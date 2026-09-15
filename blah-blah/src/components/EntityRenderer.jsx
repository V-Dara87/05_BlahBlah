 
 
 
import { useRef, useEffect, useLayoutEffect, useMemo, useState, Fragment } from 'react';
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
  Expand
} from 'lucide-react';
import { formatSimpleTime } from '../utils/timeFormat';
import { getCompiledReactComponent, detectScriptKind, extractScriptProps } from '../engine/scriptRunner';
import { resolveScriptProps } from '../engine/referenceTypes';
import { resolveTextRendererText, cssFontFamily, DEFAULT_TEXT_FONT_SIZE, DEFAULT_TEXT_FONT_COLOR, DEFAULT_TEXT_FONT_FAMILY, DEFAULT_TEXT_FONT_WEIGHT } from '../engine/textRenderer';
import { updateCanvasComponent, pruneCanvasComponents } from '../engine/canvasRunner';
import { isScriptComponent, isVideoEntity, isAudioEntity } from '../engine/ecs';
import { computeActiveEntitiesAtTime } from '../engine/renderPipeline';
import { getSharedGLTransitionRenderer } from '../engine/glTransitions';
import {
  setMediaElementVolume,
  setMediaElementRate,
  resumeAudioContext,
  disconnectMediaGainChain,
} from '../utils/mediaAudio';
import { EntityErrorBoundary } from './EntityErrorBoundary';
import { usePreviewViewport } from '../hooks/usePreviewViewport';
import { useGizmoDrag } from '../hooks/useGizmoDrag';
 
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
 * Script-driven visuals are ONE component type (`ScriptComponent`); each
 * attached script renders according to its detected kind (see
 * detectScriptKind in engine/scriptRunner.js): 'react' → an inline React
 * element, 'canvas' → a container <div> driven imperatively by
 * engine/canvasRunner.js, 'motion' → handled by renderPipeline.js's
 * computeActiveEntitiesAtTime (transform math only, no DOM).
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
  // Project framerate — the same value export's frame loop passes to
  // computeActiveEntitiesAtTime, so motion-script `frame`/`fps` args match
  // between preview and export. App.jsx's projectState carries fps: 30.
  fps = 30,
  // All media assets — used to resolve 'asset'-type reference props in scripts.
  mediaAssets = [],
  // Auto Key — same toggle the Inspector's Transform card reads (see
  // App.jsx's autoKeyEnabled state). When on, dragging the gizmo on a
  // field with no keyframes yet still creates one at the playhead
  // instead of writing a static value. Off by default, matching the
  // Inspector's own default.
  autoKeyEnabled = false,
}) {
  const containerRef = useRef(null);
  const videoRefs = useRef({});
  const audioRefs = useRef({});
  const canvasContainerRefs = useRef({});
  const wasPlayingRef = useRef(isPlaying);
  const gizmoDragRef = useRef(null);
 
  // Preview frame measurement + extended-mode pan/zoom.
  // See hooks/usePreviewViewport.js.
  const {
    viewportBoxRef,
    canvasFrameRef,
    frameDimensions,
    frameScale,
    previewMode,
    setPreviewMode,
    viewTransform,
    viewTransformRef,
    isPanning,
  } = usePreviewViewport({ resolution });
 
  // Real `import` support: scripts with import statements are compiled
  // ASYNC by the bundler (engine/scriptBundler.js) and fill a module-level
  // cache; React never sees that cache change, so listen for the
  // "scripts-recompiled" broadcast and re-run the memo when it fires —
  // otherwise a freshly-bundled script would stay stuck in its "pending"
  // (untransformed) state until some unrelated re-render happened to land.
  const [scriptsRecompiledTick, setScriptsRecompiledTick] = useState(0);
  useEffect(() => {
    const handler = () => setScriptsRecompiledTick((t) => t + 1);
    window.addEventListener('blahblah:scripts-recompiled', handler);
    return () => window.removeEventListener('blahblah:scripts-recompiled', handler);
  }, []);
 
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
  // Active-entity computation is shared with export — ONE implementation
  // (engine/renderPipeline.js) instead of the two hand-duplicated copies
  // that used to drift (this memo previously hardcoded fps: 30 while
  // export took a real fps parameter). This useMemo stays local because
  // memoization is a React-specific concern; the logic inside is the
  // shared pure function.
  const computedEntities = useMemo(() => {
    return computeActiveEntitiesAtTime({ entities, tracks, scripts, time: currentTime, fps, allAssets: mediaAssets });
    // NOTE -- clip-duration vs. tween-duration boundary: a non-looping
    // tween correctly clamps to 1 and settles once localTime passes the
    // tween's own duration, but the active-entity check only knows about
    // the clip's duration (see renderPipeline.js). If a script's declared
    // tween duration outlasts the clip, the entity vanishes mid-animation
    // instead of landing on its final frame — documented authoring trap,
    // intentionally not "fixed" here.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scriptsRecompiledTick intentionally re-runs the memo when the module-level compile cache warms (the bundler fills it asynchronously, outside React state).
  }, [entities, tracks, scripts, currentTime, fps, scriptsRecompiledTick, mediaAssets]);
 
  // Track-order -> stacking order. Previously every overlay entity got the
  // same flat zIndex (15, or 30 if selected) regardless of which track it
  // was on, and every video entity got a flat 5 -- so moving a clip to a
  // higher or lower track had literally no effect on what rendered in
  // front. Tracks are only ever appended (`setTracks(prev => [...prev,
  // ...])` in App.jsx -- there's no reorder feature yet), so a track's
  // array index is also its creation order and its number (Track 1, Track
  // 2, ...). Convention: a HIGHER track number/index renders IN FRONT of
  // lower ones (Track 3 sits on top of Track 2 and Track 1). Entities on a
  // track not found in `tracks` (shouldn't normally happen) fall back to
  // the back-most layer rather than crashing or defaulting to front.
  //
  const trackZIndexOf = (trackId) => {
    const idx = tracks.findIndex((t) => t.id === trackId);
    return idx === -1 ? 0 : idx + 1;
  };
  const layerZIndexOf = (item) => trackZIndexOf(item.entity.trackId);
 
  // Separate video clips (background layer) from overlay graphics/text/react/canvas.
  // Derived from computedEntities (already memoized above), so these only
  // recompute when computedEntities itself actually changes.
  const activeVideoItems = useMemo(
    () => computedEntities.filter(({ entity }) => isVideoEntity(entity)),
    [computedEntities]
  );
 
  const activeOverlayItems = useMemo(
    () =>
      computedEntities.filter(({ entity }) => !isVideoEntity(entity) && !isAudioEntity(entity)),
    [computedEntities]
  );
 
  // Synchronize active Video playback & seeking smoothly
  //
  // Effective media rate = VideoRenderer.speed (content rate inside the
  // clip) × Transform.speed (clip-level rate, the timeline-speed feature).
  // The element's playbackRate is set to that product so media stays glued
  // to its seek target instead of drifting (previously rate was always 1
  // and speed≠1 clips lurched via periodic re-seeks); with the defaults
  // (both 1) this is a pure no-op vs. the old behavior.
  //
  // Volume is applied through a Web Audio GainNode chain (see
  // utils/mediaAudio.js) so it can exceed 1.0 — element.volume is clamped
  // to [0,1] by the platform.
  useEffect(() => {
    const isStateTransition = wasPlayingRef.current !== isPlaying;
    wasPlayingRef.current = isPlaying;
 
    activeVideoItems.forEach(({ entity, transform }) => {
      const videoComp = entity.components.find((c) => c.type === 'VideoRenderer') || { src: entity.src };
      const vidSrc = videoComp.src || entity.src;
      if (!vidSrc) return;
 
      const vidEl = videoRefs.current[entity.id];
      if (vidEl) {
        const speed = (videoComp.speed || 1) * (transform?.speed ?? 1);
        const offset = videoComp.mediaOffset || 0;
        const localTime = (currentTime - entity.startTime) * speed + offset;
 
        // Default video volume to 0 (silent) — a video clip's audio is
        // owned by its linked AudioSource entity (handleAddMediaToTimeline
        // mutes the video and pairs it with one). This matches the export
        // mixdown (exportRunner.js collectAudioSources defaults
        // VideoRenderer volume to 0) so a video without an explicit volume
        // never plays its own audio track in preview, and a volume slider
        // on the video clip never silently does nothing.
        setMediaElementVolume(vidEl, videoComp.volume ?? 0);
        setMediaElementRate(vidEl, speed);
 
        if (isPlaying) {
          resumeAudioContext();
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
 
    // Pause any videos outside the active timeline window
    Object.keys(videoRefs.current).forEach((id) => {
      if (!activeVideoItems.some(({ entity }) => entity.id === id)) {
        const el = videoRefs.current[id];
        if (el && !el.paused) el.pause();
      }
      // Clean up videos whose entity was deleted from the project
      if (!entities.some((e) => e.id === id)) {
        const el = videoRefs.current[id];
        if (el) {
          if (!el.paused) el.pause();
          disconnectMediaGainChain(el);
        }
        delete videoRefs.current[id];
      }
    });
  }, [currentTime, isPlaying, activeVideoItems, entities]);
 
  // Synchronize Audio smoothly — same volume-through-GainNode and
  // clip-rate (AudioSource.speed × Transform.speed) treatment as video
  // above; see the video effect's comment for the rationale.
  useEffect(() => {
    computedEntities.forEach(({ entity, transform }) => {
      const audioComp =
        entity.components.find((c) => c.type === 'AudioSource') ||
        (entity.type === 'audio' ? { src: entity.src } : null);
      if (audioComp && audioComp.src) {
        let aud = audioRefs.current[entity.id];
        if (!aud) {
          aud = new Audio();
          aud.crossOrigin = 'anonymous';
          aud.src = audioComp.src;
          audioRefs.current[entity.id] = aud;
        } else if (aud.src !== audioComp.src) {
          aud.crossOrigin = 'anonymous';
          aud.src = audioComp.src;
        }
 
        const speed = (audioComp.speed || 1) * (transform?.speed ?? 1);
        const offset = audioComp.mediaOffset || 0;
        const localTime = (currentTime - entity.startTime) * speed + offset;
        setMediaElementVolume(aud, audioComp.volume ?? 1);
        setMediaElementRate(aud, speed);
 
        if (isPlaying) {
          resumeAudioContext();
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
      // Clean up audio elements whose entity was deleted from the project
      if (!entities.some((e) => e.id === id)) {
        const aud = audioRefs.current[id];
        if (aud) {
          if (!aud.paused) aud.pause();
          disconnectMediaGainChain(aud);
        }
        delete audioRefs.current[id];
      }
    });
  }, [currentTime, isPlaying, computedEntities, entities]);
 
  // P0 #2 — Drive canvas-kind script components every frame: mount on
  // first appearance, onUpdate with absolute-timeline localTime every
  // tick, unmount+prune when an entity or script leaves the active window.
  //
  // FLICKER FIX: this was a plain `useEffect`. Passive effects run
  // asynchronously *after* the browser has already painted the current
  // commit, so during playback (a rAF-driven `currentTime` state update
  // every frame) there's a real window where the browser can paint before
  // this effect's ctx.clearRect()/redraw calls run for the new time — i.e.
  // it briefly shows the *previous* frame's canvas pixels before this
  // effect catches up. That reads as flicker/glitching, and gets worse the
  // higher a script's `speed`-style prop is (more visual change per frame
  // makes the stale frame more noticeable). This is not a bug in
  // individual canvas scripts (they are pure functions of absolute
  // `time`, exactly per the P0 #2 contract) — it's the renderer's effect
  // timing.
  //
  // `useLayoutEffect` runs synchronously right after DOM mutations but
  // *before* the browser paints, so the canvas is fully redrawn for the
  // current `currentTime` before anything hits the screen — this is the
  // fix React's own docs recommend for any imperative canvas/DOM paint
  // that's driven by props/state (see https://react.dev/reference/react/useLayoutEffect).
  useLayoutEffect(() => {
    const activeMountKeys = [];
    computedEntities.forEach(({ entity, localTime }) => {
      for (const comp of entity.components || []) {
        if (!isScriptComponent(comp) || comp.enabled === false || !comp.scriptId) continue;
        const scriptDef = scripts.find((s) => s.id === comp.scriptId);
        if (!scriptDef || !scriptDef.code) continue;
        if (detectScriptKind(scriptDef.code) !== 'canvas') continue;
 
        const mountKey = `${entity.id}::${comp.scriptId}`;
        activeMountKeys.push(mountKey);
        const container = canvasContainerRefs.current[mountKey];
        if (!container) continue;
 
        updateCanvasComponent({
          entityId: entity.id,
          scriptId: comp.scriptId,
          scriptCode: scriptDef.code,
          container,
          localTime,
          frame: Math.round(localTime * fps),
          fps,
          props: comp.props || {},
          allEntities: entities,
          allAssets: mediaAssets,
          duration: entity.duration ?? 5,
          startTime: entity.startTime ?? 0,
          // Project's real output resolution — the default a canvas
          // script receives as canvasWidth/canvasHeight unless it
          // overrides via its own static props (see canvasRunner.js).
          canvasWidth: resolution?.width > 0 ? resolution.width : FALLBACK_RESOLUTION.width,
          canvasHeight: resolution?.height > 0 ? resolution.height : FALLBACK_RESOLUTION.height,
        });
      }
    });
 
    pruneCanvasComponents(activeMountKeys);
  }, [computedEntities, scripts, currentTime, fps, resolution?.width, resolution?.height, entities, mediaAssets]);
 
  // Clean up canvas and media elements when the whole EntityRenderer unmounts.
  useEffect(() => {
    return () => {
      pruneCanvasComponents([]);
      Object.values(audioRefs.current).forEach((aud) => {
        if (aud) {
          if (!aud.paused) aud.pause();
          disconnectMediaGainChain(aud);
        }
      });
      Object.values(videoRefs.current).forEach((vid) => {
        if (vid) {
          if (!vid.paused) vid.pause();
          disconnectMediaGainChain(vid);
        }
      });
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
  //
  // Gizmo drag handlers (move/rotate/scale) + the keyframe-aware
  // transform writer they funnel through (which mirrors
  // UnityInspector.jsx's tryWriteKeyframe: a field that already has ANY
  // keyframes must be written as a keyframe at the current playhead time,
  // not a static prop, or resolveKeyframedComponents overwrites it back
  // every render). See hooks/useGizmoDrag.js.
  const { handleMoveGizmoPointerDown, handleRotateGizmoPointerDown, handleScaleGizmoPointerDown } = useGizmoDrag({
    entities,
    onUpdateEntity,
    onSelectEntity,
    computedEntities,
    currentTime,
    fps,
    autoKeyEnabled,
    resolution,
    fallbackResolution: FALLBACK_RESOLUTION,
    viewportRefs: { canvasFrameRef, frameScale, previewMode, viewTransformRef },
    gizmoDragRef,
  });
 
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
        ref={viewportBoxRef}
        style={
          previewMode === 'extended'
            ? { overflow: 'visible', cursor: isPanning ? 'grabbing' : undefined }
            : undefined
        }
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelectEntity(null);
        }}
      >
        {/* Strictly preserves project aspect ratio — width and height are dynamically
            fitted to the available viewport box without distortion or stretching. */}
        <div
          className={`preview-canvas-frame ${previewMode === 'extended' ? 'preview-canvas-frame--extended' : ''}`}
          ref={canvasFrameRef}
          style={{
            width: frameDimensions.width > 0 ? `${frameDimensions.width}px` : undefined,
            height: frameDimensions.height > 0 ? `${frameDimensions.height}px` : undefined,
            aspectRatio: `${safeResWidth} / ${safeResHeight}`,
            overflow: previewMode === 'extended' ? 'visible' : 'hidden',
          }}
        >
          {/* Resolution-space entity layer -- fixed to the project's real
              pixel dimensions so every entity's x/y/width/height/etc. below
              are literal project pixels (identical meaning to what
              exportRunner.js draws onto its full-resolution canvas). The
              single `scale(frameScale)` here is the only place screen-size
              adaptation happens; nothing below needs to know the frame is
              rendering smaller than the real resolution. */}
          <div
            className="preview-entities-layer"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: `${safeResWidth}px`,
              height: `${safeResHeight}px`,
              transform:
                previewMode === 'extended'
                  ? `translate(${viewTransform.panX}px, ${viewTransform.panY}px) scale(${frameScale * viewTransform.zoom})`
                  : `scale(${frameScale})`,
              transformOrigin: 'top left',
              // Current combined on-screen scale (frameScale, plus the
              // extended-mode zoom multiplier) as a CSS var -- the
              // selection outline and rotate gizmo below counter-scale
              // against this (see App.css) so they stay a constant,
              // visible on-screen size instead of shrinking toward
              // invisible right along with the content when zoomed out.
              '--view-scale': previewMode === 'extended' ? frameScale * viewTransform.zoom : frameScale,
            }}
          >
          {/* Extended-mode frame-bounds outline -- a child of the entity
              layer (not the outer static .preview-canvas-frame box) so it
              pans/zooms together with the entities instead of staying
              pinned in place while the content underneath it moves. Sized
              to the exact project-pixel resolution, so it always marks the
              real, exported frame edge regardless of current pan/zoom. */}
          {previewMode === 'extended' && (
            <div
              className="preview-frame-bounds-outline"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: `${safeResWidth}px`,
                height: `${safeResHeight}px`,
                // Counter-scale the border so its ON-SCREEN thickness
                // stays constant (targetPx) regardless of zoom -- this
                // div lives inside .preview-entities-layer and gets
                // scaled down with everything else by
                // `frameScale * viewTransform.zoom`, so a fixed
                // border-width in px here would shrink toward
                // invisible sub-pixel width at low zoom. Dividing by
                // the current combined scale cancels that out.
                borderWidth: `${2 / (frameScale * viewTransform.zoom || 1)}px`,
              }}
            />
          )}
          {/* 1. Background Video Layer */}
          {activeVideoItems.map((item) => {
            const { entity, transform, localTransform, transitionState } = item;
            const isSelected = entity.id === selectedEntityId;
            const videoComp = entity.components.find((c) => c.type === 'VideoRenderer') || { src: entity.src };
            const vidSrc = videoComp.src || entity.src;
            // Mount-time seek target: raw (un-keyframed) clip rate, since
            // this runs before the sync effect resolves keyframes at the
            // current time — the per-tick effect corrects any difference.
            const rawClipSpeed =
              (videoComp.speed || 1) *
              ((entity.components || []).find((c) => c.type === 'Transform')?.speed ?? 1);
            // Video has no authored width/height component (it fills the
            // frame via object-fit: contain at its own native aspect
            // ratio, unknown until the <video> element's metadata loads) —
            // so unlike a shape/text entity, there's no per-entity "base
            // size" for the scale gizmo to work from. The project's own
            // resolution is the base box instead: Scale=1 already means
            // "fills the frame" for video (see .active-video-element +
            // .video-layer-container below), so dragging a corner by half
            // the frame's width/height should move scaleX/scaleY by 1.0,
            // exactly the same relationship handleScaleGizmoPointerDown
            // already uses for shapes via their own width/height.
            const baseWidth = safeResWidth;
            const baseHeight = safeResHeight;
 
            return (
              <Fragment key={entity.id}>
              <div
                className={`video-layer-container ${isSelected ? 'selected' : ''} ${onUpdateEntity ? 'gizmo-draggable' : ''}`}
                style={{
                  transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scaleX}, ${transform.scaleY})`,
                  // Shift the CSS rotation/scale origin by the pivot offset so
                  // rotate and scale happen around the pivot point, not the
                  // element center. pivotX/Y are normalized (0=center, ±0.5=edge)
                  // so the pixel offset = pivot * baseSize. Default 0,0 →
                  // "calc(50% + 0px)" = center = existing behavior unchanged.
                  transformOrigin: `calc(50% + ${(transform.pivotX ?? 0) * baseWidth}px) calc(50% + ${(transform.pivotY ?? 0) * baseHeight}px)`,
                  opacity: transform.opacity,
                  // Unified with the overlay layer below: both use the same
                  // 100 + trackZIndexOf(...) base so a video and a shape/
                  // text/canvas entity stack correctly relative to each
                  // other by track order too, not just within their own
                  // type. Selected entity gets a large boost so it's always
                  // visible on top while you're actively editing it,
                  // regardless of its track.
                  zIndex: (isSelected ? 1000 : 0) + 100 + layerZIndexOf(item),
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEntity(entity.id);
                }}
                onPointerDown={(e) => {
                  // Same first-click-selects / second-press-drags-moves
                  // convention as the overlay layer's gizmo-draggable
                  // clips below — a video clip only becomes directly
                  // draggable once it's already the selected entity.
                  if (isSelected && onUpdateEntity) {
                    handleMoveGizmoPointerDown(e, entity, transform, localTransform);
                  }
                }}
              >
                <EntityErrorBoundary entityName={entity.name} resetKey={vidSrc}>
                  <video
                    ref={(el) => {
                      if (el) {
                        videoRefs.current[entity.id] = el;
                        if (!isPlaying) {
                          const localTime =
                            (currentTime - entity.startTime) * rawClipSpeed + (videoComp.mediaOffset || 0);
                          if (Math.abs(el.currentTime - localTime) > 0.05) {
                            el.currentTime = Math.max(0, localTime);
                          }
                        }
                      }
                    }}
                    className="active-video-element"
                    src={vidSrc}
                    crossOrigin="anonymous"
                    muted={(videoComp.volume ?? 0) === 0}
                    playsInline
                    style={transitionState ? { visibility: 'hidden' } : undefined}
                    onLoadedMetadata={(e) => {
                      const localTime =
                        (currentTime - entity.startTime) * rawClipSpeed + (videoComp.mediaOffset || 0);
                      e.target.currentTime = Math.max(0, localTime);
                      if (isPlaying) e.target.play().catch(() => {});
                    }}
                  />
                  {transitionState && (
                    <canvas
                      ref={(el) => {
                        if (el) {
                          const vid = videoRefs.current[entity.id];
                          if (vid) {
                            const isOut = transitionState.type === 'out';
                            const renderer = getSharedGLTransitionRenderer();
                            if (renderer) {
                              // Render at the VIDEO's own native resolution
                              // (not the project's safeResWidth/Height) so
                              // the GL pass doesn't stretch the frame to a
                              // different aspect ratio than the plain
                              // <video> element uses. object-fit: contain
                              // below then letterboxes it identically to
                              // .active-video-element, so nothing visibly
                              // shifts the instant a transition starts.
                              const nativeW = vid.videoWidth || safeResWidth;
                              const nativeH = vid.videoHeight || safeResHeight;
                              if (el.width !== nativeW) el.width = nativeW;
                              if (el.height !== nativeH) el.height = nativeH;
 
                              const rendered = renderer.render({
                                from: isOut ? vid : null,
                                to: isOut ? null : vid,
                                progress: transitionState.progress,
                                presetId: transitionState.presetId,
                                customGlsl: transitionState.customGlsl,
                                params: transitionState.params,
                                width: el.width,
                                height: el.height,
                              });
                              const c2d = el.getContext('2d');
                              if (c2d && rendered) {
                                c2d.clearRect(0, 0, el.width, el.height);
                                c2d.drawImage(rendered, 0, 0, el.width, el.height);
                              }
                            }
                          }
                        }
                      }}
                      width={safeResWidth}
                      height={safeResHeight}
                      className="active-transition-canvas"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        // Matches .active-video-element's object-fit so the
                        // transition frame is letterboxed/centered exactly
                        // like the video it's temporarily replacing.
                        objectFit: 'contain',
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                </EntityErrorBoundary>
              </div>
 
              {/* Selection outline + rotate/scale gizmo for the selected
                  video clip — same .preview-selection-gizmo overlay the
                  overlay-items layer uses below, and for the same reason:
                  it's a SIBLING of .video-layer-container, not a child, so
                  it never inherits that container's own `scale(scaleX,
                  scaleY)`. .video-layer-container itself is a full-frame
                  (100%/100%) flex box that centers the <video> inside it,
                  so translate(x, y) on IT moves that whole box and its
                  centered content together, landing the video's on-screen
                  center at frame-center + (x, y) — same final point the
                  overlay layer's entities land at via calc(-50% + x).
                  This gizmo div, though, is sized to the entity's actual
                  rendered box (not 100%/100%) and anchored via CSS at
                  frame-center (top:50%/left:50%, see
                  .preview-selection-gizmo below), so it needs that same
                  `calc(-50% + x)` self-centering term the overlay gizmo
                  uses — without it, the box's top-left corner (not its
                  center) lands on frame-center + (x, y), which is the bug
                  a screenshot caught: the outline sat offset down-right of
                  the actual video instead of surrounding it. Sized to the
                  project's own resolution (baseWidth/baseHeight =
                  safeResWidth/Height above) since a video clip's "base
                  size" at Scale=1 is the whole frame, not a per-entity
                  authored width/height. */}
              {isSelected && onUpdateEntity && (
                <div
                  className="preview-selection-gizmo"
                  style={{
                    // Same self-centering `-50%` term the overlay-items
                    // gizmo uses (see below): .preview-selection-gizmo is
                    // anchored via CSS at top:50%/left:50% of the parent
                    // (frame center), so translate(x, y) ALONE lands this
                    // box's own TOP-LEFT corner at frame-center + (x, y) —
                    // the box then extends further down-right from there
                    // instead of being centered on that point. Subtracting
                    // half its own width/height first (`calc(-50% + x)`)
                    // is what actually centers the box itself on
                    // frame-center + (x, y), matching where the video's
                    // own on-screen center really is.
                    transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px)) rotate(${transform.rotation}deg)`,
                    // Same pivot origin as the video content layer: keeps the
                    // gizmo outline and the video rotating around the same
                    // point. The gizmo's own dimensions are baseWidth*scaleX ×
                    // baseHeight*scaleY, so we still use baseWidth/baseHeight
                    // (pre-scale) for the pixel offset — that gives the same
                    // world-space origin as the content layer's transformOrigin.
                    transformOrigin: `calc(50% + ${(transform.pivotX ?? 0) * baseWidth}px) calc(50% + ${(transform.pivotY ?? 0) * baseHeight}px)`,
                    width: `${baseWidth * (transform.scaleX || 1)}px`,
                    height: `${baseHeight * (transform.scaleY || 1)}px`,
                    zIndex: 1000 + 100 + layerZIndexOf(item),
                  }}
                >
                  <div className="gizmo-rotate-stem" />
                  <div
                    className="gizmo-rotate-handle"
                    title="Drag to rotate (hold Shift to snap to 15°)"
                    onPointerDown={(e) => handleRotateGizmoPointerDown(e, entity, transform, localTransform, baseWidth, baseHeight)}
                  />
                  <div
                    className="gizmo-scale-handle gizmo-scale-handle-tl"
                    title="Drag to scale (hold Shift to keep aspect ratio)"
                    onPointerDown={(e) => handleScaleGizmoPointerDown(e, entity, transform, localTransform, 'tl', { baseWidth, baseHeight })}
                  />
                  <div
                    className="gizmo-scale-handle gizmo-scale-handle-tr"
                    title="Drag to scale (hold Shift to keep aspect ratio)"
                    onPointerDown={(e) => handleScaleGizmoPointerDown(e, entity, transform, localTransform, 'tr', { baseWidth, baseHeight })}
                  />
                  <div
                    className="gizmo-scale-handle gizmo-scale-handle-bl"
                    title="Drag to scale (hold Shift to keep aspect ratio)"
                    onPointerDown={(e) => handleScaleGizmoPointerDown(e, entity, transform, localTransform, 'bl', { baseWidth, baseHeight })}
                  />
                  <div
                    className="gizmo-scale-handle gizmo-scale-handle-br"
                    title="Drag to scale (hold Shift to keep aspect ratio)"
                    onPointerDown={(e) => handleScaleGizmoPointerDown(e, entity, transform, localTransform, 'br', { baseWidth, baseHeight })}
                  />
                </div>
              )}
              </Fragment>
            );
          })}
 
          {/* 2. Foreground Overlay GameObjects (Scripts, Text, Shapes, Prefabs) */}
          {activeOverlayItems.map((item) => {
            const { entity, transform, localTransform } = item;
            const isSelected = entity.id === selectedEntityId;
            const textComp = entity.components.find((c) => c.type === 'TextRenderer');
            const displayText = textComp
              ? resolveTextRendererText(textComp, entity, entities, currentTime)
              : '';
            const shapeComp = entity.components.find((c) => c.type === 'ShapeRenderer');
            // Rendered box size at scale 1 -- shared by the scale-gizmo drag
            // math (handleScaleGizmoPointerDown) and, for the selected
            // entity, the selection-gizmo overlay below, so both agree on
            // what "the clip's own size" means. Same lookup both places
            // previously duplicated separately.
            const baseWidth = (entity.components.find((c) => c.width))?.width || 180;
            const baseHeight = (entity.components.find((c) => c.height))?.height || 180;
 
            // Script-driven visuals — every ScriptComponent renders by its
            // detected kind: 'react' components mount as inline React
            // elements; 'canvas' scripts get a container <div> driven
            // imperatively in the useLayoutEffect above. Motion scripts
            // affect only the Transform (already applied by
            // computeActiveEntitiesAtTime) and render nothing here.
            const scriptComps = (entity.components || []).filter(
              (c) => isScriptComponent(c) && c.enabled !== false
            );
            const ReactComponentNodes = [];
            for (const comp of scriptComps) {
              const scriptDef = scripts.find((s) => s.id === comp.scriptId);
              if (!scriptDef || !scriptDef.code) continue;
              if (detectScriptKind(scriptDef.code) !== 'react') continue;
              const CompiledComponent = getCompiledReactComponent(scriptDef.code);
              if (!CompiledComponent) continue;
              const localTime = currentTime - entity.startTime;
              // Resolve entity/asset reference props before rendering
              const schema = extractScriptProps(scriptDef.code);
              const resolvedProps = resolveScriptProps(comp.props || {}, schema, entities, mediaAssets);
              ReactComponentNodes.push(
                <CompiledComponent
                  key={comp.scriptId}
                  {...resolvedProps}
                  frame={Math.round(localTime * fps)}
                  time={localTime}
                  duration={entity.duration}
                />
              );
            }
 
            const transitionFactor = item.transitionState
              ? (item.transitionState.type === 'in' ? item.transitionState.progress : (1 - item.transitionState.progress))
              : 1;
 
            return (
              <Fragment key={entity.id}>
              <div
                className={`preview-render-layer ${onUpdateEntity ? 'gizmo-draggable' : ''} ${isSelected && onUpdateEntity ? 'selected' : ''}`}
                style={{
                  transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px)) rotate(${transform.rotation}deg) scale(${transform.scaleX}, ${transform.scaleY})`,
                  // Shift rotation/scale origin to the pivot point. Same
                  // formula as the video layer: pivotX/Y normalized × baseSize
                  // gives the pixel offset from element center. Default 0,0 →
                  // no offset → identical behavior to before.
                  transformOrigin: `calc(50% + ${(transform.pivotX ?? 0) * baseWidth}px) calc(50% + ${(transform.pivotY ?? 0) * baseHeight}px)`,
                  opacity: (transform.opacity ?? 1) * transitionFactor,
                  zIndex: (isSelected ? 1000 : 0) + 100 + layerZIndexOf(item),
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
                    handleMoveGizmoPointerDown(e, entity, transform, localTransform);
                  }
                }}
              >
                <EntityErrorBoundary
                  entityName={entity.name}
                  resetKey={scriptComps.map((c) => c.scriptId).join(',')}
                >
                  {/* React-kind component renderer */}
                  {ReactComponentNodes}
 
                  {/* Canvas-kind mount targets. The actual drawing happens
                      imperatively inside engine/canvasRunner.js via
                      onMount/onUpdate against these <div>s; React only owns
                      the container elements and their positions. One
                      container per canvas-kind script, keyed by
                      entity::scriptId so multiple canvas scripts on one
                      entity stay independent. */}
                  {scriptComps.map((comp) => {
                    const scriptDef = scripts.find((s) => s.id === comp.scriptId);
                    if (!scriptDef?.code || detectScriptKind(scriptDef.code) !== 'canvas') return null;
                    const mountKey = `${entity.id}::${comp.scriptId}`;
                    return (
                      <div
                        key={mountKey}
                        className="canvas-render-container"
                        // BUG FIX: this container previously had no explicit
                        // size, so it shrank to its content's natural size.
                        // A canvas-kind script's <canvas style="width:100%;
                        // height:100%"> has nothing to resolve "100%"
                        // against without an explicitly-sized parent, so
                        // the browser falls back to the element's raw
                        // pixel attributes with no scaling applied — the
                        // canvas rendered smaller than the full frame even
                        // when canvasWidth/canvasHeight correctly equaled
                        // the project resolution and Transform.scale was 1.
                        // Sizing this div to the project's real resolution
                        // (the same numbers passed to the script as
                        // canvasWidth/canvasHeight — see canvasRunner.js)
                        // makes the canvas's 100%/100% resolve against the
                        // true frame size, so Scale=1, Position=(0,0) now
                        // means "fills the frame" as expected.
                        style={{
                          width: `${safeResWidth}px`,
                          height: `${safeResHeight}px`,
                        }}
                        ref={(el) => {
                          if (el) {
                            canvasContainerRefs.current[mountKey] = el;
                          } else {
                            delete canvasContainerRefs.current[mountKey];
                          }
                        }}
                      />
                    );
                  })}
 
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
                        fontSize: `${textComp.fontSize || DEFAULT_TEXT_FONT_SIZE}px`,
                        color: textComp.fontColor || DEFAULT_TEXT_FONT_COLOR,
                        fontFamily: cssFontFamily(textComp.fontFamily || DEFAULT_TEXT_FONT_FAMILY),
                        fontWeight: textComp.fontWeight || DEFAULT_TEXT_FONT_WEIGHT,
                        textShadow: textComp.shadowColor
                          ? `0 0 ${textComp.shadowBlur || 14}px ${textComp.shadowColor}`
                          : '0 3px 12px rgba(0,0,0,0.9)',
                      }}
                    >
                      {displayText}
                    </div>
                  )}
                </EntityErrorBoundary>
              </div>
 
              {/* Selection outline + rotate/scale gizmo handles — a SIBLING
                  of .preview-render-layer above, not a child of it. The
                  content div carries `scale(transform.scaleX,
                  transform.scaleY)` (the entity's own Scale), and this
                  overlay deliberately does NOT inherit that: it's
                  positioned with the same translate+rotate but sized
                  explicitly to the entity's actual on-screen box
                  (baseWidth/baseHeight * scaleX/scaleY, in project px), so
                  border thickness and handle size only ever need to
                  counter-scale against view zoom (--view-scale) — dividing
                  by the entity's own scale is no longer needed anywhere,
                  because this element was never scaled by it in the first
                  place. Kept in the same z-index band as the content div
                  (right after it, translate(-50%,-50%) centered the same
                  way) so it still visually tracks the clip 1:1. */}
              {isSelected && onUpdateEntity && (
                <div
                  key={`${entity.id}-gizmo`}
                  className="preview-selection-gizmo"
                  style={{
                    transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px)) rotate(${transform.rotation}deg)`,
                    // Same pivot origin as the content layer above so the
                    // gizmo outline and the content element rotate around
                    // the same world-space point.
                    transformOrigin: `calc(50% + ${(transform.pivotX ?? 0) * baseWidth}px) calc(50% + ${(transform.pivotY ?? 0) * baseHeight}px)`,
                    width: `${baseWidth * (transform.scaleX || 1)}px`,
                    height: `${baseHeight * (transform.scaleY || 1)}px`,
                    zIndex: 1000 + 100 + layerZIndexOf(item),
                  }}
                >
                  {/* Rotate handle — small circle above the clip, drag to
                      rotate around the clip's pivot point. */}
                  <div className="gizmo-rotate-stem" />
                  <div
                    className="gizmo-rotate-handle"
                    title="Drag to rotate (hold Shift to snap to 15°)"
                    onPointerDown={(e) => handleRotateGizmoPointerDown(e, entity, transform, localTransform, baseWidth, baseHeight)}
                  />
 
                  {/* Scale handles — one small square at each of the clip's
                      4 corners, drag any of them to resize from that
                      corner. Hold Shift to lock the aspect ratio the clip
                      had at drag start. Each corner tells
                      handleScaleGizmoPointerDown which direction is
                      "outward" for it, so dragging the top-left corner
                      up-left grows the clip the same way dragging the
                      bottom-right corner down-right always did. */}
                  <div
                    className="gizmo-scale-handle gizmo-scale-handle-tl"
                    title="Drag to scale (hold Shift to keep aspect ratio)"
                    onPointerDown={(e) => handleScaleGizmoPointerDown(e, entity, transform, localTransform, 'tl')}
                  />
                  <div
                    className="gizmo-scale-handle gizmo-scale-handle-tr"
                    title="Drag to scale (hold Shift to keep aspect ratio)"
                    onPointerDown={(e) => handleScaleGizmoPointerDown(e, entity, transform, localTransform, 'tr')}
                  />
                  <div
                    className="gizmo-scale-handle gizmo-scale-handle-bl"
                    title="Drag to scale (hold Shift to keep aspect ratio)"
                    onPointerDown={(e) => handleScaleGizmoPointerDown(e, entity, transform, localTransform, 'bl')}
                  />
                  <div
                    className="gizmo-scale-handle gizmo-scale-handle-br"
                    title="Drag to scale (hold Shift to keep aspect ratio)"
                    onPointerDown={(e) => handleScaleGizmoPointerDown(e, entity, transform, localTransform, 'br')}
                  />
                </div>
              )}
              </Fragment>
            );
          })}
          </div>
 
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
    </section>
  );}
 
 
 