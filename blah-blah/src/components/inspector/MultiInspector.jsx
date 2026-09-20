import { useState, useMemo, memo } from 'react';
import { Layers, Key, Type, Square, Film, Volume2, FileCode } from 'lucide-react';
import { InspectorField, TRANSFORM_FIELD_GROUPS, TEXT_RENDERER_FIELDS } from './InspectorField';
import { InspectorCardHeader } from './InspectorCardHeader';
import { DragNumber } from '../shared/DragNumber';
import { extractScriptProps } from '../../engine/scriptRunner';
import { isScriptComponent } from '../../engine/ecs';
import {
  getSharedComponents,
  summarizeField,
  summarizeComponentField,
  buildSharedUpdates,
  buildSharedComponentUpdates,
} from '../../utils/multiEdit';
 
/**
 * Inspector shown when 2+ clips are selected.
 *
 * Shows only components that EVERY selected clip has. Editing a field writes
 * the same value to all selected clips in one batch (one undo step). Fields
 * whose values differ between clips show a "≠" mark next to the label and
 * display the first clip's value; the next edit unifies them.
 *
 * Keyframed fields get a keyframe at the current time on every clip (each at
 * its own local time). Auto Key follows the toggle, like the single Inspector.
 */
 
const MixedMark = () => (
  <span
    title="Values differ between the selected clips — editing sets them all to the same value"
    style={{ marginLeft: 4, color: '#f59e0b', fontWeight: 700 }}
  >
    ≠
  </span>
);
 
const FIELD_DEFAULT_ICON = {
  Transform: null,
  TextRenderer: <Type size={13} className="text-amber" />,
  ShapeRenderer: <Square size={13} className="text-cyan" />,
  VideoRenderer: <Film size={13} className="text-indigo" />,
  AudioSource: <Volume2 size={13} className="text-emerald" />,
};
 
const SHAPE_TYPES = [
  { value: 'rounded-rect', label: 'Rounded Rect' },
  { value: 'circle', label: 'Circle' },
  { value: 'rect', label: 'Rectangle' },
];
 
