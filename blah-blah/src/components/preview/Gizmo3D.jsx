import { useState, useMemo } from 'react';
import {
  buildGizmo3DGeometry,
  GIZMO_COLORS,
} from '../../engine/gizmo3d.js';
import './gizmo3d.css';

/**
 * Presentational SVG 3D Transform Gizmo overlay.
 * Sits directly on the projected layer origin and provides intuitive Move,
 * Rotate, and Scale handles in screen space.
 *
 * @param {object} props
 * @param {object} props.projectedTransform - Projected 3D layer metrics from camera3d.js
 * @param {'move'|'rotate'|'scale'} [props.activeTool='move'] - Active transform mode
 * @param {string|null} [props.activeHandle=null] - Handle currently being dragged
 * @param {string|null} [props.hoveredHandle=null] - Controlled hovered handle (optional)
 * @param {number} props.width - Frame width in px
 * @param {number} props.height - Frame height in px
 * @param {number} [props.zIndex] - CSS z-index
 * @param {Function} [props.onHandlePointerDown] - (handleName, pointerEvent) => void
 */
export function Gizmo3D({
  projectedTransform,
  activeTool = 'move',
  activeHandle = null,
  hoveredHandle = null,
  width = 1920,
  height = 1080,
  zIndex = 1050,
  onHandlePointerDown,
}) {
  const [internalHover, setInternalHover] = useState(null);
  const currentHover = hoveredHandle !== undefined ? hoveredHandle : internalHover;

  const geom = useMemo(() => {
    if (!projectedTransform || projectedTransform.inFrontOfCamera === false) return null;
    return buildGizmo3DGeometry({
      camMatrix: projectedTransform.camMatrix,
      viewMatrix: projectedTransform.viewMatrix,
      modelMatrix: projectedTransform.modelMatrix,
      focalLength: projectedTransform.focalLength,
      viewport: { width, height },
      near: projectedTransform.nearPlane || 1,
      handleLength: 80,
    });
  }, [projectedTransform, width, height]);

  if (!geom || !geom.visible) return null;

  const { origin, axes, rings, scaleCubes } = geom;

  // Sorting order for painter's depth: handles furthest away (positive depthZ) paint first
  const axisKeys = ['x', 'y', 'z'].sort((a, b) => (axes[b]?.depthZ ?? 0) - (axes[a]?.depthZ ?? 0));
  const ringKeys = ['x', 'y', 'z'].sort((a, b) => (rings[b]?.depthZ ?? 0) - (rings[a]?.depthZ ?? 0));

  const getHandleCursor = (handle) => {
    if (activeHandle === handle) return 'grabbing';
    if (handle.startsWith('rotate-')) return 'grab';
    if (handle === 'scale-center') return 'move';
    if (handle.startsWith('scale-')) return 'nwse-resize';
    return 'move';
  };

  // Computes arrow head polygon points for an axis
  const getArrowHeadPoints = (axis) => {
    const tip = axis.tip;
    const len = axis.screenLen;
    if (len < 1e-4) return '';

    const dx = axis.dir.x / len;
    const dy = axis.dir.y / len;
    const nx = -dy;
    const ny = dx;

    const headLen = 14;
    const halfWidth = 5.5;

    const bx = tip.x - headLen * dx;
    const by = tip.y - headLen * dy;

    const p1 = `${tip.x.toFixed(1)},${tip.y.toFixed(1)}`;
    const p2 = `${(bx + halfWidth * nx).toFixed(1)},${(by + halfWidth * ny).toFixed(1)}`;
    const p3 = `${(bx - halfWidth * nx).toFixed(1)},${(by - halfWidth * ny).toFixed(1)}`;

    return `${p1} ${p2} ${p3}`;
  };

  return (
    <svg
      className="preview-gizmo-3d"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        zIndex,
      }}
    >
      {/* ── 1. MOVE TOOL (3 Axis Arrows) ── */}
      {activeTool === 'move' &&
        axisKeys.map((key) => {
          const axis = axes[key];
          if (axis.clipped) return null;

          const handleName = `move-${key}`;
          const isActive = activeHandle === handleName;
          const isHovered = currentHover === handleName;
          const isDimmed = axis.facingAway && !isActive && !isHovered;
          const color = isActive || isHovered ? GIZMO_COLORS.active : axis.color;

          return (
            <g
              key={handleName}
              className={`gizmo3d-handle-group ${isActive || isHovered ? 'is-active' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
              style={{ cursor: getHandleCursor(handleName) }}
              onPointerDown={(e) => onHandlePointerDown?.(handleName, e)}
              onPointerEnter={() => setInternalHover(handleName)}
              onPointerLeave={() => setInternalHover(null)}
            >
              {/* Wide invisible hit area */}
              <line
                x1={origin.x}
                y1={origin.y}
                x2={axis.tip.x}
                y2={axis.tip.y}
                className="gizmo3d-hit-stroke"
              />

              {/* Visible shaft */}
              <line
                x1={origin.x}
                y1={origin.y}
                x2={axis.tip.x}
                y2={axis.tip.y}
                stroke={color}
                className="gizmo3d-stem"
              />

              {/* Arrow head */}
              <polygon
                points={getArrowHeadPoints(axis)}
                fill={color}
                className="gizmo3d-head"
              />
            </g>
          );
        })}

      {/* ── 2. ROTATE TOOL (3 Rotation Rings) ── */}
      {activeTool === 'rotate' &&
        ringKeys.map((key) => {
          const ring = rings[key];
          const handleName = `rotate-${key}`;
          const isActive = activeHandle === handleName;
          const isHovered = currentHover === handleName;
          const isDimmed = ring.facingAway && !isActive && !isHovered;
          const color = isActive || isHovered ? GIZMO_COLORS.active : ring.color;

          const pathD = ring.points
            .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
            .join(' ') + ' Z';

          return (
            <g
              key={handleName}
              className={`gizmo3d-handle-group ${isActive || isHovered ? 'is-active' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
              style={{ cursor: getHandleCursor(handleName) }}
              onPointerDown={(e) => onHandlePointerDown?.(handleName, e)}
              onPointerEnter={() => setInternalHover(handleName)}
              onPointerLeave={() => setInternalHover(null)}
            >
              {/* Wide invisible hit area */}
              <path d={pathD} className="gizmo3d-hit-stroke" />

              {/* Visible polyline ring */}
              <path d={pathD} stroke={color} className="gizmo3d-ring" />
            </g>
          );
        })}

      {/* ── 3. SCALE TOOL (3 Axis Cubes + Center Cube) ── */}
      {activeTool === 'scale' && (
        <>
          {/* Axis Stems & Cubes */}
          {axisKeys.map((key) => {
            const axis = axes[key];
            const cube = scaleCubes[key];
            const handleName = `scale-${key}`;
            const isActive = activeHandle === handleName;
            const isHovered = currentHover === handleName;
            const isDimmed = axis.facingAway && !isActive && !isHovered;
            const color = isActive || isHovered ? GIZMO_COLORS.active : axis.color;

            const cubeSize = 9;

            return (
              <g
                key={handleName}
                className={`gizmo3d-handle-group ${isActive || isHovered ? 'is-active' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
                style={{ cursor: getHandleCursor(handleName) }}
                onPointerDown={(e) => onHandlePointerDown?.(handleName, e)}
                onPointerEnter={() => setInternalHover(handleName)}
                onPointerLeave={() => setInternalHover(null)}
              >
                {/* Wide invisible hit line + cube */}
                <line
                  x1={origin.x}
                  y1={origin.y}
                  x2={cube.x}
                  y2={cube.y}
                  className="gizmo3d-hit-stroke"
                />
                <rect
                  x={cube.x - 12}
                  y={cube.y - 12}
                  width={24}
                  height={24}
                  className="gizmo3d-hit-fill"
                />

                {/* Visible stem */}
                <line
                  x1={origin.x}
                  y1={origin.y}
                  x2={cube.x}
                  y2={cube.y}
                  stroke={color}
                  className="gizmo3d-stem"
                />

                {/* Visible cube */}
                <rect
                  x={cube.x - cubeSize / 2}
                  y={cube.y - cubeSize / 2}
                  width={cubeSize}
                  height={cubeSize}
                  fill={color}
                  stroke="#1e293b"
                  className="gizmo3d-cube"
                />
              </g>
            );
          })}

          {/* Center Cube (Uniform Scale) */}
          {(() => {
            const handleName = 'scale-center';
            const isActive = activeHandle === handleName;
            const isHovered = currentHover === handleName;
            const color = isActive || isHovered ? GIZMO_COLORS.active : GIZMO_COLORS.center;
            const centerSize = 11;

            return (
              <g
                key={handleName}
                className={`gizmo3d-handle-group ${isActive || isHovered ? 'is-active' : ''}`}
                style={{ cursor: getHandleCursor(handleName) }}
                onPointerDown={(e) => onHandlePointerDown?.(handleName, e)}
                onPointerEnter={() => setInternalHover(handleName)}
                onPointerLeave={() => setInternalHover(null)}
              >
                {/* Wide invisible hit area */}
                <rect
                  x={scaleCubes.center.x - 14}
                  y={scaleCubes.center.y - 14}
                  width={28}
                  height={28}
                  className="gizmo3d-hit-fill"
                />

                {/* Center cube */}
                <rect
                  x={scaleCubes.center.x - centerSize / 2}
                  y={scaleCubes.center.y - centerSize / 2}
                  width={centerSize}
                  height={centerSize}
                  fill={color}
                  stroke="#334155"
                  className="gizmo3d-cube"
                />
              </g>
            );
          })()}
        </>
      )}
    </svg>
  );
}
