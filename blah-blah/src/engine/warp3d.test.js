import test from 'node:test';
import assert from 'node:assert/strict';
import {
  drawProjectedQuad,
  lerpQuadCorner,
  projectCameraPoint,
  quadSubdivisions,
} from './warp3d.js';
import { createDefaultCamera, project3DLayer } from './camera3d.js';

/**
 * Records what a real canvas would have drawn.
 *
 * The image is not rasterized; instead every `drawImage` is logged together
 * with the active transform and clip triangle, which is enough to check — by
 * inverse mapping — where each cell puts the source plane. That is the property
 * the exporter depends on: a source pixel must land where the camera projects
 * it, exactly as CSS `matrix3d` does in the preview.
 */
class RecordingCtx {
  constructor() {
    this.ctm = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.path = [];
    this.clipPath = null;
    this.draws = [];
    this.globalAlpha = 1;
  }

  save() {
    this.stack.push({ ctm: this.ctm.slice(), alpha: this.globalAlpha, clip: this.clipPath });
  }

  restore() {
    const state = this.stack.pop();
    if (!state) return;
    this.ctm = state.ctm;
    this.globalAlpha = state.alpha;
    this.clipPath = state.clip;
  }

  transform(a, b, c, d, e, f) {
    this.ctm = multiply(this.ctm, [a, b, c, d, e, f]);
  }

  beginPath() {
    this.path = [];
  }

  moveTo(x, y) {
    this.path.push(apply(this.ctm, x, y));
  }

  lineTo(x, y) {
    this.path.push(apply(this.ctm, x, y));
  }

  closePath() {}

  clip() {
    this.clipPath = this.path.slice();
  }

  drawImage(image) {
    this.draws.push({ ctm: this.ctm.slice(), clip: this.clipPath, alpha: this.globalAlpha, image });
  }
}

/** Canvas matrix composition: m1 applied after m2 is m1 * m2. */
function multiply(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}

function pointInTriangle(p, tri) {
  const [a, b, c] = tri;
  const sign = (p1, p2, p3) =>
    (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

const VIEWPORT = { width: 960, height: 540 };
const SOURCE = { width: 64, height: 64 };

function quadFor(layer, pivotBase = { width: 400, height: 240 }) {
  const camera = createDefaultCamera({ position: { x: 0, y: 0, z: -1200 }, target: { x: 0, y: 0, z: 0 } });
  const proj = project3DLayer(layer, camera, VIEWPORT, { pivotBase });
  return proj.quad;
}

/** Finds the cell that covers `point` and returns the source pixel it samples. */
function sourceAt(draws, point) {
  for (const draw of draws) {
    if (!draw.clip || !pointInTriangle(point, draw.clip)) continue;
    const inv = invert(draw.ctm);
    if (!inv) continue;
    return apply(inv, point[0], point[1]);
  }
  return null;
}

test('Warp3D - a flat layer draws as an upright, unscaled rectangle', () => {
  const quad = quadFor({ x: 0, y: 0, z: 0, is3D: true });
  const ctx = new RecordingCtx();
  assert.equal(drawProjectedQuad(ctx, SOURCE, quad), true);
  assert.ok(ctx.draws.length > 0, 'something must be drawn');

  // A layer with no rotation sits centred in the frame, scaled by the
  // camera's perspective factor (focal / distance) — 400x240 at 1200px.
  const corners = quad.corners;
  const distance = quad.camCorners[0].z;
  const halfW = (400 / 2) * (quad.focalLength / distance);
  const halfH = (240 / 2) * (quad.focalLength / distance);
  assert.ok(Math.abs(corners[0][0] - (480 - halfW)) < 1e-6);
  assert.ok(Math.abs(corners[0][1] - (270 - halfH)) < 1e-6);
  assert.ok(Math.abs(corners[2][0] - (480 + halfW)) < 1e-6);
  assert.ok(halfW < 200, 'and it must be foreshortened by distance');

  // The centre of the quad must sample the centre of the source.
  const centre = sourceAt(ctx.draws, [480, 270]);
  assert.ok(centre, 'the quad centre must be covered by a cell');
  assert.ok(Math.abs(centre[0] - 32) < 0.01 && Math.abs(centre[1] - 32) < 0.01);
});

test('Warp3D - a rotated layer samples the source where the camera projects it', () => {
  const quad = quadFor({ x: 0, y: 0, z: 0, rotationY: 55, rotationX: 12, is3D: true });
  const ctx = new RecordingCtx();
  drawProjectedQuad(ctx, SOURCE, quad);

  const { camCorners, focalLength, viewport } = quad;
  const n = quadSubdivisions(camCorners);
  assert.ok(n > 2, `a steeply rotated layer needs subdivision, got ${n}`);

  let checked = 0;
  let worstError = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // Sample the middle of each grid cell, away from the clip edges.
      const s = (i + 0.5) / n;
      const t = (j + 0.5) / n;
      const screen = projectCameraPoint(lerpQuadCorner(camCorners, s, t), focalLength, viewport);
      const sampled = sourceAt(ctx.draws, screen);
      assert.ok(sampled, `cell (${i}, ${j}) must be covered`);
      const errX = Math.abs(sampled[0] - s * SOURCE.width);
      const errY = Math.abs(sampled[1] - t * SOURCE.height);
      worstError = Math.max(worstError, errX, errY);
      checked++;
    }
  }

  assert.ok(checked > 0);
  // The affine approximation is only exact at cell corners, so allow a small
  // fraction of a source pixel; anything larger means the grid is too coarse or
  // the mapping is wrong.
  assert.ok(worstError < 1, `worst source-pixel error ${worstError.toFixed(3)} is too high`);
});

