/**
 * drawWaveform — the canvas timeline's waveform pass.
 *
 * The DOM timeline draws each clip's waveform with its own
 * <canvas> per clip (shared/WaveformCanvas.jsx). The canvas timeline has ONE
 * canvas, so the same envelope is drawn here from the peak slice for the
 * clip's current `mediaOffset` window, scaled to its card.
 *
 * The shape maths is the same as WaveformCanvas.jsx's draw pass on purpose —
 * a real min/max envelope path with an inner RMS "loudness" fill, mirrored
 * about the card's centre line, plus the same neutral hatch placeholder while
 * peaks are still being generated, so a project looks identical in both
 * renderers and "no audio here" stays distinguishable from "still working".
 * Keep the two in step when either changes.
 */

/**
 * Draw a filled min/max envelope (mirrored about the mid-line) into a
 * sub-rectangle of the target context. The caller has already clipped to the
 * visible viewport and decides where the card is.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} params
 * @param {number} params.x left edge of the waveform box, device-space px
 * @param {number} params.y top edge
 * @param {number} params.width box width
 * @param {number} params.height box height
 * @param {{ mins: Float32Array|number[], maxs: Float32Array|number[], rms?: Float32Array|number[] }|null} params.envelope
 * @param {string} params.color envelope fill
 * @param {string} [params.rmsColor]
 * @param {boolean} [params.mirror=true]
 */
export function drawWaveformEnvelope(ctx, { x, y, width, height, envelope, color, rmsColor, mirror = true }) {
  if (!envelope || width <= 0 || height <= 0) return;
  const { mins, maxs, rms } = envelope;
  if (!mins || !maxs || mins.length === 0) return;

  // Clamp to the shortest array: a mismatched pair (a stale envelope from a
  // different bucket count, say) would otherwise read `maxs[i]` as undefined
  // and fill the path with NaN, which silently draws nothing at all.
  const n = Math.min(mins.length, maxs.length);
  if (n === 0) return;
  const midY = y + (mirror ? height / 2 : height);
  const maxAmpH = mirror ? height / 2 - 1 : height - 2;
  const stepX = width / n;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  // Outer envelope: max samples left-to-right, min samples right-to-left, as
  // ONE closed path — a smooth continuous shape rather than per-bucket bars.
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const px = x + i * stepX;
    const py = mirror ? midY - maxs[i] * maxAmpH : y + height - 1 - maxs[i] * maxAmpH;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  for (let i = n - 1; i >= 0; i--) {
    const px = x + i * stepX;
    const py = mirror ? midY - mins[i] * maxAmpH : y + height - 1;
    ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  // Inner RMS fill: brighter, slimmer shape tracking perceived loudness.
  if (rms && rms.length >= n && maxAmpH > 6) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x + i * stepX;
      const py = mirror ? midY - rms[i] * maxAmpH : y + height - 1 - rms[i] * maxAmpH;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    for (let i = n - 1; i >= 0; i--) {
      const px = x + i * stepX;
      const py = mirror ? midY + rms[i] * maxAmpH : y + height - 1;
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = rmsColor || brighten(color);
    ctx.fill();
  }

  if (mirror && maxAmpH > 10) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(x, midY - 0.5, width, 1);
  }

  ctx.restore();
}

/**
 * Neutral "peaks are still generating" fill — a faint centre bar with a
 * diagonal hatch, matching WaveformCanvas.jsx's placeholder exactly.
 */
export function drawWaveformPlaceholder(ctx, { x, y, width, height, mirror = true }) {
  if (width <= 0 || height <= 0) return;
  const midY = y + (mirror ? height / 2 : height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.fillRect(x, midY - 1, width, 2);

  ctx.beginPath();
  const stripeGap = 9;
  for (let sx = x - height; sx < x + width; sx += stripeGap) {
    ctx.moveTo(sx, y + height);
    ctx.lineTo(sx + height, y);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.stroke();
  ctx.restore();
}

/** Buckets-per-pixel for a card height, mirroring WaveformCanvas's detailForHeight. */
export function detailForHeight(height) {
  if (height <= 56) return 1;
  if (height <= 90) return 1.5;
  if (height <= 140) return 2.5;
  if (height <= 220) return 4;
  return 6;
}

/**
 * Bucket count to request for a card of this width/height, snapped to a coarse
 * grid (multiples of 20) so sub-pixel jitter during a drag/zoom does not spam
 * the peak decoder with a new cache key every frame.
 */
export function bucketsForCard(width, height) {
  const raw = Math.max(20, Math.round(width * detailForHeight(height)));
  return Math.ceil(raw / 20) * 20;
}

/** Brightens an rgba()/rgb() colour for the inner RMS fill (see WaveformCanvas). */
function brighten(colorStr) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/.exec(colorStr);
  if (!m) return colorStr;
  const [, r, g, b, a] = m;
  const boost = (v) => Math.min(255, Math.round(Number(v) * 1.0 + (255 - Number(v)) * 0.35));
  const alpha = a !== undefined ? Math.min(1, Number(a) + 0.25) : 0.9;
  return `rgba(${boost(r)}, ${boost(g)}, ${boost(b)}, ${alpha})`;
}
