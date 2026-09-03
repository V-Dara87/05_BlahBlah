import { useCallback, useEffect, useRef } from 'react';
import { useUndoableState } from './useUndoableState';
import { INITIAL_TRACKS, DEFAULT_RESOLUTION } from '../types';
import { createSyntheticAudio, createSyntheticVideo } from '../utils/sampleMedia';
import { DEFAULT_SCRIPTS, DEFAULT_PREFABS, createGameObject, createDefaultTransform } from '../engine/ecs';
import {
  pickProjectDirectory,
  loadProjectFromDirectory,
  checkScriptsForChanges,
  writeScriptFile,
  verifyPermission,
} from '../services/projectFileSystem';
import { recordProjectCreated, recordProjectOpened } from '../services/recentProjects';
import { precompileWithBundler, precompileAllProjectScripts, detectScriptKind } from '../engine/scriptRunner';

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
 * the three project-swap load paths (Demo Scene / New Project / Open Folder,
 * each of which resets undo history), the scripts/ hot-reload poll, and
 * disk round-trips that only touch the undo-scoped slices.
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

  // Helper to load sample demo scene with animated clips & scripts
  const handleLoadDemoScene = useCallback(async () => {
    try {
      const audioUrl = createSyntheticAudio(12);
      const videoUrl = await createSyntheticVideo(8, 640, 360);

      const demoMedia = [
        {
          id: 'asset-intro-video',
          name: 'Motion Video.mp4',
          type: 'video',
          url: videoUrl,
          duration: 8,
          size: 1400000
        },
        {
          id: 'asset-soundtrack',
          name: 'Synth Track.wav',
          type: 'audio',
          url: audioUrl,
          duration: 12,
          size: 2100000
        }
      ];

      const demoGOs = [
        createGameObject({
          name: 'Glass Card (React Clip)',
          trackId: 'track-1',
          startTime: 0,
          duration: 8,
          type: 'react',
          components: [
            createDefaultTransform({ x: 0, y: -45 }),
            {
              type: 'ScriptComponent',
              scriptId: 'script-glass-card',
              scriptName: 'GlassCard.jsx',
              enabled: true,
              props: {
                title: 'BLAHBLAH STUDIO',
                badge: 'REACT COMPONENT',
                accentColor: '#6366f1'
              }
            },
            {
              type: 'ScriptComponent',
              scriptId: 'script-float-bounce',
              scriptName: 'FloatAndBounce.jsx',
              enabled: true,
              props: {
                amplitude: 25,
                duration: 1.2,
                rotationAngle: 6
              }
            }
          ]
        }),
        createGameObject({
          name: 'Glowing Badge (JS Pulse)',
          trackId: 'track-2',
          startTime: 0,
          duration: 8,
          type: 'shape',
          components: [
            createDefaultTransform({ x: 0, y: 55 }),
            {
              type: 'ShapeRenderer',
              shapeType: 'rounded-rect',
              width: 200,
              height: 46,
              color: '#4f46e5',
              strokeColor: '#38bdf8',
              strokeWidth: 2,
              borderRadius: 23
            },
            {
              type: 'TextRenderer',
              text: '⚡ MOTION ENGINE',
              fontSize: 13,
              fontColor: '#ffffff',
              fontFamily: 'Inter'
            },
            {
              type: 'ScriptComponent',
              scriptId: 'script-pulse-scale',
              scriptName: 'PulseScale.jsx',
              enabled: true,
              props: {
                maxScale: 1.18,
                pulseSpeed: 0.6
              }
            }
          ]
        }),
        createGameObject({
          name: 'Motion Background Video',
          trackId: 'track-3',
          startTime: 0,
          duration: 8,
          type: 'video',
          src: videoUrl,
          components: [
            createDefaultTransform({ x: 0, y: 0 }),
            {
              type: 'VideoRenderer',
              src: videoUrl,
              volume: 1,
              speed: 1,
              mediaOffset: 0
            }
          ]
        }),
        createGameObject({
          name: 'Electronic Soundtrack',
          trackId: 'track-4',
          startTime: 0,
          duration: 12,
          type: 'audio',
          src: audioUrl,
          components: [
            {
              type: 'AudioSource',
              src: audioUrl,
              volume: 0.8,
              speed: 1,
              mediaOffset: 0
            }
          ]
        })
      ];

      setProjectName('demo-scene');
      // Loading a whole demo scene is a "swap the project" action, not an
      // editable step in the current one — start its own fresh undo history
      // instead of stacking on top of (or being undoable back into) whatever
      // was open before.
      resetProjectHistoryState({
        entities: demoGOs,
        tracks: INITIAL_TRACKS,
        scripts: DEFAULT_SCRIPTS,
        prefabs: DEFAULT_PREFABS,
      });
      setMediaAssets(demoMedia);
      setSelectedEntityId(demoGOs[0].id);
      setScreen('editor');
    } catch (err) {
      console.warn('Could not load demo scene:', err);
    }
  }, [resetProjectHistoryState]);

  // Update entity properties / components. Coalesced: this fires on every
  // intermediate value while dragging a clip or scrubbing an Inspector
  // number field, so we merge those into one undo step per gesture instead
  // of one per pixel/tick.
  const handleUpdateEntity = useCallback((entityId, updates) => {
    // Support _delete flag for context menu deletion
    if (updates._delete) {
      setEntities((prev) => prev.filter((e) => e.id !== entityId));
      if (selectedEntityId === entityId) setSelectedEntityId(null);
      return;
    }
    setEntities(prev => prev.map(e => e.id === entityId ? { ...e, ...updates } : e), { coalesce: true });
  }, [setEntities, selectedEntityId]);

  // Delete entity
  const handleDeleteEntity = useCallback((entityId) => {
    setEntities(prev => prev.filter(e => e.id !== entityId));
    if (selectedEntityId === entityId) setSelectedEntityId(null);
  }, [selectedEntityId]);

  // Split entity at playhead
  const handleSplitEntity = useCallback((entityId) => {
    const target = entities.find(e => e.id === (entityId || selectedEntityId));
    if (!target) return;

    const splitPoint = getPlaybackTime();
    const start = target.startTime;
    const end = target.startTime + target.duration;

    if (splitPoint <= start + 0.1 || splitPoint >= end - 0.1) return;

    const part1Dur = splitPoint - start;
    const part2Dur = end - splitPoint;

    const part1 = { ...target, duration: part1Dur };

    // Update mediaOffset for part 2 so it continues seamlessly
    const part2Components = target.components?.map(c => {
      if (c.type === 'VideoRenderer' || c.type === 'AudioSource') {
        const origOffset = c.mediaOffset || 0;
        return {
          ...c,
          mediaOffset: origOffset + part1Dur
        };
      }
      return JSON.parse(JSON.stringify(c));
    }) || [];

    const part2 = {
      ...target,
      id: `go-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: `${target.name} (Part 2)`,
      startTime: splitPoint,
      duration: part2Dur,
      components: part2Components
    };

    setEntities(prev => prev.map(e => e.id === target.id ? part1 : e).concat(part2));
    setSelectedEntityId(part2.id);
  }, [entities, selectedEntityId, getPlaybackTime]);

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

  // Add Prefab to Timeline
  const handleAddPrefabToTimeline = (prefab, targetTrackId = 'track-1', startTime = getPlaybackTime()) => {
    const newGO = createGameObject({
      name: prefab.name.replace(/\.prefab(\.json)?$/i, ''),
      trackId: targetTrackId,
      startTime: startTime,
      duration: 5,
      type: prefab.type || 'text',
      components: JSON.parse(JSON.stringify(prefab.components || []))
    });

    setEntities(prev => [...prev, newGO]);
    setSelectedEntityId(newGO.id);
  };

  // Add Media to Timeline
  const handleAddMediaToTimeline = (asset, targetTrackId = 'track-3', startTime = getPlaybackTime()) => {
    const isAudio = asset.type === 'audio';
    const clipName = asset.name.replace(/\.[^.]+$/, '');
    const duration = asset.duration || 8;

    // Video clips get split into a video entity + a linked audio entity
    // on an audio track. They share a linkGroupId so they move together.
    if (!isAudio) {
      const groupId = `link-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

      const videoGO = createGameObject({
        name: clipName,
        trackId: targetTrackId,
        startTime,
        duration,
        type: 'video',
        src: asset.url,
        components: [
          createDefaultTransform({ x: 0, y: 0 }),
          {
            type: 'VideoRenderer',
            src: asset.url,
            volume: 0, // mute — audio is handled by the linked audio entity
            speed: 1,
            mediaOffset: 0,
          },
        ],
      });
      videoGO.linkGroupId = groupId;

      // Place audio on the track immediately after the video track
      const videoTrackIdx = tracks.findIndex((t) => t.id === targetTrackId);
      const nextTrackIdx = videoTrackIdx >= 0 ? videoTrackIdx + 1 : 1;
      const audioTrack = tracks[nextTrackIdx] || tracks[tracks.length - 1];
      const audioGO = createGameObject({
        name: `${clipName} 🎵`,
        trackId: audioTrack?.id || 'track-4',
        startTime,
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
      audioGO.linkGroupId = groupId;

      setEntities((prev) => [...prev, videoGO, audioGO]);
      setSelectedEntityId(videoGO.id);
      return;
    }

    // Pure audio clips stay as a single entity
    const newGO = createGameObject({
      name: clipName,
      trackId: targetTrackId,
      startTime,
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

  // Drag-and-Drop from Project Panel onto a Timeline Track
  const handleDropItemOnTrack = ({ itemType, itemId, targetTrackId, startTime }) => {
    if (itemType === 'prefab') {
      const prefab = prefabs.find(p => p.id === itemId);
      if (prefab) handleAddPrefabToTimeline(prefab, targetTrackId, startTime);
    } else if (itemType === 'media') {
      const asset = mediaAssets.find(m => m.id === itemId);
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
          trackId: targetTrackId,
          startTime: startTime,
          duration: 5,
          type: 'shape',
          components
        });
        setEntities(prev => [...prev, newGO]);
        setSelectedEntityId(newGO.id);
      }
    }
  };

  // Save GameObject as Prefab
  const handleSaveAsPrefab = (entity) => {
    const newPrefab = {
      id: `prefab-${Date.now()}`,
      name: `${entity.name}.prefab`,
      type: entity.type,
      components: JSON.parse(JSON.stringify(entity.components || []))
    };
    setPrefabs(prev => [...prev, newPrefab]);
  };

  const handleRemovePrefab = (prefabId) => {
    setPrefabs(prev => prev.filter(p => p.id !== prefabId));
  };

  // Create & Save Script
  const handleCreateScript = async (newScript) => {
    setScripts(prev => [...prev, newScript]);
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
    // fresh undo history, same as New Project / Load Demo Scene.
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

    const poller = setInterval(async () => {
      if (isPollingScriptsRef.current) return;
      isPollingScriptsRef.current = true;
      try {
        const updatedScripts = await checkScriptsForChanges(projectFolderHandle, scriptsRef.current);
        if (updatedScripts) {
          setScripts(updatedScripts);
          // Real-import support: an external edit may have added `import`
          // statements — bundle the changed scripts in the background.
          precompileAllProjectScripts(updatedScripts, projectFolderHandle).catch(() => {});
        }
      } finally {
        isPollingScriptsRef.current = false;
      }
    }, 2000);

    return () => clearInterval(poller);
  }, [projectFolderHandle]);

  // Track management
  const handleAddTrack = () => {
    const nextNum = tracks.length + 1;
    setTracks(prev => [...prev, {
      id: `track-${Date.now()}`,
      name: `Track ${nextNum}`,
      type: 'layer',
      muted: false,
      locked: false,
      visible: true,
      volume: 1.0
    }]);
  };

  // Coalesced for the same reason as handleUpdateEntity — track volume
  // sliders etc. fire continuously while dragging.
  const handleUpdateTrack = (trackId, updates) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, ...updates } : t), { coalesce: true });
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
    // entity / track operations
    handleUpdateEntity,
    handleDeleteEntity,
    handleSplitEntity,
    handleAddEmptyClip,
    handleAddPrefabToTimeline,
    handleAddMediaToTimeline,
    handleDropItemOnTrack,
    handleAddTrack,
    handleUpdateTrack,
    // prefab / script operations
    handleSaveAsPrefab,
    handleRemovePrefab,
    handleCreateScript,
    handleSaveScript,
    // project JSON apply
    handleApplyProjectJson,
    // project-swap load paths
    handleLoadDemoScene,
    handleProjectCreated,
    handleOpenProjectFolder,
    handleOpenRecentProject,
  };
}