test('Warp3D - subdivision tracks how sharply the layer recedes', () => {
  const flat = quadFor({ x: 0, y: 0, z: 0, is3D: true });
  const tilted = quadFor({ x: 0, y: 0, z: 0, rotationY: 70, is3D: true });
  assert.ok(
    quadSubdivisions(tilted.camCorners) > quadSubdivisions(flat.camCorners),
    'a receding layer must be subdivided more finely than a flat one'
  );
});

test('Warp3D - cells behind the near plane are skipped, not folded', () => {
  // Camera 200px in front of the layer; a huge box rotated hard reaches behind.
  const camera = createDefaultCamera({ position: { x: 0, y: 0, z: -200 }, target: { x: 0, y: 0, z: 0 } });
  const proj = project3DLayer(
    { x: 0, y: 0, z: 0, rotationY: 80, is3D: true },
    camera,
    VIEWPORT,
    { pivotBase: { width: 2000, height: 500 } }
  );

  const ctx = new RecordingCtx();
  const drew = drawProjectedQuad(ctx, SOURCE, proj.quad);

  assert.equal(drew, true, 'the visible part of the layer must still draw');
  // Every drawn cell must be entirely in front of the camera, i.e. finite and
  // on-screen-ish; a folded cell would project to enormous coordinates.
  for (const draw of ctx.draws) {
    for (const [x, y] of draw.clip || []) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(Math.abs(x) < 1e6 && Math.abs(y) < 1e6, `cell vertex ${x},${y} looks folded`);
    }
  }
});

test('Warp3D - a layer entirely behind the camera draws nothing', () => {
  const quad = quadFor({ x: 0, y: 0, z: -4000, is3D: true });
  const ctx = new RecordingCtx();
  assert.equal(drawProjectedQuad(ctx, SOURCE, quad), false);
  assert.equal(ctx.draws.length, 0);
});

