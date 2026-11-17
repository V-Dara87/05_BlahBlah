import { useEffect, useMemo, useState } from 'react';
import {
  Layers,
  FolderPlus,
  FolderOpen,
  FolderInput,
  Folder,
  Search,
  X,
  Check,
  Pencil,
  Trash2,
  Plus,
  AlertCircle,
} from 'lucide-react';
import {
  listRecentProjects,
  listProjectFolders,
  forgetProject,
  createProjectFolder,
  renameProjectFolder,
  deleteProjectFolder,
  assignProjectToFolder,
} from '../../services/recentProjects';
import { pickProjectToOpen } from '../../services/projectFile';
import { ContextMenu } from '../shared/ContextMenu';
import {
  ALL_PROJECTS_ID,
  DEFAULT_PROJECT_SORT,
  PROJECT_SORTS,
  UNFILED_PROJECTS_ID,
  buildProjectGroups,
  countProjectsPerFolder,
} from '../../utils/hubProjectList';
import './hub-screen.css';

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * Landing "hub" screen shown before the editor loads. Lists every project
 * folder the app has created or opened before (via services/recentProjects,
 * an IndexedDB store that keeps the actual directory handle), so reopening
 * one is a single click + a permission re-grant instead of re-browsing to
 * it. Separate from NewProjectModal — this screen is what decides whether
 * NewProjectModal / an Open-folder picker / a recent entry gets used, it
 * doesn't replace any of them.
 *
 * DESIGN
 *   Deliberately plain: flat surfaces, no gradients, one primary action. The
 *   folder chips only appear once there is something to filter, rows reveal
 *   their actions on hover/focus, and Enter in the search box opens the top
 *   match.
 *
 * ORGANISING THE LIST
 *   The store keeps every folder ever created or opened, which stops being a
 *   list you can scan once there are a few dozen. This screen adds the three
 *   things that make it usable, and all of them are Hub-local (folders never
 *   touch the disk):
 *     - a search box, matching name AND path (see utils/hubProjectList.js)
 *     - a sort selector
 *     - user-made folders: a filter chip per folder, group headings in the
 *       list, and a per-project "move to folder" menu
 *   The filtering/grouping itself is pure and lives in utils/hubProjectList.js,
 *   so it can be tested without IndexedDB or a directory handle; this component
 *   only renders what that returns and calls the store for mutations.
 */
