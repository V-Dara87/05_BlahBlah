import { DragNumber } from '../shared/DragNumber';
import { trackKeyFor, getFieldKeyframes, setKeyframe, removeKeyframe } from '../../engine/keyframes';
import { EntityRefSlot, AssetRefSlot } from './RefSlot';
import { FontFamilyPicker } from './FontFamilyPicker';
import { ArrayFieldEditor } from '../shared/ArrayFieldEditor';
import { buildStructDefault } from '../../engine/scriptRunner';
import {
  FULL_WIDTH_TYPES,
  isFullWidthType,
  buildInspectorLayout,
  entryLabel,
  isFieldEnabled,
  subfieldSchema,
} from '../../engine/inspectorAttributes';
import { useMemo, useState, useRef } from 'react';
import { ChevronRight, Copy, ClipboardPaste, RotateCcw } from 'lucide-react';
import { ContextMenu } from '../shared/ContextMenu';
import './inspector-attributes.css';
import './inspector-polish.css';
 
// ─── Struct helpers ──────────────────────────────────────────────────────────
 
/**
 * StructFieldGroup — renders a single `type:'struct'` prop as a
 * collapsible section whose sub-rows are ordinary Inspector rows.
 *
 * The sub-schema goes through `subfieldSchema` + `InspectorFieldList`, i.e.
 * exactly the same pipeline as top-level props, so a struct's own fields can
 * carry attributes too (a nested `showIf`, an inline X/Y row, a nested struct
 * or list, a button).
 */
function StructFieldGroup({ field, value, onChange, entities, mediaAssets, tracks = [], onAction }) {
  const [open, setOpen] = useState(true);
  const subVal = value && typeof value === 'object' ? value : buildStructDefault(field.fields);
  const subfields = useMemo(() => subfieldSchema(field.fields), [field.fields]);
 
  return (
    <div className="struct-group">
      <button className="struct-group-toggle" onClick={() => setOpen((o) => !o)}>
        <ChevronRight
          size={12}
          className={`struct-group-chevron ${open ? 'is-open' : ''}`}
        />
        <span>{field.label || field.name}</span>
      </button>
      {open && (
        <div className="struct-group-body">
          <InspectorFieldList
            fields={subfields}
            values={subVal}
            onFieldChange={(name, v) => onChange({ ...subVal, [name]: v })}
            entities={entities}
            mediaAssets={mediaAssets}
            tracks={tracks}
            onAction={onAction}
          />
        </div>
      )}
    </div>
  );
}
 
/**
 * StructArrayEditor — renders a `type:'struct[]'` prop using ArrayFieldEditor.
 * Each row expands to show all subfields as standard Inspector rows, from the
 * same `subfieldSchema` pipeline as everything else.
 */
function StructArrayEditor({ field, value, onChange, entities, mediaAssets, tracks = [], onAction }) {
  const rawList = Array.isArray(value)
    ? value
    : (Array.isArray(field.defaultVal) ? field.defaultVal : []);
  const validList = useMemo(() => {
    return rawList.filter((it) => it != null && typeof it === 'object');
  }, [rawList]);
 
  const subfields = useMemo(() => {
    if (field.fields && Object.keys(field.fields).length > 0) {
      return subfieldSchema(field.fields);
    }
    if (validList.length > 0) {
      const keys = new Set();
      validList.forEach((it) => {
        Object.keys(it).forEach((k) => {
          if (!k.startsWith('_')) keys.add(k);
        });
      });
      const inferredFields = {};
      keys.forEach((k) => {
        const sample = validList.find((it) => it[k] !== undefined)?.[k];
        inferredFields[k] = sample;
      });
      return subfieldSchema(inferredFields);
    }
    return [];
  }, [field.fields, validList]);
 
  const idsRef = useRef([]);
  if (idsRef.current.length !== validList.length) {
    const nextIds = [];
    for (let i = 0; i < validList.length; i++) {
      nextIds.push(validList[i]?._id || idsRef.current[i] || crypto.randomUUID());
    }
    idsRef.current = nextIds;
  }
 
  const items = useMemo(() => {
    return validList.map((it, idx) => ({
      ...it,
      _id: it?._id || idsRef.current[idx] || `struct-${idx}`,
    }));
  }, [validList]);
 
  return (
    <div className="struct-array-editor">
      <ArrayFieldEditor
        items={items}
        itemIdKey="_id"
        addButtonText={`Add ${field.label || field.name}`}
        emptyMessage={`No ${field.label || field.name} yet.`}
        onItemUpdate={(nextItems) => onChange(nextItems)}
        onItemChange={(itemId, patch) => {
          return items.map((it) => (it._id === itemId ? { ...it, ...patch } : it));
        }}
        onItemAdd={(newItem) => [...items, newItem]}
        onItemRemove={(itemId) => items.filter((it) => it._id !== itemId)}
        onItemReorder={(draggedId, targetId) => {
          const from = items.findIndex((it) => it._id === draggedId);
          const to   = items.findIndex((it) => it._id === targetId);
          if (from < 0 || to < 0) return items;
          const next = [...items];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
        }}
        createNewItem={() => ({ _id: crypto.randomUUID(), ...buildStructDefault(field.fields) })}
        renderItem={(item, index) => {
          if (!item) return <span className="struct-array-item-title">—</span>;
          const label = item.label || item.title || item.name || item.id || `#${(index ?? 0) + 1} (${item.x ?? '—'}, ${item.y ?? '—'})`;
          return (
            <span className="struct-array-item-title">
              {label}
            </span>
          );
        }}
        renderBody={(item, _index, onUpdate) => (
          <div className="struct-array-item-body">
            <InspectorFieldList
              fields={subfields}
              values={item}
              onFieldChange={(name, v) => onUpdate({ [name]: v })}
              entities={entities}
              mediaAssets={mediaAssets}
              tracks={tracks}
              onAction={onAction}
            />
          </div>
        )}
      />
    </div>
  );
}
 
