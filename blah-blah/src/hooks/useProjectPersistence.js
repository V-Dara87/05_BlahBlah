import { useCallback, useRef, useState } from 'react';
import { saveProjectToDirectory } from '../services/projectFileSystem';
 
/**
 * useProjectPersistence — disk folder handle + save status + the save queue.
 *
 * Owns the on-disk project folder handle, the save-status badge state
 * ('saved' | 'saving' | 'unsaved' | 'in-memory'), the schema-version warning
 * (set when an opened project.json is newer than this build supports — see
 * warnIfSchemaVersionTooNew in engine/ecs.js), the manual "Save Project to
 * Disk" action, and `requestSave`, the single entry point the autosave hook
 * (hooks/useProjectAutosave.js) uses to write the project.
 *
 * WHEN to autosave (debounce, change detection, blur/close flush, the user
 * settings) lives in useProjectAutosave. This hook only decides HOW a save
 * runs, and guarantees:
 *
 *  - One save at a time. A request that arrives while a save is running is not
 *    dropped (the old autosave simply returned and forgot it, so the last edit
 *    could go unsaved until some later change): it is remembered and runs once
 *    as soon as the current save finishes. Any number of requests during one
 *    save coalesce into a single follow-up save, which snapshots the newest
 *    state at that moment.
 *  - A manual save waits for a running save instead of racing it, then always
 *    forces a full write of project.json and every prefab.
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
 * (rather than `projectState` as a value) breaks the cycle. The getter is
 * kept in a ref that is refreshed every render, so callers may pass a fresh
 * inline arrow each time without changing this hook's callbacks' identity —
 * and every save reads the latest state at the moment it actually runs.
 * `onNeedNewProject` is called when a manual save is attempted with no folder
 * attached yet (opens the New Project modal).
 */
export function useProjectPersistence({ getProjectState, onNeedNewProject }) {
  const [projectFolderHandle, setProjectFolderHandle] = useState(null);
  // 'saved' | 'saving' | 'unsaved' (changes not on disk yet) | 'in-memory' (last save failed)
  const [saveStatus, setSaveStatus] = useState('in-memory');
  const [schemaWarning, setSchemaWarning] = useState(null);
 
  const getProjectStateRef = useRef(getProjectState);
  getProjectStateRef.current = getProjectState;
  const onNeedNewProjectRef = useRef(onNeedNewProject);
  onNeedNewProjectRef.current = onNeedNewProject;
  const folderHandleRef = useRef(projectFolderHandle);
  folderHandleRef.current = projectFolderHandle;
 
  const inFlightRef = useRef(null); // Promise of the running save, or null
  const queuedRef = useRef(null);   // options of the one coalesced follow-up save, or null
 
  // Runs one save. Never rejects: failures are reported through saveStatus
  // (and an alert for manual saves) and resolve to `false`.
  const startSave = useCallback(function run(options) {
    const handle = folderHandleRef.current;
    const isManual = !!options.manual;
    if (!handle) return Promise.resolve(false);
 
    const promise = (async () => {
      setSaveStatus('saving');
      try {
        await saveProjectToDirectory(
          handle,
          // Evaluated by saveProjectToDirectory only once it owns the project
          // lock, so the snapshot is never older than a direct file write.
          () => getProjectStateRef.current(),
          { force: !!options.force, skipUnchanged: options.skipUnchanged !== false }
        );
        // A different folder may have been opened while we were saving.
        if (folderHandleRef.current === handle) setSaveStatus('saved');
        return true;
      } catch (err) {
        if (isManual) {
          console.error('Disk save error:', err);
          alert(`Save failed: ${err.message}`);
        } else {
          console.warn('Autosave failed:', err);
        }
        if (folderHandleRef.current === handle) setSaveStatus('in-memory');
        return false;
      }
    })();
 
    inFlightRef.current = promise;
    promise.then(() => {
      inFlightRef.current = null;
      const queued = queuedRef.current;
      if (queued) {
        queuedRef.current = null;
        run(queued);
      }
    });
    return promise;
  }, []);
 
  /**
   * Autosave entry point. Starts a save now, or — if one is already running —
   * queues exactly one follow-up. Resolves to the outcome of the save that was
   * running/started (the queued follow-up is not awaited).
   *
   * @param {{ force?: boolean, skipUnchanged?: boolean }} [options]
   */
  const requestSave = useCallback((options = {}) => {
    if (!folderHandleRef.current) return Promise.resolve(false);
    if (inFlightRef.current) {
      const queued = queuedRef.current;
      queuedRef.current = {
        ...options,
        // Keep the strongest options seen while waiting.
        force: !!(queued?.force || options.force),
        skipUnchanged: !(queued?.skipUnchanged === false || options.skipUnchanged === false),
      };
      return inFlightRef.current;
    }
    return startSave({ ...options, manual: false });
  }, [startSave]);
 
  // Save Project to Disk manually
  const handleSaveProjectToDisk = useCallback(async () => {
    if (!folderHandleRef.current) {
      onNeedNewProjectRef.current?.();
      return;
    }
    // Wait for a running save (and any follow-up it spawns) instead of racing it.
    while (inFlightRef.current) {
      await inFlightRef.current;
    }
    await startSave({ force: true, manual: true });
  }, [startSave]);
 
  return {
    projectFolderHandle,
    setProjectFolderHandle,
    saveStatus,
    setSaveStatus,
    schemaWarning,
    setSchemaWarning,
    handleSaveProjectToDisk,
    requestSave,
  };
}