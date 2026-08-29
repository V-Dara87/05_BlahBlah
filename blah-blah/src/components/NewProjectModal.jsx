import { useState } from 'react';
import { FolderPlus, FolderOpen, X, AlertCircle } from 'lucide-react';
import { pickProjectDirectory, createNewProjectFolder } from '../services/projectFileSystem';
 
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
 
  if (!isOpen) return null;
 
  const handlePickLocation = async () => {
    try {
      setErrorMsg('');
      // eslint-disable-next-line no-console
      console.log('[NewProjectModal] opening directory picker...');
      const dirHandle = await pickProjectDirectory();
      // eslint-disable-next-line no-console
      console.log('[NewProjectModal] picker resolved:', dirHandle, 'name =', dirHandle?.name);
      setParentDirHandle(dirHandle);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[NewProjectModal] picker error:', err);
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
      const result = await createNewProjectFolder(parentDirHandle, cleanName, defaultTracks);
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
              <p className="modal-subtitle">Creates a clean project folder on your disk with 0 clips (VS Code ready)</p>
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
 
          {/* Scaffolding Preview */}
          <div className="scaffold-preview-box">
            <span className="scaffold-title">Project Structure:</span>
            <div className="scaffold-tree">
              <div>📁 {projectName || 'my-project'}/</div>
              <div className="tree-sub">├── 📄 project.json <span className="tree-dim">(0 timeline clips, tracks)</span></div>
              <div className="tree-sub">├── 📁 scripts/ <span className="tree-dim">(C# MonoBehaviour scripts)</span></div>
              <div className="tree-sub">├── 📁 prefabs/ <span className="tree-dim">(Reusable GameObjects)</span></div>
              <div className="tree-sub">└── 📁 media/ <span className="tree-dim">(Audio & Video assets)</span></div>
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