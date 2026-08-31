import { executeScriptComponent } from './scriptRunner';
import { updateCanvasComponent, unmountCanvasComponent } from './canvasRunner';
 
/**
 * P1 #11 — export-time equivalent of EntityRenderer.jsx's live preview.
 *
 * This file exists to be the actual home of the four functions
 * ExportModal.jsx already imports (drawExportFrame, createCanvasContainerPool,
 * createVideoFrameProvider, computeActiveEntitiesAtTime). Those were referenced
 * but never implemented — this was the missing piece that made export fail
 * immediately on module load.
 *
 * Everything here is a pure function of an explicit `time` argument, never
 * wall-clock/rAF, mirroring EntityRenderer.jsx's `computedEntities` memo and
 * its video-sync / CanvasRenderer-driving effects, but called synchronously
 * per exported frame instead of on a live render cycle.
 */
 
// ---------------------------------------------------------------------------
// Active-entity computation (mirrors EntityRenderer.jsx's computedEntities)
// ---------------------------------------------------------------------------
 
/**
 * Same filtering + transform logic as EntityRenderer.jsx's `computedEntities`
 * useMemo, but as a plain function driven by an explicit `time` instead of
 * component state. Returns [{ entity, transform, localTime }].
 */
export function computeActiveEntitiesAtTime({ entities, tracks, scripts = [], time, fps = 30 }) {
  const activeEntities = entities.filter((entity) => {
    if (!entity.active) return false;
    if (time < entity.startTime || time >= entity.startTime + entity.duration) {
      return false;
    }
    const track = tracks.find((t) => t.id === entity.trackId);
    if (track && (!track.visible || track.locked)) return false;
    return true;
  });
 
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
 
    const localTime = time - entity.startTime;
 
    if (scriptComp) {
      const scriptDef = scripts.find((s) => s.id === scriptComp.scriptId);
      if (scriptDef && scriptDef.code) {
        try {
          currentTransform = executeScriptComponent({
            scriptCode: scriptDef.code,
            transform: currentTransform,
            localTime,
            clipDuration: entity.duration,
            publicValues: scriptComp.props || {},
            frame: Math.round(localTime * fps),
            fps,
          });
        } catch (err) {
          // A broken motion script must not abort the whole export — fall
          // back to the untransformed transform for this frame, same
          // containment principle as EntityErrorBoundary for live preview.
          console.warn(`Export: motion script error on "${entity.name}":`, err);
        }
      }
    }
 
    return { entity, transform: currentTransform, localTime };
  });
}
 
// ---------------------------------------------------------------------------
// Offscreen <div> pool for CanvasRenderer entities
// ---------------------------------------------------------------------------
 
/**
 * CanvasRenderer scripts mount into a real DOM container (see canvasRunner.js
 * onMount({ container })), same as live playback. For export we need those
 * containers to exist, but never attached to the visible page — an offscreen
 * parent, positioned far off-canvas, holds one <div> per entity actively
 * using CanvasRenderer during this export run.
 */
