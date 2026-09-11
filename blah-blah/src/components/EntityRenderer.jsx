 
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
import { updateCanvasComponent, unmountCanvasComponent, pruneCanvasComponents } from '../engine/canvasRunner';
import { isScriptComponent } from '../engine/ecs';
import { computeActiveEntitiesAtTime } from '../engine/renderPipeline';
import { getSharedGLTransitionRenderer } from '../engine/glTransitions';
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
 
  // Extended mode -- 'normal' clips entity content to the frame border,
  // exactly like the exported video will. 'extended' lets content past
  // the border stay visible (overflow: visible on the frame instead of
  // hidden), so you can see and work with entities positioned or
  // animating from outside the visible canvas -- e.g. a clip sliding in
  // from off-screen -- without it being invisibly clipped while you're
  // setting it up. Purely a viewing aid; export always clips to the real
  // resolution regardless of this setting.
  const [previewMode, setPreviewMode] = useState('normal');
 
  // Extended-mode pan/zoom -- lets you navigate the space around the
  // frame (Alt + right-mouse drag to pan, Ctrl + scroll to zoom) instead
  // of the fixed 1:1 fit-to-box view. Screen-space px offset + a
  // multiplier on top of frameScale; both reset whenever extended mode
  // is turned off so leaving it always lands back on the true,
  // un-panned/zoomed frame.
  const [viewTransform, setViewTransform] = useState({ panX: 0, panY: 0, zoom: 1 });
  const viewTransformRef = useRef(viewTransform);
  viewTransformRef.current = viewTransform;
  const [isPanning, setIsPanning] = useState(false);
  const isAltRightPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
 
  useEffect(() => {
    if (previewMode !== 'extended') {
      setViewTransform({ panX: 0, panY: 0, zoom: 1 });
    }
  }, [previewMode]);
 
  // Kept as a ref (not just a local closure) so the pointerdown re-measure
  // effect further down can force a fresh updateDimensions() call right
  // before any drag starts -- see that effect's comment for why this is
  // needed on top of the ResizeObserver below.
  const updateDimensionsRef = useRef(null);
 
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
 
    updateDimensionsRef.current = updateDimensions;
    updateDimensions();
 
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(box);
    return () => {
      observer.disconnect();
      updateDimensionsRef.current = null;
    };
  }, [resolution?.width, resolution?.height]);
 
  // dockview keeps every dock tab's content permanently mounted and just
  // hides the inactive ones (not unmount/remount) -- see dock/DockLayout.jsx.
  // Some hide/show mechanics (visibility toggling, off-screen positioning,
  // or a display:none <-> display:flex flip that happens to land back on
  // the *same* pixel size the box already had) don't reliably fire
  // ResizeObserver either while hidden or the instant they become visible
  // again. If the outer window was resized at all while this preview panel
  // was the inactive "View"/"Game" tab, `frameScale` can silently go stale
  // until *something* else happens to trigger a resize callback -- and
  // every gizmo drag divides by that same stale frameScale (see
  // handleMoveGizmoPointerDown / handleScaleGizmoPointerDown /
  // handleRotateGizmoPointerDown's getScale()), so a drag right after
  // switching back to this tab could track the cursor at the wrong rate or
  // even divide by a near-zero leftover scale from while the panel was
  // hidden at 0x0. Forcing one fresh measurement on the very first
  // pointerdown inside the viewport -- before React has even run the
  // gizmo's own pointerdown handler -- guarantees frameScale is correct
  // for that drag regardless of what dockview did while this tab was
  // inactive. Capture phase so it always runs first, and it's a pure
  // synchronous re-measure + setState, not a listener that blocks or
  // interferes with the actual drag handlers that fire right after it.
  useEffect(() => {
    const box = viewportBoxRef.current;
    if (!box) return;
    const handlePointerDownCapture = () => {
      updateDimensionsRef.current?.();
    };
    box.addEventListener('pointerdown', handlePointerDownCapture, { capture: true });
    return () => box.removeEventListener('pointerdown', handlePointerDownCapture, { capture: true });
  }, []);
 
  // Extended-mode navigation -- scroll to zoom, hold right-mouse and drag
  // to pan. Native listeners (not onWheel/onContextMenu React props)
  // because zoom needs `{ passive: false }` to preventDefault the browser's
  // own page-scroll, and pan needs to preventDefault the context menu for
  // the duration of a right-drag without suppressing normal right-clicks
  // elsewhere. Both are no-ops outside extended mode.
  useEffect(() => {
    const box = viewportBoxRef.current;
    const frame = canvasFrameRef.current;
    if (!box) return;
 
    const handleWheel = (e) => {
      if (previewMode !== 'extended') return;
      e.preventDefault();
      if (!frame) return;
 
      const frameRect = frame.getBoundingClientRect();
      // Zoom centers on the mouse position when it's over the frame; if
      // the mouse is out in the surrounding pan space (outside the
      // frame's own bounds -- normal in extended mode, since content can
      // now render past the frame edge), center on the frame's own
      // center instead of an arbitrary/undefined point.
      const overFrame =
        e.clientX >= frameRect.left && e.clientX <= frameRect.right &&
        e.clientY >= frameRect.top && e.clientY <= frameRect.bottom;
      const pointerX = overFrame ? e.clientX : frameRect.left + frameRect.width / 2;
      const pointerY = overFrame ? e.clientY : frameRect.top + frameRect.height / 2;
 
      setViewTransform((prev) => {
        const zoomFactor = Math.exp(-e.deltaY * 0.0015);
        const nextZoom = Math.min(8, Math.max(0.1, prev.zoom * zoomFactor));
        // .preview-entities-layer sits at the frame's top-left (top:0;
        // left:0 inside .preview-canvas-frame) and is transformed as
        // `translate(pan) scale(s)` with transformOrigin top-left, so a
        // point that's `localX` px into the *untransformed* layer lands
        // on screen at: frameRect.left + pan + localX * s. Solving that
        // for localX using the CURRENT (prev) transform gives the layer
        // point currently sitting under the mouse; keeping that same
        // point under the mouse after zoom means solving the same
        // equation for the NEW pan with the NEW scale, holding localX
        // fixed.
        const prevScale = frameScale * prev.zoom || 1;
        const localX = (pointerX - frameRect.left - prev.panX) / prevScale;
        const localY = (pointerY - frameRect.top - prev.panY) / prevScale;
        const nextScale = frameScale * nextZoom;
        return {
          zoom: nextZoom,
          panX: pointerX - frameRect.left - localX * nextScale,
          panY: pointerY - frameRect.top - localY * nextScale,
        };
      });
    };
 
    const handleContextMenu = (e) => {
      if (previewMode === 'extended') e.preventDefault();
    };
 
    const handlePointerDown = (e) => {
      if (previewMode !== 'extended' || e.button !== 2) return;
      e.preventDefault();
      isAltRightPanningRef.current = true;
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: viewTransformRef.current.panX,
        panY: viewTransformRef.current.panY,
      };
      box.setPointerCapture?.(e.pointerId);
    };
 
    const handlePointerMove = (e) => {
      if (!isAltRightPanningRef.current) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setViewTransform((prev) => ({
        ...prev,
        panX: panStartRef.current.panX + dx,
        panY: panStartRef.current.panY + dy,
      }));
    };
 
    const handlePointerUp = (e) => {
      if (!isAltRightPanningRef.current) return;
      isAltRightPanningRef.current = false;
      setIsPanning(false);
      box.releasePointerCapture?.(e.pointerId);
    };
 
    box.addEventListener('wheel', handleWheel, { passive: false });
    box.addEventListener('contextmenu', handleContextMenu);
    box.addEventListener('pointerdown', handlePointerDown);
    box.addEventListener('pointermove', handlePointerMove);
    box.addEventListener('pointerup', handlePointerUp);
    return () => {
      box.removeEventListener('wheel', handleWheel);
      box.removeEventListener('contextmenu', handleContextMenu);
      box.removeEventListener('pointerdown', handlePointerDown);
      box.removeEventListener('pointermove', handlePointerMove);
      box.removeEventListener('pointerup', handlePointerUp);
    };
  }, [previewMode]);
 
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
    //
    // Extended mode additionally scales the layer by viewTransform.zoom
    // (see the transform on .preview-entities-layer), so the drag's
    // screen-to-project conversion has to include that too -- otherwise,
    // zoomed out, a small on-screen mouse move would still only divide by
    // the un-zoomed frameScale and undershoot massively, so the dragged
    // object visibly lags behind the cursor instead of sticking to it.
    // Zoomed in, the inverse: it would overshoot. Read zoom live off the
    // ref (not the closed-over `viewTransform`) so a zoom change mid-drag
    // is picked up on the very next pointermove rather than needing a new
    // drag to start.
    const getScale = () =>
      (frameScale || 1) * (previewMode === 'extended' ? (viewTransformRef.current.zoom || 1) : 1);
 
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
      toLocal,
    };
 
    const handlePointerMove = (moveEvent) => {
      const drag = gizmoDragRef.current;
      if (!drag || drag.mode !== 'move') return;
      const scale = getScale();
      const dx = (moveEvent.clientX - drag.startClientX) / (scale || 1);
      const dy = (moveEvent.clientY - drag.startClientY) / (scale || 1);
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
    // Rotation pivot is the entity's own center on screen. In normal
    // mode the entities layer is centered in the frame at scale
    // frameScale, so screen center = frame center + entity pos * scale.
    // In extended mode the layer is instead pinned to the frame's
    // top-left and offset/scaled by pan/zoom (see the transform on
    // .preview-entities-layer + the zoom-to-cursor math in the wheel
    // handler above), so the pivot has to go through that same mapping
    // instead of assuming frame-centered placement -- otherwise a
    // panned/zoomed rotate grabs the wrong pivot and the clip visibly
    // swings from the wrong point.
    let pivotX;
    let pivotY;
    if (previewMode === 'extended') {
      const vt = viewTransformRef.current;
      const scale = (frameScale || 1) * (vt.zoom || 1);
      const originX = safeResWidth / 2 + transform.x;
      const originY = safeResHeight / 2 + transform.y;
      pivotX = frameRect.left + vt.panX + originX * scale;
      pivotY = frameRect.top + vt.panY + originY * scale;
    } else {
      const scale = frameScale || 1;
      pivotX = frameRect.left + frameRect.width / 2 + transform.x * scale;
      pivotY = frameRect.top + frameRect.height / 2 + transform.y * scale;
    }
 
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
 
  // `corner` is one of 'tl' | 'tr' | 'bl' | 'br' -- which of the clip's 4
  // corners this drag started from. Each corner has its own "outward"
  // direction (top-left grows by moving up-left, bottom-right grows by
  // moving down-right, etc.), so the sign of the local-space delta applied
  // to scaleX/scaleY is flipped per corner below. Defaults to 'br' so any
  // existing caller that doesn't pass a corner keeps the original
  // bottom-right-only behavior.
  // `baseSizeOverride` — optional `{ baseWidth, baseHeight }`, used by
  // video clips (see activeVideoItems.map above): video has no authored
  // width/height component (it fills the frame via object-fit: contain at
  // its native aspect ratio), so "the box this entity renders at Scale=1"
  // isn't `entity.components.find((c) => c.width)` the way it is for a
  // shape/text entity — it's the project's own resolution instead. When
  // omitted, falls back to the original component-width/height lookup
  // unchanged, so shape/text/script entities behave exactly as before.
  const handleScaleGizmoPointerDown = (e, entity, transform, localTransform, corner = 'br', baseSizeOverride = null) => {
    if (!onUpdateEntity) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectEntity(entity.id);
 
    const lx = localTransform || {};
    const startScaleX = lx.scaleX ?? transform.scaleX ?? 1;
    const startScaleY = lx.scaleY ?? transform.scaleY ?? 1;
    // Same screen-px -> project-px factor as the move gizmo (frameScale,
    // plus the extended-mode zoom multiplier) -- read live off the ref
    // each move so a zoom mid-drag is picked up immediately, same as the
    // move gizmo above.
    const getScale = () =>
      (frameScale || 1) * (previewMode === 'extended' ? (viewTransformRef.current.zoom || 1) : 1);
    // Drag direction needs to be measured in the entity's own rotated
    // local space, not raw screen axes -- otherwise dragging "outward"
    // along a rotated clip's actual corner would scale the wrong axis.
    const rotRad = ((transform.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rotRad);
    const sin = Math.sin(rotRad);
    const toLocal = (dx, dy) => ({
      x: dx * cos + dy * sin,
      y: -dx * sin + dy * cos,
    });
 
    // Sign flip per corner: left-side corners (tl/bl) grow scaleX when
    // dragged toward negative local X (leftward/outward from center), so
    // their local.x contribution is negated relative to the right-side
    // corners (tr/br), which grow scaleX moving toward positive local X.
    // Same idea vertically: top corners (tl/tr) grow scaleY moving toward
    // negative local Y (upward/outward), bottom corners (bl/br) grow
    // scaleY moving toward positive local Y.
    const signX = corner === 'tl' || corner === 'bl' ? -1 : 1;
    const signY = corner === 'tl' || corner === 'tr' ? -1 : 1;
 
    gizmoDragRef.current = {
      mode: 'scale',
      entityId: entity.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startScaleX,
      startScaleY,
      toLocal,
      signX,
      signY,
    };
 
    const handlePointerMove = (moveEvent) => {
      const drag = gizmoDragRef.current;
      if (!drag || drag.mode !== 'scale') return;
      const scale = getScale();
      const dxScreen = (moveEvent.clientX - drag.startClientX) / (scale || 1);
      const dyScreen = (moveEvent.clientY - drag.startClientY) / (scale || 1);
      const local = drag.toLocal(dxScreen, dyScreen);
      // Handle sits at one corner of a 1x1-scale box half as wide/tall as
      // the rendered size, so moving that corner's handle by `local.x`
      // project-px away from center changes scale by `local.x /
      // (halfWidth)` -- using the entity's rendered box size at scale 1
      // (width/height component values) keeps the drag 1:1 with the
      // corner under the cursor. `signX`/`signY` account for which corner
      // was grabbed, so every corner grows the clip when dragged away
      // from its own center and shrinks it when dragged toward center,
      // the same way the original bottom-right-only handle always did.
      const baseWidth = baseSizeOverride?.baseWidth || (entity.components.find((c) => c.width))?.width || 180;
      const baseHeight = baseSizeOverride?.baseHeight || (entity.components.find((c) => c.height))?.height || 180;
      let nextScaleX = drag.startScaleX + (drag.signX * local.x) / (baseWidth / 2);
      let nextScaleY = drag.startScaleY + (drag.signY * local.y) / (baseHeight / 2);
      // Shift keeps the aspect ratio locked to whatever it was at drag
      // start, matching the rotate gizmo's Shift convention elsewhere.
      if (moveEvent.shiftKey) {
        const uniform = Math.max(nextScaleX / drag.startScaleX, nextScaleY / drag.startScaleY);
        nextScaleX = drag.startScaleX * uniform;
        nextScaleY = drag.startScaleY * uniform;
      }
      // Keep at least a sliver visible/draggable-back-from instead of
      // collapsing through zero or flipping sign underneath the cursor.
      nextScaleX = Math.max(0.02, nextScaleX);
      nextScaleY = Math.max(0.02, nextScaleY);
      updateSelectedTransform(drag.entityId, { scaleX: nextScaleX, scaleY: nextScaleY });
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
                    width: `${baseWidth * (transform.scaleX || 1)}px`,
                    height: `${baseHeight * (transform.scaleY || 1)}px`,
                    zIndex: 1000 + 100 + layerZIndexOf(item),
                  }}
                >
                  <div className="gizmo-rotate-stem" />
                  <div
                    className="gizmo-rotate-handle"
                    title="Drag to rotate (hold Shift to snap to 15°)"
                    onPointerDown={(e) => handleRotateGizmoPointerDown(e, entity, transform, localTransform)}
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
                    width: `${baseWidth * (transform.scaleX || 1)}px`,
                    height: `${baseHeight * (transform.scaleY || 1)}px`,
                    zIndex: 1000 + 100 + layerZIndexOf(item),
                  }}
                >
                  {/* Rotate handle — small circle above the clip, drag to
                      rotate around the clip's own center. */}
                  <div className="gizmo-rotate-stem" />
                  <div
                    className="gizmo-rotate-handle"
                    title="Drag to rotate (hold Shift to snap to 15°)"
                    onPointerDown={(e) => handleRotateGizmoPointerDown(e, entity, transform, localTransform)}
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
 
 
 