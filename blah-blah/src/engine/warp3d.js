/**
 * Perspective-correct quad rasterizer for Canvas 2D.
 *
 * Canvas 2D transforms are affine: they cannot express the trapezoid a 3D layer
 * projects to. So a projected layer is drawn by subdividing its layer plane into
 * a grid and affine-mapping each cell's texture through a clipped `drawImage`.
 * With a fine enough grid the affine cells approximate the homography, which is
 * what the preview gets for free from a CSS `matrix3d`.
 *
 * Everything here works from the projection in engine/camera3d.js:
 *
 *   quad.camCorners - the layer box's four corners in CAMERA space
 *                     (top-left, top-right, bottom-right, bottom-left)
 *   quad.near       - the camera's near plane
 *   quad.focalLength / quad.viewport - used to project camera space to px
 *
 * Using camera space (instead of the already-projected screen corners) is what
 * makes near-plane clipping possible: cells behind the camera are dropped
 * individually, so a layer that straddles the near plane is clipped instead of
 * disappearing whole or turning inside out.
 */

/**
 * Linearly interpolates the four camera-space corners of the layer plane.
 * Exact for a planar quad whose corners form a rectangle in the layer's own
 * space, which is always true here (the box corners are a rectangle).
 */
export function lerpQuadCorner(camCorners, s, t) {
  const [tl, tr, br, bl] = camCorners;
  const topX = tl.x + (tr.x - tl.x) * s;
  const topY = tl.y + (tr.y - tl.y) * s;
  const topZ = tl.z + (tr.z - tl.z) * s;
  const botX = bl.x + (br.x - bl.x) * s;
  const botY = bl.y + (br.y - bl.y) * s;
  const botZ = bl.z + (br.z - bl.z) * s;
  return {
    x: topX + (botX - topX) * t,
    y: topY + (botY - topY) * t,
    z: topZ + (botZ - topZ) * t,
  };
}

/**
 * Projects a camera-space point to frame px. Points on or behind the near plane
 * are clamped rather than divided by ~0; callers must not draw those cells.
 */
export function projectCameraPoint(camPoint, focalLength, viewport) {
  const z = camPoint.z > 1e-6 ? camPoint.z : 1e-6;
  const s = focalLength / z;
  return [camPoint.x * s + viewport.width / 2, camPoint.y * s + viewport.height / 2];
}

/**
 * How many cells one axis needs for the affine approximation to be invisible.
 *
 * Two things drive the error: how far the layer recedes across its own plane
 * (a parallel layer is affine already, so 2 cells are exact) and how many
 * screen pixels each cell covers (the error grows with the square of the cell
 * size). A layer that is both large and steeply angled needs the cap; a big
 * flat one needs almost nothing.
 *
 * Pass `focalLength` + `viewport` to enable the pixel-size term. Without them
 * only the depth ratio is considered, which is what the pure-geometry callers
 * and tests use.
 */
export function quadSubdivisions(
  camCorners,
  { min = 2, max = 24, focalLength = 0, viewport = null, targetCellPx = 36 } = {}
) {
  const zs = camCorners.map((c) => c.z);
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  if (!Number.isFinite(zMin) || !Number.isFinite(zMax) || zMin <= 0) return max;

  const depthSpread = Math.sqrt(Math.max(0, zMax / Math.max(1e-6, zMin) - 1));

  let bySize = 0;
  if (focalLength > 0 && viewport?.width && viewport?.height) {
    const projected = camCorners.map((c) => projectCameraPoint(c, focalLength, viewport));
    const width = Math.max(...projected.map((p) => p[0])) - Math.min(...projected.map((p) => p[0]));
    const height = Math.max(...projected.map((p) => p[1])) - Math.min(...projected.map((p) => p[1]));
    const diagonal = Math.hypot(width, height);
    bySize = Math.ceil(diagonal / targetCellPx) * depthSpread;
  }

  const byDepth = 2 + (zMax / Math.max(1e-6, zMin) - 1) * 3;
  const wanted = Math.ceil(Math.max(bySize, byDepth));
  return Math.max(min, Math.min(max, wanted));
}

/** Signed area of a screen-space triangle, used to skip degenerate cells. */
function triangleArea(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
}

/**
 * Draws one textured triangle. `src` is measured in the source image's own px.
 * The clip path is dilated by ~0.6px away from the centroid so neighbouring
 * cells overlap slightly: without that, antialiased clip edges leave hairline
 * seams across the quad.
 */