/**
 * PrimitiveArrayEditor — renders primitive or reference array props
 * (e.g. `string[]`, `number[]`, `color[]`, `boolean[]`, `select[]`, `asset[]`, `entity[]`, `font[]`)
 * using ArrayFieldEditor in a compact single-line per item format.
 */
function PrimitiveArrayEditor({ field, value, onChange, entities, mediaAssets, tracks = [], disabled }) {
  const itemType = field.itemType || (typeof field.type === 'string' && field.type.endsWith('[]') ? field.type.slice(0, -2) : 'string');
  const rawList = Array.isArray(value) ? value : [];
 
  const idsRef = useRef([]);
  if (idsRef.current.length !== rawList.length) {
    const nextIds = [];
    for (let i = 0; i < rawList.length; i++) {
      nextIds.push(idsRef.current[i] || crypto.randomUUID());
    }
    idsRef.current = nextIds;
  }
 
  const items = useMemo(() => {
    return rawList.map((val, i) => ({
      _id: idsRef.current[i] || `item-${i}`,
      val,
      index: i,
    }));
  }, [rawList]);
 
  const getDefaultItemValue = () => {
    if (itemType === 'number') return 0;
    if (itemType === 'boolean') return false;
    if (itemType === 'color') return '#ffffff';
    if (itemType === 'asset' || itemType === 'entity') return null;
    if (itemType === 'select') return field.options?.[0] ?? '';
    return '';
  };
 
  const renderItemControl = (val, onValChange) => {
    switch (itemType) {
      case 'number':
        return (
          <DragNumber
            label={field.dragLabel || '#'}
            labelColor={field.labelColor}
            value={typeof val === 'number' ? val : parseFloat(val) || 0}
            step={field.step || 0.1}
            min={field.min ?? -Infinity}
            max={field.max ?? Infinity}
            disabled={disabled}
            onChange={(v) => onValChange(field.step === 1 ? Math.round(v) : v)}
          />
        );
      case 'color':
        return <ColorField value={val} onChange={onValChange} disabled={disabled} />;
      case 'boolean':
        return (
          <input
            type="checkbox"
            className="inspector-switch"
            checked={!!val}
            disabled={disabled}
            onChange={(e) => onValChange(e.target.checked)}
          />
        );
      case 'select':
        return Array.isArray(field.options) ? (
          <select
            className="inspector-select"
            value={val ?? (field.options[0] || '')}
            disabled={disabled}
            onChange={(e) => onValChange(e.target.value)}
          >
            {field.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : null;
      case 'asset':
        return (
          <div style={{ flex: 1, minWidth: 0 }}>
            <AssetRefSlot
              value={val}
              mediaAssets={mediaAssets}
              assetType={field.assetType}
              emptyLabel={field.assetType ? `None (${field.assetType})` : 'None (Asset)'}
              onChange={(id) => onValChange(id)}
            />
          </div>
        );
      case 'entity':
        return (
          <div style={{ flex: 1, minWidth: 0 }}>
            <EntityRefSlot
              value={val}
              entities={entities}
              tracks={tracks}
              targetComponent={field.targetComponent}
              emptyLabel={field.targetComponent ? `None (${field.targetComponent})` : 'None (Entity)'}
              onChange={(id) => onValChange(id)}
            />
          </div>
        );
      case 'font':
        return (
          <div style={{ flex: 1, minWidth: 0 }}>
            <FontFamilyPicker
              value={val || 'Inter'}
              disabled={disabled}
              onChange={onValChange}
            />
          </div>
        );
      case 'string':
      default:
        return (
          <input
            type="text"
            className="inspector-num-input"
            value={val ?? ''}
            disabled={disabled}
            onChange={(e) => onValChange(e.target.value)}
          />
        );
    }
  };
 
  return (
    <div className="primitive-array-editor">
      <div className="inspector-array-title">
        <span className="inspector-array-title-text">{field.label || field.name}</span>
        <span className="inspector-array-count">{rawList.length}</span>
      </div>
      <ArrayFieldEditor
        items={items}
        itemIdKey="_id"
        addButtonText={`Add ${field.label || field.name}`}
        emptyMessage={`No ${field.label || field.name} yet.`}
        onItemUpdate={(nextItems) => {
          idsRef.current = nextItems.map((it) => it._id);
          onChange(nextItems.map((it) => it.val));
        }}
        onItemChange={(itemId, patch) => {
          const next = items.map((it) => (it._id === itemId ? { ...it, ...patch } : it));
          onChange(next.map((it) => it.val));
          return next;
        }}
        onItemAdd={(newItem) => {
          idsRef.current.push(newItem._id);
          const next = [...items, newItem];
          onChange(next.map((it) => it.val));
          return next;
        }}
        onItemRemove={(itemId) => {
          const idx = idsRef.current.indexOf(itemId);
          if (idx >= 0) idsRef.current.splice(idx, 1);
          const next = items.filter((it) => it._id !== itemId);
          onChange(next.map((it) => it.val));
          return next;
        }}
        onItemReorder={(draggedId, targetId) => {
          const from = items.findIndex((it) => it._id === draggedId);
          const to   = items.findIndex((it) => it._id === targetId);
          if (from < 0 || to < 0) return items;
          const next = [...items];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          const [movedId] = idsRef.current.splice(from, 1);
          idsRef.current.splice(to, 0, movedId);
          onChange(next.map((it) => it.val));
          return next;
        }}
        createNewItem={() => ({
          _id: crypto.randomUUID(),
          val: getDefaultItemValue(),
        })}
        renderItem={(item, _index, onUpdate) => (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
            {renderItemControl(item.val, (nextVal) => onUpdate({ val: nextVal }))}
          </div>
        )}
      />
    </div>
  );
}
 
/**
 * ColorField — swatch + editable hex readout. The native color input only
 * accepts #rrggbb, so a saved `#fff` (or any odd value) is expanded for the
 * swatch, and the hex box commits only when what was typed is a real colour.
 */
function expandHex(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return `#${hex}`;
}
 
function ColorField({ value, onChange, disabled }) {
  const hex = expandHex(value) || '#ffffff';
  const [draft, setDraft] = useState(null); // null = not typing
  const commit = () => {
    const next = expandHex(draft);
    if (next && next !== hex) onChange(next);
    setDraft(null);
  };
  return (
    <div className="inspector-color-field">
      <input
        type="color"
        className="inspector-color-swatch"
        value={hex}
        disabled={disabled}
        aria-label="Pick color"
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        className="inspector-color-hex"
        value={draft ?? hex}
        disabled={disabled}
        maxLength={7}
        spellCheck={false}
        aria-label="Hex color"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
        }}
      />
    </div>
  );
}
 
