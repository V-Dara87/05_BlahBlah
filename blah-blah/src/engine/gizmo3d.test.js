import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGizmo3DGeometry,
  pickGizmo3DHandle,
  solveMove3D,
  solveRotate3D,
  solveScale3D,
  getDrawnLayerKind,
  get3DLayerKind,
  isFlatLayer,
  isMeshLayer,
  has3DGizmo,
  buildLayerGizmo3DGeometry,
  buildLayerBoxOutline,
  solveBodyDrag3D,
} from './gizmo3d.js';
import {
  createDefaultCamera,
  project3DLayer,
  buildLayerMatrix,
} from './camera3d.js';

const VIEWPORT = { width: 1920, height: 1080 };

test('Gizmo3D - axis directions with default camera', () => {
  const camera = createDefaultCamera();
  const layer = { x: 0, y: 0, z: 0, is3D: true };
  const proj = project3DLayer(layer, camera, VIEWPORT);

  const geom = buildGizmo3DGeometry({
    camMatrix: proj.camMatrix,
    viewMatrix: proj.viewMatrix,
    modelMatrix: proj.modelMatrix,
    focalLength: proj.focalLength,
    viewport: VIEWPORT,
    handleLength: 80,
  });

  assert.ok(geom.visible, 'Gizmo should be visible');
  assert.equal(geom.behindCamera, false, 'Should not be behind camera');

  // Origin at screen centre (960, 540)
  assert.ok(Math.abs(geom.origin.x - 960) < 1e-4, `Expected origin.x 960, got ${geom.origin.x}`);
  assert.ok(Math.abs(geom.origin.y - 540) < 1e-4, `Expected origin.y 540, got ${geom.origin.y}`);

  // X axis points right: +X on screen (tip.x > origin.x, tip.y == origin.y)
  const tipX = geom.axes.x.tip;
  assert.ok(tipX.x > geom.origin.x, 'X tip should point right');
  assert.ok(Math.abs(tipX.y - geom.origin.y) < 1e-4, 'X tip Y should equal origin Y');
  assert.ok(Math.abs(geom.axes.x.screenLen - 80) < 1e-4, `X screenLen should be 80, got ${geom.axes.x.screenLen}`);

  // Y axis points down in screen coords: +Y on screen (tip.y > origin.y, tip.x == origin.x)
  const tipY = geom.axes.y.tip;
  assert.ok(tipY.y > geom.origin.y, 'Y tip should point down');
  assert.ok(Math.abs(tipY.x - geom.origin.x) < 1e-4, 'Y tip X should equal origin X');
  assert.ok(Math.abs(geom.axes.y.screenLen - 80) < 1e-4, `Y screenLen should be 80, got ${geom.axes.y.screenLen}`);

  // Z axis points straight into screen with default camera looking along +Z:
  // camera depth is +Z, so tip projects onto center or foreshortened
  assert.ok(geom.axes.z.depthZ > 0.99, 'Z axis camera depth direction should be along line of sight');
});

test('Gizmo3D - constant-size behavior at two depths', () => {
  const camera = createDefaultCamera();

  // Depth 1: layer at Z = 0 (distance to camera = 1000)
  const layer1 = { x: 0, y: 0, z: 0, is3D: true };
  const proj1 = project3DLayer(layer1, camera, VIEWPORT);
  const geom1 = buildGizmo3DGeometry({
    camMatrix: proj1.camMatrix,
    viewMatrix: proj1.viewMatrix,
    modelMatrix: proj1.modelMatrix,
    focalLength: proj1.focalLength,
    viewport: VIEWPORT,
    handleLength: 80,
  });

  // Depth 2: layer at Z = 1500 (distance to camera = 2500)
  const layer2 = { x: 0, y: 0, z: 1500, is3D: true };
  const proj2 = project3DLayer(layer2, camera, VIEWPORT);
  const geom2 = buildGizmo3DGeometry({
    camMatrix: proj2.camMatrix,
    viewMatrix: proj2.viewMatrix,
    modelMatrix: proj2.modelMatrix,
    focalLength: proj2.focalLength,
    viewport: VIEWPORT,
    handleLength: 80,
  });

  // Both should have screen length 80px for X and Y axes
  assert.ok(Math.abs(geom1.axes.x.screenLen - 80) < 1e-3, `geom1 X screenLen should be 80, got ${geom1.axes.x.screenLen}`);
  assert.ok(Math.abs(geom2.axes.x.screenLen - 80) < 1e-3, `geom2 X screenLen should be 80, got ${geom2.axes.x.screenLen}`);
  assert.ok(Math.abs(geom1.axes.y.screenLen - 80) < 1e-3, `geom1 Y screenLen should be 80, got ${geom1.axes.y.screenLen}`);
  assert.ok(Math.abs(geom2.axes.y.screenLen - 80) < 1e-3, `geom2 Y screenLen should be 80, got ${geom2.axes.y.screenLen}`);

  // The 3D distance in camera space must scale with depth
  assert.ok(geom2.dist3D > geom1.dist3D * 2, 'Farther layer must have larger 3D handle radius to maintain constant screen size');
});

test('Gizmo3D - ring sign for each axis and flip when facing away', () => {
  const camera = createDefaultCamera();
  const layerFront = { x: 0, y: 0, z: 0, rotationY: 0, is3D: true };
  const projFront = project3DLayer(layerFront, camera, VIEWPORT);
  const geomFront = buildGizmo3DGeometry({
    camMatrix: projFront.camMatrix,
    viewMatrix: projFront.viewMatrix,
    modelMatrix: projFront.modelMatrix,
    focalLength: projFront.focalLength,
    viewport: VIEWPORT,
  });

  // Z ring faces camera directly -> positive sign (+1)
  assert.equal(geomFront.rings.z.sign, 1, 'Z ring facing camera should have sign +1');

  // Rotate layer 180 deg around Y so it faces backwards
  const layerBack = { x: 0, y: 0, z: 0, rotationY: 180, is3D: true };
  const projBack = project3DLayer(layerBack, camera, VIEWPORT);
  const geomBack = buildGizmo3DGeometry({
    camMatrix: projBack.camMatrix,
    viewMatrix: projBack.viewMatrix,
    modelMatrix: projBack.modelMatrix,
    focalLength: projBack.focalLength,
    viewport: VIEWPORT,
  });

  // Facing flipped -> ring sign flips to -1
  assert.equal(geomBack.rings.z.sign, -1, 'Z ring facing away from camera should have sign -1');
});

