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
import { ChevronRight } from 'lucide-react';
import './inspector-attributes.css';

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
  const items = Array.isArray(value) ? value : [];
  const subfields = useMemo(() => subfieldSchema(field.fields), [field.fields]);

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
        renderItem={(item) => (
          <span className="struct-array-item-title">
            {item[Object.keys(field.fields || {})[0]] ?? '—'}
          </span>
        )}
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
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <input
              type="color"
              className="inspector-color-input"
              value={val || '#ffffff'}
              disabled={disabled}
              onChange={(e) => onValChange(e.target.value)}
            />
            <input
              type="text"
              className="inspector-num-input"
              value={val || '#ffffff'}
              disabled={disabled}
              style={{ width: 80 }}
              onChange={(e) => onValChange(e.target.value)}
            />
          </div>
        );
      case 'boolean':
        return (
          <input
            type="checkbox"
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
    <div className="primitive-array-editor" style={{ width: '100%' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary, #aaa)', marginBottom: 4 }}>
        {field.label || field.name}
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
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      case 'boolean':
        return (
          <input
            type="checkbox"
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
          className={`keyframe-btn ${hasKeyframes ? 'has-keys' : ''} ${hasKeyframeAtCurrentTime ? 'at-current-time' : ''}`}
          onClick={handleKeyframeToggle}
          title={hasKeyframeAtCurrentTime ? 'Remove keyframe at current time' : 'Add keyframe at current time'}
        />
      </div>
    );
  }

  return body;
}

// ─── Layout ──────────────────────────────────────────────────────────────────

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
          <span className="row-label">{entryLabel({ kind: 'row', fields: rest })}</span>
          <div className="inspector-inline-group">{rest.map(renderField)}</div>
        </div>
      );
    }

    if (entry.kind === 'row') {
      return (
        <div key={entry.key} className="inspector-row">
          <span className="row-label">{entryLabel(entry)}</span>
          <div className="inspector-inline-group">{entry.fields.map(renderField)}</div>
        </div>
      );
    }

    const { field } = entry;
    if (isFullWidthType(field.type)) {
      // Structs, struct lists, primitive arrays and action buttons own the whole row: they draw
      // their own heading (or are labelled by their own text).
      return (
        <div key={entry.key} className="inspector-row is-full-width">
          {renderField(field)}
        </div>
      );
    }
    if (field.toggleLeft && field.type === 'boolean') {
      // Odin's [ToggleLeft]: checkbox first, label after it, one row.
      return (
        <div key={entry.key} className="inspector-row is-toggle-left">
          {renderField(field)}
          <span className="row-label">{field.label || field.name}</span>
        </div>
      );
    }
    return (
      <div key={entry.key} className="inspector-row">
        <span className="row-label">{field.label || field.name}</span>
        {renderField(field)}
      </div>
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
            className="inspector-group-switch"
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
      { name: 'opacity', type: 'number', dragLabel: 'α', labelColor: '#a78bfa', step: 0.01, min: 0, max: 1, defaultVal: 1 },
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
      { name: 'speed', type: 'number', dragLabel: '×', labelColor: '#22d3ee', step: 0.1, min: 0.1, max: 4, defaultVal: 1 },
    ],
  },
];
