import { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, FolderPlus, X } from 'lucide-react';
import { openProjectInExplorer } from '../../services/ideLauncher';
import { joinPath } from '../../services/tauriFsAdapter';
import {
  listCustomFolders,
  createCustomFolder,
  deleteCustomFolder,
} from '../../services/projectFolders';

/**
 * The project's own folders (anything in the project root besides media/,
 * scripts/ and prefabs/), shown after the system folders in the explorer's
 * root view, plus a "New Folder" entry. Self-contained: it reads the folder
 * list itself and keeps it fresh, so the rest of the explorer is untouched.
 *
 * Double-click opens the folder in the OS file manager (desktop build) — its
 * contents are the user's own files, not something the app indexes.
 */
export function CustomFolderEntries({ projectFolderHandle, isGridView }) {
  const [folders, setFolders] = useState([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setFolders(await listCustomFolders(projectFolderHandle));
    } catch (err) {
      console.warn('Could not list project folders:', err);
    }
  }, [projectFolderHandle]);

  // Load when the project changes, and again when the window regains focus so
  // folders made in the file manager or VS Code show up.
  useEffect(() => {
    setFolders([]);
    setCreating(false);
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const commit = async () => {
    if (busyRef.current) return;
    if (!draft.trim()) {
      setCreating(false);
      setError('');
      return;
    }
    busyRef.current = true;
    try {
      await createCustomFolder(projectFolderHandle, draft);
      setCreating(false);
      setDraft('');
      setError('');
      await refresh();
    } catch (err) {
      setError(err?.message || 'Could not create the folder.');
    } finally {
      busyRef.current = false;
    }
  };

  const cancel = () => {
    setCreating(false);
    setDraft('');
    setError('');
  };

  const openFolder = (name) => {
    if (!projectFolderHandle?.path) {
      window.alert('Opening a folder is only available in the desktop app.');
      return;
    }
    openProjectInExplorer(joinPath(projectFolderHandle.path, name));
  };

  const remove = async (e, name) => {
    e.stopPropagation();
    if (!window.confirm(`Delete the folder "${name}" and everything inside it? This can't be undone.`)) return;
    try {
      await deleteCustomFolder(projectFolderHandle, name);
      await refresh();
    } catch (err) {
      window.alert(`Could not delete "${name}": ${err?.message || err}`);
    }
  };

  if (!projectFolderHandle) return null;

  const nameInput = (
    <>
      <input
        className="asset-rename-input"
        autoFocus
        value={draft}
        placeholder="Folder name"
        onChange={(e) => {
          setDraft(e.target.value);
          setError('');
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
        }}
      />
      {error && <span className="folder-card-sub" style={{ color: '#f87171' }}>{error}</span>}
    </>
  );

  const deleteButton = (name) => (
    <button
      type="button"
      className="custom-folder-delete"
      title={`Delete ${name}`}
      onClick={(e) => remove(e, name)}
      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', opacity: 0.5, cursor: 'pointer', padding: 2 }}
    >
      <X size={13} />
    </button>
  );

  if (isGridView) {
    return (
      <>
        {folders.map((name) => (
          <div
            key={`custom:${name}`}
            className="explorer-folder-card"
            onDoubleClick={() => openFolder(name)}
            title={`Double-click to open ${name} in the file manager`}
          >
            <div className="folder-card-icon-wrapper">
              <Folder size={44} className="folder-card-icon text-amber" />
            </div>
            <div className="folder-card-info">
              <span className="folder-card-name">{name}</span>
              <span className="folder-card-sub">Folder</span>
            </div>
            {deleteButton(name)}
          </div>
        ))}
        <div
          className="explorer-folder-card"
          onClick={() => !creating && setCreating(true)}
          title="Create a new folder in this project"
          style={{ opacity: creating ? 1 : 0.7 }}
        >
          <div className="folder-card-icon-wrapper">
            <FolderPlus size={44} className="folder-card-icon text-dim" />
          </div>
          <div className="folder-card-info">
            {creating ? nameInput : <span className="folder-card-name">New Folder</span>}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {folders.map((name) => (
        <div
          key={`custom:${name}`}
          className="explorer-details-row folder-row"
          onDoubleClick={() => openFolder(name)}
          title={`Double-click to open ${name} in the file manager`}
        >
          <div className="details-col col-name">
            <Folder size={15} className="details-row-icon text-amber" />
            <span className="details-row-name-text">{name}</span>
          </div>
          <div className="details-col col-type">Folder</div>
          <div className="details-col col-size">{deleteButton(name)}</div>
        </div>
      ))}
      <div
        className="explorer-details-row folder-row"
        onClick={() => !creating && setCreating(true)}
        title="Create a new folder in this project"
        style={{ opacity: creating ? 1 : 0.7 }}
      >
        <div className="details-col col-name">
          <FolderPlus size={15} className="details-row-icon text-dim" />
          {creating ? nameInput : <span className="details-row-name-text">New Folder</span>}
        </div>
        <div className="details-col col-type" />
        <div className="details-col col-size" />
      </div>
    </>
  );
}