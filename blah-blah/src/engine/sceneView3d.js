import { mat4LookAt, getFocalLength, orbitCamera } from './camera3d.js';

/**
 * 3D Scene View Engine - Projection, Navigation, Camera Frustum & Wireframes.
 *
 * Provides the mathematical foundation for BlahBlah's Free-Fly 3D Scene View:
 * 1. Orbit / Pan / Dolly / WASD camera math.
 * 2. World-to-SceneView projection with near-plane line clipping.
 * 3. Active 3D Camera Frustum (wireframe pyramid + look-at target indicator).
 * 4. Entity bounding box & layer wireframes in 3D scene space.
 */

export const SCENE_VIEW_PRESETS = {
  perspective: { azimuth: 35, elevation: 25, distance: 2400, target: { x: 0, y: 0, z: 0 } },
  top: { azimuth: 0, elevation: 89.9, distance: 2400, target: { x: 0, y: 0, z: 0 } },
  front: { azimuth: 0, elevation: 0, distance: 2400, target: { x: 0, y: 0, z: 0 } },
  right: { azimuth: 90, elevation: 0, distance: 2400, target: { x: 0, y: 0, z: 0 } },
  left: { azimuth: -90, elevation: 0, distance: 2400, target: { x: 0, y: 0, z: 0 } },
  back: { azimuth: 180, elevation: 0, distance: 2400, target: { x: 0, y: 0, z: 0 } },
};

/**
 * Builds the scene view camera state and 4x4 view matrix.
 */
export function buildSceneViewCamera(orbitState = {}, viewport = { width: 1920, height: 1080 }) {
  const target = orbitState.target || { x: 0, y: 0, z: 0 };
  const distance = Math.max(100, Math.min(25000, orbitState.distance ?? 2400));
  const azimuth = orbitState.azimuth ?? 35;
  const elevation = Math.max(-89.9, Math.min(89.9, orbitState.elevation ?? 25));
  const fov = orbitState.fov ?? 50;
  const zoom = orbitState.zoom ?? 1.0;

  const W = viewport.width || 1920;
  const H = viewport.height || 1080;

  const eye = orbitCamera(target, distance, azimuth, elevation);
  const mView = mat4LookAt(eye, target, 0);
  const focalLength = getFocalLength(H, fov) * zoom;

  // Basis vectors in world space:
  // mView column 0 = right, column 1 = down, column 2 = forward
  const right = { x: mView[0], y: mView[4], z: mView[8] };
  const down = { x: mView[1], y: mView[5], z: mView[9] };
  const up = { x: -mView[1], y: -mView[5], z: -mView[9] };
  const forward = { x: mView[2], y: mView[6], z: mView[10] };

  return {
    eye,
    target,
    distance,
    azimuth,
    elevation,
    fov,
    zoom,
    mView,
    focalLength,
    viewport: { width: W, height: H },
    right,
    down,
    up,
    forward,
  };
}

/**
 * Projects a single 3D world point into Scene View screen coordinates.
 */
export function projectScenePoint(pt, sceneCam) {
  const { mView, focalLength, viewport } = sceneCam;
  const W = viewport?.width || 1920;
  const H = viewport?.height || 1080;

  const x = pt.x ?? 0;
  const y = pt.y ?? 0;
  const z = pt.z ?? 0;

  const xc = mView[0] * x + mView[4] * y + mView[8] * z + mView[12];
  const yc = mView[1] * x + mView[5] * y + mView[9] * z + mView[13];
  const zc = mView[2] * x + mView[6] * y + mView[10] * z + mView[14];

  if (zc <= 1) {
    return { visible: false, x: 0, y: 0, zc };
  }

  const s = focalLength / zc;
  return {
    visible: true,
    x: xc * s + W / 2,
    y: yc * s + H / 2,
    zc,
  };
}

/**
 * Projects a 3D line segment into Scene View screen space with near-plane clipping.
 */
