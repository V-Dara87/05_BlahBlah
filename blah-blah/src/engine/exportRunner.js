 /**
 * exportRunner — the export-time counterpart of EntityRenderer.jsx: frame
 * drawing, the video frame provider, and the deterministic audio mixdown.
 *
 * MEMORY BASELINE (plan-2/plan-3 "export must survive hour-long projects")
 * -------------------------------------------------------------------------
 * The two things that used to scale with PROJECT length instead of a fixed
 * window were the audio decode (whole-file fetch + decodeAudioData per
 * audio-bearing clip — ~1.3 GB decoded for one hour of stereo) and the
 * encoded output (mp4-muxer's ArrayBufferTarget followed by a Blob and a
 * second Uint8Array copy in ExportModal.jsx). Both are now bounded:
 *
 *   - audio: decoded per clip WINDOW, in Tauri via the FFmpeg sidecar
 *     (`-ss`/`-t` -> raw f32le in a temp file, read back in 256 KiB chunks) —
 *     see decodeAudioWindow. The browser fallback still decodes whole files
 *     (no sidecar) and warns past BROWSER_DECODE_WARN_SECONDS.
 *   - output: ExportModal.jsx streams the muxed file to disk through
 *     services/exportFileStream.js (Tauri only) instead of buffering it.
 *
 * MEASURED (2026-09-22, this machine): not yet — the plan's one-hour,
 * several-thousand-clip test project numbers (peak memory during mixdown,
 * peak memory during the frame loop, total export time, both engines) still
 * have to be taken and recorded HERE, so future changes have something to
 * compare against. Re-run that export and fill in:
 *     mixdown peak: ____ MB   frame-loop peak: ____ MB   total: ____ s
 *     (WebCodecs engine: ____ ; FFmpeg-mastering engine: ____)
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { getCompiledReactComponent, detectScriptKind } from './scriptRunner.js';
import { updateCanvasComponent, unmountCanvasComponent } from './canvasRunner.js';
import {
  computeActiveEntitiesAtTime,
  resolveTransitionFramePlan,
  getTransitionAudioWindows,
  resolveTransitionAudioForEntity,
} from './renderPipeline.js';
import { isScriptComponent, isVideoEntity, isAudioEntity } from './ecs.js';
import { is3DShape, drawShape3D } from './geometry3d.js';
import { getSharedGLTransitionRenderer } from './glTransitions.js';
import { resolveEffectiveVolume, findEntityTrack } from '../utils/trackAudio.js';
import { timeStretchChannels } from '../utils/timeStretch.js';
import { runFfmpeg } from '../services/ffmpegRunner.js';
import { isTauri, joinPath, ensureDir, removeFileIfExists, statFile, readFileChunks } from '../services/tauriFsAdapter.js';
import { exportTempFileName } from '../services/exportFileStream.js';
import {
  resolveTextRendererText,
  cssFontFamily,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_FONT_COLOR,
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_WEIGHT,
} from './textRenderer.js';
 
/**
 * P1 #11 — export-time equivalent of EntityRenderer.jsx's live preview.
 *
 * This file is the actual home of the functions ExportModal.jsx imports
 * (drawExportFrame, createCanvasContainerPool, createVideoFrameProvider).
 * Active-entity computation lives in engine/renderPipeline.js — the ONE
 * shared implementation both this file and EntityRenderer.jsx call (it
 * was previously hand-duplicated in both places, with drift like the
 * preview hardcoding fps: 30).
 *
 * Everything here is a pure function of an explicit `time` argument, never
 * wall-clock/rAF, mirroring EntityRenderer.jsx's `computedEntities` memo and
 * its video-sync / CanvasRenderer-driving effects, but called synchronously
 * per exported frame instead of on a live render cycle.
 *
 * PREVIEW/EXPORT PARITY. The live preview is DOM + CSS (VideoLayer.jsx,
 * OverlayLayer.jsx, useMediaSync.js); this file re-implements the same
 * layout with Canvas2D and Web Audio. Every helper below documents which
 * preview behavior it mirrors — when the preview's CSS/DOM changes, the
 * matching helper here has to change with it.
 */
 
// Re-exported so ExportModal.jsx keeps importing computeActiveEntitiesAtTime
// from this module — the implementation now lives in renderPipeline.js.
export {
  computeActiveEntitiesAtTime,
  resolveTransitionFramePlan,
  getTransitionAudioWindows,
} from './renderPipeline.js';
 
// ---------------------------------------------------------------------------
// Offscreen <div> pool for script-driven (canvas-kind + react-kind) entities
// ---------------------------------------------------------------------------
 
/**
 * Canvas-kind scripts mount into a real DOM container (see canvasRunner.js
 * onMount({ container })), same as live playback, and react-kind scripts
 * mount into one for flushSync rendering. For export we need those
 * containers to exist, but never attached to the visible page — an offscreen
 * parent, positioned far off-canvas, holds one <div> per entity+script
 * actively rendering during this export run.
 */
// React roots mounted into pooled containers (react-kind export).
const reactRoots = new Map(); // container -> Root
 
export function createCanvasContainerPool() {
  const root = document.createElement('div');
  root.style.position = 'fixed';
  root.style.left = '-99999px';
  root.style.top = '-99999px';
  root.style.pointerEvents = 'none';
  document.body.appendChild(root);
 
  // Keyed by `entityId::scriptId` so multiple script components on one
  // entity each get their own container (mirrors canvasRunner's mount
  // keys).
  const containers = new Map(); // mountKey -> HTMLDivElement
  const mountKeyFor = (entityId, scriptId = '') => `${entityId}::${scriptId || ''}`;
 
  return {
    /**
     * Get (creating if needed) the offscreen container for this
     * entity+script.
     *
     * `size` ({ width, height }) is passed for CANVAS-kind scripts only and
     * mirrors OverlayLayer.jsx exactly: there the `.canvas-render-container`
     * is sized to the project's real resolution and is a centering flex box
     * (overlay-layer.css). Giving the pooled container the same size + the
     * same flex centering makes a script's <canvas> lay out identically —
     * `width:100%` canvases fill the frame, natural-size canvases sit in the
     * middle — and drawCanvasContainerContents reads that real layout back.
     * (An earlier version left this unsized because the preview container
     * used to be unsized too; the preview was fixed, this file wasn't.)
     *
     * React-kind containers stay unsized shrink-to-fit boxes: in the preview
     * a react component is plain DOM inside the entity layer, not inside a
     * project-sized box.
     */
    getContainer(entityId, scriptId = '', size = null) {
      const mountKey = mountKeyFor(entityId, scriptId);
      let el = containers.get(mountKey);
      if (!el) {
        el = document.createElement('div');
        el.style.position = 'relative';
        el.style.display = 'inline-block';
        root.appendChild(el);
        containers.set(mountKey, el);
      }
      if (size && size.width > 0 && size.height > 0) {
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.width = `${size.width}px`;
        el.style.height = `${size.height}px`;
      }
      return el;
    },
    /** Unmount + drop the container for an entity+script no longer active. */
    releaseContainer(entityId, scriptId = '') {
      const mountKey = mountKeyFor(entityId, scriptId);
      const el = containers.get(mountKey);
      if (el) {
        unmountCanvasComponent(entityId, scriptId);
        const rootEl = reactRoots.get(el);
        if (rootEl) {
          try {
            rootEl.unmount();
          } catch {
            // already unmounted
          }
          reactRoots.delete(el);
        }
        el.remove();
        containers.delete(mountKey);
      }
    },
    /** Release every container not in the given still-active mount-key set. */
    pruneExcept(activeMountKeys) {
      const activeSet = new Set(activeMountKeys);
      for (const mountKey of containers.keys()) {
        if (!activeSet.has(mountKey)) {
          const [entityId, scriptId = ''] = mountKey.split('::');
          this.releaseContainer(entityId, scriptId);
        }
      }
    },
    disposeAll() {
      for (const mountKey of Array.from(containers.keys())) {
        const [entityId, scriptId = ''] = mountKey.split('::');
        this.releaseContainer(entityId, scriptId);
      }
      root.remove();
    },
    /**
     * Live container count. Bounded by the scripts ACTIVE at one instant
     * (pruned as playback moves past them), never by export length — this
     * exists so an export can assert that at start and finish.
     */
    size() {
      return containers.size;
    },
  };
}
 
// ---------------------------------------------------------------------------
// Deterministic video-frame provider
// ---------------------------------------------------------------------------
 
/**
 * Live playback (EntityRenderer.jsx) tolerates ~0.6s of drift between a
 * <video> element's currentTime and the target time, because it's syncing
 * against a running rAF loop. Export can't tolerate that: every frame must
 * show the video at *exactly* its computed local time, so this provider
 * always seeks and always awaits the browser actually landing the seek
 * (the 'seeked' event) before the caller is allowed to draw.
 */