test('Gizmo3D - near-plane clipping hides layer behind camera', () => {
  const camera = createDefaultCamera({ position: { x: 0, y: 0, z: -1000 } });

  // Camera is at z = -1000 looking towards +Z. Near plane = 1.
  // A layer at z = -1050 is behind the camera eye (-1050 - (-1000) = -50 in camera space)
  const layerBehind = { x: 0, y: 0, z: -1050, is3D: true };
  const projBehind = project3DLayer(layerBehind, camera, VIEWPORT, { near: 10 });
  const geomBehind = buildGizmo3DGeometry({
    camMatrix: projBehind.camMatrix,
    viewMatrix: projBehind.viewMatrix,
    modelMatrix: projBehind.modelMatrix,
    focalLength: projBehind.focalLength,
    viewport: VIEWPORT,
    near: 10,
  });

  assert.equal(geomBehind.visible, false, 'Layer behind near plane must have visible = false');
  assert.equal(geomBehind.behindCamera, true, 'Layer behind near plane must have behindCamera = true');
});

test('Gizmo3D - round trip: drag then re-project lands under pointer', () => {
  const camera = createDefaultCamera();
  const layer = { x: 100, y: 50, z: 200, is3D: true };
  const proj = project3DLayer(layer, camera, VIEWPORT);

  const geom = buildGizmo3DGeometry({
    camMatrix: proj.camMatrix,
    viewMatrix: proj.viewMatrix,
    modelMatrix: proj.modelMatrix,
    focalLength: proj.focalLength,
    viewport: VIEWPORT,
    handleLength: 80,
  });

  const startScreenX = geom.origin.x;
  const startScreenY = geom.origin.y;

  // Simulate dragging the X axis handle by +60px horizontally on screen
  const dragDeltaX = 60;
  const startPointer = { x: startScreenX + 80, y: startScreenY };
  const currentPointer = { x: startScreenX + 80 + dragDeltaX, y: startScreenY };

  const moveRes = solveMove3D({
    startPointer,
    currentPointer,
    handle: 'move-x',
    geometry: geom,
  });

  // Apply world delta to layer
  const updatedLayer = {
    ...layer,
    x: layer.x + moveRes.deltaWorld.x,
    y: layer.y + moveRes.deltaWorld.y,
    z: layer.z + moveRes.deltaWorld.z,
  };

  const reprojected = project3DLayer(updatedLayer, camera, VIEWPORT);

  // The re-projected origin must land exactly startScreenX + dragDeltaX
  assert.ok(
    Math.abs(reprojected.screenX - (startScreenX + dragDeltaX)) < 1e-3,
    `Expected screenX ${startScreenX + dragDeltaX}, got ${reprojected.screenX}`
  );
  assert.ok(
    Math.abs(reprojected.screenY - startScreenY) < 1e-3,
    `Expected screenY ${startScreenY}, got ${reprojected.screenY}`
  );
});

test('Gizmo3D - handle picking for Move, Rotate, Scale', () => {
  const camera = createDefaultCamera();
  const layer = { x: 0, y: 0, z: 0, is3D: true };
  const proj = project3DLayer(layer, camera, VIEWPORT);

  const geom = buildGizmo3DGeometry({
    camMatrix: proj.camMatrix,
    viewMatrix: proj.viewMatrix,
    modelMatrix: proj.modelMatrix,
    focalLength: proj.focalLength,
    viewport: VIEWPORT,
    handleLength: 80,
  });

  const ox = geom.origin.x; // 960
  const oy = geom.origin.y; // 540

  // 1. Move tool picking
  // Near midpoint of X axis (960 + 40, 540)
  assert.equal(pickGizmo3DHandle(geom, 'move', ox + 40, oy, 10), 'move-x');
  // Near midpoint of Y axis (960, 540 + 40)
  assert.equal(pickGizmo3DHandle(geom, 'move', ox, oy + 40, 10), 'move-y');
  // Far away
  assert.equal(pickGizmo3DHandle(geom, 'move', ox + 200, oy + 200, 10), null);

  // 2. Rotate tool picking
  // Point on Z ring at 45 degrees where X and Y rings are far from it
  const rDiag = 80 * Math.SQRT1_2;
  assert.equal(pickGizmo3DHandle(geom, 'rotate', ox + rDiag, oy + rDiag, 10), 'rotate-z');

  // 3. Scale tool picking
  // Center cube
  assert.equal(pickGizmo3DHandle(geom, 'scale', ox, oy, 10), 'scale-center');
  // X cube at tip
  assert.equal(pickGizmo3DHandle(geom, 'scale', ox + 80, oy, 10), 'scale-x');
  // Y cube at tip
  assert.equal(pickGizmo3DHandle(geom, 'scale', ox, oy + 80, 10), 'scale-y');
});

