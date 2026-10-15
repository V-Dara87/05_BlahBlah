import { useState } from 'react';
import { Link, Unlink } from 'lucide-react';
import { InspectorFieldList, TRANSFORM_FIELD_GROUPS } from './InspectorField';
import { InspectorCardHeader } from './InspectorCardHeader';
 
/**
 * Transform is pinned first and not draggable/reorderable — it's always
 * present (synthesized by the caller if missing), so reordering it
 * relative to other components isn't meaningful. Pulled out of
 * UnityInspector.jsx (Step 9).
 */
 
// Round away float noise from ratio math (1.1000000000000001 -> 1.1).
const round4 = (n) => Math.round(n * 10000) / 10000;
 
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
  // Scale link: when on, changing Scale X or Y changes the other one by the
  // same factor, so the aspect ratio is kept (equal scales stay equal).
  // UI-only state; it is not written into the project.
  const [scaleLinked, setScaleLinked] = useState(false);
 
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
 
  return (
    <div className="inspector-card">
      <InspectorCardHeader
        title="Transform"
        isOpen={isOpen}
        onToggle={onToggle}
      />
 
      {isOpen && (
        <div className="inspector-card-body">
          {TRANSFORM_FIELD_GROUPS.map((group) => {
            const isScale = group.label === 'Scale';
            return (
              <div key={group.label} className="inspector-row">
                <span
                  className="row-label"
                  style={isScale ? { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 } : undefined}
                >
                  {group.label}
                  {isScale && (
                    <button
                      type="button"
                      className={`scale-link-btn ${scaleLinked ? 'is-linked' : ''}`}
                      aria-pressed={scaleLinked}
                      title={scaleLinked ? 'Scale linked — X and Y change together (click to unlink)' : 'Link scale X and Y'}
                      onClick={() => setScaleLinked((on) => !on)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 2,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        color: scaleLinked ? 'var(--accent, #38bdf8)' : 'inherit',
                        opacity: scaleLinked ? 1 : 0.6,
                      }}
                    >
                      {scaleLinked ? <Link size={12} /> : <Unlink size={12} />}
                    </button>
                  )}
                </span>
                {/* Always bare: the row already has its label, so the field
                    must not draw a second one (it printed "rotation",
                    "opacity" and "speed" next to the row label). */}
                <div className="drag-number-group">
                  <InspectorFieldList
                    fields={group.fields}
                    values={values}
                    onFieldChange={handleFieldChange}
                    bare
                    trackKey="Transform"
                    selectedEntity={selectedEntity}
                    currentTime={currentTime}
                    onUpdateEntity={onUpdateEntity}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
 