function drawTexturedTriangle(ctx, image, src, dst) {
  const [s0, s1, s2] = src;
  const [d0, d1, d2] = dst;

  const U = s1[0] - s0[0];
  const V = s1[1] - s0[1];
  const U2 = s2[0] - s0[0];
  const V2 = s2[1] - s0[1];
  const det = U * V2 - U2 * V;
  if (Math.abs(det) < 1e-9) return;

  const X1 = d1[0] - d0[0];
  const Y1 = d1[1] - d0[1];
  const X2 = d2[0] - d0[0];
  const Y2 = d2[1] - d0[1];

  const a = (X1 * V2 - X2 * V) / det;
  const c = (U * X2 - U2 * X1) / det;
  const b = (Y1 * V2 - Y2 * V) / det;
  const d = (U * Y2 - U2 * Y1) / det;
  const e = d0[0] - a * s0[0] - c * s0[1];
  const f = d0[1] - b * s0[0] - d * s0[1];

  const cx = (d0[0] + d1[0] + d2[0]) / 3;
  const cy = (d0[1] + d1[1] + d2[1]) / 3;
  const grow = 0.6;
  const dilate = ([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * grow, y + (dy / len) * grow];
  };

  const [e0, e1, e2] = [dilate(d0), dilate(d1), dilate(d2)];

  ctx.save();
  try {
    ctx.beginPath();
    ctx.moveTo(e0[0], e0[1]);
    ctx.lineTo(e1[0], e1[1]);
    ctx.lineTo(e2[0], e2[1]);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0);
  } catch (err) {
    console.warn('Warp3D: failed to draw a projected cell:', err);
  } finally {
    ctx.restore();
  }
}

/**
 * Clips a polygon of camera-space points (with u/v attributes) against the
 * camera's near and far planes. Attributes are interpolated linearly, which is
 * exact here because the layer plane is affine in camera space.
 *
 * Returns the surviving polygon; fewer than 3 points means nothing is visible.
 */
export function clipPolygonToCamera(vertices, near = 1, far = Infinity) {
  let poly = vertices;

  if (Number.isFinite(far)) {
    poly = clipAgainstPlane(poly, (p) => p.z < far, far);
  }
  poly = clipAgainstPlane(poly, (p) => p.z > near, near);
  return poly;
}

function clipAgainstPlane(poly, isInside, planeZ) {
  if (poly.length === 0) return poly;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const aIn = isInside(a);
    const bIn = isInside(b);
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const dz = b.z - a.z;
      const t = Math.abs(dz) < 1e-9 ? 0 : (planeZ - a.z) / dz;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: planeZ,
        u: a.u + (b.u - a.u) * t,
        v: a.v + (b.v - a.v) * t,
      });
    }
  }
  return out;
}

/**
 * Offscreen surfaces used to composite a translucent quad in one pass.
 *
 * Cells are drawn with a ~0.6px dilation so neighbouring triangles overlap and
 * no antialiased seam shows. At full opacity that overlap is invisible (opaque
 * pixels overwrite each other identically), but at opacity < 1 — every fade and
 * every transition — the shared edge is composited twice and shows up as a grid
 * over the layer. The fix is to rasterize the whole quad at alpha 1 into one of
 * these and then composite it once with the layer's opacity.
 */
const compositePool = new Map();
const MAX_COMPOSITE_SURFACES = 2;

function acquireCompositeSurface(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const key = `${w}x${h}`;
  let canvas = compositePool.get(key);
  if (!canvas) {
    canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(w, h)
      : document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    compositePool.set(key, canvas);
    while (compositePool.size > MAX_COMPOSITE_SURFACES) {
      const oldest = compositePool.keys().next().value;
      const stale = compositePool.get(oldest);
      stale.width = 0;
      stale.height = 0;
      compositePool.delete(oldest);
    }
  }
  return canvas;
}

/**
 * Draws `image` as the layer plane described by `quad`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource & {width?:number, height?:number, videoWidth?:number, videoHeight?:number}} image
 * @param {object} quad  `projectedTransform.quad` from project3DLayer
 * @param {{ opacity?: number, minSubdivisions?: number, maxSubdivisions?: number }} [options]
 * @returns {boolean} true when at least one cell was drawn
 */
