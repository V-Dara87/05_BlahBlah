import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultCamera, project3DLayer, getFocalLength, orbitCamera } from './camera3d.js';

test('Camera3D - focal length calculation matches FOV', () => {
  const fl50 = getFocalLength(1080, 50);
  assert.ok(fl50 > 1000 && fl50 < 1200, `50 deg FOV at 1080p should have focal length ~1158, got ${fl50}`);

  const flWide = getFocalLength(1080, 90);
  assert.ok(flWide < fl50, 'Wide angle FOV must have shorter focal length');
});

test('Camera3D - 2D layer passthrough without projection', () => {
  const layer2d = { x: 100, y: 200, scaleX: 1, scaleY: 1, is3D: false };
  const res = project3DLayer(layer2d, null, { width: 1920, height: 1080 });
  assert.equal(res.x, 100);
  assert.equal(res.y, 200);
  assert.equal(res.scaleFactor, 1);
});

test('Camera3D - 3D layer perspective scaling: closer objects are larger', () => {
  const camera = createDefaultCamera({ position: { x: 0, y: 0, z: -1000 }, target: { x: 0, y: 0, z: 0 } });
  const viewport = { width: 1920, height: 1080 };

  // Layer A at Z = 0 (distance = 1000)
  const layerMid = { x: 0, y: 0, z: 0, scaleX: 1, scaleY: 1, is3D: true };
  const resMid = project3DLayer(layerMid, camera, viewport);

  // Layer B at Z = -500 (distance = 500, closer to camera)
  const layerClose = { x: 0, y: 0, z: -500, scaleX: 1, scaleY: 1, is3D: true };
  const resClose = project3DLayer(layerClose, camera, viewport);

  // Layer C at Z = 1000 (distance = 2000, further in background)
  const layerFar = { x: 0, y: 0, z: 1000, scaleX: 1, scaleY: 1, is3D: true };
  const resFar = project3DLayer(layerFar, camera, viewport);

  assert.ok(resClose.scaleFactor > resMid.scaleFactor, 'Closer layer must have larger scaleFactor');
  assert.ok(resMid.scaleFactor > resFar.scaleFactor, 'Farther layer must have smaller scaleFactor');
  assert.ok(resClose.zIndex > resFar.zIndex, 'Closer layer must have higher zIndex (render on top)');
});

test('Camera3D - autoOrient towards camera resets planar tilt', () => {
  const camera = createDefaultCamera();
  const viewport = { width: 1920, height: 1080 };

  const tiltedLayer = { x: 0, y: 0, z: 0, rotationX: 45, rotationY: 30, rotationZ: 10, is3D: true, autoOrient: true };
  const res = project3DLayer(tiltedLayer, camera, viewport);

  assert.equal(res.rotationX, 0, 'Auto-orient must zero out tilt relative to camera');
  assert.equal(res.rotationY, 0, 'Auto-orient must zero out pan relative to camera');
  assert.equal(res.rotationZ, 10, 'Roll rotationZ is preserved');
});

test('Camera3D - orbitCamera calculates correct circular coordinates', () => {
  const target = { x: 0, y: 0, z: 0 };
  const distance = 1000;

  // Front view (azimuth = 0, elevation = 0)
  const front = orbitCamera(target, distance, 0, 0);
  assert.ok(Math.abs(front.x) < 1e-4);
  assert.ok(Math.abs(front.y) < 1e-4);
  assert.ok(Math.abs(front.z - (-1000)) < 1e-4);

  // 90 deg side view (azimuth = 90)
  const side = orbitCamera(target, distance, 90, 0);
  assert.ok(Math.abs(side.x - 1000) < 1e-4);
  assert.ok(Math.abs(side.z) < 1e-4);
});

test('Camera3D - ECS camera component creation and schema', async () => {
  const { createCameraComponent, createCameraEntity, isCameraEntity, getCameraComponent } = await import('./ecs.js');
  const cam = createCameraEntity({ name: 'Main Camera', fov: 60 });
  assert.equal(isCameraEntity(cam), true);
  assert.equal(cam.name, 'Main Camera');
  const comp = getCameraComponent(cam);
  assert.ok(comp);
  assert.equal(comp.fov, 60);
  assert.equal(comp.position.z, -1000);
});

test('Camera3D - Inspector field groups provide 3D axes when is3D is enabled', async () => {
  const { getTransformFieldGroups } = await import('./transformSchema.js');
  const groups2d = getTransformFieldGroups(false);
  const pos2d = groups2d.find((g) => g.label === 'Position');
  assert.equal(pos2d.fields.length, 2);

  const groups3d = getTransformFieldGroups(true);
  const pos3d = groups3d.find((g) => g.label === 'Position');
  assert.equal(pos3d.fields.length, 3);
  assert.equal(pos3d.fields[2].name, 'z');

  const rot3d = groups3d.find((g) => g.label === 'Rotation');
  assert.equal(rot3d.fields.length, 3);
  assert.equal(rot3d.fields[0].name, 'rotationX');
  assert.equal(rot3d.fields[1].name, 'rotationY');
  assert.equal(rot3d.fields[2].name, 'rotation');
});

test('Camera3D - mat4LookAt transforms target to camera axis and supports pan', async () => {
  const { mat4LookAt, mat4TransformPoint } = await import('./camera3d.js');
  
  // Camera at (500, 200, -1000) looking at target (0, 0, 0)
  const eye = { x: 500, y: 200, z: -1000 };
  const target = { x: 0, y: 0, z: 0 };
  const view = mat4LookAt(eye, target, 0);

  // Target in camera space must be on the optical axis (X=0, Y=0) at positive Z distance
  const targetCam = mat4TransformPoint(view, [0, 0, 0]);
  assert.ok(Math.abs(targetCam[0]) < 1e-4, `Target X in camera view must be 0, got ${targetCam[0]}`);
  assert.ok(Math.abs(targetCam[1]) < 1e-4, `Target Y in camera view must be 0, got ${targetCam[1]}`);
  assert.ok(targetCam[2] > 1000, `Target Z must equal distance to eye (>1000), got ${targetCam[2]}`);
});

