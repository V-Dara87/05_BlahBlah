/**
 * Camera3D - After Effects-style 3D Layer & Camera Matrix Projection Engine.
 *
 * Implements:
 * 1. 2-Node Camera (Position + Point of Interest / Target) with full 4x4 View Matrix (LookAt).
 * 2. Camera Roll (Z-rotation) around line of sight.
 * 3. 4x4 Layer Model Matrix (Translation, Euler Rotations X/Y/Z, Scale, Pivot, Parent-Child composition).
 * 4. Perspective Projection with CSS matrix3d generation (true trapezoidal perspective foreshortening).
 * 5. Auto-Orientation: 'towardsCamera' (billboard facing camera plane) and 'towardsPOI' (facing target).
 * 6. Top-most Active Camera resolution with instant cut switching.
 *
 * Coordinate Convention (After Effects / Screen-aligned Right-Handed):
 * - X: Horizontal (positive = right, negative = left)
 * - Y: Vertical (positive = down, negative = up, matching screen pixels)
 * - Z: Depth (positive = forward into background, negative = closer to camera / foreground)
 */

// ─── 4x4 Matrix Mathematics (Column-Major) ───────────────────────────────────

/**
 * Returns a new 4x4 identity matrix as a 16-element array.
 */
export function mat4Identity() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/**
 * Multiplies two 4x4 matrices (a * b) in column-major order.
 */
export function mat4Multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4 + 0];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    out[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

/**
 * Returns a 4x4 translation matrix.
 */
export function mat4Translation(x, y, z) {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

/**
 * Returns a 4x4 scaling matrix.
 */
export function mat4Scaling(sx, sy, sz = 1) {
  return [
    sx, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, sz, 0,
    0, 0, 0, 1,
  ];
}

/**
 * Returns a 4x4 rotation matrix around the X axis (pitch).
 */
export function mat4RotationX(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ];
}

/**
 * Returns a 4x4 rotation matrix around the Y axis (yaw).
 */
export function mat4RotationY(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ];
}

/**
 * Returns a 4x4 rotation matrix around the Z axis (roll).
 */
export function mat4RotationZ(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/**
 * Constructs a 4x4 Camera View Matrix looking from `eye` to `target`.
 * Supports camera roll (rotation around forward line-of-sight).
 */
export function mat4LookAt(eye, target, rollRad = 0) {
  const ex = eye?.x ?? 0;
  const ey = eye?.y ?? 0;
  const ez = eye?.z ?? -1000;

  const tx = target?.x ?? 0;
  const ty = target?.y ?? 0;
  const tz = target?.z ?? 0;

  // Forward vector pointing from eye to target
  let fx = tx - ex;
  let fy = ty - ey;
  let fz = tz - ez;
  let len = Math.hypot(fx, fy, fz);
  if (len < 1e-6) {
    fx = 0;
    fy = 0;
    fz = 1;
  } else {
    fx /= len;
    fy /= len;
    fz /= len;
  }

  // World down reference (+Y is down in screen coordinates)
  let refDx = 0;
  let refDy = 1;
  let refDz = 0;
  if (Math.abs(fy) > 0.9999) {
    refDx = 0;
    refDy = 0;
    refDz = fy > 0 ? -1 : 1;
  }

  // Right = cross(refDown, forward)
  let rx = refDy * fz - refDz * fy;
  let ry = refDz * fx - refDx * fz;
  let rz = refDx * fy - refDy * fx;
  let rlen = Math.hypot(rx, ry, rz);
  if (rlen < 1e-6) {
    rx = 1; ry = 0; rz = 0;
  } else {
    rx /= rlen; ry /= rlen; rz /= rlen;
  }

  // True down = cross(forward, right)
  let dx = fy * rz - fz * ry;
  let dy = fz * rx - fx * rz;
  let dz = fx * ry - fy * rx;

  // Apply camera roll around the forward vector
  if (rollRad !== 0) {
    const cosR = Math.cos(rollRad);
    const sinR = Math.sin(rollRad);

    const nrx = rx * cosR + dx * sinR;
    const nry = ry * cosR + dy * sinR;
    const nrz = rz * cosR + dz * sinR;

    const ndx = -rx * sinR + dx * cosR;
    const ndy = -ry * sinR + dy * cosR;
    const ndz = -rz * sinR + dz * cosR;

    rx = nrx; ry = nry; rz = nrz;
    dx = ndx; dy = ndy; dz = ndz;
  }

  // Column-major view matrix: maps world point P -> camera point P_cam
  return [
    rx, dx, fx, 0,
    ry, dy, fy, 0,
    rz, dz, fz, 0,
    -(rx * ex + ry * ey + rz * ez),
    -(dx * ex + dy * ey + dz * ez),
    -(fx * ex + fy * ey + fz * ez),
    1,
  ];
}

/**
 * Transforms a 3D point through a 4x4 matrix with perspective division.
 */
export function mat4TransformPoint(m, pt) {
  const x = pt[0] ?? 0;
  const y = pt[1] ?? 0;
  const z = pt[2] ?? 0;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  const invW = Math.abs(w) > 1e-9 ? 1 / w : 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) * invW,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) * invW,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) * invW,
  ];
}

