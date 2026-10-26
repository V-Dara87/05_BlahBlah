import test from 'node:test';
import assert from 'node:assert/strict';
import {
  is3DShape,
  shadeColor,
  rotateVertex,
  createCubeMesh,
  createPyramidMesh,
  createCylinderMesh,
  createSphereMesh,
  renderMesh3D,
  drawShape3D,
} from './geometry3d.js';
import { createDefaultCamera, project3DLayer } from './camera3d.js';

test('Geometry3D - is3DShape detects 3D primitives', () => {
  assert.equal(is3DShape('cube'), true);
  assert.equal(is3DShape('cylinder'), true);
  assert.equal(is3DShape('pyramid'), true);
  assert.equal(is3DShape('sphere'), true);
  assert.equal(is3DShape('rect'), false);
  assert.equal(is3DShape('circle'), false);
});

test('Geometry3D - shadeColor darkens and lightens RGB', () => {
  const darkened = shadeColor('#ffffff', 0.5);
  assert.equal(darkened, 'rgb(128, 128, 128)');

  const blueShaded = shadeColor('#0000ff', 0.5);
  assert.equal(blueShaded, 'rgb(0, 0, 128)');
});

test('Geometry3D - rotateVertex performs 3D Euler rotation', () => {
  const v = [0, 0, 100];
  // 90 deg around Y: Z moves to X
  const rotatedY = rotateVertex(v, 0, 90, 0);
  assert.ok(Math.abs(rotatedY[0] - 100) < 1e-4);
  assert.ok(Math.abs(rotatedY[2]) < 1e-4);

  // 90 deg around X: Z moves to -Y
  const rotatedX = rotateVertex(v, 90, 0, 0);
  assert.ok(Math.abs(rotatedX[1] - (-100)) < 1e-4);
  assert.ok(Math.abs(rotatedX[2]) < 1e-4);
});

test('Geometry3D - mesh generators create valid vertices and faces', () => {
  const cube = createCubeMesh(100, 100, 100);
  assert.equal(cube.vertices.length, 8);
  assert.equal(cube.faces.length, 6);

  const pyramid = createPyramidMesh(100, 100, 100);
  assert.equal(pyramid.vertices.length, 5);
  assert.equal(pyramid.faces.length, 5);

  const cylinder = createCylinderMesh(50, 100, 16);
  assert.equal(cylinder.vertices.length, 32);
  assert.equal(cylinder.faces.length, 18); // 16 quads + 2 caps

  const sphere = createSphereMesh(50, 6, 8);
  assert.ok(sphere.vertices.length > 20);
  assert.ok(sphere.faces.length > 20);
});

test('Geometry3D - renderMesh3D renders without crashing with mock context', () => {
  const drawCalls = [];
  const mockCtx = {
    save: () => drawCalls.push('save'),
    restore: () => drawCalls.push('restore'),
    beginPath: () => drawCalls.push('beginPath'),
    moveTo: (x, y) => drawCalls.push(`moveTo(${x},${y})`),
    lineTo: (x, y) => drawCalls.push(`lineTo(${x},${y})`),
    closePath: () => drawCalls.push('closePath'),
    fill: () => drawCalls.push('fill'),
    stroke: () => drawCalls.push('stroke'),
  };

  const cube = createCubeMesh(100, 100, 100);
  renderMesh3D(mockCtx, cube, {
    rotationX: 30,
    rotationY: 45,
    shading: 'lit',
  });

  assert.ok(drawCalls.includes('save'));
  assert.ok(drawCalls.includes('restore'));
  assert.ok(drawCalls.filter((c) => c === 'fill').length > 0);
});

test('Geometry3D - drawShape3D handles cube, pyramid, cylinder, sphere', () => {
  const calls = [];
  const mockCtx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
  };

  drawShape3D(mockCtx, { shapeType: 'cube', width: 100, height: 100, depth: 100 }, { rotationX: 10, rotationY: 20 });
  assert.ok(calls.length > 0);

  drawShape3D(mockCtx, { shapeType: 'pyramid', width: 80, height: 80 }, {});
  drawShape3D(mockCtx, { shapeType: 'cylinder', width: 60, height: 120 }, {});
  drawShape3D(mockCtx, { shapeType: 'sphere', width: 70 }, {});
});

// ─── Camera-matrix projection (a 3D primitive on a 3D layer) ────────────────

/** Records the polygon vertices a mesh renderer would fill/stroke. */
function recordingCtx() {
  const polys = [];
  let path = [];
  return {
    polys,
    save() {},
    restore() {},
    beginPath() {
      path = [];
    },
    moveTo(x, y) {
      path.push([x, y]);
    },
    lineTo(x, y) {
      path.push([x, y]);
    },
    closePath() {},
    fill() {
      polys.push(path.slice());
    },
    stroke() {
      polys.push(path.slice());
    },
    set fillStyle(_v) {},
    set strokeStyle(_v) {},
    set lineWidth(_v) {},
    set lineJoin(_v) {},
  };
}

const VIEWPORT = { width: 960, height: 540 };
const BOX = { width: 400, height: 240 };

function meshOptions(layer, extra = {}) {
  const camera = createDefaultCamera({ position: { x: 0, y: 0, z: -1200 }, target: { x: 0, y: 0, z: 0 } });
  const proj = project3DLayer(layer, camera, VIEWPORT, { pivotBase: BOX });
  return {
    matrix: proj.camMatrix,
    focalLength: proj.focalLength,
    viewport: VIEWPORT,
    near: proj.nearPlane,
    far: proj.farPlane,
    ...extra,
  };
}

function bounds(polys) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

