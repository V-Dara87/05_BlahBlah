import { useRef, useEffect, useCallback, useState, memo } from 'react';
import { RotateCcw, MousePointer2, Maximize2, Copy, ClipboardPaste, ArrowLeftRight, Check } from 'lucide-react';
import { CURVE_PRESETS, QUICK_CURVE_PRESETS } from '../../engine/keyframes';
import { readCssValue, subscribeThemeChanges } from '../../services/themeSettings';
import { CurvePickerModal } from '../modals/CurvePickerModal';
import './curve-editor.css';
 
const PADDING = 24;
const HANDLE_HIT_RADIUS = 14;
const HANDLE_RADIUS = 5;
const POINT_RADIUS = 4;
// The plottable y-range is wider than [0,1] so overshoot/anticipation
// handles (y < 0 or y > 1) still land inside the canvas with room to
// grab and drag, instead of being squeezed against the very top/bottom
// edge — visually this "shrinks" the 0..1 curve toward the middle of
// the canvas, leaving headroom above and below it.
const Y_RANGE_MIN = -0.5;
const Y_RANGE_MAX = 1.5;
const Y_RANGE = Y_RANGE_MAX - Y_RANGE_MIN;
 
/**
 * Evaluate cubic bezier at parameter t, given two control points.
 * Uses Newton-Raphson to solve for the curve parameter.
 */
function evalCubicBezier(t, p1, p2) {
  const cx = 3 * p1.x;
  const bx = 3 * (p2.x - p1.x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1.y;
  const by = 3 * (p2.y - p1.y) - cy;
  const ay = 1 - cy - by;
 
  let ct = t;
  for (let i = 0; i < 12; i++) {
    const curX = ((ax * ct + bx) * ct + cx) * ct;
    const delta = curX - t;
    if (Math.abs(delta) < 1e-7) break;
    const deriv = (3 * ax * ct + 2 * bx) * ct + cx;
    if (Math.abs(deriv) < 1e-7) break;
    ct -= delta / deriv;
  }
  ct = Math.max(0, Math.min(1, ct));
  return ((ay * ct + by) * ct + cy) * ct;
}
 
/**
 * CurveEditor — canvas-based bezier curve editor. Hand-drag only; preset
 * selection lives one level up in CurveEditorTab (inline dropdown) and
 * CurvePickerModal (gallery) — both just call this component's onChange
 * with a preset's cp1/cp2, same as a manual drag would.
 *
 * Props: cp1, cp2, onChange(cp1, cp2), width, height
 *
 * Implementation notes (this rewrite fixes a prior version where drag
 * silently did nothing):
 *  - The canvas element's CSS size is set explicitly via width/height
 *    *props* used consistently for both drawing math (toCanvas/fromCanvas)
 *    and hit-testing (hitTest), so there is exactly one coordinate space
 *    for the whole component — no implicit devicePixelRatio creeping into
 *    the pointer math (dpr is only ever applied inside the 2D context via
 *    ctx.scale, never touching clientX/clientY math).
 *  - cp1/cp2 are tracked in a single `points` state object (not two refs
 *    synced ad-hoc with a manual forceRender counter) so React's own
 *    render cycle drives the canvas redraw — one source of truth.
 */
const MONO_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SNAP_STEP = 0.05;

const roundTo3 = (n) => Math.round(n * 1000) / 1000;
const fmt2 = (n) => (Number.isFinite(n) ? (Math.round(n * 100) / 100).toFixed(2) : '0.00');

/**
 * Every colour the canvas paints with, read from the live theme tokens.
 * A canvas strokeStyle cannot use var(), so the values are resolved here and
 * the editor repaints whenever the theme changes (see useThemeRevision).
 */
function readCurvePalette() {
  return {
    bg: readCssValue('--unity-darkest', '#191919'),
    box: readCssValue('--unity-dark', '#1f1f1f'),
    border: readCssValue('--unity-border-light', '#3e3e3e'),
    text: readCssValue('--unity-text-muted', '#999999'),
    dim: readCssValue('--unity-text-dim', '#6e6e6e'),
    accent: readCssValue('--unity-accent-blue', '#38bdf8'),
    accentSoft: readCssValue('--unity-accent-soft', '#75d2fa'),
    accentRgb: readCssValue('--unity-accent-rgb', '56, 189, 248'),
    handle: readCssValue('--unity-accent-amber', '#f59e0b'),
    mono: readCssValue('--font-mono', MONO_FALLBACK),
  };
}

/** Bumps whenever the theme changes, so canvas painters know to redraw. */
function useThemeRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      subscribeThemeChanges(() => {
        // Let the new CSS custom properties land before they are read back.
        requestAnimationFrame(() => setRevision((n) => n + 1));
      }),
    []
  );
  return revision;
}

