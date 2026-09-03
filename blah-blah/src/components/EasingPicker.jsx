import { useState, useRef, useEffect, memo } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Easing } from '../engine/motionTween';
import { CURVE_PRESETS } from '../engine/keyframes';

/**
 * All 16 easing presets grouped by family for the picker grid.
 * Each entry has: key (matches Easing object key), label (display name), category.
 */
const EASING_PRESET_LIST = [
  { key: 'linear',       label: 'Linear',       category: 'Basic' },
  { key: 'inQuad',       label: 'In Quad',      category: 'Quad' },
  { key: 'outQuad',      label: 'Out Quad',     category: 'Quad' },
  { key: 'inOutQuad',    label: 'In Out Quad',  category: 'Quad' },
  { key: 'inCubic',      label: 'In Cubic',     category: 'Cubic' },
  { key: 'outCubic',     label: 'Out Cubic',    category: 'Cubic' },
  { key: 'inOutCubic',   label: 'In Out Cubic', category: 'Cubic' },
  { key: 'inSine',       label: 'In Sine',      category: 'Sine' },
  { key: 'outSine',      label: 'Out Sine',     category: 'Sine' },
  { key: 'inOutSine',    label: 'In Out Sine',  category: 'Sine' },
  { key: 'inBack',       label: 'In Back',      category: 'Back' },
  { key: 'outBack',      label: 'Out Back',     category: 'Back' },
  { key: 'inOutBack',    label: 'In Out Back',  category: 'Back' },
  { key: 'inBounce',     label: 'In Bounce',    category: 'Bounce' },
  { key: 'outBounce',    label: 'Out Bounce',   category: 'Bounce' },
  { key: 'inOutBounce',  label: 'In Out Bounce', category: 'Bounce' },
  { key: 'inElastic',    label: 'In Elastic',   category: 'Elastic' },
  { key: 'outElastic',   label: 'Out Elastic',  category: 'Elastic' },
  { key: 'inOutElastic', label: 'In Out Elastic', category: 'Elastic' },
];

// Add CURVE_PRESETS as "Custom" category entries.
// These store cp1/cp2 bezier points directly instead of a named easing.
const CUSTOM_CURVE_ENTRIES = CURVE_PRESETS.map((p) => ({
  key: `curve:${p.name}`,
  label: p.name,
  category: 'Custom',
  cp1: p.cp1,
  cp2: p.cp2,
  isBezier: true,
}));

const CATEGORIES = ['Basic', 'Quad', 'Cubic', 'Sine', 'Back', 'Bounce', 'Elastic', 'Custom'];

/**
 * Generate an SVG path string for an easing curve inside a viewBox.
 * The curve goes from (0,1) top-left to (1,0) bottom-right (screen coords),
 * matching the standard easing diagram convention (time left-to-right,
 * progress bottom-to-top).
 */
function easingCurvePath(easingKey, size = 32) {
  const fn = Easing[easingKey];
  if (!fn) return '';
  const steps = 24;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const v = fn(t);
    const x = t * size;
    const y = size - v * size; // flip Y so 0=bottom, 1=top
    points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(' ');
}

/** Mini curve preview for a single easing preset. */
function EasingCurveIcon({ easingKey, size = 32, isActive }) {
  const d = easingCurvePath(easingKey, size);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="easing-curve-icon">
      {/* Grid background */}
      <line x1={0} y1={size} x2={size} y2={size} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      <line x1={0} y1={0} x2={0} y2={size} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      {/* Diagonal reference for linear */}
      <line x1={0} y1={size} x2={size} y2={0} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} strokeDasharray="2,2" />
      {/* The actual easing curve */}
      <path d={d} fill="none" stroke={isActive ? '#38bdf8' : '#8fe3e0'} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/**
 * EasingPicker — dropdown popover that lets the user pick an easing preset
 * for a keyframe. Shows all 16 presets as a grid of mini curve previews,
 * grouped by family.
 *
 * Props:
 *   currentEasing  — the keyframe's current easing string (e.g. 'linear')
 *   onChange(easing) — called when the user picks a new easing
 *   onClose()       — called to close the picker
 *   compact         — if true, renders as a small inline trigger (for Inspector);
 *                      if false, renders as a standalone panel (for Dopesheet toolbar)
 */
