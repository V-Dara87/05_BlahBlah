import { Fragment } from 'react';
import { getCompiledReactComponent, detectScriptKind, extractScriptProps } from '../../engine/scriptRunner';
import { resolveScriptProps } from '../../engine/referenceTypes';
import { resolveTextRendererText, cssFontFamily, DEFAULT_TEXT_FONT_SIZE, DEFAULT_TEXT_FONT_COLOR, DEFAULT_TEXT_FONT_FAMILY, DEFAULT_TEXT_FONT_WEIGHT } from '../../engine/textRenderer';
import { isScriptComponent } from '../../engine/ecs';
import { EntityErrorBoundary } from '../entity/EntityErrorBoundary';
import { ScriptGizmoOverlay } from './ScriptGizmoOverlay';
import './overlay-layer.css';
 
/**
 * Foreground overlay layer — every non-video, non-audio active entity:
 * Script (react/canvas-kind), Text, and Shape components, plus each
 * selected entity's rotate/scale gizmo. Pulled out of EntityRenderer.jsx's
 * JSX return, where this was the `activeOverlayItems.map(...)` block.
 *
 * Trickiest of the preview-layer extractions (per the roadmap) because the
 * gizmo overlay is a SIBLING of the rendered content div, not a child of
 * it — see the comment on `.preview-selection-gizmo` below for why that
 * matters for the transform math. Kept together in one component rather
 * than split further so that relationship stays obvious at a glance.
 */
export function OverlayLayer({
  items,
  selectedEntityId,
  onSelectEntity,
  onUpdateEntity,
  entities,
  scripts,
  mediaAssets,
  currentTime,
  fps,
  safeResWidth,
  safeResHeight,
  layerZIndexOf,
  canvasContainerRefs,
  handleMoveGizmoPointerDown,
  handleRotateGizmoPointerDown,
  handleScaleGizmoPointerDown,
  autoKeyEnabled = false,
}) {
  return items.map((item) => {
    const { entity, transform, localTransform } = item;
    const isSelected = entity.id === selectedEntityId;
    const textComp = entity.components.find((c) => c.type === 'TextRenderer');
    const displayText = textComp
      ? resolveTextRendererText(textComp, entity, entities, currentTime)
      : '';
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
    // imperatively by hooks/useCanvasScriptDriver.js. Motion scripts
    // affect only the Transform (already applied by
    // computeActiveEntitiesAtTime) and render nothing here.
    const scriptComps = (entity.components || []).filter(
      (c) => isScriptComponent(c) && c.enabled !== false
    );
    // Name the boundary after the script(s) it wraps, so a render crash is
    // reported in the Console against the script that caused it.
    const boundaryScriptName = scriptComps
      .map((c) => scripts.find((s) => s.id === c.scriptId)?.name || c.scriptName)
      .filter(Boolean)
      .join(', ');
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
          // Shift rotation/scale origin to the pivot point. Same
          // formula as the video layer: pivotX/Y normalized × baseSize
          // gives the pixel offset from element center. Default 0,0 →
          // no offset → identical behavior to before.
          transformOrigin: `calc(50% + ${(transform.pivotX ?? 0) * baseWidth}px) calc(50% + ${(transform.pivotY ?? 0) * baseHeight}px)`,
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
          scriptName={boundaryScriptName || undefined}
          resetKey={scriptComps.map((c) => c.scriptId).join(',')}
        >
          {/* React-kind component renderer */}
          {ReactComponentNodes}
 
          {/* Canvas-kind mount targets. The actual drawing happens
              imperatively inside engine/canvasRunner.js via
              onMount/onUpdate against these <div>s (driven by
              hooks/useCanvasScriptDriver.js); React only owns
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
                  }
                }}
              />
            );
          })}

          {/* Canvas Script Gizmo Overlay for interactive parameter/object editing */}
          {isSelected && scriptComps.length > 0 && onUpdateEntity && (
            <ScriptGizmoOverlay
              entity={entity}
              scripts={scripts}
              isSelected={isSelected}
              currentTime={currentTime}
              fps={fps}
              autoKeyEnabled={autoKeyEnabled}
              safeResWidth={safeResWidth}
              safeResHeight={safeResHeight}
              onUpdateEntity={onUpdateEntity}
            />
          )}
 
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
                fontSize: `${textComp.fontSize || DEFAULT_TEXT_FONT_SIZE}px`,
                color: textComp.fontColor || DEFAULT_TEXT_FONT_COLOR,
                fontFamily: cssFontFamily(textComp.fontFamily || DEFAULT_TEXT_FONT_FAMILY),
                fontWeight: textComp.fontWeight || DEFAULT_TEXT_FONT_WEIGHT,
                textShadow: textComp.shadowColor
                  ? `0 0 ${textComp.shadowBlur || 14}px ${textComp.shadowColor}`
                  : '0 3px 12px rgba(0,0,0,0.9)',
              }}
            >
              {displayText}
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
            // Same pivot origin as the content layer above so the
            // gizmo outline and the content element rotate around
            // the same world-space point.
            transformOrigin: `calc(50% + ${(transform.pivotX ?? 0) * baseWidth}px) calc(50% + ${(transform.pivotY ?? 0) * baseHeight}px)`,
            width: `${baseWidth * (transform.scaleX || 1)}px`,
            height: `${baseHeight * (transform.scaleY || 1)}px`,
            zIndex: 1000 + 100 + layerZIndexOf(item),
          }}
        >
          {/* Rotate handle — small circle above the clip, drag to
              rotate around the clip's pivot point. */}
          <div className="gizmo-rotate-stem" />
          <div
            className="gizmo-rotate-handle"
            title="Drag to rotate (hold Shift to snap to 15°)"
            onPointerDown={(e) => handleRotateGizmoPointerDown(e, entity, transform, localTransform, baseWidth, baseHeight)}
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
  });
}