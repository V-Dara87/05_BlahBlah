import { memo } from 'react';
import { DragNumber } from '../shared/DragNumber';

/**
 * DopesheetValueCell — one parameter row of the Dopesheet's property tree: its
 * live value at the playhead, editable in place, with the parameter's name
 * inside the control (a drag-to-scrub number whose left cell is the name / axis
 * label, as in the Inspector; or name + checkbox / dropdown / colour / text).
 *
 * It is purely presentational: the Dopesheet resolves the value at the
 * playhead and decides whether an edit becomes a keyframe or a static write.
 * Because it is driven by the same field schema as the lanes
 * (`fieldSchemaForComponent`), EVERY exposed parameter — built-in components
 * and every script prop — gets a cell with no per-parameter wiring.
 */

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

/** Expand #rgb to #rrggbb; null when the value isn't a plain hex colour. */
function toHex6(value) {
  if (typeof value !== 'string') return null;
  if (HEX6.test(value)) return value;
  if (HEX3.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return null;
}

/** Field types that have a value cell (the same ones the Inspector can keyframe and edit inline). */
export function hasDopesheetValueCell(field) {
  switch (field?.type) {
    case 'number':
    case 'boolean':
    case 'color':
    case 'string':
    case 'textarea':
      return true;
    case 'select':
      return Array.isArray(field.options);
    default:
      return false;
  }
}

export const DopesheetValueCell = memo(function DopesheetValueCell({ field, label, value, onChange }) {
  if (!hasDopesheetValueCell(field)) return null;
  const name = label || field.label || field.name;

  switch (field.type) {
    case 'number': {
      const num = typeof value === 'number' ? value : parseFloat(value) || 0;
      return (
        <div className="dopesheet-value-cell is-number">
          <DragNumber
            label={name}
            labelColor={field.labelColor}
            value={num}
            step={field.step || 0.1}
            min={field.min ?? -Infinity}
            max={field.max ?? Infinity}
            onChange={(v) => onChange(field.step === 1 ? Math.round(v) : v)}
          />
        </div>
      );
    }

    case 'boolean':
      return (
        <div className="dopesheet-value-cell">
          <span className="dopesheet-value-name" title={name}>{name}</span>
          <input
            type="checkbox"
            className="inspector-switch"
            aria-label={name}
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
          />
        </div>
      );

    case 'select':
      return (
        <div className="dopesheet-value-cell">
          <span className="dopesheet-value-name" title={name}>{name}</span>
          <select
            className="dopesheet-value-select"
            aria-label={name}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );

    case 'color': {
      const hex = toHex6(value);
      return (
        <div className="dopesheet-value-cell">
          <span className="dopesheet-value-name" title={name}>{name}</span>
          {hex ? (
            <input
              type="color"
              className="dopesheet-value-color"
              aria-label={name}
              value={hex}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            // rgba()/named colours can't round-trip through <input type=color>;
            // show them read-only rather than silently rewriting them.
            <span
              className="dopesheet-value-color is-readonly"
              style={{ background: typeof value === 'string' ? value : 'transparent' }}
              title={String(value ?? '')}
            />
          )}
        </div>
      );
    }

    default:
      // string / textarea — commit on blur or Enter (not per keystroke) so a
      // keyframed text value isn't rewritten on every character typed.
      return (
        <div className="dopesheet-value-cell">
          <span className="dopesheet-value-name" title={name}>{name}</span>
          <input
            // key resets the uncontrolled input when the resolved value changes
            // (scrubbing the playhead across keyframes).
            key={String(value ?? '')}
            type="text"
            className="dopesheet-value-text"
            aria-label={name}
            defaultValue={value ?? ''}
            onBlur={(e) => { if (e.target.value !== String(value ?? '')) onChange(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
          />
        </div>
      );
  }
});