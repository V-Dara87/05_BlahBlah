import { trackKeyFor, getFieldKeyframes, setKeyframe } from '../engine/keyframes';
import '../components/preview/gizmo.css';

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
 * DRAG FEEDBACK (added on top of the original math, which is unchanged):
 *   - Move snaps to the canvas centre lines and (for clips with an authored
 *     width/height, at 0/90/180/270 degrees) to the canvas edges, with a guide
 *     line while snapped. Hold Ctrl/Cmd to disable snapping, Shift to lock the
 *     drag to one axis.
 *   - A small readout follows the cursor (X/Y, angle, or scale) while dragging.
 *   - The cursor stays put for the whole drag instead of flickering back to
 *     the default whenever the pointer leaves the small handle.
 *   The guides/readout are plain DOM nodes appended to the preview's own
 *   document for the duration of a drag (styles in components/preview/gizmo.css),
 *   so none of the JSX that renders the gizmo had to change.
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

/** How close (in SCREEN px) a dragged clip has to get before it snaps. */
const SNAP_PX = 6;

/**
 * Snap one axis. `pos` is the clip centre as an offset from the canvas centre
 * (the same space as Transform.x / y). Candidates: the canvas centre line, and,
 * when the clip's size along this axis is known, flush against either canvas
 * edge. `guide` is the canvas-space coordinate to draw the guide line at.
 */