// ─── Copy / paste / reset (right-click on a field row) ───────────────────────
 
const clone = (v) => (v !== null && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
 
const isArrayType = (t) => t === 'array' || (typeof t === 'string' && t.endsWith('[]'));
 
/**
 * The value a field resets to: its declared default, else a sensible one for
 * its type (so a script prop with no `default` still resets to something).
 */
export function getFieldDefault(field) {
  if (field.defaultVal !== undefined) return clone(field.defaultVal);
  const t = field.type;
  if (t === 'number') return 0;
  if (t === 'boolean') return false;
  if (t === 'color') return '#ffffff';
  if (t === 'select') return field.options?.[0] ?? '';
  if (t === 'struct') return buildStructDefault(field.fields);
  if (t === 'object') return {};
  if (isArrayType(t)) return [];
  if (t === 'entity' || t === 'asset') return null;
  return '';
}
 
function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if ((a ?? null) === (b ?? null)) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}
 
const serializeValue = (v) => {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
};
 
// Fallback for when the system clipboard cannot be read (permission prompt
// denied, no focus): the last value copied inside the app.
let lastCopied = null;
 
/** Turn clipboard text into a value this field accepts, or { ok: false }. */
function coerceClipboard(field, text) {
  const raw = typeof text === 'string' ? text : '';
  const t = field.type;
  const trimmed = raw.trim();
  if (t === 'number') {
    let n = parseFloat(trimmed);
    if (!Number.isFinite(n)) return { ok: false };
    if (Number.isFinite(field.min)) n = Math.max(field.min, n);
    if (Number.isFinite(field.max)) n = Math.min(field.max, n);
    return { ok: true, value: field.step === 1 ? Math.round(n) : n };
  }
  if (t === 'boolean') {
    if (/^(true|1|on|yes)$/i.test(trimmed)) return { ok: true, value: true };
    if (/^(false|0|off|no)$/i.test(trimmed)) return { ok: true, value: false };
    return { ok: false };
  }
  if (t === 'color') {
    const hex = expandHex(trimmed);
    return hex ? { ok: true, value: hex } : { ok: false };
  }
  if (t === 'select') {
    return Array.isArray(field.options) && field.options.includes(trimmed)
      ? { ok: true, value: trimmed }
      : { ok: false };
  }
  if (t === 'struct' || t === 'object' || isArrayType(t)) {
    try {
      const parsed = JSON.parse(trimmed);
      const wantArray = isArrayType(t);
      if (wantArray ? Array.isArray(parsed) : (parsed && typeof parsed === 'object' && !Array.isArray(parsed))) {
        return { ok: true, value: parsed };
      }
    } catch { /* not JSON */ }
    return { ok: false };
  }
  if (t === 'entity' || t === 'asset') return trimmed ? { ok: true, value: trimmed } : { ok: false };
  return { ok: true, value: raw };
}
 
