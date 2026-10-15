import { Fragment, useState } from 'react';
import { Link, Unlink, Copy, ClipboardPaste, RotateCcw } from 'lucide-react';
import { InspectorFieldList, TRANSFORM_FIELD_GROUPS } from './InspectorField';
import { InspectorCardHeader } from './InspectorCardHeader';
import { getFieldKeyframes, setKeyframe, removeKeyframe } from '../../engine/keyframes';
import './inspector-polish.css';
 
/**
 * Transform is pinned first and not draggable/reorderable — it's always
 * present (synthesized by the caller if missing), so reordering it
 * relative to other components isn't meaningful. Pulled out of
 * UnityInspector.jsx (Step 9).
 *
 * Extras on top of the plain field list:
 *   - Scale link (aspect-ratio lock) in the Scale row.
 *   - One keyframe diamond per vector row (Position / Scale / Pivot) that
 *     keys every axis at once; single-value rows keep their own diamond.
 *   - 3x3 anchor picker under Pivot.
 *   - Copy / Paste / Reset in the card header.
 */
 
// Round away float noise from ratio math (1.1000000000000001 -> 1.1).
const round4 = (n) => Math.round(n * 10000) / 10000;
 
// Every Transform field except `speed`. Copy / Paste / Reset leave speed
// alone on purpose: writing it also resizes the clip on the timeline
// (see updateTransform in UnityInspector.jsx), which nobody expects from a
// "paste" or a "reset".
const COPYABLE_FIELDS = TRANSFORM_FIELD_GROUPS
  .flatMap((group) => group.fields)
  .filter((field) => field.name !== 'speed');
 
// Module-level so a copy survives selecting another clip (the card stays
// mounted, but a different entity feeds it).
let transformClipboard = null;
 
// Pivot is normalized: -0.5 = left/top edge, 0 = center, +0.5 = right/bottom.
const ANCHOR_STEPS = [-0.5, 0, 0.5];
const ANCHOR_NAMES = [
  ['top left', 'top', 'top right'],
  ['left', 'center', 'right'],
  ['bottom left', 'bottom', 'bottom right'],
];
 
/**
 * One keyframe diamond for a whole vector row. Adds a keyframe on every axis
 * at the playhead, or — when every axis already has one there — removes them.
 * Same snapping / matching rules as InspectorField's per-field diamond.
 */
function VectorKeyframeButton({ label, fields, values, selectedEntity, currentTime, onUpdateEntity }) {
  if (!selectedEntity) return null;
 
  const localTime = Math.max(0, currentTime - selectedEntity.startTime);
  const snapped = Math.round(localTime * 30) / 30;
  const atTime = (k) => Math.abs(k.time - snapped) < 1 / 60;
 
  const perField = fields.map((field) => {
    const kfs = getFieldKeyframes(selectedEntity, 'Transform', field.name);
    return { field, any: kfs.length > 0, here: kfs.find(atTime) };
  });
  const hasKeys = perField.some((p) => p.any);
  const allHere = perField.every((p) => p.here);
 
  const handleToggle = () => {
    let kfs = selectedEntity.keyframes;
    const withKfs = () => ({ ...selectedEntity, keyframes: kfs });
    for (const p of perField) {
      if (allHere) {
        kfs = removeKeyframe(withKfs(), 'Transform', p.field.name, p.here.id);
      } else if (!p.here) {
        const val = values?.[p.field.name] ?? p.field.defaultVal;
        kfs = setKeyframe(withKfs(), 'Transform', p.field.name, snapped, val);
      }
    }
    onUpdateEntity(selectedEntity.id, { keyframes: kfs });
  };
 
  const text = allHere
    ? `Remove ${label} keyframes at current time`
    : `Add ${label} keyframes at current time`;
 
  return (
    <button
      type="button"
      className={`keyframe-btn ${hasKeys ? 'has-keys' : ''} ${allHere ? 'at-current-time' : ''}`}
      onClick={handleToggle}
      aria-pressed={allHere}
      aria-label={text}
      title={text}
    />
  );
}
 