export const MultiInspector = memo(function MultiInspector({
  selectedEntities,
  scripts = [],
  tracks = [],
  entities = [],
  mediaAssets = [],
  onUpdateClips,
  currentTime = 0,
  autoKeyEnabled = false,
  setAutoKeyEnabled,
  onDeleteEntities,
}) {
  const [open, setOpen] = useState({});
  const isOpen = (key) => open[key] !== false;
  const toggle = (key) => setOpen((p) => ({ ...p, [key]: p[key] === false }));
 
  const shared = useMemo(() => getSharedComponents(selectedEntities), [selectedEntities]);
 
  const writeShared = (trackKey, patch) => {
    const list = buildSharedUpdates(selectedEntities, trackKey, patch, { currentTime, autoKeyEnabled });
    if (list.length > 0) onUpdateClips(list);
  };
  const writeComponent = (trackKey, patch) => {
    onUpdateClips(buildSharedComponentUpdates(selectedEntities, trackKey, patch));
  };
 
  // ── A keyframeable schema field (number / color / select / ...) ─────────
  // Reuses the single Inspector's InspectorField for the control itself, but
  // without the per-entity keyframe button (that button edits ONE entity).
  const renderSchemaField = (trackKey, field) => {
    const { value, mixed } = summarizeField(selectedEntities, trackKey, field.name, currentTime, field.defaultVal);
    return (
      <div key={field.name} className="inspector-row">
        <span className="row-label">
          {field.label || field.name}
          {mixed && <MixedMark />}
        </span>
        <InspectorField
          field={field}
          value={value}
          onChange={(v) => writeShared(trackKey, { [field.name]: v })}
          entities={entities}
          mediaAssets={mediaAssets}
        />
      </div>
    );
  };
 
  // ── Transform (grouped rows: Position X/Y, Scale X/Y, ...) ──────────────
  const renderTransform = () => (
    <div className="inspector-card-body">
      {TRANSFORM_FIELD_GROUPS.map((group) => {
        const anyMixed = group.fields.some(
          (f) => summarizeField(selectedEntities, 'Transform', f.name, currentTime, f.defaultVal).mixed
        );
        return (
          <div key={group.label} className="inspector-row">
            <span className="row-label">
              {group.label}
              {anyMixed && <MixedMark />}
            </span>
            {group.fields.length > 1 ? (
              <div className="drag-number-group">
                {group.fields.map((f) => {
                  const { value } = summarizeField(selectedEntities, 'Transform', f.name, currentTime, f.defaultVal);
                  return (
                    <InspectorField
                      key={f.name}
                      field={f}
                      value={value}
                      onChange={(v) => writeShared('Transform', { [f.name]: v })}
                    />
                  );
                })}
              </div>
            ) : (
              (() => {
                const f = group.fields[0];
                const { value } = summarizeField(selectedEntities, 'Transform', f.name, currentTime, f.defaultVal);
                return (
                  <InspectorField
                    field={f}
                    value={value}
                    onChange={(v) => writeShared('Transform', { [f.name]: v })}
                  />
                );
              })()
            )}
          </div>
        );
      })}
    </div>
  );
 
  // ── TextRenderer ────────────────────────────────────────────────────────
  const renderText = () => {
    const text = summarizeComponentField(selectedEntities, 'TextRenderer', 'text', '');
    return (
      <div className="inspector-card-body">
        <div className="inspector-row">
          <span className="row-label">
            Text
            {text.mixed && <MixedMark />}
          </span>
          <textarea
            className="inspector-textarea"
            rows={2}
            value={text.mixed ? '' : (text.value || '')}
            placeholder={text.mixed ? 'Mixed — type to set all' : ''}
            onChange={(e) => writeComponent('TextRenderer', { text: e.target.value })}
          />
        </div>
        {TEXT_RENDERER_FIELDS.map((f) => renderSchemaField('TextRenderer', f))}
      </div>
    );
  };
 
  // ── ShapeRenderer ───────────────────────────────────────────────────────
  const renderShape = () => {
    const type = summarizeComponentField(selectedEntities, 'ShapeRenderer', 'shapeType', 'rect');
    const width = summarizeComponentField(selectedEntities, 'ShapeRenderer', 'width', 140);
    const height = summarizeComponentField(selectedEntities, 'ShapeRenderer', 'height', 140);
    const radius = summarizeComponentField(selectedEntities, 'ShapeRenderer', 'borderRadius', 0);
    const fill = summarizeComponentField(selectedEntities, 'ShapeRenderer', 'color', '#ffffff');
    const stroke = summarizeComponentField(selectedEntities, 'ShapeRenderer', 'strokeColor', '#38bdf8');
    const strokeW = summarizeComponentField(selectedEntities, 'ShapeRenderer', 'strokeWidth', 0);
    const set = (patch) => writeComponent('ShapeRenderer', patch);
 
    return (
      <div className="inspector-card-body">
        <div className="inspector-row">
          <span className="row-label">Type{type.mixed && <MixedMark />}</span>
          <select
            className="inspector-select"
            value={type.value || 'rect'}
            onChange={(e) => set({ shapeType: e.target.value })}
          >
            {SHAPE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="inspector-row">
          <span className="row-label">Size{(width.mixed || height.mixed) && <MixedMark />}</span>
          <div className="drag-number-group">
            <DragNumber label="W" value={width.value ?? 140} step={1} min={1} onChange={(v) => set({ width: Math.round(v) })} />
            <DragNumber label="H" value={height.value ?? 140} step={1} min={1} onChange={(v) => set({ height: Math.round(v) })} />
          </div>
        </div>
        <div className="inspector-row">
          <span className="row-label">Fill Color{fill.mixed && <MixedMark />}</span>
          <input
            type="color"
            className="inspector-color-input"
            value={fill.value || '#ffffff'}
            onChange={(e) => set({ color: e.target.value })}
          />
        </div>
        <div className="inspector-row">
          <span className="row-label">Roundness{radius.mixed && <MixedMark />}</span>
          <DragNumber label="px" value={radius.value ?? 0} step={1} min={0} onChange={(v) => set({ borderRadius: Math.round(v) })} />
        </div>
        <div className="inspector-row">
          <span className="row-label">Stroke Color{stroke.mixed && <MixedMark />}</span>
          <input
            type="color"
            className="inspector-color-input"
            value={stroke.value || '#38bdf8'}
            onChange={(e) => set({ strokeColor: e.target.value })}
          />
        </div>
        <div className="inspector-row">
          <span className="row-label">Stroke W{strokeW.mixed && <MixedMark />}</span>
          <DragNumber label="px" value={strokeW.value ?? 0} step={0.5} min={0} onChange={(v) => set({ strokeWidth: v })} />
        </div>
      </div>
    );
  };
 
  // ── VideoRenderer / AudioSource (volume) ────────────────────────────────
  const renderMedia = (trackKey) => {
    const fallback = trackKey === 'AudioSource' ? 1 : 0;
    const vol = summarizeComponentField(selectedEntities, trackKey, 'volume', fallback);
    return (
      <div className="inspector-card-body">
        <div className="inspector-row">
          <span className="row-label">Volume{vol.mixed && <MixedMark />}</span>
          <DragNumber
            label="vol"
            value={parseFloat((vol.value ?? fallback).toFixed(2))}
            step={0.01}
            min={0}
            max={100}
            onChange={(v) => writeComponent(trackKey, { volume: v })}
          />
        </div>
      </div>
    );
  };
 
  // ── ScriptComponent (props from the script's own static props schema) ───
  const renderScript = (trackKey, comp) => {
    const scriptDef = scripts.find((s) => s.id === comp.scriptId);
    const fields = scriptDef ? extractScriptProps(scriptDef.code) : [];
    const enabled = summarizeComponentField(selectedEntities, trackKey, 'enabled', true);
    return (
      <div className="inspector-card-body">
        <div className="inspector-row">
          <span className="row-label">Enabled{enabled.mixed && <MixedMark />}</span>
          <input
            type="checkbox"
            checked={enabled.value !== false}
            onChange={(e) => writeComponent(trackKey, { enabled: e.target.checked })}
          />
        </div>
        {fields.length === 0 && <p className="hint-text-sm">This script exposes no props.</p>}
        {fields.map((field) => {
          const isStruct = field.type === 'struct' || field.type === 'struct[]';
          // Struct / struct[] values are whole objects — editing one struct
          // for many clips at once is ambiguous, so they stay per-clip.
          if (isStruct) return null;
          if (field.type === 'entity' || field.type === 'asset') {
            const { value, mixed } = summarizeField(selectedEntities, trackKey, field.name, currentTime, field.defaultVal);
            return (
              <div key={field.name} className="inspector-row">
                <span className="row-label">{field.label || field.name}{mixed && <MixedMark />}</span>
                <InspectorField
                  field={field}
                  value={value}
                  onChange={(v) => writeShared(trackKey, { [field.name]: v })}
                  entities={entities}
                  mediaAssets={mediaAssets}
                />
              </div>
            );
          }
          return renderSchemaField(trackKey, field);
        })}
      </div>
    );
  };
 
  const cardTitle = (trackKey, comp) => {
    if (trackKey === 'Transform') return 'Transform';
    if (trackKey === 'TextRenderer') return 'Text Component';
    if (trackKey === 'ShapeRenderer') return 'Shape Component';
    if (trackKey === 'VideoRenderer') return 'Video Media Settings';
    if (trackKey === 'AudioSource') return 'Audio Media Settings';
    if (isScriptComponent(comp)) return comp.scriptName || 'Script';
    return comp.type || trackKey;
  };
 
  const cardBody = (trackKey, comp) => {
    if (trackKey === 'Transform') return renderTransform();
    if (trackKey === 'TextRenderer') return renderText();
    if (trackKey === 'ShapeRenderer') return renderShape();
    if (trackKey === 'VideoRenderer' || trackKey === 'AudioSource') return renderMedia(trackKey);
    if (trackKey.startsWith('script:')) return renderScript(trackKey, comp);
    return null;
  };
 
  const trackLabel = (id) => tracks.find((t) => t.id === id)?.name || id;
  const sharedTrackId = selectedEntities.every((e) => (e.trackId || 'track-1') === (selectedEntities[0].trackId || 'track-1'))
    ? (selectedEntities[0].trackId || 'track-1')
    : '';
 
  return (
    <aside className="inspector-sidebar">
      <div className="inspector-header-box">
        <div className="inspector-header-field">
          <label className="field-label-sm">
            <Layers size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
            {selectedEntities.length} clips selected
          </label>
          <div className="hint-text-sm" style={{ marginTop: 2 }}>
            Showing components shared by all selected clips. Edits apply to every clip.
          </div>
        </div>
        <div className="inspector-header-field">
          <label className="field-label-sm">Timeline Track (Layer)</label>
          <select
            className="inspector-track-select"
            value={sharedTrackId}
            onChange={(e) => {
              if (!e.target.value) return;
              onUpdateClips(selectedEntities.map((en) => ({ id: en.id, updates: { trackId: e.target.value } })));
            }}
          >
            {!sharedTrackId && <option value="">— Mixed —</option>}
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>{trackLabel(t.id)}</option>
            ))}
          </select>
        </div>
      </div>
 
      <div className="inspector-scroll-area">
        <div className="inspector-auto-key-bar">
          <button
            className={`inspector-auto-key-btn${autoKeyEnabled ? ' active' : ''}`}
            onClick={() => setAutoKeyEnabled && setAutoKeyEnabled(!autoKeyEnabled)}
            title={autoKeyEnabled
              ? 'Auto Key: ON — edits create keyframes on every selected clip'
              : 'Auto Key: OFF — animated fields still get a keyframe at the current time'}
          >
            <Key size={13} />
            <span>Auto Key</span>
            <span className="auto-key-state">{autoKeyEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>
 
        {shared.map(({ trackKey, comp }) => (
          <div key={trackKey} className="inspector-card">
            <InspectorCardHeader
              icon={
                trackKey.startsWith('script:')
                  ? <FileCode size={13} className="text-emerald" />
                  : FIELD_DEFAULT_ICON[trackKey]
              }
              title={cardTitle(trackKey, comp)}
              isOpen={isOpen(trackKey)}
              onToggle={() => toggle(trackKey)}
            />
            {isOpen(trackKey) && cardBody(trackKey, comp)}
          </div>
        ))}
      </div>
 
      {onDeleteEntities && (
        <div className="inspector-footer">
          <button
            className="unity-btn unity-btn-danger-text full-width"
            onClick={() => onDeleteEntities(selectedEntities.map((e) => e.id))}
          >
            <span>Delete {selectedEntities.length} Clips</span>
          </button>
        </div>
      )}
    </aside>
  );
});