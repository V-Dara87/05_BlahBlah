 
 
 
 
import { useRef, useEffect, useMemo, useState, Fragment } from 'react';
import { getCompiledReactComponent, detectScriptKind, extractScriptProps } from '../../engine/scriptRunner';
import { resolveScriptProps } from '../../engine/referenceTypes';
import { resolveTextRendererText, cssFontFamily, DEFAULT_TEXT_FONT_SIZE, DEFAULT_TEXT_FONT_COLOR, DEFAULT_TEXT_FONT_FAMILY, DEFAULT_TEXT_FONT_WEIGHT } from '../../engine/textRenderer';
import { isScriptComponent, isVideoEntity, isAudioEntity } from '../../engine/ecs';
import { computeActiveEntitiesAtTime } from '../../engine/renderPipeline';
import { EntityErrorBoundary } from './EntityErrorBoundary';
import { usePreviewViewport } from '../../hooks/usePreviewViewport';
import { useGizmoDrag } from '../../hooks/useGizmoDrag';
import { useMediaSync } from '../../hooks/useMediaSync';
import { useCanvasScriptDriver } from '../../hooks/useCanvasScriptDriver';
import { VideoLayer } from '../preview/VideoLayer';
import { OverlayLayer } from '../preview/OverlayLayer';
import { PlaybackTransportBar } from '../preview/PlaybackTransportBar';
import './entity-renderer.css';
 
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
 
  // Video/audio playback sync (rate, volume, seek-to-timeline) — see
  // hooks/useMediaSync.js. It owns videoRefs/audioRefs; videoRefs is also
  // used below to attach the <video> elements themselves.
  const { videoRefs, audioRefs } = useMediaSync({
    entities,
    activeVideoItems,
    computedEntities,
    currentTime,
    isPlaying,
    tracks,
  });
 
  // Drives canvas-kind script components every frame — see
  // hooks/useCanvasScriptDriver.js. It owns canvasContainerRefs; JSX below
  // attaches each canvas-script's container into it via a ref callback.
  const { canvasContainerRefs } = useCanvasScriptDriver({
    computedEntities,
    scripts,
    currentTime,
    fps,
    resolution,
    fallbackResolution: FALLBACK_RESOLUTION,
    entities,
    mediaAssets,
  });
 
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
          {/* 1. Background Video Layer — see components/preview/VideoLayer.jsx */}
          <VideoLayer
            items={activeVideoItems}
            selectedEntityId={selectedEntityId}
            onSelectEntity={onSelectEntity}
            onUpdateEntity={onUpdateEntity}
            videoRefs={videoRefs}
            isPlaying={isPlaying}
            currentTime={currentTime}
            safeResWidth={safeResWidth}
            safeResHeight={safeResHeight}
            layerZIndexOf={layerZIndexOf}
            handleMoveGizmoPointerDown={handleMoveGizmoPointerDown}
            handleRotateGizmoPointerDown={handleRotateGizmoPointerDown}
            handleScaleGizmoPointerDown={handleScaleGizmoPointerDown}
          />
 
          {/* 2. Foreground Overlay GameObjects (Scripts, Text, Shapes, Prefabs) */}
          {/* 2. Foreground Overlay GameObjects (Scripts, Text, Shapes, Prefabs)
              — see components/preview/OverlayLayer.jsx */}
          <OverlayLayer
            items={activeOverlayItems}
            selectedEntityId={selectedEntityId}
            onSelectEntity={onSelectEntity}
            onUpdateEntity={onUpdateEntity}
            entities={entities}
            scripts={scripts}
            mediaAssets={mediaAssets}
            currentTime={currentTime}
            fps={fps}
            safeResWidth={safeResWidth}
            safeResHeight={safeResHeight}
            layerZIndexOf={layerZIndexOf}
            canvasContainerRefs={canvasContainerRefs}
            handleMoveGizmoPointerDown={handleMoveGizmoPointerDown}
            handleRotateGizmoPointerDown={handleRotateGizmoPointerDown}
            handleScaleGizmoPointerDown={handleScaleGizmoPointerDown}
          />
 
          </div>
 
        </div>
      </div>
 
      {/* Bottom Transport Bar */}
      {/* Bottom Transport Bar — see components/preview/PlaybackTransportBar.jsx */}
      <PlaybackTransportBar
        currentTime={currentTime}
        totalDuration={totalDuration}
        isPlaying={isPlaying}
        isLooping={isLooping}
        onTogglePlay={onTogglePlay}
        onSeek={onSeek}
        onToggleLoop={onToggleLoop}
        previewMode={previewMode}
        setPreviewMode={setPreviewMode}
        toggleFullscreen={toggleFullscreen}
      />
    </section>
  );}
 
 
 
 