export function snapAxis(pos, size, half, tol) {
  const targets = [{ value: 0, guide: 0 }];
  if (size > 0) {
    targets.push(
      { value: -half + size / 2, guide: -half },
      { value: half - size / 2, guide: half },
    );
  }
  let best = null;
  let bestDist = tol;
  for (const t of targets) {
    const d = Math.abs(pos - t.value);
    if (d <= bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best ? { value: best.value, guide: best.guide } : { value: pos, guide: null };
}

/**
 * Cursor lock + cursor-following readout + snap guides for one drag. Everything
 * it creates is removed by end(). Safe to call with no document (tests / SSR):
 * every method becomes a no-op.
 */
function createDragFeedback(doc, cursor) {
  const body = doc?.body || null;
  if (body) {
    body.classList.add('gizmo-dragging');
    body.style.setProperty('--gizmo-cursor', cursor);
  }
  let readout = null;
  const guides = { v: null, h: null };
  const makeEl = (cls) => {
    const el = doc.createElement('div');
    el.className = cls;
    body.appendChild(el);
    return el;
  };
  return {
    readout(text, clientX, clientY) {
      if (!body) return;
      if (!readout) readout = makeEl('gizmo-readout');
      readout.textContent = text;
      readout.style.transform = `translate(${clientX + 16}px, ${clientY + 16}px)`;
    },
    // axis 'v' = vertical line at x = pos, 'h' = horizontal line at y = pos.
    // pos === null hides it. `rect` is the preview frame's screen rect.
    guide(axis, pos, rect) {
      if (!body) return;
      if (pos == null || !rect) {
        guides[axis]?.remove();
        guides[axis] = null;
        return;
      }
      if (!guides[axis]) guides[axis] = makeEl(`gizmo-guide gizmo-guide--${axis}`);
      const el = guides[axis];
      if (axis === 'v') {
        el.style.left = `${pos}px`;
        el.style.top = `${rect.top}px`;
        el.style.height = `${rect.height}px`;
      } else {
        el.style.top = `${pos}px`;
        el.style.left = `${rect.left}px`;
        el.style.width = `${rect.width}px`;
      }
    },
    end() {
      readout?.remove();
      guides.v?.remove();
      guides.h?.remove();
      readout = null;
      guides.v = null;
      guides.h = null;
      if (body) {
        body.classList.remove('gizmo-dragging');
        body.style.removeProperty('--gizmo-cursor');
      }
    },
  };
}

const fmt1 = (n) => String(Math.round(n * 10) / 10);

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
      const existingAtTime = kfs.find((k) => Math.abs(k.time - snappedTime) < 1 / 60);
      // Blender/Spine behavior: only create keyframes if Auto-Key is ON, or editing an existing keyframe
      if (autoKeyEnabled || existingAtTime) {
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

  // Shared drag plumbing: window-level move/up/cancel listeners for one drag
  // `mode`, with the feedback UI torn down however the drag ends (pointerup OR
  // pointercancel, which the old per-handler code never listened for).
  const bindDrag = (mode, feedback, onMove) => {
    const handlePointerMove = (moveEvent) => {
      const drag = gizmoDragRef.current;
      if (!drag || drag.mode !== mode) return;
      onMove(moveEvent, drag);
    };
    const end = () => {
      gizmoDragRef.current = null;
      feedback.end();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  // Canvas-space point (offset from canvas centre, project px) -> screen px,
  // plus the preview frame's screen rect (for sizing the guide lines). Same
  // mapping the rotate handler uses for its pivot.
  const canvasToScreen = (gx, gy) => {
    const frameEl = canvasFrameRef.current;
    if (!frameEl) return null;
    const rect = frameEl.getBoundingClientRect();
    if (previewMode === 'extended') {
      const vt = viewTransformRef.current;
      const s = (frameScale || 1) * (vt.zoom || 1);
      return {
        rect,
        x: rect.left + vt.panX + (safeResWidth / 2 + gx) * s,
        y: rect.top + vt.panY + (safeResHeight / 2 + gy) * s,
      };
    }
    const s = frameScale || 1;
    return {
      rect,
      x: rect.left + rect.width / 2 + gx * s,
      y: rect.top + rect.height / 2 + gy * s,
    };
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

    // Snapping only when x/y really are offsets from the canvas centre: no
    // parent (local space) and no pivot offset (a pivot shifts where a scaled /
    // rotated clip's visual centre lands relative to x/y).
    const canSnap = !entity.parentId && !(transform.pivotX || transform.pivotY);
    // Clip box on screen-aligned axes, for edge snapping. Only known for clips
    // with an authored width/height (shapes, text boxes); video fills the
    // frame, so it gets centre snapping only. Rotated off-axis -> centre only.
    const authoredW = entity.components.find((c) => c.width)?.width || 0;
    const authoredH = entity.components.find((c) => c.height)?.height || 0;
    let boxW = authoredW * Math.abs(lx.scaleX ?? transform.scaleX ?? 1);
    let boxH = authoredH * Math.abs(lx.scaleY ?? transform.scaleY ?? 1);
    const rotMod = ((((lx.rotation ?? transform.rotation) || 0) % 180) + 180) % 180;
    if (Math.abs(rotMod - 90) < 0.5) {
      [boxW, boxH] = [boxH, boxW];
    } else if (rotMod > 0.5 && rotMod < 179.5) {
      boxW = 0;
      boxH = 0;
    }

    const feedback = createDragFeedback(canvasFrameRef.current?.ownerDocument || (typeof document !== 'undefined' ? document : null), 'move');
 
    gizmoDragRef.current = {
      mode: 'move',
      entityId: entity.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: lx.x ?? transform.x,
      startY: lx.y ?? transform.y,
      toLocal,
    };
 
    bindDrag('move', feedback, (moveEvent, drag) => {
      const scale = getScale() || 1;
      let dx = (moveEvent.clientX - drag.startClientX) / scale;
      let dy = (moveEvent.clientY - drag.startClientY) / scale;
      // Shift locks the drag to whichever axis the pointer has moved furthest on.
      if (moveEvent.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const local = drag.toLocal(dx, dy);
      let nextX = drag.startX + local.x;
      let nextY = drag.startY + local.y;

      let guideX = null;
      let guideY = null;
      if (canSnap && !(moveEvent.ctrlKey || moveEvent.metaKey)) {
        const tol = SNAP_PX / scale;
        const sx = snapAxis(nextX, boxW, safeResWidth / 2, tol);
        const sy = snapAxis(nextY, boxH, safeResHeight / 2, tol);
        nextX = sx.value;
        nextY = sy.value;
        guideX = sx.guide;
        guideY = sy.guide;
      }

      updateSelectedTransform(drag.entityId, { x: nextX, y: nextY });

      const at = (guideX != null || guideY != null) ? canvasToScreen(guideX ?? 0, guideY ?? 0) : null;
      feedback.guide('v', guideX != null && at ? at.x : null, at?.rect);
      feedback.guide('h', guideY != null && at ? at.y : null, at?.rect);
      feedback.readout(`X ${Math.round(nextX)}   Y ${Math.round(nextY)}`, moveEvent.clientX, moveEvent.clientY);
    });
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
    const feedback = createDragFeedback(frameEl.ownerDocument || document, 'grabbing');
 
    gizmoDragRef.current = {
      mode: 'rotate',
      entityId: entity.id,
      pivotX,
      pivotY,
      startAngle,
      startRotation: (localTransform ? localTransform.rotation : transform.rotation) || 0,
    };
 
    bindDrag('rotate', feedback, (moveEvent, drag) => {
      const angle = Math.atan2(moveEvent.clientY - drag.pivotY, moveEvent.clientX - drag.pivotX) * (180 / Math.PI);
      let nextRotation = drag.startRotation + (angle - drag.startAngle);
      // Shift snaps to 15-degree increments, same modifier convention as
      // most design tools (Figma, Unity's rotate gizmo with Shift held).
      if (moveEvent.shiftKey) nextRotation = Math.round(nextRotation / 15) * 15;
      updateSelectedTransform(drag.entityId, { rotation: nextRotation });
      feedback.readout(`${fmt1(nextRotation)}°`, moveEvent.clientX, moveEvent.clientY);
    });
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

    const cursor = corner === 'tl' || corner === 'br' ? 'nwse-resize' : 'nesw-resize';
    const feedback = createDragFeedback(canvasFrameRef.current?.ownerDocument || (typeof document !== 'undefined' ? document : null), cursor);
 
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
 
    bindDrag('scale', feedback, (moveEvent, drag) => {
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
      feedback.readout(
        `${Math.round(baseWidth * nextScaleX)} × ${Math.round(baseHeight * nextScaleY)} px   (${nextScaleX.toFixed(2)}× · ${nextScaleY.toFixed(2)}×)`,
        moveEvent.clientX,
        moveEvent.clientY,
      );
    });
  };
 
  return {
    handleMoveGizmoPointerDown,
    handleRotateGizmoPointerDown,
    handleScaleGizmoPointerDown,
  };
}