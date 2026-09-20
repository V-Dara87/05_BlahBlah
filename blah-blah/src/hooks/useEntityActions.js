import { useCallback } from 'react';
import {
  createGameObject,
  createDefaultTransform,
  removeEntitiesByIds,
  syncPrefabInstances,
} from '../engine/ecs';
import { detectScriptKind, extractScriptProps } from '../engine/scriptRunner';
import { computeTrimmedOffset } from '../utils/mediaOffset';
import {
  copyToClipboard,
  getClipboardClips,
  buildPastedClips,
} from '../utils/clipClipboard';
 
/**
 * useEntityActions — entity/clip editing, splitting, media/prefab/script
 * placement onto the timeline, and track management.
 *
 * Extracted from useProjectStore.js. This is the one slice that genuinely
 * spans multiple undo-scoped state pieces at once (placing a video clip
 * can add a track AND two entities in the same history step; attaching a
 * script reads `scripts` to build the new component), so it takes the
 * full { entities, tracks, scripts, prefabs } read side plus every setter,
 * rather than being scoped to a single slice like usePrefabScriptActions.
 *
 * A faithful move: no logic changes, useCallback dep arrays preserved
 * verbatim (several of these were plain, non-memoized functions in
 * useProjectStore already — those stay plain here too, so handler
 * identity/cadence for memoized consumers — Timeline, UnityInspector,
 * Dopesheet, dock panels — is unchanged).
 *
 * @param {object} args
 * @param {Array}    args.entities
 * @param {Array}    args.tracks
 * @param {Array}    args.scripts
 * @param {Array}    args.prefabs
 * @param {Array}    args.mediaAssets
 * @param {Function} args.setEntities
 * @param {Function} args.setTracks
 * @param {Function} args.setProjectHistoryState  raw setter, used when an
 *   edit must touch tracks + entities atomically in one undo step
 * @param {string|null} args.selectedEntityId
 * @param {Function} args.setSelectedEntityId
 * @param {Function} args.getPlaybackTime
 */
