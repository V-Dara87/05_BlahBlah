import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import zlib from 'node:zlib';
import { loadProject } from './project.js';

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
  const entities = project.entities || [];
  const tracks = project.tracks || [];
  const resolution = project.resolution || { width: 1920, height: 1080 };

  const trackMap = new Map(tracks.map((t) => [t.id, t]));

  const activeEntities = [];

  for (const entity of entities) {
    if (entity.active === false) continue;
    const track = trackMap.get(entity.trackId);
    if (track && (track.visible === false || track.muted === true)) {
      // Keep in mind muted/hidden tracks
    }

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

    const label = scriptComponent?.props?.title || scriptComponent?.scriptName || name;
    const boxColor = color || '#38bdf8';

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

// ─── Pure-JS minimal PNG encoder ─────────────────────────────────────────────

function pngUint32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = pngUint32(data.length);

  // CRC over type + data
  let crc = 0xffffffff;
  for (const byte of [...typeBytes, ...data]) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  crc ^= 0xffffffff;
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function setPixel(pixels, width, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= width) return;
  const idx = (y * width + x) * 4;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
  pixels[idx + 3] = a;
}

function drawRect(pixels, width, height, x1, y1, w, h, r, g, b, a = 255) {
  for (let row = y1; row < y1 + h; row++) {
    if (row < 0 || row >= height) continue;
    for (let col = x1; col < x1 + w; col++) {
      setPixel(pixels, width, col, row, r, g, b, a);
    }
  }
}

function drawHLine(pixels, width, height, y, r, g, b, dashOn = 6, dashOff = 6) {
  if (y < 0 || y >= height) return;
  for (let x = 0; x < width; x++) {
    const phase = x % (dashOn + dashOff);
    if (phase < dashOn) setPixel(pixels, width, x, y, r, g, b, 200);
  }
}

function drawVLine(pixels, width, height, x, r, g, b, dashOn = 6, dashOff = 6) {
  if (x < 0 || x >= width) return;
  for (let y = 0; y < height; y++) {
    const phase = y % (dashOn + dashOff);
    if (phase < dashOn) setPixel(pixels, width, x, y, r, g, b, 200);
  }
}

function drawRoundedRect(pixels, width, height, cx, cy, hw, hh, rx, ry, rg, rb, ra, strokeW = 3, fillA = 60) {
  const x1 = cx - hw, y1 = cy - hh, x2 = cx + hw, y2 = cy + hh;
  // fill interior
  for (let row = y1; row <= y2; row++) {
    for (let col = x1; col <= x2; col++) {
      if (row < 0 || row >= height || col < 0 || col >= width) continue;
      const idx = (row * width + col) * 4;
      pixels[idx] = rx; pixels[idx + 1] = ry; pixels[idx + 2] = rg; pixels[idx + 3] = fillA;
    }
  }
  // stroke: top, bottom, left, right edges (strokeW px)
  for (let s = 0; s < strokeW; s++) {
    for (let col = x1; col <= x2; col++) {
      setPixel(pixels, width, col, y1 + s, rx, ry, rg, ra);
      setPixel(pixels, width, col, y2 - s, rx, ry, rg, ra);
    }
    for (let row = y1; row <= y2; row++) {
      setPixel(pixels, width, x1 + s, row, rx, ry, rg, ra);
      setPixel(pixels, width, x2 - s, row, rx, ry, rg, ra);
    }
  }
}

/**
 * Generates a PNG raster image of the project canvas at time `t`.
 * Uses a pure-JS PNG encoder (zlib deflateRawSync) — no native dependencies.
 * @returns {Buffer} PNG file bytes
 */
export function renderFramePng(project, time = 0) {
  const { resolution, activeEntities } = evaluateTimelineAtTime(project, time);
  const { width, height } = resolution;
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

  // Draw entities as boxes
  for (const item of activeEntities) {
    const { transform, color } = item;
    const ex = Math.floor(centerX + (transform.x || 0));
    const ey = Math.floor(centerY + (transform.y || 0));
    const sx = transform.scaleX || 1;
    const sy = transform.scaleY || 1;
    const hw = Math.floor(100 * sx);
    const hh = Math.floor(50 * sy);
    const [boxR, boxG, boxB] = hexToRgb(color || '#38bdf8');

    drawRoundedRect(pixels, width, height, ex, ey, hw, hh, boxR, boxG, boxB, 255, 255, 3, 60);
  }

  // Build PNG: PNG signature + IHDR + IDAT + IEND
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Filter bytes: one 0x00 byte per scanline (no filter)
  const filtered = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row++) {
    filtered[row * (1 + width * 4)] = 0; // filter type: None
    const src = Buffer.from(pixels.buffer, row * width * 4, width * 4);
    src.copy(filtered, row * (1 + width * 4) + 1);
  }

  const compressed = zlib.deflateRawSync(filtered);

  const png = Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  return png;
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

  return {
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
