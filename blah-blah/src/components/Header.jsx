import { useState } from 'react';
import { 
  Film, 
  Scissors, 
  Trash2, 
  ZoomIn, 
  ZoomOut, 
  Download, 
  Magnet, 
  HelpCircle,
  Sparkles
} from 'lucide-react';
import { formatTimecode } from '../utils/timeFormat';
import { MIN_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND } from '../types';

export function Header({
  projectName,
  setProjectName,
  currentTime,
  totalDuration,
  pixelsPerSecond,
  setPixelsPerSecond,
  snappingEnabled,
  setSnappingEnabled,
  onSplitSelected,
  onDeleteSelected,
  hasSelectedClip,
  onOpenExport,
  onLoadSamples,
  isGeneratingSample
}) {
  const [showShortcuts, setShowShortcuts] = useState(false);

  const zoomIn = () => {
    setPixelsPerSecond(prev => Math.min(MAX_PIXELS_PER_SECOND, prev + 10));
  };

  const zoomOut = () => {
    setPixelsPerSecond(prev => Math.max(MIN_PIXELS_PER_SECOND, prev - 10));
  };

  return (
    <header className="app-header">
      <div className="header-left">
        <div className="brand">
          <div className="brand-icon">
            <Film size={20} className="text-accent" />
          </div>
          <span className="brand-title">NovaCut Studio</span>
          <span className="badge-beta">PRO</span>
        </div>

        <div className="project-title-wrapper">
          <input
            type="text"
            className="project-title-input"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Untitled Project"
          />
        </div>
      </div>

      <div className="header-center">
        <div className="timecode-badge">
          <span className="current-tc">{formatTimecode(currentTime)}</span>
          <span className="tc-divider">/</span>
          <span className="total-tc">{formatTimecode(totalDuration)}</span>
        </div>

        <div className="header-tools-group">
          <button
            className="tool-btn"
            title="Split Clip at Playhead (C or S)"
            onClick={onSplitSelected}
            disabled={!hasSelectedClip}
          >
            <Scissors size={16} />
            <span>Split</span>
          </button>

          <button
            className="tool-btn danger"
            title="Delete Selected Clip (Del/Backspace)"
            onClick={onDeleteSelected}
            disabled={!hasSelectedClip}
          >
            <Trash2 size={16} />
            <span>Delete</span>
          </button>

          <div className="divider-vert" />

          <button
            className={`tool-btn ${snappingEnabled ? 'active' : ''}`}
            title="Toggle Magnet Snapping (N)"
            onClick={() => setSnappingEnabled(!snappingEnabled)}
          >
            <Magnet size={16} />
            <span>Snap</span>
          </button>

          <div className="divider-vert" />

          <div className="zoom-controls">
            <button className="icon-btn-sm" onClick={zoomOut} title="Zoom Out Timeline (-)">
              <ZoomOut size={15} />
            </button>
            <span className="zoom-value">{Math.round((pixelsPerSecond / 40) * 100)}%</span>
            <button className="icon-btn-sm" onClick={zoomIn} title="Zoom In Timeline (+)">
              <ZoomIn size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="header-right">
        <button
          className="btn btn-secondary btn-sm"
          onClick={onLoadSamples}
          disabled={isGeneratingSample}
          title="Generate instant demo audio and video clips"
        >
          <Sparkles size={15} className="text-yellow" />
          <span>{isGeneratingSample ? 'Generating Demo...' : 'Load Demo Media'}</span>
        </button>

        <button
          className="icon-btn"
          title="Keyboard Shortcuts"
          onClick={() => setShowShortcuts(true)}
        >
          <HelpCircle size={18} />
        </button>

        <button
          className="btn btn-primary"
          onClick={onOpenExport}
          title="Export and Render Project"
        >
          <Download size={16} />
          <span>Export</span>
        </button>
      </div>

      {showShortcuts && (
        <div className="modal-backdrop" onClick={() => setShowShortcuts(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Keyboard Shortcuts</h3>
              <button className="close-btn" onClick={() => setShowShortcuts(false)}>×</button>
            </div>
            <div className="shortcuts-grid">
              <div className="shortcut-row">
                <kbd>Space</kbd>
                <span>Play / Pause</span>
              </div>
              <div className="shortcut-row">
                <kbd>C</kbd> or <kbd>S</kbd>
                <span>Split Selected Clip at Playhead</span>
              </div>
              <div className="shortcut-row">
                <kbd>Delete</kbd> / <kbd>Backspace</kbd>
                <span>Delete Selected Clip</span>
              </div>
              <div className="shortcut-row">
                <kbd>←</kbd> / <kbd>→</kbd>
                <span>Step backward / forward 1 frame</span>
              </div>
              <div className="shortcut-row">
                <kbd>Shift + ←</kbd> / <kbd>Shift + →</kbd>
                <span>Step backward / forward 1 second</span>
              </div>
              <div className="shortcut-row">
                <kbd>Home</kbd> / <kbd>End</kbd>
                <span>Jump to Start / End of Timeline</span>
              </div>
              <div className="shortcut-row">
                <kbd>N</kbd>
                <span>Toggle Magnet Snapping</span>
              </div>
              <div className="shortcut-row">
                <kbd>+</kbd> / <kbd>-</kbd>
                <span>Zoom In / Out Timeline</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