export function createCanvasContainerPool() {
  const root = document.createElement('div');
  root.style.position = 'fixed';
  root.style.left = '-99999px';
  root.style.top = '-99999px';
  root.style.pointerEvents = 'none';
  document.body.appendChild(root);
 
  const containers = new Map(); // entityId -> HTMLDivElement
 
  return {
    /**
     * Get (creating if needed) the offscreen container for this entity.
     * Deliberately given NO explicit width/height: the live DOM's
     * `.canvas-render-container` has none either (see App.css) — it's a
     * plain, unsized <div> that shrinks to fit whatever the script's
     * onMount actually appends (e.g. CanvasOrbit.js's fixed 300x300
     * <canvas>). Forcing it to the full project resolution here (an
     * earlier version of this file did) made every CanvasRenderer render
     * at the wrong size/position, since the entity's Transform positions
     * this box by its own natural content size, not the frame size.
     */
    getContainer(entityId) {
      let el = containers.get(entityId);
      if (!el) {
        el = document.createElement('div');
        el.style.position = 'relative';
        el.style.display = 'inline-block';
        root.appendChild(el);
        containers.set(entityId, el);
      }
      return el;
    },
    /** Unmount + drop the container for an entity that's no longer active. */
    releaseContainer(entityId) {
      const el = containers.get(entityId);
      if (el) {
        unmountCanvasComponent(entityId);
        el.remove();
        containers.delete(entityId);
      }
    },
    /** Release every container not in the given still-active id set. */
    pruneExcept(activeEntityIds) {
      const activeSet = new Set(activeEntityIds);
      for (const entityId of containers.keys()) {
        if (!activeSet.has(entityId)) {
          this.releaseContainer(entityId);
        }
      }
    },
    disposeAll() {
      for (const entityId of Array.from(containers.keys())) {
        this.releaseContainer(entityId);
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
     */
    async seekTo(entityId, src, videoComp, localTime) {
      const video = videos.get(entityId) || (await this.preload(entityId, src));
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
 * Layer order: sorted by each entity's track position (a HIGHER track
 * index renders IN FRONT of lower ones — same convention as
 * EntityRenderer.jsx's live preview, see its trackZIndexOf comment).
 * Previously this always drew every video entity first, then every
 * overlay entity in plain array order, regardless of track — so moving a
 * clip to a higher or lower track had no effect on the exported stacking
 * order either, matching (and now fixing, alongside) the same bug in live
 * preview. Canvas paints in call order with later calls on top, so
 * ascending-by-track-index is exactly right: lowest track drawn first
 * (furthest back), highest track drawn last (frontmost).
 */
export function drawExportFrame({
  ctx,
  width,
  height,
  time,
  entities,
  tracks,
  scripts = [],
  fps = 30,
  canvasContainers,
  videoFrameProvider,
}) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
 
  const computed = computeActiveEntitiesAtTime({ entities, tracks, scripts, time, fps });
 
  const trackZIndexOf = (trackId) => {
    const idx = tracks.findIndex((t) => t.id === trackId);
    return idx === -1 ? 0 : idx + 1;
  };
 
  // Stable sort (by track order only) so entities on the same track keep
  // their original relative draw order.
  const drawOrder = computed
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => {
      const diff = trackZIndexOf(a.item.entity.trackId) - trackZIndexOf(b.item.entity.trackId);
      return diff !== 0 ? diff : a.originalIndex - b.originalIndex;
    })
    .map(({ item }) => item);
 
  for (const { entity, transform, localTime } of drawOrder) {
    const isVideo = entity.type === 'video' || entity.components.some((c) => c.type === 'VideoRenderer');
    const isAudio = entity.type === 'audio' || entity.components.some((c) => c.type === 'AudioSource');
    if (isAudio) continue;
 
    try {
      if (isVideo) {
        const videoComp = entity.components.find((c) => c.type === 'VideoRenderer') || { src: entity.src };
        const src = videoComp.src || entity.src;
        if (!src) continue;
        const video = videoFrameProvider.getVideoElement(entity.id);
        if (!video) continue;
        drawTransformedMedia(ctx, video, transform, width, height);
        continue;
      }
 
      const canvasComp = entity.components.find((c) => c.type === 'CanvasRenderer');
      const shapeComp = entity.components.find((c) => c.type === 'ShapeRenderer');
      const textComp = entity.components.find((c) => c.type === 'TextRenderer');
 
      if (canvasComp) {
        const scriptDef = scripts.find((s) => s.id === canvasComp.scriptId);
        if (scriptDef && scriptDef.code) {
          const container = canvasContainers.getContainer(entity.id);
          updateCanvasComponent({
            entityId: entity.id,
            scriptCode: scriptDef.code,
            container,
            localTime,
            frame: Math.round(localTime * fps),
            fps,
            props: canvasComp.props || {},
          });
          drawCanvasContainerContents(ctx, container, transform, width, height);
        }
      } else if (shapeComp) {
        drawShape(ctx, shapeComp, transform, width, height);
      } else if (textComp) {
        drawText(ctx, textComp, entity, transform, width, height);
      }
      // Note: ReactRenderer entities (arbitrary React component output) are
      // not rasterized in this pass — see the header comment in
      // ExportModal.jsx / roadmap P1.5 for the known gap. They're skipped
      // rather than crashing the export.
    } catch (err) {
      console.warn(`Export: render error on entity "${entity.name}":`, err);
    }
  }
 
  canvasContainers.pruneExcept(computed.map(({ entity }) => entity.id));
}
 
// ---------------------------------------------------------------------------
// Drawing helpers — translate the same transform math EntityRenderer.jsx
// applies via CSS transform/opacity into direct canvas 2D drawing.
// ---------------------------------------------------------------------------
 
function applyTransform(ctx, transform, width, height) {
  const cx = width / 2 + (transform.x || 0);
  const cy = height / 2 + (transform.y || 0);
  ctx.translate(cx, cy);
  ctx.rotate(((transform.rotation || 0) * Math.PI) / 180);
  ctx.scale(transform.scaleX ?? 1, transform.scaleY ?? 1);
  ctx.globalAlpha = Math.max(0, Math.min(1, transform.opacity ?? 1));
}
 
function drawTransformedMedia(ctx, mediaEl, transform, width, height) {
  const mw = mediaEl.videoWidth || width;
  const mh = mediaEl.videoHeight || height;
  // Cover-fit into the full frame, matching the live preview's full-bleed
  // background video behavior.
  const scale = Math.max(width / mw, height / mh);
  const drawW = mw * scale;
  const drawH = mh * scale;
 
  ctx.save();
  applyTransform(ctx, transform, width, height);
  try {
    ctx.drawImage(mediaEl, -drawW / 2, -drawH / 2, drawW, drawH);
  } catch (err) {
    console.warn('Export: failed to draw video frame:', err);
  }
  ctx.restore();
}
 
function drawShape(ctx, shapeComp, transform, width, height) {
  const w = shapeComp.width || 180;
  const h = shapeComp.height || 180;
 
  ctx.save();
  applyTransform(ctx, transform, width, height);
 
  ctx.fillStyle = shapeComp.color || '#ffffff';
  const isCircle = shapeComp.shapeType === 'circle';
  const radius = isCircle ? Math.min(w, h) / 2 : shapeComp.borderRadius ?? 0;
 
  drawRoundedRectPath(ctx, -w / 2, -h / 2, w, h, isCircle ? Math.min(w, h) / 2 : radius);
  ctx.fill();
 
  if (shapeComp.strokeWidth) {
    ctx.lineWidth = shapeComp.strokeWidth;
    ctx.strokeStyle = shapeComp.strokeColor || '#38bdf8';
    ctx.stroke();
  }
 
  ctx.restore();
 
  void radius; // isCircle path already picks the right radius above
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
 
function drawText(ctx, textComp, entity, transform, width, height) {
  const text = textComp.text || entity.name || '';
  const fontSize = textComp.fontSize || 38;
  const fontFamily = textComp.fontFamily || 'Inter, sans-serif';
 
  ctx.save();
  applyTransform(ctx, transform, width, height);
 
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
 
  if (textComp.shadowColor) {
    ctx.shadowColor = textComp.shadowColor;
    ctx.shadowBlur = textComp.shadowBlur || 14;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
  }
 
  ctx.fillStyle = textComp.fontColor || '#ffffff';
  ctx.fillText(text, 0, 0);
 
  ctx.restore();
}
 
/**
 * CanvasRenderer scripts draw into arbitrary DOM/canvas/WebGL content inside
 * their mounted container. If the script's own root element is a <canvas>
 * (the common case — raw Canvas2D/Three.js/WebGL all render to one), that
 * canvas's pixels are drawn directly. Anything else (DOM-only output from a
 * script) is skipped for rasterization rather than attempted with an
 * html-to-canvas approximation, since that's out of scope for Phase 1.
 */
function drawCanvasContainerContents(ctx, container, transform, width, height) {
  const innerCanvas = container.querySelector('canvas');
  if (!innerCanvas) return;
 
  ctx.save();
  applyTransform(ctx, transform, width, height);
  try {
    ctx.drawImage(innerCanvas, -innerCanvas.width / 2, -innerCanvas.height / 2, innerCanvas.width, innerCanvas.height);
  } catch (err) {
    console.warn('Export: failed to draw CanvasRenderer output:', err);
  }
  ctx.restore();
}