/**
 * Gizmo3D - Pure 3D Transform Gizmo mathematics and solvers.
 *
 * Provides:
 * 1. Screen-space handle geometry generation from camera & view matrices:
 *    - Layer origin on screen
 *    - Three colored axis arrows (Move)
 *    - Three rotation rings (Rotate) with facing/sign determination
 *    - Three axis cubes + center cube (Scale)
 *    - Constant on-screen size across varying depth
 *    - Near-plane clipping and clamping
 * 2. Handle picking under screen pointer (segments, rings, cubes)
 * 3. Drag solvers for Move, Rotate, Scale:
 *    - Move: pointer delta along screen axis -> world delta & parent-local delta
 *    - Rotate: angle swept around screen origin -> degrees with facing sign
 *    - Scale: distance ratio along screen axis -> scale factor
 */

export const GIZMO_COLORS = {
  x: '#f87171',      // Red (X axis / pitch)
  y: '#4ade80',      // Green (Y axis / yaw)
  z: '#60a5fa',      // Blue (Z axis / roll)
  center: '#f8fafc', // Light slate / white for center handle
  active: '#facc15', // Highlight yellow for active/hovered handle
};

export const DEFAULT_HANDLE_LENGTH = 80; // Fixed pixels on screen

/**
 * Normalizes a 3D vector.
 */
function normalize3([x, y, z]) {
  const len = Math.hypot(x, y, z);
  if (len < 1e-7) return [0, 0, 0];
  return [x / len, y / len, z / len];
}

/**
 * Inverts the 3x3 rotation/scale part of a 4x4 matrix and multiplies by a 3D vector.
 * Used to transform world-space deltas into parent's local space.
 */
export function mat3InvertVector(m4, v) {
  if (!m4 || m4.length < 16) return { x: v[0] ?? v.x ?? 0, y: v[1] ?? v.y ?? 0, z: v[2] ?? v.z ?? 0 };

  const vx = v[0] ?? v.x ?? 0;
  const vy = v[1] ?? v.y ?? 0;
  const vz = v[2] ?? v.z ?? 0;

  // Extract upper 3x3 (column-major)
  const a00 = m4[0], a10 = m4[1], a20 = m4[2];
  const a01 = m4[4], a11 = m4[5], a21 = m4[6];
  const a02 = m4[8], a12 = m4[9], a22 = m4[10];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;

  const det = a00 * b01 + a01 * b11 + a02 * b21;
  if (Math.abs(det) < 1e-9) {
    return { x: vx, y: vy, z: vz };
  }

  const invDet = 1.0 / det;

  const inv00 = b01 * invDet;
  const inv01 = (-a22 * a01 + a02 * a21) * invDet;
  const inv02 = (a12 * a01 - a02 * a11) * invDet;

  const inv10 = b11 * invDet;
  const inv11 = (a22 * a00 - a02 * a20) * invDet;
  const inv12 = (-a12 * a00 + a02 * a10) * invDet;

  const inv20 = b21 * invDet;
  const inv21 = (-a21 * a00 + a01 * a20) * invDet;
  const inv22 = (a11 * a00 - a01 * a10) * invDet;

  return {
    x: inv00 * vx + inv01 * vy + inv02 * vz,
    y: inv10 * vx + inv11 * vy + inv12 * vz,
    z: inv20 * vx + inv21 * vy + inv22 * vz,
  };
}

/**
 * Projects a point in camera space to screen pixels.
 */
export function projectCameraPoint(camPt, focalLength, viewport, near = 1) {
  const vpW = viewport?.width || 1920;
  const vpH = viewport?.height || 1080;
  const z = Math.max(near, camPt[2]);
  const s = focalLength / z;
  return {
    x: camPt[0] * s + vpW / 2,
    y: camPt[1] * s + vpH / 2,
    z: camPt[2],
  };
}

/**
 * Builds the screen-space geometry for a 3D gizmo on a layer.
 *
 * @param {object} options
 * @param {number[]} options.camMatrix - 4x4 matrix from layer local space to camera space
 * @param {number[]} [options.viewMatrix] - 4x4 camera view matrix (world -> camera)
 * @param {number[]} [options.modelMatrix] - 4x4 layer world matrix (local -> world)
 * @param {number} options.focalLength - Camera focal length in pixels
 * @param {{ width: number, height: number }} options.viewport - Viewport dimensions
 * @param {number} [options.handleLength=80] - Desired screen length of axes in px
 * @param {number} [options.near=1] - Near clip plane distance
 * @returns {object} Complete gizmo geometry ready for rendering and picking
 */
