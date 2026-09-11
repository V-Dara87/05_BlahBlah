import { useEffect, useRef, useState, memo } from 'react';
import {
  Sparkles,
  Sliders,
  ChevronDown,
  Layers,
  Clock,
  Eye,
  Maximize2,
  Trash2,
  Check,
} from 'lucide-react';
import {
  FEATURED_TRANSITIONS,
  ALL_GL_TRANSITIONS,
  getTransitionPreset,
  startTransitionPreviewLoop,
} from '../../engine/glTransitions';
import { DragNumber } from '../DragNumber';

export const TransitionInspector = memo(function TransitionInspector({
  component,
  onChange,
  onRemove,
  onOpenPicker,
}) {
  const transitionIn = component.transitionIn || { enabled: true, preset: 'glitchMemories', duration: 0.8 };
  const transitionOut = component.transitionOut || { enabled: false, preset: 'crossZoom', duration: 0.8 };

  const [activeTab, setActiveTab] = useState('in'); // 'in' | 'out'
  const currentConfig = activeTab === 'in' ? transitionIn : transitionOut;
  const currentPreset = getTransitionPreset(currentConfig.preset);

  const previewCanvasRef = useRef(null);

  useEffect(() => {
    if (!previewCanvasRef.current) return;
    const cleanup = startTransitionPreviewLoop(previewCanvasRef.current, currentConfig.preset);
    return cleanup;
  }, [currentConfig.preset, activeTab]);

  const updateConfig = (tab, updates) => {
    if (tab === 'in') {
      onChange({
        ...component,
        transitionIn: { ...transitionIn, ...updates },
      });
    } else {
      onChange({
        ...component,
        transitionOut: { ...transitionOut, ...updates },
      });
    }
  };

  return (
    <div className="transition-inspector-body">
      {/* Tab bar for Transition In vs Out */}
      <div className="transition-tabs-bar">
        <button
          type="button"
          className={`transition-tab-btn ${activeTab === 'in' ? 'active' : ''} ${transitionIn.enabled ? 'has-enabled' : ''}`}
          onClick={() => setActiveTab('in')}
        >
          <span className="tab-indicator" />
          <span>Transition In</span>
          {transitionIn.enabled && <span className="tab-badge">ON</span>}
        </button>
        <button
          type="button"
          className={`transition-tab-btn ${activeTab === 'out' ? 'active' : ''} ${transitionOut.enabled ? 'has-enabled' : ''}`}
          onClick={() => setActiveTab('out')}
        >
          <span className="tab-indicator" />
          <span>Transition Out</span>
          {transitionOut.enabled && <span className="tab-badge">ON</span>}
        </button>
      </div>

      {/* Main active tab controls */}
      <div className="transition-tab-content">
        {/* Enable / Disable toggle row */}
        <div className="inspector-field-row">
          <label className="field-label">Enable</label>
          <div className="field-control">
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={currentConfig.enabled}
                onChange={(e) => updateConfig(activeTab, { enabled: e.target.checked })}
              />
              <span className="slider round" />
            </label>
            <span className="toggle-label-text">
              {currentConfig.enabled ? 'Active on clip' : 'Disabled'}
            </span>
          </div>
        </div>

        {currentConfig.enabled && (
          <>
            {/* Live Interactive Shader Preview Card */}
            <div className="transition-preview-box">
              <div className="transition-preview-header">
                <span className="preview-preset-title">{currentPreset.name}</span>
                <span className="preview-preset-cat">{currentPreset.category}</span>
              </div>
              <div className="transition-canvas-wrapper">
                <canvas
                  ref={previewCanvasRef}
                  width={140}
                  height={80}
                  className="transition-preview-canvas"
                />
              </div>
              <p className="preview-desc">{currentPreset.description}</p>
            </div>

            {/* Preset Selector Dropdown + Browse Gallery Button */}
            <div className="inspector-field-row">
              <label className="field-label">Shader</label>
              <div className="field-control preset-select-group">
                <select
                  className="inspector-select"
                  value={currentConfig.preset}
                  onChange={(e) => updateConfig(activeTab, { preset: e.target.value })}
                >
                  <optgroup label="Featured Presets">
                    {FEATURED_TRANSITIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.category})
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="All Transitions">
                    {ALL_GL_TRANSITIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {onOpenPicker && (
                  <button
                    type="button"
                    className="gallery-open-btn"
                    title="Browse all transition presets visually"
                    onClick={() => onOpenPicker(activeTab, (presetId) => updateConfig(activeTab, { preset: presetId }))}
                  >
                    <Maximize2 size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Duration Slider / Scrubber */}
            <div className="inspector-field-row">
              <label className="field-label">Duration</label>
              <div className="field-control">
                <DragNumber
                  value={currentConfig.duration}
                  onChange={(val) => updateConfig(activeTab, { duration: Math.max(0.1, Math.min(10, Math.round(val * 10) / 10)) })}
                  step={0.1}
                  min={0.1}
                  max={10}
                  unit="s"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Card actions */}
      <div className="transition-inspector-footer">
        <button
          type="button"
          className="remove-comp-link"
          onClick={onRemove}
        >
          <Trash2 size={12} />
          <span>Remove Transition Component</span>
        </button>
      </div>
    </div>
  );
});