export function TransformCard({
  transformComp,
  isOpen,
  onToggle,
  resolveComponentValues,
  updateTransform,
  selectedEntity,
  currentTime,
  onUpdateEntity,
}) {
  // Scale link: when on, changing Scale X or Y changes the other by the same
  // factor, so the aspect ratio is kept (equal scales stay equal).
  // UI-only state; it is not written into the project.
  const [scaleLinked, setScaleLinked] = useState(false);
  const [hasClipboard, setHasClipboard] = useState(transformClipboard !== null);
 
  const values = resolveComponentValues('Transform', transformComp);
 
  const handleFieldChange = (name, v) => {
    if (scaleLinked && (name === 'scaleX' || name === 'scaleY')) {
      const other = name === 'scaleX' ? 'scaleY' : 'scaleX';
      const oldVal = Number(values?.[name]);
      const otherVal = Number(values?.[other]);
      let next = v;
      if (Number.isFinite(oldVal) && oldVal !== 0 && Number.isFinite(otherVal)) {
        next = round4(otherVal * (v / oldVal));
      }
      updateTransform({ [name]: v, [other]: Number.isFinite(next) ? next : v });
      return;
    }
    updateTransform({ [name]: v });
  };
 
  const handleCopy = () => {
    const snapshot = {};
    COPYABLE_FIELDS.forEach((field) => {
      snapshot[field.name] = values?.[field.name] ?? field.defaultVal;
    });
    transformClipboard = snapshot;
    setHasClipboard(true);
  };
 
  const handlePaste = () => {
    if (transformClipboard) updateTransform({ ...transformClipboard });
  };
 
  const handleReset = () => {
    const defaults = {};
    COPYABLE_FIELDS.forEach((field) => {
      defaults[field.name] = field.defaultVal;
    });
    updateTransform(defaults);
  };
 
  const isAnchorActive = (cx, cy) =>
    Math.abs(Number(values?.pivotX ?? 0) - cx) < 0.001 &&
    Math.abs(Number(values?.pivotY ?? 0) - cy) < 0.001;
 
  return (
    <div className="inspector-card">
      <InspectorCardHeader
        title="Transform"
        isOpen={isOpen}
        onToggle={onToggle}
        actions={
          <>
            <button
              type="button"
              className="card-icon-btn"
              title="Copy transform values"
              aria-label="Copy transform values"
              onClick={handleCopy}
            >
              <Copy size={12} />
            </button>
            <button
              type="button"
              className="card-icon-btn"
              title="Paste transform values"
              aria-label="Paste transform values"
              disabled={!hasClipboard}
              onClick={handlePaste}
            >
              <ClipboardPaste size={12} />
            </button>
            <button
              type="button"
              className="card-icon-btn"
              title="Reset transform (position, rotation, scale, pivot, opacity)"
              aria-label="Reset transform"
              onClick={handleReset}
            >
              <RotateCcw size={12} />
            </button>
          </>
        }
      />
 
      {isOpen && (
        <div className="inspector-card-body">
          {TRANSFORM_FIELD_GROUPS.map((group) => {
            const isScale = group.label === 'Scale';
            const isPivot = group.label === 'Pivot';
            const isVector = group.fields.length > 1;
            return (
              <Fragment key={group.label}>
                <div className="inspector-row">
                  <span
                    className={`row-label${isScale ? ' row-label-with-action' : ''}`}
                    title={group.label}
                  >
                    <span className="row-label-text">{group.label}</span>
                    {isScale && (
                      <button
                        type="button"
                        className={`scale-link-btn${scaleLinked ? ' is-linked' : ''}`}
                        aria-pressed={scaleLinked}
                        aria-label="Link scale X and Y"
                        title={scaleLinked ? 'Scale linked — X and Y change together (click to unlink)' : 'Link scale X and Y'}
                        onClick={() => setScaleLinked((on) => !on)}
                      >
                        {scaleLinked ? <Link size={12} /> : <Unlink size={12} />}
                      </button>
                    )}
                  </span>
                  {/* Always bare: the row already has its label, so the field
                      must not draw a second one (it printed "rotation",
                      "opacity" and "speed" next to the row label). Vector
                      rows hand keyframing to the single row diamond below. */}
                  <div className="drag-number-group">
                    <InspectorFieldList
                      fields={group.fields}
                      values={values}
                      onFieldChange={handleFieldChange}
                      bare
                      trackKey="Transform"
                      selectedEntity={isVector ? undefined : selectedEntity}
                      currentTime={currentTime}
                      onUpdateEntity={onUpdateEntity}
                    />
                    {isVector && (
                      <VectorKeyframeButton
                        label={group.label}
                        fields={group.fields}
                        values={values}
                        selectedEntity={selectedEntity}
                        currentTime={currentTime}
                        onUpdateEntity={onUpdateEntity}
                      />
                    )}
                  </div>
                </div>
                {isPivot && (
                  <div className="inspector-row">
                    <span className="row-label" title="Anchor">Anchor</span>
                    <div className="anchor-grid" role="group" aria-label="Pivot anchor">
                      {ANCHOR_STEPS.map((cy, row) =>
                        ANCHOR_STEPS.map((cx, col) => {
                          const name = ANCHOR_NAMES[row][col];
                          const active = isAnchorActive(cx, cy);
                          return (
                            <button
                              key={`${row}-${col}`}
                              type="button"
                              className={`anchor-cell${active ? ' is-active' : ''}`}
                              aria-pressed={active}
                              aria-label={`Pivot ${name}`}
                              title={`Pivot: ${name}`}
                              onClick={() => updateTransform({ pivotX: cx, pivotY: cy })}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
 