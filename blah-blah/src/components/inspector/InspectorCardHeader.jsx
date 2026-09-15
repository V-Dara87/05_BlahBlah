import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
 
/**
 * Shared foldout + drag-handle chrome for every Inspector component card.
 * Pulled out of UnityInspector.jsx (Step 9) alongside the per-card body
 * components — every card (Transform, TextRenderer, ShapeRenderer, media
 * settings, TransitionComponent, SubtitleTrack, ScriptComponent) renders
 * through this same header with its own foldout key, so a single fix here
 * (e.g. the collapse/expand + drag-reorder support added in the earlier
 * bugfix pass) applies uniformly to all of them.
 */
export function InspectorCardHeader({
  icon,
  title,
  isOpen,
  onToggle,
  actions,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragOver = false
}) {
  return (
    <div
      className={`inspector-card-header${isDragOver ? ' drag-over' : ''}`}
      onClick={onToggle}
      onDragOver={draggable ? onDragOver : undefined}
      onDrop={draggable ? onDrop : undefined}
    >
      <div className="card-title-group">
        {draggable && (
          <span
            className="card-drag-handle"
            draggable
            onClick={(e) => e.stopPropagation()}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <GripVertical size={12} />
          </span>
        )}
        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {icon}
        <span className="card-title-text">{title}</span>
      </div>
      {actions && (
        <div className="card-actions-group" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}
 