test('Gizmo3D - parent-local conversion for parented layers', () => {
  // Parent rotated 90 degrees around Z and scaled 2x
  const parentTransform = { x: 100, y: 200, z: 0, rotation: 90, scaleX: 2, scaleY: 2, scaleZ: 1, is3D: true };
  const parentMatrix = buildLayerMatrix(parentTransform);

  const childTransform = { x: 50, y: 0, z: 0, is3D: true };

  const camera = createDefaultCamera();
  const proj = project3DLayer(childTransform, camera, VIEWPORT, { parentMatrix });

  const geom = buildGizmo3DGeometry({
    camMatrix: proj.camMatrix,
    viewMatrix: proj.viewMatrix,
    modelMatrix: proj.modelMatrix,
    focalLength: proj.focalLength,
    viewport: VIEWPORT,
    handleLength: 80,
  });

  // Because parent is rotated 90 deg around Z, the child's local X axis points DOWN (+Y) on screen!
  // Drag along the axis direction (downward by 40px)
  const res = solveMove3D({
    startPointer: { x: geom.origin.x, y: geom.origin.y },
    currentPointer: { x: geom.origin.x, y: geom.origin.y + 40 },
    handle: 'move-x',
    geometry: geom,
    parentMatrix,
  });

  // The world delta is in +Y direction (downward)
  assert.ok(res.deltaWorld.y > 0, 'World delta Y should be positive');

  // When transformed by parent's inverse (parent rotated 90 deg, scale 2x),
  // world +Y maps to parent-local +X, scaled by 1/2
  assert.ok(res.deltaLocal.x > 0, 'Local delta should map to local X');
  assert.ok(Math.abs(res.deltaLocal.y) < 1e-4, 'Local delta Y should be zero');
  assert.ok(Math.abs(res.deltaLocal.x - res.deltaWorld.y / 2) < 1e-3, 'Local delta X should be half of world Y due to 2x scale');
});

test('Gizmo3D - mesh center aligns with gizmo origin for cube, cylinder, pyramid, sphere', () => {
  const camera = createDefaultCamera();
  const layer = { x: 120, y: -80, z: 300, is3D: true };
  const proj = project3DLayer(layer, camera, VIEWPORT);

  const geom = buildGizmo3DGeometry({
    camMatrix: proj.camMatrix,
    viewMatrix: proj.viewMatrix,
    modelMatrix: proj.modelMatrix,
    focalLength: proj.focalLength,
    viewport: VIEWPORT,
  });

  // Verify that for all 3D shapes, the mesh center [0, 0, 0] projects to the exact same screen pixel
  // as the gizmo's origin.
  const meshOriginCam = [proj.camMatrix[12], proj.camMatrix[13], proj.camMatrix[14]];
  const factor = proj.focalLength / meshOriginCam[2];
  const meshScreenX = meshOriginCam[0] * factor + VIEWPORT.width / 2;
  const meshScreenY = meshOriginCam[1] * factor + VIEWPORT.height / 2;

  assert.ok(Math.abs(geom.origin.x - meshScreenX) < 1e-4, 'Gizmo origin X must sit exactly on mesh center');
  assert.ok(Math.abs(geom.origin.y - meshScreenY) < 1e-4, 'Gizmo origin Y must sit exactly on mesh center');
  assert.ok(Math.abs(geom.origin.x - proj.screenX) < 1e-4, 'Gizmo origin X must match projectedTransform.screenX');
  assert.ok(Math.abs(geom.origin.y - proj.screenY) < 1e-4, 'Gizmo origin Y must match projectedTransform.screenY');
});

test('Gizmo3D - move each axis affects only the matching world direction', () => {
  const camera = createDefaultCamera();
  const layer = { x: 0, y: 0, z: 0, is3D: true };
  const proj = project3DLayer(layer, camera, VIEWPORT);
  const geom = buildGizmo3DGeometry({
    camMatrix: proj.camMatrix,
    viewMatrix: proj.viewMatrix,
    modelMatrix: proj.modelMatrix,
    focalLength: proj.focalLength,
    viewport: VIEWPORT,
  });

  // Move X
  const resX = solveMove3D({
    startPointer: { x: geom.origin.x, y: geom.origin.y },
    currentPointer: { x: geom.origin.x + 50, y: geom.origin.y },
    handle: 'move-x',
    geometry: geom,
  });
  assert.ok(resX.deltaWorld.x > 0, 'Moving X arrow should change X');
  assert.equal(resX.deltaWorld.y, 0, 'Moving X arrow should not change Y');
  assert.equal(resX.deltaWorld.z, 0, 'Moving X arrow should not change Z');

  // Move Y
  const resY = solveMove3D({
    startPointer: { x: geom.origin.x, y: geom.origin.y },
    currentPointer: { x: geom.origin.x, y: geom.origin.y + 50 },
    handle: 'move-y',
    geometry: geom,
  });
  assert.ok(resY.deltaWorld.y > 0, 'Moving Y arrow should change Y');
  assert.equal(resY.deltaWorld.x, 0, 'Moving Y arrow should not change X');
  assert.equal(resY.deltaWorld.z, 0, 'Moving Y arrow should not change Z');
});

test('Gizmo3D - rotate rings update only their matching Euler field', () => {
  const camera = createDefaultCamera();
  const layer = { x: 0, y: 0, z: 0, is3D: true };
  const proj = project3DLayer(layer, camera, VIEWPORT);
  const geom = buildGizmo3DGeometry({
    camMatrix: proj.camMatrix,
    viewMatrix: proj.viewMatrix,
    modelMatrix: proj.modelMatrix,
    focalLength: proj.focalLength,
    viewport: VIEWPORT,
  });

  const ox = geom.origin.x;
  const oy = geom.origin.y;

  const rotX = solveRotate3D({
    startPointer: { x: ox, y: oy - 80 },
    currentPointer: { x: ox + 80, y: oy },
    handle: 'rotate-x',
    geometry: geom,
  });
  assert.equal(rotX.fieldName, 'rotationX', 'X ring must target rotationX field');

  const rotY = solveRotate3D({
    startPointer: { x: ox, y: oy - 80 },
    currentPointer: { x: ox + 80, y: oy },
    handle: 'rotate-y',
    geometry: geom,
  });
  assert.equal(rotY.fieldName, 'rotationY', 'Y ring must target rotationY field');

  const rotZ = solveRotate3D({
    startPointer: { x: ox, y: oy - 80 },
    currentPointer: { x: ox + 80, y: oy },
    handle: 'rotate-z',
    geometry: geom,
  });
  assert.equal(rotZ.fieldName, 'rotation', 'Z ring must target rotation (Z) field');
});

