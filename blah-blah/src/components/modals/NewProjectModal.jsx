import { useState } from 'react';
import {
  FolderPlus,
  FolderOpen,
  X,
  AlertCircle,
  Layers,
  Video,
  Smartphone,
  Sparkles,
  Presentation,
  Mic,
  Clapperboard,
  Film,
} from 'lucide-react';
import { pickProjectDirectory, createNewProjectFolder } from '../../services/projectFileSystem';
import { RESOLUTION_PRESETS, DEFAULT_RESOLUTION } from '../../types';
import {
  PROJECT_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  buildTemplateProjectDefaults,
} from '../../services/projectTemplates';
import './new-project-modal.css';

/** Template `icon` keys -> components (the service stays React-free). */
const TEMPLATE_ICONS = {
  layers: Layers,
  video: Video,
  smartphone: Smartphone,
  sparkles: Sparkles,
  presentation: Presentation,
  mic: Mic,
  clapperboard: Clapperboard,
  film: Film,
};

/** The preset id matching a template's resolution, or 'custom' if none does. */
function resolutionPresetIdFor(resolution) {
  const match = RESOLUTION_PRESETS.find(
    (preset) => preset.width === resolution.width && preset.height === resolution.height
  );
  return match ? match.id : 'custom';
}

export function NewProjectModal({
  isOpen,
  onClose,
  defaultTracks,
  onProjectCreated,
}) {
  const [projectName, setProjectName] = useState('my-video-project');
  const [parentDirHandle, setParentDirHandle] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // The chosen starting point. It decides the resolution and the track layout;
  // everything below it can still be overridden (the resolution picker stays
  // live), so a template is a head start rather than a lock-in.
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const templateDefaults = buildTemplateProjectDefaults(templateId);
  const template = templateDefaults.template;

  // Resolution -- defaults to the template's (which is 1920x1080 for the blank
  // one, the app's own default). Selecting "Custom..." reveals width/height
  // number inputs instead of swapping the dropdown for a text field, so the
  // preset list stays a one-click choice for the common cases while still
  // allowing any arbitrary size.
  const [resolutionId, setResolutionId] = useState(
    resolutionPresetIdFor(templateDefaults.resolution)
  );
  const [customWidth, setCustomWidth] = useState(templateDefaults.resolution.width);
  const [customHeight, setCustomHeight] = useState(templateDefaults.resolution.height);

  const isCustomResolution = resolutionId === 'custom';
  const selectedPreset = RESOLUTION_PRESETS.find((p) => p.id === resolutionId) || RESOLUTION_PRESETS[0];
  const resolution = isCustomResolution
    ? { width: Math.max(1, Math.round(customWidth) || DEFAULT_RESOLUTION.width), height: Math.max(1, Math.round(customHeight) || DEFAULT_RESOLUTION.height) }
    : { width: selectedPreset.width, height: selectedPreset.height };

  // Picking a template re-points the resolution controls at that template's
  // canvas, so the picker and the template can never disagree on screen.
  const handleSelectTemplate = (nextTemplate) => {
    const defaults = buildTemplateProjectDefaults(nextTemplate.id);
    setTemplateId(nextTemplate.id);
    setResolutionId(resolutionPresetIdFor(defaults.resolution));
    setCustomWidth(defaults.resolution.width);
    setCustomHeight(defaults.resolution.height);
  };

  if (!isOpen) return null;

  const handlePickLocation = async () => {
    try {
      setErrorMsg('');
      const dirHandle = await pickProjectDirectory();
      setParentDirHandle(dirHandle);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setErrorMsg(err?.message || 'Failed to select directory');
      }
    }
  };

  const handleCreate = async (e) => {
    e?.preventDefault();
    const cleanName = projectName.trim();
    if (!cleanName) {
      setErrorMsg('Please enter a project name.');
      return;
    }

    if (!parentDirHandle) {
      setErrorMsg('Please select a folder location first.');
      return;
    }

    setIsCreating(true);
    setErrorMsg('');

    try {
      // A template's tracks are only the DEFAULT: `defaultTracks` (passed in by
      // the caller for non-template callers) still wins when a template has
      // none, which is how the export path keeps working unchanged.
      const tracks = templateDefaults.tracks.length > 0 ? templateDefaults.tracks : defaultTracks;
      const result = await createNewProjectFolder(parentDirHandle, cleanName, tracks, resolution);
      setIsCreating(false);
      onProjectCreated(result);
      onClose();
    } catch (err) {
      setIsCreating(false);
      setErrorMsg(err.message || 'Failed to create project folder.');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content new-project-modal" onClick={(e) => e.stopPropagation()}>

        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge">
              <FolderPlus size={18} className="text-emerald" />
            </div>
            <div>
              <h3>Create New Project</h3>
              <p className="modal-subtitle">Creates a clean project folder on your disk, ready for VS Code</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleCreate} className="modal-body new-project-body">
          {errorMsg && (
            <div className="modal-alert-box error">
              <AlertCircle size={14} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Template Gallery — a resolution + track layout. Picking one is a
              head start, not a lock-in: name, location and resolution below all
              stay editable. */}
          <div className="form-field-group">
            <label className="form-label">Template</label>
            <p className="hint-text-sm settings-hint-below">
              Sets the canvas size and the track layout. You can still change the resolution below, and
              every track is renameable afterwards.
            </p>
            <div className="template-grid" role="radiogroup" aria-label="Project template">
              {PROJECT_TEMPLATES.map((entry) => {
                const Icon = TEMPLATE_ICONS[entry.icon] || Layers;
                const isActive = templateId === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    className={`template-card ${isActive ? 'active' : ''}`}
                    onClick={() => handleSelectTemplate(entry)}
                    title={entry.description}
                  >
                    <Icon size={16} className="template-card-icon" />
                    <span className="template-card-name">{entry.label}</span>
                    <span className="template-card-tagline">{entry.tagline}</span>
                  </button>
                );
              })}
            </div>

            <div className="template-summary">
              <p className="template-summary-text">{template.description}</p>
              <div className="template-track-row">
                <span className="template-track-label">Tracks</span>
                {templateDefaults.tracks.map((track) => (
                  <span className="template-track-chip" key={track.id}>
                    {track.name}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Project Name Field */}
          <div className="form-field-group">
            <label className="form-label">Project Name</label>
            <input
              type="text"
              className="modal-text-input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. intro-animation"
              autoFocus
            />
          </div>

          {/* Location Picker */}
          <div className="form-field-group">
            <label className="form-label">Project Location</label>
            <div className="location-picker-row">
              <div className="location-display-box">
                <FolderOpen size={15} className="text-amber flex-shrink-0" />
                <span className="location-path-text">
                  {parentDirHandle ? `${parentDirHandle.name}/${projectName || 'new-project'}` : 'Select a folder on your computer...'}
                </span>
              </div>
              <button
                type="button"
                className="browse-folder-btn"
                onClick={handlePickLocation}
              >
                Browse...
              </button>
            </div>
          </div>

          {/* Resolution Picker -- sets the project's actual canvas size.
              EntityRenderer's preview frame derives its aspect-ratio from
              this (see App.jsx `resolution` state + EntityRenderer's
              `resolution` prop), so whatever is picked here is exactly
              what the Game preview locks to once the project opens. */}
          <div className="form-field-group">
            <label className="form-label">Resolution</label>
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

          {/* Scaffolding Preview */}
          <div className="scaffold-preview-box">
            <span className="scaffold-title">Project Structure:</span>
            <div className="scaffold-tree">
              <div>📁 {projectName || 'my-project'}/</div>
              <div className="tree-sub">├── 📄 project.json <span className="tree-dim">({resolution.width}×{resolution.height}, {templateDefaults.tracks.length} tracks, 0 clips)</span></div>
              <div className="tree-sub">├── 📁 scripts/ <span className="tree-dim">(JS/TS motion, React &amp; canvas scripts)</span></div>
              <div className="tree-sub">├── 📁 prefabs/ <span className="tree-dim">(Reusable GameObjects)</span></div>
              <div className="tree-sub">└── 📁 media/ <span className="tree-dim">(Audio &amp; Video assets)</span></div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary-create"
              disabled={isCreating || !parentDirHandle || !projectName.trim()}
            >
              {isCreating ? 'Creating Folder...' : 'Create Project'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
