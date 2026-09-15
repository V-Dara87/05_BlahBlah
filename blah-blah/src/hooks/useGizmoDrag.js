import { trackKeyFor, getFieldKeyframes, setKeyframe } from '../engine/keyframes';
 
/**
 * useGizmoDrag — the three preview-canvas gizmo drag handlers (move /
 * rotate / scale) plus the keyframe-aware transform writer they all funnel
 * through.
 *
 * Extracted from EntityRenderer.jsx. This slice reads the live entity list
 * and the preview viewport's screen-to-project scale (frameScale +
 * extended-mode zoom, from hooks/usePreviewViewport.js) to convert
 * pointer-drag deltas into project-space Transform updates, going through
 * `onUpdateEntity` — auto-keying onto the playhead when the field already
 * has keyframes or Auto Key is on, writing a static value otherwise.
 *
 * A faithful move: no logic changes, no signature changes. These were
 * plain (non-memoized) functions in EntityRenderer already, so they stay
 * plain here too — same re-creation-every-render behavior as before.
 *
 * @param {object} args
 * @param {Array}    args.entities
 * @param {Function} args.onUpdateEntity
 * @param {Function} args.onSelectEntity
 * @param {Array}    args.computedEntities   this render's active/positioned
 *   entities (used to resolve a dragged entity's parent transform for
 *   local-space conversion)
 * @param {number}   args.currentTime
 * @param {number}   args.fps
 * @param {boolean}  args.autoKeyEnabled
 * @param {object}   args.resolution         raw project resolution (safe
 *   fallback applied internally, matching EntityRenderer's own
 *   safeResWidth/safeResHeight)
 * @param {object}   args.fallbackResolution default resolution to fall
 *   back to when `resolution` is missing/invalid (EntityRenderer's
 *   FALLBACK_RESOLUTION)
 * @param {object}   args.viewportRefs       the subset of usePreviewViewport's
 *   return value the gizmos need: { canvasFrameRef, frameScale,
 *   previewMode, viewTransformRef }
 * @param {object}   args.gizmoDragRef       ref shared across all three
 *   handlers to track the in-progress drag (owned by EntityRenderer, same
 *   ref instance used for both move/rotate/scale so only one drag mode can
 *   be active at a time)
 */
export function useGizmoDrag({
  entities,
  onUpdateEntity,
  onSelectEntity,
  computedEntities,
  currentTime,
  fps,
  autoKeyEnabled,
  resolution,
  fallbackResolution,
  viewportRefs,
  gizmoDragRef,
}) {
  const { canvasFrameRef, frameScale, previewMode, viewTransformRef } = viewportRefs;
 
  const safeResWidth = resolution?.width > 0 ? resolution.width : fallbackResolution.width;
  const safeResHeight = resolution?.height > 0 ? resolution.height : fallbackResolution.height;
 
  const localTime = selectedEntity => Math.max(0, currentTime - selectedEntity.startTime);
  const snapToFrame = (t) => Math.round(t * fps) / fps;
 
  const updateSelectedTransform = (entityId, updates) => {
    if (!onUpdateEntity) return;
    const entity = entities.find((e) => e.id === entityId);
    if (!entity) return;
    const trackKey = trackKeyFor({ type: 'Transform' });
    const snappedTime = snapToFrame(localTime(entity));
 
    const staticUpdates = {};
    let keyframesSnapshot = entity.keyframes || {};
    let keyframesChanged = false;
 
    Object.entries(updates).forEach(([fieldName, value]) => {
      const kfs = getFieldKeyframes({ ...entity, keyframes: keyframesSnapshot }, trackKey, fieldName);
      if (kfs.length > 0 || autoKeyEnabled) {
        keyframesSnapshot = setKeyframe({ ...entity, keyframes: keyframesSnapshot }, trackKey, fieldName, snappedTime, value);
        keyframesChanged = true;
      } else {
        staticUpdates[fieldName] = value;
      }
    });
 
    const patch = {};
    if (keyframesChanged) patch.keyframes = keyframesSnapshot;
    if (Object.keys(staticUpdates).length > 0) {
      const hasTransform = entity.components.some((c) => c.type === 'Transform');
      patch.components = hasTransform
        ? entity.components.map((c) => (c.type === 'Transform' ? { ...c, ...staticUpdates } : c))
        : [{ type: 'Transform', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, ...staticUpdates }, ...entity.components];
    }
    if (Object.keys(patch).length > 0) onUpdateEntity(entityId, patch);
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
 
  const handleRotateGizmoPointerDown = (e, entity, transform, localTransform, baseWidth = 0, baseHeight = 0) => {
    if (!onUpdateEntity) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectEntity(entity.id);
 
    const frameEl = canvasFrameRef.current;
    if (!frameEl) return;
    const frameRect = frameEl.getBoundingClientRect();
    // Rotation pivot is the entity's pivot point on screen. In normal
    // mode the entities layer is centered in the frame at scale
    // frameScale, so screen center = frame center + entity pos * scale.
    // In extended mode the layer is instead pinned to the frame's
    // top-left and offset/scaled by pan/zoom (see the transform on
    // .preview-entities-layer + the zoom-to-cursor math in the wheel
    // handler above), so the pivot has to go through that same mapping
    // instead of assuming frame-centered placement -- otherwise a
    // panned/zoomed rotate grabs the wrong pivot and the clip visibly
    // swings from the wrong point.
    //
    // pivotOffsetX/Y: normalized pivot → frame-space pixel offset from
    // entity center. Default (0, 0) → 0, 0 → identical to old behavior.
    const pivotOffsetX = (transform.pivotX ?? 0) * baseWidth;
    const pivotOffsetY = (transform.pivotY ?? 0) * baseHeight;
    let pivotX;
    let pivotY;
    if (previewMode === 'extended') {
      const vt = viewTransformRef.current;
      const scale = (frameScale || 1) * (vt.zoom || 1);
      const originX = safeResWidth / 2 + transform.x + pivotOffsetX;
      const originY = safeResHeight / 2 + transform.y + pivotOffsetY;
      pivotX = frameRect.left + vt.panX + originX * scale;
      pivotY = frameRect.top + vt.panY + originY * scale;
    } else {
      const scale = frameScale || 1;
      pivotX = frameRect.left + frameRect.width / 2 + (transform.x + pivotOffsetX) * scale;
      pivotY = frameRect.top + frameRect.height / 2 + (transform.y + pivotOffsetY) * scale;
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
 
  return {
    handleMoveGizmoPointerDown,
    handleRotateGizmoPointerDown,
    handleScaleGizmoPointerDown,
  };
}