test('Gizmo3D - scale per-axis, center cube uniform, Shift uniform, and non-zero clamping', () => {
  const camera = createDefaultCamera();
  const layer = { x: 0, y: 0, z: 0, is3D: true };
  const proj = project3DLayer(layer, camera, VIEWPORT);
  const geom = buildGizmo3DGeometry({
    camMatrix: proj.camMatrix,
    viewMatrix: proj.viewMatrix,
    modelMatrix: proj.modelMatrix,
    focalLength: proj.focalLength,
    viewport: VIEWPORT,
  });

  const startScale = { scaleX: 1, scaleY: 1, scaleZ: 1 };

  // 1. Scale X axis only (double length from 80px to 160px)
  const scX = solveScale3D({
    startPointer: { x: geom.origin.x + 80, y: geom.origin.y },
    currentPointer: { x: geom.origin.x + 160, y: geom.origin.y },
    handle: 'scale-x',
    geometry: geom,
    startScale,
    shiftKey: false,
  });
  assert.ok(Math.abs(scX.nextScale.scaleX - 2) < 1e-3, 'Scale X should double');
  assert.equal(scX.nextScale.scaleY, 1, 'Scale Y should remain unchanged');
  assert.equal(scX.nextScale.scaleZ, 1, 'Scale Z should remain unchanged');

  // 2. Scale center cube (uniform)
  const scCenter = solveScale3D({
    startPointer: { x: geom.origin.x, y: geom.origin.y },
    currentPointer: { x: geom.origin.x + 50, y: geom.origin.y - 50 },
    handle: 'scale-center',
    geometry: geom,
    startScale,
  });
  assert.ok(scCenter.isUniform, 'Center cube must be uniform scale');
  assert.equal(scCenter.nextScale.scaleX, scCenter.nextScale.scaleY, 'X and Y must scale equally');
  assert.equal(scCenter.nextScale.scaleY, scCenter.nextScale.scaleZ, 'Y and Z must scale equally');

  // 3. Shift key keeps uniform scale even when dragging single axis handle
  const scShift = solveScale3D({
    startPointer: { x: geom.origin.x + 80, y: geom.origin.y },
    currentPointer: { x: geom.origin.x + 160, y: geom.origin.y },
    handle: 'scale-x',
    geometry: geom,
    startScale,
    shiftKey: true,
  });
  assert.ok(scShift.isUniform, 'Shift key must enforce uniform scaling');
  assert.ok(Math.abs(scShift.nextScale.scaleX - 2) < 1e-3, 'Scale X should double');
  assert.ok(Math.abs(scShift.nextScale.scaleY - 2) < 1e-3, 'Scale Y should double with Shift');
  assert.ok(Math.abs(scShift.nextScale.scaleZ - 2) < 1e-3, 'Scale Z should double with Shift');

  // 4. Clamping: dragging past origin towards negative never collapses to zero or negative
  const scClamp = solveScale3D({
    startPointer: { x: geom.origin.x + 80, y: geom.origin.y },
    currentPointer: { x: geom.origin.x - 200, y: geom.origin.y },
    handle: 'scale-x',
    geometry: geom,
    startScale,
    shiftKey: false,
  });
  assert.ok(scClamp.nextScale.scaleX >= 0.01, 'Scale must never drop below 0.01');
});

test('Gizmo3D - works with non-1920x1080 resolutions (720p, 4K, portrait 9:16)', () => {
  const camera = createDefaultCamera();
  const resolutions = [
    { width: 1280, height: 720 },
    { width: 3840, height: 2160 },
    { width: 1080, height: 1920 }, // Portrait
  ];

  for (const vp of resolutions) {
    const layer = { x: 0, y: 0, z: 0, is3D: true };
    const proj = project3DLayer(layer, camera, vp);
    const geom = buildGizmo3DGeometry({
      camMatrix: proj.camMatrix,
      viewMatrix: proj.viewMatrix,
      modelMatrix: proj.modelMatrix,
      focalLength: proj.focalLength,
      viewport: vp,
      handleLength: 80,
    });

    assert.ok(Math.abs(geom.origin.x - vp.width / 2) < 1e-4, `Origin X should be ${vp.width / 2}`);
    assert.ok(Math.abs(geom.origin.y - vp.height / 2) < 1e-4, `Origin Y should be ${vp.height / 2}`);
    assert.ok(Math.abs(geom.axes.x.screenLen - 80) < 1e-3, 'Screen length should remain 80px');
  }
});

// ─── Layer classification ───────────────────────────────────────────────────

const entityOf = (components, extra = {}) => ({ id: 'e1', name: 'E', components, ...extra });
const transform = (is3D = true) => ({ type: 'Transform', x: 0, y: 0, z: 0, is3D });

test('Gizmo3D - classification: drawn layers are Flat, 3D primitives are Mesh', () => {
  const video = entityOf([transform(), { type: 'VideoRenderer' }], { type: 'video' });
  const text = entityOf([transform(), { type: 'TextRenderer', text: 'Hi' }]);
  const rect = entityOf([transform(), { type: 'ShapeRenderer', shapeType: 'rect' }]);
  const circle = entityOf([transform(), { type: 'ShapeRenderer', shapeType: 'circle' }]);
  const canvasScript = entityOf([transform(), { type: 'ScriptComponent', scriptName: 'A' }]);
  const reactScript = entityOf([transform(), { type: 'ScriptComponent', scriptName: 'B', enabled: true }]);
  const mono = entityOf([transform(), { type: 'MonoBehaviour', scriptName: 'C' }]);

  for (const [name, entity] of Object.entries({ video, text, rect, circle, canvasScript, reactScript, mono })) {
    assert.equal(getDrawnLayerKind(entity), 'flat', `${name} should be a Flat layer`);
    assert.equal(get3DLayerKind(entity, true), 'flat', `${name} with 3D mode on should be a Flat 3D Layer`);
    assert.equal(isFlatLayer(entity, true), true);
    assert.equal(isMeshLayer(entity, true), false);
  }

  for (const shapeType of ['cube', 'cylinder', 'pyramid', 'sphere']) {
    const mesh = entityOf([transform(), { type: 'ShapeRenderer', shapeType }]);
    assert.equal(getDrawnLayerKind(mesh), 'mesh', `${shapeType} should be a Mesh layer`);
    assert.equal(get3DLayerKind(mesh, true), 'mesh');
    assert.equal(isMeshLayer(mesh, true), true);
    assert.equal(isFlatLayer(mesh, true), false);
  }
});