export function buildGizmo3DGeometry({
  camMatrix,
  viewMatrix,
  modelMatrix,
  focalLength = 1158,
  viewport = { width: 1920, height: 1080 },
  handleLength = DEFAULT_HANDLE_LENGTH,
  near = 1,
}) {
  if (!camMatrix || camMatrix.length < 16) {
    return { visible: false, behindCamera: true };
  }

  // Camera-space origin of the layer
  const camOrigin = [camMatrix[12], camMatrix[13], camMatrix[14]];
  const originZ = camOrigin[2];

  // If origin is behind or at the near plane, the layer is not visible
  if (originZ <= near) {
    return {
      visible: false,
      behindCamera: true,
      originZ,
    };
  }

  // Projected screen origin
  const screenOrigin = projectCameraPoint(camOrigin, focalLength, viewport, near);

  // Scale factor at the layer's depth (screen px per camera unit)
  const scaleFactor = focalLength / originZ;

  // 3D distance needed in camera space so the handle projects to `safeHandleLength` px
  const safeHandleLength = Math.max(30, Number(handleLength) || DEFAULT_HANDLE_LENGTH);
  const dist3D = safeHandleLength / scaleFactor;

  // Extract camera-space axis directions from column vectors of camMatrix
  const camAxisX = normalize3([camMatrix[0], camMatrix[1], camMatrix[2]]);
  const camAxisY = normalize3([camMatrix[4], camMatrix[5], camMatrix[6]]);
  const camAxisZ = normalize3([camMatrix[8], camMatrix[9], camMatrix[10]]);

  // Extract world-space axis directions from modelMatrix (or derive from camAxis and inverse view)
  let worldAxisX = [1, 0, 0];
  let worldAxisY = [0, 1, 0];
  let worldAxisZ = [0, 0, 1];

  if (modelMatrix && modelMatrix.length >= 16) {
    worldAxisX = normalize3([modelMatrix[0], modelMatrix[1], modelMatrix[2]]);
    worldAxisY = normalize3([modelMatrix[4], modelMatrix[5], modelMatrix[6]]);
    worldAxisZ = normalize3([modelMatrix[8], modelMatrix[9], modelMatrix[10]]);
  } else if (viewMatrix && viewMatrix.length >= 16) {
    // camAxis = mView * worldAxis -> worldAxis = mView_rot^T * camAxis
    const vx = camAxisX, vy = camAxisY, vz = camAxisZ;
    worldAxisX = normalize3([
      viewMatrix[0] * vx[0] + viewMatrix[1] * vx[1] + viewMatrix[2] * vx[2],
      viewMatrix[4] * vx[0] + viewMatrix[5] * vx[1] + viewMatrix[6] * vx[2],
      viewMatrix[8] * vx[0] + viewMatrix[9] * vx[1] + viewMatrix[10] * vx[2],
    ]);
    worldAxisY = normalize3([
      viewMatrix[0] * vy[0] + viewMatrix[1] * vy[1] + viewMatrix[2] * vy[2],
      viewMatrix[4] * vy[0] + viewMatrix[5] * vy[1] + viewMatrix[6] * vy[2],
      viewMatrix[8] * vy[0] + viewMatrix[9] * vy[1] + viewMatrix[10] * vy[2],
    ]);
    worldAxisZ = normalize3([
      viewMatrix[0] * vz[0] + viewMatrix[1] * vz[1] + viewMatrix[2] * vz[2],
      viewMatrix[4] * vz[0] + viewMatrix[5] * vz[1] + viewMatrix[6] * vz[2],
      viewMatrix[8] * vz[0] + viewMatrix[9] * vz[1] + viewMatrix[10] * vz[2],
    ]);
  }

  // Build the 3 axis tips
  const axesDef = {
    x: { unitCam: camAxisX, unitWorld: worldAxisX, color: GIZMO_COLORS.x },
    y: { unitCam: camAxisY, unitWorld: worldAxisY, color: GIZMO_COLORS.y },
    z: { unitCam: camAxisZ, unitWorld: worldAxisZ, color: GIZMO_COLORS.z },
  };

  const axes = {};
  const scaleCubes = {
    center: { x: screenOrigin.x, y: screenOrigin.y },
  };

  for (const [key, def] of Object.entries(axesDef)) {
    const camTip = [
      camOrigin[0] + dist3D * def.unitCam[0],
      camOrigin[1] + dist3D * def.unitCam[1],
      camOrigin[2] + dist3D * def.unitCam[2],
    ];

    const clipped = camTip[2] <= near;
    const safeTip = [camTip[0], camTip[1], Math.max(near, camTip[2])];
    const screenTip = projectCameraPoint(safeTip, focalLength, viewport, near);

    const dirX = screenTip.x - screenOrigin.x;
    const dirY = screenTip.y - screenOrigin.y;
    const screenLen = Math.hypot(dirX, dirY);

    axes[key] = {
      key,
      color: def.color,
      camTip,
      tip: { x: screenTip.x, y: screenTip.y },
      dir: { x: dirX, y: dirY },
      screenLen,
      unitCam: def.unitCam,
      unitWorld: def.unitWorld,
      // depthZ > 0 means the axis points away into the scene; depthZ < 0 points toward camera
      depthZ: def.unitCam[2],
      facingAway: def.unitCam[2] > 0.05,
      clipped,
    };

    scaleCubes[key] = { x: screenTip.x, y: screenTip.y, depthZ: def.unitCam[2] };
  }

  // Build the 3 rotation rings
  // Ring normal is the axis. In its perpendicular plane, take basis vectors (u, v).
  const ringsDef = {
    x: { normal: camAxisX, basisU: camAxisY, basisV: camAxisZ, color: GIZMO_COLORS.x },
    y: { normal: camAxisY, basisU: camAxisZ, basisV: camAxisX, color: GIZMO_COLORS.y },
    z: { normal: camAxisZ, basisU: camAxisX, basisV: camAxisY, color: GIZMO_COLORS.z },
  };

  const rings = {};
  const RING_SEGMENTS = 48;

  for (const [key, rdef] of Object.entries(ringsDef)) {
    const points = [];
    let anyClipped = false;

    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const theta = (2 * Math.PI * i) / RING_SEGMENTS;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const ringPtCam = [
        camOrigin[0] + dist3D * (cosT * rdef.basisU[0] + sinT * rdef.basisV[0]),
        camOrigin[1] + dist3D * (cosT * rdef.basisU[1] + sinT * rdef.basisV[1]),
        camOrigin[2] + dist3D * (cosT * rdef.basisU[2] + sinT * rdef.basisV[2]),
      ];

      if (ringPtCam[2] <= near) anyClipped = true;
      const safePt = [ringPtCam[0], ringPtCam[1], Math.max(near, ringPtCam[2])];
      const screenPt = projectCameraPoint(safePt, focalLength, viewport, near);
      points.push({ x: screenPt.x, y: screenPt.y });
    }

    // Determine ring orientation sign on screen:
    // Project basis vectors u and v to screen relative to origin
    const ptUCam = [
      camOrigin[0] + dist3D * rdef.basisU[0],
      camOrigin[1] + dist3D * rdef.basisU[1],
      Math.max(near, camOrigin[2] + dist3D * rdef.basisU[2]),
    ];
    const ptVCam = [
      camOrigin[0] + dist3D * rdef.basisV[0],
      camOrigin[1] + dist3D * rdef.basisV[1],
      Math.max(near, camOrigin[2] + dist3D * rdef.basisV[2]),
    ];

    const screenU = projectCameraPoint(ptUCam, focalLength, viewport, near);
    const screenV = projectCameraPoint(ptVCam, focalLength, viewport, near);

    const dux = screenU.x - screenOrigin.x;
    const duy = screenU.y - screenOrigin.y;
    const dvx = screenV.x - screenOrigin.x;
    const dvy = screenV.y - screenOrigin.y;

    // 2D cross product: du x dv.
    // In screen coordinates (+X right, +Y down), a positive cross product means clockwise sweep is positive angle.
    const cross2D = dux * dvy - duy * dvx;
    const sign = cross2D >= 0 ? 1 : -1;

    rings[key] = {
      key,
      color: rdef.color,
      points,
      sign,
      normalCam: rdef.normal,
      // If normal points into screen (+Z in camera space), it's viewed from the positive side
      depthZ: rdef.normal[2],
      facingAway: rdef.normal[2] > 0.05,
      clipped: anyClipped,
    };
  }

  return {
    visible: true,
    behindCamera: false,
    origin: { x: screenOrigin.x, y: screenOrigin.y },
    originZ,
    scaleFactor,
    dist3D,
    handleLength: safeHandleLength,
    axes,
    rings,
    scaleCubes,
  };
}

