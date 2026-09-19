import { memo, useMemo } from 'react';
import { RotateCcw, Sliders } from 'lucide-react';
import { DragNumber } from '../shared/DragNumber';
import './odin-property-drawer.css';

/**
 * Utility to convert RGB / RGBA array ([r, g, b, a] in 0..1) to #rrggbb hex string
 */
function rgbArrayToHex(arr) {
  if (!Array.isArray(arr)) return '#ffffff';
  const r = Math.round(Math.max(0, Math.min(1, arr[0] ?? 1)) * 255);
  const g = Math.round(Math.max(0, Math.min(1, arr[1] ?? 1)) * 255);
  const b = Math.round(Math.max(0, Math.min(1, arr[2] ?? 1)) * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Utility to convert #rrggbb hex string to RGB array [r, g, b] (0..1)
 */
function hexToRgbArray(hex, prevArr = [1, 1, 1, 1]) {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return prevArr;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  if (prevArr.length === 4) {
    return [r, g, b, prevArr[3] ?? 1];
  }
  return [r, g, b];
}

/**
 * Check if two parameter values are equal (for Reset button visibility)
 */
function areValuesEqual(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => Math.abs((v ?? 0) - (b[i] ?? 0)) < 0.0001);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 0.0001;
  }
  return false;
}

/**
 * Format camelCase or snake_case names into clean human titles
 * e.g. "pixelSize" -> "Pixel Size", "shadow_colour" -> "Shadow Colour"
 */
