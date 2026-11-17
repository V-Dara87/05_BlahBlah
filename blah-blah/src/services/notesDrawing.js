/**
 * notesDrawing — paints a note's marks (see notesCore.sanitizeDrawing) onto a
 * canvas 2D context.
 *
 * Used by two callers so a mark looks the same everywhere:
 *   - components/notes/NoteDraw.jsx, the live overlay on the preview, and
 *   - hooks/notesStore.js, which burns the marks into a copy of the frame
 *     (frames/<id>-marked.png) so an AI agent can SEE what was marked.
 *
 * Marks are annotations. Nothing here touches the project or the export
 * pipeline; the video render never draws them.
 *
 * Coordinates are 0..1 fractions of the frame and a mark's `size` is a
 * fraction of the frame WIDTH, so the same drawing paints correctly on a
 * preview canvas, a downscaled capture and a 4K frame.
 */

const HALO = 'rgba(0, 0, 0, 0.55)';
const FILL_ALPHA = 0.14;

function buildPath(shape, W, H, lineWidth) {
  const path = new Path2D();

  if (shape.type === 'pen') {
    const pts = shape.points.map(([x, y]) => [x * W, y * H]);
    path.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) {
      // A zero-length line with round caps is a dot.
      path.lineTo(pts[0][0] + 0.01, pts[0][1]);
      return { path, fillable: false };
    }
    for (let i = 1; i < pts.length - 1; i += 1) {
      const midX = (pts[i][0] + pts[i + 1][0]) / 2;
      const midY = (pts[i][1] + pts[i + 1][1]) / 2;
      path.quadraticCurveTo(pts[i][0], pts[i][1], midX, midY);
    }
    const last = pts[pts.length - 1];
    path.lineTo(last[0], last[1]);
    return { path, fillable: false };
  }

  const x0 = shape.from[0] * W;
  const y0 = shape.from[1] * H;
  const x1 = shape.to[0] * W;
  const y1 = shape.to[1] * H;

  if (shape.type === 'rect') {
    path.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    return { path, fillable: true };
  }

  if (shape.type === 'ellipse') {
    path.ellipse(
      (x0 + x1) / 2,
      (y0 + y1) / 2,
      Math.max(0.5, Math.abs(x1 - x0) / 2),
      Math.max(0.5, Math.abs(y1 - y0) / 2),
      0,
      0,
      Math.PI * 2
    );
    return { path, fillable: true };
  }

  // arrow
  path.moveTo(x0, y0);
  path.lineTo(x1, y1);
  if (Math.hypot(x1 - x0, y1 - y0) > 1) {
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const head = Math.max(lineWidth * 4, W * 0.015);
    const spread = Math.PI / 7;
    for (const side of [-1, 1]) {
      path.moveTo(x1, y1);
      path.lineTo(x1 - head * Math.cos(angle + side * spread), y1 - head * Math.sin(angle + side * spread));
    }
  }
  return { path, fillable: false };
}

/**
 * Paints `shapes` over whatever is already on the canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} shapes  sanitized drawing shapes (or the live, unsaved ones)
 * @param {number} width     canvas width in pixels
 * @param {number} height    canvas height in pixels
 */
export function paintDrawing(ctx, shapes, width, height) {
  if (!ctx || !Array.isArray(shapes) || shapes.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const shape of shapes) {
    const lineWidth = Math.max(1.5, (shape.size || 0.005) * width);
    const { path, fillable } = buildPath(shape, width, height, lineWidth);
    if (fillable) {
      ctx.globalAlpha = FILL_ALPHA;
      ctx.fillStyle = shape.color;
      ctx.fill(path);
      ctx.globalAlpha = 1;
    }
    // A dark under-stroke keeps a mark readable on both light and dark video.
    ctx.strokeStyle = HALO;
    ctx.lineWidth = lineWidth + Math.max(2, lineWidth * 0.6);
    ctx.stroke(path);
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = lineWidth;
    ctx.stroke(path);
  }
  ctx.restore();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the captured frame.'));
    img.src = src;
  });
}

/**
 * Returns a PNG (base64, no data: prefix) of the captured frame with the
 * note's marks painted on top. The input is the clean frame; it is not changed.
 */
export async function compositeMarkedFrame(pngBase64, drawing) {
  if (!pngBase64) throw new Error('No frame to mark.');
  const img = await loadImage(`data:image/png;base64,${pngBase64}`);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  paintDrawing(ctx, drawing?.shapes, canvas.width, canvas.height);
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}