// ─── Distance Helpers for Picking ───────────────────────────────────────────

/**
 * Distance from point (px, py) to line segment (x1, y1) - (x2, y2).
 */
export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - x1, py - y1);

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Distance from point (px, py) to a polyline array of points [{ x, y }, ...].
 */
export function distToPolyline(px, py, points) {
  if (!points || points.length === 0) return Infinity;
  let minDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = distToSegment(px, py, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Picks the gizmo handle under a screen coordinate.
 *
 * @param {object} geometry - Result of buildGizmo3DGeometry
 * @param {'move'|'rotate'|'scale'} tool - Active transform tool
 * @param {number} pointerX - Pointer X in project/canvas pixels
 * @param {number} pointerY - Pointer Y in project/canvas pixels
 * @param {number} [tolerance=12] - Pixel picking tolerance
 * @returns {string|null} Handle name or null ('move-x', 'rotate-y', 'scale-center', etc.)
 */
export function pickGizmo3DHandle(geometry, tool, pointerX, pointerY, tolerance = 12) {
  if (!geometry || !geometry.visible) return null;

  const { origin, axes, rings, scaleCubes } = geometry;

  if (tool === 'move') {
    let closestHandle = null;
    let closestDist = tolerance;

    for (const key of ['x', 'y', 'z']) {
      const axis = axes[key];
      if (axis.clipped) continue;
      const d = distToSegment(pointerX, pointerY, origin.x, origin.y, axis.tip.x, axis.tip.y);
      if (d < closestDist) {
        closestDist = d;
        closestHandle = `move-${key}`;
      }
    }
    return closestHandle;
  }

  if (tool === 'rotate') {
    let closestHandle = null;
    let closestDist = tolerance;

    for (const key of ['x', 'y', 'z']) {
      const ring = rings[key];
      const d = distToPolyline(pointerX, pointerY, ring.points);
      if (d < closestDist) {
        closestDist = d;
        closestHandle = `rotate-${key}`;
      }
    }
    return closestHandle;
  }

  if (tool === 'scale') {
    // 1. Check center cube first (box size tolerance * 1.5)
    const centerDist = Math.hypot(pointerX - scaleCubes.center.x, pointerY - scaleCubes.center.y);
    if (centerDist <= tolerance * 1.2) {
      return 'scale-center';
    }

    // 2. Check axis scale cubes
    let closestHandle = null;
    let closestDist = tolerance;

    for (const key of ['x', 'y', 'z']) {
      const cube = scaleCubes[key];
      const d = Math.hypot(pointerX - cube.x, pointerY - cube.y);
      if (d < closestDist) {
        closestDist = d;
        closestHandle = `scale-${key}`;
      }
    }

    // 3. Check stems if cubes weren't hit directly
    if (!closestHandle) {
      for (const key of ['x', 'y', 'z']) {
        const axis = axes[key];
        const d = distToSegment(pointerX, pointerY, origin.x, origin.y, axis.tip.x, axis.tip.y);
        if (d < closestDist) {
          closestDist = d;
          closestHandle = `scale-${key}`;
        }
      }
    }

    return closestHandle;
  }

  return null;
}

// ─── Drag Solvers ───────────────────────────────────────────────────────────

/**
 * Solves a 3D Move drag.
 * Converts screen drag delta along the chosen axis into a world delta, and
 * (if parentMatrix is supplied) into the parent's local space.
 */
export function solveMove3D({
  startPointer,
  currentPointer,
  handle,
  geometry,
  parentMatrix = null,
}) {
  if (!geometry || !geometry.visible) {
    return { deltaWorld: { x: 0, y: 0, z: 0 }, deltaLocal: { x: 0, y: 0, z: 0 }, distance: 0 };
  }

  const axisKey = handle.replace('move-', '').toLowerCase();
  const axis = geometry.axes[axisKey];
  if (!axis) {
    return { deltaWorld: { x: 0, y: 0, z: 0 }, deltaLocal: { x: 0, y: 0, z: 0 }, distance: 0 };
  }

  const dxScreen = currentPointer.x - startPointer.x;
  const dyScreen = currentPointer.y - startPointer.y;

  const vx = axis.dir.x;
  const vy = axis.dir.y;
  const screenLen = axis.screenLen;

  if (screenLen < 1e-4) {
    return { deltaWorld: { x: 0, y: 0, z: 0 }, deltaLocal: { x: 0, y: 0, z: 0 }, distance: 0 };
  }

  // Component of pointer delta along the screen direction of the axis
  const dispScreen = (dxScreen * vx + dyScreen * vy) / screenLen;

  // World distance moved: dist3D is the 3D length that projected to screenLen
  const worldDist = (dispScreen / screenLen) * geometry.dist3D;

  // World-space delta vector
  const deltaWorld = {
    x: worldDist * axis.unitWorld[0],
    y: worldDist * axis.unitWorld[1],
    z: worldDist * axis.unitWorld[2],
  };

  // Convert to parent local space if parented
  let deltaLocal = deltaWorld;
  if (parentMatrix && parentMatrix.length >= 16) {
    deltaLocal = mat3InvertVector(parentMatrix, deltaWorld);
  }

  return {
    axisKey,
    distance: worldDist,
    deltaWorld,
    deltaLocal,
  };
}

/**
 * Solves a 3D Rotate drag.
 * Measures the angle swept around the ring's screen center, adjusted by the
 * ring's facing sign.
 */
export function solveRotate3D({
  startPointer,
  currentPointer,
  handle,
  geometry,
}) {
  if (!geometry || !geometry.visible) {
    return { deltaAngle: 0, fieldName: 'rotation' };
  }

  const axisKey = handle.replace('rotate-', '').toLowerCase();
  const ring = geometry.rings[axisKey];
  if (!ring) {
    return { deltaAngle: 0, fieldName: 'rotation' };
  }

  const origin = geometry.origin;

  const startAngle = Math.atan2(startPointer.y - origin.y, startPointer.x - origin.x) * (180 / Math.PI);
  const currentAngle = Math.atan2(currentPointer.y - origin.y, currentPointer.x - origin.x) * (180 / Math.PI);

  let angleDiff = currentAngle - startAngle;
  // Normalize to -180..180
  while (angleDiff > 180) angleDiff -= 360;
  while (angleDiff < -180) angleDiff += 360;

  // Apply facing sign so clockwise/counter-clockwise rotates intuitively from either side
  const deltaAngle = angleDiff * ring.sign;

  const fieldName = axisKey === 'x' ? 'rotationX' : (axisKey === 'y' ? 'rotationY' : 'rotation');

  return {
    axisKey,
    deltaAngle,
    fieldName,
  };
}

/**
 * Solves a 3D Scale drag.
 * Measures distance ratio from origin along axis (or uniform drag for center cube).
 */
export function solveScale3D({
  startPointer,
  currentPointer,
  handle,
  geometry,
  startScale = { scaleX: 1, scaleY: 1, scaleZ: 1 },
  shiftKey = false,
}) {
  const sx = startScale.scaleX ?? 1;
  const sy = startScale.scaleY ?? 1;
  const sz = startScale.scaleZ ?? 1;

  if (handle === 'scale-center') {
    const dx = currentPointer.x - startPointer.x;
    const dy = currentPointer.y - startPointer.y;
    // Dragging right/up increases scale, dragging left/down decreases
    const delta = (dx - dy) / 100;
    const ratio = Math.max(0.01, 1 + delta);

    return {
      ratio,
      isUniform: true,
      nextScale: {
        scaleX: Math.max(0.01, sx * ratio),
        scaleY: Math.max(0.01, sy * ratio),
        scaleZ: Math.max(0.01, sz * ratio),
      },
    };
  }

  const axisKey = handle.replace('scale-', '').toLowerCase();
  const axis = geometry?.axes?.[axisKey];
  if (!axis || axis.screenLen < 1e-4) {
    return {
      ratio: 1,
      isUniform: shiftKey,
      nextScale: { scaleX: sx, scaleY: sy, scaleZ: sz },
    };
  }

  const origin = geometry.origin;
  const vx = axis.dir.x;
  const vy = axis.dir.y;
  const screenLen = axis.screenLen;

  // Vector from origin to current pointer projected onto axis direction
  const px = currentPointer.x - origin.x;
  const py = currentPointer.y - origin.y;
  const projDist = (px * vx + py * vy) / screenLen;

  // Ratio relative to original handle length
  const ratio = Math.max(0.01, projDist / screenLen);

  if (shiftKey) {
    // Hold Shift to keep uniform scale
    return {
      ratio,
      isUniform: true,
      nextScale: {
        scaleX: Math.max(0.01, sx * ratio),
        scaleY: Math.max(0.01, sy * ratio),
        scaleZ: Math.max(0.01, sz * ratio),
      },
    };
  }

  const nextScale = { scaleX: sx, scaleY: sy, scaleZ: sz };
  if (axisKey === 'x') nextScale.scaleX = Math.max(0.01, sx * ratio);
  else if (axisKey === 'y') nextScale.scaleY = Math.max(0.01, sy * ratio);
  else if (axisKey === 'z') nextScale.scaleZ = Math.max(0.01, sz * ratio);

  return {
    ratio,
    isUniform: false,
    nextScale,
  };
}