export function createVideoFrameProvider() {
  const videos = new Map(); // entityId -> HTMLVideoElement
 
  return {
    /** Create (if needed) and fully preload one <video> per entity, up front. */
    async preload(entityId, src) {
      if (videos.has(entityId)) return videos.get(entityId);
 
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.src = src;
      video.muted = true; // Phase 1 is silent video; also avoids autoplay-policy issues.
      video.playsInline = true;
      video.preload = 'auto';
 
      await new Promise((resolve, reject) => {
        const onReady = () => {
          video.removeEventListener('loadedmetadata', onReady);
          video.removeEventListener('error', onError);
          resolve();
        };
        const onError = () => {
          video.removeEventListener('loadedmetadata', onReady);
          video.removeEventListener('error', onError);
          reject(new Error(`Failed to load video source: ${src}`));
        };
        video.addEventListener('loadedmetadata', onReady);
        video.addEventListener('error', onError);
      });
 
      videos.set(entityId, video);
      return video;
    },
 
    /**
     * Seek this entity's video to `localTime` (already adjusted for the
     * component's speed/mediaOffset by the caller) and resolve only once the
     * browser confirms the seek landed — this is what makes each exported
     * frame deterministic instead of "whatever the decoder had queued".
     * `playbackRate` (optional) is applied to the element so it carries the
     * same effective rate (VideoRenderer.speed × Transform.speed) the live
     * preview sets — irrelevant to frame-accurate seeking itself, but keeps
     * the provider element in the same state preview uses.
     */
    async seekTo(entityId, src, videoComp, localTime, playbackRate = 1) {
      const video = videos.get(entityId) || (await this.preload(entityId, src));
      video.playbackRate = playbackRate;
      const clamped = Math.max(0, Math.min(localTime, video.duration || localTime));
 
      // Already close enough (same frame) — skip the seek/await round-trip.
      if (Math.abs(video.currentTime - clamped) < 1 / 240) return;
 
      await new Promise((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = clamped;
      });
    },
 
    getVideoElement(entityId) {
      return videos.get(entityId) || null;
    },

    /**
     * How many <video> elements are held open. This grows with the number of
     * distinct SOURCES (one element per entity, created once by preload and
     * kept for the whole run), never with export DURATION — the export loop
     * below logs it at start and end so an hour-long project can be checked
     * for an unexpectedly large pool rather than assumed bounded.
     */
    size() {
      return videos.size;
    },
 
    /**
     * { [entityId]: source-file duration in seconds } for every preloaded
     * video. Fed to the transition resolver so it can tell when a clip's
     * extended media time runs past the real end of the file (no tail
     * footage) and hold the last frame instead of seeking into nothing.
     * Only finite, positive durations are reported.
     */
    getMediaDurations() {
      const out = {};
      for (const [id, video] of videos) {
        if (Number.isFinite(video.duration) && video.duration > 0) out[id] = video.duration;
      }
      return out;
    },
 
    /**
     * Seek several videos to arbitrary media times in parallel. A transition
     * window seeks BOTH neighbours, each outside its own clip window.
     * `plan` is resolveTransitionFramePlan().seekTimes:
     * Map<entityId, { mediaTime, rate }>; `srcOf(entityId)` supplies each
     * source URL (keeps this provider free of entity knowledge). Ids with no
     * source are skipped.
     *
     * Every element is created once by preload() and only ever seeked, never
     * paused/removed between frames, so a video stays alive for the whole
     * transition window and is not re-loaded when the window ends.
     */
    async seekMany(plan, srcOf) {
      const jobs = [];
      for (const [entityId, { mediaTime, rate }] of plan) {
        const src = srcOf(entityId);
        if (!src) continue;
        jobs.push(this.seekTo(entityId, src, null, mediaTime, rate));
      }
      await Promise.all(jobs);
    },
 
    disposeAll() {
      for (const video of videos.values()) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      videos.clear();
    },
  };
}
 
// ---------------------------------------------------------------------------
// Per-frame draw
// ---------------------------------------------------------------------------
 
/**
 * Draws one fully-composited frame into `ctx` for the given absolute `time`.
 *
 * COORDINATE SPACE. Everything an entity stores (Transform x/y, shape
 * width/height, font size, script canvasWidth/Height, …) is in PROJECT
 * pixels — the preview renders in a project-resolution layer and only
 * scales that whole layer to fit the screen. Export must do the same:
 * `width`/`height` are the OUTPUT size (e.g. a 1280×720 preset) and
 * `projectWidth`/`projectHeight` the project's own resolution. The frame is
 * drawn in project space and scaled (uniform, centred, clipped to the
 * project frame) onto the output, so exporting a 1920×1080 project at
 * 1280×720 (or 4K) keeps every position/size identical to the preview.
 * When the two are equal (the default 'Project Resolution' preset) the
 * scale is exactly 1 and nothing changes.
 *
 * Layer order: sorted by each entity's track position (a HIGHER track
 * index renders IN FRONT of lower ones — same convention as
 * EntityRenderer.jsx's live preview, see its trackZIndexOf comment).
 * Canvas paints in call order with later calls on top, so
 * ascending-by-track-index is exactly right: lowest track drawn first
 * (furthest back), highest track drawn last (frontmost).
 */
export async function drawExportFrame({
  ctx,
  width,
  height,
  // Project resolution the entities were authored in. Optional: defaults to
  // the output size (i.e. no scaling) for callers that don't pass it.
  projectWidth = 0,
  projectHeight = 0,
  time,
  entities,
  tracks,
  scripts = [],
  fps = 30,
  canvasContainers,
  videoFrameProvider,
  // BUG FIX: needed so canvas-kind scripts can resolve 'entity'/'asset'
  // typed props (e.g. a SubtitleTrack source slot) during export the
  // same way the live preview does — see the updateCanvasComponent call
  // below for the full explanation.
  mediaAssets = [],
}) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
 
  // Project-space frame size, and the uniform fit onto the output.
  const W = projectWidth > 0 ? projectWidth : width;
  const H = projectHeight > 0 ? projectHeight : height;
  const fit = Math.min(width / W, height / H);
 
  const computed = computeActiveEntitiesAtTime({
    entities,
    tracks,
    scripts,
    time,
    fps,
    // Same as EntityRenderer.jsx: motion scripts resolve asset-typed props
    // against the real media library, not an empty list.
    allAssets: mediaAssets,
    viewport: { width: W, height: H },
  });
 
  const trackZIndexOf = (trackId) => {
    const idx = tracks.findIndex((t) => t.id === trackId);
    return idx === -1 ? 0 : idx + 1;
  };
 
  // TransitionClips (renderPipeline.js resolveTransitionFramePlan). While one
  // is active its neighbours A and B are drawn TOGETHER as one GL blend, so
  // their normal draw is suppressed below — otherwise B would pop in over the
  // blend at the cut and A would vanish from under it. Projects with no
  // transition clips get an empty plan, so nothing here changes for them.
  const transitionPlan = resolveTransitionFramePlan({
    entities,
    tracks,
    time,
    mediaDurations: videoFrameProvider?.getMediaDurations?.() || {},
  });
 
  // Stable sort by track order so entities on the same track keep their
  // original relative draw order — matching EntityRenderer.jsx's
  // live-preview zIndex (trackZIndexOf there too).
  // A transition blend takes the draw slot A and B would have had: same
  // track, so same z-index. It is added as one pseudo-item tagged
  // `transitionBlend` and sorted together with the ordinary items, which
  // keeps it correctly behind higher tracks and in front of lower ones.
  //
  // Pose: A and B are outside their own clip window for half the transition
  // each, so computeActiveEntitiesAtTime has no resolved Transform for the
  // side that is not active. Use the pose of whichever side IS active this
  // frame (its keyframes/scripts already applied), else the entity's stored
  // Transform values. The blend is one image, so it takes one pose.
  const poseOfSide = (side) => {
    if (!side) return null;
    const active = computed.find(({ entity }) => entity.id === side.entity.id);
    return active?.transform || side.entity.components?.find((c) => c.type === 'Transform') || null;
  };
  const blendItems = transitionPlan.transitions.map((t) => ({
    transitionBlend: t,
    entity: t.from?.entity || t.to?.entity, // supplies trackId for z-order
    transform: poseOfSide(t.from) || poseOfSide(t.to) || { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
  }));
 
  const drawOrder = [
    ...computed.filter(({ entity }) => !transitionPlan.suppressedIds.has(entity.id)),
    ...blendItems,
  ]
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => {
      const aKey = trackZIndexOf(a.item.entity.trackId);
      const bKey = trackZIndexOf(b.item.entity.trackId);
      const diff = aKey - bKey;
      return diff !== 0 ? diff : a.originalIndex - b.originalIndex;
    })
    .map(({ item }) => item);
 
  ctx.save();
  try {
    // Project space -> output space, clipped to the project frame (the
    // preview frame is `overflow: hidden`).
    ctx.translate((width - W * fit) / 2, (height - H * fit) / 2);
    ctx.scale(fit, fit);
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
 
    for (const item of drawOrder) {
      const { entity, transform, localTime, transitionState, transitionBlend, is3D, projectedTransform } = item;
      if (transitionBlend) {
        try {
          drawTransitionBlend(ctx, transitionBlend, transform, W, H, videoFrameProvider);
        } catch (err) {
          console.warn('Export: render error on transition clip:', err);
        }
        continue;
      }
      if (isAudioEntity(entity)) continue;

      // 3D Near plane clipping: cull layers behind camera
      if (is3D && projectedTransform && !projectedTransform.inFrontOfCamera) {
        continue;
      }

      const activeTransform = (is3D && projectedTransform)
        ? {
            ...transform,
            x: projectedTransform.screenX - W / 2,
            y: projectedTransform.screenY - H / 2,
            scaleX: projectedTransform.scaleX,
            scaleY: projectedTransform.scaleY,
            rotation: projectedTransform.rotationZ,
          }
        : transform;
 
      try {
        if (isVideoEntity(entity)) {
          const videoComp = entity.components.find((c) => c.type === 'VideoRenderer') || { src: entity.src };
          const src = videoComp.src || entity.src;
          if (!src) continue;
          const video = videoFrameProvider.getVideoElement(entity.id);
          if (!video) continue;
 
          let mediaToDraw = video;
          if (transitionState) {
            const isOut = transitionState.type === 'out';
            const renderer = getSharedGLTransitionRenderer();
            if (renderer) {
              const glCanvas = renderer.render({
                from: isOut ? video : null,
                to: isOut ? null : video,
                progress: transitionState.progress,
                presetId: transitionState.presetId,
                customGlsl: transitionState.customGlsl,
                params: transitionState.params,
                width: video.videoWidth || W,
                height: video.videoHeight || H,
              });
              if (glCanvas) {
                mediaToDraw = glCanvas;
              }
            }
          }
 
          // Preview: the <video> element has a black background over its
          // whole frame-sized box (video-layer.css), so letterbox bars are
          // opaque black. While a GL transition runs the video is hidden and
          // the (transparent) transition canvas shows instead — no backdrop.
          drawTransformedMedia(ctx, mediaToDraw, activeTransform, W, H, { backdrop: mediaToDraw === video });
          continue;
        }
 
        // Preview (OverlayLayer.jsx) fades non-video entities through their
        // transition: opacity × (progress when transitioning in, 1 − progress
        // when out). Video transitions are handled by the GL pass above.
        const transitionFactor = transitionState
          ? transitionState.type === 'in'
            ? transitionState.progress
            : 1 - transitionState.progress
          : 1;
        const overlayTransform =
          transitionFactor === 1
            ? activeTransform
            : { ...activeTransform, opacity: (activeTransform.opacity ?? 1) * transitionFactor };
 
        // Preview pivots around `pivot × (the entity's own box size)` — for
        // overlays that is the first component's width/height (180 fallback),
        // NOT the frame size (OverlayLayer.jsx baseWidth/baseHeight).
        const pivotBase = {
          w: entity.components.find((c) => c.width)?.width || 180,
          h: entity.components.find((c) => c.height)?.height || 180,
        };
 
        const shapeComp = entity.components.find((c) => c.type === 'ShapeRenderer');
        const textComp = entity.components.find((c) => c.type === 'TextRenderer');
 
        // Script-driven visuals — ONE component type (ScriptComponent),
        // dispatched per script kind: 'canvas' mounts the compiled class into
        // a pooled offscreen container (updateCanvasComponent, same lifecycle
        // as live preview) and rasterizes its <canvas> AND DOM output;
        // 'react' mounts the compiled component via the same pooled
        // container with flushSync and rasterizes its output the same way
        // (see drawReactComponentContents). Multiple script components on
        // one entity each draw into their own container.
        for (const comp of entity.components) {
          if (!isScriptComponent(comp) || comp.enabled === false) continue;
          const scriptDef = scripts.find((s) => s.id === comp.scriptId);
          if (!scriptDef || !scriptDef.code) continue;
          const kind = detectScriptKind(scriptDef.code);
 
          if (kind === 'canvas') {
            const container = canvasContainers.getContainer(entity.id, comp.scriptId, { width: W, height: H });
            updateCanvasComponent({
              entityId: entity.id,
              scriptId: comp.scriptId,
              scriptName: scriptDef.name,
              scriptCode: scriptDef.code,
              container,
              localTime,
              frame: Math.round(localTime * fps),
              fps,
              props: comp.props || {},
              duration: entity.duration ?? 5,
              startTime: entity.startTime ?? 0,
              // Project resolution (not the output size), exactly what the
              // preview hands the script (useCanvasScriptDriver.js) — so a
              // script lays out the same at any export preset.
              canvasWidth: W,
              canvasHeight: H,
              // BUG FIX: allEntities/allAssets were never passed here, so
              // resolveScriptProps (referenceTypes.js) always resolved
              // 'entity'/'asset'-typed props (e.g. a SubtitleTrack source
              // slot, or any EntityRef/AssetRef prop) against an empty
              // array — makeEntityRef(undefined, []) silently returns the
              // "entity does not exist" stub, whose getCurrentText() always
              // returns ''. That's invisible in the *live preview* (which
              // does pass allEntities/allAssets — see EntityRenderer.jsx's
              // updateCanvasComponent call) but meant any script reading a
              // subtitle source (or any other entity/asset-ref prop) went
              // silently blank specifically during export.
              allEntities: entities,
              allAssets: mediaAssets,
            });
            await drawCanvasContainerContents(ctx, container, overlayTransform, W, H, pivotBase);
          } else if (kind === 'react') {
            const CompiledComponent = getCompiledReactComponent(scriptDef.code);
            if (typeof CompiledComponent === 'function') {
              const container = canvasContainers.getContainer(entity.id, comp.scriptId);
              await drawReactComponentContents({
                ctx,
                container,
                Component: CompiledComponent,
                props: comp.props || {},
                localTime,
                duration: entity.duration,
                fps,
                transform: overlayTransform,
                width: W,
                height: H,
                pivotBase,
              });
            }
          }
        }
 
        if (shapeComp) {
          drawShape(ctx, shapeComp, overlayTransform, W, H, pivotBase);
        } else if (textComp) {
          drawText(ctx, textComp, entity, overlayTransform, W, H, entities, time, pivotBase, fit);
        }
      } catch (err) {
        console.warn(`Export: render error on entity "${entity.name}":`, err);
      }
    }
  } finally {
    ctx.restore();
  }
 
  // Active mount keys for prune: every (entity, script) pair with an
  // enabled script component (whether or not its kind produced drawable
  // output this frame), so containers are released exactly when a script
  // component or entity leaves the active window.
  canvasContainers.pruneExcept(
    computed.flatMap(({ entity }) =>
      (entity.components || [])
        .filter((c) => isScriptComponent(c) && c.enabled !== false && c.scriptId)
        .map((c) => `${entity.id}::${c.scriptId}`)
    )
  );
}
 
