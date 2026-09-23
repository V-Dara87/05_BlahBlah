import { useState } from 'react';
import { extractScriptProps, detectScriptKind } from '../engine/scriptRunner';
import { isScriptComponent, createTransitionComponent } from '../engine/ecs';
import { readDragPayload, dragHasItemKind, ITEM_KIND_SCRIPT } from '../utils/dragData';
import { createSubtitleTrackComponent } from '../engine/subtitleTrack';
 
// Per-kind display metadata for script cards (icon + color + label). The
// kind comes from detectScriptKind at runtime — there is ONE component type
// (ScriptComponent) and the script's own code decides how it executes.
// Icons are attached by the caller (JSX lives in UnityInspector.jsx); this
// module only owns the kind → className/label mapping plus the icon-free
// metadata lookups used by the catalog logic below.
export const SCRIPT_KIND_LABELS = {
  react: 'React Component',
  canvas: 'Canvas Component',
  motion: 'Motion Script',
  shader: 'GL Transition',
};
export const scriptKindLabel = (kind) => SCRIPT_KIND_LABELS[kind] || SCRIPT_KIND_LABELS.motion;
export const SCRIPT_KINDS = ['motion', 'react', 'canvas', 'shader'];
 
/**
 * Drag-reorder of component cards, the Add Component catalog (search +
 * category state), and the handlers that create/attach/remove components
 * on the selected entity. Pulled out of UnityInspector.jsx (Step 7) — pure
 * logic, no JSX. The component-card *rendering* (foldout chrome per type)
 * stays in UnityInspector.jsx for now (Step 9).
 *
 * Components after the pinned Transform can be freely reordered. Each
 * draggable card is keyed by its component `type`, except ScriptComponent
 * (there can be several) which is keyed by `script:<scriptId>` instead so
 * multiple motion scripts on the same entity can be reordered relative to
 * each other, not just as a block.
 */
export function useComponentCardActions({ selectedEntity, onUpdateEntity, scripts }) {
  const [showAddComponent, setShowAddComponent] = useState(false);
  const [componentSearch, setComponentSearch] = useState('');
  const [openCompCategories, setOpenCompCategories] = useState({ renderers: true, scripts: true });
  const [isScriptDragOver, setIsScriptDragOver] = useState(false);
  const [dragCompType, setDragCompType] = useState(null); // component `type` (or scriptId for scripts) currently being dragged
  const [dragOverCompType, setDragOverCompType] = useState(null);
 
  const dragKeyFor = (c) => (isScriptComponent(c) ? `script:${c.scriptId}` : c.type);
 
  const reorderComponents = (draggedKey, targetKey) => {
    if (!draggedKey || !targetKey || draggedKey === targetKey) return;
    const comps = [...selectedEntity.components];
    const fromIdx = comps.findIndex((c) => dragKeyFor(c) === draggedKey);
    const toIdx = comps.findIndex((c) => dragKeyFor(c) === targetKey);
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
    const updatedComponents = selectedEntity.components.filter((c) => {
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
      newComp = { type: 'TextRenderer', text: 'New Text', fontSize: 36, fontColor: '#ffffff', fontFamily: 'Inter', subtitleSourceId: null };
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
    } else if (type === 'SubtitleTrack') {
      newComp = createSubtitleTrackComponent();
    } else if (type === 'ScriptComponent' && scriptId) {
      // ONE script component type — the runtime dispatches per the
      // script's detected kind (motion / react / canvas).
      const scriptDef = scripts.find((s) => s.id === scriptId);
      if (scriptDef) {
        const fields = extractScriptProps(scriptDef.code);
        const initialProps = {};
        // Action buttons (`{ type: 'button' }`) hold no value — they are methods
        // to call, not props to store (see engine/scriptActions.js).
        fields.forEach((f) => { if (f.type !== 'button') initialProps[f.name] = f.defaultVal; });
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
 
  // ── Add Component catalog ───────────────────────────────────────────────
  // Organized into collapsible category folders (Renderers / Scripts with
  // per-kind subfolders Motion / React / Canvas), filtered live by the
  // search box at the top of the popover. Scripts attach as the ONE
  // ScriptComponent type and the runtime dispatches by detected kind, so a
  // half-written script ('unknown') is never hidden while being written.
  const allScripts = scripts.map((s) => ({ ...s, kind: detectScriptKind(s.code) }));
 
  const searchTerm = componentSearch.trim().toLowerCase();
  const matchesSearch = (name) => !searchTerm || name.toLowerCase().includes(searchTerm);
  const scriptsByKind = (kind) => allScripts.filter((s) => s.kind === kind && matchesSearch(s.name));
 
  const toggleCompCategory = (name) => {
    setOpenCompCategories((prev) => ({ ...prev, [name]: !prev[name] }));
  };
 
  return {
    // Add Component popover state
    showAddComponent,
    setShowAddComponent,
    componentSearch,
    setComponentSearch,
    openCompCategories,
    toggleCompCategory,
 
    // Script drop-onto-inspector state
    isScriptDragOver,
    handleInspectorDragOver,
    handleInspectorDrop,
 
    // Card drag-reorder state + handlers
    dragCompType,
    dragOverCompType,
    dragKeyFor,
    handleCardDragStart,
    handleCardDragOver,
    handleCardDrop,
    handleCardDragEnd,
 
    // Component CRUD
    removeComponent,
    handleAddComponent,
    handleAttachScript,
 
    // Catalog data
    allScripts,
    scriptsByKind,
    searchTerm,
    matchesSearch,
  };
}
 