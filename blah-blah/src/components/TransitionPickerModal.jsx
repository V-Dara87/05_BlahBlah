import { useState, useRef, useEffect, memo } from 'react';
import {
  X,
  Search,
  Sparkles,
  Zap,
  Eye,
  Check,
  Filter,
} from 'lucide-react';
import {
  ALL_GL_TRANSITIONS,
  FEATURED_TRANSITIONS,
  GL_CATEGORIES,
  startTransitionPreviewLoop,
} from '../engine/glTransitions';

const TransitionCard = memo(function TransitionCard({
  preset,
  isSelected,
  onSelect,
  onApply,
  targetSlot,
}) {
  const canvasRef = useRef(null);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    // Only animate if hovered or selected to conserve GPU resources
    if (!canvasRef.current) return;
    if (isHovered || isSelected) {
      return startTransitionPreviewLoop(canvasRef.current, preset.id);
    } else {
      // Draw static first frame
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(canvas.width / 2, canvas.height / 2, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(preset.name, canvas.width / 2, canvas.height - 8);
      }
    }
  }, [isHovered, isSelected, preset.id, preset.name]);

  return (
    <div
      className={`transition-gallery-card ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(preset.id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="card-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={150}
          height={85}
          className="gallery-card-canvas"
        />
        {isSelected && (
          <div className="selected-check-badge">
            <Check size={14} />
          </div>
        )}
      </div>
      <div className="card-info">
        <div className="card-name-row">
          <span className="card-name">{preset.name}</span>
          <span className="card-tag">{preset.category}</span>
        </div>
        <p className="card-desc">{preset.description}</p>
      </div>
      {isSelected && (
        <div className="card-apply-actions">
          <button
            type="button"
            className="apply-btn-primary"
            onClick={(e) => {
              e.stopPropagation();
              onApply(preset.id, targetSlot || 'in');
            }}
          >
            Apply to {targetSlot === 'out' ? 'Transition Out' : 'Transition In'}
          </button>
        </div>
      )}
    </div>
  );
});

export const TransitionPickerModal = memo(function TransitionPickerModal({
  isOpen,
  onClose,
  targetSlot = 'in',
  onApplyPreset,
  currentPresetId,
}) {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState(currentPresetId || 'glitchMemories');

  useEffect(() => {
    if (currentPresetId) setSelectedId(currentPresetId);
  }, [currentPresetId]);

  if (!isOpen) return null;

  const filteredPresets = ALL_GL_TRANSITIONS.filter((p) => {
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    const matchesSearch =
      !searchQuery.trim() ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleApply = (presetId, slot) => {
    onApplyPreset?.(presetId, slot);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="transition-picker-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <Sparkles size={18} className="text-amber" />
            <h2 className="modal-title">GL Transition Presets</h2>
            <span className="modal-badge">{filteredPresets.length} available</span>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            title="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Toolbar: Search + Category Filter */}
        <div className="gallery-toolbar">
          <div className="search-bar-wrap">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              placeholder="Search transitions (e.g. glitch, zoom, wipe, ripple)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="gallery-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="category-pills">
            {GL_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`cat-pill ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grid of Transition Cards */}
        <div className="gallery-grid-scroll">
          <div className="gallery-grid">
            {filteredPresets.map((preset) => (
              <TransitionCard
                key={preset.id}
                preset={preset}
                isSelected={selectedId === preset.id}
                onSelect={setSelectedId}
                onApply={handleApply}
                targetSlot={targetSlot}
              />
            ))}
            {filteredPresets.length === 0 && (
              <div className="gallery-empty-state">
                <p>No transitions found matching "{searchQuery}"</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="gallery-modal-footer">
          <span className="footer-hint">
            Hover over any transition to preview animation loop in real time.
          </span>
          <div className="footer-btns">
            <button
              type="button"
              className="footer-btn-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="footer-btn-apply"
              disabled={!selectedId}
              onClick={() => handleApply(selectedId, targetSlot)}
            >
              Apply to Selected Clip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