// ---------------------------------------------------------------------------
// Drawing helpers — translate the same transform math EntityRenderer.jsx
// applies via CSS transform/opacity into direct canvas 2D drawing.
// ---------------------------------------------------------------------------
 
/**
 * Canvas equivalent of the preview's CSS
 *   transform: translate(x, y) rotate(r) scale(sx, sy);
 *   transform-origin: <element centre> + pivot × <base size>
 * with the element centred on the frame centre.
 *
 * pivotX/Y are normalized (-0.5..0.5, 0 = centre) and are multiplied by the
 * BASE size the preview uses for that layer: the whole frame for video
 * (VideoLayer.jsx), the entity's own box for overlays (OverlayLayer.jsx).
 * Rotation and scale happen around that pivot: the origin is moved to the
 * pivot, rotate/scale are applied, then the origin moves back by the
 * UNSCALED pivot offset (CSS: translate(O)·T·R·S·translate(−O)).
 * With pivot 0 (the default) this reduces to plain centre-based transforms.
 */
function applyTransform(ctx, transform, width, height, pivotBaseW = width, pivotBaseH = height) {
  const scaleX = transform.scaleX ?? 1;
  const scaleY = transform.scaleY ?? 1;
  const px = (transform.pivotX ?? 0) * pivotBaseW;
  const py = (transform.pivotY ?? 0) * pivotBaseH;
  ctx.translate(width / 2 + (transform.x || 0) + px, height / 2 + (transform.y || 0) + py);
  ctx.rotate(((transform.rotation || 0) * Math.PI) / 180);
  ctx.scale(scaleX, scaleY);
  ctx.translate(-px, -py);
  ctx.globalAlpha = Math.max(0, Math.min(1, transform.opacity ?? 1));
}
 
// Scratch canvases used to letterbox each side of a transition to the project
// frame before the GL pass. Module-level so a long export does not allocate
// two canvases per frame.
let transitionSideCanvasA = null;
let transitionSideCanvasB = null;
 
/**
 * Render one side (a <video>) into a W×H canvas with `object-fit: contain`
 * letterboxing on an opaque black background — exactly what the preview's
 * <video> box looks like (video-layer.css). The GL renderer stretches each
 * input texture to fill its whole output, so without this pre-fit two clips
 * of different aspect ratio would be distorted instead of letterboxed.
 * Returns null when the side is missing (the GL renderer then blends against
 * its empty texture, the same as the legacy per-clip transition).
 */
function fitVideoToFrameCanvas(existing, video, W, H) {
  if (!video) return { canvas: existing, ready: false };
  const canvas = existing || document.createElement('canvas');
  const cw = Math.max(1, Math.round(W));
  const ch = Math.max(1, Math.round(H));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const c = canvas.getContext('2d');
  c.fillStyle = '#000000';
  c.fillRect(0, 0, cw, ch);
  const mw = video.videoWidth || cw;
  const mh = video.videoHeight || ch;
  const scale = Math.min(cw / mw, ch / mh);
  const dw = mw * scale;
  const dh = mh * scale;
  try {
    c.drawImage(video, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  } catch (err) {
    console.warn('Export: failed to draw transition side:', err);
    return { canvas, ready: false };
  }
  return { canvas, ready: true };
}
 
/**
 * Draw one active TransitionClip: clip A's frame as `from`, clip B's frame as
 * `to`, through the shared GL renderer at the transition's own progress.
 * Both videos were already seeked to the resolver's extended media times by
 * the caller (ExportModal's seek loop), so this only reads their current
 * frame. The result is drawn through the same transform + letterbox path as
 * an ordinary video (drawTransformedMedia).
 */
function drawTransitionBlend(ctx, t, transform, W, H, videoFrameProvider) {
  const renderer = getSharedGLTransitionRenderer();
  if (!renderer) return;
  const videoA = t.from ? videoFrameProvider.getVideoElement(t.from.entity.id) : null;
  const videoB = t.to ? videoFrameProvider.getVideoElement(t.to.entity.id) : null;
  if (!videoA && !videoB) return;
 
  const a = fitVideoToFrameCanvas(transitionSideCanvasA, videoA, W, H);
  const b = fitVideoToFrameCanvas(transitionSideCanvasB, videoB, W, H);
  transitionSideCanvasA = a.canvas;
  transitionSideCanvasB = b.canvas;
 
  const glCanvas = renderer.render({
    from: a.ready ? a.canvas : null,
    to: b.ready ? b.canvas : null,
    progress: t.progress,
    presetId: t.presetId,
    customGlsl: t.customGlsl,
    params: t.params,
    width: W,
    height: H,
  });
  if (!glCanvas) return;
 
  // The GL canvas already IS the full letterboxed frame (W×H), so draw it
  // 1:1 with the entity pose applied. backdrop: opaque black under it, like
  // the video element's own background in the preview.
  drawTransformedMedia(ctx, glCanvas, transform, W, H, { backdrop: true });
}
 
/**
 * Draw a video frame (or GL-transition canvas) the way the preview shows it:
 * `object-fit: contain` inside the frame-sized box (video-layer.css), i.e.
 * scaled to fit entirely inside the frame at its own aspect ratio — never
 * cropped. (This used to be cover-fit, which drew any video whose aspect
 * ratio differed from the project's several times larger than the preview.)
 */
function drawTransformedMedia(ctx, mediaEl, transform, width, height, { backdrop = false } = {}) {
  // <video> reports videoWidth/Height; the GL transition <canvas> reports
  // width/height (it is sized to the video's native resolution).
  const mw = mediaEl.videoWidth || mediaEl.width || width;
  const mh = mediaEl.videoHeight || mediaEl.height || height;
  const scale = Math.min(width / mw, height / mh);
  const drawW = mw * scale;
  const drawH = mh * scale;
 
  ctx.save();
  applyTransform(ctx, transform, width, height);
  if (backdrop) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(-width / 2, -height / 2, width, height);
  }
  try {
    ctx.drawImage(mediaEl, -drawW / 2, -drawH / 2, drawW, drawH);
  } catch (err) {
    console.warn('Export: failed to draw video frame:', err);
  }
  ctx.restore();
}
 
