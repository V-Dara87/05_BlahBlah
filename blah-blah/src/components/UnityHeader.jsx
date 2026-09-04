import { 
  Play, 
  Pause, 
  ChevronLeft, 
  ChevronRight, 
  Repeat, 
  Code, 
  Download, 
  Scissors, 
  Trash2, 
  Magnet, 
  ZoomIn, 
  ZoomOut,
  Layers,
  FolderOpen,
  FilePlus,
  Save,
  CheckCircle2,
  HardDrive,
  Undo2,
  Redo2,
  Settings
} from 'lucide-react';
import { formatTimecode } from '../utils/timeFormat';
import { isTauri } from '../services/tauriFsAdapter';
import { openProjectInVsCode, openProjectInExplorer } from '../services/ideLauncher';
 
export function UnityHeader({
  projectName,
  setProjectName,
  currentTime,
  totalDuration,
  isPlaying,
  isLooping,
  pixelsPerSecond,
  snappingEnabled,
  hasSelectedEntity,
  projectFolderHandle,
  saveStatus = 'saved', // 'saved' | 'saving' | 'in-memory'
  canUndo = false,
  canRedo = false,
  onTogglePlay,
  onSeek,
  onToggleLoop,
  onSetPixelsPerSecond,
  onSetSnappingEnabled,
  onSplitSelected,
  onDeleteSelected,
  onUndo,
  onRedo,
  onOpenProjectJson,
  onOpenExport,
  onNewProject,
  onOpenProjectFolder,
  onSaveProjectToDisk,
  onOpenSettings,
  onGoToHub,
}) {
  return (
    <header className="unity-header">
      {/* Left: Unity Brand & Project Actions */}
      <div className="unity-header-left">
        <button
          className="unity-logo-group unity-logo-hub-btn"
          onClick={onGoToHub}
          title="Back to Project Hub"
        >
          <div className="unity-icon-box">
            <Layers size={16} />
          </div>
          <span className="unity-app-title">blahblah</span>
          <span className="unity-version-tag">2026.1</span>
        </button>
 
        <div className="unity-divider-v" />
 
        {/* Project File Actions: New & Open */}
        <button 
          className="unity-hdr-btn"
          onClick={onNewProject}
          title="Create a new blank project folder (Clean slate with 0 clips & 0 scripts)"
        >
          <FilePlus size={13} className="text-emerald" />
          <span>New</span>
        </button>
 
        <button 
          className={`unity-hdr-btn ${projectFolderHandle ? 'active-folder' : ''}`}
          onClick={onOpenProjectFolder}
          title={projectFolderHandle ? `Current Folder: ${projectFolderHandle.name} (Click to open another)` : 'Open an existing project folder from your computer'}
        >
          <FolderOpen size={13} className="text-amber" />
          <span className="folder-name-label">
            {projectFolderHandle ? projectFolderHandle.name : 'Open'}
          </span>
        </button>
 
        {projectFolderHandle && (
          <button 
            className="unity-hdr-btn"
            onClick={onSaveProjectToDisk}
            title="Save project directly to disk (Ctrl+S)"
          >
            <Save size={13} className="text-cyan" />
            <span>Save</span>
          </button>
        )}

        {projectFolderHandle && isTauri() && (
          <>
            <button 
              className="unity-hdr-btn"
              onClick={() => openProjectInVsCode(projectFolderHandle.path)}
              title={projectFolderHandle.path ? `Open ${projectFolderHandle.name} in VS Code` : 'Open in VS Code'}
            >
              <Code size={13} className="text-blue" />
              <span>VS Code</span>
            </button>
            <button 
              className="unity-hdr-btn"
              onClick={() => openProjectInExplorer(projectFolderHandle.path)}
              title={projectFolderHandle.path ? `Show ${projectFolderHandle.name} in File Explorer` : 'Show in File Explorer'}
            >
              <FolderOpen size={13} className="text-amber" />
              <span>Explorer</span>
            </button>
          </>
        )}
 
        <div className="unity-divider-v" />
 
        {/* Save Status Badge */}
        {projectFolderHandle ? (
          <div className="save-status-box" title="Auto-saving enabled to local disk">
            {saveStatus === 'saving' ? (
              <span className="save-status-saving">Saving...</span>
            ) : (
              <span className="save-status-saved">
                <CheckCircle2 size={11} /> Saved
              </span>
            )}
          </div>
        ) : (
          <span className="save-status-memory" title="In-Memory Mode. Click 'Open' or 'New' to save to real files on disk.">
            <HardDrive size={11} /> In-Memory
          </span>
        )}
 
        <input
          type="text"
          className="unity-project-input"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="Project Name"
        />
      </div>
 
      {/* Center: Unity Playback Transport & Timecode */}
      <div className="unity-header-center">
        <div className="unity-transport-toolbar">
          <button
            className="unity-transport-btn"
            title="Step Back 1 Frame (←)"
            onClick={() => onSeek(currentTime - 1 / 30)}
          >
            <ChevronLeft size={14} />
          </button>
 
          <button
            className={`unity-transport-btn play-btn ${isPlaying ? 'active-play' : ''}`}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            onClick={onTogglePlay}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-px" />}
          </button>
 
          <button
            className="unity-transport-btn"
            title="Step Forward 1 Frame (→)"
            onClick={() => onSeek(currentTime + 1 / 30)}
          >
            <ChevronRight size={14} />
          </button>
 
          <button
            className={`unity-transport-btn ${isLooping ? 'active-loop' : ''}`}
            title="Toggle Loop"
            onClick={onToggleLoop}
          >
            <Repeat size={13} />
          </button>
        </div>
 
        <div className="unity-timecode-box">
          <span className="timecode-current">{formatTimecode(currentTime)}</span>
          <span className="timecode-sep">/</span>
          <span className="timecode-total">{formatTimecode(totalDuration)}</span>
        </div>
 
        {/* Quick Tools */}
        <div className="unity-quick-tools">
          <button
            className="unity-tool-btn"
            title="Undo (Ctrl+Z)"
            onClick={onUndo}
            disabled={!canUndo}
          >
            <Undo2 size={13} />
          </button>
 
          <button
            className="unity-tool-btn"
            title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
            onClick={onRedo}
            disabled={!canRedo}
          >
            <Redo2 size={13} />
          </button>
 
          <div className="unity-divider-v" />
 
          <button
            className="unity-tool-btn"
            title="Split Clip at Playhead (C or S)"
            onClick={onSplitSelected}
            disabled={!hasSelectedEntity}
          >
            <Scissors size={13} />
            <span>Split</span>
          </button>
 
          <button
            className="unity-tool-btn danger"
            title="Delete Selected Clip (Del)"
            onClick={onDeleteSelected}
            disabled={!hasSelectedEntity}
          >
            <Trash2 size={13} />
          </button>
 
          <button
            className={`unity-tool-btn ${snappingEnabled ? 'active-snap' : ''}`}
            title="Toggle Magnet Snapping (N)"
            onClick={() => onSetSnappingEnabled(!snappingEnabled)}
          >
            <Magnet size={13} />
          </button>
 
          <div className="unity-zoom-group">
            <button
              className="unity-tool-btn-sm"
              title="Zoom Out (-)"
              onClick={() => onSetPixelsPerSecond(prev => Math.max(10, prev - 10))}
            >
              <ZoomOut size={13} />
            </button>
            <span className="zoom-text">{Math.round((pixelsPerSecond / 40) * 100)}%</span>
            <button
              className="unity-tool-btn-sm"
              title="Zoom In (+)"
              onClick={() => onSetPixelsPerSecond(prev => Math.min(160, prev + 10))}
            >
              <ZoomIn size={13} />
            </button>
          </div>
        </div>
      </div>
 
      {/* Right: AI Project Code & Export */}
      <div className="unity-header-right">
        <button
          className="unity-action-btn code-btn"
          onClick={onOpenProjectJson}
          title="Inspect and edit the entire project as clean JSON (AI Prompt / Code Editor)"
        >
          <Code size={14} className="text-cyan" />
          <span>&lt;/&gt; Project Code</span>
        </button>
 
        <button
          className="unity-action-btn primary-btn"
          onClick={onOpenExport}
          title="Export / Render Video"
        >
          <Download size={14} />
          <span>Export Render</span>
        </button>
 
        <button
          className="unity-tool-btn-sm settings-hdr-btn"
          onClick={onOpenSettings}
          title="Settings (Audio Input Device)"
        >
          <Settings size={15} />
        </button>
      </div>
    </header>
  );
}
 