function FieldContextMenu({ x, y, field, value, onChange, disabled, onClose }) {
  const isDefault = sameValue(value, getFieldDefault(field));
 
  const handleCopy = () => {
    const text = serializeValue(value);
    lastCopied = text;
    navigator.clipboard?.writeText(text).catch(() => {});
    onClose();
  };
 
  const handlePaste = async () => {
    let text = null;
    try { text = await navigator.clipboard.readText(); } catch { text = lastCopied; }
    const result = coerceClipboard(field, text);
    if (result.ok) onChange(result.value);
    onClose();
  };
 
  const handleReset = () => {
    onChange(getFieldDefault(field));
    onClose();
  };
 
  return (
    <ContextMenu x={x} y={y} onClose={onClose} className="inspector-ctx-menu" minWidth={150}>
      <button type="button" className="inspector-ctx-item" onClick={handleCopy}>
        <Copy size={12} /> Copy Value
      </button>
      <button type="button" className="inspector-ctx-item" disabled={disabled} onClick={handlePaste}>
        <ClipboardPaste size={12} /> Paste Value
      </button>
      <div className="inspector-ctx-sep" />
      <button type="button" className="inspector-ctx-item" disabled={disabled || isDefault} onClick={handleReset}>
        <RotateCcw size={12} /> Reset Value
      </button>
    </ContextMenu>
  );
}
 
function useFieldMenu({ field, value, onChange, disabled }) {
  const [menu, setMenu] = useState(null);
 
  const open = (e) => {
    if (!field || field.type === 'button') return;
    // Typing controls keep the native cut / copy / paste menu.
    if (e.target?.closest?.('textarea, input[type="text"], input:not([type])')) return;
    e.preventDefault();
    e.stopPropagation(); // a nested field's menu must not also open its parent's
    setMenu({ x: e.clientX, y: e.clientY });
  };
 
  const node = menu ? (
    <FieldContextMenu
      x={menu.x}
      y={menu.y}
      field={field}
      value={value}
      onChange={onChange}
      disabled={disabled}
      onClose={() => setMenu(null)}
    />
  ) : null;
 
  return { open, node };
}
 
/**
 * A row (or, with className `inspector-field-ctx`, a layout-neutral wrapper)
 * that gives its field a right-click menu: Copy Value / Paste Value / Reset
 * Value. A value that differs from its default marks the row `is-modified`
 * (label turns bold, like a Unity prefab override).
 *
 * `field` only needs { name, type, defaultVal } (+ options / min / max / step
 * for pasting), so hand-written rows in the built-in cards use it too.
 */
export function FieldContextRow({ field, value, onChange, disabled = false, className = 'inspector-row', children }) {
  const current = value !== undefined ? value : getFieldDefault(field);
  const { open, node } = useFieldMenu({ field, value: current, onChange, disabled });
  const modified = !sameValue(current, getFieldDefault(field));
  return (
    <div className={`${className}${modified ? ' is-modified' : ''}`} onContextMenu={open}>
      {children}
      {node}
    </div>
  );
}
 
/**
 * FieldWithAction — a field control plus the small button declared by the
 * `button: { label, action }` attribute (Odin's `[Button]` next to a field).
 */
function FieldWithAction({ button, disabled, onAction, children }) {
  return (
    <div className="inspector-field-with-action">
      {children}
      <button
        type="button"
        className={`inspector-action-btn is-inline ${button.variant || ''}`}
        onClick={() => onAction?.(button.action)}
        disabled={disabled}
        title={button.action}
      >
        {button.label}
      </button>
    </div>
  );
}
 
