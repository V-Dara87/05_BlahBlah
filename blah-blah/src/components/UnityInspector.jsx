import { useState, memo, useMemo } from 'react';
import { 
  Sliders, 
  Plus, 
  Trash2, 
  FileCode, 
  ChevronDown, 
  ChevronRight, 
  Package, 
  Type, 
  Square, 
  Check,
  Volume2,
  AlertCircle,
  Sparkles,
  Boxes,
  GripVertical,
  Key,
  Clock,
  Search,
  FolderOpen,
  Folder,
  Film,
  Lock,
  Unlock,
} from 'lucide-react';
import { extractScriptProps, getScriptError, detectScriptKind, isScriptBundlePending } from '../engine/scriptRunner';
import { DragNumber } from './DragNumber';
import { InspectorFieldList, TRANSFORM_FIELD_GROUPS } from './inspector/InspectorField';
import { getFieldKeyframes, setKeyframe, evaluateField } from '../engine/keyframes';
import { isScriptComponent, createTransitionComponent } from '../engine/ecs';
import { readDragPayload, dragHasItemKind, ITEM_KIND_SCRIPT } from '../utils/dragData';
import { TransitionInspector } from './inspector/TransitionInspector';
import { TransitionPickerModal } from './TransitionPickerModal';

// Per-kind display metadata for script cards (icon + color + label). The
// kind comes from detectScriptKind at runtime — there is ONE component type
// (ScriptComponent) and the script's own code decides how it executes.
const SCRIPT_KIND_META = {
  react: { icon: Sparkles, className: 'text-cyan', label: 'React Component' },
  canvas: { icon: Boxes, className: 'text-violet', label: 'Canvas Component' },
  motion: { icon: FileCode, className: 'text-emerald', label: 'Motion Script' },
  shader: { icon: Sparkles, className: 'text-amber', label: 'GL Transition' },
};
const scriptKindMeta = (kind) => SCRIPT_KIND_META[kind] || SCRIPT_KIND_META.motion;
 
/**
 * P0 #3 — Unified Inspector field rendering.
 *
 * Transform and the script-driven components all render their fields
 * through the shared `InspectorFieldList` / `TRANSFORM_FIELD_GROUPS` in
 * `./inspector/InspectorField.jsx`, instead of each having its own
 * hand-written field switch. There is ONE script component type —
 * `ScriptComponent` — covering motion scripts, React components, and
 * Canvas components; each card shows the script's detected kind (see
 * detectScriptKind) as its icon and routes its props through the same
 * `script:<scriptId>` keyframe track. TextRenderer and ShapeRenderer keep
 * bespoke bodies for now — their fields (a shape-type select, paired W/H
 * drag-numbers, etc.) don't map cleanly onto the single-field-per-row
 * schema, and folding them in isn't required to close the roadmap item.
 *
 * Add Component lists every script once (tagged with its kind) — the
 * runtime dispatches each attached script by its detected contract, so a
 * script written as a React component, a Canvas component, or a motion
 * script always runs correctly no matter which list it was added from,
 * and a half-written script ('unknown') is never hidden while being
 * written.
 *
 * Bugfix (this pass) — two issues reported together:
 *  1. Only the Transform card could collapse/expand; every other card
 *     (React/Canvas/Script/Text/Shape/Media) had a header with no chevron
 *     and no click handler, so its body was always force-rendered. A tall
 *     always-open card (esp. Canvas/Script bodies with script errors +
 *     several fields) could visually run into the next card before the
 *     scroll area kicked in, reading as "overlapping". Fix: every card
 *     now goes through the same `<InspectorCardHeader>` with its own
 *     foldout key in `openFoldouts`, mirroring Transform's existing
 *     behavior instead of being a Transform-only special case.
 *  2. There was no way to reorder components at all — no drag handle, no
 *     drop logic anywhere in this file. Fix: a drag handle on every card
 *     header plus minimal native HTML5 drag-and-drop that reorders
 *     `selectedEntity.components` directly (Transform is excluded from
 *     drag/drop — it always stays pinned first, matching how Transform is
 *     already treated as the one non-removable, always-present component).
 */