export const CurveEditor = memo(function CurveEditor({
  cp1 = { x: 0.33, y: 0 },
  cp2 = { x: 0.67, y: 1 },
  onChange,
  width = 260,
  height = 180,
}) {
  const canvasRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'cp1' | 'cp2' | null
  const [hover, setHover] = useState(null); // 'cp1' | 'cp2' | null
  const pointsRef = useRef({ cp1, cp2 });
  const themeRevision = useThemeRevision();

  // Keep the ref in sync every render so drag math always reads the
  // latest points without needing draw()/hitTest() in its dep array.
  pointsRef.current = { cp1, cp2 };

  const toCanvas = useCallback((nx, ny) => ({
    x: PADDING + nx * (width - PADDING * 2),
    y: PADDING + (1 - (ny - Y_RANGE_MIN) / Y_RANGE) * (height - PADDING * 2),
  }), [width, height]);

  const fromCanvas = useCallback((px, py) => ({
    x: Math.max(0, Math.min(1, (px - PADDING) / (width - PADDING * 2))),
    y: Y_RANGE_MIN + Math.max(0, Math.min(1, 1 - (py - PADDING) / (height - PADDING * 2))) * Y_RANGE,
  }), [width, height]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pal = readCurvePalette();
    const accentA = (a) => `rgba(${pal.accentRgb}, ${a})`;
    const { cp1: c1, cp2: c2 } = pointsRef.current;

    const plotW = width - PADDING * 2;
    const plotH = height - PADDING * 2;

    // The visible "0..1" curve box, inset from the full canvas — 0..1 only
    // fills the middle band, leaving headroom above/below so overshoot
    // handles stay grabbable.
    const box0 = toCanvas(0, 0);
    const box1 = toCanvas(1, 1);
    const boxTop = Math.min(box0.y, box1.y);
    const boxBottom = Math.max(box0.y, box1.y);

    // Outer background (the overshoot headroom)
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, width, height);

    // Inner 0..1 box — lighter so it reads as "the curve area"
    ctx.fillStyle = pal.box;
    ctx.fillRect(PADDING, boxTop, plotW, boxBottom - boxTop);
    ctx.strokeStyle = pal.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(PADDING + 0.5, boxTop + 0.5, plotW - 1, boxBottom - boxTop - 1);

    // Grid — 4 columns across the full plot height, 4 rows inside the box
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = pal.border;
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      const x = PADDING + (i / 4) * plotW;
      ctx.beginPath(); ctx.moveTo(x, PADDING); ctx.lineTo(x, PADDING + plotH); ctx.stroke();
      const y = boxTop + (i / 4) * (boxBottom - boxTop);
      ctx.beginPath(); ctx.moveTo(PADDING, y); ctx.lineTo(PADDING + plotW, y); ctx.stroke();
    }
    ctx.restore();

    // Axis + overshoot labels
    ctx.font = `9px ${pal.mono}`;
    ctx.fillStyle = pal.dim;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText('1', PADDING - 6, boxTop);
    ctx.fillText('0', PADDING - 6, boxBottom);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText('0', PADDING, height - 7);
    ctx.textAlign = 'right';
    ctx.fillText('1', PADDING + plotW, height - 7);
    ctx.textAlign = 'center';
    ctx.fillText('time', PADDING + plotW / 2, height - 7);
    if (boxTop - PADDING > 14) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.textAlign = 'right';
      ctx.fillText('overshoot', PADDING + plotW - 4, PADDING + 10);
      ctx.restore();
    }
    if (PADDING + plotH - boxBottom > 14) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.textAlign = 'right';
      ctx.fillText('anticipation', PADDING + plotW - 4, PADDING + plotH - 5);
      ctx.restore();
    }

    // Diagonal reference (linear)
    ctx.strokeStyle = pal.border;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(box0.x, box0.y);
    ctx.lineTo(box1.x, box1.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Control point lines
    const h1 = toCanvas(c1.x, c1.y);
    const h2 = toCanvas(c2.x, c2.y);
    ctx.strokeStyle = accentA(0.45);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(box0.x, box0.y); ctx.lineTo(h1.x, h1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(box1.x, box1.y); ctx.lineTo(h2.x, h2.y); ctx.stroke();

    // The bezier curve, with a soft glow in the accent colour
    ctx.save();
    ctx.strokeStyle = pal.accent;
    ctx.shadowColor = accentA(0.55);
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const pt = toCanvas(t, evalCubicBezier(t, c1, c2));
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.restore();

    // Anchor points
    ctx.fillStyle = pal.accentSoft;
    ctx.strokeStyle = pal.bg;
    ctx.lineWidth = 1.5;
    for (const a of [box0, box1]) {
      ctx.beginPath(); ctx.arc(a.x, a.y, POINT_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // Control point handles: hover grows, drag switches to the soft accent
    const drawHandle = (pt, key) => {
      const active = dragging === key;
      const hot = active || hover === key;
      const r = hot ? HANDLE_RADIUS + 1.5 : HANDLE_RADIUS;
      if (hot) {
        ctx.fillStyle = accentA(0.22);
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r + 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = active ? pal.accentSoft : pal.handle;
      ctx.strokeStyle = pal.bg;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    };
    drawHandle(h1, 'cp1');
    drawHandle(h2, 'cp2');

    // Value tag next to the handle being hovered / dragged
    const tagKey = dragging || hover;
    if (tagKey) {
      const pt = tagKey === 'cp1' ? h1 : h2;
      const cp = tagKey === 'cp1' ? c1 : c2;
      const text = `${fmt2(cp.x)}, ${fmt2(cp.y)}`;
      ctx.font = `600 10px ${pal.mono}`;
      const w = ctx.measureText(text).width + 12;
      const h = 17;
      let tx = pt.x + 12;
      if (tx + w > width - 2) tx = pt.x - 12 - w;
      let ty = pt.y - h - 8;
      if (ty < 2) ty = pt.y + 10;
      ctx.save();
      ctx.globalAlpha = 0.94;
      ctx.fillStyle = pal.bg;
      ctx.strokeStyle = pal.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tx, ty, w, h, 4);
      else ctx.rect(tx, ty, w, h);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = pal.accentSoft;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, tx + 6, ty + h / 2 + 0.5);
      ctx.textBaseline = 'alphabetic';
    }
  }, [width, height, toCanvas, dragging, hover, themeRevision]);

  useEffect(() => { draw(); }, [draw, cp1, cp2]);

  const hitTest = useCallback((offsetX, offsetY) => {
    const { cp1: c1, cp2: c2 } = pointsRef.current;
    const h1 = toCanvas(c1.x, c1.y);
    const h2 = toCanvas(c2.x, c2.y);
    const d1 = Math.hypot(offsetX - h1.x, offsetY - h1.y);
    const d2 = Math.hypot(offsetX - h2.x, offsetY - h2.y);
    // When both handles overlap, grab the nearer one.
    if (d1 < HANDLE_HIT_RADIUS && (d2 >= HANDLE_HIT_RADIUS || d1 <= d2)) return 'cp1';
    if (d2 < HANDLE_HIT_RADIUS) return 'cp2';
    return null;
  }, [toCanvas]);

  // Use the native pointer event's offsetX/offsetY — these are already
  // relative to the target element's padding box in CSS pixels, so they
  // match toCanvas/fromCanvas's coordinate space directly.
  const handlePointerDown = useCallback((e) => {
    const hit = hitTest(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    if (hit) {
      setDragging(hit);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }, [hitTest]);

  const handlePointerMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ox = e.nativeEvent.offsetX;
    const oy = e.nativeEvent.offsetY;

    if (!dragging) {
      const hit = hitTest(ox, oy);
      canvas.style.cursor = hit ? 'grab' : 'default';
      setHover((prev) => (prev === hit ? prev : hit));
      return;
    }

    canvas.style.cursor = 'grabbing';
    let norm = fromCanvas(ox, oy);
    if (e.shiftKey) {
      // Shift = snap to a 0.05 grid for clean, repeatable values.
      norm = {
        x: Math.max(0, Math.min(1, Math.round(norm.x / SNAP_STEP) * SNAP_STEP)),
        y: Math.max(Y_RANGE_MIN, Math.min(Y_RANGE_MAX, Math.round(norm.y / SNAP_STEP) * SNAP_STEP)),
      };
    }
    norm = { x: roundTo3(norm.x), y: roundTo3(norm.y) };
    const { cp1: c1, cp2: c2 } = pointsRef.current;

    if (dragging === 'cp1') {
      onChange?.(norm, c2);
    } else {
      onChange?.(c1, norm);
    }
  }, [dragging, fromCanvas, hitTest, onChange]);

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  const handlePointerLeave = useCallback(() => {
    setHover(null);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block', cursor: 'default', borderRadius: 6, touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    />
  );
});