function formatPropLabel(name) {
  if (!name) return '';
  return name
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

/**
 * OdinPropertyDrawer — Odin Inspector-style Dynamic Attribute / Property Drawer
 * 
 * Inspects a GLSL transition's `paramsTypes` and `defaultParams`, automatically
 * generating typed Unity-styled controls:
 * - float: Slider + DragNumber with intelligent min/max/step bounds
 * - int: Stepped Slider + DragNumber
 * - bool: Unity toggle switch
 * - vec2 / ivec2: Paired X (red) & Y (green) numeric drag controls
 * - vec3: Color picker (if color-named) or 3D vector (X, Y, Z)
 * - vec4: Color picker with Alpha (if color-named) or 4D vector (X, Y, Z, W)
 * - Reset to Default button per property and Reset All
 */
export const OdinPropertyDrawer = memo(function OdinPropertyDrawer({
  paramsTypes = {},
  defaultParams = {},
  values = {},
  onChange,
  onResetAll,
  title = 'Parameters',
  showHeader = true,
  className = '',
}) {
  const paramKeys = useMemo(() => Object.keys(paramsTypes || {}), [paramsTypes]);

  if (paramKeys.length === 0) {
    return (
      <div className={`odin-drawer-empty ${className}`}>
        <span className="odin-empty-text">No configurable parameters</span>
      </div>
    );
  }

  const hasAnyModified = paramKeys.some((key) => {
    const current = values[key] !== undefined ? values[key] : defaultParams[key];
    return !areValuesEqual(current, defaultParams[key]);
  });

  return (
    <div className={`odin-property-drawer ${className}`}>
      {showHeader && (
        <div className="odin-drawer-header">
          <div className="odin-header-left">
            <Sliders size={12} className="odin-header-icon" />
            <span className="odin-header-title">{title}</span>
            <span className="odin-header-count">{paramKeys.length}</span>
          </div>
          {hasAnyModified && onResetAll && (
            <button
              type="button"
              className="odin-reset-all-btn"
              onClick={onResetAll}
              title="Reset all parameters to default"
            >
              <RotateCcw size={11} />
              <span>Reset All</span>
            </button>
          )}
        </div>
      )}

      <div className="odin-drawer-body">
        {paramKeys.map((name) => {
          const type = paramsTypes[name];
          const defaultVal = defaultParams[name];
          const currentVal = values[name] !== undefined ? values[name] : defaultVal;
          const isModified = !areValuesEqual(currentVal, defaultVal);

          return (
            <div key={name} className={`odin-property-row ${isModified ? 'modified' : ''}`}>
              <div className="odin-prop-label-wrap" title={`${name} (${type})`}>
                <span className="odin-prop-name">{formatPropLabel(name)}</span>
                <span className="odin-prop-type-badge">{type}</span>
              </div>

              <div className="odin-prop-control-wrap">
                {renderControl(type, name, currentVal, defaultVal, (val) => onChange?.(name, val))}
              </div>

              <div className="odin-prop-action-wrap">
                {isModified ? (
                  <button
                    type="button"
                    className="odin-prop-reset-btn"
                    onClick={() => onChange?.(name, defaultVal)}
                    title={`Reset ${name} to default (${JSON.stringify(defaultVal)})`}
                  >
                    <RotateCcw size={11} />
                  </button>
                ) : (
                  <div className="odin-prop-reset-placeholder" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

function renderControl(type, name, value, defaultVal, onChange) {
  const isColor =
    /color|colour|bg/i.test(name) ||
    (Array.isArray(defaultVal) && (defaultVal.length === 3 || defaultVal.length === 4));

  switch (type) {
    case 'float': {
      const numVal = typeof value === 'number' ? value : parseFloat(value) || 0;
      const defNum = typeof defaultVal === 'number' ? defaultVal : 0;
      
      // Compute intelligent range
      let min = 0;
      let max = 1;
      let step = 0.01;

      if (defNum > 1 && defNum <= 10) {
        min = 0;
        max = Math.max(10, Math.ceil(defNum * 2));
        step = 0.1;
      } else if (defNum > 10) {
        min = 0;
        max = Math.max(100, Math.ceil(defNum * 2));
        step = 1;
      } else if (defNum < 0) {
        min = Math.min(-1, defNum * 2);
        max = Math.max(1, -defNum * 2);
        step = 0.05;
      }

      return (
        <div className="odin-slider-group">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={numVal}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="odin-range-slider"
          />
          <div className="odin-drag-box">
            <DragNumber
              value={numVal}
              onChange={onChange}
              step={step}
              min={min < 0 ? min : -Infinity}
              max={Infinity}
            />
          </div>
        </div>
      );
    }

    case 'int': {
      const intVal = typeof value === 'number' ? Math.round(value) : parseInt(value, 10) || 0;
      const defInt = typeof defaultVal === 'number' ? defaultVal : 0;
      const maxInt = Math.max(10, Math.ceil((defInt || 1) * 3));

      return (
        <div className="odin-slider-group">
          <input
            type="range"
            min={0}
            max={maxInt}
            step={1}
            value={intVal}
            onChange={(e) => onChange(parseInt(e.target.value, 10))}
            className="odin-range-slider"
          />
          <div className="odin-drag-box">
            <DragNumber
              value={intVal}
              onChange={(v) => onChange(Math.round(v))}
              step={1}
              min={0}
              max={1000}
            />
          </div>
        </div>
      );
    }

    case 'bool': {
      const boolVal = !!value;
      return (
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={boolVal}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="slider round" />
          <span className="odin-toggle-text">{boolVal ? 'True' : 'False'}</span>
        </label>
      );
    }

    case 'vec2':
    case 'ivec2': {
      const arr = Array.isArray(value) ? value : (Array.isArray(defaultVal) ? defaultVal : [0, 0]);
      const x = arr[0] ?? 0;
      const y = arr[1] ?? 0;
      const isInt = type === 'ivec2';
      const step = isInt ? 1 : 0.05;

      return (
        <div className="odin-vector-group">
          <DragNumber
            label="X"
            labelColor="#f87171"
            value={x}
            step={step}
            onChange={(v) => onChange([isInt ? Math.round(v) : v, y])}
          />
          <DragNumber
            label="Y"
            labelColor="#4ade80"
            value={y}
            step={step}
            onChange={(v) => onChange([x, isInt ? Math.round(v) : v])}
          />
        </div>
      );
    }

    case 'vec3': {
      const arr = Array.isArray(value) ? value : (Array.isArray(defaultVal) ? defaultVal : [1, 1, 1]);
      if (isColor) {
        const hex = rgbArrayToHex(arr);
        return (
          <div className="odin-color-row">
            <input
              type="color"
              className="odin-color-chip"
              value={hex}
              onChange={(e) => onChange(hexToRgbArray(e.target.value, arr))}
            />
            <span className="odin-hex-label">{hex.toUpperCase()}</span>
          </div>
        );
      }
      return (
        <div className="odin-vector-group">
          <DragNumber
            label="X"
            labelColor="#f87171"
            value={arr[0] ?? 0}
            step={0.05}
            onChange={(v) => onChange([v, arr[1] ?? 0, arr[2] ?? 0])}
          />
          <DragNumber
            label="Y"
            labelColor="#4ade80"
            value={arr[1] ?? 0}
            step={0.05}
            onChange={(v) => onChange([arr[0] ?? 0, v, arr[2] ?? 0])}
          />
          <DragNumber
            label="Z"
            labelColor="#60a5fa"
            value={arr[2] ?? 0}
            step={0.05}
            onChange={(v) => onChange([arr[0] ?? 0, arr[1] ?? 0, v])}
          />
        </div>
      );
    }

    case 'vec4': {
      const arr = Array.isArray(value) ? value : (Array.isArray(defaultVal) ? defaultVal : [0, 0, 0, 1]);
      if (isColor) {
        const hex = rgbArrayToHex(arr);
        const alpha = arr[3] !== undefined ? arr[3] : 1;
        return (
          <div className="odin-color-alpha-group">
            <input
              type="color"
              className="odin-color-chip"
              value={hex}
              onChange={(e) => onChange(hexToRgbArray(e.target.value, arr))}
            />
            <span className="odin-hex-label">{hex.toUpperCase()}</span>
            <div className="odin-alpha-drag">
              <DragNumber
                label="α"
                labelColor="#a78bfa"
                value={parseFloat(alpha.toFixed(2))}
                min={0}
                max={1}
                step={0.05}
                onChange={(a) => onChange([arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0, a])}
              />
            </div>
          </div>
        );
      }
      return (
        <div className="odin-vector-group">
          <DragNumber
            label="X"
            labelColor="#f87171"
            value={arr[0] ?? 0}
            step={0.05}
            onChange={(v) => onChange([v, arr[1] ?? 0, arr[2] ?? 0, arr[3] ?? 0])}
          />
          <DragNumber
            label="Y"
            labelColor="#4ade80"
            value={arr[1] ?? 0}
            step={0.05}
            onChange={(v) => onChange([arr[0] ?? 0, v, arr[2] ?? 0, arr[3] ?? 0])}
          />
          <DragNumber
            label="Z"
            labelColor="#60a5fa"
            value={arr[2] ?? 0}
            step={0.05}
            onChange={(v) => onChange([arr[0] ?? 0, arr[1] ?? 0, v, arr[3] ?? 0])}
          />
          <DragNumber
            label="W"
            labelColor="#a78bfa"
            value={arr[3] ?? 0}
            step={0.05}
            onChange={(v) => onChange([arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0, v])}
          />
        </div>
      );
    }

    default:
      return (
        <input
          type="text"
          className="inspector-num-input"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
