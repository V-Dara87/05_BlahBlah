import { useRef, useEffect, useCallback, useState, memo } from 'react';
import { RotateCcw, MousePointer2, Maximize2, Copy, ClipboardPaste, ArrowLeftRight } from 'lucide-react';
import { CURVE_PRESETS, QUICK_CURVE_PRESETS } from '../../engine/keyframes';
import { readThemeAccent } from '../../services/themeSettings';
import { CurvePickerModal } from '../modals/CurvePickerModal';
 
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
export const CurveEditor = memo(function CurveEditor({
  cp1 = { x: 0.33, y: 0 },
  cp2 = { x: 0.67, y: 1 },
  onChange,
  width = 260,
  height = 180,
}) {
  const canvasRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'cp1' | 'cp2' | null
  const pointsRef = useRef({ cp1, cp2 });
 
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
 
    const { cp1: c1, cp2: c2 } = pointsRef.current;
 
    const plotW = width - PADDING * 2;
    const plotH = height - PADDING * 2;
 
    // The visible "0..1" curve box, inset from the full canvas — this is
    // the shrink: 0..1 no longer fills the whole plot area, it only
    // fills the middle band, leaving headroom above/below for overshoot
    // handles to stay grabbable.
    const box0 = toCanvas(0, 0);
    const box1 = toCanvas(1, 1);
    const boxTop = Math.min(box0.y, box1.y);
    const boxBottom = Math.max(box0.y, box1.y);
 
    // Outer background
    ctx.fillStyle = '#13141a';
    ctx.fillRect(0, 0, width, height);
 
    // Inner 0..1 box — slightly lighter so it reads as "the curve area"
    // versus the overshoot headroom around it.
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(PADDING, boxTop, plotW, boxBottom - boxTop);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(PADDING, boxTop, plotW, boxBottom - boxTop);
 
    // Grid — 4 columns across full width, 4 rows across the 0..1 box only
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const x = PADDING + (i / 4) * plotW;
      ctx.beginPath(); ctx.moveTo(x, PADDING); ctx.lineTo(x, PADDING + plotH); ctx.stroke();
      const y = boxTop + (i / 4) * (boxBottom - boxTop);
      ctx.beginPath(); ctx.moveTo(PADDING, y); ctx.lineTo(PADDING + plotW, y); ctx.stroke();
    }
 
    // Diagonal reference (linear), drawn from (0,0) to (1,1) in the same
    // shrunk mapping as everything else
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(box0.x, box0.y);
    ctx.lineTo(box1.x, box1.y);
    ctx.stroke();
    ctx.setLineDash([]);
 
    // The bezier curve — the theme accent, read fresh because a canvas
    // strokeStyle cannot use var() (Settings -> Appearance).
    ctx.strokeStyle = readThemeAccent();
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const y = evalCubicBezier(t, c1, c2);
      const pt = toCanvas(t, y);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
 
    // Control point lines
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    const a0 = box0;
    const h1 = toCanvas(c1.x, c1.y);
    ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(h1.x, h1.y); ctx.stroke();
    const a1 = box1;
    const h2 = toCanvas(c2.x, c2.y);
    ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(h2.x, h2.y); ctx.stroke();
 
    // Anchor points
    ctx.fillStyle = '#8fe3e0';
    ctx.beginPath(); ctx.arc(a0.x, a0.y, POINT_RADIUS, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(a1.x, a1.y, POINT_RADIUS, 0, Math.PI * 2); ctx.fill();
 
    // Control point handles
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = dragging === 'cp1' ? '#fff' : '#f59e0b';
    ctx.beginPath(); ctx.arc(h1.x, h1.y, HANDLE_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = dragging === 'cp2' ? '#fff' : '#f59e0b';
    ctx.beginPath(); ctx.arc(h2.x, h2.y, HANDLE_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }, [width, height, toCanvas, dragging]);
 
  useEffect(() => { draw(); }, [draw, cp1, cp2]);
 
  const hitTest = useCallback((offsetX, offsetY) => {
    const { cp1: c1, cp2: c2 } = pointsRef.current;
    const h1 = toCanvas(c1.x, c1.y);
    const h2 = toCanvas(c2.x, c2.y);
    if (Math.hypot(offsetX - h1.x, offsetY - h1.y) < HANDLE_HIT_RADIUS) return 'cp1';
    if (Math.hypot(offsetX - h2.x, offsetY - h2.y) < HANDLE_HIT_RADIUS) return 'cp2';
    return null;
  }, [toCanvas]);
 
  // Use the native pointer event's offsetX/offsetY — these are already
  // relative to the target element's padding box in CSS pixels, so they
  // match toCanvas/fromCanvas's coordinate space directly without needing
  // a manual getBoundingClientRect() subtraction (which is where the
  // previous version's math could drift from the actual rendered size).
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
      return;
    }
 
    canvas.style.cursor = 'grabbing';
    const norm = fromCanvas(ox, oy);
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
 
  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block', cursor: 'default', borderRadius: 6, touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
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
              style={{ opacity: copiedCurve ? 1 : 0.4 }}
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
          <p className="curve-tab-editor-hint">Drag either handle to fine-tune this easing. {matchedPresetName || 'Custom'} is selected.</p>
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
