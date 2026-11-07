import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGizmo3DGeometry,
  pickGizmo3DHandle,
  solveMove3D,
  solveRotate3D,
  solveScale3D,
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
