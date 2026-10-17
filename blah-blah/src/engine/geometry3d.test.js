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
