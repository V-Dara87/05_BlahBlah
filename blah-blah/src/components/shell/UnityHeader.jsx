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
  Settings,
  AlertTriangle
} from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { formatTimecode } from '../../utils/timeFormat';
import { isTauri } from '../../services/tauriFsAdapter';
import { openProjectInVsCode, openProjectInExplorer } from '../../services/ideLauncher';
import { useUiZoom } from '../../services/uiZoom';
import './unity-header.css';
 
/** Highest compact level; see the `data-compact` rules in unity-header.css. */
const MAX_COMPACT_LEVEL = 3;

/**
 * Keeps the header on one row at any window width.
 *
 * The header holds ~1700px of controls but the window can be much narrower, so
 * instead of letting the right-hand buttons fall off-screen this picks the
 * least compact level (`data-compact` 0..3, each one hiding more labels and
 * decoration) at which every group fits. It measures the real layout, so it
 * stays correct when buttons appear (Save / VS Code), the project name or save
 * status changes, fonts load, or the UI zoom changes.
 *
 * `data-compact` is written straight to the DOM, not through React state: the
 * probe (reset to 0, grow until it fits) happens inside one task, so the
 * browser never paints an intermediate level.
 */
function useCompactHeader(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const fits = () => {
      const style = getComputedStyle(el);
      const gap = parseFloat(style.columnGap) || 0;
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const kids = Array.from(el.children);
      const content = kids.reduce((sum, kid) => sum + kid.offsetWidth, 0)
        + gap * Math.max(0, kids.length - 1);
      return content + padding <= el.clientWidth;
    };

    const fit = () => {
      let level = 0;
      el.dataset.compact = '0';
      while (!fits() && level < MAX_COMPACT_LEVEL) {
        level += 1;
        el.dataset.compact = String(level);
      }
    };

    // Re-fit on the next frame rather than inside the observer callbacks, so
    // changing the layout from here can never trigger the browser's
    // "ResizeObserver loop" error.
    let frame = 0;
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          fit();
        });
      }
    };

    fit(); // synchronous first pass, before the first paint

    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(el); // window resize / zoom change
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(el, { childList: true, subtree: true, characterData: true });
    if (document.fonts?.ready) document.fonts.ready.then(schedule).catch(() => {});

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}

export function UnityHeader({
  projectName,
  setProjectName,
  currentTime,
  totalDuration,
  isPlaying,
  isLooping,
  snappingEnabled,
  hasSelectedEntity,
  projectFolderHandle,
  saveStatus = 'saved', // 'saved' | 'saving' | 'unsaved' | 'in-memory' (last save failed)
  schemaWarning = null,
  canUndo = false,
  canRedo = false,
  onTogglePlay,
  onSeek,
  onToggleLoop,
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
  // Whole-app zoom (the header +/- scales the entire UI, not just the timeline).
  const { zoom: uiZoom, zoomIn: uiZoomIn, zoomOut: uiZoomOut, resetZoom: uiZoomReset } = useUiZoom();
  const headerRef = useRef(null);
  useCompactHeader(headerRef);

  return (
    <header className="unity-header" ref={headerRef}>
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
          <div
            className="save-status-box"
            title={
              saveStatus === 'saving'
                ? 'Writing changes to the project folder…'
                : saveStatus === 'unsaved'
                ? 'Changes are not on disk yet. Autosave will write them (see Settings > Autosave), or press Save.'
                : saveStatus === 'in-memory'
                ? 'The last save failed, so recent changes exist only in memory. Use Save to try again.'
                : 'All changes are saved to the project folder'
            }
          >
            {saveStatus === 'saving' ? (
              <span className="save-status-saving">Saving...</span>
            ) : saveStatus === 'unsaved' || saveStatus === 'in-memory' ? (
              <span className="save-status-memory">
                <HardDrive size={11} /> Unsaved
              </span>
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
 
        {/* P1 #6 — schemaVersion-too-new warning. Previously console.warn
            only; this is the first UI-visible surface for it. */}
        {schemaWarning && (
          <span className="schema-warning-badge" title={schemaWarning}>
            <AlertTriangle size={11} /> Newer project format
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
              title="Zoom Out (Ctrl + -)"
              onClick={uiZoomOut}
            >
              <ZoomOut size={13} />
            </button>
            <span
              className="zoom-text"
              title="Reset app zoom to 100% (Ctrl + 0)"
              style={{ cursor: 'pointer' }}
              onClick={uiZoomReset}
            >
              {Math.round(uiZoom * 100)}%
            </span>
            <button
              className="unity-tool-btn-sm"
              title="Zoom In (Ctrl + =)"
              onClick={uiZoomIn}
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