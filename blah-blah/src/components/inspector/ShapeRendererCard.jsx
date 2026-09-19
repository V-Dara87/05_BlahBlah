import { Square, Trash2 } from 'lucide-react';
import { DragNumber } from '../shared/DragNumber';
import { InspectorCardHeader } from './InspectorCardHeader';
 
export function ShapeRendererCard({
  shapeComp,
  isOpen,
  onToggle,
  dragOverCompType,
  handleCardDragStart,
  handleCardDragOver,
  handleCardDrop,
  handleCardDragEnd,
  removeComponent,
  updateComponent,
}) {
  return (
    <div className="inspector-card">
      <InspectorCardHeader
        icon={<Square size={13} className="text-cyan" />}
        title="Shape Component"
        isOpen={isOpen}
        onToggle={onToggle}
        draggable
        isDragOver={dragOverCompType === 'ShapeRenderer'}
        onDragStart={handleCardDragStart('ShapeRenderer')}
        onDragOver={handleCardDragOver('ShapeRenderer')}
        onDrop={handleCardDrop('ShapeRenderer')}
        onDragEnd={handleCardDragEnd}
        actions={
          <button className="del-btn-sm" onClick={() => removeComponent('ShapeRenderer')}>
            <Trash2 size={11} />
          </button>
        }
      />
 
      {isOpen && (
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
              value={shapeComp.color || '#ffffff'}
              onChange={(e) => updateComponent('ShapeRenderer', { color: e.target.value })}
            />
          </div>
 
          {shapeComp.shapeType !== 'circle' && (
            <div className="inspector-row">
              <span className="row-label">Roundness</span>
              <DragNumber
                label="px"
                value={shapeComp.borderRadius ?? 0}
                step={1}
                min={0}
                max={Math.min(shapeComp.width ?? 140, shapeComp.height ?? 140) / 2}
                onChange={(v) => updateComponent('ShapeRenderer', { borderRadius: Math.round(v) })}
              />
            </div>
          )}
 
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
      )}
    </div>
  );
}
 