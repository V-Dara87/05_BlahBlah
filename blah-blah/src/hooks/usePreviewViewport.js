import { useEffect, useRef, useState } from 'react';
 
const FALLBACK_RESOLUTION = { width: 1920, height: 1080 };
 
/**
 * usePreviewViewport — frame-fit measurement + extended-mode pan/zoom for
 * the preview canvas.
 *
 * Extracted from EntityRenderer.jsx: two closely related concerns that
 * don't touch entity rendering or gizmo drag math at all, only the size
 * and on-screen transform of the preview frame itself:
 *   - Coordinate-system fix: entities are authored in literal
 *     project-resolution px (matching export's canvas), but the preview
 *     frame renders at whatever on-screen size fits the dock panel. This
 *     tracks that ratio (`frameScale`) via a ResizeObserver so a single
 *     CSS `scale(frameScale)` on the entities wrapper makes everything
 *     fit without touching any entity's own x/y/width math.
 *   - Extended mode navigation: Alt+right-drag to pan, Ctrl+scroll to
 *     zoom, only active while `previewMode === 'extended'`. Native DOM
 *     listeners (not onWheel/onContextMenu React props) because zoom
 *     needs `{ passive: false }` to preventDefault page-scroll, and pan
 *     needs to preventDefault the context menu only for the duration of
 *     a right-drag.
 *
 * `frameScale` and `viewTransformRef` are read by the gizmo drag handlers
 * (still in EntityRenderer.jsx) to convert screen-px deltas to
 * project-px — see the comments there on why a ref (not the closed-over
 * `viewTransform` state) is used mid-drag.
 *
 * A faithful move: no logic changes. `resolution` is normalized to
 * FALLBACK_RESOLUTION internally so callers can keep passing the raw
 * (possibly 0x0) project resolution, matching the original component's
 * own safeResWidth/safeResHeight fallback.
 */
export function usePreviewViewport({ resolution }) {
  const viewportBoxRef = useRef(null);
  const canvasFrameRef = useRef(null);
 
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
 
  return {
    viewportBoxRef,
    canvasFrameRef,
    frameDimensions,
    frameScale,
    previewMode,
    setPreviewMode,
    viewTransform,
    viewTransformRef,
    isPanning,
  };
}