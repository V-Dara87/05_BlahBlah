import { useCallback, useEffect, useRef } from 'react';
import { useUndoableState } from './useUndoableState';
import { INITIAL_TRACKS, DEFAULT_RESOLUTION } from '../types';
import {
  createGameObject,
  createDefaultTransform,
  removeEntitiesByIds,
} from '../engine/ecs';
import {
  pickProjectDirectory,
  loadProjectFromDirectory,
  checkScriptsForChanges,
  writeScriptFile,
  verifyPermission,
  watchScriptsDirectory,
} from '../services/projectFileSystem';
import { recordProjectCreated, recordProjectOpened } from '../services/recentProjects';
import { precompileWithBundler, precompileAllProjectScripts, detectScriptKind, extractScriptProps } from '../engine/scriptRunner';
 
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
 * Extracted out of App.jsx (it was ~60% of that file): this is the
 * "document model" half of the app — entity/track/script/prefab operations,
 * the project-swap load paths (New Project / Open Folder, each of which
 * resets undo history), the scripts/ hot-reload poll, and disk round-trips
 * that only touch the undo-scoped slices.
 *
 * Everything here is a faithful move from App.jsx — no logic changes, no
 * signature changes, and useCallback dep arrays are preserved verbatim, so
 * handler identity/cadence (and therefore every memoized consumer:
 * Timeline, UnityInspector, Dopesheet, dock panels) behaves exactly as
 * before. Cross-cutting values that live elsewhere in App (the shell) are
 * injected as hook params:
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
 
 
  // Update entity properties / components. Coalesced: this fires on every
  // intermediate value while dragging a clip or scrubbing an Inspector
  // number field, so we merge those into one undo step per gesture instead
  // of one per pixel/tick.
  const handleUpdateEntity = useCallback((entityId, updates) => {
    // Support _delete flag for context menu deletion
    if (updates._delete) {
      setEntities((prev) => {
        const next = removeEntitiesByIds(prev, [entityId]);
        if (selectedEntityId && !next.some((e) => e.id === selectedEntityId)) {
          setSelectedEntityId(null);
        }
        return next;
      });
      return;
    }
    setEntities((prev) => {
      const target = prev.find((e) => e.id === entityId);
      if (!target) return prev;

      // Check if speed has changed on target
      const oldTransform = target.components?.find((c) => c.type === 'Transform');
      const newTransform = updates.components?.find((c) => c.type === 'Transform');
      const oldSpeed = Number(oldTransform?.speed ?? 1) || 1;
      const newSpeed = updates.speed !== undefined
        ? (Number(updates.speed) || 1)
        : (newTransform && newTransform.speed !== undefined ? (Number(newTransform.speed) || 1) : oldSpeed);

      if (newSpeed > 0 && oldSpeed > 0 && newSpeed !== oldSpeed) {
        const speedRatio = oldSpeed / newSpeed;

        // If updates does not specify duration, scale target duration by speedRatio
        const targetUpdates = updates.duration !== undefined
          ? updates
          : { ...updates, duration: Math.max(0.2, (target.duration || 0) * speedRatio) };

        // Find all descendants of target
        const descendantIds = new Set();
        let queue = [target.id];
        while (queue.length > 0) {
          const pId = queue.shift();
          for (const e of prev) {
            if (e.parentId === pId && !descendantIds.has(e.id)) {
              descendantIds.add(e.id);
              queue.push(e.id);
            }
          }
        }

        if (descendantIds.size > 0) {
          return prev.map((e) => {
            if (e.id === entityId) {
              return { ...e, ...targetUpdates };
            }
            if (descendantIds.has(e.id)) {
              const relStart = e.startTime - target.startTime;
              const newStart = target.startTime + relStart * speedRatio;
              const newDuration = Math.max(0.2, (e.duration || 0) * speedRatio);
              const updatedComps = (e.components || []).map((c) =>
                c.type === 'Transform' ? { ...c, speed: newSpeed } : c
              );
              if (!e.components?.some((c) => c.type === 'Transform')) {
                updatedComps.unshift({ type: 'Transform', speed: newSpeed });
              }
              return {
                ...e,
                startTime: newStart,
                duration: newDuration,
                components: updatedComps,
              };
            }
            return e;
          });
        }

        return prev.map((e) => (e.id === entityId ? { ...e, ...targetUpdates } : e));
      }

      return prev.map((e) => (e.id === entityId ? { ...e, ...updates } : e));
    }, { coalesce: true });
  }, [setEntities, selectedEntityId, setSelectedEntityId]);
 
  // Delete entity.
  const handleDeleteEntity = useCallback((entityId) => {
    setEntities((prev) => {
      const next = removeEntitiesByIds(prev, [entityId]);
      if (selectedEntityId && !next.some((e) => e.id === selectedEntityId)) {
        setSelectedEntityId(null);
      }
      return next;
    });
  }, [setEntities, selectedEntityId, setSelectedEntityId]);
 
  // Ripple trim the selected clip to the playhead — 'before' cuts off
  // everything in the clip before the playhead (start moves up to the
  // playhead, duration shrinks, mediaOffset advances so the remaining
  // media content doesn't jump); 'after' cuts off everything after the
  // playhead (duration shrinks to end at the playhead, start/mediaOffset
  // untouched). No-op if the clip doesn't exist or the playhead isn't
  // strictly inside the clip's range. Mirrors the offset math
  // handleSplitEntity uses for its second half.
  const handleRippleTrimToPlayhead = useCallback((entityId, direction) => {
    const target = entities.find((e) => e.id === entityId);
    if (!target) return;
 
    const start = target.startTime;
    const end = target.startTime + target.duration;
    const playhead = getPlaybackTime();
    if (playhead <= start + 0.001 || playhead >= end - 0.001) return;
 
    if (direction === 'before') {
      const trimmedAmount = playhead - start;
      const newComponents = target.components?.map((c) => {
        if (c.type === 'VideoRenderer' || c.type === 'AudioSource') {
          const origOffset = c.mediaOffset || 0;
          return { ...c, mediaOffset: origOffset + trimmedAmount };
        }
        return c;
      }) || [];
      setEntities((prev) => prev.map((e) => e.id === entityId
        ? { ...e, startTime: playhead, duration: end - playhead, components: newComponents }
        : e
      ));
    } else if (direction === 'after') {
      setEntities((prev) => prev.map((e) => e.id === entityId
        ? { ...e, duration: playhead - start }
        : e
      ));
    }
  }, [entities, getPlaybackTime, setEntities]);
 
  // Batch update multiple entities atomically
  const handleUpdateClips = useCallback((updatesList) => {
    if (!updatesList || updatesList.length === 0) return;
    const updatesMap = new Map(updatesList.map(u => [u.id, u.updates]));
    setEntities(prev => prev.map(e => {
      const u = updatesMap.get(e.id);
      return u ? { ...e, ...u } : e;
    }), { coalesce: true });
  }, [setEntities]);
 
  // Duplicate one or more entities. Each copy gets a fresh id, cloned
  // components, and is offset by the extent of the selection so copies land
  // right after the originals on their own tracks.
  const handleDuplicateClips = useCallback((clipIds) => {
    const ids = Array.isArray(clipIds) ? clipIds : [clipIds];
    if (ids.length === 0) return [];
 
    const targets = entities.filter((e) => ids.includes(e.id));
    if (targets.length === 0) return [];
 
    const minStart = Math.min(...targets.map((m) => m.startTime));
    const maxEnd = Math.max(...targets.map((m) => m.startTime + m.duration));
    const delta = maxEnd - minStart;
 
    // Map old target ids to new generated ids
    const idMap = new Map();
    targets.forEach((t) => {
      idMap.set(t.id, `go-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`);
    });

    const newClips = targets.map((target) => {
      const { linkGroupId: _linkGroupId, ...rest } = target;
      // If the parent was also duplicated in this batch, link to the new parent copy;
      // otherwise, make the duplicated clip independent.
      const mappedParentId = target.parentId && idMap.has(target.parentId) ? idMap.get(target.parentId) : null;
      return {
        ...rest,
        id: idMap.get(target.id),
        parentId: mappedParentId,
        name: `${target.name} (Copy)`,
        startTime: target.startTime + delta,
        components: target.components
          ? JSON.parse(JSON.stringify(target.components))
          : [],
      };
    });
 
    setEntities(prev => [...prev, ...newClips]);
    const newIds = newClips.map(c => c.id);
    if (newIds.length > 0) {
      setSelectedEntityId(newIds[0]);
    }
    return newIds;
  }, [entities, setEntities, setSelectedEntityId]);
 
  // Split entity (or entities) at playhead
  const handleSplitEntity = useCallback((entityIdOrIds) => {
    const rawIds = Array.isArray(entityIdOrIds)
      ? entityIdOrIds
      : entityIdOrIds
        ? [entityIdOrIds]
        : selectedEntityId ? [selectedEntityId] : [];
    if (rawIds.length === 0) return;

    // Expand to include any child clips whose parent is being split
    const splitSet = new Set(rawIds);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const e of entities) {
        if (!splitSet.has(e.id) && e.parentId && splitSet.has(e.parentId)) {
          splitSet.add(e.id);
          expanded = true;
        }
      }
    }
    const ids = Array.from(splitSet);

    const splitPoint = getPlaybackTime();
    let anySplit = false;
    const toAdd = [];
    const updatedMap = new Map();
    const parentPart2Map = new Map();
 
    ids.forEach(id => {
      const target = entities.find(e => e.id === id);
      if (!target) return;
      const start = target.startTime;
      const end = target.startTime + target.duration;
      if (splitPoint <= start + 0.1 || splitPoint >= end - 0.1) return;
 
      anySplit = true;
      const part1Dur = splitPoint - start;
      const part2Dur = end - splitPoint;
 
      const part2Components = target.components?.map(c => {
        if (c.type === 'VideoRenderer' || c.type === 'AudioSource') {
          const origOffset = c.mediaOffset || 0;
          return { ...c, mediaOffset: origOffset + part1Dur };
        }
        return JSON.parse(JSON.stringify(c));
      }) || [];
 
      const part1 = { ...target, name: `${target.name}_001`, duration: part1Dur };
      const newId = `go-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
      parentPart2Map.set(target.id, newId);
      const part2 = {
        ...target,
        id: newId,
        name: `${target.name}_002`,
        startTime: splitPoint,
        duration: part2Dur,
        components: part2Components,
      };
 
      updatedMap.set(target.id, part1);
      toAdd.push(part2);
    });

    // Fix up parentId on newly created part2 items if their parent was also split
    toAdd.forEach((item) => {
      if (item.parentId && parentPart2Map.has(item.parentId)) {
        item.parentId = parentPart2Map.get(item.parentId);
      }
    });

    if (!anySplit) return;
    setEntities(prev => prev.map(e => updatedMap.has(e.id) ? updatedMap.get(e.id) : e).concat(toAdd));
    if (toAdd.length > 0) {
      setSelectedEntityId(toAdd[0].id);
    }
  }, [entities, selectedEntityId, getPlaybackTime, setEntities, setSelectedEntityId]);
 
  // Create an Empty Clip with Transform & Shape / Renderer
  const handleAddEmptyClip = useCallback((targetTrackId = 'track-1', startTime) => {
    const playheadTime = getPlaybackTime();
    const newGO = createGameObject({
      name: 'New Clip',
      trackId: targetTrackId || 'track-1',
      startTime: startTime !== undefined ? startTime : playheadTime,
      duration: 5,
      type: 'shape',
      components: [
        createDefaultTransform({ x: 0, y: 0 }),
        {
          type: 'ShapeRenderer',
          shapeType: 'rect',
          width: 140,
          height: 140,
          color: '#ffffff',
          strokeColor: '#38bdf8',
          strokeWidth: 0,
          borderRadius: 0
        }
      ]
    });
 
    setEntities(prev => [...prev, newGO]);
    setSelectedEntityId(newGO.id);
  }, [getPlaybackTime]);
 
  // Attach a script to an entity (Add Component click, or dropping a script
  // card from the Project panel onto a timeline clip / the Inspector).
  const handleAttachScriptToEntity = useCallback((entityId, scriptId) => {
    const scriptDef = scripts.find(s => s.id === scriptId);
    const target = entities.find(e => e.id === entityId);
    if (!scriptDef || !target) return;
    const fields = extractScriptProps(scriptDef.code);
    const initialProps = {};
    fields.forEach(f => { initialProps[f.name] = f.defaultVal; });
    const newComp = {
      type: 'ScriptComponent',
      scriptId: scriptDef.id,
      scriptName: scriptDef.name,
      enabled: true,
      props: initialProps,
    };
    setEntities(prev => prev.map(e => e.id === entityId
      ? { ...e, components: [...(e.components || []), newComp] }
      : e
    ));
  }, [entities, scripts, setEntities]);
 
  // Remove a script from the project's script list (Project panel context
  // menu). In-memory only — scripts already attached to clips keep their
  // component but lose their runtime definition.
  const handleRemoveScript = useCallback((scriptId) => {
    setScripts(prev => prev.filter(s => s.id !== scriptId));
  }, [setScripts]);
 
  // Rename a script record (Project panel context menu). In-memory rename;
  // the on-disk file is written with the new name on the next save pass
  // through handleSaveScript.
  const handleRenameScript = useCallback((scriptId, newName) => {
    setScripts(prev => prev.map(s => s.id === scriptId ? { ...s, name: newName } : s));
  }, [setScripts]);
 
  // Add Prefab to Timeline. Handles BOTH prefab shapes:
  //  - Legacy flat prefabs (a `components` snapshot of one entity) — a
  //    single independent clip.
  //  - Nested prefabs (`entities`: a root + children snapshot, saved by
  //    older builds) — every snapshot is instantiated as its own
  //    INDEPENDENT clip with a fresh id: the root lands on targetTrackId
  //    at the placement time, each additional snapshot keeps its saved
  //    track (when it still exists) and its saved time offset from the
  //    root. No parent/child relationship is created.
  const handleAddPrefabToTimeline = (prefab, targetTrackId = 'track-1', startTime = getPlaybackTime()) => {
    const snapshots = Array.isArray(prefab.entities) && prefab.entities.length > 0
      ? prefab.entities
      : null;
 
    if (!snapshots) {
      const newGO = createGameObject({
        name: prefab.name.replace(/\.prefab(\.json)?$/i, ''),
        trackId: targetTrackId,
        startTime: startTime ?? getPlaybackTime(),
        duration: 5,
        type: prefab.type || 'text',
        components: JSON.parse(JSON.stringify(prefab.components || []))
      });
      setEntities(prev => [...prev, newGO]);
      setSelectedEntityId(newGO.id);
      return;
    }
 
    const snapRoot = snapshots.find((e) => e.id === prefab.rootId) || snapshots[0];
    if (!snapRoot) return;
    const start = startTime ?? getPlaybackTime();
    const rootStart = snapRoot.startTime ?? 0;
    const trackIds = new Set((tracks || []).map((t) => t.id));
 
    const oldToNew = new Map();
    snapshots.forEach((snap) => {
      oldToNew.set(snap.id, `go-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`);
    });
 
    const newClips = snapshots.map((snap) => {
      const isSnapRoot = snap.id === snapRoot.id;
      const trackId = isSnapRoot
        ? targetTrackId
        : (trackIds.has(snap.trackId) ? snap.trackId : targetTrackId);
      // Strip any legacy group/parent fields from old saved prefabs.
      const { linkGroupId: _linkGroupId, parentId: _parentId, ...rest } = snap;
      return {
        ...rest,
        id: oldToNew.get(snap.id),
        trackId,
        startTime: isSnapRoot
          ? Math.max(0, start)
          : Math.max(0, start + ((snap.startTime ?? rootStart) - rootStart)),
        duration: snap.duration ?? 5,
        components: snap.components
          ? JSON.parse(JSON.stringify(snap.components))
          : [],
      };
    });
 
    setEntities(prev => [...prev, ...newClips]);
    setSelectedEntityId(newClips[0]?.id || null);
  };
 
  // Add Media to Timeline. When placing a video asset, split into Video and Audio clips,
  // where the Audio clip is always parented to the Video clip.
  const handleAddMediaToTimeline = (asset, targetTrackId = 'track-3', startTime = getPlaybackTime()) => {
    const clipName = asset.name.replace(/\.[^.]+$/, '');
    const duration = asset.duration || 8;
    const finalStartTime = startTime ?? getPlaybackTime();

    if (asset.type !== 'audio') {
      const targetIdx = tracks.findIndex((t) => t.id === targetTrackId);
      let audioTrackId = targetTrackId;
      let newTracks = null;
      if (targetIdx >= 0 && targetIdx + 1 < tracks.length) {
        audioTrackId = tracks[targetIdx + 1].id;
      } else if (targetIdx >= 0) {
        const newTrackNum = tracks.length + 1;
        const extraTrack = {
          id: `track-${newTrackNum}`,
          name: `Track ${newTrackNum}`,
          type: 'layer',
          parentTrackId: null,
          muted: false,
          locked: false,
          visible: true,
          volume: 1.0,
        };
        audioTrackId = extraTrack.id;
        newTracks = [...tracks, extraTrack];
      }

      const videoGO = createGameObject({
        name: clipName,
        trackId: targetTrackId,
        startTime: finalStartTime,
        duration,
        type: 'video',
        src: asset.url,
        components: [
          createDefaultTransform({ x: 0, y: 0 }),
          {
            type: 'VideoRenderer',
            src: asset.url,
            volume: 0, // Video sound is owned by the child AudioSource clip
            speed: 1,
            mediaOffset: 0,
          },
        ],
      });

      const audioGO = createGameObject({
        name: `${clipName} (Audio)`,
        trackId: audioTrackId,
        startTime: finalStartTime,
        duration,
        type: 'audio',
        src: asset.url,
        parentId: videoGO.id, // Audio is ALWAYS child of video
        components: [
          createDefaultTransform({ x: 0, y: 0 }),
          {
            type: 'AudioSource',
            src: asset.url,
            volume: 1,
            speed: 1,
            mediaOffset: 0,
          },
        ],
      });

      if (newTracks) {
        setProjectHistoryState((prev) => ({
          ...prev,
          tracks: newTracks,
          entities: [...prev.entities, videoGO, audioGO],
        }));
      } else {
        setEntities((prev) => [...prev, videoGO, audioGO]);
      }
      setSelectedEntityId(videoGO.id);
      return;
    }

    // Pure audio clips are a single entity
    const newGO = createGameObject({
      name: clipName,
      trackId: targetTrackId || 'track-3',
      startTime: finalStartTime,
      duration,
      type: 'audio',
      src: asset.url,
      components: [
        createDefaultTransform({ x: 0, y: 0 }),
        {
          type: 'AudioSource',
          src: asset.url,
          volume: 1,
          speed: 1,
          mediaOffset: 0,
        },
      ],
    });
    setEntities((prev) => [...prev, newGO]);
    setSelectedEntityId(newGO.id);
  };

  // Explicitly split an existing video clip into Video and Audio clips (with Audio as child)
  const handleSplitVideoAndAudio = useCallback((videoEntityId) => {
    const video = entities.find((e) => e.id === videoEntityId);
    if (!video) return;

    const videoComp = video.components?.find((c) => c.type === 'VideoRenderer');
    const src = videoComp?.src || video.src;
    if (!src) return;

    const existingAudioChild = entities.find(
      (e) => e.parentId === video.id && (e.type === 'audio' || e.components?.some((c) => c.type === 'AudioSource'))
    );
    if (existingAudioChild) return;

    const targetIdx = tracks.findIndex((t) => t.id === video.trackId);
    let audioTrackId = video.trackId;
    let newTracks = null;
    if (targetIdx >= 0 && targetIdx + 1 < tracks.length) {
      audioTrackId = tracks[targetIdx + 1].id;
    } else if (targetIdx >= 0) {
      const newTrackNum = tracks.length + 1;
      const extraTrack = {
        id: `track-${newTrackNum}`,
        name: `Track ${newTrackNum}`,
        type: 'layer',
        parentTrackId: null,
        muted: false,
        locked: false,
        visible: true,
        volume: 1.0,
      };
      audioTrackId = extraTrack.id;
      newTracks = [...tracks, extraTrack];
    }

    const audioGO = createGameObject({
      name: `${video.name} (Audio)`,
      trackId: audioTrackId,
      startTime: video.startTime,
      duration: video.duration,
      type: 'audio',
      src,
      parentId: video.id,
      components: [
        createDefaultTransform({ x: 0, y: 0 }),
        {
          type: 'AudioSource',
          src,
          volume: 1,
          speed: videoComp?.speed || 1,
          mediaOffset: videoComp?.mediaOffset || 0,
        },
      ],
    });

    const updatedVideoComponents = (video.components || []).map((c) =>
      c.type === 'VideoRenderer' ? { ...c, volume: 0 } : c
    );

    if (newTracks) {
      setProjectHistoryState((prev) => ({
        ...prev,
        tracks: newTracks,
        entities: prev.entities.map((e) => (e.id === video.id ? { ...e, components: updatedVideoComponents } : e)).concat(audioGO),
      }));
    } else {
      setEntities((prev) =>
        prev.map((e) => (e.id === video.id ? { ...e, components: updatedVideoComponents } : e)).concat(audioGO)
      );
    }
  }, [entities, tracks, setEntities, setProjectHistoryState]);
 
  // Drag-and-Drop from Project Panel onto a Timeline Track. Accepts either
  // an itemId (looked up in the live lists) or the full itemData object
  // (used by OS-file drops, where the asset was just created in the same
  // tick and hasn't flushed into state yet). Every drop spawns independent
  // flat clips on the target track.
  const handleDropItemOnTrack = ({ itemType, itemId, itemData, targetTrackId, startTime }) => {
    if (itemType === 'prefab') {
      const prefab = prefabs.find(p => p.id === itemId);
      if (prefab) handleAddPrefabToTimeline(prefab, targetTrackId, startTime);
    } else if (itemType === 'media') {
      const asset = mediaAssets.find(m => m.id === itemId) || itemData;
      if (asset) handleAddMediaToTimeline(asset, targetTrackId, startTime);
    } else if (itemType === 'script') {
      const script = scripts.find(s => s.id === itemId);
      if (script) {
        // ONE script component type — the runtime dispatches per the
        // script's detected kind (motion / react / canvas). Motion scripts
        // get a shape fallback to animate; react/canvas scripts render
        // their own visual output.
        const kind = detectScriptKind(script.code || '');
        const components = [
          createDefaultTransform({ x: 0, y: 0 }),
          {
            type: 'ScriptComponent',
            scriptId: script.id,
            scriptName: script.name,
            enabled: true,
            props: {}
          }
        ];
        if (kind === 'motion') {
          components.push({
            type: 'ShapeRenderer',
            shapeType: 'rounded-rect',
            width: 140,
            height: 140,
            color: '#3b82f6',
            strokeColor: '#60a5fa',
            strokeWidth: 2,
            borderRadius: 12
          });
        }
        const newGO = createGameObject({
          name: `${script.name.replace(/\.[^.]+$/, '')} Clip`,
          trackId: targetTrackId || 'track-1',
          startTime: startTime ?? getPlaybackTime(),
          duration: 5,
          type: 'shape',
          components
        });
        setEntities(prev => [...prev, newGO]);
        setSelectedEntityId(newGO.id);
      }
    }
  };
 
  // Save a GameObject as a Prefab — a single-entity snapshot (flat model:
  // no child hierarchy to carry along). Legacy group/parent fields from
  // old saved entities are stripped.
  const handleSaveAsPrefab = (entity) => {
    const { linkGroupId: _linkGroupId, parentId: _parentId, ...snapshot } = JSON.parse(JSON.stringify(entity));
    const newPrefab = {
      id: `prefab-${Date.now()}`,
      name: `${entity.name}.prefab`,
      type: entity.type,
      components: snapshot.components || [],
      // Folder tree: null = root prefabs folder. createdAt powers the
      // "Date Added" sort option (falls back to 0 for legacy items).
      folder: null,
      createdAt: Date.now(),
    };
    setPrefabs(prev => [...prev, newPrefab]);
  };
 
  // Reassign a prefab's folder (null = root prefabs folder) — Project
  // panel folder drag-and-drop + folder rename/delete.
  const handleMovePrefab = (prefabId, targetFolderName) => {
    setPrefabs(prev => prev.map(p => p.id === prefabId ? { ...p, folder: targetFolderName || null } : p));
  };
 
  // Reassign a script's folder (null = root scripts folder) — Project
  // panel folder drag-and-drop + folder rename/delete.
  const handleMoveScript = (scriptId, targetFolderName) => {
    setScripts(prev => prev.map(s => s.id === scriptId ? { ...s, folder: targetFolderName || null } : s));
  };
 
  const handleRemovePrefab = (prefabId) => {
    setPrefabs(prev => prev.filter(p => p.id !== prefabId));
  };
 
  // Create & Save Script
  const handleCreateScript = async (newScript) => {
    // Stamp folder (root) + createdAt (sort key) — callers may provide
    // either, but the defaults keep new scripts consistent.
    setScripts(prev => [...prev, {
      ...newScript,
      folder: newScript.folder ?? null,
      createdAt: newScript.createdAt ?? Date.now(),
    }]);
    if (projectFolderHandle) {
      await writeScriptFile(projectFolderHandle, newScript.name, newScript.code).catch(() => {});
    }
    // Real-import support: kick off the async bundle right away so the
    // script is compiled (or shows its error) by the time it's scrubbed to.
    if (newScript.code) {
      precompileWithBundler(newScript.code, projectFolderHandle).catch(() => {});
    }
  };
 
  const handleSaveScript = async (scriptId, updates) => {
    setScripts(prev => prev.map(s => s.id === scriptId ? { ...s, ...updates } : s));
    const scriptObj = scripts.find(s => s.id === scriptId);
    if (projectFolderHandle && scriptObj) {
      const code = updates.code !== undefined ? updates.code : scriptObj.code;
      const name = updates.name || scriptObj.name;
      await writeScriptFile(projectFolderHandle, name, code).catch(() => {});
      precompileWithBundler(code, projectFolderHandle).catch(() => {});
    }
  };
 
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
 
  // Handle Project Creation from New Project Modal — a brand new project
  // folder, so it gets a brand new (empty) undo history too.
  const handleProjectCreated = (result) => {
    setProjectFolderHandle(result.dirHandle);
    setProjectName(result.projectName);
    setResolution(result.resolution || DEFAULT_RESOLUTION);
    resetProjectHistoryState({ entities: [], tracks: result.tracks, scripts: [], prefabs: [] });
    setMediaAssets([]);
    setSelectedEntityId(null);
    setSaveStatus('saved');
    setScreen('editor');
    // Record it in the Hub's recent/known-folders list. The folder's
    // parent isn't tracked here, so pass null — NewProjectModal already
    // confirmed the folder itself is fresh, so a name collision with an
    // unrelated same-named folder elsewhere on disk is an acceptable
    // rare edge case for de-duping recent entries.
    recordProjectCreated(result.dirHandle, result.projectName, null).catch((err) => {
      console.warn('Could not record project in recent list:', err);
    });
  };
 
  // Shared by "Open Folder" (hub + in-editor header) — loads a directory
  // handle into the editor and records it as a known/recent project.
  const openProjectFromHandle = useCallback(async (dirHandle) => {
    const loaded = await loadProjectFromDirectory(dirHandle, INITIAL_TRACKS);
 
    setProjectFolderHandle(dirHandle);
    setProjectName(loaded.projectName);
    setResolution(loaded.resolution || DEFAULT_RESOLUTION);
    // Opening a different project folder is a fresh start, not an edit —
    // fresh undo history, same as New Project.
    resetProjectHistoryState({
      entities: loaded.entities, // 0 clips if empty project!
      tracks: loaded.tracks,
      scripts: loaded.scripts,   // only files actually on disk
      prefabs: loaded.prefabs,
    });
    setMediaAssets(loaded.mediaAssets);
    setSelectedEntityId(null);
    setSaveStatus('saved');
    setScreen('editor');
 
    // Real-import support: pre-bundle every script with import statements
    // up front, so by the time the user scrubs, the sync compile path's
    // cache is already warm (scripts without imports no-op instantly).
    precompileAllProjectScripts(loaded.scripts, dirHandle).catch(() => {});
 
    recordProjectOpened(dirHandle, loaded.projectName, null).catch((err) => {
      console.warn('Could not record project in recent list:', err);
    });
  }, [resetProjectHistoryState]);
 
  // Open & Load an existing Project Folder from Disk via the native picker
  // (used by the in-editor "Open" button, and by the Hub's "Open Folder"
  // action once it has a handle from its own picker call).
  const handleOpenProjectFolder = useCallback(async (dirHandleFromCaller) => {
    try {
      const dirHandle = dirHandleFromCaller || (await pickProjectDirectory());
      await openProjectFromHandle(dirHandle);
    } catch (err) {
      if (err.name !== 'AbortError') {
        alert(`Failed to open project folder: ${err.message}`);
      }
    }
  }, [openProjectFromHandle]);
 
  // Reopen a project directly from a Hub "recent" entry — it already has a
  // stored dirHandle, so this just needs to re-confirm permission (browsers
  // don't persist FS Access permission grants across app restarts even
  // though they persist the handle itself) before loading it the same way
  // as any other Open Folder flow. Left to throw on failure — the Hub
  // screen surfaces the error inline instead of via alert().
  const handleOpenRecentProject = useCallback(async (entry) => {
    const hasPermission = await verifyPermission(entry.dirHandle, true);
    if (!hasPermission) {
      throw new Error(`Permission to access "${entry.name}" was not granted.`);
    }
    await openProjectFromHandle(entry.dirHandle);
  }, [openProjectFromHandle]);
 
  // Hot-Reload: Poll scripts/ directory for external edits in VS Code
  //
  // PERF/FREEZE FIX -- this previously listed `scripts` in its dependency
  // array. Every time a poll found a real change and called setScripts, this
  // effect re-ran (new `scripts` identity), tearing down and recreating the
  // interval. Worse, there was no "poll in progress" guard (unlike the
  // autosave effect in App.jsx, which has `isAutoSavingRef`):
  // checkScriptsForChanges does real File System Access API I/O
  // (getDirectoryHandle -> iterate -> getFile -> file.text() per script
  // file), and on a slow disk or with many script files that can take
  // longer than the 2000ms interval. When that happens, overlapping polls
  // pile up awaiting file reads on the main thread -- which reads as a
  // freeze that (a) doesn't require anything on the timeline, since it only
  // needs `projectFolderHandle` to be set, and (b) gets worse with more
  // objects/scripts, since each poll iterates every script file.
  // `scriptsRef` lets the interval read the latest scripts without
  // restarting on every change, and `isPollingRef` skips a tick entirely if
  // the previous one hasn't finished yet, matching the guard pattern the
  // autosave effect already uses.
  const scriptsRef = useRef(scripts);
  useEffect(() => {
    scriptsRef.current = scripts;
  }, [scripts]);
 
  const isPollingScriptsRef = useRef(false);
  useEffect(() => {
    if (!projectFolderHandle) return;
 
    let disposed = false;
    let unwatchFn = null;
    let poller = null;
 
    // Shared by both the native watcher callback and the browser poll
    // fallback below — re-scan scripts/ and apply + precompile any diff.
    const refreshScripts = async () => {
      if (isPollingScriptsRef.current) return;
      isPollingScriptsRef.current = true;
      try {
        const updatedScripts = await checkScriptsForChanges(projectFolderHandle, scriptsRef.current);
        if (updatedScripts && !disposed) {
          setScripts(updatedScripts);
          // Real-import support: an external edit may have added `import`
          // statements — bundle the changed scripts in the background.
          precompileAllProjectScripts(updatedScripts, projectFolderHandle).catch(() => {});
        }
      } finally {
        isPollingScriptsRef.current = false;
      }
    };
 
    // Hot-Reload — two backends, same refreshScripts core:
    //
    // 1. Tauri desktop: subscribe to OS file-system events on scripts/
    //    (create/modify/remove, recursive, debounced) for near-instant
    //    reload with zero polling overhead. watchScriptsDirectory returns
    //    an unwatch fn when the native watcher is active, or null when
    //    running in a plain browser / the watcher can't be created.
    // 2. Browser fallback: the old 2s setInterval poll. Kept only for
    //    `npm run dev` in a browser — native events don't exist there.
    watchScriptsDirectory(projectFolderHandle, refreshScripts).then((unwatch) => {
      if (disposed) {
        try { unwatch?.(); } catch { /* already unregistered */ }
        return;
      }
      unwatchFn = unwatch;
      if (!unwatchFn) {
        poller = setInterval(() => {
          refreshScripts();
        }, 2000);
      }
    });
 
    return () => {
      disposed = true;
      if (unwatchFn) {
        try { unwatchFn(); } catch { /* already unregistered */ }
      }
      if (poller) clearInterval(poller);
    };
  }, [projectFolderHandle]);
 
  // Track management
  const handleAddTrack = () => {
    const nextNum = tracks.length + 1;
    setTracks((prev) => [
      ...prev,
      {
        id: `track-${Date.now()}`,
        name: `Track ${nextNum}`,
        type: 'layer',
        parentTrackId: null,
        muted: false,
        locked: false,
        visible: true,
        volume: 1.0,
      },
    ]);
  };
 
  // Coalesced for the same reason as handleUpdateEntity — track volume
  // sliders etc. fire continuously while dragging.
  const handleUpdateTrack = (trackId, updates) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, ...updates } : t), { coalesce: true });
  };
 
  // Delete track and all clips on it
  const handleDeleteTrack = useCallback((trackId) => {
    if (tracks.length <= 1) return;
    setTracks(prev => prev.filter(t => t.id !== trackId));
    setEntities(prev => prev.filter(e => e.trackId !== trackId));
  }, [tracks.length, setTracks, setEntities]);
 
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
    // entity / track operations
    handleUpdateEntity,
    handleUpdateClips,
    handleDuplicateClips,
    handleDeleteEntity,
    handleRippleTrimToPlayhead,
    handleSplitEntity,
    handleAddEmptyClip,
    handleAddPrefabToTimeline,
    handleAddMediaToTimeline,
    handleSplitVideoAndAudio,
    handleDropItemOnTrack,
    handleAttachScriptToEntity,
    handleAddTrack,
    handleUpdateTrack,
    handleDeleteTrack,
    // prefab / script operations
    handleSaveAsPrefab,
    handleMovePrefab,
    handleMoveScript,
    handleRemovePrefab,
    handleCreateScript,
    handleRemoveScript,
    handleRenameScript,
    handleSaveScript,
    // project JSON apply
    handleApplyProjectJson,
    // project-swap load paths
    handleProjectCreated,
    handleOpenProjectFolder,
    handleOpenRecentProject,
  };
}
 
 