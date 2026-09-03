import { useState, memo } from 'react';
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
  Clock
} from 'lucide-react';
import { extractScriptProps, getScriptError, detectScriptKind, isScriptBundlePending } from '../engine/scriptRunner';
import { DragNumber } from './DragNumber';
import { InspectorFieldList, TRANSFORM_FIELD_GROUPS } from './inspector/InspectorField';
import { trackKeyFor, getFieldKeyframes, setKeyframe, evaluateField } from '../engine/keyframes';
 
/**
 * P0 #3 — Unified Inspector field rendering.
 *
 * Transform, ReactRenderer, ScriptComponent, and CanvasRenderer all render
 * their fields through the shared `InspectorFieldList` /
 * `TRANSFORM_FIELD_GROUPS` in `./inspector/InspectorField.jsx`, instead of
 * each having its own hand-written field switch. TextRenderer and
 * ShapeRenderer keep bespoke bodies for now — their fields (a shape-type
 * select, paired W/H drag-numbers, etc.) don't map cleanly onto the
 * single-field-per-row schema, and folding them in isn't required to
 * unblock CanvasRenderer or close the roadmap item.
 *
 * Add Component script-kind filtering (bugfix) — previously every section
 * (React Clips / Canvas Components / Motion Scripts) listed the *entire*
 * `scripts` array unconditionally, so a single file could show up in all
 * three lists regardless of which runtime contract it actually implements
 * (a script written as a React component would still appear as a pickable
 * "Motion Script", and attaching it there produced a component that just
 * didn't do anything at render time). Each section is now filtered through
 * `detectScriptKind`, which sniffs the script body once (onMount → canvas,
 * onStart/onUpdate(transform) → motion, returns JSX → react) so a given
 * script only appears where it will actually work. Scripts whose kind is
 * still 'unknown' (e.g. a brand new empty script) are shown in every
 * section so they aren't hidden while being written.
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
  tracks = [],
  scripts = [],
  onUpdateEntity,
  onDeleteEntity,
  onOpenScriptEditor,
  onSaveAsPrefab,
  currentTime = 0,
  autoKeyEnabled = false,
  setAutoKeyEnabled
}) {
  const [openFoldouts, setOpenFoldouts] = useState({
    Transform: true,
    Renderer: true,
    Scripts: true,
    React: true,
    Canvas: true,
    Text: true,
    Shape: true,
    Media: true
  });
  const [showAddComponent, setShowAddComponent] = useState(false);
  const [savedPrefab, setSavedPrefab] = useState(false);
  const [dragCompType, setDragCompType] = useState(null); // component `type` (or scriptId for scripts) currently being dragged
  const [dragOverCompType, setDragOverCompType] = useState(null);
 
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
  const reactComp = selectedEntity.components.find(c => c.type === 'ReactRenderer');
  const canvasComp = selectedEntity.components.find(c => c.type === 'CanvasRenderer');
  const scriptComps = selectedEntity.components.filter(c => c.type === 'ScriptComponent' || c.type === 'MonoBehaviour');
 
  const updateTransform = (updates) => {
    // For each updated field: if it already has keyframes (or autoKey is on)
    // write a keyframe at the current time — the static prop is overridden by
    // the keyframe evaluator every frame anyway, so writing there is a no-op.
    // Fields with no keyframes and autoKey off get the normal static-prop write.
    let kfsSnapshot = selectedEntity.keyframes || {};
    let kfsChanged = false;
    const staticUpdates = {};

    Object.keys(updates).forEach((fieldName) => {
      const tempEntity = { ...selectedEntity, keyframes: kfsSnapshot };
      const result = tryWriteKeyframe(tempEntity, 'Transform', fieldName, updates[fieldName]);
      if (result) {
        kfsSnapshot = result;
        kfsChanged = true;
      } else {
        staticUpdates[fieldName] = updates[fieldName];
      }
    });

    const batchUpdate = {};
    if (kfsChanged) batchUpdate.keyframes = kfsSnapshot;
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
    const updatedComponents = selectedEntity.components.map(c =>
      c.type === compType ? { ...c, ...updates } : c
    );
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
        if ((c.type === 'ScriptComponent' || c.type === 'MonoBehaviour') && c.scriptId === scriptId) {
          return { ...c, props: { ...(c.props || {}), [propKey]: propVal } };
        }
        return c;
      });
      onUpdateEntity(selectedEntity.id, { components: updatedComponents });
    }
  };

  const updateReactProps = (propKey, propVal) => {
    const newKfs = tryWriteKeyframe(selectedEntity, 'ReactRenderer', propKey, propVal);
    if (newKfs) {
      onUpdateEntity(selectedEntity.id, { keyframes: newKfs });
    } else {
      const updatedComponents = selectedEntity.components.map((c) => {
        if (c.type === 'ReactRenderer') {
          return { ...c, props: { ...(c.props || {}), [propKey]: propVal } };
        }
        return c;
      });
      onUpdateEntity(selectedEntity.id, { components: updatedComponents });
    }
  };

  const updateCanvasProps = (propKey, propVal) => {
    const newKfs = tryWriteKeyframe(selectedEntity, 'CanvasRenderer', propKey, propVal);
    if (newKfs) {
      onUpdateEntity(selectedEntity.id, { keyframes: newKfs });
    } else {
      const updatedComponents = selectedEntity.components.map((c) => {
        if (c.type === 'CanvasRenderer') {
          return { ...c, props: { ...(c.props || {}), [propKey]: propVal } };
        }
        return c;
      });
      onUpdateEntity(selectedEntity.id, { components: updatedComponents });
    }
  };
 
  // Components after the pinned Transform can be freely reordered. Each
  // draggable card is keyed by its component `type`, except ScriptComponent
  // (there can be several) which is keyed by `script:<scriptId>` instead so
  // multiple motion scripts on the same entity can be reordered relative to
  // each other, not just as a block.
  const dragKeyFor = (c) =>
    (c.type === 'ScriptComponent' || c.type === 'MonoBehaviour') ? `script:${c.scriptId}` : c.type;
 
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
        return !( (c.type === 'ScriptComponent' || c.type === 'MonoBehaviour') && c.scriptId === scriptId );
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
    } else if (type === 'ReactRenderer' && scriptId) {
      const scriptDef = scripts.find(s => s.id === scriptId);
      if (scriptDef) {
        const fields = extractScriptProps(scriptDef.code);
        const initialProps = {};
        fields.forEach(f => { initialProps[f.name] = f.defaultVal; });
        newComp = { type: 'ReactRenderer', scriptId: scriptDef.id, scriptName: scriptDef.name, props: initialProps };
      }
    } else if (type === 'ScriptComponent' && scriptId) {
      const scriptDef = scripts.find(s => s.id === scriptId);
      if (scriptDef) {
        const fields = extractScriptProps(scriptDef.code);
        const initialProps = {};
        fields.forEach(f => { initialProps[f.name] = f.defaultVal; });
        newComp = { type: 'ScriptComponent', scriptId: scriptDef.id, scriptName: scriptDef.name, enabled: true, props: initialProps };
      }
    } else if (type === 'CanvasRenderer' && scriptId) {
      const scriptDef = scripts.find(s => s.id === scriptId);
      if (scriptDef) {
        const fields = extractScriptProps(scriptDef.code);
        const initialProps = {};
        fields.forEach(f => { initialProps[f.name] = f.defaultVal; });
        newComp = { type: 'CanvasRenderer', scriptId: scriptDef.id, scriptName: scriptDef.name, props: initialProps };
      }
    }
 
    if (newComp) {
      onUpdateEntity(selectedEntity.id, { components: [...selectedEntity.components, newComp] });
    }
  };
 
  const handleSavePrefabClick = () => {
    onSaveAsPrefab(selectedEntity);
    setSavedPrefab(true);
    setTimeout(() => setSavedPrefab(false), 2000);
  };
 
  // Script-kind filtering (bugfix): each Add Component section now only
  // lists scripts whose body actually matches that section's runtime
  // contract, instead of every script appearing in every section. A script
  // whose kind can't be determined yet ('unknown' — e.g. brand new/empty)
  // is still shown everywhere so it isn't hidden while being written.
  const reactScripts = scripts.filter(s => {
    const kind = detectScriptKind(s.code);
    return kind === 'react' || kind === 'unknown';
  });
  const canvasScripts = scripts.filter(s => {
    const kind = detectScriptKind(s.code);
    return kind === 'canvas' || kind === 'unknown';
  });
  const motionScripts = scripts.filter(s => {
    const kind = detectScriptKind(s.code);
    return kind === 'motion' || kind === 'unknown';
  });
 
  return (
    <aside className="inspector-sidebar">
      {/* GameObject Name & Track */}
      <div className="inspector-header-box">
        <div className="inspector-header-field">
          <label className="field-label-sm">GameObject Name</label>
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
 
        {/* ========== REACT COMPONENT RENDERER ========== */}
        {reactComp && (() => {
          const scriptDef = scripts.find(s => s.id === reactComp.scriptId);
          const fields = scriptDef ? extractScriptProps(scriptDef.code) : [];
          const scriptError = scriptDef ? getScriptError(scriptDef.code) : null;
          const bundlePending = scriptDef ? isScriptBundlePending(scriptDef.code) : false;
 
          return (
            <div className="inspector-card react-highlight">
              <InspectorCardHeader
                icon={<Sparkles size={13} className="text-cyan" />}
                title={reactComp.scriptName || 'React Component'}
                isOpen={openFoldouts.React}
                onToggle={() => toggleFoldout('React')}
                draggable
                isDragOver={dragOverCompType === 'ReactRenderer'}
                onDragStart={handleCardDragStart('ReactRenderer')}
                onDragOver={handleCardDragOver('ReactRenderer')}
                onDrop={handleCardDrop('ReactRenderer')}
                onDragEnd={handleCardDragEnd}
                actions={
                  <>
                    <button className="edit-cs-btn" onClick={() => scriptDef && onOpenScriptEditor(scriptDef)}>
                      Edit JSX
                    </button>
                    <button className="del-btn-sm" onClick={() => removeComponent('ReactRenderer')}>
                      <Trash2 size={11} />
                    </button>
                  </>
                }
              />
 
              {openFoldouts.React && (
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
 
                  <InspectorFieldList
                    fields={fields}
                    values={resolveComponentValues('ReactRenderer', reactComp.props)}
                    onFieldChange={updateReactProps}
                    emptyHint={<>Expose props with <code>Component.props = &#123; ... &#125;</code></>}
                    trackKey="ReactRenderer"
                    selectedEntity={selectedEntity}
                    currentTime={currentTime}
                    onUpdateEntity={onUpdateEntity}
                  />
                </div>
              )}
            </div>
          );
        })()}
 
        {/* ========== CANVAS RENDERER (P0 #2 / #3) ========== */}
        {canvasComp && (() => {
          const scriptDef = scripts.find(s => s.id === canvasComp.scriptId);
          const fields = scriptDef ? extractScriptProps(scriptDef.code) : [];
          const scriptError = scriptDef ? getScriptError(scriptDef.code) : null;
          const bundlePending = scriptDef ? isScriptBundlePending(scriptDef.code) : false;
 
          return (
            <div className="inspector-card canvas-highlight">
              <InspectorCardHeader
                icon={<Boxes size={13} className="text-violet" />}
                title={canvasComp.scriptName || 'Canvas Component'}
                isOpen={openFoldouts.Canvas}
                onToggle={() => toggleFoldout('Canvas')}
                draggable
                isDragOver={dragOverCompType === 'CanvasRenderer'}
                onDragStart={handleCardDragStart('CanvasRenderer')}
                onDragOver={handleCardDragOver('CanvasRenderer')}
                onDrop={handleCardDrop('CanvasRenderer')}
                onDragEnd={handleCardDragEnd}
                actions={
                  <>
                    <button className="edit-cs-btn" onClick={() => scriptDef && onOpenScriptEditor(scriptDef)}>
                      Edit JS
                    </button>
                    <button className="del-btn-sm" onClick={() => removeComponent('CanvasRenderer')}>
                      <Trash2 size={11} />
                    </button>
                  </>
                }
              />
 
              {openFoldouts.Canvas && (
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
 
                  <InspectorFieldList
                    fields={fields}
                    values={resolveComponentValues('CanvasRenderer', canvasComp.props)}
                    onFieldChange={updateCanvasProps}
                    emptyHint={<>Expose props with <code>static props = &#123; ... &#125;</code></>}
                    trackKey="CanvasRenderer"
                    selectedEntity={selectedEntity}
                    currentTime={currentTime}
                    onUpdateEntity={onUpdateEntity}
                  />
                </div>
              )}
            </div>
          );
        })()}
 
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
 
        {/* ========== MEDIA SETTINGS ========== */}
        {(videoComp || audioComp) && (
          <div className="inspector-card">
            <InspectorCardHeader
              icon={<Volume2 size={13} className="text-emerald" />}
              title="Media Settings"
              isOpen={openFoldouts.Media}
              onToggle={() => toggleFoldout('Media')}
              draggable
              isDragOver={dragOverCompType === (videoComp ? 'VideoRenderer' : 'AudioSource')}
              onDragStart={handleCardDragStart(videoComp ? 'VideoRenderer' : 'AudioSource')}
              onDragOver={handleCardDragOver(videoComp ? 'VideoRenderer' : 'AudioSource')}
              onDrop={handleCardDrop(videoComp ? 'VideoRenderer' : 'AudioSource')}
              onDragEnd={handleCardDragEnd}
            />
            {openFoldouts.Media && (
              <div className="inspector-card-body">
                <div className="inspector-row">
                  <span className="row-label">Volume</span>
                  <DragNumber
                    label="vol"
                    value={parseFloat(((videoComp || audioComp)?.volume ?? 1).toFixed(2))}
                    step={0.01}
                    min={0}
                    max={2}
                    onChange={(v) => {
                      const compType = videoComp ? 'VideoRenderer' : 'AudioSource';
                      updateComponent(compType, { volume: v });
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
 
        {/* ========== JS/TS MOTION SCRIPTS ========== */}
        {scriptComps.map((scriptComp) => {
          const scriptDef = scripts.find(s => s.id === scriptComp.scriptId);
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
                icon={<FileCode size={13} className="text-emerald" />}
                title={scriptComp.scriptName || 'Motion Script'}
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
 
                  <InspectorFieldList
                    fields={fields}
                    values={resolveComponentValues(`script:${scriptComp.scriptId}`, scriptComp.props)}
                    onFieldChange={(name, v) => updateScriptProps(scriptComp.scriptId, name, v)}
                    emptyHint={<>Expose props with <code>static props = &#123; ... &#125;</code></>}
                    trackKey={`script:${scriptComp.scriptId}`}
                    selectedEntity={selectedEntity}
                    currentTime={currentTime}
                    onUpdateEntity={onUpdateEntity}
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
            <div className="comp-dropdown-popover">
              <div className="popover-heading">Visual Elements</div>
              {!textComp && (
                <button className="popover-item" onClick={() => handleAddComponent('TextRenderer')}>
                  <Type size={12} />
                  <span>Text Component</span>
                </button>
              )}
              {!shapeComp && (
                <button className="popover-item" onClick={() => handleAddComponent('ShapeRenderer')}>
                  <Square size={12} />
                  <span>Shape Component</span>
                </button>
              )}
 
              <div className="popover-heading">React Clips (.jsx)</div>
              {reactScripts.map(s => (
                <button key={s.id} className="popover-item" onClick={() => handleAddComponent('ReactRenderer', s.id)}>
                  <Sparkles size={12} className="text-cyan" />
                  <span>{s.name}</span>
                </button>
              ))}
              {reactScripts.length === 0 && (
                <div className="popover-empty-hint">No scripts matching React Clip contract yet.</div>
              )}
 
              {!canvasComp && (
                <>
                  <div className="popover-heading">Canvas Components (Three.js/WebGL)</div>
                  {canvasScripts.map(s => (
                    <button key={s.id} className="popover-item" onClick={() => handleAddComponent('CanvasRenderer', s.id)}>
                      <Boxes size={12} className="text-violet" />
                      <span>{s.name}</span>
                    </button>
                  ))}
                  {canvasScripts.length === 0 && (
                    <div className="popover-empty-hint">No scripts matching Canvas Component contract yet.</div>
                  )}
                </>
              )}
 
              <div className="popover-heading">Motion Scripts (.js)</div>
              {motionScripts.map(s => (
                <button key={s.id} className="popover-item" onClick={() => handleAddComponent('ScriptComponent', s.id)}>
                  <FileCode size={12} className="text-emerald" />
                  <span>{s.name}</span>
                </button>
              ))}
              {motionScripts.length === 0 && (
                <div className="popover-empty-hint">No scripts matching Motion Script contract yet.</div>
              )}
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
    </aside>
  );
});