import { Square, Trash2, Box } from 'lucide-react';
import { DragNumber } from '../shared/DragNumber';
import { InspectorCardHeader } from './InspectorCardHeader';
import { FieldContextRow } from './InspectorField';
import { is3DShape } from '../../engine/geometry3d';
 
// Right-click (copy / paste / reset) schemas for this card's rows. Defaults are
// the same fallbacks the controls already show when a value is missing.
const SHAPE_TYPE_FIELD = {
  name: 'shapeType',
  type: 'select',
  options: ['rect', 'rounded-rect', 'circle', 'cube', 'cylinder', 'pyramid', 'sphere'],
  defaultVal: 'rect',
};
const SHAPE_SIZE_FIELD = { name: 'size', type: 'object', defaultVal: { width: 140, height: 140, depth: 140 } };
const SHAPE_FILL_FIELD = { name: 'color', type: 'color', defaultVal: '#ffffff' };
const SHAPE_ROUND_FIELD = { name: 'borderRadius', type: 'number', min: 0, step: 1, defaultVal: 0 };
const SHAPE_STROKE_COLOR_FIELD = { name: 'strokeColor', type: 'color', defaultVal: '#38bdf8' };
const SHAPE_STROKE_W_FIELD = { name: 'strokeWidth', type: 'number', min: 0, defaultVal: 0 };
const SHAPE_SHADING_FIELD = { name: 'shading', type: 'select', options: ['lit', 'flat', 'wireframe'], defaultVal: 'lit' };
const SHAPE_ROTATION_FIELD = { name: 'rotation3d', type: 'object', defaultVal: { rotationX: 25, rotationY: -35, rotationZ: 0 } };

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
  const is3D = is3DShape(shapeComp?.shapeType);

  return (
    <div className="inspector-card">
      <InspectorCardHeader
        icon={is3D ? <Box size={13} style={{ color: '#c084fc' }} /> : <Square size={13} className="text-cyan" />}
        title={is3D ? '3D Shape Component' : 'Shape Component'}
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
              onChange={(e) => {
                const nextType = e.target.value;
                const nextIs3D = is3DShape(nextType);
                updateComponent('ShapeRenderer', {
                  shapeType: nextType,
                  ...(nextIs3D && shapeComp.rotationX === undefined ? { rotationX: 25, rotationY: -35 } : {}),
                });
              }}
            >
              <optgroup label="2D Shapes">
                <option value="rect">Rectangle</option>
                <option value="rounded-rect">Rounded Rect</option>
                <option value="circle">Circle</option>
              </optgroup>
              <optgroup label="3D Shapes">
                <option value="cube">3D Cube / Box</option>
                <option value="cylinder">3D Cylinder</option>
                <option value="pyramid">3D Pyramid</option>
                <option value="sphere">3D Sphere</option>
              </optgroup>
            </select>
          </FieldContextRow>

          <FieldContextRow
            field={SHAPE_SIZE_FIELD}
            value={{ width: shapeComp.width ?? 140, height: shapeComp.height ?? 140, depth: shapeComp.depth ?? (shapeComp.width ?? 140) }}
            onChange={(v) => {
              const w = Number(v?.width);
              const h = Number(v?.height);
              const d = Number(v?.depth);
              updateComponent('ShapeRenderer', {
                ...(Number.isFinite(w) ? { width: Math.max(1, Math.round(w)) } : {}),
                ...(Number.isFinite(h) ? { height: Math.max(1, Math.round(h)) } : {}),
                ...(Number.isFinite(d) ? { depth: Math.max(1, Math.round(d)) } : {}),
              });
            }}
          >
            <span className="row-label">Size</span>
            <div className="drag-number-group">
              <DragNumber
                label="W"
                labelColor="#f87171"
                value={shapeComp.width ?? 140}
                step={1}
                min={1}
                onChange={(v) => updateComponent('ShapeRenderer', { width: Math.round(v) })}
              />
              <DragNumber
                label="H"
                labelColor="#4ade80"
                value={shapeComp.height ?? 140}
                step={1}
                min={1}
                onChange={(v) => updateComponent('ShapeRenderer', { height: Math.round(v) })}
              />
              {is3D && (
                <DragNumber
                  label="D"
                  labelColor="#60a5fa"
                  value={shapeComp.depth ?? shapeComp.width ?? 140}
                  step={1}
                  min={1}
                  onChange={(v) => updateComponent('ShapeRenderer', { depth: Math.round(v) })}
                />
              )}
            </div>
          </FieldContextRow>

          {is3D && (
            <FieldContextRow
              field={SHAPE_ROTATION_FIELD}
              value={{
                rotationX: shapeComp.rotationX ?? 25,
                rotationY: shapeComp.rotationY ?? -35,
                rotationZ: shapeComp.rotationZ ?? 0,
              }}
              onChange={(v) => {
                const rx = Number(v?.rotationX);
                const ry = Number(v?.rotationY);
                const rz = Number(v?.rotationZ);
                updateComponent('ShapeRenderer', {
                  ...(Number.isFinite(rx) ? { rotationX: Math.round(rx) } : {}),
                  ...(Number.isFinite(ry) ? { rotationY: Math.round(ry) } : {}),
                  ...(Number.isFinite(rz) ? { rotationZ: Math.round(rz) } : {}),
                });
              }}
            >
              <span className="row-label">3D Tilt</span>
              <div className="drag-number-group">
                <DragNumber
                  label="X°"
                  labelColor="#f87171"
                  value={shapeComp.rotationX ?? 25}
                  step={1}
                  onChange={(v) => updateComponent('ShapeRenderer', { rotationX: Math.round(v) })}
                />
                <DragNumber
                  label="Y°"
                  labelColor="#4ade80"
                  value={shapeComp.rotationY ?? -35}
                  step={1}
                  onChange={(v) => updateComponent('ShapeRenderer', { rotationY: Math.round(v) })}
                />
                <DragNumber
                  label="Z°"
                  labelColor="#60a5fa"
                  value={shapeComp.rotationZ ?? 0}
                  step={1}
                  onChange={(v) => updateComponent('ShapeRenderer', { rotationZ: Math.round(v) })}
                />
              </div>
            </FieldContextRow>
          )}

          {is3D && (
            <FieldContextRow
              field={SHAPE_SHADING_FIELD}
              value={shapeComp.shading || 'lit'}
              onChange={(v) => updateComponent('ShapeRenderer', { shading: v })}
            >
              <span className="row-label">Shading</span>
              <select
                className="inspector-select"
                value={shapeComp.shading || 'lit'}
                onChange={(e) => updateComponent('ShapeRenderer', { shading: e.target.value })}
              >
                <option value="lit">Lit (Directional Lighting)</option>
                <option value="flat">Flat Color</option>
                <option value="wireframe">Wireframe Mesh</option>
              </select>
            </FieldContextRow>
          )}
 
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
 
          {!is3D && shapeComp.shapeType !== 'circle' && (
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
 