test('Gizmo3D - classification: Camera, Audio, Subtitle, Transition and empty parents are not eligible', () => {
  const cameraByType = entityOf([transform()], { type: 'camera' });
  const cameraByComponent = entityOf([transform(), { type: 'Camera' }]);
  const audioByType = entityOf([transform(), { type: 'AudioSource' }], { type: 'audio' });
  const audioByComponent = entityOf([transform(), { type: 'AudioSource' }]);
  const subtitle = entityOf([transform(), { type: 'SubtitleTrack', phrases: [] }]);
  const transitionClip = entityOf([{ type: 'TransitionClipComponent', preset: 'fade' }], { type: 'transition' });
  const emptyParent = entityOf([transform()]);
  const noComponents = entityOf([]);
  const disabledScript = entityOf([transform(), { type: 'ScriptComponent', scriptName: 'X', enabled: false }]);

  const ineligible = {
    cameraByType, cameraByComponent, audioByType, audioByComponent,
    subtitle, transitionClip, emptyParent, noComponents, disabledScript,
  };
  for (const [name, entity] of Object.entries(ineligible)) {
    assert.equal(getDrawnLayerKind(entity), null, `${name} should not be a drawn layer`);
    assert.equal(get3DLayerKind(entity, true), null, `${name} should not get a 3D gizmo even with 3D mode on`);
    assert.equal(isFlatLayer(entity, true), false);
    assert.equal(isMeshLayer(entity, true), false);
  }

  assert.equal(getDrawnLayerKind(null), null);
  assert.equal(getDrawnLayerKind(undefined), null);
});

test('Gizmo3D - classification: a 3D Layer needs 3D mode on', () => {
  const video = entityOf([transform(false), { type: 'VideoRenderer' }], { type: 'video' });
  const cube = entityOf([transform(false), { type: 'ShapeRenderer', shapeType: 'cube' }]);

  assert.equal(get3DLayerKind(video, false), null);
  assert.equal(get3DLayerKind(video, undefined), null);
  assert.equal(get3DLayerKind(cube, false), null);
  assert.equal(isFlatLayer(video, false), false);
  assert.equal(isMeshLayer(cube, false), false);

  // The drawn kind itself does not depend on 3D mode.
  assert.equal(getDrawnLayerKind(video), 'flat');
  assert.equal(getDrawnLayerKind(cube), 'mesh');
});

// ─── 3D gizmo for a Video layer (Flat Layer) ────────────────────────────────

const videoEntity = () => entityOf([transform(), { type: 'VideoRenderer' }], { type: 'video' });

test('Gizmo3D - has3DGizmo: every 3D Layer with 3D mode on, never with 3D mode off', () => {
  const cube = entityOf([transform(), { type: 'ShapeRenderer', shapeType: 'cube' }]);
  assert.equal(has3DGizmo(cube, true), true);
  assert.equal(has3DGizmo(videoEntity(), true), true);

  const flatLayers = {
    text: entityOf([transform(), { type: 'TextRenderer', text: 'Hi' }]),
    rect: entityOf([transform(), { type: 'ShapeRenderer', shapeType: 'rect' }]),
    circle: entityOf([transform(), { type: 'ShapeRenderer', shapeType: 'circle' }]),
    canvasScript: entityOf([transform(), { type: 'ScriptComponent', scriptName: 'A' }]),
    reactScript: entityOf([transform(), { type: 'ScriptComponent', scriptName: 'B', enabled: true }]),
    mono: entityOf([transform(), { type: 'MonoBehaviour', scriptName: 'C' }]),
  };
  for (const [name, entity] of Object.entries(flatLayers)) {
    assert.equal(has3DGizmo(entity, true), true, `${name} with 3D mode on gets the 3D gizmo`);
    assert.equal(has3DGizmo(entity, false), false, `${name} with 3D mode off keeps the 2D gizmo`);
  }

  assert.equal(has3DGizmo(videoEntity(), false), false, '2D video keeps the 2D gizmo');
  assert.equal(has3DGizmo(cube, false), false);

  const subtitle = entityOf([transform(), { type: 'SubtitleTrack', phrases: [] }]);
  const transitionClip = entityOf([{ type: 'TransitionClipComponent', preset: 'fade' }], { type: 'transition' });
  const emptyParent = entityOf([transform()]);
  assert.equal(has3DGizmo(subtitle, true), false);
  assert.equal(has3DGizmo(transitionClip, true), false);
  assert.equal(has3DGizmo(emptyParent, true), false);

  const camera = entityOf([transform(), { type: 'Camera' }]);
  const audio = entityOf([transform(), { type: 'AudioSource' }], { type: 'audio' });
  assert.equal(has3DGizmo(camera, true), false);
  assert.equal(has3DGizmo(audio, true), false);
});

function projectLayer(layer, extra = {}) {
  const camera = createDefaultCamera();
  const pivotBase = extra.pivotBase || { width: VIEWPORT.width, height: VIEWPORT.height };
  return project3DLayer({ is3D: true, ...layer }, camera, VIEWPORT, { pivotBase, box: VIEWPORT, ...extra });
}

