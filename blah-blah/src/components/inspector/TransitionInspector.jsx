import { useEffect, useRef, useState, memo } from 'react';
import {
  Sparkles,
  Maximize2,
  Trash2,
} from 'lucide-react';
import {
  FEATURED_TRANSITIONS,
  ALL_GL_TRANSITIONS,
  getTransitionPreset,
  startTransitionPreviewLoop,
} from '../../engine/glTransitions';
import { DragNumber } from '../DragNumber';
import { OdinPropertyDrawer } from './OdinPropertyDrawer';

export const TransitionInspector = memo(function TransitionInspector({
  component,
  onChange,
  onRemove,
  onOpenPicker,
}) {
  const transitionIn = component.transitionIn || { enabled: true, preset: 'glitchMemories', duration: 0.8, params: {} };
  const transitionOut = component.transitionOut || { enabled: false, preset: 'crossZoom', duration: 0.8, params: {} };

  const [activeTab, setActiveTab] = useState('in'); // 'in' | 'out'
  const currentConfig = activeTab === 'in' ? transitionIn : transitionOut;
  const currentPreset = getTransitionPreset(currentConfig.preset);

  const previewCanvasRef = useRef(null);
  const paramsRef = useRef(currentConfig.params);
  paramsRef.current = currentConfig.params;

  useEffect(() => {
    if (!previewCanvasRef.current) return;
    const cleanup = startTransitionPreviewLoop(
      previewCanvasRef.current,
      currentConfig.preset,
      () => paramsRef.current
    );
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

  const handleParamChange = (name, val) => {
    updateConfig(activeTab, {
      params: {
        ...(currentConfig.params || {}),
        [name]: val,
      },
    });
  };

  const handleResetParams = () => {
    updateConfig(activeTab, {
      params: { ...(currentPreset.defaultParams || {}) },
    });
  };

  return (
    <div className="inspector-card-body transition-inspector-container">
      {/* Unity-Style Segmented Bar for Transition In / Out */}
      <div className="unity-segment-bar">
        <button
          type="button"
          className={`unity-segment-btn ${activeTab === 'in' ? 'active' : ''}`}
          onClick={() => setActiveTab('in')}
        >
          <span className={`segment-dot ${transitionIn.enabled ? 'active' : ''}`} />
          <span>Transition In</span>
        </button>
        <button
          type="button"
          className={`unity-segment-btn ${activeTab === 'out' ? 'active' : ''}`}
          onClick={() => setActiveTab('out')}
        >
          <span className={`segment-dot ${transitionOut.enabled ? 'active' : ''}`} />
          <span>Transition Out</span>
        </button>
      </div>

      {/* Standard Unity Inspector Grid Rows */}
      <div className="inspector-row">
        <span className="row-label">Enabled</span>
        <input
          type="checkbox"
          checked={currentConfig.enabled}
          onChange={(e) => updateConfig(activeTab, { enabled: e.target.checked })}
        />
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
                width={160}
                height={90}
                className="transition-preview-canvas"
              />
            </div>
            <p className="preview-desc">{currentPreset.description}</p>
          </div>

          {/* Preset Selector Dropdown + Browse Gallery Button */}
          <div className="inspector-row">
            <span className="row-label">Shader</span>
            <div className="preset-select-group">
              <select
                className="inspector-select"
                value={currentConfig.preset}
                onChange={(e) => {
                  const nextPreset = getTransitionPreset(e.target.value);
                  updateConfig(activeTab, {
                    preset: e.target.value,
                    params: { ...(nextPreset.defaultParams || {}) },
                  });
                }}
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
                  onClick={() =>
                    onOpenPicker(
                      activeTab,
                      (presetId, params) => {
                        updateConfig(activeTab, {
                          preset: presetId,
                          params: params || {},
                          enabled: true,
                        });
                      },
                      currentConfig.params
                    )
                  }
                >
                  <Maximize2 size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Duration Slider / Scrubber */}
          <div className="inspector-row">
            <span className="row-label">Duration</span>
            <DragNumber
              label="s"
              value={currentConfig.duration}
              onChange={(val) =>
                updateConfig(activeTab, {
                  duration: Math.max(0.1, Math.min(10, Math.round(val * 10) / 10)),
                })
              }
              step={0.1}
              min={0.1}
              max={10}
            />
          </div>

          {/* Odin-Style Dynamic Shader Parameters Inspector */}
          <OdinPropertyDrawer
            paramsTypes={currentPreset.paramsTypes || {}}
            defaultParams={currentPreset.defaultParams || {}}
            values={currentConfig.params || {}}
            onChange={handleParamChange}
            onResetAll={handleResetParams}
            title="Parameters"
          />
        </>
      )}

      {/* Card actions */}
      <div className="transition-inspector-footer">
        <button
          type="button"
          className="remove-comp-link"
          onClick={onRemove}
        >
          <Trash2 size={11} />
          <span>Remove Transition Component</span>
        </button>
      </div>
    </div>
  );
});
