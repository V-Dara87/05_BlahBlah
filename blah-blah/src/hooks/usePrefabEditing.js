import { useCallback, useMemo, useState } from 'react';
import { useEntityActions } from './useEntityActions';
import { isScriptComponent, syncPrefabInstances } from '../engine/ecs';
 
/**
 * usePrefabEditing — prefab edit-mode state + its own entity actions.
 *
 * "Prefab mode" is a second, parallel editing surface: instead of editing
 * the scene's own entities/tracks, the Inspector/Timeline/Preview switch
 * to editing a standalone copy of a prefab's entity tree
 * (`prefabEntities`), via its own `useEntityActions` instance
 * (`prefabEntityActions`) so undo/redo, split/delete/duplicate etc. all
 * work identically to the main scene without touching the real document.
 *
 * Owns: editingPrefabId/editingPrefab/isPrefabMode, prefabEntities (+ the
 * dirty-tracking setter), isPrefabSaved/isPrefabSynced, and the
 * enter/save/sync/exit handlers. Exposes `prefabEntityActions` directly
 * so callers (App.jsx) can pick between it and the main scene's handlers
 * based on `isPrefabMode` — that branching stays in App.jsx since it also
 * has to happen in menuBarConfig, EditorContext, and
 * EditorPlaybackShortcuts, which this hook doesn't own.
 *
 * Needs `tracks`/`scripts`/`prefabs`/`mediaAssets`/`setTracks` (from
 * useProjectStore) to seed a prefab's initial entity list and to run its
 * own useEntityActions instance, `handleUpdatePrefab`/`setEntities` (from
 * useProjectStore) to persist saves and push sync changes into the scene,
 * and `selectedEntityId`/`setSelectedEntityId`/`setSelectedIds`/
 * `getPlaybackTime` to keep selection and playback-time-dependent ops
 * (split-at-playhead etc.) consistent with the main scene.
 */
