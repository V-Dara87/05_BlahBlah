import { useCallback, useEffect, useRef, useState } from 'react';
import { saveProjectToDirectory } from '../services/projectFileSystem';
 
/**
 * useProjectPersistence — disk folder handle + save status + autosave.
 *
 * Owns the on-disk project folder handle, the save-status badge state
 * ('saved' | 'saving' | 'in-memory'), the schema-version warning (set when
 * an opened project.json is newer than this build supports — see
 * warnIfSchemaVersionTooNew in engine/ecs.js), the manual "Save Project to
 * Disk" action, and the 800ms-debounced autosave effect that fires
 * whenever `projectState` changes while a folder is attached.
 *
 * Deliberately separate from useProjectStore: this is "editor around the
 * document" bookkeeping (where it's saved, whether it's dirty), not part
 * of the undo-scoped document model itself. `projectFolderHandle` is
 * still exposed as state here (rather than folded away) because
 * useProjectStore, useMediaAssets, and several App-level handlers all
 * need to read/set it directly (e.g. the various project-open/-create
 * flows call setProjectFolderHandle).
 *
 * `projectState` is assembled in App.jsx from pieces owned by several
 * different hooks (project name, resolution, tracks/scripts/prefabs/
 * entities from useProjectStore, mediaAssets from useMediaAssets) — those
 * hooks in turn need `projectFolderHandle`/`setProjectFolderHandle` from
 * THIS hook as inputs (e.g. useProjectStore's load paths call
 * setProjectFolderHandle). That's a circular ordering: this hook needs
 * `projectState` to save, but the things that build `projectState` need
 * this hook's state first. Taking `getProjectState` as a lazy getter
 * (rather than `projectState` as a value) breaks the cycle — App.jsx can
 * call this hook early for the folder-handle/status state, then define
 * the getter to close over `projectState` once it's built further down,
 * without this hook needing to be called a second time. `onNeedNewProject`
 * is called when a manual save is attempted with no folder attached yet
 * (opens the New Project modal).
 */
export function useProjectPersistence({ getProjectState, onNeedNewProject }) {
  const [projectFolderHandle, setProjectFolderHandle] = useState(null);
  const [saveStatus, setSaveStatus] = useState('in-memory'); // 'saved' | 'saving' | 'in-memory'
  const [schemaWarning, setSchemaWarning] = useState(null);
  const isAutoSavingRef = useRef(false);
 
  // Save Project to Disk manually
  const handleSaveProjectToDisk = useCallback(async () => {
    if (!projectFolderHandle) {
      onNeedNewProject?.();
      return;
    }
    setSaveStatus('saving');
    try {
      await saveProjectToDirectory(projectFolderHandle, getProjectState());
      setSaveStatus('saved');
    } catch (err) {
      console.error('Disk save error:', err);
      alert(`Save failed: ${err.message}`);
      setSaveStatus('in-memory');
    }
  }, [projectFolderHandle, getProjectState, onNeedNewProject]);
 
  // Auto-Save Debounce to Disk
  useEffect(() => {
    if (!projectFolderHandle) return;
 
    const timer = setTimeout(async () => {
      if (isAutoSavingRef.current) return;
      isAutoSavingRef.current = true;
      setSaveStatus('saving');
      try {
        await saveProjectToDirectory(projectFolderHandle, getProjectState());
        setSaveStatus('saved');
      } catch {
        // Ignore background auto-save error
      } finally {
        isAutoSavingRef.current = false;
      }
    }, 800);
 
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getProjectState
    // closes over projectState, which changes every render projectState
    // changes; depending on projectState itself (not just the folder
    // handle) restores the original file's autosave-on-every-doc-change
    // behavior without this hook needing to know projectState's shape.
  }, [projectFolderHandle, getProjectState]);
 
  return {
    projectFolderHandle,
    setProjectFolderHandle,
    saveStatus,
    setSaveStatus,
    schemaWarning,
    setSchemaWarning,
    handleSaveProjectToDisk,
  };
}