test('Geometry3D - camera matrix projects the mesh into frame pixels', () => {
  const ctx = recordingCtx();
  renderMesh3D(ctx, createCubeMesh(140, 140, 140), meshOptions({ x: 0, y: 0, z: 0, is3D: true }));

  assert.ok(ctx.polys.length > 0, 'the cube must draw');
  const b = bounds(ctx.polys);
  // A 140px cube 1200px away through a ~580px focal length spans roughly
  // 68px either side of the frame centre.
  assert.ok(Math.abs((b.minX + b.maxX) / 2 - 480) < 1, `cube must be centred, got ${(b.minX + b.maxX) / 2}`);
  assert.ok(Math.abs((b.minY + b.maxY) / 2 - 270) < 1, `cube must be centred, got ${(b.minY + b.maxY) / 2}`);
  assert.ok(b.maxX - b.minX < 200, `cube must be foreshortened, got width ${b.maxX - b.minX}`);
});

test('Geometry3D - the layer transform reaches the mesh through the same matrix', () => {
  const flat = recordingCtx();
  renderMesh3D(flat, createCubeMesh(140, 140, 140), meshOptions({ x: 0, y: 0, z: 0, is3D: true }));

  const yawed = recordingCtx();
  renderMesh3D(
    yawed,
    createCubeMesh(140, 140, 140),
    meshOptions({ x: 0, y: 0, z: 0, rotationY: 40, is3D: true })
  );

  const flatBounds = bounds(flat.polys);
  const yawBounds = bounds(yawed.polys);
  // A yawed cube is wider on screen (corner-on) and its faces redistribute.
  assert.ok(
    Math.abs(yawBounds.maxX - yawBounds.minX - (flatBounds.maxX - flatBounds.minX)) > 1,
    'the layer rotation must change the projected mesh'
  );
});

test('Geometry3D - the layer scale multiplies the mesh, as in the preview', () => {
  const small = recordingCtx();
  renderMesh3D(small, createCubeMesh(140, 140, 140), meshOptions({ x: 0, y: 0, z: 0, is3D: true }));

  const large = recordingCtx();
  renderMesh3D(
    large,
    createCubeMesh(140, 140, 140),
    meshOptions({ x: 0, y: 0, z: 0, scaleX: 2, scaleY: 2, scaleZ: 2, is3D: true })
  );

  const s = bounds(small.polys);
  const l = bounds(large.polys);
  const ratio = (l.maxX - l.minX) / (s.maxX - s.minX);
  // Slightly over 2x: scaling Z as well brings the near face closer, so
  // perspective enlarges it more than the flat 2x scale would.
  assert.ok(ratio > 1.95 && ratio < 2.4, `expected a ~2x wider cube, got ${ratio.toFixed(3)}x`);
});

test('Geometry3D - faces crossing the near plane are cut at the plane, not folded', () => {
  // Camera just 90px from the origin plane: the far half of the cube is behind it.
  const camera = createDefaultCamera({ position: { x: 0, y: 0, z: -90 }, target: { x: 0, y: 0, z: 0 } });
  const proj = project3DLayer({ x: 0, y: 0, z: 0, is3D: true }, camera, VIEWPORT, { pivotBase: BOX });

  const ctx = recordingCtx();
  renderMesh3D(ctx, createCubeMesh(400, 400, 400), {
    matrix: proj.camMatrix,
    focalLength: proj.focalLength,
    viewport: VIEWPORT,
    near: proj.nearPlane,
  });

  // Some of the cube is in front, so something must be drawn.
  assert.ok(ctx.polys.length > 0, 'the visible part of the cube must draw');

  for (const poly of ctx.polys) {
    for (const [x, y] of poly) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), 'no NaNs from a clipped vertex');
      // A point exactly on the near plane legitimately projects far off-screen
      // (z = near divides by ~1) and is clipped by the canvas. What must never
      // happen is an infinity or a sign-flipped fold, which shows up as an
      // absurd magnitude.
      assert.ok(Math.abs(x) < 1e7 && Math.abs(y) < 1e7, `vertex ${x},${y} looks folded`);
    }
  }
});

test('Geometry3D - lighting stays fixed to the world when the camera orbits', () => {
  // One flat face, so the same face is visible from both camera angles.
  const plane = {
    vertices: [
      [-100, -100, 0],
      [100, -100, 0],
      [100, 100, 0],
      [-100, 100, 0],
    ],
    faces: [[0, 1, 2, 3]],
  };

  const front = createDefaultCamera({ position: { x: 0, y: 0, z: -1200 }, target: { x: 0, y: 0, z: 0 } });
  const orbited = createDefaultCamera({ position: { x: 700, y: 200, z: -1100 }, target: { x: 0, y: 0, z: 0 } });

  const flatColors = [];
  for (const camera of [front, orbited]) {
    const proj = project3DLayer({ x: 0, y: 0, z: 0, is3D: true }, camera, VIEWPORT, { pivotBase: BOX });
    let fill = null;
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      set fillStyle(v) {
        fill = v;
      },
      get fillStyle() {
        return fill;
      },
      set strokeStyle(_v) {},
      set lineWidth(_v) {},
      set lineJoin(_v) {},
      fill() {
        flatColors.push(fill);
      },
      stroke() {},
    };
    renderMesh3D(ctx, plane, {
      matrix: proj.camMatrix,
      viewMatrix: proj.viewMatrix,
      focalLength: proj.focalLength,
      viewport: VIEWPORT,
      shading: 'lit',
      strokeWidth: 0,
    });
  }

  assert.equal(flatColors.length, 2);
  assert.equal(
    flatColors[0],
    flatColors[1],
    'a fixed world light must shade the same face identically as the camera moves'
  );
});