test('Camera3D - camera roll rotates view around line of sight', async () => {
  const { mat4LookAt, mat4TransformPoint } = await import('./camera3d.js');
  
  const eye = { x: 0, y: 0, z: -1000 };
  const target = { x: 0, y: 0, z: 0 };
  
  // No roll: point at (100, 0, 0) stays at X=100, Y=0
  const view0 = mat4LookAt(eye, target, 0);
  const pt0 = mat4TransformPoint(view0, [100, 0, 0]);
  assert.ok(Math.abs(pt0[0] - 100) < 1e-4);
  assert.ok(Math.abs(pt0[1]) < 1e-4);

  // 90 degree roll clockwise: point at (100, 0, 0) rotates by 90 deg (X -> -Y in view coords)
  const view90 = mat4LookAt(eye, target, (90 * Math.PI) / 180);
  const pt90 = mat4TransformPoint(view90, [100, 0, 0]);
  assert.ok(Math.abs(pt90[0]) < 1e-4, `After 90 deg roll, X should be ~0, got ${pt90[0]}`);
  assert.ok(Math.abs(pt90[1] - (-100)) < 1e-4, `After 90 deg roll, Y should be -100, got ${pt90[1]}`);
});

test('Camera3D - project3DLayer produces valid matrix3d with perspective foreshortening', () => {
  const camera = createDefaultCamera({ position: { x: 0, y: 0, z: -1000 }, target: { x: 0, y: 0, z: 0 } });
  const viewport = { width: 1920, height: 1080 };
  const tiltedLayer = { x: 0, y: 0, z: 0, rotationY: 45, is3D: true };
  const proj = project3DLayer(tiltedLayer, camera, viewport);

  assert.ok(proj.matrix3d.startsWith('matrix3d('), 'Must output CSS matrix3d');
  assert.ok(proj.cssTransform.includes('translate(-50%, -50%) matrix3d('));
  assert.ok(proj.matrix.length === 16);
  // Row 3 column 0 (proj.matrix[3]) should be non-zero because rotationY creates perspective Z slope along X
  assert.ok(Math.abs(proj.matrix[3]) > 1e-5, 'Perspective coefficient m[3] must be non-zero for tilted layer');
});

test('Camera3D - autoOrient towardsPOI points layer normal toward camera target', () => {
  const camera = createDefaultCamera({ position: { x: 0, y: 0, z: -1000 }, target: { x: 500, y: 0, z: 0 } });
  const viewport = { width: 1920, height: 1080 };
  const layer = { x: 0, y: 0, z: 0, autoOrient: 'towardsPOI', is3D: true };
  const proj = project3DLayer(layer, camera, viewport);

  // Layer at (0, 0, 0) looking toward target (500, 0, 0) must have non-zero yaw
  assert.ok(Math.abs(proj.rotationY) > 0, 'AutoOrient towardsPOI must rotate layer toward target');
});

test('Camera3D - 3D hierarchical parent-child composition', async () => {
  const { buildLayerMatrix } = await import('./camera3d.js');
  const parentTransform = { x: 200, y: 100, z: -300, rotationZ: 90, scaleX: 1, scaleY: 1, scaleZ: 1 };
  const parentMat = buildLayerMatrix(parentTransform);

  const childTransform = { x: 50, y: 0, z: 0, scaleX: 1, scaleY: 1, scaleZ: 1 };
  const childMat = buildLayerMatrix(childTransform, parentMat);

  // Child at local x=50, rotated 90 deg by parent, should have world y offset: 100 + 50 = 150
  assert.ok(Math.abs(childMat[12] - 200) < 1e-4, `Child X world should stay ~200, got ${childMat[12]}`);
  assert.ok(Math.abs(childMat[13] - 150) < 1e-4, `Child Y world should be ~150, got ${childMat[13]}`);
  assert.ok(Math.abs(childMat[14] - (-300)) < 1e-4, `Child Z world should be ~-300, got ${childMat[14]}`);
});

test('Camera3D - findActiveCamera selects top-most track and supports camera cuts', async () => {
  const { findActiveCamera } = await import('./camera3d.js');

  const tracks = [
    { id: 'track-1', name: 'Track 1' }, // Top-most
    { id: 'track-2', name: 'Track 2' }, // Second
  ];

  // Camera A on Track 2 (fov: 40)
  const camA = {
    id: 'cam-a',
    type: 'camera',
    trackId: 'track-2',
    startTime: 0,
    duration: 10,
    components: [{ type: 'Camera', fov: 40, enabled: true }],
  };

  // Camera B on Track 1 (fov: 70)
  const camB = {
    id: 'cam-b',
    type: 'camera',
    trackId: 'track-1',
    startTime: 0,
    duration: 5,
    components: [{ type: 'Camera', fov: 70, enabled: true }],
  };

  // When both are active, Camera B on Track 1 (top-most track) takes precedence
  const activeTop = findActiveCamera([camA, camB], tracks);
  assert.equal(activeTop.fov, 70, 'Top-most track camera must control view when multiple are active');

  // When Camera B finishes and only Camera A is active, Camera A controls view (instant cut)
  const activeCut = findActiveCamera([camA], tracks);
  assert.equal(activeCut.fov, 40, 'After camera B ends, camera A takes over view');
});

