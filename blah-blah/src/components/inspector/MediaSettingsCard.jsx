import { Volume2 } from 'lucide-react';
import { DragNumber } from '../shared/DragNumber';
import { InspectorCardHeader } from './InspectorCardHeader';
 
/**
 * Volume-only settings card, rendered once for VideoRenderer and once for
 * AudioSource — same body shape, different `compType`/title/foldout key.
 * Pulled out of UnityInspector.jsx (Step 9) as a single shared component
 * instead of two near-identical copies.
 */
export function MediaSettingsCard({
  compType, // 'VideoRenderer' | 'AudioSource'
  comp,
  title,
  isOpen,
  onToggle,
  dragOverCompType,
  handleCardDragStart,
  handleCardDragOver,
  handleCardDrop,
  handleCardDragEnd,
  updateComponent,
}) {
  return (
    <div className="inspector-card">
      <InspectorCardHeader
        icon={<Volume2 size={13} className="text-emerald" />}
        title={title}
        isOpen={isOpen}
        onToggle={onToggle}
        draggable
        isDragOver={dragOverCompType === compType}
        onDragStart={handleCardDragStart(compType)}
        onDragOver={handleCardDragOver(compType)}
        onDrop={handleCardDrop(compType)}
        onDragEnd={handleCardDragEnd}
      />
      {isOpen && (
        <div className="inspector-card-body">
          <div className="inspector-row">
            <span className="row-label">Volume</span>
            <DragNumber
              label="vol"
              value={parseFloat((comp.volume ?? (compType === 'AudioSource' ? 1 : 0)).toFixed(2))}
              step={0.01}
              min={0}
              max={100}
              onChange={(v) => {
                updateComponent(compType, { volume: v });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
 