test('Gizmo3D - Flat Layer geometry has no Z-scale handle and Mesh keeps it', () => {
  // Turned about Y so the Z handle points away from the centre on screen.
  const proj = projectLayer({ x: 100, y: -50, z: 200, rotationY: 50 });

  const flat = buildLayerGizmo3DGeometry(proj, VIEWPORT, { flat: true });
  const mesh = buildLayerGizmo3DGeometry(proj, VIEWPORT, { flat: false });

  assert.equal(flat.visible, true);
  assert.equal(flat.flat, true);
  assert.equal(flat.scaleCubes.z, undefined, 'flat layer must have no Z-scale cube');
  assert.ok(flat.scaleCubes.x && flat.scaleCubes.y && flat.scaleCubes.center, 'X, Y and centre scale remain');
  assert.ok(flat.axes.z, 'the Z move arrow and Z rotate ring still exist');
  assert.ok(flat.rings.z);

  assert.ok(mesh.scaleCubes.z, 'mesh layer keeps the Z-scale cube');

  // Picking at the spot where the Z cube would be does not grab a Z-scale handle on a flat layer.
  const zTip = mesh.scaleCubes.z;
  assert.equal(pickGizmo3DHandle(mesh, 'scale', zTip.x, zTip.y), 'scale-z');
  assert.notEqual(pickGizmo3DHandle(flat, 'scale', zTip.x, zTip.y), 'scale-z');
});

test('Gizmo3D - Flat Layer scale never changes scaleZ', () => {
  const proj = projectLayer({ x: 0, y: 0, z: 0 });
  const geometry = buildLayerGizmo3DGeometry(proj, VIEWPORT, { flat: true });
  const start = { scaleX: 1, scaleY: 1, scaleZ: 3 };
  const o = geometry.origin;

  const center = solveScale3D({
    startPointer: o,
    currentPointer: { x: o.x + 100, y: o.y },
    handle: 'scale-center',
    geometry,
    startScale: start,
    flat: true,
  });
  assert.ok(center.nextScale.scaleX > 1 && center.nextScale.scaleY > 1);
  assert.equal(center.nextScale.scaleZ, 3);

  const shift = solveScale3D({
    startPointer: geometry.scaleCubes.x,
    currentPointer: { x: geometry.scaleCubes.x.x + 40, y: geometry.scaleCubes.x.y },
    handle: 'scale-x',
    geometry,
    startScale: start,
    shiftKey: true,
    flat: true,
  });
  assert.equal(shift.nextScale.scaleZ, 3);

  const z = solveScale3D({
    startPointer: o,
    currentPointer: { x: o.x + 100, y: o.y },
    handle: 'scale-z',
    geometry,
    startScale: start,
    flat: true,
  });
  assert.deepEqual(z.nextScale, { scaleX: 1, scaleY: 1, scaleZ: 3 });

  // Mesh behaviour is unchanged.
  const mesh = solveScale3D({
    startPointer: o,
    currentPointer: { x: o.x + 100, y: o.y },
    handle: 'scale-center',
    geometry,
    startScale: start,
  });
  assert.ok(mesh.nextScale.scaleZ > 3);
});

test('Gizmo3D - Flat Layer gizmo origin sits on the pivot, whatever the rotation and scale', () => {
  const layer = { x: 100, y: 50, z: 0, pivotX: 0.25, pivotY: -0.1, rotationZ: 30, rotationY: 20, scaleX: 2, scaleY: 0.5 };
  const proj = projectLayer(layer);

  const flat = buildLayerGizmo3DGeometry(proj, VIEWPORT, { flat: true });

  // The pivot is a fixed point of the layer's own transform: it lands at
  // position + pivot (in px), so a plain un-rotated, un-scaled layer placed there projects to the same pixel.
  const probe = projectLayer({
    x: layer.x + layer.pivotX * VIEWPORT.width,
    y: layer.y + layer.pivotY * VIEWPORT.height,
    z: 0,
  });
  assert.ok(Math.abs(flat.origin.x - probe.screenX) < 1e-3, `origin.x ${flat.origin.x} vs pivot ${probe.screenX}`);
  assert.ok(Math.abs(flat.origin.y - probe.screenY) < 1e-3, `origin.y ${flat.origin.y} vs pivot ${probe.screenY}`);

  // Without a pivot the origin stays on the layer centre (Mesh behaviour).
  const mesh = buildLayerGizmo3DGeometry(proj, VIEWPORT, { flat: false });
  assert.ok(Math.abs(mesh.origin.x - proj.screenX) < 1e-3);
  assert.ok(Math.abs(mesh.origin.y - proj.screenY) < 1e-3);

  // Zero pivot: both agree.
  const noPivot = projectLayer({ x: 100, y: 50, z: 0, rotationZ: 30 });
  const flatNoPivot = buildLayerGizmo3DGeometry(noPivot, VIEWPORT, { flat: true });
  assert.ok(Math.abs(flatNoPivot.origin.x - noPivot.screenX) < 1e-3);
  assert.ok(Math.abs(flatNoPivot.origin.y - noPivot.screenY) < 1e-3);
});

test('Gizmo3D - Layer Box outline is the projected quad the layer renders into', () => {
  const proj = projectLayer({ x: 120, y: -40, z: 300, rotationY: 25, rotationX: 10 });
  const outline = buildLayerBoxOutline(proj, VIEWPORT);

  assert.equal(outline.visible, true);
  assert.equal(outline.points.length, 4);
  assert.ok(proj.fullyInFront);
  proj.quad.corners.forEach(([cx, cy], i) => {
    assert.ok(Math.abs(outline.points[i].x - cx) < 1e-6, `corner ${i} x`);
    assert.ok(Math.abs(outline.points[i].y - cy) < 1e-6, `corner ${i} y`);
  });

  // Perspective: a layer tilted about Y has a taller near edge than far edge.
  const [tl, tr, br, bl] = outline.points;
  const leftH = Math.abs(bl.y - tl.y);
  const rightH = Math.abs(br.y - tr.y);
  assert.ok(Math.abs(leftH - rightH) > 1, 'outline must follow perspective, not stay a rectangle');
});

