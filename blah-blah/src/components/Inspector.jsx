import { 
  Sliders, 
  Trash2, 
  Scissors, 
  Copy, 
  Volume2, 
  FastForward, 
  Clock, 
  Layers,
  Type
} from 'lucide-react';

export function Inspector({
  selectedClip,
  tracks,
  onUpdateClip,
  onDeleteClip,
  onDuplicateClip,
  onSplitClip
}) {
  if (!selectedClip) {
    return (
      <aside className="inspector-panel empty">
        <div className="inspector-empty-state">
          <Sliders size={32} className="empty-icon" />
          <h4>No Clip Selected</h4>
          <p>Click on any clip in the timeline or media library to adjust its properties, timing, volume, or speed.</p>
        </div>
      </aside>
    );
  }

  const compatibleTracks = tracks.filter(t => t.type === selectedClip.type || (selectedClip.type === 'text' && t.type === 'video'));

  return (
    <aside className="inspector-panel">
      <div className="panel-header">
        <h3 className="panel-title">Clip Inspector</h3>
        <span className={`type-tag ${selectedClip.type}`}>{selectedClip.type.toUpperCase()}</span>
      </div>

      <div className="inspector-content">
        {/* Name / Title */}
        <div className="property-group">
          <label className="prop-label">Clip Label</label>
          <input
            type="text"
            className="prop-input"
            value={selectedClip.name || ''}
            onChange={(e) => onUpdateClip(selectedClip.id, { name: e.target.value })}
          />
        </div>

        {/* Text specific settings */}
        {selectedClip.type === 'text' && (
          <div className="text-properties-box">
            <div className="property-group">
              <label className="prop-label">
                <Type size={14} /> Text Content
              </label>
              <textarea
                className="prop-textarea"
                rows={2}
                value={selectedClip.text || ''}
                onChange={(e) => onUpdateClip(selectedClip.id, { text: e.target.value, name: e.target.value })}
              />
            </div>

            <div className="prop-row">
              <div className="property-group flex-1">
                <label className="prop-label">Font Size</label>
                <input
                  type="number"
                  min="12"
                  max="120"
                  className="prop-input"
                  value={selectedClip.fontSize || 32}
                  onChange={(e) => onUpdateClip(selectedClip.id, { fontSize: parseInt(e.target.value) || 32 })}
                />
              </div>

              <div className="property-group flex-1">
                <label className="prop-label">Text Color</label>
                <input
                  type="color"
                  className="prop-color-input"
                  value={selectedClip.fontColor || '#ffffff'}
                  onChange={(e) => onUpdateClip(selectedClip.id, { fontColor: e.target.value })}
                />
              </div>
            </div>
          </div>
        )}

        {/* Track assignment */}
        <div className="property-group">
          <label className="prop-label">
            <Layers size={14} /> Assigned Track
          </label>
          <select
            className="prop-select"
            value={selectedClip.trackId}
            onChange={(e) => onUpdateClip(selectedClip.id, { trackId: e.target.value })}
          >
            {compatibleTracks.map(t => (
              <option key={t.id} value={t.id}>{t.name} ({t.type})</option>
            ))}
          </select>
        </div>

        {/* Timing parameters */}
        <div className="prop-section-title">
          <Clock size={14} /> Timing & Position
        </div>

        <div className="prop-row">
          <div className="property-group flex-1">
            <label className="prop-label">Start Time (s)</label>
            <input
              type="number"
              min="0"
              step="0.1"
              className="prop-input"
              value={parseFloat(selectedClip.startTime.toFixed(2))}
              onChange={(e) => onUpdateClip(selectedClip.id, { startTime: Math.max(0, parseFloat(e.target.value) || 0) })}
            />
          </div>

          <div className="property-group flex-1">
            <label className="prop-label">Duration (s)</label>
            <input
              type="number"
              min="0.2"
              step="0.1"
              className="prop-input"
              value={parseFloat(selectedClip.duration.toFixed(2))}
              onChange={(e) => onUpdateClip(selectedClip.id, { duration: Math.max(0.2, parseFloat(e.target.value) || 0.2) })}
            />
          </div>
        </div>

        <div className="property-group">
          <label className="prop-label">In-Point Source Offset (s)</label>
          <input
            type="number"
            min="0"
            step="0.1"
            className="prop-input"
            value={parseFloat((selectedClip.mediaOffset || 0).toFixed(2))}
            onChange={(e) => onUpdateClip(selectedClip.id, { mediaOffset: Math.max(0, parseFloat(e.target.value) || 0) })}
          />
        </div>

        {/* Audio / Video Controls */}
        {selectedClip.type !== 'text' && (
          <>
            <div className="prop-section-title">
              <Volume2 size={14} /> Audio & Speed
            </div>

            <div className="property-group">
              <div className="prop-label-split">
                <label className="prop-label">Clip Volume</label>
                <span className="prop-val-display">{Math.round((selectedClip.volume ?? 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                className="volume-slider"
                value={selectedClip.volume ?? 1}
                onChange={(e) => onUpdateClip(selectedClip.id, { volume: parseFloat(e.target.value) })}
              />
            </div>

            <div className="property-group">
              <div className="prop-label-split">
                <label className="prop-label">
                  <FastForward size={14} /> Playback Speed
                </label>
                <span className="prop-val-display">{(selectedClip.speed || 1)}x</span>
              </div>
              <div className="speed-buttons">
                {[0.5, 1, 1.5, 2].map((spd) => (
                  <button
                    key={spd}
                    className={`speed-chip ${(selectedClip.speed || 1) === spd ? 'active' : ''}`}
                    onClick={() => onUpdateClip(selectedClip.id, { speed: spd })}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Quick Action buttons */}
        <div className="inspector-actions">
          <button
            className="btn btn-secondary flex-1"
            title="Duplicate selected clip"
            onClick={() => onDuplicateClip(selectedClip.id)}
          >
            <Copy size={15} />
            <span>Duplicate</span>
          </button>

          <button
            className="btn btn-secondary flex-1"
            title="Split clip at playhead"
            onClick={() => onSplitClip(selectedClip.id)}
          >
            <Scissors size={15} />
            <span>Split</span>
          </button>
        </div>

        <button
          className="btn btn-danger-outline full-width mt-2"
          onClick={() => onDeleteClip(selectedClip.id)}
        >
          <Trash2 size={15} />
          <span>Delete Clip</span>
        </button>
      </div>
    </aside>
  );
}
