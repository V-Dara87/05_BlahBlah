import { Fragment } from 'react';
import { EntityErrorBoundary } from '../entity/EntityErrorBoundary';
import { getSharedGLTransitionRenderer } from '../../engine/glTransitions';
import './video-layer.css';
 
/**
 * Background video layer — one <video> (plus an optional GL-transition
 * <canvas> overlay) per active video entity, with its selection outline +
 * rotate/scale gizmo. Pulled out of EntityRenderer.jsx's JSX return, where
 * this was the `activeVideoItems.map(...)` block.
 *
 * Video has no authored width/height component (it fills the frame via
 * object-fit: contain at its own native aspect ratio, unknown until the
 * <video> element's metadata loads) — so unlike a shape/text entity,
 * there's no per-entity "base size" for the scale gizmo to work from. The
 * project's own resolution (baseWidth/baseHeight) is the base box instead:
 * Scale=1 already means "fills the frame" for video.
 */
export function VideoLayer({
  items,
  selectedEntityId,
  onSelectEntity,
  onUpdateEntity,
  videoRefs,
  isPlaying,
  currentTime,
  safeResWidth,
  safeResHeight,
  layerZIndexOf,
  handleMoveGizmoPointerDown,
  handleRotateGizmoPointerDown,
  handleScaleGizmoPointerDown,
}) {
  return items.map((item) => {
    const { entity, transform, localTransform, transitionState } = item;
    const isSelected = entity.id === selectedEntityId;
    const videoComp = entity.components.find((c) => c.type === 'VideoRenderer') || { src: entity.src };
    const vidSrc = videoComp.src || entity.src;
    // Mount-time seek target: raw (un-keyframed) clip rate, since this
    // runs before the sync effect resolves keyframes at the current time
    // — the per-tick effect corrects any difference.
    const rawClipSpeed =
      (videoComp.speed || 1) *
      ((entity.components || []).find((c) => c.type === 'Transform')?.speed ?? 1);
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
          // Unified with the overlay layer: both use the same
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
          // convention as the overlay layer's gizmo-draggable clips — a
          // video clip only becomes directly draggable once it's
          // already the selected entity.
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
                      // Render at the VIDEO's own native resolution (not
                      // the project's safeResWidth/Height) so the GL
                      // pass doesn't stretch the frame to a different
                      // aspect ratio than the plain <video> element
                      // uses. object-fit: contain below then letterboxes
                      // it identically to .active-video-element, so
                      // nothing visibly shifts the instant a transition
                      // starts.
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
                // transition frame is letterboxed/centered exactly like
                // the video it's temporarily replacing.
                objectFit: 'contain',
                pointerEvents: 'none',
              }}
            />
          )}
        </EntityErrorBoundary>
      </div>
 
      {/* Selection outline + rotate/scale gizmo for the selected video
          clip — same .preview-selection-gizmo overlay the overlay-items
          layer uses, and for the same reason: it's a SIBLING of
          .video-layer-container, not a child, so it never inherits that
          container's own `scale(scaleX, scaleY)`. .video-layer-container
          itself is a full-frame (100%/100%) flex box that centers the
          <video> inside it, so translate(x, y) on IT moves that whole
          box and its centered content together, landing the video's
          on-screen center at frame-center + (x, y) — same final point
          the overlay layer's entities land at via calc(-50% + x). This
          gizmo div, though, is sized to the entity's actual rendered box
          (not 100%/100%) and anchored via CSS at frame-center
          (top:50%/left:50%, see .preview-selection-gizmo), so it needs
          that same `calc(-50% + x)` self-centering term the overlay
          gizmo uses — without it, the box's top-left corner (not its
          center) lands on frame-center + (x, y), which is the bug a
          screenshot caught: the outline sat offset down-right of the
          actual video instead of surrounding it. Sized to the project's
          own resolution (baseWidth/baseHeight = safeResWidth/Height)
          since a video clip's "base size" at Scale=1 is the whole frame,
          not a per-entity authored width/height. */}
      {isSelected && onUpdateEntity && (
        <div
          className="preview-selection-gizmo"
          style={{
            // Same self-centering `-50%` term the overlay-items gizmo
            // uses: .preview-selection-gizmo is anchored via CSS at
            // top:50%/left:50% of the parent (frame center), so
            // translate(x, y) ALONE lands this box's own TOP-LEFT corner
            // at frame-center + (x, y) — the box then extends further
            // down-right from there instead of being centered on that
            // point. Subtracting half its own width/height first
            // (`calc(-50% + x)`) is what actually centers the box
            // itself on frame-center + (x, y), matching where the
            // video's own on-screen center really is.
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
  });
}
 