export const EasingPicker = memo(function EasingPicker({
  currentEasing = 'linear',
  onChange,
  onClose,
  compact = false,
}) {
  const [filter, setFilter] = useState('');
  const containerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handle = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  // Combine named easings + custom bezier curve presets
  const allPresets = [...EASING_PRESET_LIST, ...CUSTOM_CURVE_ENTRIES];

  const filtered = filter
    ? allPresets.filter((p) => p.label.toLowerCase().includes(filter.toLowerCase()))
    : allPresets;

  const grouped = CATEGORIES.map((cat) => ({
    category: cat,
    presets: filtered.filter((p) => p.category === cat),
  })).filter((g) => g.presets.length > 0);

  return (
    <div
      ref={containerRef}
      className={`easing-picker ${compact ? 'easing-picker-compact' : 'easing-picker-panel'}`}
    >
      {/* Header */}
      <div className="easing-picker-header">
        <span className="easing-picker-title">Easing Curve</span>
        <button className="easing-picker-close" onClick={onClose} title="Close">
          <X size={12} />
        </button>
      </div>

      {/* Search filter */}
      <div className="easing-picker-search">
        <input
          type="text"
          placeholder="Filter easings..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="easing-picker-search-input"
          autoFocus
        />
      </div>

      {/* Current selection indicator */}
      <div className="easing-picker-current">
        <EasingCurveIcon easingKey={currentEasing} size={28} isActive />
        <span className="easing-picker-current-label">{currentEasing || 'linear'}</span>
      </div>

      {/* Preset grid grouped by category */}
      <div className="easing-picker-grid">
        {grouped.map((group) => (
          <div key={group.category} className="easing-picker-group">
            <div className="easing-picker-group-label">{group.category}</div>
            <div className="easing-picker-group-items">
              {group.presets.map((preset) => {
                const isActive = currentEasing === preset.key;
                return (
                  <button
                    key={preset.key}
                    className={`easing-preset-item${isActive ? ' active' : ''}`}
                    onClick={() => {
                      onChange?.(preset.key);
                      onClose?.();
                    }}
                    title={preset.label}
                  >
                    <EasingCurveIcon easingKey={preset.key} size={32} isActive={isActive} />
                    <span className="easing-preset-label">{preset.label.replace(/^(In Out |In |Out )/, '')}</span>
                    <span className="easing-preset-prefix">
                      {preset.key.startsWith('inOut') ? 'InOut' : preset.key.startsWith('in') ? 'In' : preset.key.startsWith('out') ? 'Out' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="easing-picker-empty">No matching easings</div>
        )}
      </div>
    </div>
  );
});

/**
 * EasingTrigger — a small clickable button that shows the current easing
 * and opens the EasingPicker on click. Used inline in the Inspector and
 * Dopesheet toolbar.
 */
export function EasingTrigger({ currentEasing = 'linear', onChange, className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(null);

  return (
    <span className={`easing-trigger-wrapper ${className}`} ref={triggerRef}>
      <button
        className="easing-trigger-btn"
        onClick={() => setIsOpen(!isOpen)}
        title={`Easing: ${currentEasing} — click to change`}
      >
        <svg width={14} height={14} viewBox="0 0 14 14" className="easing-trigger-icon">
          <path d={easingCurvePath(currentEasing, 14)} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
        </svg>
        <ChevronDown size={9} />
      </button>
      {isOpen && (
        <EasingPicker
          currentEasing={currentEasing}
          onChange={onChange}
          onClose={() => setIsOpen(false)}
          compact
        />
      )}
    </span>
  );
}
