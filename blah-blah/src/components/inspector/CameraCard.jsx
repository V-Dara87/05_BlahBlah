import { Fragment, useState } from 'react';
import { Camera, Trash2, RotateCcw, Target } from 'lucide-react';
import { InspectorCardHeader } from './InspectorCardHeader';
import { DragNumber } from '../shared/DragNumber';
import { FieldContextRow } from './InspectorField';
import { getFieldKeyframes, setKeyframe, removeKeyframe } from '../../engine/keyframes';
import './inspector-polish.css';

/**
 * 3D Camera Component Inspector Card (After Effects-style Viewport Camera).
 *
 * Controls:
 * - Position (X, Y, Z) in 3D world space
 * - Point of Interest / Target (X, Y, Z) the camera aims toward
 * - Field of View (FOV) & Zoom
 * - Quick Presets (35mm, 50mm, Wide, Standard)
 * - Keyframe support on all axes
 */

const CAMERA_PRESETS = [
  { label: '35mm', fov: 54, zoom: 1.0 },
  { label: '50mm', fov: 39, zoom: 1.2 },
  { label: 'Wide', fov: 80, zoom: 0.8 },
  { label: 'Standard', fov: 50, zoom: 1.0 },
];

function CameraVectorKeyframeButton({ label, fields, values, selectedEntity, currentTime, onUpdateEntity }) {
  if (!selectedEntity) return null;

  const localTime = Math.max(0, currentTime - selectedEntity.startTime);
  const snapped = Math.round(localTime * 30) / 30;
  const atTime = (k) => Math.abs(k.time - snapped) < 1 / 60;

  const perField = fields.map((fieldName) => {
    const kfs = getFieldKeyframes(selectedEntity, 'Camera', fieldName);
    return { fieldName, any: kfs.length > 0, here: kfs.find(atTime) };
  });
  const hasKeys = perField.some((p) => p.any);
  const allHere = perField.every((p) => p.here);

  const handleToggle = () => {
    let kfs = selectedEntity.keyframes;
    const withKfs = () => ({ ...selectedEntity, keyframes: kfs });
    for (const p of perField) {
      if (allHere) {
        kfs = removeKeyframe(withKfs(), 'Camera', p.fieldName, p.here.id);
      } else if (!p.here) {
        const val = values?.[p.fieldName] ?? 0;
        kfs = setKeyframe(withKfs(), 'Camera', p.fieldName, snapped, val);
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

export function CameraCard({
  cameraComp,
  isOpen,
  onToggle,
  dragOverCompType,
  handleCardDragStart,
  handleCardDragOver,
  handleCardDrop,
  handleCardDragEnd,
  removeComponent,
  updateComponent,
  resolveComponentValues,
  tryWriteKeyframe,
  selectedEntity,
  currentTime,
  onUpdateEntity,
}) {
  const resolved = resolveComponentValues ? resolveComponentValues('Camera', cameraComp) : cameraComp;

  const posX = resolved?.positionX ?? resolved?.position?.x ?? 0;
  const posY = resolved?.positionY ?? resolved?.position?.y ?? 0;
  const posZ = resolved?.positionZ ?? resolved?.position?.z ?? -1000;

  // Resolve targetOffset relative to camera position
  let offX = resolved?.targetOffsetX ?? resolved?.targetOffset?.x;
  let offY = resolved?.targetOffsetY ?? resolved?.targetOffset?.y;
  let offZ = resolved?.targetOffsetZ ?? resolved?.targetOffset?.z;

  if (offX === undefined || offY === undefined || offZ === undefined) {
    const legX = resolved?.targetX ?? resolved?.target?.x;
    const legY = resolved?.targetY ?? resolved?.target?.y;
    const legZ = resolved?.targetZ ?? resolved?.target?.z;
    if (legX !== undefined || legY !== undefined || legZ !== undefined) {
      offX = (legX ?? 0) - posX;
      offY = (legY ?? 0) - posY;
      offZ = (legZ ?? 0) - posZ;
    } else {
      offX = 0;
      offY = 0;
      offZ = 1000;
    }
  }

  const tgtX = posX + offX;
  const tgtY = posY + offY;
  const tgtZ = posZ + offZ;

  const fov = resolved?.fov ?? 50;
  const zoom = resolved?.zoom ?? 1.0;
  // Roll rotates the view around the camera's own line of sight. It used to be
  // readable only by falling back to the camera entity's Transform rotation,
  // which is also used for parenting/2D layout — so it could not be authored
  // from here without moving the camera's position semantics too.
  const roll = resolved?.roll ?? 0;
  const showGrid = resolved?.showGrid ?? cameraComp?.showGrid ?? false;

  const updateCameraField = (fieldName, value) => {
    if (tryWriteKeyframe) {
      const newKfs = tryWriteKeyframe(selectedEntity, 'Camera', fieldName, value);
      if (newKfs) {
        onUpdateEntity(selectedEntity.id, { keyframes: newKfs });
        return;
      }
    }

    const patch = { [fieldName]: value };
    // Synchronize nested position/targetOffset objects
    if (fieldName === 'positionX') {
      patch.position = { ...(cameraComp.position || {}), x: value, y: posY, z: posZ };
      patch.target = { x: value + offX, y: posY + offY, z: posZ + offZ };
    } else if (fieldName === 'positionY') {
      patch.position = { ...(cameraComp.position || {}), x: posX, y: value, z: posZ };
      patch.target = { x: posX + offX, y: value + offY, z: posZ + offZ };
    } else if (fieldName === 'positionZ') {
      patch.position = { ...(cameraComp.position || {}), x: posX, y: posY, z: value };
      patch.target = { x: posX + offX, y: posY + offY, z: value + offZ };
    } else if (fieldName === 'targetOffsetX') {
      patch.targetOffset = { ...(cameraComp.targetOffset || {}), x: value, y: offY, z: offZ };
      patch.target = { x: posX + value, y: posY + offY, z: posZ + offZ };
    } else if (fieldName === 'targetOffsetY') {
      patch.targetOffset = { ...(cameraComp.targetOffset || {}), x: offX, y: value, z: offZ };
      patch.target = { x: posX + offX, y: posY + value, z: posZ + offZ };
    } else if (fieldName === 'targetOffsetZ') {
      patch.targetOffset = { ...(cameraComp.targetOffset || {}), x: offX, y: offY, z: value };
      patch.target = { x: posX + offX, y: posY + offY, z: posZ + value };
    }

    updateComponent('Camera', patch);
  };

  const handleResetCamera = () => {
    updateComponent('Camera', {
      positionX: 0,
      positionY: 0,
      positionZ: -1000,
      position: { x: 0, y: 0, z: -1000 },
      targetOffsetX: 0,
      targetOffsetY: 0,
      targetOffsetZ: 1000,
      targetOffset: { x: 0, y: 0, z: 1000 },
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      target: { x: 0, y: 0, z: 0 },
      fov: 50,
      zoom: 1.0,
      roll: 0,
      showGrid: false,
    });
  };

  const handleResetForward = () => {
    updateComponent('Camera', {
      targetOffsetX: 0,
      targetOffsetY: 0,
      targetOffsetZ: 1000,
      targetOffset: { x: 0, y: 0, z: 1000 },
      target: { x: posX, y: posY, z: posZ + 1000 },
    });
  };

  const handleAimAtCenter = () => {
    const newOffX = -posX;
    const newOffY = -posY;
    const newOffZ = -posZ;
    updateComponent('Camera', {
      targetOffsetX: newOffX,
      targetOffsetY: newOffY,
      targetOffsetZ: newOffZ,
      targetOffset: { x: newOffX, y: newOffY, z: newOffZ },
      target: { x: 0, y: 0, z: 0 },
    });
  };

  const posField = { name: 'Position', type: 'object', defaultVal: { positionX: 0, positionY: 0, positionZ: -1000 } };
  const posValues = { positionX: posX, positionY: posY, positionZ: posZ };

  const tgtField = { name: 'Target Offset', type: 'object', defaultVal: { targetOffsetX: 0, targetOffsetY: 0, targetOffsetZ: 1000 } };
  const tgtValues = { targetOffsetX: offX, targetOffsetY: offY, targetOffsetZ: offZ };

  return (
    <div className="inspector-card">
      <InspectorCardHeader
        icon={<Camera size={13} style={{ color: '#c084fc' }} />}
        title="3D Camera Component"
        isOpen={isOpen}
        onToggle={onToggle}
        draggable
        isDragOver={dragOverCompType === 'Camera'}
        onDragStart={handleCardDragStart ? handleCardDragStart('Camera') : undefined}
        onDragOver={handleCardDragOver ? handleCardDragOver('Camera') : undefined}
        onDrop={handleCardDrop ? handleCardDrop('Camera') : undefined}
        onDragEnd={handleCardDragEnd}
        actions={
          <>
            <button
              type="button"
              className="card-icon-btn"
              title="Reset camera position & target"
              aria-label="Reset Camera"
              onClick={handleResetCamera}
            >
              <RotateCcw size={12} />
            </button>
            <button
              type="button"
              className="del-btn-sm"
              title="Remove Camera Component"
              onClick={() => removeComponent('Camera')}
            >
              <Trash2 size={11} />
            </button>
          </>
        }
      />

      {isOpen && (
        <div className="inspector-card-body">
          {/* Camera Position (X, Y, Z) */}
          <FieldContextRow
            field={posField}
            value={posValues}
            onChange={(patch) => {
              Object.entries(patch).forEach(([k, v]) => updateCameraField(k, v));
            }}
          >
            <span className="row-label" title="Camera Position">Position</span>
            <div className="drag-number-group">
              <DragNumber
                label="X"
                labelColor="#f87171"
                value={posX}
                step={1}
                onChange={(v) => updateCameraField('positionX', v)}
              />
              <DragNumber
                label="Y"
                labelColor="#4ade80"
                value={posY}
                step={1}
                onChange={(v) => updateCameraField('positionY', v)}
              />
              <DragNumber
                label="Z"
                labelColor="#60a5fa"
                value={posZ}
                step={1}
                onChange={(v) => updateCameraField('positionZ', v)}
              />
              <CameraVectorKeyframeButton
                label="Position"
                fields={['positionX', 'positionY', 'positionZ']}
                values={posValues}
                selectedEntity={selectedEntity}
                currentTime={currentTime}
                onUpdateEntity={onUpdateEntity}
              />
            </div>
          </FieldContextRow>

          {/* Target Offset (dx, dy, dz relative to camera position) */}
          <FieldContextRow
            field={tgtField}
            value={tgtValues}
            onChange={(patch) => {
              Object.entries(patch).forEach(([k, v]) => updateCameraField(k, v));
            }}
          >
            <span className="row-label" title="Target Offset from camera position (dx, dy, dz)">Target Offset</span>
            <div className="drag-number-group">
              <DragNumber
                label="X"
                labelColor="#f87171"
                value={offX}
                step={1}
                onChange={(v) => updateCameraField('targetOffsetX', v)}
              />
              <DragNumber
                label="Y"
                labelColor="#4ade80"
                value={offY}
                step={1}
                onChange={(v) => updateCameraField('targetOffsetY', v)}
              />
              <DragNumber
                label="Z"
                labelColor="#60a5fa"
                value={offZ}
                step={1}
                onChange={(v) => updateCameraField('targetOffsetZ', v)}
              />
              <CameraVectorKeyframeButton
                label="Target Offset"
                fields={['targetOffsetX', 'targetOffsetY', 'targetOffsetZ']}
                values={tgtValues}
                selectedEntity={selectedEntity}
                currentTime={currentTime}
                onUpdateEntity={onUpdateEntity}
              />
            </div>
          </FieldContextRow>

          {/* FOV */}
          <div className="inspector-row">
            <span className="row-label" title="Field of View (Degrees)">FOV</span>
            <div className="inspector-number-slider" style={{ flex: 1, display: 'flex', gap: '6px', alignItems: 'center' }}>
              <DragNumber
                label="°"
                labelColor="#c084fc"
                value={fov}
                min={10}
                max={150}
                step={1}
                onChange={(v) => updateCameraField('fov', v)}
              />
              <input
                type="range"
                className="inspector-range"
                min={10}
                max={150}
                step={1}
                value={fov}
                onChange={(e) => updateCameraField('fov', parseFloat(e.target.value))}
              />
            </div>
          </div>

          {/* Zoom */}
          <div className="inspector-row">
            <span className="row-label" title="Camera Zoom Multiplier">Zoom</span>
            <div className="inspector-number-slider" style={{ flex: 1, display: 'flex', gap: '6px', alignItems: 'center' }}>
              <DragNumber
                label="×"
                labelColor="#38bdf8"
                value={zoom}
                min={0.1}
                max={4.0}
                step={0.05}
                onChange={(v) => updateCameraField('zoom', v)}
              />
              <input
                type="range"
                className="inspector-range"
                min={0.1}
                max={4.0}
                step={0.05}
                value={zoom}
                onChange={(e) => updateCameraField('zoom', parseFloat(e.target.value))}
              />
            </div>
          </div>

          {/* Roll */}
          <div className="inspector-row">
            <span className="row-label" title="Camera Roll (rotation around the line of sight)">Roll</span>
            <div className="inspector-number-slider" style={{ flex: 1, display: 'flex', gap: '6px', alignItems: 'center' }}>
              <DragNumber
                label="°"
                labelColor="#f472b6"
                value={roll}
                min={-180}
                max={180}
                step={1}
                onChange={(v) => updateCameraField('roll', v)}
              />
              <input
                type="range"
                className="inspector-range"
                min={-180}
                max={180}
                step={1}
                value={roll}
                onChange={(e) => updateCameraField('roll', parseFloat(e.target.value))}
              />
            </div>
          </div>

          {/* Ground Grid (Y=0) */}
          <div className="inspector-row">
            <span className="row-label" title="Show Ground Grid (Y=0 world plane)">Ground Grid</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11px', color: '#cbd5e1' }}>
              <input
                type="checkbox"
                checked={Boolean(showGrid)}
                onChange={(e) => updateComponent('Camera', { showGrid: e.target.checked })}
                style={{ cursor: 'pointer', accentColor: '#38bdf8' }}
              />
              <span>Show Ground Grid (Y=0)</span>
            </label>
          </div>

          {/* Lens Presets */}
          <div className="inspector-row">
            <span className="row-label" title="Lens Presets">Lenses</span>
            <div className="inspector-button-strip" role="group" style={{ flex: 1 }}>
              {CAMERA_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={`inspector-strip-btn${Math.abs(fov - preset.fov) < 1 ? ' is-active' : ''}`}
                  onClick={() => {
                    updateCameraField('fov', preset.fov);
                    updateCameraField('zoom', preset.zoom);
                  }}
                  title={`${preset.label} lens (${preset.fov}°, ${preset.zoom}x)`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className="unity-btn unity-btn-secondary"
              style={{ flex: 1, fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
              onClick={handleResetForward}
              title="Reset target offset forward along Z axis (0, 0, 1000)"
            >
              <RotateCcw size={11} />
              <span>Reset Forward</span>
            </button>
            <button
              type="button"
              className="unity-btn unity-btn-secondary"
              style={{ flex: 1, fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
              onClick={handleAimAtCenter}
              title="Aim camera directly at scene center (0, 0, 0)"
            >
              <Target size={11} />
              <span>Aim at (0, 0, 0)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