test('Gizmo3D - Layer Box outline is clipped at the near plane and hidden behind the camera', () => {
  // Default camera sits at z = -1000 looking at +Z.
  const straddling = projectLayer({ x: 0, y: 0, z: -1000, rotationY: 80 });
  assert.ok(straddling.inFrontOfCamera && !straddling.fullyInFront, 'test setup: box straddles the near plane');
  const clipped = buildLayerBoxOutline(straddling, VIEWPORT);
  assert.equal(clipped.visible, true);
  assert.ok(clipped.points.every((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y)));

  const behind = projectLayer({ x: 0, y: 0, z: -3000 });
  assert.equal(behind.inFrontOfCamera, false);
  assert.equal(buildLayerBoxOutline(behind, VIEWPORT).visible, false);
  assert.equal(buildLayerGizmo3DGeometry(behind, VIEWPORT, { flat: true }).visible, false, 'no gizmo behind the camera');

  assert.equal(buildLayerBoxOutline(null, VIEWPORT).visible, false);
  assert.equal(buildLayerGizmo3DGeometry(null, VIEWPORT).visible, false);
});

test('Gizmo3D - Flat Layer drag round trip: move-x then re-project lands under the pointer', () => {
  const layer = { x: 0, y: 0, z: 0 };
  const proj = projectLayer(layer);
  const geometry = buildLayerGizmo3DGeometry(proj, VIEWPORT, { flat: true });

  const start = { x: geometry.axes.x.tip.x, y: geometry.axes.x.tip.y };
  const current = { x: start.x + 60, y: start.y };
  const res = solveMove3D({ startPointer: start, currentPointer: current, handle: 'move-x', geometry });

  // Only X moves for a pointer drag along the X arrow.
  assert.ok(res.deltaLocal.x > 0);
  assert.ok(Math.abs(res.deltaLocal.y) < 1e-6 && Math.abs(res.deltaLocal.z) < 1e-6);

  // Re-project the moved layer: its origin moved by the pointer delta.
  const moved = projectLayer({ x: res.deltaLocal.x, y: 0, z: 0 });
  const movedGeom = buildLayerGizmo3DGeometry(moved, VIEWPORT, { flat: true });
  assert.ok(Math.abs(movedGeom.origin.x - geometry.origin.x - 60) < 1.5);
});

test('Gizmo3D - Flat Layers share one gizmo: Text, Script and 2D Shape get no Z-scale, Mesh keeps three axes', () => {
  const proj = projectLayer({ x: 40, y: 20, z: 100, rotationY: 40 });
  const kinds = {
    text: entityOf([transform(), { type: 'TextRenderer', text: 'Hi' }]),
    rect: entityOf([transform(), { type: 'ShapeRenderer', shapeType: 'rect' }]),
    script: entityOf([transform(), { type: 'ScriptComponent', scriptName: 'A' }]),
    mono: entityOf([transform(), { type: 'MonoBehaviour', scriptName: 'C' }]),
    cube: entityOf([transform(), { type: 'ShapeRenderer', shapeType: 'cube' }]),
  };
  for (const [name, entity] of Object.entries(kinds)) {
    const flat = isFlatLayer(entity, true);
    const geom = buildLayerGizmo3DGeometry(proj, VIEWPORT, { flat });
    assert.equal(Boolean(geom.scaleCubes.z), !flat, `${name}: Z-scale handle present only for Mesh`);
    assert.ok(geom.scaleCubes.x && geom.scaleCubes.y && geom.scaleCubes.center, `${name}: X, Y and centre scale`);
  }
});

test('Gizmo3D - parent and child both in 3D mode: move solver converts into the parent space', () => {
  // Parent rotated 90 degrees about Z and scaled 2x, child a Flat Layer.
  const parentLocal = { x: 300, y: 0, z: 0, rotationZ: 90, scaleX: 2, scaleY: 2, scaleZ: 2, is3D: true };
  const parentMatrix = buildLayerMatrix(parentLocal);
  const childLocal = { x: 100, y: 0, z: 0, is3D: true };
  const childWorld = buildLayerMatrix(childLocal, parentMatrix);

  const camera = createDefaultCamera();
  const proj = project3DLayer(childLocal, camera, VIEWPORT, { parentMatrix, modelMatrix: childWorld, box: VIEWPORT });
  const geometry = buildLayerGizmo3DGeometry(proj, VIEWPORT, { flat: true });

  const start = { x: geometry.axes.x.tip.x, y: geometry.axes.x.tip.y };
  const res = solveMove3D({
    startPointer: start,
    currentPointer: { x: start.x + 30, y: start.y + 12 },
    handle: 'move-x',
    geometry,
    parentMatrix,
  });

  // Applying the local delta through the parent matrix reproduces the world delta.
  const moved = buildLayerMatrix({ ...childLocal, x: childLocal.x + res.deltaLocal.x, y: childLocal.y + res.deltaLocal.y, z: res.deltaLocal.z }, parentMatrix);
  assert.ok(Math.abs(moved[12] - childWorld[12] - res.deltaWorld.x) < 1e-6);
  assert.ok(Math.abs(moved[13] - childWorld[13] - res.deltaWorld.y) < 1e-6);
  assert.ok(Math.abs(moved[14] - childWorld[14] - res.deltaWorld.z) < 1e-6);
});

// ─── Body drag on the layer's z-plane ───────────────────────────────────────

function bodyDragSetup(local, parentMatrix = null) {
  const camera = createDefaultCamera();
  const proj = project3DLayer({ is3D: true, ...local }, camera, VIEWPORT, { parentMatrix, box: VIEWPORT });
  return {
    camera,
    proj,
    args: {
      startPose: { x: local.x ?? 0, y: local.y ?? 0, z: local.z ?? 0 },
      viewMatrix: proj.viewMatrix,
      focalLength: proj.focalLength,
      viewport: VIEWPORT,
      parentMatrix,
    },
  };
}

test('Gizmo3D - body drag changes x and y only; z stays exactly as it was', () => {
  const { proj, args } = bodyDragSetup({ x: 120, y: -80, z: 450 });
  const start = { x: proj.screenX, y: proj.screenY };
  const res = solveBodyDrag3D({ ...args, startPointer: start, currentPointer: { x: start.x + 90, y: start.y + 40 } });

  assert.equal(res.ignored, false);
  assert.equal(res.z, 450);
  assert.ok(res.x > 120, 'dragging right moves +x');
  assert.ok(res.y > -80, 'dragging down moves +y');
});

