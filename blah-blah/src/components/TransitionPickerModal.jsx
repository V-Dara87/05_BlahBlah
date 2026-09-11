import { useState, useRef, useEffect, useMemo, memo } from 'react';
import {
  X,
  Search,
  Sparkles,
  Zap,
  Maximize2,
  Film,
  Layers,
  Package,
  Play,
  Pause,
  Repeat,
  RotateCcw,
  Check,
  Sliders,
} from 'lucide-react';
import {
  ALL_GL_TRANSITIONS,
  FEATURED_TRANSITIONS,
  GL_CATEGORIES,
  getTransitionPreset,
  startTransitionPreviewLoop,
  renderTransitionFrame,
} from '../engine/glTransitions';
import { OdinPropertyDrawer } from './inspector/OdinPropertyDrawer';

// Map categories to visual icons and color accents
function getCategoryMeta(category) {
  switch (category) {
    case 'Glitch & Sci-Fi':
      return { icon: Zap, colorClass: 'cat-amber', label: 'Glitch' };
    case 'Warp & Zoom':
      return { icon: Maximize2, colorClass: 'cat-cyan', label: 'Warp' };
    case 'Distortion & Fluid':
      return { icon: Sparkles, colorClass: 'cat-emerald', label: 'Distortion' };
    case 'Wipes':
      return { icon: Sliders, colorClass: 'cat-indigo', label: 'Wipe' };
    case 'Retro & Stylized':
      return { icon: Film, colorClass: 'cat-rose', label: 'Retro' };
    case 'Basic':
      return { icon: Layers, colorClass: 'cat-slate', label: 'Basic' };
    default:
      return { icon: Package, colorClass: 'cat-blue', label: 'Library' };
  }
}