/**
 * Preview: `.rendered-shape-node` is `box-sizing: border-box` with a CSS
 * border, so the stroke sits INSIDE the w×h box (outer size never grows) and
 * the background fills the whole box including under the border. A
 * `shapeType: 'circle'` is `border-radius: 50%` — an ellipse when w ≠ h.
 */
function drawShape(ctx, shapeComp, transform, width, height, pivotBase) {
  if (is3DShape(shapeComp.shapeType)) {
    ctx.save();
    applyTransform(ctx, transform, width, height, pivotBase.w, pivotBase.h);
    drawShape3D(ctx, shapeComp, null);
    ctx.restore();
    return;
  }

  const w = shapeComp.width || 180;
  const h = shapeComp.height || 180;
  const isCircle = shapeComp.shapeType === 'circle';
  // CSS clamps the radius to half the shorter side.
  const outerRadius = Math.max(0, Math.min(shapeComp.borderRadius ?? 0, Math.min(w, h) / 2));
 
  ctx.save();
  applyTransform(ctx, transform, width, height, pivotBase.w, pivotBase.h);
 
  ctx.fillStyle = shapeComp.color || '#ffffff';
  ctx.beginPath();
  if (isCircle) {
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    drawRoundedRectPath(ctx, -w / 2, -h / 2, w, h, outerRadius);
  }
  ctx.fill();
 
  const sw = shapeComp.strokeWidth || 0;
  if (sw > 0) {
    // Stroke along the centre-line of the inside border: inset by sw/2.
    const iw = Math.max(0, w - sw);
    const ih = Math.max(0, h - sw);
    ctx.beginPath();
    if (isCircle) {
      ctx.ellipse(0, 0, iw / 2, ih / 2, 0, 0, Math.PI * 2);
    } else {
      drawRoundedRectPath(ctx, -iw / 2, -ih / 2, iw, ih, Math.max(0, outerRadius - sw / 2));
    }
    ctx.lineWidth = sw;
    ctx.strokeStyle = shapeComp.strokeColor || '#38bdf8';
    ctx.stroke();
  }
 
  ctx.restore();
}
 
function drawRoundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}
 
/**
 * Split text into lines the way the preview's `.rendered-text-node`
 * (`white-space: pre-wrap`) does: explicit newlines are kept, and lines wrap
 * at spaces once they'd exceed the available width. In the preview that
 * width is half the frame: the layer is `position:absolute; left:50%`, so
 * its shrink-to-fit width is capped at (frame width − 50%). A single word
 * wider than that stays on its own line and overflows, as in CSS.
 */
function layoutTextLines(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (line !== '' && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}
 
function drawText(ctx, textComp, entity, transform, width, height, allEntities = [], time = 0, pivotBase, pixelScale = 1) {
  const text = resolveTextRendererText(textComp, entity, allEntities, time);
  const fontSize = textComp.fontSize || DEFAULT_TEXT_FONT_SIZE;
  const fontFamily = cssFontFamily(textComp.fontFamily || DEFAULT_TEXT_FONT_FAMILY);
  const fontWeight = textComp.fontWeight || DEFAULT_TEXT_FONT_WEIGHT;
 
  ctx.save();
  applyTransform(ctx, transform, width, height, pivotBase?.w, pivotBase?.h);
 
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
 
  // Canvas shadow blur/offset are in OUTPUT pixels (the transform doesn't
  // scale them), so scale them by the project→output fit to keep the same
  // look at every export resolution.
  if (textComp.shadowColor) {
    ctx.shadowColor = textComp.shadowColor;
    ctx.shadowBlur = (textComp.shadowBlur || 14) * pixelScale;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 12 * pixelScale;
    ctx.shadowOffsetY = 3 * pixelScale;
  }
 
  ctx.fillStyle = textComp.fontColor || DEFAULT_TEXT_FONT_COLOR;
 
  const lines = layoutTextLines(ctx, text, width / 2);
  if (lines.length === 1) {
    // Single line: unchanged behavior.
    ctx.fillText(lines[0], 0, 0);
  } else {
    // CSS `line-height: normal` ≈ the font's ascent + descent.
    const m = ctx.measureText('Mg');
    const lineHeight = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent || fontSize * 1.2;
    const top = (-(lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => ctx.fillText(line, 0, top + i * lineHeight));
  }
 
  ctx.restore();
}
 
/**
 * CanvasRenderer scripts draw into arbitrary DOM/canvas/WebGL content inside
 * their mounted container. The live preview shows ALL of it, so the export
 * has to as well:
 *
 *   - <canvas> elements (raw Canvas2D / Three.js / WebGL) are copied
 *     directly, at the size and position the browser actually laid them out.
 *   - Everything else (plain DOM a script builds with divs, text, SVG, CSS —
 *     the docs promise "DOM/Canvas/WebGL" for canvas scripts) is rasterized
 *     through an SVG <foreignObject> snapshot (see rasterizeDomToImage).
 *
 * BUG FIX: this used to draw <canvas> elements only and `return` early when
 * the container had none, so any Canvas Component that renders DOM (or mixes
 * DOM with a canvas) exported as nothing / lost its DOM half, even though the
 * preview showed it correctly.
 *
 * Both kinds are composited in DOM order. A container with no <canvas> is
 * one DOM snapshot; a container mixing both is split into DOM "runs" between
 * canvases so a label above a canvas stays above it.
 *
 * The pooled container is laid out at the preview's size with the preview's
 * flex-centering (see getContainer), so reading its rects back is exact.
 */
async function drawCanvasContainerContents(ctx, container, transform, width, height, pivotBase) {
  if (!container || !container.firstChild) return;
 
  const containerRect = container.getBoundingClientRect();
  if (containerRect.width <= 0 || containerRect.height <= 0) return;
 
  const layers = await collectContainerLayers(container);
  if (layers.length === 0) return;
 
  ctx.save();
  applyTransform(ctx, transform, width, height, pivotBase?.w, pivotBase?.h);
  for (const layer of layers) {
    // Position relative to the container's centre — the entity's origin,
    // since the preview centres the container on the frame.
    const dx = layer.rect.left - containerRect.left - containerRect.width / 2;
    const dy = layer.rect.top - containerRect.top - containerRect.height / 2;
    try {
      ctx.drawImage(layer.image, dx, dy, layer.rect.width, layer.rect.height);
    } catch (err) {
      console.warn('Export: failed to draw CanvasRenderer output:', err);
    }
  }
  ctx.restore();
}
 
/**
 * Split a container into an ordered list of drawable layers: each <canvas>
 * (snapshotted) and each maximal run of non-canvas DOM (rasterized).
 * Returns [{ image, rect }].
 */
async function collectContainerLayers(container) {
  const canvases = Array.from(container.querySelectorAll('canvas'));
 
  // Fast path — DOM only. One snapshot of the whole container.
  if (canvases.length === 0) {
    const rect = container.getBoundingClientRect();
    const image = await rasterizeDomToImage(container, { hideCanvases: false });
    return image ? [{ image, rect }] : [];
  }
 
  const layers = [];
  const containerRect = container.getBoundingClientRect();
 
  // DOM underneath / around the canvases: rasterize the container once with
  // every <canvas> hidden, and draw it FIRST. Canvas layers then go on top in
  // DOM order. (Text overlaid on a canvas is the common mixed case; the
  // reverse — DOM hidden behind a canvas — is rare and stays correct because
  // an opaque canvas simply covers it, as in the preview.)
  const hasNonCanvasContent = containerHasVisibleNonCanvasContent(container);
  if (hasNonCanvasContent) {
    const domImage = await rasterizeDomToImage(container, { hideCanvases: true });
    if (domImage) layers.push({ image: domImage, rect: containerRect });
  }
 
  for (const canvasEl of canvases) {
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const snap = snapshotCanvas(canvasEl);
    if (snap) layers.push({ image: snap, rect });
  }
  return layers;
}
 
/** True when the container holds anything visible besides <canvas> elements. */
function containerHasVisibleNonCanvasContent(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.nodeValue && node.nodeValue.trim() !== '') return true;
    } else {
      const tag = node.tagName;
      if (tag === 'IMG' || tag === 'VIDEO' || tag === 'SVG' || tag === 'svg') return true;
      if (tag !== 'CANVAS' && tag !== 'DIV' && tag !== 'SPAN' && tag !== 'STYLE' && tag !== 'SCRIPT') return true;
      if (tag === 'DIV' || tag === 'SPAN') {
        const cs = getComputedStyle(node);
        const hasBg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
        const hasBgImg = cs.backgroundImage && cs.backgroundImage !== 'none';
        const hasBorder = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0 ||
          parseFloat(cs.borderRightWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0;
        if (hasBg || hasBgImg || hasBorder) return true;
      }
    }
    node = walker.nextNode();
  }
  return false;
}
 
/**
 * Copy a live <canvas> into a plain 2D canvas immediately.
 *
 * WebGL / Three.js canvases are only guaranteed readable in the same task
 * that rendered them (unless created with preserveDrawingBuffer: true);
 * reading them after the frame is composited can return a cleared buffer,
 * i.e. an empty rectangle in the export. Copying right here — synchronously,
 * straight after the script's onUpdate — captures the frame that was just
 * rendered and gives the later async DOM work a stable bitmap to draw from.
 */
function snapshotCanvas(canvasEl) {
  const w = canvasEl.width;
  const h = canvasEl.height;
  if (!w || !h) return null;
  try {
    const copy = document.createElement('canvas');
    copy.width = w;
    copy.height = h;
    copy.getContext('2d').drawImage(canvasEl, 0, 0);
    return copy;
  } catch (err) {
    console.warn('Export: failed to snapshot <canvas>:', err);
    return null;
  }
}
 
