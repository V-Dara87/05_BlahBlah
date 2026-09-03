import { useRef, useEffect, useState, memo } from 'react';
import { getWaveformPeaks } from '../utils/audioWaveform';

/**
 * WaveformCanvas — renders an audio waveform from peak data on a canvas.
 *
 * Props:
 *   url        — audio source URL to decode
 *   width      — canvas width in px
 *   height     — canvas height in px
 *   color      — waveform fill color (default: currentColor)
 *   barWidth   — width of each peak bar (default: 2)
 *   barGap     — gap between bars (default: 1)
 *   mirror     — if true, renders mirrored (top + bottom) like most DAWs
 */
export const WaveformCanvas = memo(function WaveformCanvas({
  url,
  width = 200,
  height = 40,
  color = 'rgba(56, 189, 248, 0.6)',
  barWidth = 2,
  barGap = 1,
  mirror = true,
}) {
  const canvasRef = useRef(null);
  const [peaks, setPeaks] = useState(null);

  // Decode audio and get peaks
  useEffect(() => {
    if (!url) {
      setPeaks(null);
      return;
    }
    let cancelled = false;
    const numPeaks = Math.max(20, Math.floor(width / (barWidth + barGap)));
    getWaveformPeaks(url, numPeaks).then((p) => {
      if (!cancelled) setPeaks(p);
    });
    return () => { cancelled = true; };
  }, [url, width, barWidth, barGap]);

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || peaks.length === 0) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, width, height);

    const midY = mirror ? height / 2 : height;
    const maxBarH = mirror ? height / 2 - 1 : height - 2;
    const step = barWidth + barGap;

    // Find max peak for normalization
    let maxPeak = 0;
    for (let i = 0; i < peaks.length; i++) {
      if (peaks[i] > maxPeak) maxPeak = peaks[i];
    }
    if (maxPeak === 0) maxPeak = 1;

    ctx.fillStyle = color;

    for (let i = 0; i < peaks.length; i++) {
      const x = i * step;
      if (x > width) break;

      const normalized = peaks[i] / maxPeak;
      const barH = Math.max(1, normalized * maxBarH);

      if (mirror) {
        // Top half (up from center)
        ctx.fillRect(x, midY - barH, barWidth, barH);
        // Bottom half (down from center)
        ctx.fillRect(x, midY, barWidth, barH);
      } else {
        // Bottom-aligned
        ctx.fillRect(x, height - barH - 1, barWidth, barH);
      }
    }
  }, [peaks, width, height, color, barWidth, barGap, mirror]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block', pointerEvents: 'none' }}
    />
  );
});
