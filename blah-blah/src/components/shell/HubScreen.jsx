import { useEffect, useState } from 'react';
import { Layers, FolderPlus, FolderOpen, Clock, FolderClock, X, AlertCircle } from 'lucide-react';
import { listRecentProjects, forgetProject } from '../../services/recentProjects';
import { pickProjectDirectory } from '../../services/projectFileSystem';
import './hub-screen.css';
 
function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const datePart = sameDay
    ? 'Today'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}
 
/**
 * Landing "hub" screen shown before the editor loads. Lists every project
 * folder the app has created or opened before (via services/recentProjects,
 * an IndexedDB store that keeps the actual directory handle), so reopening
 * one is a single click + a permission re-grant instead of re-browsing to
 * it. Separate from NewProjectModal — this screen is what decides whether
 * NewProjectModal / an Open-folder picker / a recent entry gets used, it
 * doesn't replace any of them.
 */
export function HubScreen({ onNewProject, onOpenProjectFolder, onOpenRecentProject }) {
  const [recents, setRecents] = useState([]);
  const [isLoadingRecents, setIsLoadingRecents] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [openingId, setOpeningId] = useState(null);
 
  const refreshRecents = async () => {
    try {
      const list = await listRecentProjects();
      setRecents(list);
    } catch (err) {
      // IndexedDB unsupported/blocked — Hub still works, it just can't
      // remember folders across sessions.
      console.warn('Could not load recent projects:', err);
    } finally {
      setIsLoadingRecents(false);
    }
  };
 
  useEffect(() => {
    refreshRecents();
  }, []);
 
  const handleOpenRecent = async (entry) => {
    setErrorMsg('');
    setOpeningId(entry.id);
    try {
      await onOpenRecentProject(entry);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setErrorMsg(err?.message || `Failed to open "${entry.name}".`);
      }
    } finally {
      setOpeningId(null);
    }
  };
 
  const handleForget = async (e, entryId) => {
    e.stopPropagation();
    await forgetProject(entryId);
    refreshRecents();
  };
 
  const handleBrowseOpen = async () => {
    setErrorMsg('');
    try {
      const dirHandle = await pickProjectDirectory();
      await onOpenProjectFolder(dirHandle);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setErrorMsg(err?.message || 'Failed to open folder.');
      }
    }
  };
 
  return (
    <div className="hub-screen">
      <div className="hub-container">
        <div className="hub-brand">
          <div className="unity-icon-box hub-icon-box">
            <Layers size={22} />
          </div>
          <div>
            <h1 className="hub-title">blahblah</h1>
            <p className="hub-subtitle">Pick a project to keep working on, or start something new.</p>
          </div>
        </div>
 
        {errorMsg && (
          <div className="modal-alert-box error hub-alert">
            <AlertCircle size={14} />
            <span>{errorMsg}</span>
          </div>
        )}
 
        <div className="hub-actions-row">
          <button className="hub-action-card primary" onClick={onNewProject}>
            <FolderPlus size={20} className="text-emerald" />
            <span className="hub-action-title">New Project</span>
            <span className="hub-action-sub">Create a fresh project folder on disk</span>
          </button>
 
          <button className="hub-action-card" onClick={handleBrowseOpen}>
            <FolderOpen size={20} className="text-amber" />
            <span className="hub-action-title">Open Folder</span>
            <span className="hub-action-sub">Browse to an existing project</span>
          </button>
        </div>
 
        <div className="hub-recent-section">
          <div className="hub-recent-header">
            <FolderClock size={14} className="text-dim" />
            <span>Recent Projects</span>
          </div>
 
          {isLoadingRecents && (
            <p className="hub-empty-text">Loading...</p>
          )}
 
          {!isLoadingRecents && recents.length === 0 && (
            <p className="hub-empty-text">
              Nothing here yet — folders you create or open will show up for next time.
            </p>
          )}
 
          {!isLoadingRecents && recents.length > 0 && (
            <div className="hub-recent-list">
              {recents.map((entry) => (
                <button
                  key={entry.id}
                  className="hub-recent-item"
                  onClick={() => handleOpenRecent(entry)}
                  disabled={openingId !== null}
                >
                  <div className="hub-recent-icon">
                    <FolderOpen size={16} />
                  </div>
                  <div className="hub-recent-info">
                    <span className="hub-recent-name">{entry.name}</span>
                    {entry.path && (
                      <span className="hub-recent-path" title={entry.path}>
                        {entry.path}
                      </span>
                    )}
                    <span className="hub-recent-dates">
                      <Clock size={10} />
                      Opened {formatDate(entry.lastOpenedAt)}
                      <span className="hub-recent-dates-sep">·</span>
                      Created {formatDate(entry.createdAt)}
                    </span>
                  </div>
                  {openingId === entry.id ? (
                    <span className="hub-recent-status">Opening...</span>
                  ) : (
                    <span
                      className="hub-recent-forget"
                      role="button"
                      tabIndex={-1}
                      title="Remove from recent projects"
                      onClick={(e) => handleForget(e, entry.id)}
                    >
                      <X size={13} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}