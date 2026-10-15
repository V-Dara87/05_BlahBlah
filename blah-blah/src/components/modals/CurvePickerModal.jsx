import { useState, useMemo, useEffect, memo } from 'react';
import { X, Search, Waves, Check, RotateCcw } from 'lucide-react';
import { CurveEditor } from '../shared/CurveEditor';
import { CURVE_PRESETS } from '../../engine/keyframes';
import './curve-picker-modal.css';
 
/**
 * CurvePickerModal — the "browse all curve presets" gallery, opened from
 * the Curves tab's inline dropdown via its Browse button. Visual shell
 * mirrors TransitionPickerModal (modal-backdrop / master-detail-layout /
 * modal-header / master-search-bar / master-preset-list / detail-*) so it
 * matches the rest of the app's picker-modal language for free — no new
 * shell CSS needed, only the curve-specific bits (mini preview icons,
 * the live editor pane) are new.
 *
 * Unlike the transition picker, there are no categories (a curve preset
 * is just two control points, not a shader with params) and no
 * play/scrub transport — the right pane IS the interactive editor, so
 * "previewing" a preset means dragging it live before applying.
 *
 * Props:
 *   isOpen                — whether the modal is shown
 *   onClose()              — called on backdrop click / Cancel / X / Esc-equivalent
 *   onApplyPreset(cp1,cp2) — called with the (possibly hand-tweaked) curve on Apply
 *   currentCp1, currentCp2 — the curve open in the Curves tab when the modal was opened
 */