function InspectorCardHeader({
  icon,
  title,
  isOpen,
  onToggle,
  actions,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragOver = false
}) {
  return (
    <div
      className={`inspector-card-header${isDragOver ? ' drag-over' : ''}`}
      onClick={onToggle}
      onDragOver={draggable ? onDragOver : undefined}
      onDrop={draggable ? onDrop : undefined}
    >
      <div className="card-title-group">
        {draggable && (
          <span
            className="card-drag-handle"
            draggable
            onClick={(e) => e.stopPropagation()}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <GripVertical size={12} />
          </span>
        )}
        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {icon}
        <span className="card-title-text">{title}</span>
      </div>
      {actions && (
        <div className="card-actions-group" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}
 
export const UnityInspector = memo(function UnityInspector({
  selectedEntity,
  entities = [],
  tracks = [],
  scripts = [],
  onUpdateEntity,
  onDeleteEntity,
  onOpenScriptEditor,
  onSaveAsPrefab,
  currentTime = 0,
  autoKeyEnabled = false,
  setAutoKeyEnabled,
  mediaAssets = [],
  isLocked = false,
  onToggleLock,
}) {
  const [openFoldouts, setOpenFoldouts] = useState({
    Transform: true,
    Scripts: true,
    Text: true,
    Shape: true,
    Media: true
  });
  const [showAddComponent, setShowAddComponent] = useState(false);
  const [componentSearch, setComponentSearch] = useState('');
  const [openCompCategories, setOpenCompCategories] = useState({ renderers: true, scripts: true });
  const [isScriptDragOver, setIsScriptDragOver] = useState(false);
  const [savedPrefab, setSavedPrefab] = useState(false);
  const [dragCompType, setDragCompType] = useState(null); // component `type` (or scriptId for scripts) currently being dragged
  const [dragOverCompType, setDragOverCompType] = useState(null);
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [pickerSlot, setPickerSlot] = useState('in');
  const [pickerCallback, setPickerCallback] = useState(null);
  const [pickerInitialParams, setPickerInitialParams] = useState(null);

  const eligibleParentEntities = useMemo(() => {
    if (!entities || !selectedEntity) return [];
    const isDescendant = (candidateId, ancestorId) => {
      const visited = new Set();
      let curr = entities.find((e) => e.id === candidateId);
      while (curr?.parentId) {
        if (curr.parentId === ancestorId) return true;
        if (visited.has(curr.parentId)) break;
        visited.add(curr.parentId);
        curr = entities.find((e) => e.id === curr.parentId);
      }
      return false;
    };

    const getDepth = (entity) => {
      let d = 0;
      const visited = new Set();
      let curr = entity;
      while (curr?.parentId) {
        if (visited.has(curr.parentId)) break;
        visited.add(curr.parentId);
        curr = entities.find((e) => e.id === curr.parentId);
        d++;
      }
      return d;
    };

    return entities
      .filter((e) => e.id !== selectedEntity.id && !isDescendant(e.id, selectedEntity.id))
      .map((e) => ({
        id: e.id,
        name: e.name,
        indent: '  '.repeat(getDepth(e)),
      }));
  }, [entities, selectedEntity]);

  if (!selectedEntity) {
    return (
      <aside className="inspector-sidebar empty">
        <div className="inspector-empty-msg">
          <Sliders size={32} className="empty-icon" />
          <h4>Inspector</h4>
          <p>Select any clip or GameObject on the timeline to configure its Transform, React Components, and JS Motion Scripts.</p>
        </div>
      </aside>
    );
  }
 
  const toggleFoldout = (name) => {
    setOpenFoldouts(prev => ({ ...prev, [name]: !prev[name] }));
  };

  // Local time within this entity's clip (seconds from clip start).
  const localTime = Math.max(0, currentTime - selectedEntity.startTime);
  const snappedLocalTime = Math.round(localTime * 30) / 30;

  /**
   * For a component's values object, replace any field that has keyframes
   * with the keyframe-evaluated value at the current local time.
   * This makes Inspector fields show the live interpolated value while
   * scrubbing, not the stale static stored value.
   */
  const resolveComponentValues = (trackKey, rawValues) => {
    if (!rawValues || !selectedEntity?.keyframes?.[trackKey]) return rawValues;
    const resolved = { ...rawValues };
    Object.keys(resolved).forEach((key) => {
      const val = evaluateField(selectedEntity, trackKey, key, localTime);
      if (val !== undefined) resolved[key] = val;
    });
    return resolved;
  };

  /**
   * Write a single field value. If the field already has keyframes (it is
   * animated), update/create a keyframe at the current time — writing to the
   * static prop would be silently overridden by the keyframe evaluator every
   * frame, so we must write to the keyframe store instead.
   * If autoKey is on (and the field has no keyframes yet), same: write a
   * keyframe. Returns the new keyframes object if a keyframe was written, or
   * null if the caller should fall back to writing the static prop.
   */
  const tryWriteKeyframe = (entitySnapshot, trackKey, fieldName, value) => {
    const kfs = getFieldKeyframes(entitySnapshot, trackKey, fieldName);
    if (kfs.length > 0 || autoKeyEnabled) {
      return setKeyframe(entitySnapshot, trackKey, fieldName, snappedLocalTime, value);
    }
    return null;
  };

  const transformComp = selectedEntity.components.find(c => c.type === 'Transform') || {
    x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1
  };

  const textComp = selectedEntity.components.find(c => c.type === 'TextRenderer');
  const shapeComp = selectedEntity.components.find(c => c.type === 'ShapeRenderer');
  const videoComp = selectedEntity.components.find(c => c.type === 'VideoRenderer');
  const audioComp = selectedEntity.components.find(c => c.type === 'AudioSource');
  const transitionComp = selectedEntity.components.find(c => c.type === 'TransitionComponent');
  const scriptComps = selectedEntity.components.filter(isScriptComponent);
 
  const updateTransform = (updates) => {
    // For each updated field: if it already has keyframes (or autoKey is on)
    // write a keyframe at the current time — the static prop is overridden by
    // the keyframe evaluator every frame anyway, so writing there is a no-op.
    // Fields with no keyframes and autoKey off get the normal static-prop write.
    let kfsSnapshot = selectedEntity.keyframes || {};
    let kfsChanged = false;
    const staticUpdates = {};
    // Transform.speed is a clip-level rate multiplier — it changes how long
    // the clip's source content takes to play, so the timeline clip length
    // must follow it (content amount duration × speed is preserved): a 2×
    // clip becomes half as long, a 0.5× clip twice as long. Only on the
    // static (non-keyframe) write — an animated/keyframed speed has no
    // single timeline length to derive, so it leaves duration alone.
    let durationUpdate = null;

    Object.keys(updates).forEach((fieldName) => {
      const tempEntity = { ...selectedEntity, keyframes: kfsSnapshot };
      const result = tryWriteKeyframe(tempEntity, 'Transform', fieldName, updates[fieldName]);
      if (result) {
        kfsSnapshot = result;
        kfsChanged = true;
      } else {
        staticUpdates[fieldName] = updates[fieldName];
        if (fieldName === 'speed') {
          const oldSpeed = Number(transformComp.speed ?? 1) || 1;
          const newSpeed = Number(updates[fieldName]) || 1;
          if (oldSpeed > 0 && newSpeed > 0 && oldSpeed !== newSpeed) {
            durationUpdate = Math.max(0.2, (selectedEntity.duration || 0) * (oldSpeed / newSpeed));
          }
        }
      }
    });

    const batchUpdate = {};
    if (kfsChanged) batchUpdate.keyframes = kfsSnapshot;
    if (durationUpdate !== null) batchUpdate.duration = durationUpdate;
    if (Object.keys(staticUpdates).length > 0) {
      const updatedComponents = selectedEntity.components.map((c) =>
        c.type === 'Transform' ? { ...c, ...staticUpdates } : c
      );
      if (!selectedEntity.components.some((c) => c.type === 'Transform')) {
        updatedComponents.unshift({ type: 'Transform', ...staticUpdates });
      }
      batchUpdate.components = updatedComponents;
    }
    if (Object.keys(batchUpdate).length > 0) {
      onUpdateEntity(selectedEntity.id, batchUpdate);
    }
  };
 
  const updateComponent = (compType, updates) => {
    // Create the component if the entity doesn't have one yet (legacy
    // entities — e.g. a schema-0 `type: 'video'` clip with no
    // VideoRenderer component — would otherwise swallow the update: the
    // map finds no match and the volume change goes nowhere). Newer
    // entities just get the in-place merge as before.
    const exists = selectedEntity.components.some(c => c.type === compType);
    const updatedComponents = exists
      ? selectedEntity.components.map(c => c.type === compType ? { ...c, ...updates } : c)
      : [...selectedEntity.components, { type: compType, ...updates }];
    onUpdateEntity(selectedEntity.id, { components: updatedComponents });
  };
 
  const updateScriptProps = (scriptId, propKey, propVal) => {
    const trackKey = `script:${scriptId}`;
    const newKfs = tryWriteKeyframe(selectedEntity, trackKey, propKey, propVal);
    if (newKfs) {
      // Animated field or autoKey: write keyframe only — the renderer will
      // evaluate it and pass the correct value to the script at render time.
      onUpdateEntity(selectedEntity.id, { keyframes: newKfs });
    } else {
      // Non-animated field: write to static prop as before.
      const updatedComponents = selectedEntity.components.map((c) => {
        if (isScriptComponent(c) && c.scriptId === scriptId) {
          return { ...c, props: { ...(c.props || {}), [propKey]: propVal } };
        }
        return c;
      });
      onUpdateEntity(selectedEntity.id, { components: updatedComponents });
    }
  };

  const updateScriptComp = (scriptId, updates) => {
    const updatedComponents = selectedEntity.components.map((c) =>
      isScriptComponent(c) && c.scriptId === scriptId ? { ...c, ...updates } : c
    );
    onUpdateEntity(selectedEntity.id, { components: updatedComponents });
  };
 
  // Components after the pinned Transform can be freely reordered. Each
  // draggable card is keyed by its component `type`, except ScriptComponent
  // (there can be several) which is keyed by `script:<scriptId>` instead so
  // multiple motion scripts on the same entity can be reordered relative to
  // each other, not just as a block.
  const dragKeyFor = (c) => (isScriptComponent(c) ? `script:${c.scriptId}` : c.type);
 
  const reorderComponents = (draggedKey, targetKey) => {
    if (!draggedKey || !targetKey || draggedKey === targetKey) return;
    const comps = [...selectedEntity.components];
    const fromIdx = comps.findIndex(c => dragKeyFor(c) === draggedKey);
    const toIdx = comps.findIndex(c => dragKeyFor(c) === targetKey);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = comps.splice(fromIdx, 1);
    comps.splice(toIdx, 0, moved);
    onUpdateEntity(selectedEntity.id, { components: comps });
  };
 
  const handleCardDragStart = (key) => (e) => {
    setDragCompType(key);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleCardDragOver = (key) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverCompType !== key) setDragOverCompType(key);
  };
  const handleCardDrop = (key) => (e) => {
    e.preventDefault();
    reorderComponents(dragCompType, key);
    setDragCompType(null);
    setDragOverCompType(null);
  };
  const handleCardDragEnd = () => {
    setDragCompType(null);
    setDragOverCompType(null);
  };
 
  const removeComponent = (compType, scriptId = null) => {
    const updatedComponents = selectedEntity.components.filter(c => {
      if ((compType === 'ScriptComponent' || compType === 'MonoBehaviour') && scriptId) {
        return !(isScriptComponent(c) && c.scriptId === scriptId);
      }
      return c.type !== compType;
    });
    onUpdateEntity(selectedEntity.id, { components: updatedComponents });
  };
 
  const handleAddComponent = (type, scriptId = null) => {
    setShowAddComponent(false);
    let newComp;
 
    if (type === 'TextRenderer') {
      newComp = { type: 'TextRenderer', text: 'New Text', fontSize: 36, fontColor: '#ffffff', fontFamily: 'Inter' };
    } else if (type === 'ShapeRenderer') {
      newComp = { type: 'ShapeRenderer', shapeType: 'rect', width: 140, height: 140, color: '#ffffff', strokeColor: '#38bdf8', strokeWidth: 0, borderRadius: 0 };
    } else if (type === 'VideoRenderer') {
      // A bare VideoRenderer (no src) is inert until a media source is
      // assigned — harmless, and matches the existing media-settings card.
      newComp = { type: 'VideoRenderer', src: '', volume: 0, speed: 1, mediaOffset: 0 };
    } else if (type === 'AudioSource') {
      newComp = { type: 'AudioSource', src: '', volume: 1, speed: 1, mediaOffset: 0 };
    } else if (type === 'TransitionComponent') {
      newComp = createTransitionComponent();
    } else if (type === 'ScriptComponent' && scriptId) {
      // ONE script component type — the runtime dispatches per the
      // script's detected kind (motion / react / canvas).
      const scriptDef = scripts.find(s => s.id === scriptId);
      if (scriptDef) {
        const fields = extractScriptProps(scriptDef.code);
        const initialProps = {};
        fields.forEach(f => { initialProps[f.name] = f.defaultVal; });
        newComp = { type: 'ScriptComponent', scriptId: scriptDef.id, scriptName: scriptDef.name, enabled: true, props: initialProps };
      }
    }
 
    if (newComp) {
      onUpdateEntity(selectedEntity.id, { components: [...selectedEntity.components, newComp] });
    }
  };

  // Attach a script by id (Add Component click or a Project-panel script
  // card dropped onto the Inspector).
  const handleAttachScript = (scriptId) => {
    if (scriptId) handleAddComponent('ScriptComponent', scriptId);
  };

  // HTML5 drop zone: a script card dragged from the Project panel (scripts/
  // or shared/) lands on the Inspector and attaches to the selected clip.
  const handleInspectorDragOver = (e) => {
    if (!selectedEntity || !dragHasItemKind(e.dataTransfer, ITEM_KIND_SCRIPT)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isScriptDragOver) setIsScriptDragOver(true);
  };

  const handleInspectorDrop = (e) => {
    if (!selectedEntity) return;
    const payload = readDragPayload(e.dataTransfer);
    if (!payload || payload.itemType !== 'script' || !payload.itemData?.id) return;
    e.preventDefault();
    setIsScriptDragOver(false);
    handleAttachScript(payload.itemData.id);
  };
 
  const handleSavePrefabClick = () => {
    onSaveAsPrefab(selectedEntity);
    setSavedPrefab(true);
    setTimeout(() => setSavedPrefab(false), 2000);
  };
 
  // ── Add Component catalog ───────────────────────────────────────────────
  // Organized into collapsible category folders (Renderers / Scripts with
  // per-kind subfolders Motion / React / Canvas), filtered live by the
  // search box at the top of the popover. Scripts attach as the ONE
  // ScriptComponent type and the runtime dispatches by detected kind, so a
  // half-written script ('unknown') is never hidden while being written.
  const allScripts = scripts.map(s => ({ ...s, kind: detectScriptKind(s.code) }));
  const scriptKindLabel = (kind) => (SCRIPT_KIND_META[kind] || SCRIPT_KIND_META.motion).label;

  const searchTerm = componentSearch.trim().toLowerCase();
  const matchesSearch = (name) => !searchTerm || name.toLowerCase().includes(searchTerm);

  const rendererItems = [
    { type: 'TextRenderer', icon: <Type size={12} className="text-amber" />, label: 'Text Component', present: !!textComp },
    { type: 'ShapeRenderer', icon: <Square size={12} className="text-cyan" />, label: 'Shape Component', present: !!shapeComp },
    { type: 'VideoRenderer', icon: <Film size={12} className="text-indigo" />, label: 'Video Component', present: !!videoComp },
    { type: 'AudioSource', icon: <Volume2 size={12} className="text-emerald" />, label: 'Audio Component', present: !!audioComp },
    { type: 'TransitionComponent', icon: <Sparkles size={12} className="text-amber" />, label: 'GL Transition', present: !!transitionComp },
  ].filter((it) => matchesSearch(it.label) || matchesSearch(it.type));

  const scriptKinds = ['motion', 'react', 'canvas', 'shader'];
  const scriptsByKind = (kind) => allScripts.filter((s) => s.kind === kind && matchesSearch(s.name));

  const toggleCompCategory = (name) => {
    setOpenCompCategories(prev => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <aside
      className={`inspector-sidebar${isScriptDragOver ? ' script-drop-zone' : ''}`}
      onDragOver={handleInspectorDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsScriptDragOver(false);
      }}
      onDrop={handleInspectorDrop}
    >
      {/* GameObject Name & Track */}
      <div className="inspector-header-box">
        <div className="inspector-header-field">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
            <label className="field-label-sm">GameObject Name</label>
            {onToggleLock && (
              <button
                type="button"
                className={`inspector-lock-btn${isLocked ? ' locked' : ''}`}
                onClick={onToggleLock}
                title={isLocked ? 'Inspector Locked: stays pinned to this entity' : 'Lock Inspector: pin this entity'}
              >
                {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
                <span>{isLocked ? 'Locked' : 'Lock'}</span>
              </button>
            )}
          </div>
          <input
            type="text"
            className="inspector-name-input"
            value={selectedEntity.name}
            onChange={(e) => onUpdateEntity(selectedEntity.id, { name: e.target.value })}
          />
        </div>

        <div className="inspector-header-field">
          <label className="field-label-sm">Timeline Track (Layer)</label>
          <select
            className="inspector-track-select"
            value={selectedEntity.trackId || 'track-1'}
            onChange={(e) => onUpdateEntity(selectedEntity.id, { trackId: e.target.value })}
          >
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div className="inspector-header-field">
          <label className="field-label-sm">Parent (Hierarchy)</label>
          <select
            className="inspector-track-select"
            value={selectedEntity.parentId || ''}
            onChange={(e) => onUpdateEntity(selectedEntity.id, { parentId: e.target.value || null })}
          >
            <option value="">None (Root)</option>
            {eligibleParentEntities.map((ent) => (
              <option key={ent.id} value={ent.id}>
                {ent.indent ? `${ent.indent}└─ ` : ''}{ent.name}
              </option>
            ))}
          </select>
        </div>

      </div>
 
      {/* Component Stack */}
      <div className="inspector-scroll-area">
 
        {/* ========== AUTO KEY TOGGLE ========== */}
        <div className="inspector-auto-key-bar">
          <button
            className={`inspector-auto-key-btn${autoKeyEnabled ? ' active' : ''}`}
            onClick={() => setAutoKeyEnabled && setAutoKeyEnabled(!autoKeyEnabled)}
            title={autoKeyEnabled ? 'Auto Key: ON — property changes create keyframes automatically' : 'Auto Key: OFF — click to enable automatic keyframing'}
          >
            <Key size={13} />
            <span>Auto Key</span>
            <span className="auto-key-state">{autoKeyEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>
 
        {/* ========== TRANSFORM ========== */}
        {/* Transform is pinned first and not draggable/reorderable -- it's
            always present (synthesized above if missing), so reordering it
            relative to other components isn't meaningful. */}
        <div className="inspector-card">
          <InspectorCardHeader
            title="Transform"
            isOpen={openFoldouts.Transform}
            onToggle={() => toggleFoldout('Transform')}
          />
 
          {openFoldouts.Transform && (
            <div className="inspector-card-body">
              {TRANSFORM_FIELD_GROUPS.map((group) => (
                <div key={group.label} className="inspector-row">
                  <span className="row-label">{group.label}</span>
                  {group.fields.length > 1 ? (
                    <div className="drag-number-group">
                      <InspectorFieldList
                        fields={group.fields}
                        values={resolveComponentValues('Transform', transformComp)}
                        onFieldChange={(name, v) => updateTransform({ [name]: v })}
                        bare
                        trackKey="Transform"
                        selectedEntity={selectedEntity}
                        currentTime={currentTime}
                        onUpdateEntity={onUpdateEntity}
                      />
                    </div>
                  ) : (
                    <InspectorFieldList
                      fields={group.fields}
                      values={resolveComponentValues('Transform', transformComp)}
                      onFieldChange={(name, v) => updateTransform({ [name]: v })}
                      trackKey="Transform"
                      selectedEntity={selectedEntity}
                      currentTime={currentTime}
                      onUpdateEntity={onUpdateEntity}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
 
        {/* ========== TEXT RENDERER ========== */}
        {textComp && (
          <div className="inspector-card">
            <InspectorCardHeader
              icon={<Type size={13} className="text-amber" />}
              title="Text Component"
              isOpen={openFoldouts.Text}
              onToggle={() => toggleFoldout('Text')}
              draggable
              isDragOver={dragOverCompType === 'TextRenderer'}
              onDragStart={handleCardDragStart('TextRenderer')}
              onDragOver={handleCardDragOver('TextRenderer')}
              onDrop={handleCardDrop('TextRenderer')}
              onDragEnd={handleCardDragEnd}
              actions={
                <button className="del-btn-sm" onClick={() => removeComponent('TextRenderer')}>
                  <Trash2 size={11} />
                </button>
              }
            />
 
            {openFoldouts.Text && (
              <div className="inspector-card-body">
                <textarea
                  className="inspector-textarea"
                  rows={2}
                  value={textComp.text || ''}
                  onChange={(e) => updateComponent('TextRenderer', { text: e.target.value })}
                />
 
                <div className="inspector-row">
                  <span className="row-label">Font Size</span>
                  <DragNumber
                    label="px"
                    value={textComp.fontSize ?? 32}
                    step={1}
                    min={4}
                    onChange={(v) => updateComponent('TextRenderer', { fontSize: Math.round(v) })}
                  />
                </div>
 
                <div className="inspector-row">
                  <span className="row-label">Color</span>
                  <input
                    type="color"
                    className="inspector-color-input"
                    value={textComp.fontColor || '#ffffff'}
                    onChange={(e) => updateComponent('TextRenderer', { fontColor: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>
        )}
 
        {/* ========== SHAPE RENDERER ========== */}
        {shapeComp && (
          <div className="inspector-card">
            <InspectorCardHeader
              icon={<Square size={13} className="text-cyan" />}
              title="Shape Component"
              isOpen={openFoldouts.Shape}
              onToggle={() => toggleFoldout('Shape')}
              draggable
              isDragOver={dragOverCompType === 'ShapeRenderer'}
              onDragStart={handleCardDragStart('ShapeRenderer')}
              onDragOver={handleCardDragOver('ShapeRenderer')}
              onDrop={handleCardDrop('ShapeRenderer')}
              onDragEnd={handleCardDragEnd}
              actions={
                <button className="del-btn-sm" onClick={() => removeComponent('ShapeRenderer')}>
                  <Trash2 size={11} />
                </button>
              }
            />
 
            {openFoldouts.Shape && (
              <div className="inspector-card-body">
                <div className="inspector-row">
                  <span className="row-label">Type</span>
                  <select
                    className="inspector-select"
                    value={shapeComp.shapeType || 'rect'}
                    onChange={(e) => updateComponent('ShapeRenderer', { shapeType: e.target.value })}
                  >
                    <option value="rounded-rect">Rounded Rect</option>
                    <option value="circle">Circle</option>
                    <option value="rect">Rectangle</option>
                  </select>
                </div>
 
                <div className="inspector-row">
                  <span className="row-label">Size</span>
                  <div className="drag-number-group">
                    <DragNumber
                      label="W"
                      value={shapeComp.width ?? 140}
                      step={1}
                      min={1}
                      onChange={(v) => updateComponent('ShapeRenderer', { width: Math.round(v) })}
                    />
                    <DragNumber
                      label="H"
                      value={shapeComp.height ?? 140}
                      step={1}
                      min={1}
                      onChange={(v) => updateComponent('ShapeRenderer', { height: Math.round(v) })}
                    />
                  </div>
                </div>
 
                <div className="inspector-row">
                  <span className="row-label">Fill Color</span>
                  <input
                    type="color"
                    className="inspector-color-input"
                    value={shapeComp.color || '#ffffff'}
                    onChange={(e) => updateComponent('ShapeRenderer', { color: e.target.value })}
                  />
                </div>
 
                {shapeComp.shapeType !== 'circle' && (
                  <div className="inspector-row">
                    <span className="row-label">Roundness</span>
                    <DragNumber
                      label="px"
                      value={shapeComp.borderRadius ?? 0}
                      step={1}
                      min={0}
                      max={Math.min(shapeComp.width ?? 140, shapeComp.height ?? 140) / 2}
                      onChange={(v) => updateComponent('ShapeRenderer', { borderRadius: Math.round(v) })}
                    />
                  </div>
                )}
 
                <div className="inspector-row">
                  <span className="row-label">Stroke Color</span>
                  <input
                    type="color"
                    className="inspector-color-input"
                    value={shapeComp.strokeColor || '#38bdf8'}
                    onChange={(e) => updateComponent('ShapeRenderer', { strokeColor: e.target.value })}
                  />
                </div>
 
                <div className="inspector-row">
                  <span className="row-label">Stroke W</span>
                  <DragNumber
                    label="px"
                    value={shapeComp.strokeWidth ?? 0}
                    step={0.5}
                    min={0}
                    onChange={(v) => updateComponent('ShapeRenderer', { strokeWidth: v })}
                  />
                </div>
              </div>
            )}
          </div>
        )}
 
        {/* ========== MEDIA SETTINGS (VideoRenderer / AudioSource volume) ========== */}
        {videoComp && (
          <div className="inspector-card">
            <InspectorCardHeader
              icon={<Volume2 size={13} className="text-emerald" />}
              title={audioComp ? 'Video Media Settings' : 'Media Settings'}
              isOpen={openFoldouts.VideoMedia !== undefined ? openFoldouts.VideoMedia : openFoldouts.Media}
              onToggle={() => toggleFoldout(audioComp ? 'VideoMedia' : 'Media')}
              draggable
              isDragOver={dragOverCompType === 'VideoRenderer'}
              onDragStart={handleCardDragStart('VideoRenderer')}
              onDragOver={handleCardDragOver('VideoRenderer')}
              onDrop={handleCardDrop('VideoRenderer')}
              onDragEnd={handleCardDragEnd}
            />
            {(openFoldouts.VideoMedia !== undefined ? openFoldouts.VideoMedia : openFoldouts.Media) && (
              <div className="inspector-card-body">
                <div className="inspector-row">
                  <span className="row-label">Volume</span>
                  <DragNumber
                    label="vol"
                    value={parseFloat((videoComp.volume ?? 0).toFixed(2))}
                    step={0.01}
                    min={0}
                    max={100}
                    onChange={(v) => {
                      updateComponent('VideoRenderer', { volume: v });
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {audioComp && (
          <div className="inspector-card">
            <InspectorCardHeader
              icon={<Volume2 size={13} className="text-emerald" />}
              title={videoComp ? 'Audio Media Settings' : 'Media Settings'}
              isOpen={openFoldouts.AudioMedia !== undefined ? openFoldouts.AudioMedia : openFoldouts.Media}
              onToggle={() => toggleFoldout(videoComp ? 'AudioMedia' : 'Media')}
              draggable
              isDragOver={dragOverCompType === 'AudioSource'}
              onDragStart={handleCardDragStart('AudioSource')}
              onDragOver={handleCardDragOver('AudioSource')}
              onDrop={handleCardDrop('AudioSource')}
              onDragEnd={handleCardDragEnd}
            />
            {(openFoldouts.AudioMedia !== undefined ? openFoldouts.AudioMedia : openFoldouts.Media) && (
              <div className="inspector-card-body">
                <div className="inspector-row">
                  <span className="row-label">Volume</span>
                  <DragNumber
                    label="vol"
                    value={parseFloat((audioComp.volume ?? 1).toFixed(2))}
                    step={0.01}
                    min={0}
                    max={100}
                    onChange={(v) => {
                      updateComponent('AudioSource', { volume: v });
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
 
        {/* ========== GL TRANSITION COMPONENT ========== */}
        {transitionComp && (
          <div className="inspector-card">
            <InspectorCardHeader
              icon={<Sparkles size={13} className="text-amber" />}
              title="GL Transition"
              isOpen={openFoldouts.Transition !== false}
              onToggle={() => toggleFoldout('Transition')}
              draggable
              isDragOver={dragOverCompType === 'TransitionComponent'}
              onDragStart={handleCardDragStart('TransitionComponent')}
              onDragOver={handleCardDragOver('TransitionComponent')}
              onDrop={handleCardDrop('TransitionComponent')}
              onDragEnd={handleCardDragEnd}
              actions={
                <button className="del-btn-sm" onClick={() => removeComponent('TransitionComponent')}>
                  <Trash2 size={11} />
                </button>
              }
            />
            {openFoldouts.Transition !== false && (
              <TransitionInspector
                component={transitionComp}
                onChange={(updates) => updateComponent('TransitionComponent', updates)}
                onRemove={() => removeComponent('TransitionComponent')}
                onOpenPicker={(slot, onApply, currentParams) => {
                  setPickerSlot(slot);
                  setPickerCallback(() => onApply);
                  setPickerInitialParams(currentParams);
                  setShowPickerModal(true);
                }}
              />
            )}
          </div>
        )}

        {/* ========== SCRIPTS (motion / React / Canvas — one component type) ========== */}
        {scriptComps.map((scriptComp) => {
          const scriptDef = scripts.find(s => s.id === scriptComp.scriptId);
          const kind = scriptDef ? detectScriptKind(scriptDef.code) : 'unknown';
          const Meta = scriptKindMeta(kind);
          const fields = scriptDef ? extractScriptProps(scriptDef.code) : [];
          const scriptError = scriptDef ? getScriptError(scriptDef.code) : null;
          const bundlePending = scriptDef ? isScriptBundlePending(scriptDef.code) : false;
          const foldoutKey = `Script:${scriptComp.scriptId}`;
          const dragKey = `script:${scriptComp.scriptId}`;
          // Per-script foldout state defaults to open until the user
          // collapses it, same as every other card.
          const isOpen = openFoldouts[foldoutKey] !== false;
 
          return (
            <div key={scriptComp.scriptId} className="inspector-card script-highlight">
              <InspectorCardHeader
                icon={<Meta.icon size={13} className={Meta.className} />}
                title={scriptComp.scriptName || Meta.label}
                isOpen={isOpen}
                onToggle={() => toggleFoldout(foldoutKey)}
                draggable
                isDragOver={dragOverCompType === dragKey}
                onDragStart={handleCardDragStart(dragKey)}
                onDragOver={handleCardDragOver(dragKey)}
                onDrop={handleCardDrop(dragKey)}
                onDragEnd={handleCardDragEnd}
                actions={
                  <>
                    <button className="edit-cs-btn" onClick={() => scriptDef && onOpenScriptEditor(scriptDef)}>
                      Edit JS
                    </button>
                    <button className="del-btn-sm" onClick={() => removeComponent('ScriptComponent', scriptComp.scriptId)}>
                      <Trash2 size={11} />
                    </button>
                  </>
                }
              />
 
              {isOpen && (
                <div className="inspector-card-body">
                  {scriptError && (
                    <div className="script-error-badge">
                      <AlertCircle size={12} />
                      <span>{scriptError}</span>
                    </div>
                  )}
                  {!scriptError && bundlePending && (
                    <div className="script-pending-badge">
                      <Clock size={12} />
                      <span>Resolving imports…</span>
                    </div>
                  )}

                  <div className="inspector-row">
                    <span className="row-label">Enabled</span>
                    <input
                      type="checkbox"
                      checked={scriptComp.enabled !== false}
                      onChange={(e) => updateScriptComp(scriptComp.scriptId, { enabled: e.target.checked })}
                    />
                  </div>

                  {/* Motion-kind scripts follow the Transform's Speed
                      (clip-level rate) by default. ignoreParentSpeed is the
                      per-script opt-out: when checked, this script's
                      localTime stays on raw timeline time while media and
                      sibling scripts run sped up. A ScriptComponent-level
                      field (like Enabled), NOT a script prop — saved with
                      the component, no migration needed (absent = false).
                      Only meaningful for motion kind; react/canvas kinds are
                      visual outputs driven by the caller and unaffected. */}
                  {kind === 'motion' && (
                    <div className="inspector-row">
                      <span className="row-label">Ignore Parent Speed</span>
                      <input
                        type="checkbox"
                        checked={scriptComp.ignoreParentSpeed === true}
                        onChange={(e) => updateScriptComp(scriptComp.scriptId, { ignoreParentSpeed: e.target.checked })}
                      />
                    </div>
                  )}

                  <InspectorFieldList
                    fields={fields}
                    values={resolveComponentValues(`script:${scriptComp.scriptId}`, scriptComp.props)}
                    onFieldChange={(name, v) => updateScriptProps(scriptComp.scriptId, name, v)}
                    emptyHint={<>Expose props with <code>static props = &#123; ... &#125;</code></>}
                    trackKey={`script:${scriptComp.scriptId}`}
                    selectedEntity={selectedEntity}
                    currentTime={currentTime}
                    onUpdateEntity={onUpdateEntity}
                    entities={entities}
                    mediaAssets={mediaAssets}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
 
      {/* Footer Actions */}
      <div className="inspector-footer">
        <div className="add-comp-wrapper">
          <button
            className="unity-btn unity-btn-secondary full-width"
            onClick={() => setShowAddComponent(!showAddComponent)}
          >
            <Plus size={13} />
            <span>Add Component</span>
          </button>
 
          {showAddComponent && (
            <div className="comp-dropdown-popover add-component-popover">
              {/* Live search across built-in components + scripts */}
              <div className="search-bar-sm add-comp-search">
                <Search size={11} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search components…"
                  value={componentSearch}
                  onChange={(e) => setComponentSearch(e.target.value)}
                  autoFocus
                />
                {componentSearch && (
                  <button
                    className="clear-search-btn"
                    onClick={() => setComponentSearch('')}
                    title="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="add-comp-scroll">
                {/* 📁 Renderers — built-in visual components */}
                <div className="comp-category">
                  <button
                    className="comp-category-header"
                    onClick={() => toggleCompCategory('renderers')}
                  >
                    {openCompCategories.renderers ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {openCompCategories.renderers ? <FolderOpen size={12} className="text-cyan" /> : <Folder size={12} className="text-cyan" />}
                    <span>Renderers</span>
                  </button>
                  {openCompCategories.renderers && (
                    <div className="comp-category-items">
                      {rendererItems.map((item) => (
                        <button
                          key={item.type}
                          className="popover-item"
                          onClick={() => handleAddComponent(item.type)}
                          title={item.present ? 'Already attached to this clip' : `Add ${item.label}`}
                          disabled={item.present}
                        >
                          {item.icon}
                          <span>{item.label}</span>
                          {item.present && <span className="popover-kind-tag">added</span>}
                        </button>
                      ))}
                      {rendererItems.length === 0 && (
                        <div className="popover-empty-hint">No renderers match your search.</div>
                      )}
                    </div>
                  )}
                </div>

                {/* 📁 Scripts — grouped by kind (Motion / React / Canvas) */}
                <div className="comp-category">
                  <button
                    className="comp-category-header"
                    onClick={() => toggleCompCategory('scripts')}
                  >
                    {openCompCategories.scripts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {openCompCategories.scripts ? <FolderOpen size={12} className="text-emerald" /> : <Folder size={12} className="text-emerald" />}
                    <span>Scripts</span>
                  </button>
                  {openCompCategories.scripts && (
                    <div className="comp-category-items">
                      {allScripts.length === 0 && !searchTerm && (
                        <div className="popover-empty-hint">No scripts yet. Create one from the Project panel.</div>
                      )}
                      {scriptKinds.map((kind) => {
                        const kindScripts = scriptsByKind(kind);
                        if (kindScripts.length === 0) return null;
                        const Meta = scriptKindMeta(kind);
                        return (
                          <div key={kind} className="comp-kind-group">
                            <div className="popover-kind-heading">
                              <Meta.icon size={11} className={Meta.className} />
                              <span>{scriptKindLabel(kind)}</span>
                            </div>
                            {kindScripts.map((s) => {
                              const Meta2 = scriptKindMeta(s.kind);
                              const attached = scriptComps.some((c) => c.scriptId === s.id);
                              return (
                                <button
                                  key={s.id}
                                  className="popover-item"
                                  onClick={() => handleAttachScript(s.id)}
                                  title={attached ? 'Already attached to this clip' : `Attach ${s.name}`}
                                >
                                  <Meta2.icon size={12} className={Meta2.className} />
                                  <span className="popover-item-name">{s.name}</span>
                                  {attached && <span className="popover-kind-tag">added</span>}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                      {allScripts.length > 0 && searchTerm &&
                        scriptKinds.every((kind) => scriptsByKind(kind).length === 0) && (
                          <div className="popover-empty-hint">No scripts match your search.</div>
                        )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
 
        <button className="unity-btn unity-btn-prefab full-width" onClick={handleSavePrefabClick}>
          {savedPrefab ? <Check size={13} /> : <Package size={13} />}
          <span>{savedPrefab ? 'Saved to Prefabs!' : 'Save as Prefab'}</span>
        </button>
 
        <button className="unity-btn unity-btn-danger-text full-width" onClick={() => onDeleteEntity(selectedEntity.id)}>
          <Trash2 size={12} />
          <span>Delete Clip</span>
        </button>
      </div>

      <TransitionPickerModal
        isOpen={showPickerModal}
        onClose={() => setShowPickerModal(false)}
        targetSlot={pickerSlot}
        currentPresetId={pickerSlot === 'out' ? transitionComp?.transitionOut?.preset : transitionComp?.transitionIn?.preset}
        initialParams={pickerInitialParams || (pickerSlot === 'out' ? transitionComp?.transitionOut?.params : transitionComp?.transitionIn?.params)}
        onApplyPreset={(presetId, slot, params) => {
          if (pickerCallback) {
            pickerCallback(presetId, params);
          } else if (transitionComp) {
            if (slot === 'out') {
              updateComponent('TransitionComponent', {
                transitionOut: { ...transitionComp.transitionOut, preset: presetId, params, enabled: true },
              });
            } else {
              updateComponent('TransitionComponent', {
                transitionIn: { ...transitionComp.transitionIn, preset: presetId, params, enabled: true },
              });
            }
          }
        }}
      />
    </aside>
  );
});