// ---------------------------------------------------------------------------
// DOM -> image (SVG <foreignObject>), browser built-ins only
// ---------------------------------------------------------------------------
 
// Properties inlined onto every cloned element so the snapshot looks like the
// live DOM without needing the page's stylesheets (which don't travel into an
// SVG <img>). Covers layout + typography + paint used by script-built DOM.
const INLINED_STYLE_PROPS = [
  'display', 'position', 'top', 'left', 'right', 'bottom', 'z-index',
  'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'color', 'opacity', 'visibility', 'overflow', 'overflow-x', 'overflow-y',
  'transform', 'transform-origin', 'filter', 'mix-blend-mode', 'clip-path', 'mask-image',
  'box-shadow', 'text-shadow', 'outline',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-decoration',
  'text-transform', 'text-indent', 'text-overflow', 'white-space', 'word-break', 'overflow-wrap',
  'vertical-align', 'direction', 'writing-mode',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'justify-content', 'align-items', 'align-content', 'align-self', 'gap', 'row-gap', 'column-gap', 'order',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow',
  'object-fit', 'object-position', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
];
 
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
 
// Fetched-once cache: image URL -> data: URI (an SVG <img> can't load external
// resources, so <img>/url() sources have to be embedded).
const dataUriCache = new Map();
 
async function urlToDataUri(url) {
  if (!url || url.startsWith('data:')) return url;
  if (dataUriCache.has(url)) return dataUriCache.get(url);
  const p = (async () => {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  })().catch((err) => {
    dataUriCache.delete(url);
    console.warn('Export: could not embed image for DOM snapshot:', url, err);
    return null;
  });
  dataUriCache.set(url, p);
  return p;
}
 
// Font-face CSS embedded into the snapshot so script text uses the same
// fonts as the preview (an SVG <img> can't see the page's @font-face rules).
let fontCssPromise = null;
async function getEmbeddedFontCss() {
  if (fontCssPromise) return fontCssPromise;
  fontCssPromise = (async () => {
    const chunks = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin stylesheet: unreadable
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
        let css = rule.cssText;
        const urlRe = /url\((["']?)([^)"']+)\1\)/g;
        const matches = Array.from(css.matchAll(urlRe));
        for (const m of matches) {
          const raw = m[2];
          if (raw.startsWith('data:')) continue;
          let abs = raw;
          try {
            abs = new URL(raw, sheet.href || document.baseURI).href;
          } catch {
            // keep raw
          }
          const data = await urlToDataUri(abs);
          if (data) css = css.split(m[0]).join(`url("${data}")`);
        }
        chunks.push(css);
      }
    }
    return chunks.join('\n');
  })().catch(() => '');
  return fontCssPromise;
}
 
/** Drop the cached font CSS (e.g. when the project's fonts may have changed). */
export function clearExportDomCaches() {
  fontCssPromise = null;
  dataUriCache.clear();
}
 
/**
 * Clone `source` and inline the computed styles onto every element, so the
 * serialized markup renders the same standalone. <canvas> children become
 * <img> (data: URI) unless `hideCanvases`, in which case they become
 * same-size invisible spacers (layout is preserved; the caller draws the real
 * canvas itself on top).
 */
async function cloneWithInlinedStyles(source, { hideCanvases }) {
  const clone = source.cloneNode(false);
 
  if (source.nodeType === Node.ELEMENT_NODE) {
    const tag = source.tagName;
 
    // Replaced / special elements first.
    if (tag === 'CANVAS') {
      const spacer = document.createElementNS(XHTML_NS, 'div');
      const cs = getComputedStyle(source);
      const rect = source.getBoundingClientRect();
      spacer.setAttribute(
        'style',
        `display:${cs.display === 'inline' ? 'inline-block' : cs.display};width:${rect.width}px;height:${rect.height}px;` +
          `margin:${cs.margin};position:${cs.position};visibility:${hideCanvases ? 'hidden' : 'visible'};`
      );
      if (!hideCanvases) {
        try {
          const img = document.createElementNS(XHTML_NS, 'img');
          img.setAttribute('src', source.toDataURL('image/png'));
          img.setAttribute('style', `width:${rect.width}px;height:${rect.height}px;display:block;`);
          spacer.appendChild(img);
        } catch {
          // tainted canvas — leave the spacer blank
        }
      }
      return spacer;
    }
 
    if (tag === 'SCRIPT') return document.createComment('script removed');
    if (tag === 'VIDEO' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED') {
      // Can't be embedded in a static snapshot; keep an empty, same-size box.
      const box = document.createElementNS(XHTML_NS, 'div');
      const rect = source.getBoundingClientRect();
      box.setAttribute('style', `width:${rect.width}px;height:${rect.height}px;display:inline-block;`);
      return box;
    }
 
    // Inline computed style.
    const cs = getComputedStyle(source);
    let styleText = '';
    for (const prop of INLINED_STYLE_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v) styleText += `${prop}:${v};`;
    }
 
    // url(...) backgrounds must be embedded.
    const bg = cs.getPropertyValue('background-image');
    if (bg && bg.includes('url(')) {
      let out = bg;
      const re = /url\((["']?)([^)"']+)\1\)/g;
      for (const m of Array.from(bg.matchAll(re))) {
        if (m[2].startsWith('data:')) continue;
        const data = await urlToDataUri(m[2]);
        if (data) out = out.split(m[0]).join(`url("${data}")`);
      }
      styleText = styleText.replace(`background-image:${bg};`, `background-image:${out};`);
    }
 
    clone.setAttribute('style', styleText);
 
    // <img> sources must be embedded too.
    if (tag === 'IMG') {
      const raw = source.currentSrc || source.src;
      const data = await urlToDataUri(raw);
      if (data) clone.setAttribute('src', data);
      clone.removeAttribute('srcset');
    }
 
    // Form controls: reflect current value into the markup.
    if (tag === 'INPUT') clone.setAttribute('value', source.value);
    if (tag === 'TEXTAREA') clone.textContent = source.value;
  }
 
  for (const child of Array.from(source.childNodes)) {
    const childClone = await cloneWithInlinedStyles(child, { hideCanvases });
    if (childClone) clone.appendChild(childClone);
  }
  return clone;
}
 
/**
 * Rasterize an element's current DOM to an image via SVG <foreignObject>.
 * Sized to the element's own layout box (device-pixel-ratio 1 — the export
 * canvas does its own scaling). Resolves to an HTMLImageElement, or null if
 * the snapshot can't be produced (never throws: a failed script snapshot
 * must not abort the whole export).
 */
async function rasterizeDomToImage(element, { hideCanvases }) {
  const rect = element.getBoundingClientRect();
  const w = Math.max(1, Math.ceil(rect.width));
  const h = Math.max(1, Math.ceil(rect.height));
 
  try {
    // The container itself is the root: keep its children, but drop its own
    // off-screen positioning so it renders at 0,0 inside the SVG.
    const root = await cloneWithInlinedStyles(element, { hideCanvases });
    if (root.setAttribute) {
      const existing = root.getAttribute('style') || '';
      root.setAttribute('style', `${existing}position:relative;left:0;top:0;margin:0;width:${w}px;height:${h}px;`);
    }
 
    const serializer = new XMLSerializer();
    const markup = serializer.serializeToString(root);
    const fontCss = await getEmbeddedFontCss();
 
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      (fontCss ? `<defs><style type="text/css"><![CDATA[${fontCss}]]></style></defs>` : '') +
      `<foreignObject x="0" y="0" width="100%" height="100%">` +
      `<div xmlns="${XHTML_NS}" style="width:${w}px;height:${h}px;">${markup}</div>` +
      `</foreignObject></svg>`;
 
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('SVG foreignObject failed to decode'));
      img.src = url;
    });
    // Ensure the bitmap is decoded before the caller draws it this frame.
    if (typeof img.decode === 'function') {
      try {
        await img.decode();
      } catch {
        // onload already fired; drawImage will still work
      }
    }
    return img;
  } catch (err) {
    console.warn('Export: DOM snapshot of script output failed:', err);
    return null;
  }
}
 
/**
 * ReactRenderer export — mounts the compiled component into the pooled
 * offscreen container (the same DOM-mounting approach the live preview
 * uses, just off-page) and rasterizes its output.
 *
 * SCOPE: a ReactRenderer script's contract is "a function component
 * returning JSX" — it may render a <canvas>, plain DOM, or a mix. This
 * mounts + flushSync-renders the component, then composites its output with
 * the same collectContainerLayers path canvas-kind scripts use: <canvas>
 * elements are copied directly, and non-canvas DOM is rasterized through an
 * SVG <foreignObject> snapshot (browser built-ins only — no new dependency).
 * Videos/iframes inside a React script are drawn as empty boxes (they can't
 * be embedded in a static snapshot).
 *
 * flushSync is used (not an await) because the export frame loop is
 * synchronous per frame — this is called from drawExportFrame. React's
 * "flushSync from inside lifecycle" warning does not apply here: this
 * runs from the export loop, not from React's render/commit phases.
 */
async function drawReactComponentContents({
  ctx,
  container,
  Component,
  props,
  localTime,
  duration,
  fps = 30,
  transform,
  width,
  height,
  pivotBase,
}) {
  let root = reactRoots.get(container);
  if (!root) {
    root = createRoot(container);
    reactRoots.set(container, root);
  }
 
  flushSync(() => {
    root.render(
      React.createElement(Component, {
        ...props,
        frame: Math.round(localTime * fps),
        time: localTime,
        duration,
      })
    );
  });
 
  // BUG FIX: DOM-only React output used to be skipped here ("out of scope"),
  // so any React script that isn't canvas-rooted vanished from the export
  // while showing fine in the preview. It now goes through the same
  // DOM-aware path as canvas-kind scripts. The React container is an
  // unsized shrink-to-fit box (matching the preview, where a react component
  // is plain DOM inside the entity layer), so its own rect is the entity's
  // box and it is centred on the entity origin.
  if (!container.firstChild) return;
  const containerRect = container.getBoundingClientRect();
  if (containerRect.width <= 0 || containerRect.height <= 0) return;
 
  const layers = await collectContainerLayers(container);
  if (layers.length === 0) return;
 
  ctx.save();
  applyTransform(ctx, transform, width, height, pivotBase?.w, pivotBase?.h);
  for (const layer of layers) {
    const dx = layer.rect.left - containerRect.left - containerRect.width / 2;
    const dy = layer.rect.top - containerRect.top - containerRect.height / 2;
    try {
      ctx.drawImage(layer.image, dx, dy, layer.rect.width, layer.rect.height);
    } catch (err) {
      console.warn('Export: failed to draw ReactRenderer output:', err);
    }
  }
  ctx.restore();
}
 
