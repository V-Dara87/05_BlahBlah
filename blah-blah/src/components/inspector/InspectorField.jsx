import { DragNumber } from '../DragNumber';
import { trackKeyFor, getFieldKeyframes, setKeyframe, removeKeyframe } from '../../engine/keyframes';

/**
 * P0 #3 — Unified Inspector field rendering.
 *
 * One schema-driven render function for a single field, used by every
 * component type that exposes editable props: Transform (static schema
 * below), ReactRenderer, ScriptComponent, and CanvasRenderer (all three
 * driven by `extractScriptProps`'s field schema from scriptRunner.js).
 *
 * Field shape (matches extractScriptProps' output exactly):
 *   { name, type, defaultVal, label, min, max, step, options }
 * `type` is one of: 'number' | 'color' | 'boolean' | 'select' | 'string'.
 *
 * This replaces the two near-identical hand-written field-switch blocks
 * that used to live inline in UnityInspector.jsx for ReactRenderer and
 * ScriptComponent (same switch, duplicated), and gives CanvasRenderer an
 * Inspector block for the first time — previously its props were only
 * settable via a prefab's default `props` object.
 */
export function InspectorField({ field, value, onChange, trackKey, fieldName, selectedEntity, currentTime, onUpdateEntity }) {
  const currentVal = value !== undefined ? value : field.defaultVal;

  // Keyframe handling
  const handleKeyframeToggle = () => {
    if (!selectedEntity || !trackKey || !fieldName) return;
    
    const localTime = Math.max(0, currentTime - selectedEntity.startTime);
    const snapToFrame = (t) => Math.round(t * 30) / 30;
    const snappedTime = snapToFrame(localTime);
    
    const kfs = getFieldKeyframes(selectedEntity, trackKey, fieldName);
    const existing = kfs.find((k) => Math.abs(k.time - snappedTime) < 1 / 60);
    
    if (existing) {
      const keyframes = removeKeyframe(selectedEntity, trackKey, fieldName, existing.id);
      onUpdateEntity(selectedEntity.id, { keyframes });
    } else {
      const val = currentVal !== undefined ? currentVal : field.defaultVal;
      const keyframes = setKeyframe(selectedEntity, trackKey, fieldName, snappedTime, val);
      onUpdateEntity(selectedEntity.id, { keyframes });
    }
  };

  const hasKeyframes = selectedEntity && trackKey && fieldName 
    ? getFieldKeyframes(selectedEntity, trackKey, fieldName).length > 0 
    : false;
  const hasKeyframeAtCurrentTime = selectedEntity && trackKey && fieldName
    ? getFieldKeyframes(selectedEntity, trackKey, fieldName).some(
        (k) => Math.abs(k.time - Math.max(0, currentTime - selectedEntity.startTime)) < 1 / 60
      )
    : false;

  const fieldInput = (() => {
    switch (field.type) {
      case 'number':
        return (
          <DragNumber
            label={field.dragLabel || '#'}
            labelColor={field.labelColor}
            value={typeof currentVal === 'number' ? currentVal : parseFloat(currentVal) || 0}
            step={field.step || 0.1}
            min={field.min ?? -Infinity}
            max={field.max ?? Infinity}
            onChange={(v) => onChange(field.step === 1 ? Math.round(v) : v)}
          />
        );
      case 'color':
        return (
          <input
            type="color"
            className="inspector-color-input"
            value={currentVal || '#ffffff'}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      case 'boolean':
        return (
          <input
            type="checkbox"
            checked={!!currentVal}
            onChange={(e) => onChange(e.target.checked)}
          />
        );
      case 'select':
        return Array.isArray(field.options) ? (
          <select
            className="inspector-select"
            value={currentVal}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : null;
      case 'textarea':
        return (
          <textarea
            className="inspector-textarea"
            rows={field.rows || 2}
            value={currentVal || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      default:
        return (
          <input
            type="text"
            className="inspector-num-input"
            value={currentVal || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        );
    }
  })();

  // Only show keyframe button if keyframing props are provided
  if (selectedEntity && trackKey && fieldName) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
        {fieldInput}
        <button
          className={`keyframe-btn ${hasKeyframes ? 'has-keys' : ''} ${hasKeyframeAtCurrentTime ? 'at-current-time' : ''}`}
          onClick={handleKeyframeToggle}
          title={hasKeyframeAtCurrentTime ? 'Remove keyframe at current time' : 'Add keyframe at current time'}
        />
      </div>
    );
  }

  return fieldInput;
}
 
/**
 * Renders a full list of schema fields as `.inspector-row`s, with the
 * standard "no exposed props" hint when the schema is empty. Used for the
 * script-driven component types (ReactRenderer / ScriptComponent /
 * CanvasRenderer) whose fields come from `extractScriptProps`.
 *
 * `bare: true` skips the per-field `.inspector-row` wrapper and just
 * renders each field's `InspectorField` directly. Needed for grouped
 * multi-field rows (Position X/Y, Scale X/Y in TRANSFORM_FIELD_GROUPS):
 * those already have their own single row label + `.drag-number-group`
 * flex wrapper (see UnityInspector.jsx), so wrapping each individual field
 * in its own `.inspector-row` nested a 75px grid label column inside that
 * flex row per field — collapsing each DragNumber's actual width to
 * almost nothing, since `.drag-number-field`'s `flex: 1` had no grid
 * track to fill inside the outer .inspector-row it was accidentally
 * nested in.
 */
export function InspectorFieldList({ fields, values, onFieldChange, emptyHint, bare = false, trackKey, selectedEntity, currentTime, onUpdateEntity }) {
  if (!fields || fields.length === 0) {
    return emptyHint ? <p className="hint-text-sm">{emptyHint}</p> : null;
  }

  if (bare) {
    return fields.map((field) => (
      <InspectorField
        key={field.name}
        field={field}
        value={values?.[field.name]}
        onChange={(v) => onFieldChange(field.name, v)}
        trackKey={trackKey}
        fieldName={field.name}
        selectedEntity={selectedEntity}
        currentTime={currentTime}
        onUpdateEntity={onUpdateEntity}
      />
    ));
  }

  return fields.map((field) => (
    <div key={field.name} className="inspector-row">
      <span className="row-label">{field.label || field.name}</span>
      <InspectorField
        field={field}
        value={values?.[field.name]}
        onChange={(v) => onFieldChange(field.name, v)}
        trackKey={trackKey}
        fieldName={field.name}
        selectedEntity={selectedEntity}
        currentTime={currentTime}
        onUpdateEntity={onUpdateEntity}
      />
    </div>
  ));
}

/**
 * Static field schema for the Transform component — the one component
 * type whose fields aren't script-derived. Expressed in the same shape as
 * extractScriptProps' output so it can flow through the same
 * InspectorField renderer instead of Transform's own hand-written
 * DragNumber rows.
 */
export const TRANSFORM_FIELD_GROUPS = [
  {
    label: 'Position',
    fields: [
      { name: 'x', type: 'number', dragLabel: 'X', labelColor: '#f87171', step: 1, defaultVal: 0 },
      { name: 'y', type: 'number', dragLabel: 'Y', labelColor: '#4ade80', step: 1, defaultVal: 0 },
    ],
  },
  {
    label: 'Rotation',
    fields: [
      { name: 'rotation', type: 'number', dragLabel: '°', labelColor: '#60a5fa', step: 1, defaultVal: 0 },
    ],
  },
  {
    label: 'Scale',
    fields: [
      { name: 'scaleX', type: 'number', dragLabel: 'X', labelColor: '#f87171', step: 0.01, defaultVal: 1 },
      { name: 'scaleY', type: 'number', dragLabel: 'Y', labelColor: '#4ade80', step: 0.01, defaultVal: 1 },
    ],
  },
  {
    label: 'Opacity',
    fields: [
      { name: 'opacity', type: 'number', dragLabel: 'α', labelColor: '#a78bfa', step: 0.01, min: 0, max: 1, defaultVal: 1 },
    ],
  },
];
 