export function projectSceneSegment(p1, p2, sceneCam, near = 5) {
  const { mView, focalLength, viewport } = sceneCam;
  const W = viewport?.width || 1920;
  const H = viewport?.height || 1080;

  const x1 = mView[0] * (p1.x ?? 0) + mView[4] * (p1.y ?? 0) + mView[8] * (p1.z ?? 0) + mView[12];
  const y1 = mView[1] * (p1.x ?? 0) + mView[5] * (p1.y ?? 0) + mView[9] * (p1.z ?? 0) + mView[13];
  const z1 = mView[2] * (p1.x ?? 0) + mView[6] * (p1.y ?? 0) + mView[10] * (p1.z ?? 0) + mView[14];

  const x2 = mView[0] * (p2.x ?? 0) + mView[4] * (p2.y ?? 0) + mView[8] * (p2.z ?? 0) + mView[12];
  const y2 = mView[1] * (p2.x ?? 0) + mView[5] * (p2.y ?? 0) + mView[9] * (p2.z ?? 0) + mView[13];
  const z2 = mView[2] * (p2.x ?? 0) + mView[6] * (p2.y ?? 0) + mView[10] * (p2.z ?? 0) + mView[14];

  if (z1 <= near && z2 <= near) return null;

  let cx1 = x1, cy1 = y1, cz1 = z1;
  let cx2 = x2, cy2 = y2, cz2 = z2;

  if (z1 < near) {
    const t = (near - z1) / (z2 - z1);
    cx1 = x1 + t * (x2 - x1);
    cy1 = y1 + t * (y2 - y1);
    cz1 = near;
  }
  if (z2 < near) {
    const t = (near - z2) / (z1 - z2);
    cx2 = x2 + t * (x1 - x2);
    cy2 = y2 + t * (y1 - y2);
    cz2 = near;
  }

  const s1 = focalLength / cz1;
  const sx1 = cx1 * s1 + W / 2;
  const sy1 = cy1 * s1 + H / 2;

  const s2 = focalLength / cz2;
  const sx2 = cx2 * s2 + W / 2;
  const sy2 = cy2 * s2 + H / 2;

  return { sx1, sy1, sx2, sy2, z1: cz1, z2: cz2 };
}

/**
 * Builds the wireframe geometry for the active project camera in 3D Scene View.
 */
export function buildCameraFrustumGeometry(activeCamera, sceneCam) {
  if (!activeCamera) return null;

  const eye = activeCamera.position || { x: 0, y: 0, z: -1000 };
  const target = activeCamera.target || { x: 0, y: 0, z: 0 };
  const rollRad = ((activeCamera.roll || 0) * Math.PI) / 180;
  const fov = activeCamera.fov || 50;
  const zoom = activeCamera.zoom || 1.0;

  // Camera forward line-of-sight
  let fx = target.x - eye.x;
  let fy = target.y - eye.y;
  let fz = target.z - eye.z;
  let dist = Math.hypot(fx, fy, fz);
  if (dist < 1e-4) {
    fx = 0; fy = 0; fz = 1; dist = 800;
  } else {
    fx /= dist; fy /= dist; fz /= dist;
  }

  // Camera view matrix to get exact right & down orientation in world space
  const camView = mat4LookAt(eye, target, rollRad);
  const right = { x: camView[0], y: camView[4], z: camView[8] };
  const down = { x: camView[1], y: camView[5], z: camView[9] };

  // Frustum dimensions at target distance
  const frustumDist = Math.max(300, dist);
  const fovRad = (Math.max(10, Math.min(150, fov)) * Math.PI) / 180;
  const aspect = (sceneCam.viewport?.width || 1920) / (sceneCam.viewport?.height || 1080);
  const halfH = frustumDist * Math.tan(fovRad / 2) / zoom;
  const halfW = halfH * aspect;

  // Base corners at frustum distance
  const baseCenter = {
    x: eye.x + fx * frustumDist,
    y: eye.y + fy * frustumDist,
    z: eye.z + fz * frustumDist,
  };

  const corners = [
    // Top-Left
    {
      x: baseCenter.x - right.x * halfW - down.x * halfH,
      y: baseCenter.y - right.y * halfW - down.y * halfH,
      z: baseCenter.z - right.z * halfW - down.z * halfH,
    },
    // Top-Right
    {
      x: baseCenter.x + right.x * halfW - down.x * halfH,
      y: baseCenter.y + right.y * halfW - down.y * halfH,
      z: baseCenter.z + right.z * halfW - down.z * halfH,
    },
    // Bottom-Right
    {
      x: baseCenter.x + right.x * halfW + down.x * halfH,
      y: baseCenter.y + right.y * halfW + down.y * halfH,
      z: baseCenter.z + right.z * halfW + down.z * halfH,
    },
    // Bottom-Left
    {
      x: baseCenter.x - right.x * halfW + down.x * halfH,
      y: baseCenter.y - right.y * halfW + down.y * halfH,
      z: baseCenter.z - right.z * halfW + down.z * halfH,
    },
  ];

  // Project rays from eye to corners
  const raySegments = corners
    .map((c) => projectSceneSegment(eye, c, sceneCam))
    .filter(Boolean);

  // Project base outline connecting 4 corners
  const baseSegments = [
    projectSceneSegment(corners[0], corners[1], sceneCam),
    projectSceneSegment(corners[1], corners[2], sceneCam),
    projectSceneSegment(corners[2], corners[3], sceneCam),
    projectSceneSegment(corners[3], corners[0], sceneCam),
  ].filter(Boolean);

  // Project line of sight (eye to target)
  const targetRay = projectSceneSegment(eye, target, sceneCam);

  // Project eye and target points
  const eyeProj = projectScenePoint(eye, sceneCam);
  const targetProj = projectScenePoint(target, sceneCam);

  return {
    eye,
    target,
    eyeProj,
    targetProj,
    raySegments,
    baseSegments,
    targetRay,
  };
}

