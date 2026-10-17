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
