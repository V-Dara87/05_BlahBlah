import { mat4LookAt, getFocalLength } from './camera3d.js';

/**
 * Generates and draws an infinite-style 3D Ground Grid on the Y=0 plane.
 *
 * Implements:
 * 1. World Y=0 plane grid generation with major / minor line stepping.
 * 2. True 3D camera projection with near-plane segment clipping.
 * 3. Distance-based alpha fade so grid lines smoothly fall off into the horizon.
 * 4. Highlighted world axes (X = red, Z = blue).
 */

/**
 * Projects a 3D line segment in world space (y=0) to screen space using the camera.
 * Returns null if the segment is completely behind the camera near plane.
 */
export function projectGroundSegment(p1, p2, mView, focalLength, viewport, near = 5) {
  const W = viewport?.width || 1920;
  const H = viewport?.height || 1080;

  // Convert p1 to camera space
  const x1 = mView[0] * p1.x + mView[4] * (p1.y ?? 0) + mView[8] * p1.z + mView[12];
  const y1 = mView[1] * p1.x + mView[5] * (p1.y ?? 0) + mView[9] * p1.z + mView[13];
  let z1 = mView[2] * p1.x + mView[6] * (p1.y ?? 0) + mView[10] * p1.z + mView[14];

  // Convert p2 to camera space
  const x2 = mView[0] * p2.x + mView[4] * (p2.y ?? 0) + mView[8] * p2.z + mView[12];
  const y2 = mView[1] * p2.x + mView[5] * (p2.y ?? 0) + mView[9] * p2.z + mView[13];
  let z2 = mView[2] * p2.x + mView[6] * (p2.y ?? 0) + mView[10] * p2.z + mView[14];

  // If both behind near plane, clip completely
  if (z1 <= near && z2 <= near) return null;

  let clippedX1 = x1;
  let clippedY1 = y1;
  let clippedZ1 = z1;
  let clippedX2 = x2;
  let clippedY2 = y2;
  let clippedZ2 = z2;

  // Clip p1 against near plane
  if (z1 < near) {
    const t = (near - z1) / (z2 - z1);
    clippedX1 = x1 + t * (x2 - x1);
    clippedY1 = y1 + t * (y2 - y1);
    clippedZ1 = near;
  }

  // Clip p2 against near plane
  if (z2 < near) {
    const t = (near - z2) / (z1 - z2);
    clippedX2 = x2 + t * (x1 - x2);
    clippedY2 = y2 + t * (y1 - y2);
    clippedZ2 = near;
  }

  const s1 = focalLength / clippedZ1;
  const sx1 = clippedX1 * s1 + W / 2;
  const sy1 = clippedY1 * s1 + H / 2;

  const s2 = focalLength / clippedZ2;
  const sx2 = clippedX2 * s2 + W / 2;
  const sy2 = clippedY2 * s2 + H / 2;

  return {
    sx1,
    sy1,
    sx2,
    sy2,
    z1: clippedZ1,
    z2: clippedZ2,
  };
}

/**
 * Draws the ground grid on a 2D canvas context.
 *
 * @param {CanvasRenderingContext2D} ctx - HTML5 2D canvas context
 * @param {object} camera - Camera parameters { position, target, roll, fov, zoom }
 * @param {{ width: number, height: number }} viewport - Project resolution
 * @param {object} [options] - Customization options
 */
export function drawGroundGrid(ctx, camera, viewport, options = {}) {
  if (!ctx || !camera) return;

  const camPos = camera.position || { x: 0, y: 0, z: -1000 };
  const camTarget = camera.target || { x: 0, y: 0, z: 0 };
  const rollRad = ((camera.roll ?? 0) * Math.PI) / 180;
  const fov = camera.fov || 50;
  const zoom = camera.zoom || 1.0;

  const W = viewport?.width || 1920;
  const H = viewport?.height || 1080;
  const focalLength = getFocalLength(H, fov) * zoom;
  const mView = mat4LookAt(camPos, camTarget, rollRad);

  const step = options.gridSpacing || 100;
  const majorStep = options.majorSpacing || 500;
  const extent = options.gridExtent || 3500;
  const segmentLen = options.segmentLength || 500;
  const fadeDist = options.fadeDistance || 3800;

  // Center the grid around nearest multiple of majorStep to camera target
  const centerX = Math.round(camTarget.x / majorStep) * majorStep;
  const centerZ = Math.round(camTarget.z / majorStep) * majorStep;

  const minX = centerX - extent;
  const maxX = centerX + extent;
  const minZ = centerZ - extent;
  const maxZ = centerZ + extent;

  ctx.save();
  ctx.lineCap = 'round';

  const drawSegment = (p1, p2, isAxis, isMajor, axisType) => {
    // Distance from camera eye to segment midpoint
    const midX = (p1.x + p2.x) / 2;
    const midZ = (p1.z + p2.z) / 2;
    const dist = Math.hypot(midX - camPos.x, (p1.y ?? 0) - camPos.y, midZ - camPos.z);

    if (dist > fadeDist) return;
    const fade = Math.max(0, 1 - (dist / fadeDist) ** 1.6);
    if (fade < 0.015) return;

    const proj = projectGroundSegment(p1, p2, mView, focalLength, viewport, 5);
    if (!proj) return;

    // Check bounds: skip segments entirely outside screen by a large margin
    const pad = 200;
    if (
      (proj.sx1 < -pad && proj.sx2 < -pad) ||
      (proj.sx1 > W + pad && proj.sx2 > W + pad) ||
      (proj.sy1 < -pad && proj.sy2 < -pad) ||
      (proj.sy1 > H + pad && proj.sy2 > H + pad)
    ) {
      return;
    }

    ctx.beginPath();
    ctx.moveTo(proj.sx1, proj.sy1);
    ctx.lineTo(proj.sx2, proj.sy2);

    if (isAxis) {
      if (axisType === 'x') {
        ctx.strokeStyle = `rgba(248, 113, 113, ${0.7 * fade})`; // Red X
        ctx.lineWidth = 1.8;
      } else {
        ctx.strokeStyle = `rgba(96, 165, 250, ${0.7 * fade})`; // Blue Z
        ctx.lineWidth = 1.8;
      }
    } else if (isMajor) {
      ctx.strokeStyle = `rgba(148, 163, 184, ${0.35 * fade})`; // Major grid lines
      ctx.lineWidth = 1.2;
    } else {
      ctx.strokeStyle = `rgba(100, 116, 139, ${0.18 * fade})`; // Minor grid lines
      ctx.lineWidth = 0.8;
    }

    ctx.stroke();
  };

  // 1. Lines parallel to X axis (constant Z, varying X)
  for (let z = minZ; z <= maxZ; z += step) {
    const isAxis = z === 0;
    const isMajor = z % majorStep === 0;
    for (let x = minX; x < maxX; x += segmentLen) {
      const nextX = Math.min(maxX, x + segmentLen);
      drawSegment({ x, y: 0, z }, { x: nextX, y: 0, z }, isAxis, isMajor, 'x');
    }
  }

  // 2. Lines parallel to Z axis (constant X, varying Z)
  for (let x = minX; x <= maxX; x += step) {
    const isAxis = x === 0;
    const isMajor = x % majorStep === 0;
    for (let z = minZ; z < maxZ; z += segmentLen) {
      const nextZ = Math.min(maxZ, z + segmentLen);
      drawSegment({ x, y: 0, z }, { x, y: 0, z: nextZ }, isAxis, isMajor, 'z');
    }
  }

  ctx.restore();
}
