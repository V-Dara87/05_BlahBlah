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

  const tgtX = resolved?.targetX ?? resolved?.target?.x ?? 0;
  const tgtY = resolved?.targetY ?? resolved?.target?.y ?? 0;
  const tgtZ = resolved?.targetZ ?? resolved?.target?.z ?? 0;

  const fov = resolved?.fov ?? 50;
  const zoom = resolved?.zoom ?? 1.0;

  const updateCameraField = (fieldName, value) => {
    const newKfs = tryWriteKeyframe ? tryWriteKeyframe(selectedEntity, 'Camera', fieldName, value) : null;
    if (newKfs) {
      onUpdateEntity(selectedEntity.id, { keyframes: newKfs });
    } else {
      const patch = { [fieldName]: value };
      // Also sync nested objects for complete compatibility
      if (fieldName === 'positionX') patch.position = { ...(cameraComp.position || {}), x: value, y: posY, z: posZ };
      else if (fieldName === 'positionY') patch.position = { ...(cameraComp.position || {}), x: posX, y: value, z: posZ };
      else if (fieldName === 'positionZ') patch.position = { ...(cameraComp.position || {}), x: posX, y: posY, z: value };
      else if (fieldName === 'targetX') patch.target = { ...(cameraComp.target || {}), x: value, y: tgtY, z: tgtZ };
      else if (fieldName === 'targetY') patch.target = { ...(cameraComp.target || {}), x: tgtX, y: value, z: tgtZ };
      else if (fieldName === 'targetZ') patch.target = { ...(cameraComp.target || {}), x: tgtX, y: tgtY, z: value };

      updateComponent('Camera', patch);
    }
  };

  const handleResetCamera = () => {
    updateComponent('Camera', {
      positionX: 0,
      positionY: 0,
      positionZ: -1000,
      position: { x: 0, y: 0, z: -1000 },
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      target: { x: 0, y: 0, z: 0 },
      fov: 50,
      zoom: 1.0,
    });
  };

  const handleAimAtCenter = () => {
    updateComponent('Camera', {
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      target: { x: 0, y: 0, z: 0 },
    });
  };

  const posField = { name: 'Position', type: 'object', defaultVal: { positionX: 0, positionY: 0, positionZ: -1000 } };
  const posValues = { positionX: posX, positionY: posY, positionZ: posZ };

  const tgtField = { name: 'Target', type: 'object', defaultVal: { targetX: 0, targetY: 0, targetZ: 0 } };
  const tgtValues = { targetX: tgtX, targetY: tgtY, targetZ: tgtZ };

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

          {/* Point of Interest / Target (X, Y, Z) */}
          <FieldContextRow
            field={tgtField}
            value={tgtValues}
            onChange={(patch) => {
              Object.entries(patch).forEach(([k, v]) => updateCameraField(k, v));
            }}
          >
            <span className="row-label" title="Point of Interest (Look-At Target)">Target</span>
            <div className="drag-number-group">
              <DragNumber
                label="X"
                labelColor="#f87171"
                value={tgtX}
                step={1}
                onChange={(v) => updateCameraField('targetX', v)}
              />
              <DragNumber
                label="Y"
                labelColor="#4ade80"
                value={tgtY}
                step={1}
                onChange={(v) => updateCameraField('targetY', v)}
              />
              <DragNumber
                label="Z"
                labelColor="#60a5fa"
                value={tgtZ}
                step={1}
                onChange={(v) => updateCameraField('targetZ', v)}
              />
              <CameraVectorKeyframeButton
                label="Target"
                fields={['targetX', 'targetY', 'targetZ']}
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
