import { useCallback } from 'react';
import { useUndoableState } from './useUndoableState';
import { INITIAL_TRACKS } from '../types';
import { useEntityActions } from './useEntityActions';
import { usePrefabScriptActions } from './usePrefabScriptActions';
import { useProjectFileActions } from './useProjectFileActions';
 
/**
 * useProjectStore — project *content* state + every handler that edits it.
 *
 * Holds the four undo-scoped slices (entities / tracks / scripts / prefabs)
 * inside ONE useUndoableState history stack, so a single Ctrl+Z reverts the
 * last logical edit across all of them (mediaAssets / projectName /
 * selection intentionally stay OUT of undo scope — see App.jsx, matching how
 * most editors treat asset imports and selection as non-undoable
 * housekeeping).
 *
 * This file now only owns the history stack itself and the four undo-scoped
 * setters (setEntities / setTracks / setScripts / setPrefabs); every
 * handler that used to live here has moved into one of three domain hooks,
 * split by how tightly each group of handlers is coupled to the shared
 * history state:
 *   - useEntityActions        — entity/clip/track edits + timeline
 *                                placement (the one domain that touches
 *                                more than one slice at once, e.g. placing
 *                                a video clip adds a track AND two
 *                                entities in a single undo step)
 *   - usePrefabScriptActions  — prefab/script CRUD (only ever touches
 *                                setPrefabs/setScripts)
 *   - useProjectFileActions   — New/Open/Open-Recent (each resets the
 *                                whole history stack) + the scripts/
 *                                hot-reload poll
 *
 * Everything is a faithful move: no logic changes, no signature changes,
 * useCallback dep arrays preserved verbatim, so handler identity/cadence
 * (and therefore every memoized consumer: Timeline, UnityInspector,
 * Dopesheet, dock panels) behaves exactly as before. Cross-cutting values
 * that live elsewhere in App (the shell) are injected as hook params:
 *   - projectFolderHandle + its setter (shell owns the FS handle state)
 *   - setProjectName / setResolution / setScreen / setSelectedEntityId /
 *     setSaveStatus (shell-owned view/project metadata)
 *   - selectedEntityId (shell-owned selection, used by entity ops)
 *   - mediaAssets + setMediaAssets (owned by useMediaAssets; the load paths
 *     replace the media list, and drop-to-timeline looks assets up by id)
 *   - getPlaybackTime (owned by usePlaybackController; split/add/record
 *     handlers place things at the current playhead)
 */
export function useProjectStore({
  projectFolderHandle,
  setProjectFolderHandle,
  setProjectName,
  setResolution,
  setSelectedEntityId,
  selectedEntityId,
  setSaveStatus,
  setSchemaWarning,
  setScreen,
  setMediaAssets,
  mediaAssets,
  getPlaybackTime,
}) {
  // Undo/Redo: entities, tracks, scripts & prefabs live together in one
  // history stack so a single Ctrl+Z reverts the last logical edit across
  // all of them. mediaAssets/projectName/selection are intentionally left
  // out of the undo scope.
  const {
    present: projectHistoryState,
    set: setProjectHistoryState,
    undo,
    redo,
    reset: resetProjectHistoryState,
    canUndo,
    canRedo,
  } = useUndoableState({ entities: [], tracks: INITIAL_TRACKS, scripts: [], prefabs: [] });
  const { entities, tracks, scripts, prefabs } = projectHistoryState;
 
  const setEntities = useCallback((updater, options) => {
    setProjectHistoryState((prev) => ({
      ...prev,
      entities: typeof updater === 'function' ? updater(prev.entities) : updater,
    }), options);
  }, [setProjectHistoryState]);
 
  const setTracks = useCallback((updater, options) => {
    setProjectHistoryState((prev) => ({
      ...prev,
      tracks: typeof updater === 'function' ? updater(prev.tracks) : updater,
    }), options);
  }, [setProjectHistoryState]);
 
  const setScripts = useCallback((updater, options) => {
    setProjectHistoryState((prev) => ({
      ...prev,
      scripts: typeof updater === 'function' ? updater(prev.scripts) : updater,
    }), options);
  }, [setProjectHistoryState]);
 
  const setPrefabs = useCallback((updater, options) => {
    setProjectHistoryState((prev) => ({
      ...prev,
      prefabs: typeof updater === 'function' ? updater(prev.prefabs) : updater,
    }), options);
  }, [setProjectHistoryState]);
 
  const prefabScriptActions = usePrefabScriptActions({
    entities,
    prefabs,
    scripts,
    setPrefabs,
    setScripts,
    projectFolderHandle,
  });

  const entityActions = useEntityActions({
    entities,
    tracks,
    scripts,
    prefabs,
    mediaAssets,
    setEntities,
    setTracks,
    setProjectHistoryState,
    selectedEntityId,
    setSelectedEntityId,
    getPlaybackTime,
    handleUpdatePrefab: prefabScriptActions.handleUpdatePrefab,
  });
 
  const projectFileActions = useProjectFileActions({
    scripts,
    setScripts,
    resetProjectHistoryState,
    projectFolderHandle,
    setProjectFolderHandle,
    setProjectName,
    setResolution,
    setSelectedEntityId,
    setSaveStatus,
    setSchemaWarning,
    setScreen,
    setMediaAssets,
  });
 
  // Apply JSON state to Project. Editing/pasting Project JSON is a single
  // deliberate action, so any entities/tracks/scripts/prefabs changes it
  // carries land as ONE combined undo step (a single Ctrl+Z reverts the
  // whole paste), rather than resetting history or splitting into four.
  const handleApplyProjectJson = (projectJson) => {
    if (projectJson.name) setProjectName(projectJson.name);
    if (projectJson.mediaAssets) setMediaAssets(projectJson.mediaAssets);
    // Resolution is part of the pasted/edited JSON now too -- only apply it
    // if both dimensions are actually valid positive numbers, so a partial
    // or malformed edit doesn't collapse the preview to a 0x0/NaN aspect
    // ratio.
    if (
      projectJson.resolution &&
      Number(projectJson.resolution.width) > 0 &&
      Number(projectJson.resolution.height) > 0
    ) {
      setResolution({
        width: Math.round(Number(projectJson.resolution.width)),
        height: Math.round(Number(projectJson.resolution.height)),
      });
    }
 
    const touchesHistoryState = projectJson.tracks || projectJson.scripts || projectJson.prefabs || projectJson.entities;
    if (touchesHistoryState) {
      setProjectHistoryState((prev) => ({
        entities: projectJson.entities || prev.entities,
        tracks: projectJson.tracks || prev.tracks,
        scripts: projectJson.scripts || prev.scripts,
        prefabs: projectJson.prefabs || prev.prefabs,
      }));
    }
  };
 
  return {
    // data
    entities,
    tracks,
    scripts,
    prefabs,
    // setters (undo-scoped wrappers)
    setEntities,
    setTracks,
    setScripts,
    setPrefabs,
    // undo/redo
    undo,
    redo,
    canUndo,
    canRedo,
    // entity / track / timeline-placement operations
    ...entityActions,
    // prefab / script operations
    ...prefabScriptActions,
    // project JSON apply
    handleApplyProjectJson,
    // project-swap load paths
    ...projectFileActions,
  };
}