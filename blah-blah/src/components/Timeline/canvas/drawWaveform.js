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
 * @param {{scrollLeft:number, width:number}} [params.view] visible content-space
 *        x range, used to skip off-screen buckets (see below)
 */
export function drawWaveformEnvelope(ctx, { x, y, width, height, envelope, color, rmsColor, mirror = true, view }) {
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

  // ── Visible-bucket culling ───────────────────────────────────────────
  // The envelope's `n` buckets are spread across the WHOLE card, and a long
  // clip's card is far wider than the viewport (a 1-hour clip at 200 px/s is
  // 720000px wide). Walking every bucket to build the fill path — twice, once
  // for the envelope and once for the RMS shape — meant tens of thousands of
  // path ops per clip per frame, which is what made dragging or zooming a
  // timeline with long audio stutter. Only the buckets that can land inside
  // the viewport are walked, so the cost tracks how much waveform is ON SCREEN
  // rather than how long the clip is. The +-1 padding keeps the shape joined at
  // the viewport edges.
  let first = 0;
  let last = n - 1;
  if (view && Number.isFinite(view.scrollLeft) && Number.isFinite(view.width)) {
    const viewLeft = view.scrollLeft - x;
    const viewRight = view.scrollLeft + view.width - x;
    first = Math.max(0, Math.floor(viewLeft / stepX) - 1);
    last = Math.min(n - 1, Math.ceil(viewRight / stepX) + 1);
    if (last < first) return; // entirely off screen
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  // Outer envelope: max samples left-to-right, min samples right-to-left, as
  // ONE closed path — a smooth continuous shape rather than per-bucket bars.
  ctx.beginPath();
  for (let i = first; i <= last; i++) {
    const px = x + i * stepX;
    const py = mirror ? midY - maxs[i] * maxAmpH : y + height - 1 - maxs[i] * maxAmpH;
    if (i === first) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  for (let i = last; i >= first; i--) {
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
    for (let i = first; i <= last; i++) {
      const px = x + i * stepX;
      const py = mirror ? midY - rms[i] * maxAmpH : y + height - 1 - rms[i] * maxAmpH;
      if (i === first) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    for (let i = last; i >= first; i--) {
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
export function drawWaveformPlaceholder(ctx, { x, y, width, height, mirror = true, view }) {
  if (width <= 0 || height <= 0) return;
  const midY = y + (mirror ? height / 2 : height);

  // Same visible-range culling as drawWaveformEnvelope: a very wide card would
  // otherwise stroke thousands of hatch stripes that are clipped away anyway.
  const from = view ? Math.max(x - height, view.scrollLeft - height) : x - height;
  const to = view ? Math.min(x + width, view.scrollLeft + view.width) : x + width;
  if (to <= from) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.fillRect(x, midY - 1, width, 2);

  ctx.beginPath();
  const stripeGap = 9;
  for (let sx = from; sx < to; sx += stripeGap) {
    ctx.moveTo(sx, y + height);
    ctx.lineTo(sx + height, y);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.stroke();
  ctx.restore();
}

/**
 * The bucket-count policy is shared: it lives in utils/waveformResolution.js and
 * is re-exported here so the canvas draw path keeps asking for the SAME
 * envelope count as the DOM's WaveformCanvas (see the note on bucketsForCard
 * for why the two must never disagree).
 */
export {
  detailForHeight,
  bucketsForCard,
  MIN_WAVEFORM_BUCKETS,
  MAX_WAVEFORM_BUCKETS,
} from '../../../utils/waveformResolution.js';

/** Brightens an rgba()/rgb() colour for the inner RMS fill (see WaveformCanvas). */
function brighten(colorStr) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/.exec(colorStr);
  if (!m) return colorStr;
  const [, r, g, b, a] = m;
  const boost = (v) => Math.min(255, Math.round(Number(v) * 1.0 + (255 - Number(v)) * 0.35));
  const alpha = a !== undefined ? Math.min(1, Number(a) + 0.25) : 0.9;
  return `rgba(${boost(r)}, ${boost(g)}, ${boost(b)}, ${alpha})`;
}
