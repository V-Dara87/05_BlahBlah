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
  Boxes
} from 'lucide-react';
import { extractScriptProps, getScriptError } from '../engine/scriptRunner';
import { DragNumber } from './DragNumber';
import { InspectorFieldList, TRANSFORM_FIELD_GROUPS } from './inspector/InspectorField';
 
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
 */
export const UnityInspector = memo(function UnityInspector({
  selectedEntity,
  tracks = [],
  scripts = [],
  onUpdateEntity,
  onDeleteEntity,
  onOpenScriptEditor,
  onSaveAsPrefab
}) {
  const [openFoldouts, setOpenFoldouts] = useState({
    Transform: true,
    Renderer: true,
    Scripts: true
  });
  const [showAddComponent, setShowAddComponent] = useState(false);
  const [savedPrefab, setSavedPrefab] = useState(false);
 
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
    const updatedComponents = selectedEntity.components.map(c =>
      c.type === 'Transform' ? { ...c, ...updates } : c
    );
    if (!selectedEntity.components.some(c => c.type === 'Transform')) {
      updatedComponents.unshift({ type: 'Transform', ...updates });
    }
    onUpdateEntity(selectedEntity.id, { components: updatedComponents });
  };
 
  const updateComponent = (compType, updates) => {
    const updatedComponents = selectedEntity.components.map(c =>
      c.type === compType ? { ...c, ...updates } : c
    );
    onUpdateEntity(selectedEntity.id, { components: updatedComponents });
  };
 
  const updateScriptProps = (scriptId, propKey, propVal) => {
    const updatedComponents = selectedEntity.components.map(c => {
      if ((c.type === 'ScriptComponent' || c.type === 'MonoBehaviour') && c.scriptId === scriptId) {
        return { ...c, props: { ...(c.props || {}), [propKey]: propVal } };
      }
      return c;
    });
    onUpdateEntity(selectedEntity.id, { components: updatedComponents });
  };
 
  const updateReactProps = (propKey, propVal) => {
    const updatedComponents = selectedEntity.components.map(c => {
      if (c.type === 'ReactRenderer') {
        return { ...c, props: { ...(c.props || {}), [propKey]: propVal } };
      }
      return c;
    });
    onUpdateEntity(selectedEntity.id, { components: updatedComponents });
  };
 
  const updateCanvasProps = (propKey, propVal) => {
    const updatedComponents = selectedEntity.components.map(c => {
      if (c.type === 'CanvasRenderer') {
        return { ...c, props: { ...(c.props || {}), [propKey]: propVal } };
      }
      return c;
    });
    onUpdateEntity(selectedEntity.id, { components: updatedComponents });
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
      newComp = { type: 'ShapeRenderer', shapeType: 'rounded-rect', width: 140, height: 140, color: '#6366f1', strokeColor: '#38bdf8', strokeWidth: 2, borderRadius: 12 };
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
 
  // Canvas scripts: same file pool as motion scripts, no fixed naming
  // convention distinguishes them (a CanvasRenderer script is just any
  // script whose default export follows the onMount/onUpdate/onUnmount
  // contract) — so, like Motion Scripts below, every script is offered.
  const canvasScripts = scripts;
 
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
 
        {/* ========== TRANSFORM ========== */}
        <div className="inspector-card">
          <div className="inspector-card-header" onClick={() => toggleFoldout('Transform')}>
            <div className="card-title-group">
              {openFoldouts.Transform ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span className="card-title-text">Transform</span>
            </div>
          </div>
 
          {openFoldouts.Transform && (
            <div className="inspector-card-body">
              {TRANSFORM_FIELD_GROUPS.map((group) => (
                <div key={group.label} className="inspector-row">
                  <span className="row-label">{group.label}</span>
                  {group.fields.length > 1 ? (
                    <div className="drag-number-group">
                      <InspectorFieldList
                        fields={group.fields}
                        values={transformComp}
                        onFieldChange={(name, v) => updateTransform({ [name]: v })}
                      />
                    </div>
                  ) : (
                    <InspectorFieldList
                      fields={group.fields}
                      values={transformComp}
                      onFieldChange={(name, v) => updateTransform({ [name]: v })}
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
 
          return (
            <div className="inspector-card react-highlight">
              <div className="inspector-card-header">
                <div className="card-title-group">
                  <Sparkles size={13} className="text-cyan" />
                  <span className="card-title-text">{reactComp.scriptName || 'React Component'}</span>
                </div>
                <div className="card-actions-group">
                  <button className="edit-cs-btn" onClick={() => scriptDef && onOpenScriptEditor(scriptDef)}>
                    Edit JSX
                  </button>
                  <button className="del-btn-sm" onClick={() => removeComponent('ReactRenderer')}>
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
 
              <div className="inspector-card-body">
                {scriptError && (
                  <div className="script-error-badge">
                    <AlertCircle size={12} />
                    <span>{scriptError}</span>
                  </div>
                )}
 
                <InspectorFieldList
                  fields={fields}
                  values={reactComp.props}
                  onFieldChange={updateReactProps}
                  emptyHint={<>Expose props with <code>Component.props = &#123; ... &#125;</code></>}
                />
              </div>
            </div>
          );
        })()}
 
        {/* ========== CANVAS RENDERER (P0 #2 / #3) ========== */}
        {canvasComp && (() => {
          const scriptDef = scripts.find(s => s.id === canvasComp.scriptId);
          const fields = scriptDef ? extractScriptProps(scriptDef.code) : [];
          const scriptError = scriptDef ? getScriptError(scriptDef.code) : null;
 
          return (
            <div className="inspector-card canvas-highlight">
              <div className="inspector-card-header">
                <div className="card-title-group">
                  <Boxes size={13} className="text-violet" />
                  <span className="card-title-text">{canvasComp.scriptName || 'Canvas Component'}</span>
                </div>
                <div className="card-actions-group">
                  <button className="edit-cs-btn" onClick={() => scriptDef && onOpenScriptEditor(scriptDef)}>
                    Edit JS
                  </button>
                  <button className="del-btn-sm" onClick={() => removeComponent('CanvasRenderer')}>
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
 
              <div className="inspector-card-body">
                {scriptError && (
                  <div className="script-error-badge">
                    <AlertCircle size={12} />
                    <span>{scriptError}</span>
                  </div>
                )}
 
                <InspectorFieldList
                  fields={fields}
                  values={canvasComp.props}
                  onFieldChange={updateCanvasProps}
                  emptyHint={<>Expose props with <code>static props = &#123; ... &#125;</code></>}
                />
              </div>
            </div>
          );
        })()}
 
        {/* ========== TEXT RENDERER ========== */}
        {textComp && (
          <div className="inspector-card">
            <div className="inspector-card-header">
              <div className="card-title-group">
                <Type size={13} className="text-amber" />
                <span className="card-title-text">Text Component</span>
              </div>
              <button className="del-btn-sm" onClick={() => removeComponent('TextRenderer')}>
                <Trash2 size={11} />
              </button>
            </div>
 
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
          </div>
        )}
 
        {/* ========== SHAPE RENDERER ========== */}
        {shapeComp && (
          <div className="inspector-card">
            <div className="inspector-card-header">
              <div className="card-title-group">
                <Square size={13} className="text-cyan" />
                <span className="card-title-text">Shape Component</span>
              </div>
              <button className="del-btn-sm" onClick={() => removeComponent('ShapeRenderer')}>
                <Trash2 size={11} />
              </button>
            </div>
 
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
                  value={shapeComp.color || '#4f46e5'}
                  onChange={(e) => updateComponent('ShapeRenderer', { color: e.target.value })}
                />
              </div>
 
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
          </div>
        )}
 
        {/* ========== MEDIA SETTINGS ========== */}
        {(videoComp || audioComp) && (
          <div className="inspector-card">
            <div className="inspector-card-header">
              <div className="card-title-group">
                <Volume2 size={13} className="text-emerald" />
                <span className="card-title-text">Media Settings</span>
              </div>
            </div>
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
          </div>
        )}
 
        {/* ========== JS/TS MOTION SCRIPTS ========== */}
        {scriptComps.map((scriptComp) => {
          const scriptDef = scripts.find(s => s.id === scriptComp.scriptId);
          const fields = scriptDef ? extractScriptProps(scriptDef.code) : [];
          const scriptError = scriptDef ? getScriptError(scriptDef.code) : null;
 
          return (
            <div key={scriptComp.scriptId} className="inspector-card script-highlight">
              <div className="inspector-card-header">
                <div className="card-title-group">
                  <FileCode size={13} className="text-emerald" />
                  <span className="card-title-text">{scriptComp.scriptName || 'Motion Script'}</span>
                </div>
                <div className="card-actions-group">
                  <button className="edit-cs-btn" onClick={() => scriptDef && onOpenScriptEditor(scriptDef)}>
                    Edit JS
                  </button>
                  <button className="del-btn-sm" onClick={() => removeComponent('ScriptComponent', scriptComp.scriptId)}>
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
 
              <div className="inspector-card-body">
                {scriptError && (
                  <div className="script-error-badge">
                    <AlertCircle size={12} />
                    <span>{scriptError}</span>
                  </div>
                )}
 
                <InspectorFieldList
                  fields={fields}
                  values={scriptComp.props}
                  onFieldChange={(name, v) => updateScriptProps(scriptComp.scriptId, name, v)}
                  emptyHint={<>Expose props with <code>static props = &#123; ... &#125;</code></>}
                />
              </div>
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
              {scripts.filter(s => s.name.endsWith('.jsx') || s.code?.includes('return') || s.code?.includes('div')).map(s => (
                <button key={s.id} className="popover-item" onClick={() => handleAddComponent('ReactRenderer', s.id)}>
                  <Sparkles size={12} className="text-cyan" />
                  <span>{s.name}</span>
                </button>
              ))}
 
              {!canvasComp && (
                <>
                  <div className="popover-heading">Canvas Components (Three.js/WebGL)</div>
                  {canvasScripts.map(s => (
                    <button key={s.id} className="popover-item" onClick={() => handleAddComponent('CanvasRenderer', s.id)}>
                      <Boxes size={12} className="text-violet" />
                      <span>{s.name}</span>
                    </button>
                  ))}
                </>
              )}
 
              <div className="popover-heading">Motion Scripts (.js)</div>
              {scripts.map(s => (
                <button key={s.id} className="popover-item" onClick={() => handleAddComponent('ScriptComponent', s.id)}>
                  <FileCode size={12} className="text-emerald" />
                  <span>{s.name}</span>
                </button>
              ))}
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
 