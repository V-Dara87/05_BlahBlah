import path from 'node:path';
import zlib from 'node:zlib';
import { loadProject } from './project.js';

export const MAX_RENDER_DIMENSION = 8192;

function assertFiniteTime(time) {
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
    throw new Error(`time must be a number >= 0 (got ${String(time)}).`);
  }
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Only plain CSS-ish colors reach SVG attributes. */
function safeColor(value, fallback = '#38bdf8') {
  return typeof value === 'string' && /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(value.trim())
    ? value.trim()
    : fallback;
}

// Cubic Bezier solver matching BlahBlah keyframe engine
function evaluateBezier(cp1, cp2, t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  // Newton-Raphson to solve for parameter u where x(u) = t
  let u = t;
  for (let i = 0; i < 8; i++) {
    const currentX =
      3 * (1 - u) * (1 - u) * u * cp1.x +
      3 * (1 - u) * u * u * cp2.x +
      u * u * u;
    const diff = currentX - t;
    if (Math.abs(diff) < 1e-5) break;

    const dxdu =
      3 * (1 - u) * (1 - u) * cp1.x +
      6 * (1 - u) * u * (cp2.x - cp1.x) +
      3 * u * u * (1 - cp2.x);
    if (Math.abs(dxdu) < 1e-6) break;
    u -= diff / dxdu;
  }

  // Evaluate y(u)
  return (
    3 * (1 - u) * (1 - u) * u * cp1.y +
    3 * (1 - u) * u * u * cp2.y +
    u * u * u
  );
}

function evaluateFieldAtTime(keyframesList = [], t = 0, defaultValue = 0) {
  if (!keyframesList || keyframesList.length === 0) return defaultValue;
  if (keyframesList.length === 1) return keyframesList[0].value;

  const sorted = [...keyframesList].sort((a, b) => a.time - b.time);
  if (t <= sorted[0].time) return sorted[0].value;
  if (t >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.time && t <= b.time) {
      const dt = b.time - a.time;
      if (dt <= 0) return b.value;
      const progress = (t - a.time) / dt;
      const cp1 = a.cp1 || { x: 0.25, y: 0.25 };
      const cp2 = a.cp2 || { x: 0.75, y: 0.75 };
      const eased = evaluateBezier(cp1, cp2, progress);

      if (typeof a.value === 'number' && typeof b.value === 'number') {
        return a.value + (b.value - a.value) * eased;
      }
      return progress >= 0.5 ? b.value : a.value;
    }
  }

  return sorted[sorted.length - 1].value;
}

/**
 * Evaluates all entities and keyframes in a project at a specific timestamp.
 */
export function evaluateTimelineAtTime(project, time = 0) {
  assertFiniteTime(time);
  const entities = project.entities || [];
  const tracks = project.tracks || [];
  const resolution = project.resolution || { width: 1920, height: 1080 };

  const trackMap = new Map(tracks.map((t) => [t.id, t]));

  const activeEntities = [];

  for (const entity of entities) {
    if (entity.active === false) continue;
    const track = trackMap.get(entity.trackId);
    // A hidden track draws nothing. (Muted only affects audio, not visuals.)
    if (track && track.visible === false) continue;

    const start = entity.startTime || 0;
    const end = start + (entity.duration || 0);

    if (time >= start && time < end) {
      const localTime = time - start;

      // Resolve evaluated transform
      const origTransform =
        (entity.components || []).find((c) => c.type === 'Transform') || {
          x: 0,
          y: 0,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
        };

      const kfs = entity.keyframes?.Transform || {};
      const transform = {
        x: evaluateFieldAtTime(kfs.x, localTime, origTransform.x ?? 0),
        y: evaluateFieldAtTime(kfs.y, localTime, origTransform.y ?? 0),
        rotation: evaluateFieldAtTime(kfs.rotation, localTime, origTransform.rotation ?? 0),
        scaleX: evaluateFieldAtTime(kfs.scaleX, localTime, origTransform.scaleX ?? 1),
        scaleY: evaluateFieldAtTime(kfs.scaleY, localTime, origTransform.scaleY ?? 1),
        opacity: evaluateFieldAtTime(kfs.opacity, localTime, origTransform.opacity ?? 1),
      };

      // Resolve script props if any
      const scriptComp = (entity.components || []).find((c) => c.type === 'ScriptComponent');
      let scriptProps = { ...(scriptComp?.props || {}) };
      if (scriptComp && entity.keyframes?.[`script:${scriptComp.scriptId}`]) {
        const scriptKfs = entity.keyframes[`script:${scriptComp.scriptId}`];
        for (const [propName, list] of Object.entries(scriptKfs)) {
          scriptProps[propName] = evaluateFieldAtTime(list, localTime, scriptProps[propName]);
        }
      }

      activeEntities.push({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        trackId: entity.trackId,
        color: entity.color,
        localTime,
        transform,
        scriptComponent: scriptComp
          ? {
              scriptName: scriptComp.scriptName,
              scriptId: scriptComp.scriptId,
              props: scriptProps,
            }
          : null,
      });
    }
  }

  return {
    time,
    resolution,
    activeEntitiesCount: activeEntities.length,
    activeEntities,
  };
}

