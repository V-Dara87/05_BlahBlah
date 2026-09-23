import { useRef, useEffect, useState, memo } from 'react';
import { getWaveformPeaks } from '../../utils/audioWaveform';
import { bucketsForCard } from '../../utils/waveformResolution';
import { getAssetByUrl, getPeakStatus, subscribePeaksUpdated } from '../../services/peakCache';
 
/**
 * WaveformCanvas — renders a true signed-envelope audio waveform (DaVinci
 * Resolve / Audition style: a smooth filled shape following min/max sample
 * extremes, with an inner RMS "loudness" fill), not the old discrete
 * abs-peak bar strip.
 *
 * Resolution scales with BOTH pixel width and render height: a taller
 * track (user-resized) requests more buckets per pixel so the envelope
 * keeps resolving finer detail instead of just stretching the same low-res
 * shape vertically. This mirrors how DAWs reveal more waveform detail as
 * you expand a track.
 *
 * Props:
 *   url        — audio source URL to decode
 *   width      — canvas width in px
 *   height     — canvas height in px (drives both draw scale AND how many
 *                peak buckets are requested — see bucketsForCard in
 *                utils/waveformResolution.js, shared with the canvas timeline
 *                so both renderers share one envelope per clip)
 *   color      — envelope fill color (default: currentColor)
 *   rmsColor   — inner RMS fill color; defaults to a brighter version of `color`
 *   mirror     — if true, renders mirrored (top + bottom) like most DAWs
 *   startSec   — start of the window into the source file to draw (default 0)
 *   endSec     — end of the window into the source file to draw (default: end of file)
 */
 
// Trimming/zooming changes startSec/endSec/numPeaks on every pointer tick.
// Peaks-backed clips re-slice cheaply, but anything still on the in-memory
// decode path would re-run extractEnvelope on every tick — so these inputs
// are debounced while the last-known envelope keeps being drawn.
const WAVEFORM_DEBOUNCE_MS = 120;
 