// ---------------------------------------------------------------------------
// Phase 2 — deterministic audio mixdown
// ---------------------------------------------------------------------------
//
// This is the seam ExportModal.jsx's PLUG_IN_AUDIO_HERE comment pointed at:
// an OfflineAudioContext-based mixdown that walks every AudioSource /
// VideoRenderer(volume > 0) entity active anywhere in [exportStartTime,
// exportStartTime + exportDuration), decodes each source once, and schedules
// it into a single offline render at the right offset/gain/duration — same
// "pure function of an explicit time range" contract as the video frame
// loop, just rendered as one shot instead of per-frame.// Cache: "src|startSec|endSec" -> Promise<{ buffer, windowStartSec }>, so
// multiple entities/clips sharing one source file (or repeated exports of the
// same project) don't refetch and re-decode the same WINDOW. Keying on the
// window (not just the src) is what lets two clips on the same long file
// decode only their own slices without one clobbering the other's buffer.
const decodedBufferCache = new Map();
/** Running total of decoded audio seconds held in decodedBufferCache. */
let decodedBufferSeconds = 0;
/**
 * Ceiling on the decoded audio the cache may hold at once. Windows are small
 * (a clip's own used range), but a project can have many long clips on one
 * file; past this we drop the oldest entries instead of growing without
 * bound — a re-decode is cheap relative to running out of memory.
 */
const MAX_DECODED_CACHE_SECONDS = 900;
/**
 * How many audio windows may be decoded (i.e. how many FFmpeg decodes may run)
 * at once. The decoded buffers are all still needed simultaneously — this caps
 * process/disk pressure from N sidecars starting at the same time, not memory.
 */
const DECODE_CONCURRENCY = 4;

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving order
 * in the returned array. Used for the per-clip window decodes below.
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    })
  );
  return results;
}

/**
 * Decode ONE WINDOW of a source file into an AudioBuffer, instead of the whole
 * file. This is the audio half of "never materialize the whole thing": a
 * one-hour stereo voice track decodes to ~1.3 GB, which is what used to be
 * held for every audio-bearing clip just to schedule a few seconds of it.
 *
 * In Tauri, the FFmpeg sidecar decodes `[startSec, endSec)` of the source to
 * raw PCM in a temp file (memory stays flat) which is then read back in
 * fixed-size chunks into exactly-sized channel buffers. Outside Tauri there is
 * no sidecar, so this falls back to fetch + decodeAudioData of the whole file
 * — correct, just memory-hungry — and says so when the source is long.
 *
 * The returned `windowStartSec` is the SOURCE time the buffer's sample 0
 * corresponds to, so callers convert absolute source offsets into
 * buffer-relative ones (`offset - windowStartSec`). For the whole-file
 * fallback it is 0, which makes that path's math identical to before.
 *
 * @param {string} src playback URL (used for the cache key and, in the
 *   browser, for the fetch itself)
 * @param {number} referenceSampleRate export sample rate to decode at
 * @param {number} startSec window start, in source-file seconds
 * @param {number} endSec window end, in source-file seconds
 * @param {{ sourcePath?: string, sourceDurationSec?: number }} [options] on-disk
 *   path of the source (Tauri only — enables the windowed decode)
 * @returns {Promise<{ buffer: AudioBuffer, windowStartSec: number }>}
 */
async function decodeAudioWindow(src, referenceSampleRate, startSec, endSec, { sourcePath, sourceDurationSec = 0 } = {}) {
  // Outside Tauri there is no sidecar to decode a range, so the whole file is
  // decoded and cached PER SOURCE — exactly the pre-existing behaviour, so a
  // project with twenty clips on one audio file still fetches and decodes it
  // once, not twenty times. `windowStartSec: 0` then makes the caller's
  // absolute-offset maths identical to what it was before windows existed.
  if (!isTauri() || !sourcePath) {
    const whole = wholeFileBufferCache.get(src);
    if (whole) return whole;
    const promise = decodeWholeSourceInBrowser(src, referenceSampleRate, sourceDurationSec).catch(
      (err) => {
        wholeFileBufferCache.delete(src);
        throw err;
      }
    );
    wholeFileBufferCache.set(src, promise);
    return promise;
  }

  // Tauri: decode only the range this clip uses, cached per
  // (src, window) so two clips on the same range share one decode while clips
  // on different ranges don't evict each other.
  const winStart = Math.max(0, Math.floor((Number(startSec) || 0) * 1000) / 1000);
  const winEnd = Math.max(winStart, Math.ceil((Number(endSec) || 0) * 1000) / 1000);
  const cacheKey = `${src}|${winStart}|${winEnd}`;
  const cached = decodedBufferCache.get(cacheKey);
  if (cached) return cached;

  const promise = decodeAudioWindowWithFfmpeg(src, referenceSampleRate, winStart, winEnd, sourcePath).catch(
    (err) => {
      decodedBufferCache.delete(cacheKey);
      decodedBufferSeconds = Math.max(0, decodedBufferSeconds - (winEnd - winStart));
      throw err;
    }
  );

  decodedBufferCache.set(cacheKey, promise);
  decodedBufferSeconds += winEnd - winStart;
  evictDecodedCacheOverBudget();
  return promise;
}

/**
 * Whole-file decodes, keyed on src alone. Only the browser fallback uses it
 * (see decodeAudioWindow) — in Tauri every decode is a bounded window.
 */
const wholeFileBufferCache = new Map();

/** Drop oldest cache entries until the decoded-seconds budget is respected. */
function evictDecodedCacheOverBudget() {
  while (decodedBufferSeconds > MAX_DECODED_CACHE_SECONDS && decodedBufferCache.size > 1) {
    const oldestKey = decodedBufferCache.keys().next().value;
    const [, start, end] = String(oldestKey).split('|');
    decodedBufferSeconds -= Math.max(0, (Number(end) || 0) - (Number(start) || 0));
    decodedBufferCache.delete(oldestKey);
  }
}

/**
 * Tauri path: ask FFmpeg for just this window as raw 32-bit float PCM at the
 * export's own sample rate, then read that temp file back in chunks.
 *
 * `-ss` before `-i` is FFmpeg's accurate input seek (it decodes from the
 * preceding frame and discards to land exactly on the requested timestamp),
 * so the first decoded sample is the window start — which is what makes
 * `windowStartSec` trustworthy. `-ac 2` normalises mono/stereo to stereo the
 * way the browser's Web Audio up-mixing did.
 */
async function decodeAudioWindowWithFfmpeg(src, sampleRate, startSec, endSec, sourcePath) {
  const windowSeconds = endSec - startSec;
  if (!(windowSeconds > 0)) throw new Error(`Empty audio window for ${src}`);

  const tempDirPath = await getExportTempDirPath();
  await ensureDir(tempDirPath);
  const tempPath = joinPath(tempDirPath, exportTempFileName('audio-window', sourcePath));

  try {
    await runFfmpeg([
      '-nostats',
      '-hide_banner',
      '-ss',
      String(startSec),
      '-t',
      String(windowSeconds),
      '-i',
      sourcePath,
      '-vn',
      '-ac',
      '2',
      '-ar',
      String(sampleRate),
      '-f',
      'f32le',
      '-acodec',
      'pcm_f32le',
      '-y',
      tempPath,
    ]);

    const info = await statFile(tempPath);
    const totalSamples = info ? Math.floor(info.size / 4) : 0;
    const frames = Math.floor(totalSamples / 2);
    if (frames <= 0) throw new Error(`FFmpeg produced no audio for the window at ${startSec}s of ${sourcePath}`);

    const offlineCtx = new OfflineAudioContext(2, frames, sampleRate);
    const buffer = offlineCtx.createBuffer(2, frames, sampleRate);
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);

    // Interleaved f32 -> two planar channels. Chunked so the raw bytes are
    // never all live at once (the channels are the only full-window copy).
    let sampleIndex = 0;
    let carry = null;
    await readFileChunks(tempPath, AUDIO_WINDOW_READ_CHUNK_BYTES, (chunk) => {
      let bytes = chunk;
      if (carry) {
        const merged = new Uint8Array(carry.length + bytes.length);
        merged.set(carry, 0);
        merged.set(bytes, carry.length);
        bytes = merged;
        carry = null;
      }
      const usable = bytes.length - (bytes.length % 8); // whole stereo f32 frames only
      if (usable !== bytes.length) carry = bytes.slice(usable);
      if (usable === 0) return;
      // Copy into a freshly aligned buffer: Float32Array needs 4-byte alignment.
      const aligned = new Uint8Array(usable);
      aligned.set(bytes.subarray(0, usable));
      const samples = new Float32Array(aligned.buffer);
      for (let i = 0; i + 1 < samples.length; i += 2) {
        if (sampleIndex >= frames) break;
        left[sampleIndex] = samples[i];
        right[sampleIndex] = samples[i + 1];
        sampleIndex++;
      }
    });

    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    return { buffer, windowStartSec: startSec };
  } finally {
    await removeFileIfExists(tempPath);
  }
}

/** Browser fallback: the old whole-file fetch + decodeAudioData. */
async function decodeWholeSourceInBrowser(src, referenceSampleRate, sourceDurationSec) {
  if (sourceDurationSec > BROWSER_DECODE_WARN_SECONDS) {
    console.warn(
      `Export audio: "${src}" is ${Math.round(sourceDurationSec)}s long and this export is running in a browser, ` +
        `where there is no FFmpeg sidecar to decode only the used window — the whole file (roughly ` +
        `${(sourceDurationSec * referenceSampleRate * 2 * 4 / 1e9).toFixed(2)} GB decoded) has to be held in memory. ` +
        'Use the desktop app for long projects.'
    );
  }
  const response = await fetch(src);
  const arrayBuffer = await response.arrayBuffer();
  // Decode at the export's target sample rate directly — avoids a second
  // resample pass when this buffer is later copied into the offline mix,
  // which runs at the same rate.
  const decodeCtx = new OfflineAudioContext(2, 1, referenceSampleRate);
  const buffer = await decodeCtx.decodeAudioData(arrayBuffer);
  return { buffer, windowStartSec: 0 };
}