/**
 * Formats a 16-element column-major array into a CSS `matrix3d(...)` function string.
 */
export function mat4ToCSS(m) {
  const formatted = m.map((v) => (Math.abs(v) < 1e-7 ? 0 : Number(v.toFixed(6))));
  return `matrix3d(${formatted.join(',')})`;
}

// ─── Camera Configuration & Utilities ────────────────────────────────────────

export function createDefaultCamera(overrides = {}) {
  return {
    type: 'Camera',
    // Position of the camera in 3D world space
    position: { x: 0, y: 0, z: -1000, ...(overrides.position || {}) },
    // Point of Interest (Target) the camera looks at
    target: { x: 0, y: 0, z: 0, ...(overrides.target || {}) },
    // Camera roll angle in degrees
    roll: overrides.roll ?? 0,
    // Field of view in degrees (50 deg is a standard ~50mm lens)
    fov: overrides.fov ?? 50,
    // Optical zoom multiplier
    zoom: overrides.zoom ?? 1.0,
    // Whether this camera is actively controlling the viewport
    enabled: overrides.enabled !== false,
  };
}

/**
 * Calculates focal length in pixels based on viewport height and FOV.
 */
export function getFocalLength(viewportHeight, fovDegrees = 50) {
  const fovRad = (Math.max(1, Math.min(170, fovDegrees)) * Math.PI) / 180;
  return (viewportHeight / 2) / Math.tan(fovRad / 2);
}

/**
 * Resolves the active camera for the current frame.
 * Priority rule (After Effects convention):
 * Selects the camera active at `time` on the top-most track (smallest track index in `tracks`).
 * Supports instant cut switching between cameras across the timeline.
 */
export function findActiveCamera(activeEntities = [], tracks = [], worldMap = new Map(), localMap = new Map()) {
  const camEntities = activeEntities.filter((e) => {
    return e.type === 'camera' || e.components?.some((c) => c.type === 'Camera');
  });

  if (camEntities.length === 0) return null;

  // Sort by top-most track: track index 0 is top-most track (Track 1)
  const sorted = [...camEntities].sort((a, b) => {
    const idxA = tracks.findIndex((t) => t.id === a.trackId);
    const idxB = tracks.findIndex((t) => t.id === b.trackId);
    const validA = idxA === -1 ? 999999 : idxA;
    const validB = idxB === -1 ? 999999 : idxB;
    if (validA !== validB) return validA - validB;
    return (a.startTime ?? 0) - (b.startTime ?? 0);
  });

  for (const entity of sorted) {
    const camComp = entity.components?.find((c) => c.type === 'Camera');
    if (camComp && camComp.enabled !== false) {
      const camWorld = worldMap.get(entity.id) || localMap.get(entity.id)?.localTransform;
      const posX = camComp.positionX ?? camComp.position?.x ?? 0;
      const posY = camComp.positionY ?? camComp.position?.y ?? 0;
      const posZ = camComp.positionZ ?? camComp.position?.z ?? -1000;
      const tgtX = camComp.targetX ?? camComp.target?.x ?? 0;
      const tgtY = camComp.targetY ?? camComp.target?.y ?? 0;
      const tgtZ = camComp.targetZ ?? camComp.target?.z ?? 0;
      const roll = camComp.roll ?? camWorld?.rotation ?? 0;

      return {
        ...camComp,
        entityId: entity.id,
        position: {
          x: (camWorld?.x ?? 0) + posX,
          y: (camWorld?.y ?? 0) + posY,
          z: (camWorld?.z ?? 0) + posZ,
        },
        target: { x: tgtX, y: tgtY, z: tgtZ },
        roll,
        fov: camComp.fov ?? 50,
        zoom: camComp.zoom ?? 1.0,
      };
    }
  }

  return null;
}