export function drawProjectedQuad(ctx, image, quad, options = {}) {
  const { opacity = 1 } = options;
  const alpha = Math.max(0, Math.min(1, opacity));
  if (!ctx || !image || !quad?.camCorners || quad.camCorners.length !== 4) return false;
  if (alpha === 0) return false;

  // Single pass at (near-)full opacity, or when the context cannot give us a
  // transform to copy (a recording mock, a test double).
  const canGroup = typeof ctx.getTransform === 'function' && ctx.canvas?.width > 0;
  if (alpha >= 0.999 || !canGroup) {
    return rasterizeQuad(ctx, image, quad, options, alpha);
  }

  const surface = acquireCompositeSurface(ctx.canvas.width, ctx.canvas.height);
  const sctx = surface.getContext('2d');
  if (!sctx) return rasterizeQuad(ctx, image, quad, options, alpha);

  const m = ctx.getTransform();
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalAlpha = 1;
  sctx.clearRect(0, 0, surface.width, surface.height);
  sctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);

  if (!rasterizeQuad(sctx, image, quad, options, 1)) return false;

  // Composite the layer as a group, once, in device space.
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.max(0, Math.min(1, ctx.globalAlpha * alpha));
    ctx.drawImage(surface, 0, 0);
  } finally {
    ctx.restore();
  }
  return true;
}

/**
 * The single-pass rasterizer: draws every visible cell of the quad at
 * `alpha × ctx.globalAlpha` into `ctx`.
 */
function rasterizeQuad(ctx, image, quad, options, alpha = 1) {
  const { minSubdivisions = 2, maxSubdivisions = 24 } = options;

  const { camCorners, focalLength, viewport, near = 1, far = Infinity } = quad;
  if (!focalLength || !viewport?.width || !viewport?.height) return false;

  // Nothing to draw when the whole plane is behind the near plane or past the
  // far plane; individual cells handle the straddling case.
  const zs = camCorners.map((c) => c.z);
  if (Math.max(...zs) <= near) return false;
  if (Math.min(...zs) >= far) return false;

  const srcW = image.videoWidth || image.naturalWidth || image.width || quad.width || 0;
  const srcH = image.videoHeight || image.naturalHeight || image.height || quad.height || 0;
  if (!srcW || !srcH) return false;

  const n = quadSubdivisions(camCorners, {
    min: minSubdivisions,
    max: maxSubdivisions,
    focalLength,
    viewport,
  });

  // Pre-compute the grid in camera space and its projection. Camera-space
  // interpolation is exact (the layer plane is affine in s, t), so the only
  // approximation left is the per-cell affine texture map.
  const grid = [];
  for (let i = 0; i <= n; i++) {
    const row = [];
    for (let j = 0; j <= n; j++) {
      const s = i / n;
      const t = j / n;
      const cam = lerpQuadCorner(camCorners, s, t);
      row.push({ ...cam, u: s * srcW, v: t * srcH });
    }
    grid.push(row);
  }

  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = Math.max(0, Math.min(1, prevAlpha * alpha));

  let drew = false;
  try {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const p00 = grid[i][j];
        const p10 = grid[i + 1][j];
        const p11 = grid[i + 1][j + 1];
        const p01 = grid[i][j + 1];

        // Clip each triangle against the camera planes and fill the whole
        // surviving polygon, so a layer crossing the near plane keeps a clean
        // edge instead of losing a whole cell.
        for (const tri of [
          [p00, p10, p11],
          [p00, p11, p01],
        ]) {
          const clipped = clipPolygonToCamera(tri, near, far);
          if (clipped.length < 3) continue;

          const screen = clipped.map((p) => projectCameraPoint(p, focalLength, viewport));
          for (let k = 1; k < screen.length - 1; k++) {
            if (Math.abs(triangleArea(screen[0], screen[k], screen[k + 1])) < 1e-4) continue;
            drawTexturedTriangle(
              ctx,
              image,
              [
                [clipped[0].u, clipped[0].v],
                [clipped[k].u, clipped[k].v],
                [clipped[k + 1].u, clipped[k + 1].v],
              ],
              [screen[0], screen[k], screen[k + 1]]
            );
            drew = true;
          }
        }
      }
    }
  } finally {
    ctx.globalAlpha = prevAlpha;
  }

  return drew;
}