/**
 * Generates an SVG representation of the project canvas at time `t`.
 */
export function renderFrameSvg(project, time = 0) {
  const { resolution, activeEntities } = evaluateTimelineAtTime(project, time);
  const { width, height } = resolution;
  assertRenderSize(width, height);
  const centerX = width / 2;
  const centerY = height / 2;

  let elements = '';

  for (const item of activeEntities) {
    const { transform, name, color, scriptComponent } = item;
    const x = centerX + (transform.x || 0);
    const y = centerY + (transform.y || 0);
    const rot = transform.rotation || 0;
    const sx = transform.scaleX || 1;
    const sy = transform.scaleY || 1;
    const op = transform.opacity ?? 1;

    const rawLabel = scriptComponent?.props?.title || scriptComponent?.scriptName || name;
    const label = escapeXml(typeof rawLabel === 'string' || typeof rawLabel === 'number' ? rawLabel : name);
    const boxColor = safeColor(color);

    elements += `
      <g transform="translate(${x}, ${y}) rotate(${rot}) scale(${sx}, ${sy})" opacity="${op}">
        <rect x="-100" y="-50" width="200" height="100" rx="8" fill="${boxColor}" fill-opacity="0.25" stroke="${boxColor}" stroke-width="3" />
        <text x="0" y="5" fill="#ffffff" font-size="20" font-family="sans-serif" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${label}</text>
        <text x="0" y="30" fill="${boxColor}" font-size="12" font-family="monospace" text-anchor="middle">t=${time.toFixed(2)}s</text>
      </g>
    `;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="#0f172a"/>
  <!-- Grid Lines -->
  <line x1="${centerX}" y1="0" x2="${centerX}" y2="${height}" stroke="#1e293b" stroke-width="2" stroke-dasharray="6 6"/>
  <line x1="0" y1="${centerY}" x2="${width}" y2="${centerY}" stroke="#1e293b" stroke-width="2" stroke-dasharray="6 6"/>
  <text x="24" y="48" fill="#64748b" font-size="18" font-family="sans-serif">BlahBlah Headless Frame Preview | Time: ${time.toFixed(2)}s | Res: ${width}x${height}</text>
  ${elements}
</svg>`;

  return svg;
}

function assertRenderSize(width, height) {
  const ok = (n) => Number.isInteger(n) && n > 0 && n <= MAX_RENDER_DIMENSION;
  if (!ok(width) || !ok(height)) {
    throw new Error(`Project resolution ${width}x${height} is not renderable (1-${MAX_RENDER_DIMENSION} px per side).`);
  }
}

// ─── Pure-JS minimal PNG encoder ─────────────────────────────────────────────

function pngUint32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(...buffers) {
  let crc = 0xffffffff;
  for (const buf of buffers) {
    for (let i = 0; i < buf.length; i++) {
      crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  return Buffer.concat([pngUint32(data.length), typeBytes, data, pngUint32(crc32(typeBytes, data))]);
}

function hexToRgb(hex, fallback = [56, 189, 248]) {
  let h = String(hex ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return fallback;
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// ─── Pure-JS 5x7 ASCII Bitmap Font (ASCII 32..126) ───────────────────────────
const FONT_5X7_B64 =
  'AAAAAAAAAF8AAAAHAAcAFH8UfxQkKn8qEiMTCGRiNklVIlAABQMAAAAcIkEAAEEiHAAIKhwqCAgIPggIAFAwAAAICAgICABgYAAAIBAIBAI+UUlFPgBCf0AAQmFRSUYhQUVLMRgUEn8QJ0VFRTk8SklJMAFxCQUDNklJSTYGSUkpHgA2NgAAAFY2AAAACBQiQRQUFBQUQSIUCAACAVEJBjJJeUE+fhEREX5/SUlJNj5BQUEif0FBIhx/SUlJQX8JCQEBPkFBUTJ/CAgIfwBBf0EAIEBBPwF/CBQiQX9AQEBAfwIEAn9/BAgQfz5BQUE+fwkJCQY+QVEhXn8JGSlGRklJSTEBAX8BAT9AQEA/HyBAIB9/IBggf2MUCBRjAwR4BANhUUlFQwB/QUEAAgQIECAAQUF/AAQCAQIEQEBAQEAAAQIEACBUVFR4f0hERDg4REREIDhEREh/OFRUVBgIfgkBAggUVFQ8fwgEBHgARH1AACBARD0AAH8QKEQAQX9AAHwEGAR4fAgEBHg4REREOHwUFBQICBQUGHx8CAQECEhUVFQgBD9EQCA8QEAgfBwgQCAcPEAwQDxEKBAoRAxQUFA8RGRUTEQACDZBAAAAfwAAAEE2CAAICCocCA==';
const FONT_DATA = Buffer.from(FONT_5X7_B64, 'base64');

function drawGlyph(pixels, width, height, charCode, startX, startY, scale, r, g, b, a = 255) {
  const glyphIdx = charCode >= 32 && charCode <= 126 ? charCode - 32 : 63 - 32; // fallback '?'
  const offset = glyphIdx * 5;
  for (let c = 0; c < 5; c++) {
    const col = FONT_DATA[offset + c];
    for (let row = 0; row < 7; row++) {
      if (col & (1 << row)) {
        for (let sy = 0; sy < scale; sy++) {
          const py = startY + row * scale + sy;
          if (py < 0 || py >= height) continue;
          for (let sx = 0; sx < scale; sx++) {
            const px = startX + c * scale + sx;
            if (px < 0 || px >= width) continue;
            blendPixel(pixels, width, height, px, py, r, g, b, a);
          }
        }
      }
    }
  }
}

function drawText(pixels, width, height, text, x, y, scale = 1, r = 255, g = 255, b = 255, a = 255, align = 'left') {
  const str = String(text ?? '');
  const charSpacing = 1 * scale;
  const charWidth = 5 * scale + charSpacing;
  const totalWidth = str.length > 0 ? str.length * charWidth - charSpacing : 0;

  let startX = x;
  if (align === 'center') {
    startX = Math.round(x - totalWidth / 2);
  } else if (align === 'right') {
    startX = Math.round(x - totalWidth);
  }

  for (let i = 0; i < str.length; i++) {
    drawGlyph(pixels, width, height, str.charCodeAt(i), startX + i * charWidth, y, scale, r, g, b, a);
  }
  return totalWidth;
}

/** Alpha-blends a colour onto the (opaque) canvas. `a` is 0-255. */
function blendPixel(pixels, width, height, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= width || y >= height || a <= 0) return;
  const idx = (y * width + x) * 4;
  const k = Math.min(255, a) / 255;
  pixels[idx] = Math.round(pixels[idx] + (r - pixels[idx]) * k);
  pixels[idx + 1] = Math.round(pixels[idx + 1] + (g - pixels[idx + 1]) * k);
  pixels[idx + 2] = Math.round(pixels[idx + 2] + (b - pixels[idx + 2]) * k);
  pixels[idx + 3] = 255;
}

function drawHLine(pixels, width, height, y, r, g, b, dashOn = 6, dashOff = 6) {
  if (y < 0 || y >= height) return;
  for (let x = 0; x < width; x++) {
    if (x % (dashOn + dashOff) < dashOn) blendPixel(pixels, width, height, x, y, r, g, b, 200);
  }
}

function drawVLine(pixels, width, height, x, r, g, b, dashOn = 6, dashOff = 6) {
  if (x < 0 || x >= width) return;
  for (let y = 0; y < height; y++) {
    if (y % (dashOn + dashOff) < dashOn) blendPixel(pixels, width, height, x, y, r, g, b, 200);
  }
}

/**
 * Draws a translucent box with a solid outline, honouring position, scale,
 * rotation (degrees, clockwise) and opacity like the SVG renderer does.
 */
function drawEntityBox(pixels, width, height, cx, cy, hw, hh, rotationDeg, rgb, opacity, strokeW = 3, fillAlpha = 64) {
  const [r, g, b] = rgb;
  const theta = ((rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const reach = Math.ceil(Math.hypot(hw, hh));
  const op = Math.max(0, Math.min(1, opacity));

  for (let py = Math.max(0, Math.floor(cy - reach)); py <= Math.min(height - 1, Math.ceil(cy + reach)); py++) {
    for (let px = Math.max(0, Math.floor(cx - reach)); px <= Math.min(width - 1, Math.ceil(cx + reach)); px++) {
      const dx = px - cx;
      const dy = py - cy;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const insideX = hw - Math.abs(lx);
      const insideY = hh - Math.abs(ly);
      if (insideX < 0 || insideY < 0) continue;
      const onEdge = Math.min(insideX, insideY) < strokeW;
      blendPixel(pixels, width, height, px, py, r, g, b, (onEdge ? 255 : fillAlpha) * op);
    }
  }
}

/**
 * Computes bounding boxes, out-of-bounds overflow, and pairwise collision/overlaps
 * between active entities at time `t`. Crucial for autonomous AI self-correction.
 */
export function diagnoseFrameLayout(project, time = 0) {
  const evaluated = evaluateTimelineAtTime(project, time);
  const { width, height } = evaluated.resolution;
  const centerX = width / 2;
  const centerY = height / 2;

  const boxes = evaluated.activeEntities.map((ent) => {
    const cx = centerX + (ent.transform.x || 0);
    const cy = centerY + (ent.transform.y || 0);
    const hw = Math.abs(100 * (ent.transform.scaleX ?? 1));
    const hh = Math.abs(50 * (ent.transform.scaleY ?? 1));
    const x1 = Math.round(cx - hw);
    const y1 = Math.round(cy - hh);
    const x2 = Math.round(cx + hw);
    const y2 = Math.round(cy + hh);
    const w = x2 - x1;
    const h = y2 - y1;
    const area = w * h;

    const rawLabel = ent.scriptComponent?.props?.title || ent.scriptComponent?.scriptName || ent.name;
    const label = String(rawLabel ?? ent.id);

    // Overflow check
    const overflow = {
      left: x1 < 0 ? -x1 : 0,
      right: x2 > width ? x2 - width : 0,
      top: y1 < 0 ? -y1 : 0,
      bottom: y2 > height ? y2 - height : 0,
    };
    const isOutOfBounds = overflow.left > 0 || overflow.right > 0 || overflow.top > 0 || overflow.bottom > 0;

    return {
      id: ent.id,
      name: ent.name,
      label,
      type: ent.type,
      color: ent.color,
      opacity: ent.transform.opacity ?? 1,
      bounds: { x1, y1, x2, y2, width: w, height: h, centerX: Math.round(cx), centerY: Math.round(cy) },
      area,
      isOutOfBounds,
      overflow,
    };
  });

  const overlaps = [];
  const warnings = [];

  // Out of bounds warnings
  for (const b of boxes) {
    if (b.isOutOfBounds) {
      const parts = [];
      if (b.overflow.left > 0) parts.push(`left edge by ${b.overflow.left}px`);
      if (b.overflow.right > 0) parts.push(`right edge by ${b.overflow.right}px`);
      if (b.overflow.top > 0) parts.push(`top edge by ${b.overflow.top}px`);
      if (b.overflow.bottom > 0) parts.push(`bottom edge by ${b.overflow.bottom}px`);
      warnings.push(`Entity "${b.label}" (${b.id}) is out of bounds: exceeds ${parts.join(', ')}.`);
    }
  }

  // Pairwise overlap check
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ox1 = Math.max(a.bounds.x1, b.bounds.x1);
      const oy1 = Math.max(a.bounds.y1, b.bounds.y1);
      const ox2 = Math.min(a.bounds.x2, b.bounds.x2);
      const oy2 = Math.min(a.bounds.y2, b.bounds.y2);

      if (ox1 < ox2 && oy1 < oy2) {
        const overlapWidth = ox2 - ox1;
        const overlapHeight = oy2 - oy1;
        const overlapArea = overlapWidth * overlapHeight;
        const ratioA = a.area > 0 ? overlapArea / a.area : 0;
        const ratioB = b.area > 0 ? overlapArea / b.area : 0;

        overlaps.push({
          entityA: { id: a.id, label: a.label },
          entityB: { id: b.id, label: b.label },
          intersection: { x1: ox1, y1: oy1, x2: ox2, y2: oy2, width: overlapWidth, height: overlapHeight, area: overlapArea },
          percentOverlapA: Math.round(ratioA * 100),
          percentOverlapB: Math.round(ratioB * 100),
        });

        warnings.push(
          `Collision: "${a.label}" and "${b.label}" overlap by ${overlapArea}px (${Math.round(ratioA * 100)}% of "${a.label}", ${Math.round(ratioB * 100)}% of "${b.label}").`
        );
      }
    }
  }

  const suggestions = [];
  for (const ov of overlaps) {
    if (ov.percentOverlapA > 20 || ov.percentOverlapB > 20) {
      suggestions.push(
        `Move "${ov.entityA.label}" or "${ov.entityB.label}" vertically or horizontally to avoid text collision.`
      );
    }
  }
  for (const b of boxes) {
    if (b.isOutOfBounds) {
      suggestions.push(`Adjust position or scale of "${b.label}" to stay within the canvas.`);
    }
  }

  return {
    time,
    resolution: evaluated.resolution,
    activeEntitiesCount: boxes.length,
    entities: boxes,
    overlaps,
    warnings,
    suggestions: [...new Set(suggestions)],
  };
}

/**
 * Generates a PNG raster image of the project canvas at time `t`.
 * Uses a pure-JS PNG encoder (zlib deflateSync) with built-in bitmap text rendering.
 *
 * NOTE: this is a SCHEMATIC preview. Every active entity is drawn as a box at
 * its evaluated transform; the output of the entity's script is not rendered.
 * @returns {Buffer} PNG file bytes
 */
export function renderFramePng(project, time = 0) {
  const { resolution, activeEntities } = evaluateTimelineAtTime(project, time);
  const { width, height } = resolution;
  assertRenderSize(width, height);
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);

  // RGBA pixel buffer
  const pixels = new Uint8Array(width * height * 4);

  // Dark background #0f172a
  const [bgR, bgG, bgB] = hexToRgb('#0f172a');
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = bgR;
    pixels[i * 4 + 1] = bgG;
    pixels[i * 4 + 2] = bgB;
    pixels[i * 4 + 3] = 255;
  }

  // Grid lines #1e293b
  const [gR, gG, gB] = hexToRgb('#1e293b');
  drawVLine(pixels, width, height, centerX, gR, gG, gB);
  drawHLine(pixels, width, height, centerY, gR, gG, gB);

  // Header info bar
  const headerScale = Math.max(1, Math.min(3, Math.floor(width / 640)));
  const headerText = `BlahBlah Frame Preview | Time: ${time.toFixed(2)}s | Res: ${width}x${height} | Active: ${activeEntities.length}`;
  drawText(pixels, width, height, headerText, 24, 28, headerScale, 100, 116, 139, 230);

  // Draw entities as boxes with labels
  for (const item of activeEntities) {
    const { transform, color, name, scriptComponent } = item;
    const cx = centerX + (transform.x || 0);
    const cy = centerY + (transform.y || 0);
    const sx = transform.scaleX ?? 1;
    const sy = transform.scaleY ?? 1;
    const hw = Math.abs(100 * sx);
    const hh = Math.abs(50 * sy);
    const rgb = hexToRgb(color);
    const op = transform.opacity ?? 1;

    drawEntityBox(
      pixels,
      width,
      height,
      cx,
      cy,
      hw,
      hh,
      transform.rotation || 0,
      rgb,
      op
    );

    // Entity label and timestamp
    const rawLabel = scriptComponent?.props?.title || scriptComponent?.scriptName || name;
    const label = String(typeof rawLabel === 'string' || typeof rawLabel === 'number' ? rawLabel : name);
    const fontScale = Math.max(1, Math.min(4, Math.floor(2 * Math.min(Math.abs(sx), Math.abs(sy)))));

    // Center text vertically inside the box
    const labelY = Math.round(cy - 10 * fontScale);
    const timeY = Math.round(cy + 4 * fontScale);

    drawText(pixels, width, height, label, cx, labelY, fontScale, 255, 255, 255, Math.round(255 * op), 'center');
    drawText(pixels, width, height, `t=${time.toFixed(2)}s`, cx, timeY, Math.max(1, fontScale - 1), rgb[0], rgb[1], rgb[2], Math.round(220 * op), 'center');
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // One filter byte (0 = None) in front of every scanline.
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let row = 0; row < height; row++) {
    const offset = row * (1 + stride);
    raw[offset] = 0;
    Buffer.from(pixels.buffer, row * stride, stride).copy(raw, offset + 1);
  }

  // PNG's IDAT stream is zlib-wrapped deflate (RFC 1950), not raw deflate.
  const compressed = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Executes or creates an FFmpeg export command.
 */
export async function exportWithFfmpeg({
  projectDir = process.cwd(),
  outputPath = 'output.mp4',
  format = 'mp4',
  quality = 'high',
  fps = 60,
} = {}) {
  const { project } = await loadProject(projectDir);
  const { width, height } = project.resolution || { width: 1920, height: 1080 };
  const totalDuration = (project.entities || []).reduce((max, e) => {
    return Math.max(max, (e.startTime || 0) + (e.duration || 0));
  }, 5);

  const crf = quality === 'ultra' ? '18' : quality === 'high' ? '23' : '28';
  const out = path.resolve(outputPath);
  if (/["`$\n\r]/.test(out)) {
    throw new Error('outputPath must not contain quotes, backticks, "$" or line breaks.');
  }

  return {
    // This only BUILDS a command line; nothing is executed and the command
    // produces a black placeholder video, not the project's real frames.
    planOnly: true,
    note: 'Plan only: the command renders a black placeholder, not the project timeline.',
    success: true,
    resolution: `${width}x${height}`,
    totalDuration,
    format,
    fps,
    crf,
    outputPath: out,
    command: `ffmpeg -f lavfi -i color=c=black:s=${width}x${height}:r=${fps} -t ${totalDuration} -c:v libx264 -crf ${crf} -pix_fmt yuv420p "${out}"`,
  };
}