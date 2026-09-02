import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useUndoableState } from './hooks/useUndoableState';
import { UnityHeader } from './components/UnityHeader';
import { ProjectJsonModal } from './components/ProjectJsonModal';
import { ScriptEditorModal } from './components/ScriptEditorModal';
import { ExportModal } from './components/ExportModal';
import { NewProjectModal } from './components/NewProjectModal';
import { SettingsModal } from './components/SettingsModal';
import { HubScreen } from './components/HubScreen';
import { DockLayout } from './dock/DockLayout';
import { EditorContext } from './dock/EditorContext';
import { PlaybackProvider } from './hooks/PlaybackContext';
import { EditorHeader } from './components/EditorHeader';
import { EditorPlaybackShortcuts } from './components/EditorPlaybackShortcuts';
import { PlaybackStoreBridge } from './components/PlaybackStoreBridge';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { INITIAL_TRACKS, DEFAULT_PIXELS_PER_SECOND, DEFAULT_RESOLUTION } from './types';
import { createSyntheticAudio, createSyntheticVideo } from './utils/sampleMedia';
import { loadAudioSettings } from './services/audioSettings';
import { DEFAULT_SCRIPTS, DEFAULT_PREFABS, createGameObject, createDefaultTransform } from './engine/ecs';
import { 
  pickProjectDirectory, 
  loadProjectFromDirectory, 
  saveProjectToDirectory, 
  saveMediaFileToFolder, 
  checkScriptsForChanges,
  writeScriptFile,
  verifyPermission
} from './services/projectFileSystem';
import { recordProjectCreated, recordProjectOpened } from './services/recentProjects';
import './App.css';
 
