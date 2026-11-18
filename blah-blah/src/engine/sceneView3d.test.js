import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSceneViewCamera,
  projectScenePoint,
  projectSceneSegment,
  buildCameraFrustumGeometry,
  buildEntitiesWireframes,
  projectEntitiesForSceneView,
  SCENE_VIEW_PRESETS,
} from './sceneView3d.js';

test('SceneView3D - buildSceneViewCamera computes valid eye, target, and view matrix', () => {
  const cam = buildSceneViewCamera(SCENE_VIEW_PRESETS.perspective, { width: 1920, height: 1080 });
  assert.ok(cam.eye, 'Should have computed eye position');
  assert.ok(cam.mView.length === 16, 'Should have 4x4 view matrix');
  assert.ok(cam.focalLength > 0, 'Focal length should be positive');
});

test('SceneView3D - projectScenePoint correctly projects point in front of camera', () => {
  const cam = buildSceneViewCamera(SCENE_VIEW_PRESETS.perspective, { width: 1920, height: 1080 });
  const origin = projectScenePoint({ x: 0, y: 0, z: 0 }, cam);
  assert.equal(origin.visible, true);
  // Target is at (0,0,0), so it should project right at viewport center (960, 540)
  assert.ok(Math.abs(origin.x - 960) < 1e-3, `Origin X should be 960, got ${origin.x}`);
  assert.ok(Math.abs(origin.y - 540) < 1e-3, `Origin Y should be 540, got ${origin.y}`);
});

test('SceneView3D - buildCameraFrustumGeometry constructs valid frustum rays and corners', () => {
  const sceneCam = buildSceneViewCamera(SCENE_VIEW_PRESETS.perspective, { width: 1920, height: 1080 });
  const activeCamera = {
    position: { x: 0, y: -200, z: -1000 },
    target: { x: 0, y: 0, z: 0 },
    fov: 50,
    zoom: 1,
  };

  const frustum = buildCameraFrustumGeometry(activeCamera, sceneCam);
  assert.ok(frustum, 'Frustum should not be null');
  assert.equal(frustum.raySegments.length, 4, 'Should have 4 corner ray segments');
  assert.equal(frustum.baseSegments.length, 4, 'Should have 4 base outline segments');
  assert.ok(frustum.eyeProj.visible, 'Camera eye should be visible from scene camera');
});

test('SceneView3D - buildEntitiesWireframes generates bounding segments', () => {
  const sceneCam = buildSceneViewCamera(SCENE_VIEW_PRESETS.perspective, { width: 1920, height: 1080 });
  const mockEntities = [
    {
      entity: { id: 'layer-1', name: 'Title Card', components: [{ width: 400, height: 200 }] },
      transform: { x: 100, y: 50, z: 0 },
      is3D: false,
    },
  ];

  const wireframes = buildEntitiesWireframes(mockEntities, sceneCam, 'layer-1');
  assert.equal(wireframes.length, 1);
  assert.equal(wireframes[0].isSelected, true);
  assert.ok(wireframes[0].segments.length > 0, 'Entity should have projected wireframe segments');
});

test('SceneView3D - projectEntitiesForSceneView projects both 2D and 3D layers with matrix3d', () => {
  const sceneCam = buildSceneViewCamera(SCENE_VIEW_PRESETS.perspective, { width: 1920, height: 1080 });
  const mockEntities = [
    {
      entity: { id: 'layer-2d', name: 'Text 2D', components: [] },
      transform: { x: 0, y: 0, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      is3D: false,
    },
    {
      entity: { id: 'layer-3d', name: 'Card 3D', components: [] },
      localTransform: { x: 100, y: -50, z: 200, rotationX: 10, rotationY: 20, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
      is3D: true,
    },
  ];

  const projected = projectEntitiesForSceneView(mockEntities, sceneCam, { width: 1920, height: 1080 });
  assert.equal(projected.length, 2);
  assert.equal(projected[0].is3D, true);
  assert.ok(projected[0].projectedTransform.cssTransform.includes('matrix3d'));
  assert.equal(projected[1].is3D, true);
  assert.ok(projected[1].projectedTransform.cssTransform.includes('matrix3d'));
});
