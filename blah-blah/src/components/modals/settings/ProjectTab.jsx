import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { RESOLUTION_PRESETS, DEFAULT_RESOLUTION } from '../../../types';
 
/**
 * Project tab — lets the user change the project's canvas resolution
 * mid-project, not just at creation time (see NewProjectModal, which
 * offers the same preset picker for the initial pick). App.jsx's
 * `resolution` state already flows straight into projectState (what
 * gets persisted to project.json) and into EntityRenderer's preview
 * frame, so applying a change here is just a `setResolution` call —
 * no separate "apply" step or reload needed.
 *
 * Existing clips are NOT repositioned or rescaled when resolution
 * changes: their Transform values are pixel-space coordinates set
 * against the OLD canvas size, so a same-aspect-ratio change (e.g.
 * 1080p -> 4K) still looks right, but a differently-shaped canvas
 * (e.g. 16:9 -> 9:16) will leave clips sitting in what are now the
 * wrong positions. We warn before applying in that case rather than
 * attempting an automatic re-layout, which would be guessing at
 * intent (crop? letterbox? re-center?) the user hasn't stated.
 */
export function ProjectTab({ resolution, onResolutionChange }) {
  const current = resolution?.width > 0 && resolution?.height > 0 ? resolution : DEFAULT_RESOLUTION;
 
  const matchingPreset = RESOLUTION_PRESETS.find(
    (p) => p.width === current.width && p.height === current.height
  );
 
  const [resolutionId, setResolutionId] = useState(matchingPreset ? matchingPreset.id : 'custom');
  const [customWidth, setCustomWidth] = useState(current.width);
  const [customHeight, setCustomHeight] = useState(current.height);
  const [pendingWarning, setPendingWarning] = useState(null); // { width, height } awaiting confirmation
 
  const isCustomResolution = resolutionId === 'custom';
  const selectedPreset = RESOLUTION_PRESETS.find((p) => p.id === resolutionId) || RESOLUTION_PRESETS[0];
  const nextResolution = isCustomResolution
    ? {
        width: Math.max(1, Math.round(customWidth) || DEFAULT_RESOLUTION.width),
        height: Math.max(1, Math.round(customHeight) || DEFAULT_RESOLUTION.height),
      }
    : { width: selectedPreset.width, height: selectedPreset.height };
 
  const isDirty = nextResolution.width !== current.width || nextResolution.height !== current.height;
 
  // Aspect ratios within this tolerance are treated as "the same shape"
  // (absorbs rounding noise from custom width/height entry) and skip the
  // warning; anything wider counts as a reshape that will misplace clips.
  const ASPECT_EPSILON = 0.01;
  const aspectChanged =
    isDirty && Math.abs(current.width / current.height - nextResolution.width / nextResolution.height) > ASPECT_EPSILON;
 
  const applyResolution = (res) => {
    onResolutionChange?.(res);
    setPendingWarning(null);
  };
 
  const handleApply = () => {
    if (!isDirty) return;
    if (aspectChanged) {
      setPendingWarning(nextResolution);
      return;
    }
    applyResolution(nextResolution);
  };
 
  return (
    <div className="modal-body settings-body">
      {pendingWarning && (
        <div className="modal-alert-box error">
          <AlertCircle size={14} />
          <span>
            Switching to {pendingWarning.width} × {pendingWarning.height} changes the canvas's aspect ratio.
            Existing clips keep their current Transform values and won't be repositioned, so they may end up
            framed incorrectly. Continue anyway?
          </span>
          <div className="shortcut-conflict-actions">
            <button type="button" className="btn-secondary btn-xs" onClick={() => setPendingWarning(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary-create btn-xs"
              onClick={() => applyResolution(pendingWarning)}
            >
              Change Resolution
            </button>
          </div>
        </div>
      )}
 
      <div className="form-field-group">
        <label className="form-label">Resolution</label>
        <p className="hint-text-sm settings-hint-below">
          Current: {current.width} × {current.height}
        </p>
        <select
          className="modal-text-input"
          value={resolutionId}
          onChange={(e) => setResolutionId(e.target.value)}
        >
          {RESOLUTION_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        {isCustomResolution && (
          <div className="custom-resolution-row">
            <input
              type="number"
              className="modal-text-input custom-resolution-input"
              value={customWidth}
              min={1}
              onChange={(e) => setCustomWidth(e.target.value)}
              placeholder="Width"
              aria-label="Custom width in pixels"
            />
            <span className="custom-resolution-sep">×</span>
            <input
              type="number"
              className="modal-text-input custom-resolution-input"
              value={customHeight}
              min={1}
              onChange={(e) => setCustomHeight(e.target.value)}
              placeholder="Height"
              aria-label="Custom height in pixels"
            />
            <span className="custom-resolution-unit">px</span>
          </div>
        )}
      </div>
 
      <button
        type="button"
        className="btn-primary-create"
        disabled={!isDirty}
        onClick={handleApply}
      >
        Apply Resolution
      </button>
    </div>
  );
}