export function usePrefabEditing({
  tracks,
  scripts,
  prefabs,
  mediaAssets,
  setTracks,
  handleUpdatePrefab,
  setEntities,
  selectedEntityId,
  setSelectedEntityId,
  setSelectedIds,
  getPlaybackTime,
}) {
  const [editingPrefabId, setEditingPrefabId] = useState(null);
  const [prefabEntities, setPrefabEntities] = useState([]);
  const [isPrefabSaved, setIsPrefabSaved] = useState(true);
  const [isPrefabSynced, setIsPrefabSynced] = useState(false);
 
  const editingPrefab = useMemo(() => {
    if (!editingPrefabId) return null;
    return prefabs.find((p) => p.id === editingPrefabId) || null;
  }, [editingPrefabId, prefabs]);
 
  const isPrefabMode = Boolean(editingPrefabId && editingPrefab);
 
  const setPrefabEntitiesWithDirty = useCallback((updater) => {
    setPrefabEntities((prev) => (typeof updater === 'function' ? updater(prev) : updater));
    setIsPrefabSaved(false);
    setIsPrefabSynced(false);
  }, []);
 
  const prefabEntityActions = useEntityActions({
    entities: prefabEntities,
    tracks,
    scripts,
    prefabs,
    mediaAssets,
    setEntities: setPrefabEntitiesWithDirty,
    setTracks,
    setProjectHistoryState: (updater) => {
      if (typeof updater === 'function') {
        const next = updater({ tracks, entities: prefabEntities });
        if (next.tracks) setTracks(next.tracks);
        if (next.entities) setPrefabEntitiesWithDirty(next.entities);
      }
    },
    selectedEntityId,
    setSelectedEntityId,
    getPlaybackTime,
  });
 
  const handleEnterPrefabMode = useCallback((prefabId) => {
    const p = prefabs.find((item) => item.id === prefabId);
    if (!p) return;
    setEditingPrefabId(prefabId);
    let initialEntities = [];
    if (Array.isArray(p.entities) && p.entities.length > 0) {
      initialEntities = JSON.parse(JSON.stringify(p.entities));
    } else {
      initialEntities = [{
        id: p.rootId || `prefab-root-${Date.now()}`,
        name: p.name ? p.name.replace(/ Prefab$/, '') : 'Prefab Root',
        trackId: tracks[0]?.id || 'track-1',
        startTime: 0,
        duration: p.duration || 5,
        components: JSON.parse(JSON.stringify(p.components || [])),
        parentId: null,
      }];
    }
    // Ensure all entities have a valid trackId
    const trackIds = new Set(tracks.map((t) => t.id));
    initialEntities.forEach((ent) => {
      if (!ent.trackId || !trackIds.has(ent.trackId)) {
        ent.trackId = tracks[0]?.id || 'track-1';
      }
    });
    setPrefabEntities(initialEntities);
    setIsPrefabSaved(true);
    setSelectedEntityId(initialEntities[0]?.id || null);
    setSelectedIds([]);
  }, [prefabs, tracks, setSelectedEntityId, setSelectedIds]);
 
  const handleSaveCurrentPrefab = useCallback(async () => {
    if (!editingPrefabId || !editingPrefab) return;
    const maxDuration = Math.max(
      ...prefabEntities.map((e) => (e.startTime || 0) + (e.duration || 0)),
    );
    const rootEntity = prefabEntities.find((e) => !e.parentId) || prefabEntities[0];
 
    // Collect all referenced scripts
    const usedScriptIds = new Set();
    prefabEntities.forEach((snap) => {
      (snap.components || []).forEach((c) => {
        if (isScriptComponent(c) && c.scriptId) {
          usedScriptIds.add(c.scriptId);
        }
      });
    });
    const embeddedScripts = (scripts || [])
      .filter((s) => usedScriptIds.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description || '',
        code: s.code || '',
      }));
 
    const updatedData = {
      rootId: rootEntity ? rootEntity.id : editingPrefab.rootId,
      entities: prefabEntities,
      duration: maxDuration,
      components: rootEntity ? rootEntity.components : (editingPrefab.components || []),
      embeddedScripts,
    };
    await handleUpdatePrefab(editingPrefabId, updatedData);
    setIsPrefabSaved(true);
  }, [editingPrefabId, editingPrefab, prefabEntities, scripts, handleUpdatePrefab]);
 
  // Sync Prefab changes to all instances across the scene timeline
  const handleSyncPrefabToSceneInstances = useCallback(async () => {
    if (!editingPrefabId || !editingPrefab) return;
    const maxDuration = Math.max(
      ...prefabEntities.map((e) => (e.startTime || 0) + (e.duration || 0)),
    );
    const rootEntity = prefabEntities.find((e) => !e.parentId) || prefabEntities[0];
 
    // Collect all referenced scripts
    const usedScriptIds = new Set();
    prefabEntities.forEach((snap) => {
      (snap.components || []).forEach((c) => {
        if (isScriptComponent(c) && c.scriptId) {
          usedScriptIds.add(c.scriptId);
        }
      });
    });
    const embeddedScripts = (scripts || [])
      .filter((s) => usedScriptIds.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description || '',
        code: s.code || '',
      }));
 
    const updatedData = {
      rootId: rootEntity ? rootEntity.id : editingPrefab.rootId,
      entities: prefabEntities,
      duration: maxDuration,
      components: rootEntity ? rootEntity.components : (editingPrefab.components || []),
      embeddedScripts,
    };
    await handleUpdatePrefab(editingPrefabId, updatedData);
    setIsPrefabSaved(true);
 
    // Sync all timeline instances
    setEntities((prev) =>
      syncPrefabInstances(prev, editingPrefabId, prefabEntities, rootEntity ? rootEntity.id : null)
    );
 
    setIsPrefabSynced(true);
    setTimeout(() => setIsPrefabSynced(false), 2500);
  }, [editingPrefabId, editingPrefab, prefabEntities, scripts, handleUpdatePrefab, setEntities]);
 
  const handleExitPrefabMode = useCallback(() => {
    if (editingPrefabId && !isPrefabSaved) {
      handleSaveCurrentPrefab();
    }
    setEditingPrefabId(null);
    setPrefabEntities([]);
    setSelectedEntityId(null);
    setSelectedIds([]);
    setIsPrefabSaved(true);
    setIsPrefabSynced(false);
  }, [editingPrefabId, isPrefabSaved, handleSaveCurrentPrefab, setSelectedEntityId, setSelectedIds]);
 
  return {
    editingPrefabId,
    editingPrefab,
    isPrefabMode,
    prefabEntities,
    isPrefabSaved,
    isPrefabSynced,
    prefabEntityActions,
    handleEnterPrefabMode,
    handleSaveCurrentPrefab,
    handleSyncPrefabToSceneInstances,
    handleExitPrefabMode,
  };
}