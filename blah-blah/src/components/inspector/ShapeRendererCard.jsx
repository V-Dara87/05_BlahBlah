import { Square, Trash2 } from 'lucide-react';
import { DragNumber } from '../shared/DragNumber';
import { InspectorCardHeader } from './InspectorCardHeader';
import { FieldContextRow } from './InspectorField';
 
// Right-click (copy / paste / reset) schemas for this card's rows. Defaults are
// the same fallbacks the controls already show when a value is missing.
const SHAPE_TYPE_FIELD = { name: 'shapeType', type: 'select', options: ['rounded-rect', 'circle', 'rect'], defaultVal: 'rect' };
const SHAPE_SIZE_FIELD = { name: 'size', type: 'object', defaultVal: { width: 140, height: 140 } };
const SHAPE_FILL_FIELD = { name: 'color', type: 'color', defaultVal: '#ffffff' };
const SHAPE_ROUND_FIELD = { name: 'borderRadius', type: 'number', min: 0, step: 1, defaultVal: 0 };
const SHAPE_STROKE_COLOR_FIELD = { name: 'strokeColor', type: 'color', defaultVal: '#38bdf8' };
const SHAPE_STROKE_W_FIELD = { name: 'strokeWidth', type: 'number', min: 0, defaultVal: 0 };

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
          <FieldContextRow
            field={SHAPE_TYPE_FIELD}
            value={shapeComp.shapeType || 'rect'}
            onChange={(v) => updateComponent('ShapeRenderer', { shapeType: v })}
          >
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
          </FieldContextRow>
 
          <FieldContextRow
            field={SHAPE_SIZE_FIELD}
            value={{ width: shapeComp.width ?? 140, height: shapeComp.height ?? 140 }}
            onChange={(v) => {
              const w = Number(v?.width);
              const h = Number(v?.height);
              updateComponent('ShapeRenderer', {
                ...(Number.isFinite(w) ? { width: Math.max(1, Math.round(w)) } : {}),
                ...(Number.isFinite(h) ? { height: Math.max(1, Math.round(h)) } : {}),
              });
            }}
          >
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
          </FieldContextRow>
 
          <FieldContextRow
            field={SHAPE_FILL_FIELD}
            value={shapeComp.color || '#ffffff'}
            onChange={(v) => updateComponent('ShapeRenderer', { color: v })}
          >
            <span className="row-label">Fill Color</span>
            <input
              type="color"
              className="inspector-color-input"
              value={shapeComp.color || '#ffffff'}
              onChange={(e) => updateComponent('ShapeRenderer', { color: e.target.value })}
            />
          </FieldContextRow>
 
          {shapeComp.shapeType !== 'circle' && (
            <FieldContextRow
              field={SHAPE_ROUND_FIELD}
              value={shapeComp.borderRadius ?? 0}
              onChange={(v) => updateComponent('ShapeRenderer', { borderRadius: Math.round(v) })}
            >
              <span className="row-label">Roundness</span>
              <DragNumber
                label="px"
                value={shapeComp.borderRadius ?? 0}
                step={1}
                min={0}
                max={Math.min(shapeComp.width ?? 140, shapeComp.height ?? 140) / 2}
                onChange={(v) => updateComponent('ShapeRenderer', { borderRadius: Math.round(v) })}
              />
            </FieldContextRow>
          )}
 
          <FieldContextRow
            field={SHAPE_STROKE_COLOR_FIELD}
            value={shapeComp.strokeColor || '#38bdf8'}
            onChange={(v) => updateComponent('ShapeRenderer', { strokeColor: v })}
          >
            <span className="row-label">Stroke Color</span>
            <input
              type="color"
              className="inspector-color-input"
              value={shapeComp.strokeColor || '#38bdf8'}
              onChange={(e) => updateComponent('ShapeRenderer', { strokeColor: e.target.value })}
            />
          </FieldContextRow>
 
          <FieldContextRow
            field={SHAPE_STROKE_W_FIELD}
            value={shapeComp.strokeWidth ?? 0}
            onChange={(v) => updateComponent('ShapeRenderer', { strokeWidth: v })}
          >
            <span className="row-label">Stroke W</span>
            <DragNumber
              label="px"
              value={shapeComp.strokeWidth ?? 0}
              step={0.5}
              min={0}
              onChange={(v) => updateComponent('ShapeRenderer', { strokeWidth: v })}
            />
          </FieldContextRow>
        </div>
      )}
    </div>
  );
}
 