export const WaveformCanvas = memo(function WaveformCanvas({
  url,
  width = 200,
  height = 40,
  color = 'rgba(56, 189, 248, 0.7)',
  rmsColor,
  mirror = true,
  startSec = 0,
  endSec = null,
}) {
  const canvasRef = useRef(null);
  const [envelope, setEnvelope] = useState(null);
  // True while this clip's peaks are still being generated in the background
  // — drawn as a placeholder stripe instead of an empty canvas.
  const [placeholder, setPlaceholder] = useState(false);
  // Bumped whenever ANY asset's peaks become ready, so an already-mounted
  // canvas re-fetches and swaps its placeholder for the real waveform.
  const [peaksVersion, setPeaksVersion] = useState(0);

  useEffect(() => subscribePeaksUpdated(() => setPeaksVersion((v) => v + 1)), []);
 
  // Buckets requested scales with width AND the height-derived detail
  // multiplier, snapped onto the shared power-of-two ladder with a ceiling
  // (see bucketsForCard). The ladder is what keeps a zoom step from asking for
  // a new envelope for every clip on screen, and the ceiling is what keeps a
  // long clip's envelope from growing with its on-screen width.
  const numPeaks = bucketsForCard(width, height);

  // Debounced fetch inputs. `url` and `peaksVersion` are deliberately NOT
  // debounced: a URL change or a "peaks became ready" event must refetch
  // immediately. The last-known envelope is kept drawn while this settles,
  // so a trim/zoom drag never flashes an empty canvas.
  const [debouncedWindow, setDebouncedWindow] = useState({ numPeaks, startSec, endSec });
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedWindow((prev) => (
        prev.numPeaks === numPeaks && prev.startSec === startSec && prev.endSec === endSec
          ? prev
          : { numPeaks, startSec, endSec }
      ));
    }, WAVEFORM_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [numPeaks, startSec, endSec]);

  const windowNumPeaks = debouncedWindow.numPeaks;
  const windowStartSec = debouncedWindow.startSec;
  const windowEndSec = debouncedWindow.endSec;
 
  // Decode audio and get the min/max/rms envelope at this resolution.
  // startSec/endSec window the envelope into the clip's actual trimmed
  // in/out points (see ClipItem.jsx, which passes mediaOffset and
  // mediaOffset+duration) — without this, a trimmed or silence-cut clip
  // always showed the full original file's waveform stretched across the
  // clip's current width, regardless of what part of the file the clip
  // was actually now pointing at.
  useEffect(() => {
    if (!url) {
      setEnvelope(null);
      setPlaceholder(false);
      return;
    }
    let cancelled = false;
    const asset = getAssetByUrl(url);
    getWaveformPeaks(url, windowNumPeaks, windowStartSec, windowEndSec).then((env) => {
      if (cancelled) return;
      setEnvelope(env);
      const isEmpty = !env || env.mins.length === 0;
      const status = asset ? getPeakStatus(asset.id) : 'none';
      setPlaceholder(isEmpty && (status === 'pending' || status === 'generating'));
    });
    return () => { cancelled = true; };
  }, [url, windowNumPeaks, windowStartSec, windowEndSec, peaksVersion]);
 
  // Draw the filled envelope on canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, width * dpr);
    canvas.height = Math.max(1, height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Peaks are still generating for a long clip: show a neutral stripe so
    // the user can tell the difference between "no audio here" and "still
    // working on it". Redrawn for real when peaksVersion bumps.
    if (placeholder) {
      drawPlaceholder(ctx, width, height, mirror);
      return;
    }
 
    const { mins, maxs, rms } = envelope || {};
    if (!mins || mins.length === 0) return;
 
    const n = mins.length;
    const midY = mirror ? height / 2 : height;
    const maxAmpH = mirror ? height / 2 - 1 : height - 2;
    const stepX = width / n;
 
    // Outer envelope: true min/max shape, filled as one closed path (top
    // edge = max samples left→right, bottom edge = min samples right→left)
    // rather than per-bucket bars — this is what gives the smooth
    // continuous "wave" look instead of a strip of ticks.
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * stepX;
      const y = mirror ? midY - maxs[i] * maxAmpH : height - 1 - maxs[i] * maxAmpH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = n - 1; i >= 0; i--) {
      const x = i * stepX;
      const y = mirror ? midY - mins[i] * maxAmpH : height - 1;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
 
    // Inner RMS fill: a slimmer, brighter shape tracking perceived
    // loudness rather than raw peak, layered on top of the outer envelope.
    // This is the "detail" DaVinci-style waveforms add at larger sizes —
    // busy/loud sections read as visually denser than quiet passages even
    // when their outer peaks are similar. Only draw it once there's enough
    // vertical room for it to read as a distinct layer.
    if (rms && rms.length === n && maxAmpH > 6) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = i * stepX;
        const y = mirror ? midY - rms[i] * maxAmpH : height - 1 - rms[i] * maxAmpH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = n - 1; i >= 0; i--) {
        const x = i * stepX;
        const y = mirror ? midY + rms[i] * maxAmpH : height - 1;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = rmsColor || brighten(color);
      ctx.fill();
    }
 
    // Center line — standard DAW convention, only worth drawing once the
    // track is tall enough that a 1px line in the middle actually reads as
    // a reference line instead of just noise through the waveform.
    if (mirror && maxAmpH > 10) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(0, midY - 0.5, width, 1);
    }
  }, [envelope, placeholder, width, height, color, rmsColor, mirror]);
 
  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block', pointerEvents: 'none' }}
    />
  );
});
 
/**
 * Neutral "peaks are still generating" fill: a faint flat bar on the centre
 * line with diagonal hatch stripes, distinct from a real (jagged) envelope.
 */
function drawPlaceholder(ctx, width, height, mirror) {
  const midY = mirror ? height / 2 : height;
  ctx.save();
  ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.fillRect(0, midY - 1, width, 2);

  ctx.beginPath();
  const stripeGap = 9;
  const stripeWidth = 2;
  for (let x = -height; x < width; x += stripeGap) {
    ctx.moveTo(x, height);
    ctx.lineTo(x + height, 0);
  }
  ctx.lineWidth = stripeWidth;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.stroke();
  ctx.restore();
}

/** Brightens an rgba(...)/rgb(...) color string for the inner RMS fill; falls back to the input unchanged for other formats (hex, named colors, currentColor). */
function brighten(colorStr) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/.exec(colorStr);
  if (!m) return colorStr;
  const [, r, g, b, a] = m;
  const boost = (v) => Math.min(255, Math.round(Number(v) * 1.0 + (255 - Number(v)) * 0.35));
  const alpha = a !== undefined ? Math.min(1, Number(a) + 0.25) : 0.9;
  return `rgba(${boost(r)}, ${boost(g)}, ${boost(b)}, ${alpha})`;
}
 