export const TransitionPickerModal = memo(function TransitionPickerModal({
  isOpen,
  onClose,
  targetSlot = 'in',
  onApplyPreset,
  currentPresetId,
  initialParams,
}) {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState(currentPresetId || 'glitchMemories');

  // Selected preset metadata
  const selectedPreset = useMemo(() => getTransitionPreset(selectedId), [selectedId]);

  // Current tweaked parameters state for the selected preset
  const [tweakedParams, setTweakedParams] = useState(() => ({
    ...(selectedPreset.defaultParams || {}),
    ...(initialParams || {}),
  }));

  // Transport and preview scrubber state
  const [isPlaying, setIsPlaying] = useState(true);
  const [previewProgress, setPreviewProgress] = useState(0);
  const previewCanvasRef = useRef(null);

  // Keep latest params in ref for WebGL loop callback
  const paramsRef = useRef(tweakedParams);
  useEffect(() => {
    paramsRef.current = tweakedParams;
  }, [tweakedParams]);

  // Sync selectedId when modal opens with new preset
  useEffect(() => {
    if (isOpen) {
      const targetId = currentPresetId || 'glitchMemories';
      setSelectedId(targetId);
      const preset = getTransitionPreset(targetId);
      setTweakedParams({
        ...(preset.defaultParams || {}),
        ...(initialParams || {}),
      });
      setIsPlaying(true);
    }
  }, [isOpen, currentPresetId, initialParams]);

  // When user switches preset from the master list
  const handleSelectPreset = (id) => {
    setSelectedId(id);
    const nextPreset = getTransitionPreset(id);
    setTweakedParams({ ...(nextPreset.defaultParams || {}) });
    setIsPlaying(true);
  };

  // WebGL Live Preview Animation Loop
  useEffect(() => {
    if (!isOpen || !previewCanvasRef.current) return;
    if (!isPlaying) {
      // Render static frame at previewProgress
      renderTransitionFrame(
        previewCanvasRef.current,
        selectedId,
        previewProgress,
        paramsRef.current
      );
      return;
    }

    const cleanup = startTransitionPreviewLoop(
      previewCanvasRef.current,
      selectedId,
      () => paramsRef.current
    );
    return cleanup;
  }, [isOpen, selectedId, isPlaying]);

  // Scrubbing handler
  const handleScrub = (val) => {
    setIsPlaying(false);
    setPreviewProgress(val);
    if (previewCanvasRef.current) {
      renderTransitionFrame(
        previewCanvasRef.current,
        selectedId,
        val,
        paramsRef.current
      );
    }
  };

  // Live param adjustment re-renders if paused
  const handleParamChange = (name, val) => {
    const next = { ...tweakedParams, [name]: val };
    setTweakedParams(next);
    if (!isPlaying && previewCanvasRef.current) {
      renderTransitionFrame(
        previewCanvasRef.current,
        selectedId,
        previewProgress,
        next
      );
    }
  };

  const handleResetParams = () => {
    const defaults = { ...(selectedPreset.defaultParams || {}) };
    setTweakedParams(defaults);
    if (!isPlaying && previewCanvasRef.current) {
      renderTransitionFrame(
        previewCanvasRef.current,
        selectedId,
        previewProgress,
        defaults
      );
    }
  };

  if (!isOpen) return null;

  const filteredPresets = ALL_GL_TRANSITIONS.filter((p) => {
    const matchesCategory =
      selectedCategory === 'All' ||
      (selectedCategory === 'Featured' ? FEATURED_TRANSITIONS.some((f) => f.id === p.id) : p.category === selectedCategory);
    const matchesSearch =
      !searchQuery.trim() ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleApply = (slot) => {
    onApplyPreset?.(selectedId, slot, tweakedParams);
    onClose();
  };

  const paramCount = Object.keys(selectedPreset.paramsTypes || {}).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="transition-picker-modal master-detail-layout"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <Sparkles size={16} className="text-amber" />
            <h2 className="modal-title">GL Transition Presets</h2>
            <span className="modal-badge">{ALL_GL_TRANSITIONS.length} shaders</span>
            <span className="modal-slot-indicator">
              Applying to: <strong>{targetSlot === 'out' ? 'Transition Out' : 'Transition In'}</strong>
            </span>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            title="Close (Esc)"
          >
            <X size={15} />
          </button>
        </div>

        {/* Master-Detail Split Container */}
        <div className="transition-modal-split">
          {/* ─── LEFT PANE: Master Preset Browser ───────────────────────── */}
          <div className="transition-master-pane">
            {/* Search & Filter Toolbar */}
            <div className="master-search-bar">
              <Search size={13} className="search-icon" />
              <input
                type="text"
                placeholder="Search 125+ transitions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="master-search-input"
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery('')}
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Category Pills */}
            <div className="master-category-bar">
              {GL_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`master-cat-pill ${selectedCategory === cat ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Fast, Zero-Lag Card List (Pure DOM/CSS) */}
            <div className="master-preset-list">
              {filteredPresets.map((preset) => {
                const meta = getCategoryMeta(preset.category);
                const IconComponent = meta.icon;
                const isSelected = selectedId === preset.id;
                const pCount = Object.keys(preset.paramsTypes || {}).length;

                return (
                  <div
                    key={preset.id}
                    className={`master-preset-item ${isSelected ? 'active' : ''}`}
                    onClick={() => handleSelectPreset(preset.id)}
                  >
                    <div className={`preset-item-icon-box ${meta.colorClass}`}>
                      <IconComponent size={14} />
                    </div>

                    <div className="preset-item-info">
                      <div className="preset-item-title-row">
                        <span className="preset-item-name">{preset.name}</span>
                        {pCount > 0 && (
                          <span className="preset-param-badge" title={`${pCount} customizable parameters`}>
                            {pCount} param{pCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <span className="preset-item-desc">{preset.description || preset.category}</span>
                    </div>

                    {isSelected && (
                      <div className="preset-active-check">
                        <Check size={13} />
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredPresets.length === 0 && (
                <div className="master-empty-state">
                  <p>No transitions found matching "{searchQuery}"</p>
                </div>
              )}
            </div>
          </div>

          {/* ─── RIGHT PANE: Interactive Detail & Odin Inspector ────────── */}
          <div className="transition-detail-pane">
            {/* 1. High-Resolution Live WebGL Preview Canvas */}
            <div className="detail-preview-container">
              <div className="detail-canvas-box">
                <canvas
                  ref={previewCanvasRef}
                  width={340}
                  height={190}
                  className="detail-preview-canvas"
                />
              </div>

              {/* Scrubber & Playback Controls */}
              <div className="detail-preview-toolbar">
                <button
                  type="button"
                  className={`detail-transport-btn ${isPlaying ? 'playing' : ''}`}
                  onClick={() => setIsPlaying(!isPlaying)}
                  title={isPlaying ? 'Pause animation loop' : 'Play animation loop'}
                >
                  {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                </button>

                <div className="detail-scrubber-track">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={isPlaying ? 0.5 : previewProgress}
                    onChange={(e) => handleScrub(parseFloat(e.target.value))}
                    className="detail-progress-slider"
                  />
                </div>

                <span className="detail-progress-label">
                  {isPlaying ? 'LOOP' : `${Math.round(previewProgress * 100)}%`}
                </span>

                <button
                  type="button"
                  className={`detail-transport-btn ${isPlaying ? 'active' : ''}`}
                  onClick={() => setIsPlaying(true)}
                  title="Loop animation continuously"
                >
                  <Repeat size={12} />
                </button>
              </div>
            </div>

            {/* 2. Preset Metadata Card */}
            <div className="detail-info-header">
              <div className="detail-title-row">
                <h3 className="detail-preset-name">{selectedPreset.name}</h3>
                <span className="detail-cat-badge">{selectedPreset.category}</span>
              </div>
              <p className="detail-preset-desc">{selectedPreset.description}</p>
            </div>

            {/* 3. Odin-Style Dynamic Attribute & Parameter Drawer */}
            <div className="detail-odin-container">
              <OdinPropertyDrawer
                paramsTypes={selectedPreset.paramsTypes || {}}
                defaultParams={selectedPreset.defaultParams || {}}
                values={tweakedParams}
                onChange={handleParamChange}
                onResetAll={handleResetParams}
                title="Shader Parameters"
              />
            </div>

            {/* 4. Action Buttons Footer */}
            <div className="detail-action-footer">
              <button
                type="button"
                className="unity-btn unity-btn-secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <div className="detail-apply-btns">
                <button
                  type="button"
                  className="unity-btn unity-btn-emerald"
                  onClick={() => handleApply('out')}
                  title="Apply shader & tweaks to Transition Out"
                >
                  Apply as Out
                </button>
                <button
                  type="button"
                  className="unity-btn unity-btn-primary"
                  onClick={() => handleApply('in')}
                  title="Apply shader & tweaks to Transition In"
                >
                  Apply as In
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