/**
 * Builds wireframe outlines for active entities in 3D Scene View.
 */
export function buildEntitiesWireframes(computedEntities = [], sceneCam, selectedEntityId = null) {
  const result = [];

  for (const item of computedEntities) {
    const { entity, is3D, projectedTransform, transform } = item;
    const isSelected = entity.id === selectedEntityId;

    // Use entity model matrix if available, or build basic planar quad
    const modelMatrix = projectedTransform?.modelMatrix;
    const width = item.layerBox?.width || (entity.components?.find((c) => c.width)?.width) || 180;
    const height = item.layerBox?.height || (entity.components?.find((c) => c.height)?.height) || 180;
    const halfW = width / 2;
    const halfH = height / 2;

    let worldCorners = [];

    if (modelMatrix) {
      const localCorners = [
        [-halfW, -halfH, 0],
        [halfW, -halfH, 0],
        [halfW, halfH, 0],
        [-halfW, halfH, 0],
      ];
      worldCorners = localCorners.map(([lx, ly, lz]) => ({
        x: modelMatrix[0] * lx + modelMatrix[4] * ly + modelMatrix[8] * lz + modelMatrix[12],
        y: modelMatrix[1] * lx + modelMatrix[5] * ly + modelMatrix[9] * lz + modelMatrix[13],
        z: modelMatrix[2] * lx + modelMatrix[6] * ly + modelMatrix[10] * lz + modelMatrix[14],
      }));
    } else {
      // 2D entity on Z=0 plane
      const tx = transform?.x ?? 0;
      const ty = transform?.y ?? 0;
      const tz = transform?.z ?? 0;
      worldCorners = [
        { x: tx - halfW, y: ty - halfH, z: tz },
        { x: tx + halfW, y: ty - halfH, z: tz },
        { x: tx + halfW, y: ty + halfH, z: tz },
        { x: tx - halfW, y: ty + halfH, z: tz },
      ];
    }

    const segments = [
      projectSceneSegment(worldCorners[0], worldCorners[1], sceneCam),
      projectSceneSegment(worldCorners[1], worldCorners[2], sceneCam),
      projectSceneSegment(worldCorners[2], worldCorners[3], sceneCam),
      projectSceneSegment(worldCorners[3], worldCorners[0], sceneCam),
    ].filter(Boolean);

    // Entity center point
    const centerWorld = {
      x: (worldCorners[0].x + worldCorners[2].x) / 2,
      y: (worldCorners[0].y + worldCorners[2].y) / 2,
      z: (worldCorners[0].z + worldCorners[2].z) / 2,
    };
    const centerProj = projectScenePoint(centerWorld, sceneCam);

    result.push({
      id: entity.id,
      name: entity.name || 'Entity',
      is3D: Boolean(is3D),
      isSelected,
      segments,
      centerProj,
      depthZ: centerProj.zc || 0,
    });
  }

  // Sort by depth from back to front
  return result.sort((a, b) => b.depthZ - a.depthZ);
}
