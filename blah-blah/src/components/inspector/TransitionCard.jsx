import { Sparkles, Trash2 } from 'lucide-react';
import { TransitionInspector } from './TransitionInspector';
import { InspectorCardHeader } from './InspectorCardHeader';
 
export function TransitionCard({
  transitionComp,
  isOpen,
  onToggle,
  dragOverCompType,
  handleCardDragStart,
  handleCardDragOver,
  handleCardDrop,
  handleCardDragEnd,
  removeComponent,
  updateComponent,
  openPicker,
}) {
  return (
    <div className="inspector-card">
      <InspectorCardHeader
        icon={<Sparkles size={13} className="text-amber" />}
        title="GL Transition"
        isOpen={isOpen}
        onToggle={onToggle}
        draggable
        isDragOver={dragOverCompType === 'TransitionComponent'}
        onDragStart={handleCardDragStart('TransitionComponent')}
        onDragOver={handleCardDragOver('TransitionComponent')}
        onDrop={handleCardDrop('TransitionComponent')}
        onDragEnd={handleCardDragEnd}
        actions={
          <button className="del-btn-sm" onClick={() => removeComponent('TransitionComponent')}>
            <Trash2 size={11} />
          </button>
        }
      />
      {isOpen && (
        <TransitionInspector
          component={transitionComp}
          onChange={(updates) => updateComponent('TransitionComponent', updates)}
          onRemove={() => removeComponent('TransitionComponent')}
          onOpenPicker={openPicker}
        />
      )}
    </div>
  );
}
 