export function HubScreen({ onNewProject, onOpenProjectFolder, onOpenRecentProject }) {
  const [recents, setRecents] = useState([]);
  const [folders, setFolders] = useState([]);
  const [isLoadingRecents, setIsLoadingRecents] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [openingId, setOpeningId] = useState(null);

  // List controls
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(DEFAULT_PROJECT_SORT);
  const [activeFolderId, setActiveFolderId] = useState(ALL_PROJECTS_ID);

  // Folder management
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  // The per-project "move to folder" menu: { projectId, x, y } | null
  const [moveMenu, setMoveMenu] = useState(null);

  const refresh = async () => {
    try {
      const [projectList, folderList] = await Promise.all([listRecentProjects(), listProjectFolders()]);
      setRecents(projectList);
      setFolders(folderList);
    } catch (err) {
      // IndexedDB unsupported/blocked — Hub still works, it just can't
      // remember folders across sessions.
      console.warn('Could not load recent projects:', err);
    } finally {
      setIsLoadingRecents(false);
    }
  };

  useEffect(() => {
    refresh();
    // Mount-only: refresh() re-reads both stores and is called explicitly after
    // every mutation, so there is nothing to depend on here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => countProjectsPerFolder(recents, folders), [recents, folders]);
  const groups = useMemo(
    () => buildProjectGroups(recents, folders, { query, sort, folderId: activeFolderId }),
    [recents, folders, query, sort, activeFolderId]
  );
  const matchCount = useMemo(
    () => groups.reduce((total, group) => total + group.projects.length, 0),
    [groups]
  );

  const activeFolder = folders.find((folder) => folder.id === activeFolderId) || null;

  // A folder can be deleted while it is the active filter. Without this the list
  // would keep showing that folder's empty state while its chip is gone, with no
  // way back to the full list.
  useEffect(() => {
    if (activeFolderId === ALL_PROJECTS_ID || activeFolderId === UNFILED_PROJECTS_ID) return;
    if (!folders.some((folder) => folder.id === activeFolderId)) setActiveFolderId(ALL_PROJECTS_ID);
  }, [folders, activeFolderId]);

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
    refresh();
  };

  const handleBrowseOpen = async () => {
    setErrorMsg('');
    try {
      const dirHandle = await pickProjectToOpen();
      await onOpenProjectFolder(dirHandle);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setErrorMsg(err?.message || 'Failed to open folder.');
      }
    }
  };

  const handleCreateFolder = async () => {
    const created = await createProjectFolder(newFolderName);
    if (!created) return;
    setNewFolderName('');
    setIsCreatingFolder(false);
    await refresh();
    // Jumping into the new folder is what makes creating an empty one feel like
    // it worked.
    setActiveFolderId(created.id);
  };

  const handleRenameFolder = async (id) => {
    const renamed = await renameProjectFolder(id, renameDraft);
    setRenamingFolderId(null);
    setRenameDraft('');
    if (renamed) await refresh();
  };

  const handleDeleteFolder = async (id) => {
    await deleteProjectFolder(id);
    setConfirmingDeleteId(null);
    await refresh();
  };

  const handleAssignFolder = async (projectId, folderId) => {
    setMoveMenu(null);
    await assignProjectToFolder(projectId, folderId);
    await refresh();
  };

  const renderFolderChip = (id, label, count, extraProps = {}) => {
    const isActive = activeFolderId === id;

    if (renamingFolderId === id) {
      return (
        <span className="hub-folder-chip editing" key={id}>
          <input
            className="hub-folder-input"
            value={renameDraft}
            autoFocus
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameFolder(id);
              if (e.key === 'Escape') {
                setRenamingFolderId(null);
                setRenameDraft('');
              }
            }}
            onBlur={() => setRenamingFolderId(null)}
            aria-label={`Rename ${label}`}
          />
        </span>
      );
    }

    if (confirmingDeleteId === id) {
      return (
        <span className="hub-folder-chip editing" key={id}>
          <span className="hub-folder-confirm-text">Delete “{label}”?</span>
          <button
            type="button"
            className="hub-folder-confirm danger"
            onClick={() => handleDeleteFolder(id)}
          >
            Delete
          </button>
          <button
            type="button"
            className="hub-folder-confirm"
            onClick={() => setConfirmingDeleteId(null)}
          >
            Cancel
          </button>
        </span>
      );
    }

    return (
      <span className={`hub-folder-chip-wrap ${isActive ? 'active' : ''}`} key={id}>
        <button
          type="button"
          className={`hub-folder-chip ${isActive ? 'active' : ''}`}
          onClick={() => setActiveFolderId(id)}
          aria-pressed={isActive}
        >
          {extraProps.icon || <Folder size={12} />}
          <span className="hub-folder-chip-label">{label}</span>
          <span className="hub-folder-chip-count">{count}</span>
        </button>

        {/* Rename / delete appear only on the folder you are looking at, so the
            chip row does not become a wall of icons. */}
        {isActive && extraProps.manageable && (
          <span className="hub-folder-chip-actions">
            <button
              type="button"
              className="hub-folder-action"
              title={`Rename “${label}”`}
              onClick={() => {
                setRenamingFolderId(id);
                setRenameDraft(label);
              }}
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              className="hub-folder-action danger"
              title={`Delete “${label}” — the projects inside are kept, they just go back to Unfiled`}
              onClick={() => setConfirmingDeleteId(id)}
            >
              <Trash2 size={11} />
            </button>
          </span>
        )}
      </span>
    );
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      setQuery('');
    } else if (e.key === 'Enter') {
      const first = groups[0]?.projects?.[0];
      if (first && openingId === null) handleOpenRecent(first);
    }
  };

  const hasProjects = recents.length > 0;
  // "Unfiled" only means something once there is a folder to be unfiled from.
  const hasFolders = folders.length > 0;

  return (
    <div className="hub-screen">
      <div className="hub-container">
        <header className="hub-brand">
          <div className="hub-logo" aria-hidden="true">
            <Layers size={20} />
          </div>
          <div>
            <h1 className="hub-title">blahblah</h1>
            <p className="hub-subtitle">Open a project or start a new one.</p>
          </div>
        </header>

        {errorMsg && (
          <div className="modal-alert-box error hub-alert" role="alert">
            <AlertCircle size={14} />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="hub-actions-row">
          <button type="button" className="hub-btn hub-btn-primary" onClick={onNewProject}>
            <FolderPlus size={16} />
            New Project
          </button>
          <button type="button" className="hub-btn" onClick={handleBrowseOpen}>
            <FolderOpen size={16} />
            Open Project
          </button>
        </div>

        <section className="hub-projects" aria-label="Projects">
          <div className="hub-projects-head">
            <h2 className="hub-section-title">{activeFolder ? activeFolder.name : 'Projects'}</h2>
            {!isLoadingRecents && hasProjects && (
              <span className="hub-count">
                {query.trim() || activeFolder ? `${matchCount} of ${recents.length}` : recents.length}
              </span>
            )}
          </div>

          {hasProjects && (
            <div className="hub-toolbar">
              <div className="hub-search">
                <Search size={14} className="hub-search-icon" />
                <input
                  type="text"
                  className="hub-search-input"
                  placeholder="Search projects"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  aria-label="Search projects"
                />
                {query && (
                  <button
                    type="button"
                    className="hub-search-clear"
                    title="Clear search (Esc)"
                    onClick={() => setQuery('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <select
                className="hub-sort-select"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Sort projects"
              >
                {PROJECT_SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {hasProjects && (
            <div className="hub-folder-chips" role="group" aria-label="Filter by folder">
              {hasFolders &&
                renderFolderChip(ALL_PROJECTS_ID, 'All', counts[ALL_PROJECTS_ID] ?? 0, {
                  icon: <Layers size={12} />,
                })}
              {folders.map((folder) =>
                renderFolderChip(folder.id, folder.name, counts[folder.id] ?? 0, { manageable: true })
              )}
              {hasFolders &&
                renderFolderChip(UNFILED_PROJECTS_ID, 'Unfiled', counts[UNFILED_PROJECTS_ID] ?? 0, {
                  icon: <FolderInput size={12} />,
                })}

              {isCreatingFolder ? (
                <span className="hub-folder-chip editing">
                  <input
                    className="hub-folder-input"
                    value={newFolderName}
                    autoFocus
                    placeholder="Folder name"
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateFolder();
                      if (e.key === 'Escape') {
                        setIsCreatingFolder(false);
                        setNewFolderName('');
                      }
                    }}
                    onBlur={() => setIsCreatingFolder(false)}
                    aria-label="New folder name"
                  />
                </span>
              ) : (
                <button
                  type="button"
                  className="hub-new-folder-btn"
                  onClick={() => setIsCreatingFolder(true)}
                  title="Create a folder to organise your projects"
                >
                  <Plus size={12} />
                  New folder
                </button>
              )}
            </div>
          )}

          {isLoadingRecents && <p className="hub-empty-text">Loading…</p>}

          {!isLoadingRecents && !hasProjects && (
            <div className="hub-empty">
              <p className="hub-empty-title">No projects yet</p>
              <p className="hub-empty-text">Projects you create or open will show up here.</p>
            </div>
          )}

          {!isLoadingRecents && hasProjects && groups.length === 0 && (
            <p className="hub-empty-text">
              {query.trim()
                ? `No projects match “${query.trim()}”.`
                : 'Nothing in this folder yet — use the folder button on a project to move it here.'}
            </p>
          )}

          {!isLoadingRecents && groups.map((group) => (
            <div className="hub-group" key={group.id}>
              {/* A heading only earns its space when the list is actually split. */}
              {groups.length > 1 && (
                <div className="hub-group-heading">
                  <span>{group.name}</span>
                  <span className="hub-group-count">{group.projects.length}</span>
                </div>
              )}

              <ul className="hub-list">
                {group.projects.map((entry) => (
                  <li key={entry.id} className="hub-row">
                    <button
                      type="button"
                      className="hub-row-main"
                      onClick={() => handleOpenRecent(entry)}
                      disabled={openingId !== null}
                      title={entry.path ? `${entry.path}\nCreated ${formatDate(entry.createdAt)}` : undefined}
                    >
                      <Folder size={18} className="hub-row-icon" />
                      <span className="hub-row-text">
                        <span className="hub-row-name">{entry.name}</span>
                        {entry.path && <span className="hub-row-path">{entry.path}</span>}
                      </span>
                      <span className="hub-row-date">
                        {openingId === entry.id ? 'Opening…' : formatDate(entry.lastOpenedAt)}
                      </span>
                    </button>

                    {openingId !== entry.id && (
                      <div className="hub-row-actions">
                        <button
                          type="button"
                          className="hub-icon-btn"
                          title="Move to a folder"
                          aria-label={`Move ${entry.name} to a folder`}
                          onClick={(e) => setMoveMenu({ projectId: entry.id, x: e.clientX, y: e.clientY })}
                        >
                          <FolderInput size={14} />
                        </button>
                        <button
                          type="button"
                          className="hub-icon-btn hub-icon-btn-danger"
                          title="Remove from this list (the project files stay on disk)"
                          aria-label={`Remove ${entry.name} from the list`}
                          onClick={(e) => handleForget(e, entry.id)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>

      {moveMenu && (
        <ContextMenu
          x={moveMenu.x}
          y={moveMenu.y}
          onClose={() => setMoveMenu(null)}
          minWidth={180}
          className="hub-move-menu"
        >
          {(() => {
            const current = recents.find((entry) => entry.id === moveMenu.projectId)?.folderId || null;
            return (
              <>
                <button className="ctx-menu-item" onClick={() => handleAssignFolder(moveMenu.projectId, null)}>
                  <FolderInput size={13} />
                  <span className="ctx-menu-label">Unfiled</span>
                  {!current && <Check size={12} />}
                </button>
                {folders.length === 0 && (
                  <p className="hub-menu-empty">No folders yet — create one above.</p>
                )}
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    className="ctx-menu-item"
                    onClick={() => handleAssignFolder(moveMenu.projectId, folder.id)}
                  >
                    <Folder size={13} />
                    <span className="ctx-menu-label">{folder.name}</span>
                    {current === folder.id && <Check size={12} />}
                  </button>
                ))}
              </>
            );
          })()}
        </ContextMenu>
      )}
    </div>
  );
}