import { AlertCircle, Clock, Trash2, Sparkles, Boxes, FileCode } from 'lucide-react';
import { extractScriptProps, getScriptError, detectScriptKind, isScriptBundlePending } from '../../engine/scriptRunner';
import { InspectorFieldList } from './InspectorField';
import { InspectorCardHeader } from './InspectorCardHeader';
 
// Per-kind display metadata for script cards (icon + color + label). The
// kind comes from detectScriptKind at runtime — there is ONE component type
// (ScriptComponent) and the script's own code decides how it executes.
const SCRIPT_KIND_META = {
  react: { icon: Sparkles, className: 'text-cyan', label: 'React Component' },
  canvas: { icon: Boxes, className: 'text-violet', label: 'Canvas Component' },
  motion: { icon: FileCode, className: 'text-emerald', label: 'Motion Script' },
  shader: { icon: Sparkles, className: 'text-amber', label: 'GL Transition' },
};
export const scriptKindMeta = (kind) => SCRIPT_KIND_META[kind] || SCRIPT_KIND_META.motion;
 
/**
 * One card per attached ScriptComponent (there can be several on the same
 * entity). Pulled out of UnityInspector.jsx (Step 9) — Add Component lists
 * every script once (tagged with its kind); the runtime dispatches each
 * attached script by its detected contract, so a script written as a React
 * component, a Canvas component, or a motion script always runs correctly,
 * and a half-written script ('unknown') is never hidden while being written.
 */
export function ScriptCard({
  scriptComp,
  scripts,
  isOpen,
  onToggle,
  dragOverCompType,
  handleCardDragStart,
  handleCardDragOver,
  handleCardDrop,
  handleCardDragEnd,
  removeComponent,
  onOpenScriptEditor,
  resolveComponentValues,
  updateScriptProps,
  updateScriptComp,
  selectedEntity,
  currentTime,
  onUpdateEntity,
  entities,
  mediaAssets,
}) {
  const scriptDef = scripts.find((s) => s.id === scriptComp.scriptId);
  const kind = scriptDef ? detectScriptKind(scriptDef.code) : 'unknown';
  const Meta = scriptKindMeta(kind);
  const fields = scriptDef ? extractScriptProps(scriptDef.code) : [];
  const scriptError = scriptDef ? getScriptError(scriptDef.code) : null;
  const bundlePending = scriptDef ? isScriptBundlePending(scriptDef.code) : false;
  const dragKey = `script:${scriptComp.scriptId}`;
 
  return (
    <div className="inspector-card script-highlight">
      <InspectorCardHeader
        icon={<Meta.icon size={13} className={Meta.className} />}
        title={scriptComp.scriptName || Meta.label}
        isOpen={isOpen}
        onToggle={onToggle}
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
              <span>Bundling…</span>
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
 
          {/* Motion-kind scripts follow the Transform's Speed (clip-level
              rate) by default. ignoreParentSpeed is the per-script opt-out:
              when checked, this script's localTime stays on raw timeline
              time while media and sibling scripts run sped up. A
              ScriptComponent-level field (like Enabled), NOT a script prop
              — saved with the component, no migration needed (absent =
              false). Only meaningful for motion kind; react/canvas kinds
              are visual outputs driven by the caller and unaffected. */}
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
}
 