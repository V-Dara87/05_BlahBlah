import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGroundSegment, drawGroundGrid } from './groundGrid3d.js';
import { mat4LookAt, getFocalLength } from './camera3d.js';

test('GroundGrid3D - projectGroundSegment projects points correctly in front of camera', () => {
  const eye = { x: 0, y: -500, z: -1000 };
  const target = { x: 0, y: 0, z: 0 };
  const mView = mat4LookAt(eye, target, 0);
  const focalLength = getFocalLength(1080, 50);
  const viewport = { width: 1920, height: 1080 };

  const p1 = { x: -500, y: 0, z: 0 };
  const p2 = { x: 500, y: 0, z: 0 };

  const proj = projectGroundSegment(p1, p2, mView, focalLength, viewport, 5);
  assert.ok(proj, 'Ground segment in front of camera should not be null');
  assert.ok(proj.sx1 < proj.sx2, 'p1.x < p2.x, so screen sx1 should be left of sx2');
  assert.ok(Math.abs(proj.sy1 - proj.sy2) < 1, 'Horizontal line along X should have matching screen Y');
});

test('GroundGrid3D - projectGroundSegment clips lines behind camera', () => {
  const eye = { x: 0, y: 0, z: 0 };
  const target = { x: 0, y: 0, z: 1000 };
  const mView = mat4LookAt(eye, target, 0);
  const focalLength = 1000;
  const viewport = { width: 1920, height: 1080 };

  // Completely behind camera (negative Z)
  const p1 = { x: -100, y: 0, z: -500 };
  const p2 = { x: 100, y: 0, z: -200 };

  const proj = projectGroundSegment(p1, p2, mView, focalLength, viewport, 5);
  assert.equal(proj, null, 'Segment behind camera must be clipped out');
});

test('GroundGrid3D - drawGroundGrid executes without throwing error', () => {
  const commands = [];
  const fakeCtx = {
    save: () => commands.push('save'),
    restore: () => commands.push('restore'),
    beginPath: () => commands.push('beginPath'),
    moveTo: (x, y) => commands.push(`moveTo(${x},${y})`),
    lineTo: (x, y) => commands.push(`lineTo(${x},${y})`),
    stroke: () => commands.push('stroke'),
    set strokeStyle(v) {},
    set lineWidth(v) {},
    set lineCap(v) {},
  };

  const camera = {
    position: { x: 0, y: -400, z: -1000 },
    target: { x: 0, y: 0, z: 0 },
    fov: 50,
    zoom: 1,
    roll: 0,
  };

  drawGroundGrid(fakeCtx, camera, { width: 1920, height: 1080 });
  assert.ok(commands.length > 10, 'Ground grid should generate canvas drawing commands');
  assert.equal(commands[0], 'save');
  assert.equal(commands[commands.length - 1], 'restore');
});
