import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getMountedCanvasInstance } from '../../engine/canvasRunner.js';
import { extractScriptProps } from '../../engine/scriptRunner.js';
import { isScriptComponent } from '../../engine/ecs.js';
import { resolveScriptGizmos, updateGizmoProperty, gizmoToCanvasCoords } from '../../engine/gizmoEngine.js';
import './script-gizmo-overlay.css';

/**
 * ScriptGizmoOverlay renders interactive visual handles (gizmos) over
 * Canvas-kind scripts in the preview viewport.
 *
 * Supports:
 * - Single gizmo selection & drag
 * - Multi-gizmo selection (Shift+Click) & unified drag
 * - Marquee (Rubberband box) selection across multiple objects
 * - Axis-constrained dragging (axes: 'x' | 'y' | 'xy')
 * - Numerical HUD showing current coordinates & delta
 * - Auto-Keying integration (records keyframe if enabled or existing keyframes exist)
 * - Right-click context menus for custom object actions
 */
export function ScriptGizmoOverlay({
  entity,
  scripts = [],
  isSelected = false,
  currentTime = 0,
  fps = 30,
  autoKeyEnabled = false,
  safeResWidth = 1920,
  safeResHeight = 1080,
  onUpdateEntity,
}) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [hudState, setHudState] = useState(null); // { x, y, title, valX, valY, dx, dy }
  const [marquee, setMarquee] = useState(null); // { startX, startY, currentX, currentY }
  const [contextMenu, setContextMenu] = useState(null); // { x, y, items, gizmo }

  const containerRef = useRef(null);
  const dragSessionRef = useRef(null);

  // Find canvas-kind script components on this entity
  const components = entity?.components;
  const scriptComponents = useMemo(() => {
    if (!isSelected || !components) return [];
    return components.filter((c) => isScriptComponent(c) && c.enabled !== false && c.scriptId);
  }, [isSelected, components]);

  // Resolve all gizmos across attached canvas scripts
  const gizmos = useMemo(() => {
    if (scriptComponents.length === 0) return [];
    const allGizmos = [];

    scriptComponents.forEach((comp) => {
      const scriptDef = scripts.find((s) => s.id === comp.scriptId);
      if (!scriptDef?.code) return;

      const instance = getMountedCanvasInstance(entity.id, comp.scriptId);
      const schema = extractScriptProps(scriptDef.code);
      const localTime = Math.max(0, currentTime - (entity.startTime || 0));

      const resolved = resolveScriptGizmos({
        instance,
        schema,
        props: comp.props || {},
        canvasWidth: safeResWidth,
        canvasHeight: safeResHeight,
        time: localTime,
      });

      resolved.forEach((g) => {
        allGizmos.push({
          ...g,
          scriptId: comp.scriptId,
          instance,
        });
      });
    });

    return allGizmos;
  }, [scriptComponents, scripts, entity.id, entity.startTime, currentTime, safeResWidth, safeResHeight]);

  // Dismiss context menu on global click or Escape
  useEffect(() => {
    const handleDown = (e) => {
      if (!e.target.closest('.script-gizmo-context-menu')) {
        setContextMenu(null);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setSelectedIds(new Set());
      }
    };
    window.addEventListener('pointerdown', handleDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointerdown', handleDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, []);

  // Helper to convert client pointer coords to canvas resolution coords
  const screenToCanvasCoords = useCallback((clientX, clientY) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const normX = (clientX - rect.left) / rect.width;
    const normY = (clientY - rect.top) / rect.height;
    return {
      x: normX * safeResWidth,
      y: normY * safeResHeight,
    };
  }, [safeResWidth, safeResHeight]);

  // Handle pointer down on background (Marquee / Box selection)
  const handleBackgroundPointerDown = useCallback((e) => {
    if (e.button !== 0) return; // Only primary button
    e.stopPropagation();
    setContextMenu(null);

    const start = screenToCanvasCoords(e.clientX, e.clientY);
    const isShift = e.shiftKey;

    if (!isShift) {
      setSelectedIds(new Set());
    }

    const handlePointerMove = (moveEvt) => {
      const current = screenToCanvasCoords(moveEvt.clientX, moveEvt.clientY);
      setMarquee({
        startX: start.x,
        startY: start.y,
        currentX: current.x,
        currentY: current.y,
      });

      // Compute intersected gizmos
      const left = Math.min(start.x, current.x);
      const right = Math.max(start.x, current.x);
      const top = Math.min(start.y, current.y);
      const bottom = Math.max(start.y, current.y);

      const nextSelection = new Set(isShift ? selectedIds : []);
      gizmos.forEach((g) => {
        const cpos = gizmoToCanvasCoords(g, safeResWidth, safeResHeight);
        if (cpos.x >= left && cpos.x <= right && cpos.y >= top && cpos.y <= bottom) {
          nextSelection.add(g.id);
        }
      });
      setSelectedIds(nextSelection);
    };

    const handlePointerUp = () => {
      setMarquee(null);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [screenToCanvasCoords, gizmos, selectedIds]);

  // Handle pointer down on a specific gizmo
  const handleGizmoPointerDown = useCallback((e, gizmo, axisLock = null) => {
    if (e.button !== 0) return; // Only primary button
    e.stopPropagation();
    e.preventDefault();
    setContextMenu(null);

    const isShift = e.shiftKey;
    let activeIds = new Set(selectedIds);

    if (isShift) {
      if (activeIds.has(gizmo.id)) {
        activeIds.delete(gizmo.id);
      } else {
        activeIds.add(gizmo.id);
      }
    } else {
      if (!activeIds.has(gizmo.id)) {
        activeIds = new Set([gizmo.id]);
      }
    }
    setSelectedIds(activeIds);

    // Initial drag positions of all selected gizmos
    const initialPositions = new Map();
    gizmos.forEach((g) => {
      if (activeIds.has(g.id)) {
        initialPositions.set(g.id, { x: g.x, y: g.y, gizmo: g });
      }
    });

    const startCoord = screenToCanvasCoords(e.clientX, e.clientY);
    const effectiveAxes = axisLock || gizmo.axes || 'xy';

    dragSessionRef.current = {
      startCoord,
      initialPositions,
      effectiveAxes,
      hasMoved: false,
    };

    const handlePointerMove = (moveEvt) => {
      const session = dragSessionRef.current;
      if (!session) return;

      const currentCoord = screenToCanvasCoords(moveEvt.clientX, moveEvt.clientY);
      let dx = currentCoord.x - session.startCoord.x;
      let dy = currentCoord.y - session.startCoord.y;

      // Axis constraint (supports local rotation if gizmo has rotation)
      const rotDeg = gizmo.rotation || 0;
      if (rotDeg !== 0) {
        const rotRad = (rotDeg * Math.PI) / 180;
        const cosR = Math.cos(rotRad);
        const sinR = Math.sin(rotRad);

        if (session.effectiveAxes === 'x') {
          const proj = dx * cosR + dy * sinR;
          dx = proj * cosR;
          dy = proj * sinR;
        } else if (session.effectiveAxes === 'y') {
          const proj = -dx * sinR + dy * cosR;
          dx = -proj * sinR;
          dy = proj * cosR;
        } else if (moveEvt.shiftKey) {
          const projX = dx * cosR + dy * sinR;
          const projY = -dx * sinR + dy * cosR;
          if (Math.abs(projX) > Math.abs(projY)) {
            dx = projX * cosR;
            dy = projX * sinR;
          } else {
            dx = -projY * sinR;
            dy = projY * cosR;
          }
        }
      } else {
        if (session.effectiveAxes === 'x') {
          dy = 0;
        } else if (session.effectiveAxes === 'y') {
          dx = 0;
        } else if (moveEvt.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) {
            dy = 0;
          } else {
            dx = 0;
          }
        }
      }

      session.hasMoved = true;

      // Show HUD
      const isMulti = session.initialPositions.size > 1;
      const targetGizmoPos = session.initialPositions.get(gizmo.id);
      const newTargetX = Math.round(targetGizmoPos.x + dx);
      const newTargetY = Math.round(targetGizmoPos.y + dy);

      setHudState({
        screenX: moveEvt.clientX,
        screenY: moveEvt.clientY,
        title: isMulti ? `${session.initialPositions.size} Items Selected` : (gizmo.label || 'Point'),
        valX: newTargetX,
        valY: newTargetY,
        dx: Math.round(dx),
        dy: Math.round(dy),
        axes: session.effectiveAxes,
        isLocal: gizmo.space === 'local',
        rotation: rotDeg,
      });

      // Apply updates to all selected gizmos
      let accumulatedPatch = null;
      let currentEntityState = entity;

      session.initialPositions.forEach(({ x: initX, y: initY, gizmo: targetGizmo }) => {
        const targetAxes = axisLock || targetGizmo.axes || 'xy';
        const finalX = targetAxes === 'y' ? initX : Math.round(initX + dx);
        const finalY = targetAxes === 'x' ? initY : Math.round(initY + dy);

        const patch = updateGizmoProperty({
          entity: currentEntityState,
          scriptId: targetGizmo.scriptId,
          gizmo: targetGizmo,
          newX: finalX,
          newY: finalY,
          dx,
          dy,
          autoKeyEnabled,
          currentTime,
          fps,
          instance: targetGizmo.instance,
        });

        if (patch) {
          accumulatedPatch = {
            ...accumulatedPatch,
            ...patch,
            components: patch.components || accumulatedPatch?.components,
            keyframes: patch.keyframes || accumulatedPatch?.keyframes,
          };
          currentEntityState = { ...currentEntityState, ...accumulatedPatch };
        }
      });

      if (accumulatedPatch && onUpdateEntity) {
        onUpdateEntity(entity.id, accumulatedPatch);
      }
    };

    const handlePointerUp = () => {
      setHudState(null);
      dragSessionRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [selectedIds, gizmos, screenToCanvasCoords, entity, autoKeyEnabled, currentTime, fps, onUpdateEntity]);

  // Context Menu handler on gizmo
  const handleGizmoContextMenu = useCallback((e, gizmo) => {
    e.preventDefault();
    e.stopPropagation();

    const items = [];

    // Custom items defined on gizmo
    if (Array.isArray(gizmo.contextMenu) && gizmo.contextMenu.length > 0) {
      gizmo.contextMenu.forEach((item) => {
        items.push({
          label: item.label,
          onClick: () => {
            if (typeof item.action === 'function') {
              item.action(gizmo);
            } else if (typeof item.action === 'string' && gizmo.instance?.[item.action]) {
              gizmo.instance[item.action](gizmo);
            }
            setContextMenu(null);
          },
        });
      });
    }

    // Coordinate Space Switcher
    items.push({
      label: gizmo.space === 'local' ? '🌐 Switch to Global Coordinates' : '📍 Switch to Local Coordinates',
      onClick: () => {
        const isCurrentlyLocal = gizmo.space === 'local';
        const cx = Math.round(safeResWidth / 2);
        const cy = Math.round(safeResHeight / 2);
        const newX = isCurrentlyLocal ? Math.round(cx + gizmo.x) : Math.round(gizmo.x - cx);
        const newY = isCurrentlyLocal ? Math.round(cy + gizmo.y) : Math.round(gizmo.y - cy);
        gizmo.space = isCurrentlyLocal ? 'global' : 'local';

        const patch = updateGizmoProperty({
          entity,
          scriptId: gizmo.scriptId,
          gizmo,
          newX,
          newY,
          autoKeyEnabled,
          currentTime,
          fps,
          instance: gizmo.instance,
        });
        if (patch && onUpdateEntity) onUpdateEntity(entity.id, patch);
        setContextMenu(null);
      },
    });

    // Default handy actions
    items.push({
      label: 'Reset to Center',
      onClick: () => {
        const patch = updateGizmoProperty({
          entity,
          scriptId: gizmo.scriptId,
          gizmo,
          newX: gizmo.space === 'local' ? 0 : Math.round(safeResWidth / 2),
          newY: gizmo.space === 'local' ? 0 : Math.round(safeResHeight / 2),
          autoKeyEnabled,
          currentTime,
          fps,
          instance: gizmo.instance,
        });
        if (patch && onUpdateEntity) onUpdateEntity(entity.id, patch);
        setContextMenu(null);
      },
    });

    if (gizmo.axes !== 'x') {
      items.push({
        label: 'Align to X Axis Only',
        onClick: () => {
          gizmo.axes = 'x';
          setContextMenu(null);
        },
      });
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items,
      gizmo,
    });
  }, [entity, safeResWidth, safeResHeight, autoKeyEnabled, currentTime, fps, onUpdateEntity]);

  if (!isSelected || gizmos.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="script-gizmo-overlay"
      style={{
        width: `${safeResWidth}px`,
        height: `${safeResHeight}px`,
      }}
      onPointerDown={handleBackgroundPointerDown}
    >
      {/* Marquee box selection rectangle */}
      {marquee && (
        <div
          className="script-gizmo-marquee"
          style={{
            left: `${(Math.min(marquee.startX, marquee.currentX) / safeResWidth) * 100}%`,
            top: `${(Math.min(marquee.startY, marquee.currentY) / safeResHeight) * 100}%`,
            width: `${(Math.abs(marquee.currentX - marquee.startX) / safeResWidth) * 100}%`,
            height: `${(Math.abs(marquee.currentY - marquee.startY) / safeResHeight) * 100}%`,
          }}
        />
      )}

      {/* Numerical HUD */}
      {hudState && createPortal(
        <div
          className="script-gizmo-hud"
          style={{
            position: 'fixed',
            left: `${hudState.screenX}px`,
            top: `${hudState.screenY}px`,
          }}
        >
          <div className="script-gizmo-hud-title">
            {hudState.title}
            <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 4px', borderRadius: 3, background: hudState.isLocal ? '#8b5cf6' : '#0284c7', color: '#fff' }}>
              {hudState.isLocal ? 'LOCAL' : 'GLOBAL'}
            </span>
            {hudState.rotation ? (
              <span style={{ marginLeft: 4, fontSize: 9, color: '#94a3b8' }}>
                {Math.round(hudState.rotation)}°
              </span>
            ) : null}
          </div>
          <div>
            X: <span className="script-gizmo-hud-val">{hudState.valX}</span>
            <span className="script-gizmo-hud-delta">
              ({hudState.dx >= 0 ? `+${hudState.dx}` : hudState.dx})
            </span>
          </div>
          {hudState.axes !== 'x' && (
            <div>
              Y: <span className="script-gizmo-hud-val">{hudState.valY}</span>
              <span className="script-gizmo-hud-delta">
                ({hudState.dy >= 0 ? `+${hudState.dy}` : hudState.dy})
              </span>
            </div>
          )}
        </div>,
        document.body
      )}

      {/* Render each gizmo handle */}
      {gizmos.map((gizmo) => {
        const isItemActive = selectedIds.has(gizmo.id);
        const canvasPos = gizmoToCanvasCoords(gizmo, safeResWidth, safeResHeight);
        const posXPercent = (canvasPos.x / safeResWidth) * 100;
        const posYPercent = (canvasPos.y / safeResHeight) * 100;

        return (
          <div
            key={gizmo.id}
            className={`script-gizmo-item ${isItemActive ? 'selected' : ''} ${gizmo.size || 'normal'} ${gizmo.space === 'local' ? 'is-local' : ''}`}
            style={{
              left: `${posXPercent}%`,
              top: `${posYPercent}%`,
              transform: `translate(-50%, -50%) rotate(${gizmo.rotation || 0}deg)`,
            }}
            onPointerDown={(e) => handleGizmoPointerDown(e, gizmo)}
            onContextMenu={(e) => handleGizmoContextMenu(e, gizmo)}
          >
            {/* Enlarged invisible hitbox for easy grabbing of small objects */}
            <div
              className="script-gizmo-hitbox"
              style={{
                width: `${Math.max(28, gizmo.width || 0)}px`,
                height: `${Math.max(28, gizmo.height || 0)}px`,
              }}
            />

            {/* Visual handle */}
            <div
              className="script-gizmo-handle"
              style={{
                borderColor: gizmo.color || '#38bdf8',
              }}
            />

            {/* Optional Axis Handles when selected */}
            {isItemActive && (gizmo.axes === 'x' || gizmo.axes === 'xy') && (
              <div
                className="script-gizmo-axis-arrow script-gizmo-axis-x"
                title="Drag horizontally (X axis)"
                onPointerDown={(e) => handleGizmoPointerDown(e, gizmo, 'x')}
              />
            )}
            {isItemActive && (gizmo.axes === 'y' || gizmo.axes === 'xy') && (
              <div
                className="script-gizmo-axis-arrow script-gizmo-axis-y"
                title="Drag vertically (Y axis)"
                onPointerDown={(e) => handleGizmoPointerDown(e, gizmo, 'y')}
              />
            )}

            {/* Tooltip / Label */}
            <div className="script-gizmo-label">
              {gizmo.label}
            </div>
          </div>
        );
      })}

      {/* Context Menu Popup */}
      {contextMenu && createPortal(
        <div
          className="script-gizmo-context-menu"
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
        >
          {contextMenu.items.map((item, idx) => (
            <div
              key={idx}
              className="script-gizmo-menu-item"
              onClick={item.onClick}
            >
              {item.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
