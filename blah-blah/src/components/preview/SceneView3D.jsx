import { useState, useRef, useLayoutEffect, useEffect, useMemo, useCallback } from 'react';
import { Camera, RotateCcw, HelpCircle, Grid } from 'lucide-react';
import {
  buildSceneViewCamera,
  buildCameraFrustumGeometry,
  buildEntitiesWireframes,
  orbitStateFromCamera,
  projectEntitiesForSceneView,
  projectSceneSegment,
  projectScenePoint,
  SCENE_VIEW_PRESETS,
} from '../../engine/sceneView3d.js';
import { drawGroundGrid } from '../../engine/groundGrid3d.js';
import { isVideoEntity, isAudioEntity } from '../../engine/ecs.js';
import { VideoLayer } from './VideoLayer.jsx';
import { OverlayLayer } from './OverlayLayer.jsx';
import './scene-view-3d.css';

/**
 * 3D Scene View component — the Demo Camera viewport for inspecting the 3D space,
 * camera frustum, real visual layers and the interactive target reticle.
 *
 * Layer poses come from the Project Camera (`computedEntities`); only the view
 * is taken from the Demo Camera (`orbit`), which is never saved or exported and
 * stays active during playback. "Match Camera" snaps it to the Project Camera once.
 */
export function SceneView3D({
  activeCamera,
  computedEntities = [],
  entities = [],
  tracks = [],
  scripts = [],
  mediaAssets = [],
  currentTime = 0,
  fps = 30,
  isPlaying = false,
  selectedEntityId = null,
  onSelectEntity,
  onUpdateEntity,
  onUpdateCameraTargetOffset,
  safeResWidth = 1920,
  safeResHeight = 1080,
  videoRefs,
  canvasContainerRefs,
  layerZIndexOf = () => 0,
  handleMoveGizmoPointerDown,
  handleRotateGizmoPointerDown,
  handleScaleGizmoPointerDown,
  transitionPlan,
  autoKeyEnabled = false,
  gizmoTool = 'move',
  onGizmo3DPointerDown,
  onBodyDrag3DPointerDown,
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
    roll: 0,
  });

  // The project frame (safeResWidth x safeResHeight) is laid out at its real pixel
  // size and scaled uniformly into the panel, exactly like the normal preview does
  // with its frameScale. Everything inside the stage (layers, grid, wireframes) then
  // shares one coordinate system, so nothing can drift apart when the panel resizes.
  const [stageFit, setStageFit] = useState({ scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 });

  const [activePreset, setActivePreset] = useState('perspective');
  const [gridEnabled, setGridEnabled] = useState(showGroundGrid);
  const [showHelp, setShowHelp] = useState(false);
  const [isDraggingTarget, setIsDraggingTarget] = useState(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      // A hidden dock tab reports 0x0: keep the last good fit instead of collapsing.
      if (w <= 0 || h <= 0) return;
      const scale = Math.min(w / safeResWidth, h / safeResHeight);
      const offsetX = (w - safeResWidth * scale) / 2;
      const offsetY = (h - safeResHeight * scale) / 2;
      setStageFit((prev) =>
        prev.scale === scale && prev.offsetX === offsetX && prev.offsetY === offsetY && prev.width === w && prev.height === h
          ? prev
          : { scale, offsetX, offsetY, width: w, height: h }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [safeResWidth, safeResHeight]);

  // Sync prop changes for gridEnabled if activeCamera toggles it
  useEffect(() => {
    if (activeCamera?.showGrid !== undefined) {
      setGridEnabled(activeCamera.showGrid);
    }
  }, [activeCamera?.showGrid]);

  const sceneCam = useMemo(() => {
    return buildSceneViewCamera(orbit, { width: safeResWidth, height: safeResHeight });
  }, [orbit, safeResWidth, safeResHeight]);

  // Project entities through Scene View camera to show actual content in 3D
  const sceneProjectedEntities = useMemo(() => {
    return projectEntitiesForSceneView(computedEntities, sceneCam, {
      width: safeResWidth,
      height: safeResHeight,
    });
  }, [computedEntities, sceneCam, safeResWidth, safeResHeight]);

  const sceneVideoItems = useMemo(
    () => sceneProjectedEntities.filter(({ entity }) => isVideoEntity(entity)),
    [sceneProjectedEntities]
  );

  const sceneOverlayItems = useMemo(
    () => sceneProjectedEntities.filter(({ entity }) => !isVideoEntity(entity) && !isAudioEntity(entity)),
    [sceneProjectedEntities]
  );

  // Redraw Ground Grid whenever the Demo Camera or the panel changes. The canvas covers
  // the whole panel, and is drawn in stage (project-frame) coordinates so the grid lines
  // up with the layers and wireframes.
  useLayoutEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    if (gridEnabled) {
      ctx.setTransform(stageFit.scale, 0, 0, stageFit.scale, stageFit.offsetX, stageFit.offsetY);
      drawGroundGrid(ctx, {
        position: sceneCam.eye,
        target: sceneCam.target,
        roll: sceneCam.roll,
        fov: sceneCam.fov,
        zoom: sceneCam.zoom,
      }, { width: safeResWidth, height: safeResHeight }, {
        gridExtent: 4000,
        fadeDistance: 4500,
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }, [sceneCam, stageFit, safeResWidth, safeResHeight, gridEnabled]);

  // Drag interaction refs for Viewport Orbit / Pan / Target Reticle
  const dragRef = useRef({
    isDragging: false,
    mode: null, // 'orbit' | 'pan' | 'target'
    startX: 0,
    startY: 0,
    startAzimuth: 0,
    startElevation: 0,
    startTarget: { x: 0, y: 0, z: 0 },
    startOffset: { x: 0, y: 0, z: 1000 },
    targetDepth: 1000,
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

  // Interactive 3D Target Reticle pointer down
  const handleTargetReticlePointerDown = (e, tgtDepth) => {
    e.preventDefault();
    e.stopPropagation();

    const curOffset = activeCamera?.targetOffset || { x: 0, y: 0, z: 1000 };

    dragRef.current = {
      isDragging: true,
      mode: 'target',
      startX: e.clientX,
      startY: e.clientY,
      startOffset: { ...curOffset },
      targetDepth: tgtDepth || orbit.distance,
    };

    setIsDraggingTarget(true);
  };

  const handlePointerMove = useCallback((e) => {
    if (!dragRef.current.isDragging) return;

    const scale = stageFit.scale > 0 ? stageFit.scale : 1;
    const dx = (e.clientX - dragRef.current.startX) / scale;
    const dy = (e.clientY - dragRef.current.startY) / scale;

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
    } else if (dragRef.current.mode === 'target') {
      // Map screen delta to world displacement at target's depth
      const s = sceneCam.focalLength / Math.max(10, dragRef.current.targetDepth);
      const worldRightDelta = dx / s;
      const worldUpDelta = -dy / s;

      let worldDeltaX = sceneCam.right.x * worldRightDelta + sceneCam.up.x * worldUpDelta;
      let worldDeltaY = sceneCam.right.y * worldRightDelta + sceneCam.up.y * worldUpDelta;
      let worldDeltaZ = sceneCam.right.z * worldRightDelta + sceneCam.up.z * worldUpDelta;

      if (e.shiftKey) {
        // Holding Shift constrains target movement to the horizontal ground plane (XZ)
        worldDeltaY = 0;
      }

      const nextOffX = Math.round(dragRef.current.startOffset.x + worldDeltaX);
      const nextOffY = Math.round(dragRef.current.startOffset.y + worldDeltaY);
      const nextOffZ = Math.round(dragRef.current.startOffset.z + worldDeltaZ);

      onUpdateCameraTargetOffset?.(nextOffX, nextOffY, nextOffZ);
    }
  }, [orbit.distance, sceneCam, stageFit.scale, onUpdateCameraTargetOffset]);

  const handlePointerUp = useCallback(() => {
    dragRef.current.isDragging = false;
    setIsDraggingTarget(false);
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
          curTarget.y -= step;
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
      fov: 50,
      zoom: 1.0,
      roll: 0,
    }));
  };

  // One-time snap of the Demo Camera to the Project Camera at the current time.
  // It does not follow afterwards. With it matched, the Scene View's 3D layers must
  // sit exactly where the normal preview draws them.
  const matchProjectCamera = () => {
    setActivePreset(null);
    setOrbit(orbitStateFromCamera(activeCamera));
  };

  // Frustum geometry
  const frustumGeom = useMemo(() => {
    return buildCameraFrustumGeometry(activeCamera, sceneCam);
  }, [activeCamera, sceneCam]);

  // Entities wireframes
  const wireframes = useMemo(() => {
    return buildEntitiesWireframes(sceneProjectedEntities, sceneCam, selectedEntityId);
  }, [sceneProjectedEntities, sceneCam, selectedEntityId]);

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
      {/* 1. Ground Grid Canvas (whole panel, drawn in stage coordinates) */}
      <canvas
        ref={canvasRef}
        width={Math.max(1, Math.round(stageFit.width))}
        height={Math.max(1, Math.round(stageFit.height))}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />

      {/* Stage: the project frame at its real pixel size, scaled uniformly into the
          panel (same idea as the normal preview's frameScale). Layers, wireframes,
          frustum and axes all live in this one coordinate system. */}
      <div
        className="scene-view-stage"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: `${safeResWidth}px`,
          height: `${safeResHeight}px`,
          transform: `translate(${stageFit.offsetX}px, ${stageFit.offsetY}px) scale(${stageFit.scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
          '--view-scale': stageFit.scale,
        }}
      >
      {/* 2. Real Visual Entities Stage (videos, text, shapes, scripts projected in 3D) */}
      <div
        className="scene-view-entities-viewport"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: `${safeResWidth}px`,
          height: `${safeResHeight}px`,
          pointerEvents: 'none',
        }}
      >
        <VideoLayer
          items={sceneVideoItems}
          selectedEntityId={selectedEntityId}
          onSelectEntity={onSelectEntity}
          onUpdateEntity={onUpdateEntity}
          videoRefs={videoRefs}
          isPlaying={isPlaying}
          currentTime={currentTime}
          safeResWidth={safeResWidth}
          safeResHeight={safeResHeight}
          layerZIndexOf={layerZIndexOf}
          handleMoveGizmoPointerDown={handleMoveGizmoPointerDown}
          handleRotateGizmoPointerDown={handleRotateGizmoPointerDown}
          handleScaleGizmoPointerDown={handleScaleGizmoPointerDown}
          gizmoTool={gizmoTool}
          onGizmo3DPointerDown={onGizmo3DPointerDown}
          onBodyDrag3DPointerDown={onBodyDrag3DPointerDown}
          transitionPlan={transitionPlan}
          preloadItems={[]}
        />

        <OverlayLayer
          items={sceneOverlayItems}
          selectedEntityId={selectedEntityId}
          onSelectEntity={onSelectEntity}
          onUpdateEntity={onUpdateEntity}
          entities={entities}
          scripts={scripts}
          mediaAssets={mediaAssets}
          currentTime={currentTime}
          fps={fps}
          safeResWidth={safeResWidth}
          safeResHeight={safeResHeight}
          layerZIndexOf={layerZIndexOf}
          canvasContainerRefs={canvasContainerRefs}
          handleMoveGizmoPointerDown={handleMoveGizmoPointerDown}
          handleRotateGizmoPointerDown={handleRotateGizmoPointerDown}
          handleScaleGizmoPointerDown={handleScaleGizmoPointerDown}
          autoKeyEnabled={autoKeyEnabled}
          gizmoTool={gizmoTool}
          onGizmo3DPointerDown={onGizmo3DPointerDown}
          onBodyDrag3DPointerDown={onBodyDrag3DPointerDown}
        />
      </div>

      {/* 3. SVG Overlay for Camera Frustum, Target Reticle, and Entity Markers */}
      <svg
        className="scene-view-3d-svg"
        width={safeResWidth}
        height={safeResHeight}
        viewBox={`0 0 ${safeResWidth} ${safeResHeight}`}
        style={{ width: `${safeResWidth}px`, height: `${safeResHeight}px`, overflow: 'visible' }}
      >
        {/* Project frame: what the normal preview and the export show */}
        <rect
          x={0}
          y={0}
          width={safeResWidth}
          height={safeResHeight}
          className="scene-frame-outline"
          vectorEffect="non-scaling-stroke"
        />

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

            {/* Interactive 3D Target Reticle */}
            {frustumGeom.targetProj?.visible && (
              <g
                className={`scene-target-reticle ${isDraggingTarget ? 'is-dragging' : ''}`}
                transform={`translate(${frustumGeom.targetProj.x}, ${frustumGeom.targetProj.y})`}
                onPointerDown={(e) => handleTargetReticlePointerDown(e, frustumGeom.targetProj.zc)}
              >
                <circle r={14} className="scene-cam-target-ring" />
                <circle r={4} fill="#f43f5e" />
                <line x1={-18} y1={0} x2={18} y2={0} className="scene-cam-target-cross" />
                <line x1={0} y1={-18} x2={0} y2={18} className="scene-cam-target-cross" />
                <text
                  x={22}
                  y={4}
                  fill="#fda4af"
                  fontSize={11}
                  fontWeight={600}
                  className="scene-entity-tag"
                >
                  Target Offset ({Math.round(activeCamera?.targetOffset?.x ?? 0)}, {Math.round(activeCamera?.targetOffset?.y ?? 0)}, {Math.round(activeCamera?.targetOffset?.z ?? 1000)})
                </text>
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

        {/* 3D Entities Wireframes & Labels on top of actual visuals */}
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
      </div>

      {/* 4. Top-left Toolbar: Presets, Match Camera, and Grid */}
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
          className="scene-view-tool-btn"
          onClick={matchProjectCamera}
          title="Match Project Camera: snap this view to the project camera once (does not follow)"
        >
          <Camera size={12} />
          <span>Match Camera</span>
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

      {/* 5. Bottom-left Navigation Controls Hint */}
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
            <span className="scene-view-help-key">Drag Reticle (Shift: level)</span>
            <span>Aim Target</span>
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