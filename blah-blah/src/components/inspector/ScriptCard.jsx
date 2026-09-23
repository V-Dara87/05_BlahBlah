import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Clock, Trash2, Sparkles, Boxes, FileCode, Check } from 'lucide-react';
import { extractScriptProps, getScriptError, detectScriptKind, isScriptBundlePending } from '../../engine/scriptRunner';
import { invokeScriptAction } from '../../engine/scriptActions';
import { InspectorFieldList } from './InspectorField';
import { InspectorCardHeader } from './InspectorCardHeader';
import './script-card.css';
 
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

/** How long a button's result / error stays on screen, in ms. */
const ACTION_FEEDBACK_MS = 2500;
 
/**
 * One card per attached ScriptComponent (there can be several on the same
 * entity). Pulled out of UnityInspector.jsx (Step 9) — Add Component lists
 * every script once (tagged with its kind); the runtime dispatches each
 * attached script by its detected contract, so a script written as a React
 * component, a Canvas component, or a motion script always runs correctly,
 * and a half-written script ('unknown') is never hidden while being written.
 *
 * The card also hosts script *actions*: a prop declared as
 * `{ type: 'button', action: 'bake' }` (or any field carrying a `button`
 * attribute) calls that method on the script — see engine/scriptActions.js for
 * which object the method runs on, and the ScriptDocs modal for the attribute
 * reference.
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
  setScriptProps,
  updateScriptComp,
  selectedEntity,
  currentTime,
  onUpdateEntity,
  entities,
  mediaAssets,
  tracks = [],
}) {
  const scriptDef = scripts.find((s) => s.id === scriptComp.scriptId);
  const kind = scriptDef ? detectScriptKind(scriptDef.code) : 'unknown';
  const Meta = scriptKindMeta(kind);
  const fields = scriptDef ? extractScriptProps(scriptDef.code) : [];
  const scriptError = scriptDef ? getScriptError(scriptDef.code) : null;
  const bundlePending = scriptDef ? isScriptBundlePending(scriptDef.code) : false;
  const dragKey = `script:${scriptComp.scriptId}`;

  // Resolved once, for the fields and for the action context: a button must see
  // exactly the values the fields show (refs resolved, defaults applied).
  const values = resolveComponentValues(`script:${scriptComp.scriptId}`, scriptComp.props);

  const [feedback, setFeedback] = useState(null);
  const feedbackTimer = useRef(null);

  const showFeedback = useCallback((next) => {
    setFeedback(next);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    if (next) feedbackTimer.current = setTimeout(() => setFeedback(null), ACTION_FEEDBACK_MS);
  }, []);

  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  /**
   * Run one script action. Props written by the action go through
   * `setScriptProps` (a static write), not `updateScriptProps` — a click is not
   * an edit at the playhead, so it must not author a keyframe.
   */
  const handleAction = useCallback((action) => {
    if (!scriptDef || scriptError) {
      showFeedback({ action, ok: false, error: scriptError || 'script is not available' });
      return;
    }

    const localTime = Math.max(0, currentTime - (selectedEntity?.startTime || 0));
    showFeedback({ action, ok: true, pending: true });

    invokeScriptAction({
      scriptCode: scriptDef.code,
      action,
      props: values,
      entityId: selectedEntity?.id,
      scriptId: scriptComp.scriptId,
      entity: selectedEntity,
      setProp: (name, value) => setScriptProps?.(scriptComp.scriptId, { [name]: value }),
      setProps: (patch) => setScriptProps?.(scriptComp.scriptId, patch),
      timing: {
        time: localTime,
        frame: Math.round(localTime * 30),
        fps: 30,
        duration: scriptComp.duration ?? selectedEntity?.duration,
      },
    }).then((result) => {
      showFeedback({
        action,
        ok: result.ok,
        error: result.ok ? null : result.error,
      });
    });
  }, [
    scriptDef, scriptError, values, scriptComp.scriptId, scriptComp.duration,
    selectedEntity, currentTime, setScriptProps, showFeedback,
  ]);
 
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
            values={values}
            onFieldChange={(name, v) => updateScriptProps(scriptComp.scriptId, name, v)}
            emptyHint={<>Expose props with <code>static props = &#123; ... &#125;</code></>}
            trackKey={`script:${scriptComp.scriptId}`}
            selectedEntity={selectedEntity}
            currentTime={currentTime}
            onUpdateEntity={onUpdateEntity}
            entities={entities}
            mediaAssets={mediaAssets}
            tracks={tracks}
            onAction={handleAction}
          />

          {feedback && (
            <div className={`script-action-feedback ${feedback.ok ? 'is-ok' : 'is-error'}`}>
              {feedback.ok ? <Check size={11} /> : <AlertCircle size={11} />}
              <span>
                {feedback.pending
                  ? `${feedback.action}()…`
                  : feedback.ok
                    ? `${feedback.action}() ran`
                    : `${feedback.action}(): ${feedback.error}`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
 