
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { getCompiledReactComponent, detectScriptKind } from './scriptRunner.js';
import { updateCanvasComponent, unmountCanvasComponent } from './canvasRunner.js';
import { computeActiveEntitiesAtTime } from './renderPipeline.js';
import { isScriptComponent, isVideoEntity, isAudioEntity } from './ecs.js';
import { getSharedGLTransitionRenderer } from './glTransitions.js';
import { resolveEffectiveVolume, findEntityTrack } from '../utils/trackAudio.js';
import { timeStretchChannels } from '../utils/timeStretch.js';
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
export { computeActiveEntitiesAtTime } from './renderPipeline.js';

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
export function drawExportFrame({
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
  });

  const trackZIndexOf = (trackId) => {
    const idx = tracks.findIndex((t) => t.id === trackId);
    return idx === -1 ? 0 : idx + 1;
  };

  // Stable sort by track order so entities on the same track keep their
  // original relative draw order — matching EntityRenderer.jsx's
  // live-preview zIndex (trackZIndexOf there too).
  const drawOrder = computed
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

    for (const { entity, transform, localTime, transitionState } of drawOrder) {
      if (isAudioEntity(entity)) continue;

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
          drawTransformedMedia(ctx, mediaToDraw, transform, W, H, { backdrop: mediaToDraw === video });
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
            ? transform
            : { ...transform, opacity: (transform.opacity ?? 1) * transitionFactor };

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
        // as live preview) and rasterizes its <canvas> subtree; 'react'
        // mounts the compiled component via the same pooled container with
        // flushSync (see drawReactComponentContents for the exact scope:
        // canvas-rooted components; arbitrary DOM-only output is skipped
        // rather than guessed at). Multiple script components on one entity
        // each draw into their own container.
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
            drawCanvasContainerContents(ctx, container, overlayTransform, W, H, pivotBase);
          } else if (kind === 'react') {
            const CompiledComponent = getCompiledReactComponent(scriptDef.code);
            if (typeof CompiledComponent === 'function') {
              const container = canvasContainers.getContainer(entity.id, comp.scriptId);
              drawReactComponentContents({
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
 * their mounted container. Every <canvas> in the container is drawn (raw
 * Canvas2D/Three.js/WebGL all render to one), at the size and position the
 * browser actually laid it out — read back from the pooled container, which
 * has the preview's size and flex-centering (see getContainer) — so a
 * `width:100%` canvas fills the frame and a natural-size one is centred,
 * exactly as in the live preview. Anything that isn't a <canvas> (DOM-only
 * output from a script) is skipped for rasterization rather than attempted
 * with an html-to-canvas approximation, since that's out of scope for now.
 */
function drawCanvasContainerContents(ctx, container, transform, width, height, pivotBase) {
  const canvases = container.querySelectorAll('canvas');
  if (canvases.length === 0) return;

  const containerRect = container.getBoundingClientRect();

  ctx.save();
  applyTransform(ctx, transform, width, height, pivotBase?.w, pivotBase?.h);
  for (const canvasEl of canvases) {
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    // Position relative to the container's centre — which is the entity's
    // origin, since the preview centres the container on the frame.
    const dx = rect.left - containerRect.left - containerRect.width / 2;
    const dy = rect.top - containerRect.top - containerRect.height / 2;
    try {
      ctx.drawImage(canvasEl, dx, dy, rect.width, rect.height);
    } catch (err) {
      console.warn('Export: failed to draw CanvasRenderer output:', err);
    }
  }
  ctx.restore();
}

/**
 * ReactRenderer export — mounts the compiled component into the pooled
 * offscreen container (the same DOM-mounting approach the live preview
 * uses, just off-page) and rasterizes its output.
 *
 * SCOPE (deliberate): a ReactRenderer script's contract is "a function
 * component returning JSX" — no guarantee it renders a <canvas> at all.
 * Rasterizing arbitrary DOM to a 2D context would need a DOM-to-image
 * library (a new dependency with imperfect CSS fidelity) — out of scope
 * for this pass. So this mounts + flushSync-renders the component, then
 * draws its <canvas> subtree if one exists (mirroring
 * drawCanvasContainerContents, which is the common case — raw
 * Canvas2D/Three.js/WebGL all render to one), and otherwise skips the
 * entity exactly as export did before this branch existed. Not a
 * regression: DOM-only ReactRenderer clips previously never exported at
 * all.
 *
 * flushSync is used (not an await) because the export frame loop is
 * synchronous per frame — this is called from drawExportFrame. React's
 * "flushSync from inside lifecycle" warning does not apply here: this
 * runs from the export loop, not from React's render/commit phases.
 */
function drawReactComponentContents({
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

  const innerCanvas = container.querySelector('canvas');
  if (!innerCanvas) return; // DOM-only output — skipped (see scope note above)

  ctx.save();
  applyTransform(ctx, transform, width, height, pivotBase?.w, pivotBase?.h);
  try {
    ctx.drawImage(innerCanvas, -innerCanvas.width / 2, -innerCanvas.height / 2, innerCanvas.width, innerCanvas.height);
  } catch (err) {
    console.warn('Export: failed to draw ReactRenderer output:', err);
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
// loop, just rendered as one shot instead of per-frame.

// Cache: src URL -> Promise<AudioBuffer>, so multiple entities/clips sharing
// one source file (or repeated exports of the same project) don't refetch
// and re-decode it every time.
const decodedBufferCache = new Map();

async function decodeAudioSource(src, referenceSampleRate) {
  if (decodedBufferCache.has(src)) return decodedBufferCache.get(src);

  const promise = (async () => {
    const response = await fetch(src);
    const arrayBuffer = await response.arrayBuffer();
    // Decode at the export's target sample rate directly — avoids a second
    // resample pass when this buffer is later copied into the offline mix,
    // which runs at the same rate.
    const decodeCtx = new OfflineAudioContext(2, 1, referenceSampleRate);
    return decodeCtx.decodeAudioData(arrayBuffer);
  })().catch((err) => {
    decodedBufferCache.delete(src);
    throw err;
  });

  decodedBufferCache.set(src, promise);
  return promise;
}

/** Clear the decoded-audio-buffer cache (e.g. on project load). */
export function clearExportAudioCache() {
  decodedBufferCache.clear();
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
 */
function resolveAudibleWindow(entity, entityMap, trackMap) {
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
  return end > start ? { start, end } : null;
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
 */
function collectAudioSources({ entities, exportStartTime, exportDuration, tracks = [] }) {
  const exportEndTime = exportStartTime + exportDuration;
  const entityMap = new Map((entities || []).map((e) => [e.id, e]));
  const trackMap = new Map((tracks || []).map((t) => [t.id, t]));
  const sources = [];

  for (const entity of entities) {
    const window = resolveAudibleWindow(entity, entityMap, trackMap);
    if (!window) continue;
    if (window.end <= exportStartTime || window.start >= exportEndTime) continue;

    const track = findEntityTrack(entity, tracks);
    if (resolveEffectiveVolume(1, track, tracks) <= 0) continue;

    const audioComp = entity.components?.find((c) => c.type === 'AudioSource');
    const videoComp = entity.components?.find((c) => c.type === 'VideoRenderer');

    if (audioComp && (audioComp.src || entity.src) && (audioComp.volume ?? 1) > 0) {
      sources.push({ entity, comp: audioComp, src: audioComp.src || entity.src, window });
    } else if (videoComp && videoComp.src && (videoComp.volume ?? 0) > 0) {
      sources.push({ entity, comp: videoComp, src: videoComp.src, window });
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
}) {
  const sources = collectAudioSources({ entities, exportStartTime, exportDuration, tracks });
  if (sources.length === 0) return null;

  const totalFrames = Math.max(1, Math.ceil(exportDuration * sampleRate));
  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);

  const decoded = await Promise.all(
    sources.map(async ({ entity, comp, src, window }) => {
      try {
        const buffer = await decodeAudioSource(src, sampleRate);
        return { entity, comp, buffer, window };
      } catch (err) {
        console.warn(`Export audio: failed to decode source for "${entity.name}":`, err);
        return null;
      }
    })
  );

  let scheduledAny = false;

  for (const item of decoded) {
    if (!item) continue;
    const { entity, comp, buffer, window } = item;

    // Effective rate = AudioSource.speed (content rate inside the clip) ×
    // Transform.speed (clip-level rate), matching how the live preview
    // computes media rate (EntityRenderer.jsx) and the video frame
    // provider's playbackRate. NOTE (Work C scope constraint): the mixdown
    // is ONE static render over the whole export window, so only the raw
    // component values can apply — a Transform.speed that is itself
    // keyframe-animated or script-driven can't be followed here. Video
    // frames and live preview resolve speed per frame; audio export uses
    // the static value. Volume goes through an (offline) GainNode below,
    // which — unlike HTMLMediaElement.volume — accepts boosts above 1.0
    // unchanged, so loud clips export loud.
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
    // export window, then map that back to a source-buffer offset via
    // mediaOffset + speed, exactly like scrubbing would.
    const entityStart = entity.startTime;
    const clipStart = Math.max(window.start, exportStartTime);
    const clipEnd = Math.min(window.end, exportStartTime + exportDuration);
    if (clipEnd <= clipStart) continue;

    const whenInMix = clipStart - exportStartTime;
    const localTimeAtClipStart = clipStart - entityStart;
    const sourceOffset = mediaOffset + localTimeAtClipStart * speed;
    const playDuration = (clipEnd - clipStart) * speed;

    if (sourceOffset >= buffer.duration) continue;
    // Seconds of SOURCE audio this clip consumes (buffer time, not real time).
    const sourceSeconds = Math.min(playDuration, buffer.duration - sourceOffset);
    if (sourceSeconds <= 0) continue;

    const bufferSource = offlineCtx.createBufferSource();

    if (Math.abs(speed - 1) < 1e-4) {
      bufferSource.buffer = buffer;
      // start(when, offset, duration): `duration` is in BUFFER seconds and is
      // independent of playbackRate (MDN) — at speed 1 it is also real time.
      bufferSource.start(whenInMix, sourceOffset, sourceSeconds);
    } else {
      // Preview plays media through HTMLMediaElement, which keeps the pitch
      // when playbackRate ≠ 1. AudioBufferSourceNode.playbackRate does NOT
      // (a 1.1x voice came out ~1.65 semitones high), and passing
      // `duration / speed` to start() cut the clip short (it's buffer time,
      // not real time). So time-stretch just the slice this clip uses
      // (pitch-preserving WSOLA, utils/timeStretch.js) and play the result
      // back at rate 1 — its length is already the real-time length.
      const sr = buffer.sampleRate;
      const from = Math.max(0, Math.floor(sourceOffset * sr));
      const to = Math.min(buffer.length, Math.ceil((sourceOffset + sourceSeconds) * sr));
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
    gainNode.gain.value = Math.max(0, volume);

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