export function useEntityActions({
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
  handleUpdatePrefab,
}) {
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
  const handleDeleteEntity = useCallback((entityIdOrIds) => {
    const ids = Array.isArray(entityIdOrIds) ? entityIdOrIds : [entityIdOrIds];
    setEntities((prev) => {
      const next = removeEntitiesByIds(prev, ids);
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
      // trimmedAmount is a TIMELINE delta; scale by each component's own
      // speed to get the correct SOURCE-time mediaOffset shift.
      const trimmedAmount = playhead - start;
      const newComponents = target.components?.map((c) => {
        if (c.type === 'VideoRenderer' || c.type === 'AudioSource') {
          const origOffset = c.mediaOffset || 0;
          const speed = c.speed || 1;
          return { ...c, mediaOffset: computeTrimmedOffset(origOffset, trimmedAmount, speed) };
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
    const updatesMap = new Map(updatesList.map(u => [u.id, u.updates !== undefined ? u.updates : u]));
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
 
  // Copy the given clips (plus their descendants — a Cut deletes children
  // along with the parent, so they must travel with it) to the clipboard.
  // Returns how many clips were stored (0 = nothing to copy).
  const handleCopyClips = useCallback((clipIds) => {
    const ids = Array.isArray(clipIds) ? clipIds : (clipIds ? [clipIds] : []);
    return copyToClipboard(entities, ids);
  }, [entities]);
 
  // Paste the clipboard at the playhead: the group's left edge lands on the
  // playhead and every clip keeps its relative offset and its own track.
  // Overlaps with existing clips are left as-is (same as Duplicate).
  // Returns the new ids so the caller can select them.
  const handlePasteClips = useCallback(() => {
    const clips = getClipboardClips();
    if (clips.length === 0) return [];
    const newClips = buildPastedClips(clips, getPlaybackTime(), tracks.map((t) => t.id));
    if (newClips.length === 0) return [];
    setEntities((prev) => [...prev, ...newClips]);
    const newIds = newClips.map((c) => c.id);
    setSelectedEntityId(newIds[0]);
    return newIds;
  }, [tracks, getPlaybackTime, setEntities, setSelectedEntityId]);
 
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
 
      // part1Dur is a TIMELINE delta; scale by each component's own speed
      // to get the correct SOURCE-time mediaOffset for the second half.
      const part2Components = target.components?.map(c => {
        if (c.type === 'VideoRenderer' || c.type === 'AudioSource') {
          const origOffset = c.mediaOffset || 0;
          const speed = c.speed || 1;
          return { ...c, mediaOffset: computeTrimmedOffset(origOffset, part1Dur, speed) };
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
 
  // Cut silence from a clip (or clips in a track), with ripple shift and video-audio sync
  const handleCutSilence = useCallback(({ targetType = 'clip', targetId, keptSegments, cutsByClipId, ripple = true }) => {
    if (!targetId) return;
 
    if (targetType === 'clip') {
      const target = entities.find((e) => e.id === targetId);
      if (!target) return;
 
      // Identify companion video/audio entities
      let primaryEntity = target;
      let childEntities = [];
 
      if (target.parentId) {
        const parent = entities.find((e) => e.id === target.parentId);
        if (parent && (parent.type === 'video' || parent.components?.some((c) => c.type === 'VideoRenderer'))) {
          primaryEntity = parent;
          childEntities = entities.filter((e) => e.parentId === parent.id);
        }
      } else {
        childEntities = entities.filter((e) => e.parentId === target.id);
      }
 
      const allGroupEntities = [primaryEntity, ...childEntities];
      const origStart = primaryEntity.startTime;
      const origDur = primaryEntity.duration;
 
      const segments = Array.isArray(keptSegments) ? keptSegments : [];
      if (segments.length === 0) {
        // Entire clip was silent -> remove all in group
        const groupIds = new Set(allGroupEntities.map((e) => e.id));
        setEntities((prev) => {
          let updated = prev.filter((e) => !groupIds.has(e.id));
          if (ripple) {
            const affectedTrackIds = new Set(allGroupEntities.map((e) => e.trackId));
            updated = updated.map((e) => {
              if (affectedTrackIds.has(e.trackId) && e.startTime >= origStart + origDur - 0.05) {
                return { ...e, startTime: Math.max(origStart, e.startTime - origDur) };
              }
              return e;
            });
          }
          return updated;
        });
        return;
      }
 
      // Generate replacement segments
      const toAdd = [];
      const updatedMap = new Map();
      let rippleAccumTime = 0;
 
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segStartTime = ripple ? origStart + rippleAccumTime : origStart + seg.start;
        const segDur = seg.duration;
        rippleAccumTime += segDur;
 
        // Primary entity slice
        const isFirst = i === 0;
        const primaryId = isFirst ? primaryEntity.id : `go-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
 
        const primaryComponents = primaryEntity.components?.map((c) => {
          if (c.type === 'VideoRenderer' || c.type === 'AudioSource') {
            const origOffset = c.mediaOffset || 0;
            const speed = c.speed || 1;
            return { ...c, mediaOffset: computeTrimmedOffset(origOffset, seg.start, speed) };
          }
          return JSON.parse(JSON.stringify(c));
        }) || [];
 
        const primarySlice = {
          ...primaryEntity,
          id: primaryId,
          name: isFirst ? primaryEntity.name : `${primaryEntity.name}_${String(i + 1).padStart(3, '0')}`,
          startTime: segStartTime,
          duration: segDur,
          components: primaryComponents,
        };
 
        if (isFirst) {
          updatedMap.set(primaryEntity.id, primarySlice);
        } else {
          toAdd.push(primarySlice);
        }
 
        // Child entities slices (e.g. linked audio or callouts)
        for (const child of childEntities) {
          const childId = isFirst ? child.id : `go-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          const childComponents = child.components?.map((c) => {
            if (c.type === 'VideoRenderer' || c.type === 'AudioSource') {
              const origOffset = c.mediaOffset || 0;
              const speed = c.speed || 1;
              return { ...c, mediaOffset: computeTrimmedOffset(origOffset, seg.start, speed) };
            }
            return JSON.parse(JSON.stringify(c));
          }) || [];
 
          const childSlice = {
            ...child,
            id: childId,
            parentId: primaryId,
            name: isFirst ? child.name : `${child.name}_${String(i + 1).padStart(3, '0')}`,
            startTime: segStartTime,
            duration: segDur,
            components: childComponents,
          };
 
          if (isFirst) {
            updatedMap.set(child.id, childSlice);
          } else {
            toAdd.push(childSlice);
          }
        }
      }
 
      const totalKept = segments.reduce((sum, s) => sum + s.duration, 0);
      const totalCut = Math.max(0, origDur - totalKept);
      const affectedTrackIds = new Set(allGroupEntities.map((e) => e.trackId));
      const groupIds = new Set(allGroupEntities.map((e) => e.id));
 
      setEntities((prev) => {
        const next = prev.map((e) => {
          if (updatedMap.has(e.id)) {
            return updatedMap.get(e.id);
          }
          if (ripple && totalCut > 0 && affectedTrackIds.has(e.trackId) && !groupIds.has(e.id)) {
            if (e.startTime >= origStart + origDur - 0.05) {
              return { ...e, startTime: Math.max(origStart + totalKept, e.startTime - totalCut) };
            }
          }
          return e;
        });
        return next.concat(toAdd);
      });
      return;
    }
 
    if (targetType === 'track') {
      const trackClips = entities
        .filter((e) => e.trackId === targetId && !e.parentId)
        .sort((a, b) => a.startTime - b.startTime);
 
      if (trackClips.length === 0) return;
 
      const clipMap = cutsByClipId instanceof Map ? cutsByClipId : new Map(Object.entries(cutsByClipId || {}));
      let currentEntities = [...entities];
 
      for (const clip of trackClips) {
        const segs = clipMap.get(clip.id);
        if (segs && Array.isArray(segs)) {
          // Re-query clip in currentEntities in case its startTime changed from previous ripple
          const liveClip = currentEntities.find((e) => e.id === clip.id);
          if (!liveClip) continue;
 
          // Apply cut to this single clip within currentEntities
          let childEntities = currentEntities.filter((e) => e.parentId === liveClip.id);
          const allGroup = [liveClip, ...childEntities];
          const origStart = liveClip.startTime;
          const origDur = liveClip.duration;
          const groupIds = new Set(allGroup.map((e) => e.id));
 
          if (segs.length === 0) {
            currentEntities = currentEntities.filter((e) => !groupIds.has(e.id));
            if (ripple) {
              const affTrackIds = new Set(allGroup.map((e) => e.trackId));
              currentEntities = currentEntities.map((e) => {
                if (affTrackIds.has(e.trackId) && e.startTime >= origStart + origDur - 0.05) {
                  return { ...e, startTime: Math.max(origStart, e.startTime - origDur) };
                }
                return e;
              });
            }
            continue;
          }
 
          const toAdd = [];
          const updatedMap = new Map();
          let accum = 0;
 
          for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            const segStartTime = ripple ? origStart + accum : origStart + seg.start;
            const segDur = seg.duration;
            accum += segDur;
            const isFirst = i === 0;
            const primaryId = isFirst ? liveClip.id : `go-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
 
            const compPrim = liveClip.components?.map((c) => {
              if (c.type === 'VideoRenderer' || c.type === 'AudioSource') {
                const origOffset = c.mediaOffset || 0;
                const speed = c.speed || 1;
                return { ...c, mediaOffset: computeTrimmedOffset(origOffset, seg.start, speed) };
              }
              return JSON.parse(JSON.stringify(c));
            }) || [];
 
            const pSlice = {
              ...liveClip,
              id: primaryId,
              name: isFirst ? liveClip.name : `${liveClip.name}_${String(i + 1).padStart(3, '0')}`,
              startTime: segStartTime,
              duration: segDur,
              components: compPrim,
            };
 
            if (isFirst) updatedMap.set(liveClip.id, pSlice);
            else toAdd.push(pSlice);
 
            for (const ch of childEntities) {
              const chId = isFirst ? ch.id : `go-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
              const compCh = ch.components?.map((c) => {
                if (c.type === 'VideoRenderer' || c.type === 'AudioSource') {
                  const origOffset = c.mediaOffset || 0;
                  const speed = c.speed || 1;
                  return { ...c, mediaOffset: computeTrimmedOffset(origOffset, seg.start, speed) };
                }
                return JSON.parse(JSON.stringify(c));
              }) || [];
 
              const chSlice = {
                ...ch,
                id: chId,
                parentId: primaryId,
                name: isFirst ? ch.name : `${ch.name}_${String(i + 1).padStart(3, '0')}`,
                startTime: segStartTime,
                duration: segDur,
                components: compCh,
              };
 
              if (isFirst) updatedMap.set(ch.id, chSlice);
              else toAdd.push(chSlice);
            }
          }
 
          const totKept = segs.reduce((s, x) => s + x.duration, 0);
          const totCut = Math.max(0, origDur - totKept);
          const affTracks = new Set(allGroup.map((e) => e.trackId));
 
          currentEntities = currentEntities.map((e) => {
            if (updatedMap.has(e.id)) return updatedMap.get(e.id);
            if (ripple && totCut > 0 && affTracks.has(e.trackId) && !groupIds.has(e.id)) {
              if (e.startTime >= origStart + origDur - 0.05) {
                return { ...e, startTime: Math.max(origStart + totKept, e.startTime - totCut) };
              }
            }
            return e;
          }).concat(toAdd);
        }
      }
 
      setEntities(currentEntities);
    }
  }, [entities, setEntities]);
 
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
 
    const prefabInstanceId = `pinst-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
 
    if (!snapshots) {
      const newGO = createGameObject({
        name: prefab.name.replace(/\.prefab(\.json)?$/i, ''),
        trackId: targetTrackId,
        startTime: startTime ?? getPlaybackTime(),
        duration: 5,
        type: prefab.type || 'text',
        components: JSON.parse(JSON.stringify(prefab.components || [])),
        prefabAssetId: prefab.id,
        prefabInstanceId,
        prefabSourceSnapId: prefab.rootId || 'root',
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
      const mappedParentId = snap.parentId ? (oldToNew.get(snap.parentId) || null) : null;
      const { linkGroupId: _linkGroupId, parentId: _parentId, ...rest } = snap;
      return {
        ...rest,
        id: oldToNew.get(snap.id),
        prefabAssetId: prefab.id,
        prefabInstanceId,
        prefabSourceSnapId: snap.id,
        trackId,
        parentId: isSnapRoot ? null : mappedParentId,
        startTime: isSnapRoot
          ? Math.max(0, start)
          : Math.max(0, start + ((snap.startTime ?? rootStart) - rootStart)),
        duration: snap.duration ?? 5,
        components: snap.components
          ? JSON.parse(JSON.stringify(snap.components))
          : [],
      };
    });
 
    // If the prefab has embeddedScripts that are missing from the project, auto-restore them!
    const missingScripts = (prefab.embeddedScripts || []).filter(
      (es) => !scripts.some((s) => s.id === es.id || s.name === es.name)
    );
 
    if (missingScripts.length > 0 && setProjectHistoryState) {
      const newScriptsToAdd = missingScripts.map((es) => ({
        id: es.id || `script-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        name: es.name,
        description: es.description || `Auto-imported from ${prefab.name}`,
        code: es.code || '',
      }));
      setProjectHistoryState((prev) => ({
        ...prev,
        scripts: [...(prev.scripts || []), ...newScriptsToAdd],
        entities: [...(prev.entities || []), ...newClips],
      }));
      setSelectedEntityId(newClips[0]?.id || null);
      return;
    }
 
    setEntities(prev => [...prev, ...newClips]);
    setSelectedEntityId(newClips[0]?.id || null);
  };
 
  // Detach / Unpack Prefab: breaks the link to the prefab asset, turning it into regular clips
  const handleDetachPrefab = useCallback((entityId) => {
    if (!entityId) return;
    setEntities((prev) => {
      const target = prev.find((e) => e.id === entityId);
      if (!target) return prev;
      const instId = target.prefabInstanceId;
      return prev.map((e) => {
        if ((instId && e.prefabInstanceId === instId) || e.id === entityId) {
          const { prefabAssetId: _pa, prefabInstanceId: _pi, prefabSourceSnapId: _ps, ...rest } = e;
          return rest;
        }
        return e;
      });
    });
  }, [setEntities]);
 
  // Revert timeline instance to original prefab snapshot values
  const handleRevertToPrefab = useCallback((entityId) => {
    if (!entityId) return;
    const target = entities.find((e) => e.id === entityId);
    if (!target || !target.prefabAssetId) return;
    const prefab = prefabs.find((p) => p.id === target.prefabAssetId);
    if (!prefab) return;
 
    const snapshots = Array.isArray(prefab.entities) && prefab.entities.length > 0
      ? prefab.entities
      : [{ id: prefab.rootId || 'root', name: prefab.name.replace(/\.prefab(\.json)?$/i, ''), components: prefab.components || [] }];
 
    const snapRoot = snapshots.find((e) => e.id === prefab.rootId) || snapshots[0];
    const instId = target.prefabInstanceId;
 
    setEntities((prev) => {
      return prev.map((e) => {
        if (instId ? e.prefabInstanceId === instId : e.id === entityId) {
          const snap = snapshots.find((s) => s.id === e.prefabSourceSnapId) ||
            (e.id === target.id ? snapRoot : null);
          if (snap) {
            return {
              ...e,
              name: snap.name || e.name,
              duration: snap.duration ?? e.duration,
              components: JSON.parse(JSON.stringify(snap.components || [])),
            };
          }
        }
        return e;
      });
    });
  }, [entities, prefabs, setEntities]);
 
  // Apply timeline instance changes back to the source Prefab asset
  const handleApplyToPrefab = useCallback(async (entityId) => {
    if (!entityId || !handleUpdatePrefab) return;
    const target = entities.find((e) => e.id === entityId);
    if (!target || !target.prefabAssetId) return;
    const prefab = prefabs.find((p) => p.id === target.prefabAssetId);
    if (!prefab) return;
 
    const instId = target.prefabInstanceId;
    const instanceClips = instId
      ? entities.filter((e) => e.prefabInstanceId === instId)
      : [target];
 
    // Find the root clip of this instance group
    const rootClip = instanceClips.find((e) => !e.parentId) || target;
    const rootStartTime = rootClip.startTime || 0;
 
    // Map clip.id to snapId to preserve existing snapshot IDs
    const clipIdToSnapId = new Map();
    instanceClips.forEach((obj) => {
      const snapId = obj.prefabSourceSnapId || obj.id;
      clipIdToSnapId.set(obj.id, snapId);
    });
 
    const rootSnapId = clipIdToSnapId.get(rootClip.id);
 
    // Snapshot each object in the instance group, normalizing relative start times
    const updatedSnapshots = instanceClips.map((obj) => {
      const clone = JSON.parse(JSON.stringify(obj));
      const snapId = clipIdToSnapId.get(obj.id);
      clone.id = snapId;
      if (obj.id === rootClip.id || !obj.parentId) {
        clone.parentId = null;
      } else {
        clone.parentId = clipIdToSnapId.get(obj.parentId) || null;
      }
      clone.startTime = Math.max(0, (obj.startTime || 0) - rootStartTime);
      delete clone.prefabAssetId;
      delete clone.prefabInstanceId;
      delete clone.prefabSourceSnapId;
      return clone;
    });
 
    const maxDuration = Math.max(
      ...updatedSnapshots.map((s) => (s.startTime || 0) + (s.duration || 0)),
    );
 
    // Extract any scripts referenced
    const usedScriptIds = new Set();
    updatedSnapshots.forEach((snap) => {
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
      rootId: rootSnapId,
      entities: updatedSnapshots,
      components: rootClip.components ? JSON.parse(JSON.stringify(rootClip.components)) : [],
      duration: maxDuration,
      embeddedScripts,
    };
 
    await handleUpdatePrefab(prefab.id, updatedData);
 
    // Sync all instances of this prefab on the timeline so they receive the applied changes!
    setEntities((prev) => syncPrefabInstances(prev, prefab.id, updatedSnapshots, rootSnapId));
  }, [entities, prefabs, scripts, handleUpdatePrefab, setEntities]);
 
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
  const handleUpdateTrack = useCallback((trackId, updates) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, ...updates } : t), { coalesce: true });
  }, [setTracks]);
 
  // Delete track and all clips on it
  const handleDeleteTrack = useCallback((trackId) => {
    if (tracks.length <= 1) return;
    setTracks(prev => prev.filter(t => t.id !== trackId));
    setEntities(prev => prev.filter(e => e.trackId !== trackId));
  }, [tracks.length, setTracks, setEntities]);
 
  return {
    handleUpdateEntity,
    handleUpdateClips,
    handleDuplicateClips,
    handleCopyClips,
    handlePasteClips,
    handleDeleteEntity,
    handleRippleTrimToPlayhead,
    handleSplitEntity,
    handleCutSilence,
    handleAddEmptyClip,
    handleAddPrefabToTimeline,
    handleAddMediaToTimeline,
    handleSplitVideoAndAudio,
    handleDropItemOnTrack,
    handleAttachScriptToEntity,
    handleAddTrack,
    handleUpdateTrack,
    handleDeleteTrack,
    handleDetachPrefab,
    handleRevertToPrefab,
    handleApplyToPrefab,
  };
}