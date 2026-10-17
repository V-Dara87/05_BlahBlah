/**
 * Camera3D - After Effects-style 2.5D Layer & Camera Projection Engine.
 *
 * Implements a 2-Node Camera (Position + Point of Interest / Target) with Perspective Projection.
 * Layers marked with `is3D: true` exist in 3D coordinate space (X, Y, Z, RotationX, RotationY, RotationZ).
 *
 * Coordinate Convention:
 * - X: Horizontal (positive = right, negative = left)
 * - Y: Vertical (positive = down, negative = up, matching screen coords)
 * - Z: Depth (negative = closer to viewer / foreground, 0 = screen plane, positive = deep background)
 */

export function createDefaultCamera(overrides = {}) {
  return {
    type: 'Camera',
    // Position of the camera in 3D world space
    position: { x: 0, y: 0, z: -1000, ...(overrides.position || {}) },
    // Point of Interest (Target) the camera looks at
    target: { x: 0, y: 0, z: 0, ...(overrides.target || {}) },
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
 * Projects a 3D layer transform into screen-space 2D coordinates and scale,
 * observed through the given camera.
 *
 * @param {object} layerTransform - The layer's 3D transform { x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, is3D, autoOrient }
 * @param {object} camera - Camera component or default camera
 * @param {{ width: number, height: number }} viewport - Project resolution
 * @returns {object} Projected screen transform and depth metrics
 */
export function project3DLayer(layerTransform, camera, viewport) {
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
  const fov = cam.fov || 50;
  const zoom = cam.zoom || 1.0;

  const vpW = viewport?.width || 1920;
  const vpH = viewport?.height || 1080;
  const focalLength = getFocalLength(vpH, fov) * zoom;

  // Layer world coordinates
  const lx = layerTransform.x ?? 0;
  const ly = layerTransform.y ?? 0;
  const lz = layerTransform.z ?? 0;

  // Relative to camera position
  const dx = lx - camPos.x;
  const dy = ly - camPos.y;
  const dz = lz - camPos.z;

  // If layer is behind camera, mark as culled
  const inFrontOfCamera = dz > 1;
  const safeDz = Math.max(1, dz);
  const scaleFactor = (focalLength / safeDz);

  // Screen coordinates centered on viewport
  const screenX = dx * scaleFactor + (vpW / 2);
  const screenY = dy * scaleFactor + (vpH / 2);

  // Combined scale
  const scaleX = (layerTransform.scaleX ?? 1) * scaleFactor;
  const scaleY = (layerTransform.scaleY ?? 1) * scaleFactor;

  // Rotation: If auto-orient towards camera is enabled, align normal with camera vector
  let rx = layerTransform.rotationX ?? 0;
  let ry = layerTransform.rotationY ?? 0;
  let rz = layerTransform.rotationZ ?? layerTransform.rotation ?? 0;

  if (layerTransform.autoOrient === 'towardsCamera' || layerTransform.autoOrient === true) {
    // Face directly forward relative to camera view angle
    rx = 0;
    ry = 0;
  }

  return {
    screenX,
    screenY,
    scaleFactor,
    scaleX,
    scaleY,
    rotationX: rx,
    rotationY: ry,
    rotationZ: rz,
    rotation: rz,
    opacity: layerTransform.opacity ?? 1,
    // In AE, layers with higher Z (further) render behind layers with lower Z (closer)
    zIndex: Math.round(100000 - lz),
    inFrontOfCamera,
    distanceToCamera: Math.sqrt(dx * dx + dy * dy + dz * dz),
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