/**
 * P0 #3 — Unified Inspector field rendering.
 *
 * One schema-driven render function for a single field, used by every
 * component type that exposes editable props: Transform (static schema
 * below) and script components (one type — ScriptComponent — driven by
 * `extractScriptProps`'s field schema from scriptRunner.js, regardless of
 * the script's motion/React/canvas kind).
 *
 * Field shape (matches extractScriptProps' output exactly):
 *   { name, type, defaultVal, label, min, max, step, options, fields }
 * `type` is one of: 'number' | 'color' | 'boolean' | 'select' | 'string' |
 *                   'textarea' | 'font' | 'entity' | 'asset' | 'struct' |
 *                   'struct[]' | 'button'.
 *
 * Odin-style *attributes* on the field (`box`, `tab`, `showIf`, `toggleLeft`,
 * `selectButton`, `button`, …) are handled in two places: grouping/layout by
 * InspectorFieldList (via engine/inspectorAttributes.js), and the per-control
 * ones (`selectButton`, `toggleLeft`, inline `button`) here.
 */
export function InspectorField({
  field,
  value,
  onChange,
  trackKey,
  fieldName,
  selectedEntity,
  currentTime,
  onUpdateEntity,
  entities = [],
  mediaAssets = [],
  tracks = [],
  disabled = false,
  onAction,
}) {
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
      case 'entity':
        // Reference types are never keyframed — the slot IS the full control.
        return (
          <EntityRefSlot
            value={currentVal || null}
            onChange={onChange}
            entities={entities}
            tracks={tracks}
            targetComponent={field.targetComponent}
            emptyLabel={field.emptyLabel}
          />
        );
      case 'asset':
        return (
          <AssetRefSlot
            value={currentVal || null}
            onChange={onChange}
            mediaAssets={mediaAssets}
            assetType={field.assetType}
            emptyLabel={field.emptyLabel}
          />
        );
      case 'number': {
        const numVal = typeof currentVal === 'number' ? currentVal : parseFloat(currentVal) || 0;
        const handleNum = (v) => onChange(field.step === 1 ? Math.round(v) : v);
        const dragNumber = (
          <DragNumber
            label={field.dragLabel || '#'}
            labelColor={field.labelColor}
            value={numVal}
            step={field.step || 0.1}
            min={field.min ?? -Infinity}
            max={field.max ?? Infinity}
            onChange={handleNum}
          />
        );
        // `slider: true` (only meaningful with a finite min and max) adds a
        // range slider beside the number, for bounded values like Opacity.
        if (field.slider && Number.isFinite(field.min) && Number.isFinite(field.max)) {
          return (
            <div className="inspector-number-slider">
              {dragNumber}
              <input
                type="range"
                className="inspector-range"
                min={field.min}
                max={field.max}
                step={field.step || 0.01}
                value={Math.min(field.max, Math.max(field.min, numVal))}
                disabled={disabled}
                aria-label={field.label || field.name}
                onChange={(e) => handleNum(parseFloat(e.target.value))}
              />
            </div>
          );
        }
        return dragNumber;
      }
      case 'color':
        return <ColorField value={currentVal} onChange={onChange} disabled={disabled} />;
      case 'boolean':
        return (
          <input
            type="checkbox"
            className="inspector-switch"
            checked={!!currentVal}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
        );
      case 'select':
        if (field.selectButton && Array.isArray(field.options)) {
          // Odin's EnumToggleButtons: a `select` as a strip of buttons, for the
          // two-or-three-option case where a dropdown hides the alternatives.
          return (
            <div className="inspector-button-strip" role="group">
              {field.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`inspector-strip-btn ${currentVal === opt ? 'is-active' : ''}`}
                  disabled={disabled}
                  aria-pressed={currentVal === opt}
                  onClick={() => onChange(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          );
        }
        return Array.isArray(field.options) ? (
          <select
            className="inspector-select"
            value={currentVal}
            disabled={disabled}
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
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      case 'font':
        // Searchable family picker (curated list + installed PC fonts), the
        // same control the Text Component uses. The stored value is just a
        // family-name string, so it flows through resolveScriptProps
        // unchanged and scripts receive e.g. "Noto Sans Khmer".
        return (
          <FontFamilyPicker
            value={currentVal || 'Inter'}
            onChange={onChange}
          />
        );
      case 'struct':
        // Struct fields render as a collapsible group — not keyframeable.
        return (
          <StructFieldGroup
            field={field}
            value={currentVal}
            onChange={onChange}
            entities={entities}
            mediaAssets={mediaAssets}
            tracks={tracks}
            onAction={onAction}
          />
        );
      case 'struct[]':
        // Struct array fields render using ArrayFieldEditor — not keyframeable.
        return (
          <StructArrayEditor
            field={field}
            value={currentVal}
            onChange={onChange}
            entities={entities}
            mediaAssets={mediaAssets}
            tracks={tracks}
            onAction={onAction}
          />
        );
      case 'array':
      case 'string[]':
      case 'number[]':
      case 'color[]':
      case 'boolean[]':
      case 'select[]':
      case 'asset[]':
      case 'entity[]':
      case 'font[]':
        return (
          <PrimitiveArrayEditor
            field={field}
            value={currentVal}
            onChange={onChange}
            entities={entities}
            mediaAssets={mediaAssets}
            tracks={tracks}
            disabled={disabled}
          />
        );
      case 'button':
        // An action button: it holds no value, it calls a method on the script
        // (see engine/scriptActions.js). `action` defaults to the field name.
        return (
          <button
            type="button"
            className={`inspector-action-btn ${field.variant || ''}`}
            disabled={disabled}
            onClick={() => onAction?.(field.action || field.name)}
            title={field.action || field.name}
          >
            {field.label || field.name}
          </button>
        );
      default:
        if (typeof field.type === 'string' && field.type.endsWith('[]')) {
          const hasObjects = Array.isArray(currentVal) && currentVal.some((it) => it != null && typeof it === 'object');
          if (hasObjects) {
            return (
              <StructArrayEditor
                field={field}
                value={currentVal}
                onChange={onChange}
                entities={entities}
                mediaAssets={mediaAssets}
                tracks={tracks}
                onAction={onAction}
              />
            );
          }
          return (
            <PrimitiveArrayEditor
              field={field}
              value={currentVal}
              onChange={onChange}
              entities={entities}
              mediaAssets={mediaAssets}
              tracks={tracks}
              disabled={disabled}
            />
          );
        }
        return (
          <input
            type="text"
            className="inspector-num-input"
            value={currentVal || ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        );
    }
  })();
 
  const control = field.button ? (
    <FieldWithAction button={field.button} disabled={disabled} onAction={onAction}>
      {fieldInput}
    </FieldWithAction>
  ) : fieldInput;
 
  // A disabled field (attribute, or its group's controller is off) keeps its
  // position and value but cannot be edited. The wrapper covers controls with
  // no native `disabled` (DragNumber, ref slots, pickers) uniformly.
  const body = disabled && field.type !== 'button'
    ? <div className="inspector-field-disabled">{control}</div>
    : control;
 
  // Only show keyframe button if keyframing props are provided
  // (exclude reference types, struct types, array types, font and action buttons — none are
  // keyframeable; a font family name can't be interpolated between keyframes,
  // and a button has no value at all)
  const isKeyframeable = field.type !== 'entity' && field.type !== 'asset'
    && field.type !== 'struct' && field.type !== 'struct[]'
    && field.type !== 'array' && !(typeof field.type === 'string' && field.type.endsWith('[]'))
    && field.type !== 'font' && field.type !== 'button';
  if (selectedEntity && trackKey && fieldName && isKeyframeable) {
    return (
      <div className="inspector-field-keyframed">
        {body}
        <button
          type="button"
          className={`keyframe-btn ${hasKeyframes ? 'has-keys' : ''} ${hasKeyframeAtCurrentTime ? 'at-current-time' : ''}`}
          onClick={handleKeyframeToggle}
          aria-pressed={hasKeyframeAtCurrentTime}
          aria-label={hasKeyframeAtCurrentTime ? 'Remove keyframe at current time' : 'Add keyframe at current time'}
          title={hasKeyframeAtCurrentTime ? 'Remove keyframe at current time' : 'Add keyframe at current time'}
        />
      </div>
    );
  }
 
  return body;
}
 
// ─── Layout ─────────────────────────────────────────────────────────────────
 
/**
 * One grouped section: a `box` / `foldout`, or `plain` for ungrouped fields.
 *
 * A section whose name is controlled (`controls: 'Name'` on a boolean member,
 * Odin's ToggleGroup) gets that boolean as a checkbox in its header and dims
 * its members when it is off — the group-switch reads as the group's switch,
 * so the boolean itself is not also drawn as a row inside the box.
 */
function InspectorSection({
  section,
  values,
  onFieldChange,
  trackKey,
  selectedEntity,
  currentTime,
  onUpdateEntity,
  entities,
  mediaAssets,
  tracks = [],
  onAction,
}) {
  const [open, setOpen] = useState(true);
 
  const isMember = (fieldName) => section.entries.some((entry) => (
    entry.kind === 'row'
      ? entry.fields.some((f) => f.name === fieldName)
      : entry.field?.name === fieldName
  ));
 
  // The switch stays in the header even when the controlling boolean lives
  // outside the group — otherwise the members would dim with nothing on screen
  // able to turn them back on. Only the boolean's own row is dropped, and only
  // when it is drawn here (its switch already stands in for it).
  const controllerName = section.controller?.name;
  const headerSwitch = section.controller
    ? { name: controllerName, label: section.controller.label }
    : null;
  const dropOwnRow = !!controllerName && isMember(controllerName);
  const groupEnabled = section.controller ? values?.[controllerName] !== false : true;
 
  const renderField = (field) => (
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
      entities={entities}
      mediaAssets={mediaAssets}
      tracks={tracks}
      disabled={!groupEnabled || !isFieldEnabled(field, values)}
      onAction={onAction}
    />
  );
 
  // Inline (HorizontalGroup) fields share one row, so each control carries its
  // own menu via a layout-neutral wrapper (display: contents).
  const renderInlineField = (field) => (
    <FieldContextRow
      key={field.name}
      className="inspector-field-ctx"
      field={field}
      value={values?.[field.name]}
      onChange={(v) => onFieldChange(field.name, v)}
      disabled={!groupEnabled || !isFieldEnabled(field, values)}
    >
      {renderField(field)}
    </FieldContextRow>
  );
 
  // Single-field rows: the whole row (label included) is the right-click target.
  const fieldRowProps = (field) => ({
    field,
    value: values?.[field.name],
    onChange: (v) => onFieldChange(field.name, v),
    disabled: !groupEnabled || !isFieldEnabled(field, values),
  });
 
  const renderEntry = (entry) => {
    if (entry.kind === 'title') {
      return <div key={entry.key} className="inspector-group-title">{entry.label}</div>;
    }
    if (entry.kind === 'space') {
      return <div key={entry.key} className="inspector-space" style={{ height: entry.size }} />;
    }
 
    // The controller boolean is drawn as the group's own checkbox.
    if (dropOwnRow && entry.kind === 'field' && entry.field.name === controllerName) {
      return null;
    }
    if (dropOwnRow && entry.kind === 'row') {
      const rest = entry.fields.filter((f) => f.name !== controllerName);
      if (rest.length === 0) return null;
      return (
        <div key={entry.key} className="inspector-row">
          <span className="row-label" title={entryLabel({ kind: 'row', fields: rest })}>{entryLabel({ kind: 'row', fields: rest })}</span>
          <div className="inspector-inline-group">{rest.map(renderInlineField)}</div>
        </div>
      );
    }
 
    if (entry.kind === 'row') {
      return (
        <div key={entry.key} className="inspector-row">
          <span className="row-label" title={entryLabel(entry)}>{entryLabel(entry)}</span>
          <div className="inspector-inline-group">{entry.fields.map(renderInlineField)}</div>
        </div>
      );
    }
 
    const { field } = entry;
    if (isFullWidthType(field.type)) {
      // Structs, struct lists, primitive arrays and action buttons own the whole row: they draw
      // their own heading (or are labelled by their own text).
      return (
        <FieldContextRow key={entry.key} className="inspector-row is-full-width" {...fieldRowProps(field)}>
          {renderField(field)}
        </FieldContextRow>
      );
    }
    if (field.toggleLeft && field.type === 'boolean') {
      // Odin's [ToggleLeft]: checkbox first, label after it, one row.
      return (
        <FieldContextRow key={entry.key} className="inspector-row is-toggle-left" {...fieldRowProps(field)}>
          {renderField(field)}
          <span className="row-label" title={field.label || field.name}>{field.label || field.name}</span>
        </FieldContextRow>
      );
    }
    return (
      <FieldContextRow key={entry.key} className="inspector-row" {...fieldRowProps(field)}>
        <span className="row-label" title={field.label || field.name}>{field.label || field.name}</span>
        {renderField(field)}
      </FieldContextRow>
    );
  };
 
  const body = section.entries.map(renderEntry);
 
  if (section.kind === 'plain') {
    return <>{body}</>;
  }
 
  const isFoldout = section.kind === 'foldout';
  return (
    <div className={`inspector-group ${isFoldout ? 'is-foldout' : 'is-box'}`}>
      <div className="inspector-group-header">
        {isFoldout ? (
          <button
            type="button"
            className="inspector-group-toggle"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronRight size={12} className={`inspector-group-chevron ${open ? 'is-open' : ''}`} />
            <span>{section.name}</span>
          </button>
        ) : (
          <span className="inspector-group-name">{section.name}</span>
        )}
        {headerSwitch && (
          <input
            type="checkbox"
            className="inspector-group-switch inspector-switch"
            checked={groupEnabled}
            title={headerSwitch.label}
            onChange={(e) => onFieldChange(headerSwitch.name, e.target.checked)}
          />
        )}
      </div>
      {(!isFoldout || open) && <div className="inspector-group-body">{body}</div>}
    </div>
  );
}
 
/**
 * Renders a full list of schema fields as `.inspector-row`s, with the
 * standard "no exposed props" hint when the schema is empty. Used for the
 * script-driven components (one type — ScriptComponent) whose fields come
 * from `extractScriptProps`, and for the built-in cards' static schemas.
 *
 * The field list is grouped by the fields' own attributes first (see
 * `buildInspectorLayout`): `tab` → tab strip (`box` / `foldout` groups inside a
 * tab) → rows, with `showIf` / `hideIf` deciding what exists at all and
 * `inline` collapsing runs of fields into one row.
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
 * nested in. Bare mode ignores attributes (it exists for hand-laid-out
 * rows) but still honours conditions.
 */
export function InspectorFieldList({
  fields,
  values,
  onFieldChange,
  emptyHint,
  bare = false,
  trackKey,
  selectedEntity,
  currentTime,
  onUpdateEntity,
  entities = [],
  mediaAssets = [],
  tracks = [],
  onAction,
}) {
  const layout = useMemo(() => buildInspectorLayout(fields, values), [fields, values]);
  const [activeTab, setActiveTab] = useState(0);
 
  if (bare) {
    // Hand-laid-out rows keep their own arrangement, but still respect the
    // conditions (a hidden field must not be drawn).
    return layout.visibleFields.map((field) => (
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
        entities={entities}
        mediaAssets={mediaAssets}
        tracks={tracks}
        disabled={!isFieldEnabled(field, values)}
        onAction={onAction}
      />
    ));
  }
 
  if (layout.isEmpty) {
    return emptyHint ? <p className="hint-text-sm">{emptyHint}</p> : null;
  }
 
  const tabIndex = Math.min(activeTab, layout.tabs.length - 1);
  const tab = layout.tabs[tabIndex];
 
  return (
    <div className="inspector-layout">
      {layout.tabs.length > 1 && (
        <div className="inspector-tabs" role="tablist">
          {layout.tabs.map((t, index) => (
            <button
              key={t.name || 'general'}
              type="button"
              role="tab"
              aria-selected={index === tabIndex}
              className={`inspector-tab ${index === tabIndex ? 'is-active' : ''}`}
              onClick={() => setActiveTab(index)}
            >
              {t.name || 'General'}
            </button>
          ))}
        </div>
      )}
      {tab.sections.map((section, index) => (
        <InspectorSection
          key={`${section.kind}:${section.name || index}`}
          section={section}
          values={values}
          onFieldChange={onFieldChange}
          trackKey={trackKey}
          selectedEntity={selectedEntity}
          currentTime={currentTime}
          onUpdateEntity={onUpdateEntity}
          entities={entities}
          mediaAssets={mediaAssets}
          tracks={tracks}
          onAction={onAction}
        />
      ))}
    </div>
  );
}
 
/**
 * Inspector / Dopesheet schema for the built-in TextRenderer. Presentation
 * (size, color) lives here; timed copy lives on a SubtitleTrack referenced
 * by `subtitleSourceId` (a ref slot, not a keyframed field).
 *
 * The attributes below are the built-in half of the attribute feature: the
 * same `title` / `box` / `inline` vocabulary script props use, applied to a
 * shipped component schema.
 */
export const TEXT_RENDERER_FIELDS = [
  { name: 'fontSize', type: 'number', label: 'Font Size', dragLabel: 'px', step: 1, min: 4, defaultVal: 36, title: 'Typography' },
  { name: 'fontColor', type: 'color', label: 'Color', defaultVal: '#ffffff' },
];
 
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
    label: 'Pivot',
    fields: [
      // Normalized pivot: 0 = center, -0.5 = left/top edge, +0.5 = right/bottom edge.
      // Rotation and scale both happen around this point. Matches Unity convention.
      { name: 'pivotX', type: 'number', dragLabel: 'X', labelColor: '#f87171', step: 0.01, min: -0.5, max: 0.5, defaultVal: 0 },
      { name: 'pivotY', type: 'number', dragLabel: 'Y', labelColor: '#4ade80', step: 0.01, min: -0.5, max: 0.5, defaultVal: 0 },
    ],
  },
  {
    label: 'Opacity',
    fields: [
      { name: 'opacity', type: 'number', slider: true, dragLabel: 'α', labelColor: '#a78bfa', step: 0.01, min: 0, max: 1, defaultVal: 1 },
    ],
  },
  {
    label: 'Speed',
    fields: [
      // Clip-level rate multiplier: media elements play at speed × their
      // own AudioSource/VideoRenderer.speed, and motion-kind scripts run at
      // localTime × speed unless a script sets ignoreParentSpeed (see
      // engine/renderPipeline.js). Editing it also resizes the timeline
      // clip (content amount duration × speed is preserved — faster = shorter
      // clip, slower = longer; see updateTransform in UnityInspector.jsx).
      // Missing on older saved Transforms reads as the 1 default here and in
      // the engine (?? 1 / fallback), so old projects behave exactly as
      // before — no migration needed.
      { name: 'speed', type: 'number', slider: true, dragLabel: '×', labelColor: '#22d3ee', step: 0.1, min: 0.1, max: 4, defaultVal: 1 },
    ],
  },
];
 