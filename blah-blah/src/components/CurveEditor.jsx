import { useRef, useEffect, useCallback, useState, memo, useMemo } from 'react';
import { RotateCcw, MousePointer2, Plus, Trash2, Check, X } from 'lucide-react';
import { CURVE_PRESETS } from '../engine/keyframes';
 
const PADDING = 24;
const HANDLE_RADIUS = 5;
const POINT_RADIUS = 4;
const CUSTOM_PRESETS_KEY = 'blahblah.customCurvePresets';
 
/**
 * Load user-saved custom curve presets from localStorage.
 * Same localStorage-blob pattern as keybindSettings.js / audioSettings.js.
 */
function loadCustomPresets() {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
 
function saveCustomPresets(presets) {
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // storage disabled/full — custom presets just won't persist this session
  }
}
 
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
 * Mini curve preview SVG for a single preset.
 */
function CurvePreviewIcon({ cp1, cp2, size = 32, isActive = false }) {
  const d = useMemo(() => {
    const pts = [];
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = evalCubicBezier(t, cp1, cp2);
      const x = t * size;
      const sy = size - y * size;
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${sy.toFixed(1)}`);
    }
    return pts.join(' ');
  }, [cp1, cp2, size]);
 
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <line x1={0} y1={size} x2={size} y2={size} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      <line x1={0} y1={0} x2={0} y2={size} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      <line x1={0} y1={size} x2={size} y2={0} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} strokeDasharray="2,2" />
      <path d={d} fill="none" stroke={isActive ? '#38bdf8' : '#8fe3e0'} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}
 
/**
 * CurveEditor — canvas-based bezier curve editor.
 * Props: cp1, cp2, onChange(cp1, cp2), width, height
 */
export const CurveEditor = memo(function CurveEditor({
  cp1 = { x: 0.33, y: 0 },
  cp2 = { x: 0.67, y: 1 },
  onChange,
  width = 260,
  height = 180,
}) {
  const canvasRef = useRef(null);
  const draggingRef = useRef(null); // 'cp1' | 'cp2' | null
  const cp1Ref = useRef(cp1);
  const cp2Ref = useRef(cp2);
  const [, forceRender] = useState(0);
 
  // Sync from props ONLY when not dragging
  useEffect(() => {
    if (!draggingRef.current) {
      cp1Ref.current = cp1;
      cp2Ref.current = cp2;
      forceRender((n) => n + 1);
    }
  }, [cp1.x, cp1.y, cp2.x, cp2.y]);
 
  const toCanvas = useCallback((nx, ny) => ({
    x: PADDING + nx * (width - PADDING * 2),
    y: PADDING + (1 - ny) * (height - PADDING * 2),
  }), [width, height]);
 
  const fromCanvas = useCallback((px, py) => ({
    x: Math.max(0, Math.min(1, (px - PADDING) / (width - PADDING * 2))),
    y: Math.max(-0.5, Math.min(1.5, 1 - (py - PADDING) / (height - PADDING * 2))),
  }), [width, height]);
 
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
 
    const c1 = cp1Ref.current;
    const c2 = cp2Ref.current;
 
    ctx.fillStyle = '#13141a';
    ctx.fillRect(0, 0, width, height);
 
    const plotW = width - PADDING * 2;
    const plotH = height - PADDING * 2;
 
    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const x = PADDING + (i / 4) * plotW;
      const y = PADDING + (i / 4) * plotH;
      ctx.beginPath(); ctx.moveTo(x, PADDING); ctx.lineTo(x, PADDING + plotH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PADDING, y); ctx.lineTo(PADDING + plotW, y); ctx.stroke();
    }
 
    // Diagonal reference (linear)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(PADDING, PADDING + plotH);
    ctx.lineTo(PADDING + plotW, PADDING);
    ctx.stroke();
    ctx.setLineDash([]);
 
    // The bezier curve
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const y = evalCubicBezier(t, c1, c2);
      const px = PADDING + t * plotW;
      const py = PADDING + (1 - y) * plotH;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
 
    // Control point lines
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    const a0 = toCanvas(0, 0);
    const h1 = toCanvas(c1.x, c1.y);
    ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(h1.x, h1.y); ctx.stroke();
    const a1 = toCanvas(1, 1);
    const h2 = toCanvas(c2.x, c2.y);
    ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(h2.x, h2.y); ctx.stroke();
 
    // Anchor points
    ctx.fillStyle = '#8fe3e0';
    ctx.beginPath(); ctx.arc(a0.x, a0.y, POINT_RADIUS, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(a1.x, a1.y, POINT_RADIUS, 0, Math.PI * 2); ctx.fill();
 
    // Control point handles
    const active = draggingRef.current;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = active === 'cp1' ? '#fff' : '#f59e0b';
    ctx.beginPath(); ctx.arc(h1.x, h1.y, HANDLE_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = active === 'cp2' ? '#fff' : '#f59e0b';
    ctx.beginPath(); ctx.arc(h2.x, h2.y, HANDLE_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }, [width, height, toCanvas]);
 
  useEffect(() => { draw(); }, [draw]);
 
  const hitTest = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const h1 = toCanvas(cp1Ref.current.x, cp1Ref.current.y);
    const h2 = toCanvas(cp2Ref.current.x, cp2Ref.current.y);
    if (Math.hypot(px - h1.x, py - h1.y) < 14) return 'cp1';
    if (Math.hypot(px - h2.x, py - h2.y) < 14) return 'cp2';
    return null;
  }, [toCanvas]);
 
  const handlePointerDown = useCallback((e) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (hit) {
      draggingRef.current = hit;
      forceRender((n) => n + 1);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }, [hitTest]);
 
  const handlePointerMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
 
    if (!draggingRef.current) {
      const hit = hitTest(e.clientX, e.clientY);
      canvas.style.cursor = hit ? 'grab' : 'default';
      return;
    }
 
    canvas.style.cursor = 'grabbing';
    const norm = fromCanvas(px, py);
 
    if (draggingRef.current === 'cp1') {
      cp1Ref.current = norm;
      onChange?.(norm, cp2Ref.current);
    } else {
      cp2Ref.current = norm;
      onChange?.(cp1Ref.current, norm);
    }
    forceRender((n) => n + 1);
  }, [fromCanvas, hitTest, onChange]);
 
  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
    forceRender((n) => n + 1);
  }, []);
 
  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block', cursor: 'default', borderRadius: 6 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
});
 
/**
 * CurveEditorTab — the full dockable Curves tab.
 *
 * Shows:
 *   - A header bar with info about the selected keyframe (or empty state)
 *   - The bezier canvas editor (drag the orange handles by hand)
 *   - A grid of built-in preset curve buttons
 *   - A "Custom" section: save the current hand-tweaked curve as a named
 *     preset (persisted in localStorage), reapply it later, or delete it
 *
 * Props:
 *   cp1, cp2           — current bezier control points (from selected keyframe)
 *   onChange(cp1, cp2)  — called when user drags a handle or edits a number
 *   onPresetApply(cp1, cp2) — called when user clicks a preset (built-in or custom)
 *   onReset()           — called when user clicks reset
 *   selectedKeyId       — currently selected keyframe id (null = none)
 *   keyframeInfo        — { trackKey, fieldName, time, easing } or null
 */
export const CurveEditorTab = memo(function CurveEditorTab({
  cp1 = { x: 0.33, y: 0 },
  cp2 = { x: 0.67, y: 1 },
  onChange,
  onPresetApply,
  onReset,
  selectedKeyId,
  keyframeInfo,
}) {
  const [activePreset, setActivePreset] = useState(null);
  const [customPresets, setCustomPresets] = useState(loadCustomPresets);
  const [isSaving, setIsSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const saveInputRef = useRef(null);
 
  useEffect(() => {
    if (isSaving) saveInputRef.current?.focus();
  }, [isSaving]);
 
  const handlePresetClick = (preset) => {
    setActivePreset(preset.name);
    onPresetApply?.(preset.cp1, preset.cp2);
  };
 
  const handleReset = () => {
    setActivePreset(null);
    onReset?.();
  };
 
  const handleChange = (nextCp1, nextCp2) => {
    setActivePreset(null);
    onChange?.(nextCp1, nextCp2);
  };
 
  const startSaving = () => {
    setSaveName('');
    setIsSaving(true);
  };
 
  const cancelSaving = () => {
    setIsSaving(false);
    setSaveName('');
  };
 
  const confirmSaving = () => {
    const name = saveName.trim();
    if (!name) return;
    const withoutDup = customPresets.filter((p) => p.name !== name);
    const next = [...withoutDup, { name, cp1: { ...cp1 }, cp2: { ...cp2 } }];
    setCustomPresets(next);
    saveCustomPresets(next);
    setActivePreset(name);
    setIsSaving(false);
    setSaveName('');
  };
 
  const deleteCustomPreset = (name, e) => {
    e.stopPropagation();
    const next = customPresets.filter((p) => p.name !== name);
    setCustomPresets(next);
    saveCustomPresets(next);
    if (activePreset === name) setActivePreset(null);
  };
 
  // Check if current cp1/cp2 match any built-in or custom preset
  const matchedPreset = useMemo(() => {
    if (!cp1 || !cp2) return null;
    const all = [...CURVE_PRESETS, ...customPresets];
    return all.find(
      (p) =>
        Math.abs(p.cp1.x - cp1.x) < 0.01 &&
        Math.abs(p.cp1.y - cp1.y) < 0.01 &&
        Math.abs(p.cp2.x - cp2.x) < 0.01 &&
        Math.abs(p.cp2.y - cp2.y) < 0.01
    )?.name || null;
  }, [cp1, cp2, customPresets]);
 
  const effectiveActive = activePreset || matchedPreset;
 
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
          <button className="curve-tab-reset-btn" onClick={handleReset} title="Reset to default (linear)">
            <RotateCcw size={11} />
          </button>
        )}
      </div>
 
      {/* Canvas */}
      <div className="curve-tab-canvas-wrap">
        <CurveEditor
          cp1={cp1}
          cp2={cp2}
          onChange={handleChange}
          width={280}
          height={200}
        />
      </div>
 
      {/* Presets */}
      <div className="curve-tab-presets">
        <div className="curve-tab-presets-label">Presets</div>
        <div className="curve-tab-preset-grid">
          {CURVE_PRESETS.map((preset) => (
            <button
              key={preset.name}
              className={`curve-tab-preset-btn${effectiveActive === preset.name ? ' active' : ''}`}
              onClick={() => handlePresetClick(preset)}
              title={preset.name}
            >
              <CurvePreviewIcon cp1={preset.cp1} cp2={preset.cp2} size={28} isActive={effectiveActive === preset.name} />
              <span className="curve-tab-preset-name">{preset.name}</span>
            </button>
          ))}
        </div>
 
        {/* Custom presets — user-saved hand-tweaked curves */}
        <div className="curve-tab-custom-header">
          <span className="curve-tab-presets-label">Custom</span>
          {!isSaving && selectedKeyId && (
            <button className="curve-tab-save-btn" onClick={startSaving} title="Save current curve as a custom preset">
              <Plus size={11} />
              <span>Save Curve</span>
            </button>
          )}
        </div>
 
        {isSaving && (
          <div className="curve-tab-save-row">
            <input
              ref={saveInputRef}
              type="text"
              className="curve-tab-save-input"
              placeholder="Preset name…"
              value={saveName}
              maxLength={40}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmSaving();
                if (e.key === 'Escape') cancelSaving();
              }}
            />
            <button className="curve-tab-save-confirm" onClick={confirmSaving} disabled={!saveName.trim()} title="Save">
              <Check size={12} />
            </button>
            <button className="curve-tab-save-cancel" onClick={cancelSaving} title="Cancel">
              <X size={12} />
            </button>
          </div>
        )}
 
        {customPresets.length > 0 ? (
          <div className="curve-tab-preset-grid">
            {customPresets.map((preset) => (
              <button
                key={preset.name}
                className={`curve-tab-preset-btn curve-tab-custom-preset-btn${effectiveActive === preset.name ? ' active' : ''}`}
                onClick={() => handlePresetClick(preset)}
                title={preset.name}
              >
                <button
                  className="curve-tab-custom-delete"
                  onClick={(e) => deleteCustomPreset(preset.name, e)}
                  title={`Delete "${preset.name}"`}
                >
                  <Trash2 size={9} />
                </button>
                <CurvePreviewIcon cp1={preset.cp1} cp2={preset.cp2} size={28} isActive={effectiveActive === preset.name} />
                <span className="curve-tab-preset-name">{preset.name}</span>
              </button>
            ))}
          </div>
        ) : (
          !isSaving && (
            <div className="curve-tab-custom-empty">
              {selectedKeyId ? 'No saved curves yet — tweak the curve above and click "Save Curve".' : 'Select a keyframe to save custom curves.'}
            </div>
          )
        )}
      </div>
    </div>
  );
});