test('Gizmo3D - body drag keeps a far-away layer under the pointer', () => {
  for (const z of [0, 2000, 8000]) {
    const local = { x: 300, y: -150, z, rotationY: 20 };
    const { proj, args } = bodyDragSetup(local);
    const start = { x: proj.screenX, y: proj.screenY };
    const current = { x: start.x - 130, y: start.y + 70 };

    // Far layers cover a lot of ground per pixel, so lift the per-frame cap: this
    // test is about the layer staying under the pointer, not about the cap.
    const res = solveBodyDrag3D({ ...args, startPointer: start, currentPointer: current, maxStep: 1e9 });
    const after = project3DLayer({ is3D: true, ...local, x: res.x, y: res.y }, createDefaultCamera(), VIEWPORT, { box: VIEWPORT });

    assert.ok(Math.abs(after.screenX - current.x) < 1e-3, `z=${z}: screenX ${after.screenX} vs pointer ${current.x}`);
    assert.ok(Math.abs(after.screenY - current.y) < 1e-3, `z=${z}: screenY ${after.screenY} vs pointer ${current.y}`);
    assert.equal(res.z, z);
  }
});

test('Gizmo3D - body drag works under a rotated and scaled parent', () => {
  const parentMatrix = buildLayerMatrix({ x: 200, y: 50, z: 300, rotationZ: 35, rotationX: 20, scaleX: 1.5, scaleY: 0.8, scaleZ: 2 });
  const local = { x: 60, y: -40, z: 120 };
  const { proj, args } = bodyDragSetup(local, parentMatrix);
  const start = { x: proj.screenX, y: proj.screenY };
  const current = { x: start.x + 75, y: start.y - 55 };

  const res = solveBodyDrag3D({ ...args, startPointer: start, currentPointer: current });
  assert.equal(res.ignored, false);
  assert.equal(res.z, 120, 'local z untouched');

  const after = project3DLayer({ is3D: true, ...local, x: res.x, y: res.y }, createDefaultCamera(), VIEWPORT, { parentMatrix, box: VIEWPORT });
  assert.ok(Math.abs(after.screenX - current.x) < 1e-3, `screenX ${after.screenX} vs ${current.x}`);
  assert.ok(Math.abs(after.screenY - current.y) < 1e-3, `screenY ${after.screenY} vs ${current.y}`);
});

test('Gizmo3D - body drag: returning the pointer to its start returns the start pose', () => {
  const parentMatrix = buildLayerMatrix({ x: -100, y: 20, z: 200, rotationY: 30, scaleX: 2, scaleY: 2 });
  for (const pm of [null, parentMatrix]) {
    const { proj, args } = bodyDragSetup({ x: 33, y: -21, z: 500 }, pm);
    const start = { x: proj.screenX, y: proj.screenY };
    const away = solveBodyDrag3D({ ...args, startPointer: start, currentPointer: { x: start.x + 200, y: start.y + 90 } });
    const back = solveBodyDrag3D({ ...args, startPointer: start, currentPointer: start, lastPose: away });
    assert.ok(Math.abs(back.x - 33) < 1e-6 && Math.abs(back.y + 21) < 1e-6);
    assert.equal(back.z, 500);
  }
});

test('Gizmo3D - body drag: an edge-on plane is ignored and the last valid position is kept', () => {
  // A parent turned 90 degrees about Y puts the layer's z-plane at world x = 300,
  // parallel to the camera's centre line: the pointer ray through the middle of the
  // frame runs along it.
  const parentMatrix = buildLayerMatrix({ x: 300, y: 0, z: 0, rotationY: 90 });
  const { args } = bodyDragSetup({ x: 10, y: 20, z: 0 }, parentMatrix);
  const lastPose = { x: 77, y: -66 };

  const res = solveBodyDrag3D({
    ...args,
    startPointer: { x: 960, y: 540 },
    currentPointer: { x: 1100, y: 600 },
    lastPose,
  });
  assert.equal(res.ignored, true);
  assert.deepEqual({ x: res.x, y: res.y, z: res.z }, { x: 77, y: -66, z: 0 });

  // With no earlier valid frame, the start pose is kept.
  const first = solveBodyDrag3D({ ...args, startPointer: { x: 960, y: 540 }, currentPointer: { x: 1100, y: 600 } });
  assert.deepEqual({ x: first.x, y: first.y }, { x: 10, y: 20 });
});

test('Gizmo3D - body drag: a plane just short of edge-on is capped per frame', () => {
  // 88 degrees: usable, but a modest pointer move is a huge move on the plane.
  const parentMatrix = buildLayerMatrix({ x: 300, y: 0, z: 0, rotationY: 88 });
  const { args } = bodyDragSetup({ x: 0, y: 0, z: 0 }, parentMatrix);
  const lastPose = { x: 0, y: 0 };
  const maxStep = 250;

  const res = solveBodyDrag3D({
    ...args,
    startPointer: { x: 1100, y: 540 },
    currentPointer: { x: 1500, y: 540 },
    lastPose,
    maxStep,
  });
  assert.equal(res.ignored, false);
  assert.equal(res.capped, true);
  assert.ok(Math.hypot(res.x - lastPose.x, res.y - lastPose.y) <= maxStep + 1e-6, 'one frame never moves more than the cap');

  // A normal drag is not capped.
  const calm = bodyDragSetup({ x: 0, y: 0, z: 0 });
  const small = solveBodyDrag3D({
    ...calm.args,
    startPointer: { x: 960, y: 540 },
    currentPointer: { x: 1000, y: 560 },
  });
  assert.equal(small.capped, false);
});

test('Gizmo3D - body drag: a pointer ray that meets the plane behind the camera is ignored', () => {
  // Plane at z = -3000 is behind the default camera (z = -1000).
  const { args } = bodyDragSetup({ x: 5, y: 6, z: -3000 });
  const res = solveBodyDrag3D({ ...args, startPointer: { x: 900, y: 500 }, currentPointer: { x: 950, y: 520 } });
  assert.equal(res.ignored, true);
  assert.deepEqual({ x: res.x, y: res.y }, { x: 5, y: 6 });
});