/**
 * Builds the 4x4 Model Matrix for a layer, optionally composed with a 3D parent.
 */
export function buildLayerMatrix(layerTransform, parentMatrix = null) {
  const lx = layerTransform.x ?? 0;
  const ly = layerTransform.y ?? 0;
  const lz = layerTransform.z ?? 0;

  const rx = ((layerTransform.rotationX ?? 0) * Math.PI) / 180;
  const ry = ((layerTransform.rotationY ?? 0) * Math.PI) / 180;
  const rz = (((layerTransform.rotationZ ?? layerTransform.rotation ?? 0)) * Math.PI) / 180;

  const sx = layerTransform.scaleX ?? 1;
  const sy = layerTransform.scaleY ?? 1;
  const sz = layerTransform.scaleZ ?? 1;

  const px = layerTransform.pivotX ?? 0;
  const py = layerTransform.pivotY ?? 0;
  const pz = layerTransform.pivotZ ?? 0;

  // Local model matrix: Translate(pos + pivot) * RotZ * RotY * RotX * Scale * Translate(-pivot)
  const mTrans = mat4Translation(lx + px, ly + py, lz + pz);
  const mRotZ = mat4RotationZ(rz);
  const mRotY = mat4RotationY(ry);
  const mRotX = mat4RotationX(rx);
  const mScale = mat4Scaling(sx, sy, sz);
  const mInvPivot = mat4Translation(-px, -py, -pz);

  let localModel = mat4Multiply(mTrans, mRotZ);
  localModel = mat4Multiply(localModel, mRotY);
  localModel = mat4Multiply(localModel, mRotX);
  localModel = mat4Multiply(localModel, mScale);
  localModel = mat4Multiply(localModel, mInvPivot);

  if (parentMatrix) {
    return mat4Multiply(parentMatrix, localModel);
  }
  return localModel;
}

/**
 * Projects a 3D layer into screen-space 2D coordinates, depth metrics,
 * and a full 4x4 CSS matrix3d transform with perspective foreshortening.
 *
 * @param {object} layerTransform - The layer's 3D transform { x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, is3D, autoOrient }
 * @param {object} camera - Camera component or default camera
 * @param {{ width: number, height: number }} viewport - Project resolution
 * @param {number[]} [parentMatrix] - Optional 4x4 parent world matrix
 * @returns {object} Projected screen transform, depth metrics, and matrix3d CSS
 */
