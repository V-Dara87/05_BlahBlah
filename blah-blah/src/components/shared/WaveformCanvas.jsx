import { useRef, useEffect, useState, memo } from 'react';
import { getWaveformPeaks } from '../../utils/audioWaveform';
 
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
 *                peak buckets are requested — see `detailForHeight` below)
 *   color      — envelope fill color (default: currentColor)
 *   rmsColor   — inner RMS fill color; defaults to a brighter version of `color`
 *   mirror     — if true, renders mirrored (top + bottom) like most DAWs
 *   startSec   — start of the window into the source file to draw (default 0)
 *   endSec     — end of the window into the source file to draw (default: end of file)
 */
 
// How many envelope buckets to request per pixel of canvas width, as a
// function of the clip's rendered height. A short/collapsed track (the
// default ~48px clip height) only needs ~1 bucket/px — any finer and the
// shape looks identical but costs more CPU. A track the user has resized
// tall gets progressively more buckets/px, so expanding a track keeps
// revealing real sample-level detail instead of just scaling up the same
// coarse shape (the "make it very detailed like DaVinci Resolve" ask).
function detailForHeight(height) {
  if (height <= 56) return 1; // compact/default clip height
  if (height <= 90) return 1.5;
  if (height <= 140) return 2.5;
  if (height <= 220) return 4;
  return 6; // fully expanded track — maximum envelope resolution
}
 
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
 
  // Buckets requested scales with width AND the height-derived detail
  // multiplier, then snapped to a coarse grid so small height/width
  // jitter (e.g. a ResizeObserver firing during a drag) doesn't spam the
  // decoder with a new cache key on every pixel.
  const detail = detailForHeight(height);
  const rawBuckets = Math.max(20, Math.round(width * detail));
  const numPeaks = Math.ceil(rawBuckets / 20) * 20;
 
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
      return;
    }
    let cancelled = false;
    getWaveformPeaks(url, numPeaks, startSec, endSec).then((env) => {
      if (!cancelled) setEnvelope(env);
    });
    return () => { cancelled = true; };
  }, [url, numPeaks, startSec, endSec]);
 
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
  }, [envelope, width, height, color, rmsColor, mirror]);
 
  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block', pointerEvents: 'none' }}
    />
  );
});
 
/** Brightens an rgba(...)/rgb(...) color string for the inner RMS fill; falls back to the input unchanged for other formats (hex, named colors, currentColor). */
function brighten(colorStr) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/.exec(colorStr);
  if (!m) return colorStr;
  const [, r, g, b, a] = m;
  const boost = (v) => Math.min(255, Math.round(Number(v) * 1.0 + (255 - Number(v)) * 0.35));
  const alpha = a !== undefined ? Math.min(1, Number(a) + 0.25) : 0.9;
  return `rgba(${boost(r)}, ${boost(g)}, ${boost(b)}, ${alpha})`;
}
 