export function App() {
  // Which top-level screen is showing. 'hub' is the landing screen (recent
  // projects + New/Open), shown on every app load before the editor mounts
  // — a separate screen from NewProjectModal, not a replacement for it.
  // Any successful create/open/demo-load flips this to 'editor'.
  const [screen, setScreen] = useState('hub');
  const [projectName, setProjectName] = useState('new-project');
  // Actual pixel dimensions the project renders/exports at (see
  // NewProjectModal's resolution picker + types.js RESOLUTION_PRESETS).
  // EntityRenderer's preview frame derives its aspect-ratio from this
  // instead of a hardcoded 16:9, so the Game preview always matches
  // whatever the project was created at.
  const [resolution, setResolution] = useState(DEFAULT_RESOLUTION);
 
  // Undo/Redo: entities, tracks, scripts & prefabs live together in one
  // history stack so a single Ctrl+Z reverts the last logical edit across
  // all of them. mediaAssets/projectName/selection are intentionally left
  // out of the undo scope (matching how most editors treat asset imports
  // and selection as non-undoable housekeeping, not content edits).
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
 
  const [mediaAssets, setMediaAssets] = useState([]);
 
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [autoKeyEnabled, setAutoKeyEnabled] = useState(false);

  const handleZoomIn = () => {
    setPixelsPerSecond(prev => Math.min(prev + 15, 240));
  };

  const handleZoomOut = () => {
    setPixelsPerSecond(prev => Math.max(prev - 15, 15));
  };
 
  // Project Folder Handle & Disk Save State
  const [projectFolderHandle, setProjectFolderHandle] = useState(null);
  const [saveStatus, setSaveStatus] = useState('in-memory'); // 'saved' | 'saving' | 'in-memory'
  const isAutoSavingRef = useRef(false);
 
  // Modals
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isProjectJsonOpen, setIsProjectJsonOpen] = useState(false);
  const [isScriptEditorOpen, setIsScriptEditorOpen] = useState(false);
  const [editingScript, setEditingScript] = useState(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
 
  // Voice Recording: which track (if any) is currently armed/recording,
  // and the selected input device (persisted via Settings modal).
  const [recordingTrackId, setRecordingTrackId] = useState(null);
  const [audioInputDeviceId, setAudioInputDeviceId] = useState(() => loadAudioSettings().inputDeviceId);
  const recordingStartTimeRef = useRef(0);
  const playbackStoreRef = useRef(null);
  const { startRecording, stopRecording } = useAudioRecorder({ inputDeviceId: audioInputDeviceId });

  const getPlaybackTime = useCallback(() => playbackStoreRef.current?.getCurrentTime() ?? 0, []);
 
  // Calculate timeline duration based on entity placements
  // BUG FIX -- this used to return a fabricated `30` when there were no
  // clips at all, which useTimelinePlayback then treated as a completely
  // real project end: pressing Play on an empty timeline would run for
  // 30s and then either stop dead or (with Loop on) silently snap the
  // playhead back to 0 and keep going, forever, on a timeline with nothing
  // on it. An empty project doesn't have a meaningful duration to play or
  // loop against, so this now returns 0 -- useTimelinePlayback below is
  // updated to treat totalDuration <= 0 as "nothing to play" and refuse to
  // start/continue the playback tick loop in that case.
  const calculatedDuration = useMemo(() => {
    if (entities.length === 0) return 0;
    const maxEnd = Math.max(...entities.map((e) => e.startTime + e.duration));
    return Math.max(30, Math.ceil(maxEnd + 5));
  }, [entities]);
 
 
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
              type: 'ReactRenderer',
              scriptId: 'script-glass-card',
              scriptName: 'GlassCard.jsx',
              props: {
                title: 'BLAHBLAH STUDIO',
                badge: 'REACT COMPONENT',
                accentColor: '#6366f1'
              }
            },
            {
              type: 'ScriptComponent',
              scriptId: 'script-float-bounce',
              scriptName: 'FloatAndBounce.js',
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
              scriptName: 'PulseScale.js',
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
    setEntities(prev => prev.map(e => e.id === entityId ? { ...e, ...updates } : e), { coalesce: true });
  }, [setEntities]);
 
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
 
    const newGO = createGameObject({
      name: asset.name.replace(/\.[^.]+$/, ''),
      trackId: targetTrackId,
      startTime: startTime,
      duration: asset.duration || 8,
      type: isAudio ? 'audio' : 'video',
      src: asset.url,
      components: [
        createDefaultTransform({ x: 0, y: 0 }),
        isAudio
          ? {
              type: 'AudioSource',
              src: asset.url,
              volume: 1,
              speed: 1,
              mediaOffset: 0
            }
          : {
              type: 'VideoRenderer',
              src: asset.url,
              volume: 1,
              speed: 1,
              mediaOffset: 0
            }
      ]
    });
 
    setEntities(prev => [...prev, newGO]);
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
        const isJsx = script.name.endsWith('.jsx') || script.code?.includes('return') || script.code?.includes('div');
        const newGO = isJsx ? createGameObject({
          name: `${script.name.replace(/\.(jsx|js|cs)$/i, '')} Clip`,
          trackId: targetTrackId,
          startTime: startTime,
          duration: 5,
          type: 'react',
          components: [
            createDefaultTransform({ x: 0, y: 0 }),
            {
              type: 'ReactRenderer',
              scriptId: script.id,
              scriptName: script.name,
              props: {}
            }
          ]
        }) : createGameObject({
          name: `${script.name.replace(/\.(jsx|js|cs)$/i, '')} Clip`,
          trackId: targetTrackId,
          startTime: startTime,
          duration: 5,
          type: 'shape',
          components: [
            createDefaultTransform({ x: 0, y: 0 }),
            {
              type: 'ShapeRenderer',
              shapeType: 'rounded-rect',
              width: 140,
              height: 140,
              color: '#3b82f6',
              strokeColor: '#60a5fa',
              strokeWidth: 2,
              borderRadius: 12
            },
            {
              type: 'ScriptComponent',
              scriptId: script.id,
              scriptName: script.name,
              enabled: true,
              props: {}
            }
          ]
        });
        setEntities(prev => [...prev, newGO]);
        setSelectedEntityId(newGO.id);
      }
    }
  };
 
  // Upload Media File
  const handleAddMediaAsset = async (asset, originalFile = null) => {
    setMediaAssets(prev => [asset, ...prev]);
    if (projectFolderHandle && originalFile) {
      await saveMediaFileToFolder(projectFolderHandle, originalFile, asset.folder || null).catch(() => {});
    }
  };
 
  // Voice Recording — toggled from the per-track record button in
  // TrackHeader. Clicking record on a track arms that track (captures
  // from the Settings-selected input device); clicking again (or the
  // Square/stop icon) stops, saves the clip into Media > Recordings,
  // and drops it onto that same track at the time recording started.
  const handleToggleRecordTrack = useCallback(async (trackId) => {
    if (recordingTrackId === trackId) {
      // Stop & finalize this track's recording
      const result = await stopRecording();
      setRecordingTrackId(null);
      if (!result || !result.blob || result.durationSec < 0.15) return;
 
      const { blob, durationSec, mimeType } = result;
      const ext = mimeType.includes('webm') ? 'webm' : 'wav';
      const takeNumber = mediaAssets.filter(m => m.folder === 'Recordings').length + 1;
      const fileName = `Recording_${String(takeNumber).padStart(3, '0')}.${ext}`;
      const url = URL.createObjectURL(blob);
      const file = new File([blob], fileName, { type: mimeType });
 
      const asset = {
        id: `asset-recording-${Date.now()}`,
        name: fileName,
        type: 'audio',
        url,
        duration: durationSec,
        size: blob.size,
        folder: 'Recordings',
      };
 
      await handleAddMediaAsset(asset, file);
      handleAddMediaToTimeline(asset, trackId, recordingStartTimeRef.current);
      return;
    }
 
    if (recordingTrackId) return; // another track is already recording
 
    // Arm this track and start capturing at the current playhead position
    recordingStartTimeRef.current = getPlaybackTime();
    await startRecording();
    setRecordingTrackId(trackId);
  }, [recordingTrackId, getPlaybackTime, mediaAssets, startRecording, stopRecording]);
 
  const handleAudioSettingsChanged = useCallback((settings) => {
    setAudioInputDeviceId(settings.inputDeviceId);
  }, []);
 
  const handleRemoveMediaAsset = (assetId) => {
    setMediaAssets(prev => prev.filter(a => a.id !== assetId));
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
 
  // Create & Save C# Script
  const handleCreateScript = async (newScript) => {
    setScripts(prev => [...prev, newScript]);
    if (projectFolderHandle) {
      await writeScriptFile(projectFolderHandle, newScript.name, newScript.code).catch(() => {});
    }
  };
 
  const handleSaveScript = async (scriptId, updates) => {
    setScripts(prev => prev.map(s => s.id === scriptId ? { ...s, ...updates } : s));
    const scriptObj = scripts.find(s => s.id === scriptId);
    if (projectFolderHandle && scriptObj) {
      const code = updates.code !== undefined ? updates.code : scriptObj.code;
      const name = updates.name || scriptObj.name;
      await writeScriptFile(projectFolderHandle, name, code).catch(() => {});
    }
  };
 
  const handleOpenScriptEditor = (script) => {
    setEditingScript(script);
    setIsScriptEditorOpen(true);
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
 
  // Current project state object
  const projectState = useMemo(() => ({
    projectName,
    fps: 30,
    resolution,
    width: resolution.width,
    height: resolution.height,
    tracks,
    scripts,
    prefabs,
    mediaAssets,
    entities
  }), [projectName, resolution, tracks, scripts, prefabs, mediaAssets, entities]);
 
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
 
  // Save Project to Disk manually
  const handleSaveProjectToDisk = useCallback(async () => {
    if (!projectFolderHandle) {
      setIsNewProjectOpen(true);
      return;
    }
    setSaveStatus('saving');
    try {
      await saveProjectToDirectory(projectFolderHandle, projectState);
      setSaveStatus('saved');
    } catch (err) {
      console.error('Disk save error:', err);
      alert(`Save failed: ${err.message}`);
      setSaveStatus('in-memory');
    }
  }, [projectFolderHandle, projectState]);
 
  // Auto-Save Debounce to Disk
  useEffect(() => {
    if (!projectFolderHandle) return;
 
    const timer = setTimeout(async () => {
      if (isAutoSavingRef.current) return;
      isAutoSavingRef.current = true;
      setSaveStatus('saving');
      try {
        await saveProjectToDirectory(projectFolderHandle, projectState);
        setSaveStatus('saved');
      } catch {
        // Ignore background auto-save error
      } finally {
        isAutoSavingRef.current = false;
      }
    }, 800);
 
    return () => clearTimeout(timer);
  }, [projectFolderHandle, projectState]);
 
  // Hot-Reload: Poll scripts/ directory for external edits in VS Code
  //
  // PERF/FREEZE FIX -- this previously listed `scripts` in its dependency
  // array. Every time a poll found a real change and called setScripts, this
  // effect re-ran (new `scripts` identity), tearing down and recreating the
  // interval. Worse, there was no "poll in progress" guard (unlike the
  // autosave effect above, which has `isAutoSavingRef`): checkScriptsForChanges
  // does real File System Access API I/O (getDirectoryHandle -> iterate ->
  // getFile -> file.text() per script file), and on a slow disk or with many
  // script files that can take longer than the 2000ms interval. When that
  // happens, overlapping polls pile up awaiting file reads on the main
  // thread -- which reads as a freeze that (a) doesn't require anything on
  // the timeline, since it only needs `projectFolderHandle` to be set, and
  // (b) gets worse with more objects/scripts, since each poll iterates every
  // script file. `scriptsRef` lets the interval read the latest scripts
  // without restarting on every change, and `isPollingRef` skips a tick
  // entirely if the previous one hasn't finished yet, matching the guard
  // pattern the autosave effect already uses.
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
 
  // Global keyboard shortcuts live in EditorPlaybackShortcuts (inside
  // PlaybackProvider) so App never re-renders on every playback frame.

  if (screen === 'hub') {
    return (
      <>
        <HubScreen
          onNewProject={() => setIsNewProjectOpen(true)}
          onOpenProjectFolder={handleOpenProjectFolder}
          onOpenRecentProject={handleOpenRecentProject}
        />
        {/* New Project modal is reachable from the Hub too — kept mounted
            here (rather than duplicated inside HubScreen) so project
            creation always goes through the same handleProjectCreated
            path regardless of which screen launched it. */}
        <NewProjectModal
          isOpen={isNewProjectOpen}
          onClose={() => setIsNewProjectOpen(false)}
          defaultTracks={INITIAL_TRACKS}
          onProjectCreated={handleProjectCreated}
        />
      </>
    );
  }
 
  return (
    <PlaybackProvider totalDuration={calculatedDuration}>
      <PlaybackStoreBridge storeRef={playbackStoreRef} />
      <EditorPlaybackShortcuts
        selectedEntityId={selectedEntityId}
        onSplitSelected={() => selectedEntityId && handleSplitEntity(selectedEntityId)}
        onDeleteSelected={() => selectedEntityId && handleDeleteEntity(selectedEntityId)}
        onSaveProject={handleSaveProjectToDisk}
        onUndo={undo}
        onRedo={redo}
        onToggleSnapping={() => setSnappingEnabled((prev) => !prev)}
        onZoomIn={() => setPixelsPerSecond((prev) => Math.min(160, prev + 10))}
        onZoomOut={() => setPixelsPerSecond((prev) => Math.max(10, prev - 10))}
      />
      <div className="app-container">
      {/* Top Navigation Bar */}
      <EditorHeader
        projectName={projectName}
        setProjectName={setProjectName}
        totalDuration={calculatedDuration}
        pixelsPerSecond={pixelsPerSecond}
        snappingEnabled={snappingEnabled}
        hasSelectedEntity={!!selectedEntityId}
        projectFolderHandle={projectFolderHandle}
        saveStatus={saveStatus}
        canUndo={canUndo}
        canRedo={canRedo}
        onSetPixelsPerSecond={setPixelsPerSecond}
        onSetSnappingEnabled={setSnappingEnabled}
        onSplitSelected={() => selectedEntityId && handleSplitEntity(selectedEntityId)}
        onDeleteSelected={() => selectedEntityId && handleDeleteEntity(selectedEntityId)}
        onUndo={undo}
        onRedo={redo}
        onOpenProjectJson={() => setIsProjectJsonOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onNewProject={() => setIsNewProjectOpen(true)}
        onOpenProjectFolder={handleOpenProjectFolder}
        onSaveProjectToDisk={handleSaveProjectToDisk}
        onLoadDemoScene={handleLoadDemoScene}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onGoToHub={() => setScreen('hub')}
      />
 
      {/* Unity-style dockable workspace: every panel below (Project,
          Game/Preview, Inspector, Timeline) can be dragged to any edge,
          split, or merged into tabs, same as Unity's editor windows.
          Panels read their props from EditorContext instead of being
          passed props directly, since dockview owns their mounting. */}
      <EditorContext.Provider
        value={{
          // data
          entities, tracks, scripts, prefabs, mediaAssets,
          calculatedDuration,
          selectedEntityId, pixelsPerSecond, snappingEnabled, resolution,
          autoKeyEnabled,
          // setters
          setSelectedEntityId,
          setAutoKeyEnabled,
          setPixelsPerSecond,
          // handlers
          handleUpdateEntity, handleDeleteEntity, handleSaveAsPrefab,
          handleUpdateTrack, handleAddTrack, handleAddEmptyClip,
          handleDropItemOnTrack,
          recordingTrackId,
          onToggleRecordTrack: handleToggleRecordTrack,
          onAddMediaAsset: handleAddMediaAsset,
          onRemoveMediaAsset: handleRemoveMediaAsset,
          onRemovePrefab: handleRemovePrefab,
          onCreateScript: handleCreateScript,
          onOpenScriptEditor: handleOpenScriptEditor,
          onAddPrefabToTimeline: handleAddPrefabToTimeline,
          onAddMediaToTimeline: handleAddMediaToTimeline,
          onZoomIn: handleZoomIn,
          onZoomOut: handleZoomOut,
        }}
      >
        <DockLayout />
      </EditorContext.Provider>
 
      {/* Modals */}
      <NewProjectModal
        isOpen={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        defaultTracks={INITIAL_TRACKS}
        onProjectCreated={handleProjectCreated}
      />
 
      <ProjectJsonModal
        isOpen={isProjectJsonOpen}
        onClose={() => setIsProjectJsonOpen(false)}
        projectState={projectState}
        onApplyProjectJson={handleApplyProjectJson}
      />
 
      <ScriptEditorModal
        isOpen={isScriptEditorOpen}
        onClose={() => setIsScriptEditorOpen(false)}
        script={editingScript}
        onSaveScript={handleSaveScript}
      />
 
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        projectName={projectName}
        clips={entities}
        tracks={tracks}
        scripts={scripts}
        totalDuration={calculatedDuration}
        resolution={resolution}
      />
 
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSettingsChanged={handleAudioSettingsChanged}
      />
    </div>
    </PlaybackProvider>
  );
}
 
export default App;
 