/**
 * Source length past which a browser-only export is worth warning about:
 * roughly 230 MB of decoded stereo float audio.
 */
export const BROWSER_DECODE_WARN_SECONDS = 600;
/** PCM read chunk size for the windowed decode (256 KiB ≈ 0.68 s of 48 kHz stereo f32). */
const AUDIO_WINDOW_READ_CHUNK_BYTES = 1 << 18;

/**
 * Temp directory for export-time PCM windows: the OS temp dir in Tauri (the
 * save path's own folder is not necessarily writable, and the project cache
 * may not exist for an export of an unsaved project). Cached after the first
 * lookup.
 */
let exportTempDirPath = null;
async function getExportTempDirPath() {
  if (exportTempDirPath) return exportTempDirPath;
  const { tempDir } = await import('@tauri-apps/api/path');
  exportTempDirPath = await tempDir();
  return exportTempDirPath;
}

/** Clear the decoded-audio-buffer cache (e.g. on project load / export end). */
export function clearExportAudioCache() {
  decodedBufferCache.clear();
  wholeFileBufferCache.clear();
  decodedBufferSeconds = 0;
}

/**
 * Resolve the on-disk path of a clip's media source from the project's media
 * library, so the Tauri windowed decode can hand it to FFmpeg. Matches on URL
 * first (the convention the rest of the app uses), then on file name — clips
 * can hold a URL that predates a blob -> disk re-point.
 */
function resolveSourcePath(src, mediaAssets) {
  if (!src || !Array.isArray(mediaAssets) || mediaAssets.length === 0) return null;
  const exact = mediaAssets.find((a) => a?.url === src);
  if (exact?.path) return exact.path;
  const tail = (s) => String(s || '').split(/[/\\]/).pop();
  const byName = mediaAssets.find((a) => a?.url && tail(a.url) === tail(src));
  return byName?.path || null;
}

/** Media-library duration for a source URL, when the library knows it. */
function resolveSourceDuration(src, mediaAssets) {
  if (!src || !Array.isArray(mediaAssets)) return 0;
  const exact = mediaAssets.find((a) => a?.url === src);
  return Number.isFinite(exact?.duration) ? exact.duration : 0;
}
 
/**
 * The time window in which an entity is actually audible in the live
 * preview, or null if it never is.
 *
 * The preview only plays audio for entities that pass computeActiveEntitiesAtTime
 * (renderPipeline.js): the entity AND every ancestor must be active, sit on a
 * visible + unlocked track, and be inside their own clip window. That
 * intersection of windows is computed here so the export mixes exactly the
 * same audio — previously a clip on a hidden/locked track, or one outliving
 * its parent, was silent in the preview but still exported.
 *
 * TransitionClip extension (Step 5): a clip that is the A or B side of a
 * valid transition keeps playing past its own [startTime, startTime +
 * duration) for the length of the transition — that's the whole point of
 * "both sides keep playing under the blend" (Step 4's preview behaviour;
 * this brings export audio in line with it). `transitionAudioWindows` is
 * getTransitionAudioWindows()'s per-entity map; when the entity (or its
 * video parent, for an AudioSource child clip) is a transition side, its
 * intersected window is UNIONED with the transition's extension rather than
 * narrowed by it — the transition window is additional audible time, not a
 * competing constraint from the same ancestor chain.
 */
function resolveAudibleWindow(entity, entityMap, trackMap, transitionAudioWindows) {
  let start = -Infinity;
  let end = Infinity;
  const visited = new Set();
  let curr = entity;
  while (curr) {
    if (visited.has(curr.id)) break; // cycle guard
    visited.add(curr.id);
    if (curr.active === false) return null;
    const track = trackMap.get(curr.trackId);
    if (track && (!track.visible || track.locked)) return null;
    start = Math.max(start, curr.startTime);
    end = Math.min(end, curr.startTime + curr.duration);
    if (!curr.parentId) break;
    curr = entityMap.get(curr.parentId);
  }
  if (!(end > start)) return null;
 
  const transitionAudio = resolveTransitionAudioForEntity(entity, transitionAudioWindows, entityMap);
  if (transitionAudio) {
    start = Math.min(start, transitionAudio.start);
    end = Math.max(end, transitionAudio.end);
  }
  return { start, end };
}
 
/**
 * Collect every entity that contributes audio to the export: entities with
 * an AudioSource component, or a VideoRenderer component with volume > 0
 * (a video clip may mute its own VideoRenderer and pair it with a
 * separate AudioSource entity — but a project is free to just leave a
 * video's own volume up instead).
 * Only entities that overlap the export's [start, start+duration) window at
 * all are included; per-entity trims for partial-overlap clips are handled
 * by the caller when scheduling.
 *
 * Also filters out anything on a track that's fully silenced by the mixer
 * (muted, or every track soloed elsewhere) via resolveEffectiveVolume — see
 * utils/trackAudio.js. This is only an early skip so a track-silenced clip
 * never gets decoded at all; the real per-clip gain (including the track
 * multiplier) is computed again in mixdownAudio below, since a track's
 * volume can be anywhere in (0, 1] and isn't just an on/off skip.
 *
 * `transitionAudioWindows` (Step 5, getTransitionAudioWindows() in
 * renderPipeline.js) is threaded through to resolveAudibleWindow so a clip
 * that is the A/B side of a valid TransitionClip — or the AudioSource child
 * of one — has its audible window extended to cover the transition. Each
 * returned source also carries `gainAt`: a 0..1 crossfade function of
 * timeline time (identity/`null` outside any transition), so mixdownAudio
 * can fade this clip's gain the same way its picture blends. Callers with
 * no transition clips in the project pass an empty map and every source's
 * `gainAt` is null, matching prior behaviour exactly.
 */
function collectAudioSources({ entities, exportStartTime, exportDuration, tracks = [], transitionAudioWindows = new Map() }) {
  const exportEndTime = exportStartTime + exportDuration;
  const entityMap = new Map((entities || []).map((e) => [e.id, e]));
  const trackMap = new Map((tracks || []).map((t) => [t.id, t]));
  const sources = [];
 
  for (const entity of entities) {
    const window = resolveAudibleWindow(entity, entityMap, trackMap, transitionAudioWindows);
    if (!window) continue;
    if (window.end <= exportStartTime || window.start >= exportEndTime) continue;
 
    const track = findEntityTrack(entity, tracks);
    if (resolveEffectiveVolume(1, track, tracks) <= 0) continue;
 
    const audioComp = entity.components?.find((c) => c.type === 'AudioSource');
    const videoComp = entity.components?.find((c) => c.type === 'VideoRenderer');
 
    // The crossfade envelope (if any) for THIS entity — or its video
    // parent, for an AudioSource child clip (same fallback as the window
    // extension above) — so a clip's paired audio fades along with it.
    const transitionAudio = resolveTransitionAudioForEntity(entity, transitionAudioWindows, entityMap);
    const gainAt = transitionAudio ? transitionAudio.gainAt : null;
 
    if (audioComp && (audioComp.src || entity.src) && (audioComp.volume ?? 1) > 0) {
      sources.push({ entity, comp: audioComp, src: audioComp.src || entity.src, window, gainAt });
    } else if (videoComp && videoComp.src && (videoComp.volume ?? 0) > 0) {
      sources.push({ entity, comp: videoComp, src: videoComp.src, window, gainAt });
    }
  }
 
  return sources;
}
 
/**
 * Render a single deterministic stereo mixdown of every audio-bearing
 * entity active during [exportStartTime, exportStartTime + exportDuration),
 * relative to that window (i.e. sample 0 of the returned buffer is
 * exportStartTime). Returns null if there is nothing to mix, so callers can
 * skip configuring an audio track entirely for a silent project.
 *
 * mediaOffset/speed/volume are read the same way the live AudioSource /
 * VideoRenderer DOM elements apply them (see PlaybackStoreBridge.jsx /
 * EntityRenderer.jsx), so a clip's in-point trim and gain match what you'd
 * hear scrubbing the timeline. Track mixer state (volume/mute/solo) is
 * applied the same way too, through resolveEffectiveVolume — see
 * utils/trackAudio.js — so an exported file matches what the mixer tab
 * shows, not just what each individual clip's own volume says.
 */