export const CurvePickerModal = memo(function CurvePickerModal({
  isOpen,
  onClose,
  onApplyPreset,
  currentCp1,
  currentCp2,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedName, setSelectedName] = useState(null);
  // The live-tweakable curve for the detail pane — starts at whichever
  // preset is selected, but the user can drag it further before applying.
  const [tweaked, setTweaked] = useState(() => ({
    cp1: currentCp1 || { x: 0.25, y: 0.25 },
    cp2: currentCp2 || { x: 0.75, y: 0.75 },
  }));

  // This component stays mounted while the modal is closed. Start each new
  // browsing session from the currently selected segment instead of reviving
  // a previous, unapplied experiment.
  useEffect(() => {
    if (!isOpen) return;
    const matchingPreset = CURVE_PRESETS.find(
      (preset) =>
        Math.abs(preset.cp1.x - (currentCp1?.x ?? 0.25)) < 0.005 &&
        Math.abs(preset.cp1.y - (currentCp1?.y ?? 0.25)) < 0.005 &&
        Math.abs(preset.cp2.x - (currentCp2?.x ?? 0.75)) < 0.005 &&
        Math.abs(preset.cp2.y - (currentCp2?.y ?? 0.75)) < 0.005
    );
    setSelectedName(matchingPreset?.name || null);
    setTweaked({
      cp1: currentCp1 ? { ...currentCp1 } : { x: 0.25, y: 0.25 },
      cp2: currentCp2 ? { ...currentCp2 } : { x: 0.75, y: 0.75 },
    });
  }, [isOpen, currentCp1, currentCp2]);
 
  if (!isOpen) return null;
 
  const filteredPresets = CURVE_PRESETS.filter(
    (p) => !searchQuery.trim() || p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
 
  const selectedPreset = CURVE_PRESETS.find((p) => p.name === selectedName) || null;
 
  const handleSelectPreset = (preset) => {
    setSelectedName(preset.name);
    setTweaked({ cp1: { ...preset.cp1 }, cp2: { ...preset.cp2 } });
  };
 
  const handleResetToPreset = () => {
    if (!selectedPreset) return;
    setTweaked({ cp1: { ...selectedPreset.cp1 }, cp2: { ...selectedPreset.cp2 } });
  };
 
  const handleApply = () => {
    onApplyPreset?.(tweaked.cp1, tweaked.cp2);
    onClose();
  };
 
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="curve-picker-modal master-detail-layout"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <Waves size={16} className="text-cyan" />
            <h2 className="modal-title">Curve Presets</h2>
            <span className="modal-badge">{CURVE_PRESETS.length} curves</span>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>
 
        {/* Master-Detail Split Container */}
        <div className="transition-modal-split">
          {/* LEFT PANE — searchable preset list */}
          <div className="transition-master-pane">
            <div className="master-search-bar">
              <Search size={13} className="search-icon" />
              <input
                type="text"
                placeholder="Search curves..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="master-search-input"
                autoFocus
              />
              {searchQuery && (
                <button type="button" className="search-clear-btn" onClick={() => setSearchQuery('')}>
                  <X size={11} />
                </button>
              )}
            </div>
 
            <div className="master-preset-list">
              {filteredPresets.map((preset) => {
                const isSelected = selectedName === preset.name;
                return (
                  <div
                    key={preset.name}
                    className={`master-preset-item ${isSelected ? 'active' : ''}`}
                    onClick={() => handleSelectPreset(preset)}
                  >
                    <div className="preset-item-icon-box cat-cyan">
                      <CurveThumb cp1={preset.cp1} cp2={preset.cp2} size={22} />
                    </div>
                    <div className="preset-item-info">
                      <div className="preset-item-title-row">
                        <span className="preset-item-name">{preset.name}</span>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="preset-active-check">
                        <Check size={13} />
                      </div>
                    )}
                  </div>
                );
              })}
 
              {filteredPresets.length === 0 && (
                <div className="master-empty-state">
                  <p>No curves found matching "{searchQuery}"</p>
                </div>
              )}
            </div>
          </div>
 
          {/* RIGHT PANE — live interactive curve + apply */}
          <div className="transition-detail-pane">
            <div className="detail-preview-container">
              <div className="curve-picker-canvas-box">
                <CurveEditor
                  cp1={tweaked.cp1}
                  cp2={tweaked.cp2}
                  onChange={(nextCp1, nextCp2) => setTweaked({ cp1: nextCp1, cp2: nextCp2 })}
                  width={340}
                  height={220}
                />
              </div>
            </div>
 
            <div className="detail-info-header">
              <div className="detail-title-row">
                <h3 className="detail-preset-name">{selectedPreset?.name || 'Custom'}</h3>
                {selectedPreset && (
                  <button
                    type="button"
                    className="curve-picker-reset-inline"
                    onClick={handleResetToPreset}
                    title={`Reset to "${selectedPreset.name}"`}
                  >
                    <RotateCcw size={11} />
                  </button>
                )}
              </div>
              <p className="detail-preset-desc">
                {selectedPreset
                  ? 'Drag the handles to fine-tune before applying, or apply as-is.'
                  : 'Pick a preset on the left, or drag the handles to build your own curve.'}
              </p>
            </div>
 
            <div className="detail-action-footer">
              <button type="button" className="unity-btn unity-btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <div className="detail-apply-btns">
                <button
                  type="button"
                  className="unity-btn unity-btn-primary"
                  onClick={handleApply}
                  title="Apply this curve to the selected keyframe"
                >
                  Apply Curve
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
 
/**
 * CurveThumb — tiny static SVG preview of a bezier curve shape, used in
 * the master preset list. Pure SVG (not canvas) since these are small,
 * static, and numerous — cheaper to let the browser rasterize.
 */
function CurveThumb({ cp1, cp2, size = 22 }) {
  const path = useMemo(() => {
    const steps = 16;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = evalCubicBezierForThumb(t, cp1, cp2);
      const x = t * size;
      const sy = size - Math.max(0, Math.min(1, y)) * size;
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${sy.toFixed(1)}`);
    }
    return pts.join(' ');
  }, [cp1, cp2, size]);
 
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}
 
/** Small standalone bezier evaluator so CurveThumb doesn't depend on CurveEditor's internals. */
function evalCubicBezierForThumb(t, p1, p2) {
  const cx = 3 * p1.x;
  const bx = 3 * (p2.x - p1.x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1.y;
  const by = 3 * (p2.y - p1.y) - cy;
  const ay = 1 - cy - by;
 
  let ct = t;
  for (let i = 0; i < 8; i++) {
    const curX = ((ax * ct + bx) * ct + cx) * ct;
    const delta = curX - t;
    if (Math.abs(delta) < 1e-6) break;
    const deriv = (3 * ax * ct + 2 * bx) * ct + cx;
    if (Math.abs(deriv) < 1e-6) break;
    ct -= delta / deriv;
  }
  ct = Math.max(0, Math.min(1, ct));
  return ((ay * ct + by) * ct + cy) * ct;
}
