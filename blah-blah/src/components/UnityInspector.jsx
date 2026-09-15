import { useState, memo, useMemo } from 'react';
import {
  Sliders,
  Plus,
  Package,
  Check,
  Key,
  Search,
  FolderOpen,
  Folder,
  Lock,
  Unlock,
  Trash2,
  ChevronDown,
  ChevronRight,
  Type,
  Square,
  Volume2,
  Sparkles,
  Captions,
  Film,
} from 'lucide-react';
import { getFieldKeyframes, setKeyframe, evaluateField } from '../engine/keyframes';
import { isScriptComponent } from '../engine/ecs';
import { useReferencePicker } from './inspector/ReferencePickerHost';
import { useComponentCardActions, scriptKindLabel, SCRIPT_KINDS } from '../hooks/useComponentCardActions';
import { TransformCard } from './inspector/TransformCard';
import { TextRendererCard } from './inspector/TextRendererCard';
import { ShapeRendererCard } from './inspector/ShapeRendererCard';
import { MediaSettingsCard } from './inspector/MediaSettingsCard';
import { TransitionCard } from './inspector/TransitionCard';
import { SubtitleTrackCard } from './inspector/SubtitleTrackCard';
import { ScriptCard, scriptKindMeta } from './inspector/ScriptCard';
 
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
 * Bugfix (earlier pass) — two issues reported together:
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
 *
 * Step 9 — each card's body (Transform / TextRenderer / ShapeRenderer /
 * media settings / TransitionComponent / SubtitleTrack / ScriptComponent)
 * now lives in its own file under ./inspector/, sharing the
 * ./inspector/InspectorCardHeader.jsx chrome. This file wires them up:
 * per-entity derived data (transformComp, textComp, ...), the update/
 * keyframe helpers each card needs, and the overall card order.
 */
 
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
  const [savedPrefab, setSavedPrefab] = useState(false);
 
  const {
    showAddComponent,
    setShowAddComponent,
    componentSearch,
    setComponentSearch,
    openCompCategories,
    toggleCompCategory,
    isScriptDragOver,
    handleInspectorDragOver,
    handleInspectorDrop,
    dragOverCompType,
    handleCardDragStart,
    handleCardDragOver,
    handleCardDrop,
    handleCardDragEnd,
    removeComponent,
    handleAddComponent,
    handleAttachScript,
    allScripts,
    scriptsByKind,
    searchTerm,
    matchesSearch,
  } = useComponentCardActions({ selectedEntity, onUpdateEntity, scripts });
 
  const { openPicker, pickerModal } = useReferencePicker({ selectedEntity, onUpdateEntity });
 
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
  const subtitleComp = selectedEntity.components.find(c => c.type === 'SubtitleTrack');
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
 
  const handleSavePrefabClick = () => {
    onSaveAsPrefab(selectedEntity);
    setSavedPrefab(true);
    setTimeout(() => setSavedPrefab(false), 2000);
  };
 
  // Presentation-only: icons live here (JSX), the underlying catalog logic
  // (search filtering, kind grouping) is owned by useComponentCardActions.
  const RENDERER_ICONS = {
    TextRenderer: <Type size={12} className="text-amber" />,
    ShapeRenderer: <Square size={12} className="text-cyan" />,
    VideoRenderer: <Film size={12} className="text-indigo" />,
    AudioSource: <Volume2 size={12} className="text-emerald" />,
    TransitionComponent: <Sparkles size={12} className="text-amber" />,
    SubtitleTrack: <Captions size={12} className="text-cyan" />,
  };
  const rendererItems = useMemo(() => ([
    { type: 'TextRenderer', label: 'Text Component', present: !!textComp },
    { type: 'ShapeRenderer', label: 'Shape Component', present: !!shapeComp },
    { type: 'VideoRenderer', label: 'Video Component', present: !!videoComp },
    { type: 'AudioSource', label: 'Audio Component', present: !!audioComp },
    { type: 'TransitionComponent', label: 'GL Transition', present: !!transitionComp },
    { type: 'SubtitleTrack', label: 'Subtitle Track', present: !!subtitleComp },
  ]), [textComp, shapeComp, videoComp, audioComp, transitionComp, subtitleComp]);
 
  const visibleRendererItems = rendererItems.filter((it) => matchesSearch(it.label) || matchesSearch(it.type));
 
  const scriptKinds = SCRIPT_KINDS;
 
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
        <TransformCard
          transformComp={transformComp}
          isOpen={openFoldouts.Transform}
          onToggle={() => toggleFoldout('Transform')}
          resolveComponentValues={resolveComponentValues}
          updateTransform={updateTransform}
          selectedEntity={selectedEntity}
          currentTime={currentTime}
          onUpdateEntity={onUpdateEntity}
        />
 
        {/* ========== TEXT RENDERER ========== */}
        {textComp && (
          <TextRendererCard
            textComp={textComp}
            subtitleComp={subtitleComp}
            entities={entities}
            selectedEntity={selectedEntity}
            isOpen={openFoldouts.Text}
            onToggle={() => toggleFoldout('Text')}
            dragOverCompType={dragOverCompType}
            handleCardDragStart={handleCardDragStart}
            handleCardDragOver={handleCardDragOver}
            handleCardDrop={handleCardDrop}
            handleCardDragEnd={handleCardDragEnd}
            removeComponent={removeComponent}
            resolveComponentValues={resolveComponentValues}
            tryWriteKeyframe={tryWriteKeyframe}
            updateComponent={updateComponent}
            currentTime={currentTime}
            onUpdateEntity={onUpdateEntity}
          />
        )}
 
        {/* ========== SHAPE RENDERER ========== */}
        {shapeComp && (
          <ShapeRendererCard
            shapeComp={shapeComp}
            isOpen={openFoldouts.Shape}
            onToggle={() => toggleFoldout('Shape')}
            dragOverCompType={dragOverCompType}
            handleCardDragStart={handleCardDragStart}
            handleCardDragOver={handleCardDragOver}
            handleCardDrop={handleCardDrop}
            handleCardDragEnd={handleCardDragEnd}
            removeComponent={removeComponent}
            updateComponent={updateComponent}
          />
        )}
 
        {/* ========== MEDIA SETTINGS (VideoRenderer / AudioSource volume) ========== */}
        {videoComp && (
          <MediaSettingsCard
            compType="VideoRenderer"
            comp={videoComp}
            title={audioComp ? 'Video Media Settings' : 'Media Settings'}
            isOpen={openFoldouts.VideoMedia !== undefined ? openFoldouts.VideoMedia : openFoldouts.Media}
            onToggle={() => toggleFoldout(audioComp ? 'VideoMedia' : 'Media')}
            dragOverCompType={dragOverCompType}
            handleCardDragStart={handleCardDragStart}
            handleCardDragOver={handleCardDragOver}
            handleCardDrop={handleCardDrop}
            handleCardDragEnd={handleCardDragEnd}
            updateComponent={updateComponent}
          />
        )}
 
        {audioComp && (
          <MediaSettingsCard
            compType="AudioSource"
            comp={audioComp}
            title={videoComp ? 'Audio Media Settings' : 'Media Settings'}
            isOpen={openFoldouts.AudioMedia !== undefined ? openFoldouts.AudioMedia : openFoldouts.Media}
            onToggle={() => toggleFoldout(videoComp ? 'AudioMedia' : 'Media')}
            dragOverCompType={dragOverCompType}
            handleCardDragStart={handleCardDragStart}
            handleCardDragOver={handleCardDragOver}
            handleCardDrop={handleCardDrop}
            handleCardDragEnd={handleCardDragEnd}
            updateComponent={updateComponent}
          />
        )}
 
        {/* ========== GL TRANSITION COMPONENT ========== */}
        {transitionComp && (
          <TransitionCard
            transitionComp={transitionComp}
            isOpen={openFoldouts.Transition !== false}
            onToggle={() => toggleFoldout('Transition')}
            dragOverCompType={dragOverCompType}
            handleCardDragStart={handleCardDragStart}
            handleCardDragOver={handleCardDragOver}
            handleCardDrop={handleCardDrop}
            handleCardDragEnd={handleCardDragEnd}
            removeComponent={removeComponent}
            updateComponent={updateComponent}
            openPicker={openPicker}
          />
        )}
 
        {/* ========== SUBTITLE TRACK — data-only timed phrases ========== */}
        {subtitleComp && (
          <SubtitleTrackCard
            subtitleComp={subtitleComp}
            selectedEntity={selectedEntity}
            currentTime={currentTime}
            onUpdateEntity={onUpdateEntity}
            isOpen={openFoldouts.SubtitleTrack !== false}
            onToggle={() => toggleFoldout('SubtitleTrack')}
            dragOverCompType={dragOverCompType}
            handleCardDragStart={handleCardDragStart}
            handleCardDragOver={handleCardDragOver}
            handleCardDrop={handleCardDrop}
            handleCardDragEnd={handleCardDragEnd}
            removeComponent={removeComponent}
          />
        )}
 
        {/* ========== SCRIPTS (motion / React / Canvas — one component type) ========== */}
        {scriptComps.map((scriptComp) => {
          const foldoutKey = `Script:${scriptComp.scriptId}`;
          // Per-script foldout state defaults to open until the user
          // collapses it, same as every other card.
          const isOpen = openFoldouts[foldoutKey] !== false;
 
          return (
            <ScriptCard
              key={scriptComp.scriptId}
              scriptComp={scriptComp}
              scripts={scripts}
              isOpen={isOpen}
              onToggle={() => toggleFoldout(foldoutKey)}
              dragOverCompType={dragOverCompType}
              handleCardDragStart={handleCardDragStart}
              handleCardDragOver={handleCardDragOver}
              handleCardDrop={handleCardDrop}
              handleCardDragEnd={handleCardDragEnd}
              removeComponent={removeComponent}
              onOpenScriptEditor={onOpenScriptEditor}
              resolveComponentValues={resolveComponentValues}
              updateScriptProps={updateScriptProps}
              updateScriptComp={updateScriptComp}
              selectedEntity={selectedEntity}
              currentTime={currentTime}
              onUpdateEntity={onUpdateEntity}
              entities={entities}
              mediaAssets={mediaAssets}
            />
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
                      {visibleRendererItems.map((item) => (
                        <button
                          key={item.type}
                          className="popover-item"
                          onClick={() => handleAddComponent(item.type)}
                          title={item.present ? 'Already attached to this clip' : `Add ${item.label}`}
                          disabled={item.present}
                        >
                          {RENDERER_ICONS[item.type]}
                          <span>{item.label}</span>
                          {item.present && <span className="popover-kind-tag">added</span>}
                        </button>
                      ))}
                      {visibleRendererItems.length === 0 && (
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
 
      {pickerModal}
    </aside>
  );
});
 