/**
 * EasePreview — a dot that slides along a track using the CURRENT curve, so
 * you can see the easing's feel without scrubbing the timeline. Overshoot and
 * anticipation show as the dot leaving the track ends. The dot is moved by a
 * ref (no React re-render per frame) and pauses while the panel is hidden.
 */
const PREVIEW_MOVE_S = 1.2;
const PREVIEW_HOLD_S = 0.7;

const EasePreview = memo(function EasePreview({ cp1, cp2 }) {
  const rootRef = useRef(null);
  const dotRef = useRef(null);
  const pointsRef = useRef({ cp1, cp2 });
  pointsRef.current = { cp1, cp2 };

  useEffect(() => {
    const dot = dotRef.current;
    const root = rootRef.current;
    if (!dot || !root) return undefined;

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      dot.style.left = '100%';
      return undefined;
    }

    let visible = true;
    let observer = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
      });
      observer.observe(root);
    }

    let raf = 0;
    const start = performance.now();
    const cycle = PREVIEW_MOVE_S + PREVIEW_HOLD_S;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      const local = ((now - start) / 1000) % cycle;
      const t = Math.min(1, local / PREVIEW_MOVE_S);
      const { cp1: c1, cp2: c2 } = pointsRef.current;
      dot.style.left = `${evalCubicBezier(t, c1, c2) * 100}%`;
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      if (observer) observer.disconnect();
    };
  }, []);

  return (
    <div className="curve-preview" ref={rootRef} aria-hidden="true">
      <div className="curve-preview-head">
        <span>Preview</span>
        <span>{PREVIEW_MOVE_S.toFixed(1)}s</span>
      </div>
      <div className="curve-preview-track">
        <div className="curve-preview-dot" ref={dotRef} />
      </div>
    </div>
  );
});

