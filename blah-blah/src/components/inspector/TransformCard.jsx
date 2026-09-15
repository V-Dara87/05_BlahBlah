import { InspectorFieldList, TRANSFORM_FIELD_GROUPS } from './InspectorField';
import { InspectorCardHeader } from './InspectorCardHeader';
 
/**
 * Transform is pinned first and not draggable/reorderable — it's always
 * present (synthesized by the caller if missing), so reordering it
 * relative to other components isn't meaningful. Pulled out of
 * UnityInspector.jsx (Step 9).
 */
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
  return (
    <div className="inspector-card">
      <InspectorCardHeader
        title="Transform"
        isOpen={isOpen}
        onToggle={onToggle}
      />
 
      {isOpen && (
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
  );
}
 