export async function mixdownAudio({
  entities,
  exportStartTime,
  exportDuration,
  sampleRate = 48000,
  tracks = [],
  // Step 5: getTransitionAudioWindows({ entities, tracks }) — the crossfade
  // envelope for every clip that is the A/B side of a valid TransitionClip.
  // Callers with no transition clips can omit this entirely; every source's
  // gainAt is then null and scheduling below is byte-for-byte what it was
  // before this step (a single flat gain value, no automation).
  transitionAudioWindows = new Map(),
  // Media library, used ONLY to find each source's on-disk path so the Tauri
  // windowed decode (decodeAudioWindow) can hand just the used range to
  // FFmpeg. Omitted/empty simply means every source decodes whole, exactly as
  // before this change.
  mediaAssets = [],
}) {
  const sources = collectAudioSources({ entities, exportStartTime, exportDuration, tracks, transitionAudioWindows });
  if (sources.length === 0) return null;
 
  const totalFrames = Math.max(1, Math.ceil(exportDuration * sampleRate));
  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);
 
  // ── Timing pass (synchronous) ───────────────────────────────────────────
  // Everything that decides WHICH range of which source is needed is computed
  // here, once: the decode pass below needs that window, and the scheduling
  // pass after it must not recompute it (one definition, so the decoded
  // window and the scheduled offset can never drift apart).
  //
  // Effective rate = AudioSource.speed (content rate inside the clip) ×
  // Transform.speed (clip-level rate), matching how the live preview
  // computes media rate (EntityRenderer.jsx) and the video frame provider's
  // playbackRate. NOTE (Work C scope constraint): the mixdown is ONE static
  // render over the whole export window, so only the raw component values can
  // apply — a Transform.speed that is itself keyframe-animated or
  // script-driven can't be followed here. Video frames and live preview
  // resolve speed per frame; audio export uses the static value. Volume goes
  // through an (offline) GainNode below, which — unlike
  // HTMLMediaElement.volume — accepts boosts above 1.0 unchanged, so loud
  // clips export loud.
  const prepared = [];
  for (const { entity, comp, src, window, gainAt } of sources) {
    const localTransformSpeed = entity.components?.find((c) => c.type === 'Transform')?.speed;
    const parentTransformSpeed = entity.parentId
      ? entities?.find((e) => e.id === entity.parentId)?.components?.find((c) => c.type === 'Transform')?.speed
      : undefined;
    const transformSpeed = localTransformSpeed ?? parentTransformSpeed ?? 1;
    const speed = (comp.speed || 1) * transformSpeed;
    const mediaOffset = comp.mediaOffset || 0;
    const clipVolume = comp.volume ?? 1;
    const track = findEntityTrack(entity, tracks);
    const volume = resolveEffectiveVolume(clipVolume, track, tracks);
    if (volume <= 0) continue;
 
    // Same clamped-overlap math as the video seek path: figure out what
    // slice of this entity's audible window actually falls inside the
    // export window, then map that back to a source offset via
    // mediaOffset + speed, exactly like scrubbing would.
    const entityStart = entity.startTime;
    const clipStart = Math.max(window.start, exportStartTime);
    const clipEnd = Math.min(window.end, exportStartTime + exportDuration);
    if (clipEnd <= clipStart) continue;
 
    const whenInMix = clipStart - exportStartTime;
    const localTimeAtClipStart = clipStart - entityStart;
    const sourceOffset = mediaOffset + localTimeAtClipStart * speed;
    const playDuration = (clipEnd - clipStart) * speed;
    if (!(playDuration > 0)) continue;

    prepared.push({
      entity,
      comp,
      src,
      window,
      gainAt,
      speed,
      clipStart,
      clipEnd,
      whenInMix,
      sourceOffset,
      playDuration,
      volume,
      sourcePath: resolveSourcePath(src, mediaAssets),
      sourceDuration: resolveSourceDuration(src, mediaAssets),
    });
  }
 
  // ── Decode pass: one WINDOW per clip ───────────────────────────────────
  // Each clip decodes only [sourceOffset, sourceOffset + playDuration) of its
  // file (Tauri; the browser fallback still decodes whole, see
  // decodeWholeSourceInBrowser). Capped concurrency: decoding is mostly disk 
  // and FFmpeg-process work, and a project can easily have a hundred clips on
  // distinct ranges of a handful of files.
  const decoded = await mapWithConcurrency(prepared, DECODE_CONCURRENCY, async (item) => {
    const windowStart = Math.max(0, item.sourceOffset);
    try {
      const { buffer, windowStartSec } = await decodeAudioWindow(
        item.src,
        sampleRate,
        windowStart,
        windowStart + item.playDuration,
        { sourcePath: item.sourcePath, sourceDurationSec: item.sourceDuration }
      );
      return { ...item, buffer, windowStartSec };
    } catch (err) {
      console.warn(`Export audio: failed to decode source for "${item.entity.name}":`, err);
      return null;
    }
  });
 
  let scheduledAny = false;
 
  for (const item of decoded) {
    if (!item) continue;
    const { buffer, gainAt, speed, clipStart, clipEnd, whenInMix, sourceOffset, playDuration, volume, windowStartSec } = item;

    // Absolute source time -> position INSIDE this windowed buffer. For the
    // whole-file browser fallback windowStartSec is 0, so this is exactly the
    // old `sourceOffset` and nothing downstream changes.
    const bufferOffset = sourceOffset - windowStartSec;
    if (bufferOffset >= buffer.duration) continue;
    // Seconds of SOURCE audio this clip consumes (buffer time, not real time).
    const sourceSeconds = Math.min(playDuration, buffer.duration - bufferOffset);
    if (sourceSeconds <= 0) continue;
 
    const bufferSource = offlineCtx.createBufferSource();
 
    if (Math.abs(speed - 1) < 1e-4) {
      bufferSource.buffer = buffer;
      // start(when, offset, duration): `duration` is in BUFFER seconds and is
      // independent of playbackRate (MDN) — at speed 1 it is also real time.
      // `bufferOffset` (not the absolute source time) is what offsets into a
      // windowed buffer.
      bufferSource.start(whenInMix, bufferOffset, sourceSeconds);
    } else {
      // Preview plays media through HTMLMediaElement, which keeps the pitch
      // when playbackRate ≠ 1. AudioBufferSourceNode.playbackRate does NOT
      // (a 1.1x voice came out ~1.65 semitones high), and passing
      // `duration / speed` to start() cut the clip short (it's buffer time,
      // not real time). So time-stretch just the slice this clip uses
      // (pitch-preserving WSOLA, utils/timeStretch.js) and play the result
      // back at rate 1 — its length is already the real-time length.
      // Step 2 of the memory work: this slice used to be cut out of a buffer
      // holding the ENTIRE source file, and both `from`/`to` were absolute
      // source sample indices. With a windowed buffer the zero point is the
      // window start, so the same slice is expressed relative to it
      // (`bufferOffset`) and lands on exactly the audio this clip uses — the
      // window decode hands back a short buffer, so the slice is now the whole
      // of it. sourceSeconds is likewise buffer-relative (clamped to the
      // buffer's own length above), so the from/to maths still lines up with
      // the window's zero point.
      const sr = buffer.sampleRate;
      const from = Math.max(0, Math.floor(bufferOffset * sr));
      const to = Math.min(buffer.length, Math.ceil((bufferOffset + sourceSeconds) * sr));
      if (to - from < 2) continue;
 
      const slice = [];
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        slice.push(buffer.getChannelData(ch).subarray(from, to));
      }
      const stretched = await timeStretchChannels(slice, sr, speed);
      const stretchedBuffer = offlineCtx.createBuffer(stretched.length, stretched[0].length, sr);
      stretched.forEach((data, ch) => stretchedBuffer.copyToChannel(data, ch));
 
      bufferSource.buffer = stretchedBuffer;
      bufferSource.start(whenInMix);
    }
 
    const gainNode = offlineCtx.createGain();
 
    // Step 5: crossfade the clip's own gain across any transition window
    // touching it, on top of its normal volume. `gainAt` is null for a clip
    // with no transition (the common case) — flat gain, unchanged from
    // before this step. Where present, it's sampled at fixed steps across
    // just the audible slice actually being scheduled (clipStart..clipEnd,
    // not the whole clip) and written as AudioParam automation breakpoints,
    // so the ramp lines up exactly with the picture's blend (both read the
    // same 0..1 progress off the same transition window — see
    // getTransitionAudioWindows in renderPipeline.js) regardless of how the
    // export window happens to be sliced relative to the transition.
    if (gainAt) {
      // Fine enough to sound like a smooth ramp (well under audible
      // stepping) without scheduling one breakpoint per sample.
      const STEP = 1 / 100;
      const t0 = gainAt(clipStart);
      gainNode.gain.setValueAtTime(Math.max(0, volume * t0), whenInMix);
      for (let t = clipStart + STEP; t < clipEnd; t += STEP) {
        const g = Math.max(0, volume * gainAt(t));
        gainNode.gain.linearRampToValueAtTime(g, whenInMix + (t - clipStart));
      }
      const gEnd = Math.max(0, volume * gainAt(clipEnd));
      gainNode.gain.linearRampToValueAtTime(gEnd, whenInMix + (clipEnd - clipStart));
    } else {
      gainNode.gain.value = Math.max(0, volume);
    }
 
    bufferSource.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    scheduledAny = true;
  }
 
  if (!scheduledAny) return null;
 
  return offlineCtx.startRendering();
}
 
// ---------------------------------------------------------------------------
// AAC encode of the rendered mixdown into the same muxer as the video track
// ---------------------------------------------------------------------------
 
/**
 * Encode a full AudioBuffer (from mixdownAudio) as AAC via WebCodecs
 * AudioEncoder and push every chunk into `muxer`. Chunked into ~1-second
 * AudioData pieces rather than one giant frame, since AudioEncoder expects
 * frame-sized input and this keeps memory bounded the same way the video
 * loop keeps its encoder queue bounded.
 */
export async function encodeAudioTrack({ audioBuffer, muxer, sampleRate = 48000 }) {
  if (typeof AudioEncoder === 'undefined') {
    throw new Error('This browser does not support WebCodecs (AudioEncoder), which audio export requires.');
  }
 
  const numberOfChannels = audioBuffer.numberOfChannels;
 
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });
  audioEncoder.configure({
    codec: 'mp4a.40.2', // AAC-LC
    sampleRate,
    numberOfChannels,
    bitrate: 192_000,
  });
 
  const chunkFrames = sampleRate; // ~1s per AudioData chunk fed to the encoder
  const totalFrames = audioBuffer.length;
 
  // Interleave once up front (AudioData wants interleaved planar-per-channel
  // or interleaved data depending on format; we use 'f32' interleaved here).
  for (let start = 0; start < totalFrames; start += chunkFrames) {
    const frameCount = Math.min(chunkFrames, totalFrames - start);
    const interleaved = new Float32Array(frameCount * numberOfChannels);
 
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const channelData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < frameCount; i++) {
        interleaved[i * numberOfChannels + ch] = channelData[start + i];
      }
    }
 
    const audioData = new AudioData({
      format: 'f32',
      sampleRate,
      numberOfFrames: frameCount,
      numberOfChannels,
      timestamp: Math.round((start / sampleRate) * 1_000_000),
      data: interleaved,
    });
 
    audioEncoder.encode(audioData);
    audioData.close();
 
    if (audioEncoder.encodeQueueSize > 4) {
      await new Promise((resolve) => {
        const check = () => {
          if (audioEncoder.encodeQueueSize <= 2) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });
    }
  }
 
  await audioEncoder.flush();
  audioEncoder.close();
}
 