/**
 * CurveValueFields — the four bezier numbers as editable inputs plus a
 * copyable cubic-bezier(...) string. Typing keeps a local draft so "0." and
 * "-" can be entered; the value is committed on every valid keystroke and the
 * draft is dropped on blur.
 */
const VALUE_FIELDS = [
  { key: 'x1', label: 'X1', point: 'cp1', axis: 'x' },
  { key: 'y1', label: 'Y1', point: 'cp1', axis: 'y' },
  { key: 'x2', label: 'X2', point: 'cp2', axis: 'x' },
  { key: 'y2', label: 'Y2', point: 'cp2', axis: 'y' },
];

const CurveValueFields = memo(function CurveValueFields({ cp1, cp2, onChange }) {
  const [drafts, setDrafts] = useState({});
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);
  const points = { cp1, cp2 };

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const commit = (field, raw) => {
    const parsed = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(parsed)) return;
    const next = { cp1: { ...cp1 }, cp2: { ...cp2 } };
    const min = field.axis === 'x' ? 0 : Y_RANGE_MIN;
    const max = field.axis === 'x' ? 1 : Y_RANGE_MAX;
    next[field.point][field.axis] = roundTo3(Math.max(min, Math.min(max, parsed)));
    onChange?.(next.cp1, next.cp2);
  };

  const cssText = `cubic-bezier(${fmt2(cp1.x)}, ${fmt2(cp1.y)}, ${fmt2(cp2.x)}, ${fmt2(cp2.y)})`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(cssText);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can be denied; the text is also selectable in place.
    }
  };

  return (
    <>
      <div className="curve-values" role="group" aria-label="Bezier control points">
        {VALUE_FIELDS.map((field) => {
          const current = points[field.point][field.axis];
          const isX = field.axis === 'x';
          return (
            <label key={field.key} className="curve-value-field">
              <span className="curve-value-label">{field.label}</span>
              <input
                className="curve-value-input"
                type="number"
                step="0.01"
                min={isX ? 0 : Y_RANGE_MIN}
                max={isX ? 1 : Y_RANGE_MAX}
                value={drafts[field.key] ?? fmt2(current)}
                onChange={(e) => {
                  const raw = e.target.value;
                  setDrafts((prev) => ({ ...prev, [field.key]: raw }));
                  commit(field, raw);
                }}
                onBlur={() =>
                  setDrafts((prev) => {
                    if (!(field.key in prev)) return prev;
                    const { [field.key]: _dropped, ...rest } = prev;
                    return rest;
                  })
                }
              />
            </label>
          );
        })}
      </div>
      <div className="curve-css-row">
        <code className="curve-css-text" title={cssText}>{cssText}</code>
        <button
          type="button"
          className={`curve-css-copy ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          title="Copy as a CSS cubic-bezier() value"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </>
  );
});

/**
 * CurveEditorTab — the dockable Curves tab.
 *
 * Shows a header (with selected-keyframe info + reset button), an inline
 * preset dropdown + "browse gallery" button (opens CurvePickerModal), and
 * the bezier canvas editor.
 *
 * Props:
 *   cp1, cp2           — current bezier control points (from selected keyframe)
 *   onChange(cp1, cp2)  — called when user drags a handle or picks a preset
 *   onReset()           — called when user clicks reset
 *   selectedKeyId       — currently selected keyframe id (null = none)
 *   keyframeInfo        — { trackKey, fieldName, time } or null
 */
export const CurveEditorTab = memo(function CurveEditorTab({
  cp1 = { x: 0.33, y: 0 },
  cp2 = { x: 0.67, y: 1 },
  onChange,
  onReset,
  selectedKeyId,
  keyframeInfo,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copiedCurve, setCopiedCurve] = useState(null);
  const canvasWrapRef = useRef(null);
  // Canvas grows to fill the tab's available width (and a proportional
  // height, capped so a very wide/tall dock panel doesn't produce a
  // huge, empty-feeling canvas) instead of staying a fixed 280×200 —
  // resizing the Curves tab (wider dock pane, different screen) now
  // resizes the curve editor with it.
  const [canvasSize, setCanvasSize] = useState({ width: 280, height: 200 });

  const handleInvertCurve = useCallback(() => {
    // Invert bezier: (1 - cp2.x, 1 - cp2.y) and (1 - cp1.x, 1 - cp1.y)
    const nextCp1 = {
      x: Math.max(0, Math.min(1, Number((1 - cp2.x).toFixed(3)))),
      y: Number((1 - cp2.y).toFixed(3)),
    };
    const nextCp2 = {
      x: Math.max(0, Math.min(1, Number((1 - cp1.x).toFixed(3)))),
      y: Number((1 - cp1.y).toFixed(3)),
    };
    onChange?.(nextCp1, nextCp2);
  }, [cp1, cp2, onChange]);

  const handleCopyCurve = useCallback(() => {
    setCopiedCurve({ cp1: { ...cp1 }, cp2: { ...cp2 } });
  }, [cp1, cp2]);

  const handlePasteCurve = useCallback(() => {
    if (copiedCurve) {
      onChange?.({ ...copiedCurve.cp1 }, { ...copiedCurve.cp2 });
    }
  }, [copiedCurve, onChange]);
 
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // contentRect already excludes the wrap's own padding (10px each
      // side), so this is the actual space available for the canvas.
      const availableWidth = entry.contentRect.width;
      if (availableWidth <= 0) return;
      const nextWidth = Math.max(200, Math.floor(availableWidth));
      const nextHeight = Math.max(140, Math.min(420, Math.round(nextWidth * 0.62)));
      setCanvasSize((prev) =>
        prev.width === nextWidth && prev.height === nextHeight ? prev : { width: nextWidth, height: nextHeight }
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Highlight the dropdown/list item matching the current curve, if any
  // (within a small tolerance since dragging can land just off-preset).
  const matchedPresetName = CURVE_PRESETS.find(
    (p) =>
      Math.abs(p.cp1.x - cp1.x) < 0.005 &&
      Math.abs(p.cp1.y - cp1.y) < 0.005 &&
      Math.abs(p.cp2.x - cp2.x) < 0.005 &&
      Math.abs(p.cp2.y - cp2.y) < 0.005
  )?.name || '';

  const handleSelectPreset = (e) => {
    const preset = CURVE_PRESETS.find((p) => p.name === e.target.value);
    if (preset) onChange?.({ ...preset.cp1 }, { ...preset.cp2 });
  };

  return (
    <div className="curve-tab-root">
      {/* Header */}
      <div className="curve-tab-header">
        <MousePointer2 size={14} />
        {selectedKeyId && keyframeInfo ? (
          <span className="curve-tab-title">
            {keyframeInfo.fieldName} @ {keyframeInfo.time?.toFixed(2)}s
          </span>
        ) : (
          <span className="curve-tab-title curve-tab-empty-text">
            Select a keyframe to edit its curve
          </span>
        )}
        {selectedKeyId && (
          <div className="curve-tab-actions">
            <button
              className="curve-tab-reset-btn"
              onClick={handleCopyCurve}
              title="Copy curve (cp1 / cp2)"
            >
              <Copy size={11} />
            </button>
            <button
              className="curve-tab-reset-btn"
              onClick={handlePasteCurve}
              disabled={!copiedCurve}
              title="Paste copied curve"
            >
              <ClipboardPaste size={11} />
            </button>
            <button
              className="curve-tab-reset-btn"
              onClick={handleInvertCurve}
              title="Invert / Flip curve direction"
            >
              <ArrowLeftRight size={11} />
            </button>
            <button
              className="curve-tab-reset-btn"
              onClick={onReset}
              title="Reset to default (linear)"
            >
              <RotateCcw size={11} />
            </button>
          </div>
        )}
      </div>
 
      {selectedKeyId ? (
        <>
          <div className="curve-tab-quick-section">
            <div className="curve-tab-section-heading">
              <span>Quick easing</span>
              <span className="curve-tab-section-hint">Applies to the next keyframe</span>
            </div>
            <div className="curve-tab-quick-grid" role="group" aria-label="Quick easing presets">
              {QUICK_CURVE_PRESETS.map((preset) => {
                const isActive = preset.name === matchedPresetName;
                return (
                  <button
                    key={preset.name}
                    type="button"
                    className={`curve-tab-quick-btn ${isActive ? 'active' : ''}`}
                    onClick={() => onChange?.({ ...preset.cp1 }, { ...preset.cp2 })}
                    title={`Use ${preset.name} easing`}
                    aria-pressed={isActive}
                  >
                    {preset.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Full preset library + visual editor for precise adjustments. */}
          <div className="curve-tab-preset-row inspector-row">
            <span className="row-label">More</span>
            <div className="preset-select-group">
              <select className="inspector-select" value={matchedPresetName} onChange={handleSelectPreset}>
                <option value="" disabled>
                  {matchedPresetName ? matchedPresetName : 'Custom'}
                </option>
                {CURVE_PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="gallery-open-btn"
                title="Browse all easing presets visually"
                onClick={() => setPickerOpen(true)}
              >
                <Maximize2 size={11} />
              </button>
            </div>
          </div>
 
          <div className="curve-tab-canvas-wrap" ref={canvasWrapRef}>
            <CurveEditor
              cp1={cp1}
              cp2={cp2}
              onChange={onChange}
              width={canvasSize.width}
              height={canvasSize.height}
            />
          </div>
          <EasePreview cp1={cp1} cp2={cp2} />
          <CurveValueFields cp1={cp1} cp2={cp2} onChange={onChange} />
          <p className="curve-tab-editor-hint">
            Drag either handle to fine-tune this easing — hold <kbd>Shift</kbd> to snap. {matchedPresetName || 'Custom'} is selected.
          </p>
        </>
      ) : (
        <div className="curve-tab-empty-state">
          <MousePointer2 size={22} />
          <p>Select a keyframe in the Dopesheet to edit its curve.</p>
        </div>
      )}
 
      <CurvePickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onApplyPreset={(nextCp1, nextCp2) => onChange?.(nextCp1, nextCp2)}
        currentCp1={cp1}
        currentCp2={cp2}
      />
    </div>
  );
});