test('Warp3D - opacity is applied as a multiplier on the destination alpha', () => {
  const quad = quadFor({ x: 0, y: 0, z: 0, is3D: true });
  const ctx = new RecordingCtx();
  ctx.globalAlpha = 0.5;
  drawProjectedQuad(ctx, SOURCE, quad, { opacity: 0.4 });
  assert.ok(ctx.draws.length > 0);
  for (const draw of ctx.draws) {
    assert.ok(Math.abs(draw.alpha - 0.2) < 1e-9, `expected alpha 0.2, got ${draw.alpha}`);
  }
  assert.equal(ctx.globalAlpha, 0.5, 'the destination alpha must be restored');
});

test('Warp3D - a layer crossing the near plane is clipped at the plane, not stepped', async () => {
  const { clipPolygonToCamera } = await import('./warp3d.js');
  // Camera 300px in front of the layer plane; a wide, yawed box crosses it.
  const camera = createDefaultCamera({ position: { x: 0, y: 0, z: -300 }, target: { x: 0, y: 0, z: 0 } });
  const proj = project3DLayer(
    { x: 0, y: 0, z: 0, rotationY: 78, is3D: true },
    camera,
    VIEWPORT,
    { pivotBase: { width: 1600, height: 400 } }
  );
  const { quad } = proj;

  const ctx = new RecordingCtx();
  assert.equal(drawProjectedQuad(ctx, SOURCE, quad), true);

  // Where the box's outline crosses the near plane, projected.
  const outline = clipPolygonToCamera(
    quad.camCorners.map((c, i) => ({ ...c, u: i, v: 0 })),
    quad.near,
    quad.far
  );
  const boundary = outline.map((p) => projectCameraPoint(p, quad.focalLength, quad.viewport));

  // Every clip point of the outline must be covered by an actual drawn vertex
  // within a pixel: that is what makes the cut edge straight instead of a
  // staircase of dropped cells.
  const drawnPoints = ctx.draws.flatMap((d) => d.clip || []);
  for (const point of boundary) {
    const nearest = drawnPoints.reduce(
      (best, q) => Math.min(best, Math.hypot(q[0] - point[0], q[1] - point[1])),
      Infinity
    );
    assert.ok(nearest < 1, `clip boundary at ${point} is ${nearest.toFixed(2)}px from any drawn edge`);
  }
});

/**
 * Inverts the preview's CSS matrix: given a screen point, what layer-local
 * point (in px, relative to the layer's centre) does it come from?
 */
function previewLocalPoint(matrix, screenX, screenY) {
  const m = matrix;
  // p = (u, v) relative to the element centre, projected to
  //   x = (m0 u + m4 v + m12) / (m3 u + m7 v + m15)
  //   y = (m1 u + m5 v + m13) / (m3 u + m7 v + m15)
  const a11 = m[0] - screenX * m[3];
  const a12 = m[4] - screenX * m[7];
  const b1 = screenX * m[15] - m[12];
  const a21 = m[1] - screenY * m[3];
  const a22 = m[5] - screenY * m[7];
  const b2 = screenY * m[15] - m[13];
  const det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-12) return null;
  return {
    u: (b1 * a22 - a12 * b2) / det,
    v: (a11 * b2 - b1 * a21) / det,
  };
}