export function project3DLayer(layerTransform, camera, viewport, parentMatrix = null) {
  if (!layerTransform?.is3D) {
    // 2D fallback: passthrough
    return {
      x: layerTransform?.x ?? 0,
      y: layerTransform?.y ?? 0,
      scaleX: layerTransform?.scaleX ?? 1,
      scaleY: layerTransform?.scaleY ?? 1,
      rotation: layerTransform?.rotation ?? layerTransform?.rotationZ ?? 0,
      opacity: layerTransform?.opacity ?? 1,
      zIndex: 0,
      inFrontOfCamera: true,
      scaleFactor: 1,
    };
  }

  const cam = camera || createDefaultCamera();
  const camPos = cam.position || { x: 0, y: 0, z: -1000 };
  const camTarget = cam.target || { x: 0, y: 0, z: 0 };
  const camRollRad = ((cam.roll ?? 0) * Math.PI) / 180;
  const fov = cam.fov || 50;
  const zoom = cam.zoom || 1.0;

  const vpW = viewport?.width || 1920;
  const vpH = viewport?.height || 1080;
  const focalLength = getFocalLength(vpH, fov) * zoom;

  // 1. Build Camera View Matrix (lookAt)
  const mView = mat4LookAt(camPos, camTarget, camRollRad);

  // 2. Handle Auto-Orient options
  let effectiveTransform = { ...layerTransform };
  if (layerTransform.autoOrient === 'towardsCamera' || layerTransform.autoOrient === true) {
    // Billboard: orient normal directly towards the camera plane.
    // In camera space, this cancels out rotationX and rotationY, preserving only in-plane rotationZ (roll).
    // In world space, we orient the layer rotation matrix to match the camera's inverse rotation.
    effectiveTransform.rotationX = 0;
    effectiveTransform.rotationY = 0;
  } else if (layerTransform.autoOrient === 'towardsPOI') {
    // Orient towards Point of Interest / Target
    const lx = layerTransform.x ?? 0;
    const ly = layerTransform.y ?? 0;
    const lz = layerTransform.z ?? 0;
    const dx = camTarget.x - lx;
    const dy = camTarget.y - ly;
    const dz = camTarget.z - lz;
    const distXZ = Math.hypot(dx, dz);
    if (distXZ > 1e-4) {
      effectiveTransform.rotationY = (Math.atan2(dx, dz) * 180) / Math.PI;
      effectiveTransform.rotationX = (Math.atan2(-dy, distXZ) * 180) / Math.PI;
    }
  }

  // 3. Build Layer World Matrix
  const mModel = buildLayerMatrix(effectiveTransform, parentMatrix);

  // 4. Transform to Camera Space: mCam = mView * mModel
  const mCam = mat4Multiply(mView, mModel);

  // Layer center in camera space: local [0, 0, 0, 1] transformed by mCam
  const centerX = mCam[12];
  const centerY = mCam[13];
  const centerZ = mCam[14];

  // Near clipping check: layer must be in front of camera
  const inFrontOfCamera = centerZ > 1;
  const safeZ = Math.max(1, centerZ);
  const scaleFactor = focalLength / safeZ;

  // Screen coordinates centered on viewport
  const screenX = centerX * scaleFactor + (vpW / 2);
  const screenY = centerY * scaleFactor + (vpH / 2);

  // Decomposed scales and rotations
  const col0Len = Math.hypot(mCam[0], mCam[1], mCam[2]);
  const col1Len = Math.hypot(mCam[4], mCam[5], mCam[6]);
  const scaleX = col0Len * scaleFactor;
  const scaleY = col1Len * scaleFactor;

  const rotZ = (Math.atan2(mCam[1], mCam[0]) * 180) / Math.PI;
  const rotY = (Math.atan2(mCam[2], Math.hypot(mCam[0], mCam[1])) * 180) / Math.PI;
  const rotX = (Math.atan2(mCam[6], mCam[10]) * 180) / Math.PI;

  // 5. Build CSS matrix3d with true 3D perspective foreshortening
  // Maps local element point (u, v, 0, 1) directly into screen pixels relative to viewport center
  const mCSS = [
    mCam[0], mCam[1], 0, mCam[2] / focalLength,
    mCam[4], mCam[5], 0, mCam[6] / focalLength,
    0, 0, 1, 0,
    centerX, centerY, 0, centerZ / focalLength,
  ];

  const matrix3dStr = mat4ToCSS(mCSS);
  const cssTransform = `translate(-50%, -50%) ${matrix3dStr}`;

  return {
    screenX,
    screenY,
    scaleFactor,
    scaleX,
    scaleY,
    rotationX: rotX,
    rotationY: rotY,
    rotationZ: rotZ,
    rotation: rotZ,
    opacity: layerTransform.opacity ?? 1,
    zIndex: Math.round(100000 - centerZ),
    inFrontOfCamera,
    distanceToCamera: Math.hypot(centerX, centerY, centerZ),
    matrix: mCSS,
    matrix3d: matrix3dStr,
    cssTransform,
    cssTransformZeroOrigin: matrix3dStr,
    modelMatrix: mModel,
    viewMatrix: mView,
    camMatrix: mCam,
    focalLength,
  };
}

/**
 * Computes camera orbit position given target, distance, azimuth, and elevation.
 * Allows intuitive Orbit / Turntable camera animation.
 */
export function orbitCamera(target, distance, azimuthDeg, elevationDeg) {
  const azRad = (azimuthDeg * Math.PI) / 180;
  const elRad = (elevationDeg * Math.PI) / 180;

  const x = target.x + distance * Math.cos(elRad) * Math.sin(azRad);
  const y = target.y - distance * Math.sin(elRad);
  const z = target.z - distance * Math.cos(elRad) * Math.cos(azRad);

  return { x, y, z };
}
