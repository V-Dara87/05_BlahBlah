 
import { useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react';
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
import { getCompiledReactComponent, detectScriptKind, extractScriptProps } from '../engine/scriptRunner';
import { resolveScriptProps } from '../engine/referenceTypes';
import { updateCanvasComponent, unmountCanvasComponent, pruneCanvasComponents } from '../engine/canvasRunner';
import { isScriptComponent } from '../engine/ecs';
import { computeActiveEntitiesAtTime } from '../engine/renderPipeline';
import {
  setMediaElementVolume,
  setMediaElementRate,
  resumeAudioContext,
  disconnectMediaGainChain,
} from '../utils/mediaAudio';
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
}) {
  const containerRef = useRef(null);
  const viewportBoxRef = useRef(null);
  const canvasFrameRef = useRef(null);
  const videoRefs = useRef({});
  const audioRefs = useRef({});
  const canvasContainerRefs = useRef({});
  const wasPlayingRef = useRef(isPlaying);
  const gizmoDragRef = useRef(null);
 
  // Coordinate-system fix -- entity x/y/width/height/fontSize/etc. are
  // authored (and stored) as literal project-resolution pixels (e.g. `x:
  // 700` means 700px out of a 1080px-wide canvas), the same units export's
  // `exportRunner.js` draws onto its full-resolution canvas with. But
  // `.preview-canvas-frame` itself renders at whatever on-screen size fits
  // the viewport (CSS `max-width`/`max-height` + `aspect-ratio` -- see
  // App.css), which for a portrait/large-resolution project is almost
  // always *smaller* than the real resolution. Previously every entity's
  // transform was applied as raw CSS px directly inside that shrunk frame,
  // so the same `width: 700` shape that's correctly ~65% of a 1080px-wide
  // export canvas ended up looking enormous relative to, say, a 380px-wide
  // on-screen frame -- a live-preview-vs-export size mismatch that grew
  // with how much smaller the frame rendered than the true resolution.
  //
  // Fix: track how much smaller the frame currently renders vs the real
  // resolution (`frameScale`), and apply that as a single CSS
  // `transform: scale(frameScale)` on a wrapper sized to the *real*
  // resolution in px -- every entity's own x/y/width/etc. stay untouched,
  // literal project-pixel math (identical to what export does), and this
  // one wrapper scale is what makes it visually fit the smaller on-screen
  // frame. At `frameScale === 1` (frame rendered at its true resolution
  // size) this is a no-op, which is exactly export's situation.
  const [frameDimensions, setFrameDimensions] = useState({
    width: 0,
    height: 0,
    scale: 1,
  });
 
  const frameScale = frameDimensions.scale;
 
  useEffect(() => {
    const box = viewportBoxRef.current;
    if (!box) return;
 
    const resWidth = resolution?.width > 0 ? resolution.width : FALLBACK_RESOLUTION.width;
    const resHeight = resolution?.height > 0 ? resolution.height : FALLBACK_RESOLUTION.height;
 
    const updateDimensions = () => {
      // Available box area minus padding (16px on each side = 32px)
      const availW = Math.max(10, box.clientWidth - 32);
      const availH = Math.max(10, box.clientHeight - 32);
 
      // Strict aspect-ratio preserving fit
      const scale = Math.min(availW / resWidth, availH / resHeight);
      const width = Math.max(1, Math.round(resWidth * scale));
      const height = Math.max(1, Math.round(resHeight * scale));
 
      setFrameDimensions({ width, height, scale });
    };
 
    updateDimensions();
 
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(box);
    return () => observer.disconnect();
  }, [resolution?.width, resolution?.height]);
 
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
 
  const handleMoveGizmoPointerDown = (e, entity, transform, localTransform) => {
    if (!onUpdateEntity) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectEntity(entity.id);
 
    // Screen px -> project px: entities now render in true project-pixel
    // space (see preview-entities-layer's scale(frameScale) wrapper above),
    // so a screen-space drag delta must be divided by that same
    // frameScale to land as the correct project-pixel delta. Previously
    // this computed frameRect.width / frameEl.clientWidth, which measures
    // the same element two ways and is always ~1 regardless of how much
    // smaller the frame renders than the real resolution -- that never
    // actually captured the project-vs-screen scale difference.
    const scale = frameScale || 1;
 
    // Every entity is a flat timeline clip (no parent-child hierarchy), so
    // the Transform IS the world pose and the gizmo drag is a plain
    // world-space delta with no local-space conversion needed.
    const lx = localTransform || {};
    let toLocal = (dx, dy) => ({ x: dx, y: dy });
    if (entity.parentId) {
      const parentItem = computedEntities.find((c) => c.entity.id === entity.parentId);
      if (parentItem?.transform) {
        const pt = parentItem.transform;
        const parentRotRad = -((pt.rotation || 0) * Math.PI) / 180;
        const pScaleX = pt.scaleX || 1;
        const pScaleY = pt.scaleY || 1;
        const cos = Math.cos(parentRotRad);
        const sin = Math.sin(parentRotRad);
        toLocal = (dx, dy) => ({
          x: (dx * cos - dy * sin) / pScaleX,
          y: (dx * sin + dy * cos) / pScaleY,
        });
      }
    }

    gizmoDragRef.current = {
      mode: 'move',
      entityId: entity.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: lx.x ?? transform.x,
      startY: lx.y ?? transform.y,
      scale,
      toLocal,
    };
 
    const handlePointerMove = (moveEvent) => {
      const drag = gizmoDragRef.current;
      if (!drag || drag.mode !== 'move') return;
      const dx = (moveEvent.clientX - drag.startClientX) / (drag.scale || 1);
      const dy = (moveEvent.clientY - drag.startClientY) / (drag.scale || 1);
      const local = drag.toLocal(dx, dy);
      updateSelectedTransform(drag.entityId, { x: drag.startX + local.x, y: drag.startY + local.y });
    };
    const handlePointerUp = () => {
      gizmoDragRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };
 
  const handleRotateGizmoPointerDown = (e, entity, transform, localTransform) => {
    if (!onUpdateEntity) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectEntity(entity.id);
 
    const frameEl = canvasFrameRef.current;
    if (!frameEl) return;
    const frameRect = frameEl.getBoundingClientRect();
    // Rotation pivot is the entity's own center on screen: frame origin
    // (top-left) + frame center + the entity's current logical x/y scaled
    // to screen px via frameScale (mirrors the preview-entities-layer
    // scale(frameScale) wrapper used to render it).
    const scale = frameScale || 1;
    const pivotX = frameRect.left + frameRect.width / 2 + transform.x * scale;
    const pivotY = frameRect.top + frameRect.height / 2 + transform.y * scale;
 
    const startAngle = Math.atan2(e.clientY - pivotY, e.clientX - pivotX) * (180 / Math.PI);
 
    gizmoDragRef.current = {
      mode: 'rotate',
      entityId: entity.id,
      pivotX,
      pivotY,
      startAngle,
      startRotation: (localTransform ? localTransform.rotation : transform.rotation) || 0,
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
        ref={viewportBoxRef}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelectEntity(null);
        }}
      >
        {/* Strictly preserves project aspect ratio — width and height are dynamically
            fitted to the available viewport box without distortion or stretching. */}
        <div
          className="preview-canvas-frame"
          ref={canvasFrameRef}
          style={{
            width: frameDimensions.width > 0 ? `${frameDimensions.width}px` : undefined,
            height: frameDimensions.height > 0 ? `${frameDimensions.height}px` : undefined,
            aspectRatio: `${safeResWidth} / ${safeResHeight}`,
          }}
        >
          {/* Resolution badge -- confirms at a glance that the preview is
              actually locked to the project's resolution, not just a fixed
              16:9 default. */}
          <div className="preview-resolution-badge">
            {safeResWidth}×{safeResHeight}
          </div>
 
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
              transform: `scale(${frameScale})`,
              transformOrigin: 'top left',
            }}
          >
          {/* 1. Background Video Layer */}
          {activeVideoItems.map((item) => {
            const { entity, transform } = item;
            const isSelected = entity.id === selectedEntityId;
            const videoComp = entity.components.find((c) => c.type === 'VideoRenderer') || { src: entity.src };
            const vidSrc = videoComp.src || entity.src;
            // Mount-time seek target: raw (un-keyframed) clip rate, since
            // this runs before the sync effect resolves keyframes at the
            // current time — the per-tick effect corrects any difference.
            const rawClipSpeed =
              (videoComp.speed || 1) *
              ((entity.components || []).find((c) => c.type === 'Transform')?.speed ?? 1);
 
            return (
              <div
                key={entity.id}
                className={`video-layer-container ${isSelected ? 'selected' : ''}`}
                style={{
                  transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scaleX}, ${transform.scaleY})`,
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
                    onLoadedMetadata={(e) => {
                      const localTime =
                        (currentTime - entity.startTime) * rawClipSpeed + (videoComp.mediaOffset || 0);
                      e.target.currentTime = Math.max(0, localTime);
                      if (isPlaying) e.target.play().catch(() => {});
                    }}
                  />
                </EntityErrorBoundary>
              </div>
            );
          })}
 
          {/* 2. Foreground Overlay GameObjects (Scripts, Text, Shapes, Prefabs) */}
          {activeOverlayItems.map((item) => {
            const { entity, transform, localTransform } = item;
            const isSelected = entity.id === selectedEntityId;
            const textComp = entity.components.find((c) => c.type === 'TextRenderer');
            const shapeComp = entity.components.find((c) => c.type === 'ShapeRenderer');
 
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
 
            return (
              <div
                key={entity.id}
                className={`preview-render-layer ${isSelected ? 'selected' : ''} ${onUpdateEntity ? 'gizmo-draggable' : ''}`}
                style={{
                  transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px)) rotate(${transform.rotation}deg) scale(${transform.scaleX}, ${transform.scaleY})`,
                  opacity: transform.opacity,
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
                            unmountCanvasComponent(entity.id, comp.scriptId);
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
                      onPointerDown={(e) => handleRotateGizmoPointerDown(e, entity, transform, localTransform)}
                    />
                  </>
                )}
              </div>
            );
          })}
          </div>
 
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
  );}
 
 
 