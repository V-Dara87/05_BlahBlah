import { useState, useRef, useLayoutEffect, useEffect, useMemo, useCallback } from 'react';
import { Camera, Compass, RotateCcw, HelpCircle, Grid } from 'lucide-react';
import {
  buildSceneViewCamera,
  buildCameraFrustumGeometry,
  buildEntitiesWireframes,
  projectSceneSegment,
  projectScenePoint,
  SCENE_VIEW_PRESETS,
} from '../../engine/sceneView3d.js';
import { drawGroundGrid } from '../../engine/groundGrid3d.js';
import './scene-view-3d.css';

/**
 * 3D Scene View component — free-fly viewport for inspecting the 3D space,
 * camera frustum, layer positions, and ground grid.
 */
export function SceneView3D({
  activeCamera,
  computedEntities = [],
  selectedEntityId = null,
  onSelectEntity,
  safeResWidth = 1920,
  safeResHeight = 1080,
  showGroundGrid = true,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // Orbit camera state for Scene View (independent from project camera)
  const [orbit, setOrbit] = useState({
    target: { x: 0, y: 0, z: 0 },
    distance: 2400,
    azimuth: 35,
    elevation: 25,
    fov: 50,
    zoom: 1.0,
  });

  const [activePreset, setActivePreset] = useState('perspective');
  const [gridEnabled, setGridEnabled] = useState(showGroundGrid);
  const [showHelp, setShowHelp] = useState(false);

  // Sync prop changes for gridEnabled if activeCamera toggles it
  useEffect(() => {
    if (activeCamera?.showGrid !== undefined) {
      setGridEnabled(activeCamera.showGrid);
    }
  }, [activeCamera?.showGrid]);

  const sceneCam = useMemo(() => {
    return buildSceneViewCamera(orbit, { width: safeResWidth, height: safeResHeight });
  }, [orbit, safeResWidth, safeResHeight]);

  // Redraw Ground Grid onto canvas whenever scene camera or viewport changes
  useLayoutEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cvs.width, cvs.height);

    if (gridEnabled) {
      drawGroundGrid(ctx, {
        position: sceneCam.eye,
        target: sceneCam.target,
        roll: 0,
        fov: sceneCam.fov,
        zoom: sceneCam.zoom,
      }, { width: safeResWidth, height: safeResHeight }, {
        gridExtent: 4000,
        fadeDistance: 4500,
      });
    }
  }, [sceneCam, safeResWidth, safeResHeight, gridEnabled]);

  // Drag interaction refs
  const dragRef = useRef({
    isDragging: false,
    mode: null, // 'orbit' | 'pan'
    startX: 0,
    startY: 0,
    startAzimuth: 0,
    startElevation: 0,
    startTarget: { x: 0, y: 0, z: 0 },
  });

  const handlePointerDown = (e) => {
    // Focus container for WASD navigation
    containerRef.current?.focus();

    const isMiddle = e.button === 1;
    const isRight = e.button === 2;
    const isAltLeft = e.button === 0 && e.altKey;
    const isShiftMiddle = isMiddle && e.shiftKey;

    if (!isMiddle && !isRight && !isAltLeft) return;

    e.preventDefault();
    e.stopPropagation();

    const mode = (isRight || isShiftMiddle) ? 'pan' : 'orbit';
    dragRef.current = {
      isDragging: true,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startAzimuth: orbit.azimuth,
      startElevation: orbit.elevation,
      startTarget: { ...orbit.target },
    };

    setActivePreset(null);
  };

  const handlePointerMove = useCallback((e) => {
    if (!dragRef.current.isDragging) return;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    if (dragRef.current.mode === 'orbit') {
      const sensitivity = 0.35;
      const nextAzimuth = (dragRef.current.startAzimuth + dx * sensitivity) % 360;
      const nextElevation = Math.max(-89.9, Math.min(89.9, dragRef.current.startElevation - dy * sensitivity));

      setOrbit((prev) => ({
        ...prev,
        azimuth: nextAzimuth,
        elevation: nextElevation,
      }));
    } else if (dragRef.current.mode === 'pan') {
      // Pan along scene camera's right and up vectors in world space
      const factor = (orbit.distance / 1200) * 1.5;
      const rx = sceneCam.right.x;
      const ry = sceneCam.right.y;
      const rz = sceneCam.right.z;
      const ux = sceneCam.up.x;
      const uy = sceneCam.up.y;
      const uz = sceneCam.up.z;

      const deltaX = -dx * factor;
      const deltaY = dy * factor;

      setOrbit((prev) => ({
        ...prev,
        target: {
          x: dragRef.current.startTarget.x + rx * deltaX + ux * deltaY,
          y: dragRef.current.startTarget.y + ry * deltaX + uy * deltaY,
          z: dragRef.current.startTarget.z + rz * deltaX + uz * deltaY,
        },
      }));
    }
  }, [orbit.distance, sceneCam.right, sceneCam.up]);

  const handlePointerUp = useCallback(() => {
    dragRef.current.isDragging = false;
  }, []);

  const handleWheel = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const zoomFactor = e.deltaY > 0 ? 1.12 : 0.89;
    setOrbit((prev) => ({
      ...prev,
      distance: Math.max(100, Math.min(30000, prev.distance * zoomFactor)),
    }));
  };

  // Keyboard navigation (WASD / QE keys)
  const handleKeyDown = (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    const step = 60 * (orbit.distance / 2000);
    const key = e.key.toUpperCase();

    if (['W', 'A', 'S', 'D', 'Q', 'E'].includes(key)) {
      e.preventDefault();
      e.stopPropagation();

      setOrbit((prev) => {
        const curTarget = { ...prev.target };
        if (key === 'W') {
          curTarget.x += sceneCam.forward.x * step;
          curTarget.y += sceneCam.forward.y * step;
          curTarget.z += sceneCam.forward.z * step;
        } else if (key === 'S') {
          curTarget.x -= sceneCam.forward.x * step;
          curTarget.y -= sceneCam.forward.y * step;
          curTarget.z -= sceneCam.forward.z * step;
        } else if (key === 'A') {
          curTarget.x -= sceneCam.right.x * step;
          curTarget.y -= sceneCam.right.y * step;
          curTarget.z -= sceneCam.right.z * step;
        } else if (key === 'D') {
          curTarget.x += sceneCam.right.x * step;
          curTarget.y += sceneCam.right.y * step;
          curTarget.z += sceneCam.right.z * step;
        } else if (key === 'Q') {
          curTarget.y -= step; // Up / Down in world Y
        } else if (key === 'E') {
          curTarget.y += step;
        }
        return { ...prev, target: curTarget };
      });
    }
  };

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const applyPreset = (presetKey) => {
    const p = SCENE_VIEW_PRESETS[presetKey];
    if (!p) return;
    setActivePreset(presetKey);
    setOrbit((prev) => ({
      ...prev,
      azimuth: p.azimuth,
      elevation: p.elevation,
      distance: p.distance,
      target: { ...p.target },
    }));
  };

  // Frustum geometry
  const frustumGeom = useMemo(() => {
    return buildCameraFrustumGeometry(activeCamera, sceneCam);
  }, [activeCamera, sceneCam]);

  // Entities wireframes
  const wireframes = useMemo(() => {
    return buildEntitiesWireframes(computedEntities, sceneCam, selectedEntityId);
  }, [computedEntities, sceneCam, selectedEntityId]);

  // World Origin Axes (Tripod at (0, 0, 0))
  const originAxes = useMemo(() => {
    const axisLen = 200;
    const origin = { x: 0, y: 0, z: 0 };
    return {
      x: projectSceneSegment(origin, { x: axisLen, y: 0, z: 0 }, sceneCam),
      y: projectSceneSegment(origin, { x: 0, y: axisLen, z: 0 }, sceneCam),
      z: projectSceneSegment(origin, { x: 0, y: 0, z: axisLen }, sceneCam),
      pt: projectScenePoint(origin, sceneCam),
    };
  }, [sceneCam]);

  return (
    <div
      ref={containerRef}
      className="scene-view-3d-container"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 1. Ground Grid Canvas */}
      <canvas
        ref={canvasRef}
        width={safeResWidth}
        height={safeResHeight}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />

      {/* 2. SVG Overlay for Camera Frustum, Entities, and Markers */}
      <svg
        className="scene-view-3d-svg"
        viewBox={`0 0 ${safeResWidth} ${safeResHeight}`}
        preserveAspectRatio="none"
      >
        {/* World Origin Axes Tripod */}
        {originAxes.x && (
          <line
            x1={originAxes.x.sx1}
            y1={originAxes.x.sy1}
            x2={originAxes.x.sx2}
            y2={originAxes.x.sy2}
            stroke="#ef4444"
            strokeWidth={2}
          />
        )}
        {originAxes.y && (
          <line
            x1={originAxes.y.sx1}
            y1={originAxes.y.sy1}
            x2={originAxes.y.sx2}
            y2={originAxes.y.sy2}
            stroke="#22c55e"
            strokeWidth={2}
          />
        )}
        {originAxes.z && (
          <line
            x1={originAxes.z.sx1}
            y1={originAxes.z.sy1}
            x2={originAxes.z.sx2}
            y2={originAxes.z.sy2}
            stroke="#3b82f6"
            strokeWidth={2}
          />
        )}

        {/* Active Project Camera Frustum */}
        {frustumGeom && (
          <g className="scene-cam-frustum-group">
            {/* Sight line to target */}
            {frustumGeom.targetRay && (
              <line
                x1={frustumGeom.targetRay.sx1}
                y1={frustumGeom.targetRay.sy1}
                x2={frustumGeom.targetRay.sx2}
                y2={frustumGeom.targetRay.sy2}
                className="scene-cam-sight-line"
              />
            )}

            {/* Frustum edge rays */}
            {frustumGeom.raySegments.map((seg, i) => (
              <line
                key={`ray-${i}`}
                x1={seg.sx1}
                y1={seg.sy1}
                x2={seg.sx2}
                y2={seg.sy2}
                className="scene-cam-frustum-line"
              />
            ))}

            {/* Frustum base rectangle */}
            {frustumGeom.baseSegments.map((seg, i) => (
              <line
                key={`base-${i}`}
                x1={seg.sx1}
                y1={seg.sy1}
                x2={seg.sx2}
                y2={seg.sy2}
                className="scene-cam-frustum-base"
              />
            ))}

            {/* Camera Target Crosshair */}
            {frustumGeom.targetProj?.visible && (
              <g
                transform={`translate(${frustumGeom.targetProj.x}, ${frustumGeom.targetProj.y})`}
                title={`Target: (${Math.round(frustumGeom.target.x)}, ${Math.round(frustumGeom.target.y)}, ${Math.round(frustumGeom.target.z)})`}
              >
                <circle r={6} className="scene-cam-target-ring" />
                <line x1={-9} y1={0} x2={9} y2={0} className="scene-cam-target-cross" />
                <line x1={0} y1={-9} x2={0} y2={9} className="scene-cam-target-cross" />
              </g>
            )}

            {/* Camera Eye Marker & Badge */}
            {frustumGeom.eyeProj?.visible && (
              <g
                className="scene-camera-marker"
                transform={`translate(${frustumGeom.eyeProj.x}, ${frustumGeom.eyeProj.y})`}
              >
                <circle r={14} fill="#8b5cf6" fillOpacity={0.25} stroke="#c084fc" strokeWidth={1.8} />
                <circle r={4} fill="#f43f5e" />
                <text
                  x={18}
                  y={4}
                  fill="#e9d5ff"
                  fontSize={11}
                  fontWeight={600}
                  className="scene-entity-tag"
                >
                  Camera ({Math.round(frustumGeom.eye.x)}, {Math.round(frustumGeom.eye.y)}, {Math.round(frustumGeom.eye.z)})
                </text>
              </g>
            )}
          </g>
        )}

        {/* 3D Entities Wireframes & Labels */}
        {wireframes.map((wf) => (
          <g key={wf.id} className="scene-entity-group" onClick={() => onSelectEntity?.(wf.id)}>
            {wf.segments.map((seg, i) => (
              <line
                key={`seg-${i}`}
                x1={seg.sx1}
                y1={seg.sy1}
                x2={seg.sx2}
                y2={seg.sy2}
                className={`scene-entity-wireframe ${wf.isSelected ? 'is-selected' : ''}`}
              />
            ))}
            {wf.centerProj?.visible && (
              <text
                x={wf.centerProj.x}
                y={wf.centerProj.y}
                textAnchor="middle"
                className={`scene-entity-tag ${wf.isSelected ? 'is-selected' : ''}`}
              >
                {wf.name}
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* 3. Top-left Toolbar: Presets & Grid Toggle */}
      <div className="scene-view-toolbar">
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#38bdf8', paddingRight: '4px' }}>
          3D Scene View
        </span>

        <button
          type="button"
          className={`scene-view-tool-btn ${activePreset === 'perspective' ? 'active' : ''}`}
          onClick={() => applyPreset('perspective')}
          title="Perspective View"
        >
          Perspective
        </button>

        <button
          type="button"
          className={`scene-view-tool-btn ${activePreset === 'top' ? 'active' : ''}`}
          onClick={() => applyPreset('top')}
          title="Top View (Y plane)"
        >
          Top
        </button>

        <button
          type="button"
          className={`scene-view-tool-btn ${activePreset === 'front' ? 'active' : ''}`}
          onClick={() => applyPreset('front')}
          title="Front View (Z plane)"
        >
          Front
        </button>

        <button
          type="button"
          className={`scene-view-tool-btn ${activePreset === 'right' ? 'active' : ''}`}
          onClick={() => applyPreset('right')}
          title="Right View (X plane)"
        >
          Right
        </button>

        <button
          type="button"
          className="scene-view-tool-btn"
          onClick={() => applyPreset('perspective')}
          title="Reset Camera View"
        >
          <RotateCcw size={12} />
        </button>

        <div style={{ width: '1px', height: '14px', background: 'rgba(71,85,105,0.6)', margin: '0 2px' }} />

        <button
          type="button"
          className={`scene-view-tool-btn ${gridEnabled ? 'active' : ''}`}
          onClick={() => setGridEnabled((g) => !g)}
          title="Toggle Ground Grid (Y=0)"
        >
          <Grid size={12} />
          <span>Grid</span>
        </button>

        <button
          type="button"
          className={`scene-view-tool-btn ${showHelp ? 'active' : ''}`}
          onClick={() => setShowHelp((h) => !h)}
          title="Navigation Controls Help"
        >
          <HelpCircle size={12} />
        </button>
      </div>

      {/* 4. Bottom-left Navigation Controls Hint */}
      {showHelp && (
        <div className="scene-view-help-badge">
          <div className="scene-view-help-item">
            <span className="scene-view-help-key">Middle-drag / Alt+Left</span>
            <span>Orbit</span>
          </div>
          <div className="scene-view-help-item">
            <span className="scene-view-help-key">Right-drag / Shift+Middle</span>
            <span>Pan</span>
          </div>
          <div className="scene-view-help-item">
            <span className="scene-view-help-key">Scroll</span>
            <span>Dolly</span>
          </div>
          <div className="scene-view-help-item">
            <span className="scene-view-help-key">W A S D</span>
            <span>Fly</span>
          </div>
        </div>
      )}
    </div>
  );
}