test('Warp3D - export samples the same source pixel the preview CSS mapping does', () => {
  const pivotBase = { width: 640, height: 360 };
  const layer = {
    x: 40,
    y: -20,
    z: 60,
    rotationX: 18,
    rotationY: 42,
    rotationZ: 7,
    scaleX: 1.1,
    scaleY: 0.9,
    is3D: true,
  };
  const camera = createDefaultCamera({ position: { x: 120, y: -60, z: -900 }, target: { x: 0, y: 0, z: 0 } });
  const proj = project3DLayer(layer, camera, VIEWPORT, { pivotBase });
  const src = { width: pivotBase.width, height: pivotBase.height };

  const ctx = new RecordingCtx();
  assert.equal(drawProjectedQuad(ctx, src, proj.quad), true);

  // The preview places the element with its centre at the frame centre, so a
  // screen point p maps to the layer-local point matrix⁻¹(p − centre).
  const centreX = VIEWPORT.width / 2;
  const centreY = VIEWPORT.height / 2;

  let worst = 0;
  let checked = 0;
  // Probe the interior on a coarse grid of the layer plane.
  for (const s of [0.15, 0.35, 0.55, 0.75, 0.95]) {
    for (const t of [0.15, 0.35, 0.55, 0.75, 0.95]) {
      const screen = projectCameraPoint(
        lerpQuadCorner(proj.quad.camCorners, s, t),
        proj.focalLength,
        proj.quad.viewport
      );

      const fromExport = sourceAt(ctx.draws, screen);
      assert.ok(fromExport, `no exported cell covers ${screen}`);

      const local = previewLocalPoint(proj.matrix, screen[0] - centreX, screen[1] - centreY);
      assert.ok(local, 'the preview matrix must be invertible here');

      // The export's texture origin is the layer box's top-left; the matrix
      // works from the layer's centre.
      const previewTexel = [local.u + pivotBase.width / 2, local.v + pivotBase.height / 2];

      worst = Math.max(
        worst,
        Math.abs(fromExport[0] - previewTexel[0]),
        Math.abs(fromExport[1] - previewTexel[1])
      );
      checked++;
    }
  }

  assert.ok(checked === 25);
  // Sub-pixel: this is the same homography, evaluated through CSS by the
  // preview and through the subdivided warp by the exporter.
  assert.ok(worst < 1, `preview and export disagree by ${worst.toFixed(3)} source px`);
});

test('Warp3D - a translucent layer is composited once, so cells cannot seam', () => {
  // Node has no canvas here: stand in a recording OffscreenCanvas so the
  // grouped-composite path is exercised without native bindings.
  const surfaces = [];
  class FakeSurfaceCtx {
    constructor() {
      this.globalAlpha = 1;
      this.transforms = [];
      this.draws = [];
    }
    setTransform(a, b, c, d, e, f) {
      this.transforms.push([a, b, c, d, e, f]);
    }
    clearRect() {}
    save() {}
    restore() {}
    beginPath() {}
    moveTo() {}
    lineTo() {}
    closePath() {}
    clip() {}
    transform() {}
    drawImage() {
      this.draws.push({ alpha: this.globalAlpha });
    }
  }
  class FakeSurface {
    constructor(w, h) {
      this.width = w;
      this.height = h;
      this.ctx = new FakeSurfaceCtx();
      surfaces.push(this);
    }
    getContext() {
      return this.ctx;
    }
  }

  const previous = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = FakeSurface;
  try {
    const quad = quadFor({ x: 0, y: 0, z: 0, rotationY: 30, is3D: true }, { width: 300, height: 200 });
    const ctx = new RecordingCtx();
    ctx.canvas = { width: 960, height: 540 };
    ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    ctx.setTransform = (a, b, c, d, e, f) => {
      ctx.ctm = [a, b, c, d, e, f];
    };

    assert.equal(drawProjectedQuad(ctx, SOURCE, quad, { opacity: 0.35 }), true);

    // Interiors are painted opaque, so overlapping cells are idempotent.
    assert.equal(surfaces.length, 1, 'one group surface is allocated');
    assert.ok(surfaces[0].ctx.draws.length > 1, 'the quad is many cells');
    for (const draw of surfaces[0].ctx.draws) {
      assert.equal(draw.alpha, 1, 'every cell must be drawn at full alpha');
    }

    // Exactly one composite, with the layer's opacity, in device space.
    assert.equal(ctx.draws.length, 1, 'the layer must be composited exactly once');
    assert.ok(Math.abs(ctx.draws[0].alpha - 0.35) < 1e-9);
    assert.deepEqual(ctx.draws[0].ctm, [1, 0, 0, 1, 0, 0]);
  } finally {
    globalThis.OffscreenCanvas = previous;
  }
});
