import { useLayoutEffect, useEffect, useRef } from 'react';
import { getSharedGLTransitionRenderer } from '../../engine/glTransitions';
 
// Longest edge of the two letterboxed source canvases + GL pass. The preview
// does not need full project resolution; this keeps two 2D copies plus a GL
// pass per frame cheap while keeping the project aspect ratio exactly.
const MAX_BLEND_WIDTH = 1280;
 
/**
 * Letterbox one <video> into a W×H canvas (`object-fit: contain` on opaque
 * black) — the preview-side twin of fitVideoToFrameCanvas in exportRunner.js.
 * The GL renderer stretches each input to fill its output, so each side is
 * pre-fitted to the frame or clips of different aspect ratio would distort.
 */
function fitVideo(canvas, video, W, H) {
  if (!video || video.readyState < 2) return false;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const c = canvas.getContext('2d');
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  const mw = video.videoWidth || W;
  const mh = video.videoHeight || H;
  const s = Math.min(W / mw, H / mh);
  try {
    c.drawImage(video, (W - mw * s) / 2, (H - mh * s) / 2, mw * s, mh * s);
  } catch {
    return false;
  }
  return true;
}
 
/**
 * The single canvas drawn while a TransitionClip is active: clip A's frame as
 * `from`, clip B's frame as `to`, through the shared GL renderer at the
 * resolver's progress. A's and B's own <video> elements are kept mounted (but
 * hidden) by VideoLayer and seeked to the resolver's extended media times by
 * useMediaSync; this component only reads their current frame.
 *
 * Redraws on every render (playback / scrubbing re-render per tick) AND when
 * either video finishes a seek — a paused scrub lands the decoded frame AFTER
 * the render that requested it, so without the 'seeked' hook the canvas would
 * show the previous frame until the next unrelated re-render.
 */
export function TransitionBlendCanvas({ blend, videoRefs, safeResWidth, safeResHeight, zIndex }) {
  const { transition: t, transform } = blend;
  const canvasRef = useRef(null);
  const fromRef = useRef(null);
  const toRef = useRef(null);
  const latest = useRef(t);
  latest.current = t;
 
  const draw = () => {
    const el = canvasRef.current;
    const renderer = getSharedGLTransitionRenderer();
    if (!el || !renderer) return;
    const cur = latest.current;
    const scale = Math.min(1, MAX_BLEND_WIDTH / safeResWidth);
    const W = Math.max(1, Math.round(safeResWidth * scale));
    const H = Math.max(1, Math.round(safeResHeight * scale));
    if (!fromRef.current) {
      fromRef.current = document.createElement('canvas');
      toRef.current = document.createElement('canvas');
    }
    const va = cur.from ? videoRefs.current[cur.from.entity.id] : null;
    const vb = cur.to ? videoRefs.current[cur.to.entity.id] : null;
    const okA = fitVideo(fromRef.current, va, W, H);
    const okB = fitVideo(toRef.current, vb, W, H);
    if (!okA && !okB) return; // nothing decoded yet: keep the last drawn frame
    const rendered = renderer.render({
      from: okA ? fromRef.current : null,
      to: okB ? toRef.current : null,
      progress: cur.progress,
      presetId: cur.presetId,
      customGlsl: cur.customGlsl,
      params: cur.params,
      width: W,
      height: H,
    });
    if (el.width !== W) el.width = W;
    if (el.height !== H) el.height = H;
    const c2d = el.getContext('2d');
    if (c2d && rendered) {
      c2d.fillStyle = '#000';
      c2d.fillRect(0, 0, W, H);
      c2d.drawImage(rendered, 0, 0, W, H);
    }
  };
 
  useLayoutEffect(draw); // every render
 
  const idA = t.from?.entity.id;
  const idB = t.to?.entity.id;
  useEffect(() => {
    const els = [idA, idB].map((id) => (id ? videoRefs.current[id] : null)).filter(Boolean);
    let cancelled = false;
    let raf = 0;
 
    // Chromium can fire 'seeked' slightly BEFORE the new frame is presentable
    // to drawImage, so a single draw on the event can grab the stale frame —
    // and for a clip held on its last frame nothing else ever re-renders to
    // rescue it (measured: ~1 in 12 seeks past a file's end left the canvas
    // on the old frame permanently). So after the event, also redraw when
    // the browser presents its next video frame and on the next two
    // animation frames.
    const redrawSoon = (v) => {
      if (cancelled) return;
      draw();
      v.requestVideoFrameCallback?.(() => { if (!cancelled) draw(); });
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (cancelled) return;
        draw();
        raf = requestAnimationFrame(() => { if (!cancelled) draw(); });
      });
    };
 
    const handlers = els.map((v) => {
      const h = () => redrawSoon(v);
      v.addEventListener('seeked', h);
      v.addEventListener('loadeddata', h);
      return h;
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      els.forEach((v, i) => {
        v.removeEventListener('seeked', handlers[i]);
        v.removeEventListener('loadeddata', handlers[i]);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draw reads live refs; only the two element identities matter
  }, [idA, idB]);
 
  return (
    <div
      className="video-layer-container"
      data-transition-blend={t.entity.id}
      style={{
        transform: `translate(${transform.x || 0}px, ${transform.y || 0}px) rotate(${transform.rotation || 0}deg) scale(${transform.scaleX ?? 1}, ${transform.scaleY ?? 1})`,
        transformOrigin: `calc(50% + ${(transform.pivotX ?? 0) * safeResWidth}px) calc(50% + ${(transform.pivotY ?? 0) * safeResHeight}px)`,
        opacity: transform.opacity ?? 1,
        zIndex,
        pointerEvents: 'none',
      }}
    >
      <canvas ref={canvasRef} className="active-video-element" width={safeResWidth} height={safeResHeight} />
    </div>
  );
}