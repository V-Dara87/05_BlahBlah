import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useUndoableState } from './hooks/useUndoableState';
import { UnityHeader } from './components/UnityHeader';
import { ProjectPanel } from './components/ProjectPanel';
import { EntityRenderer } from './components/EntityRenderer';
import { UnityInspector } from './components/UnityInspector';
import { Timeline } from './components/Timeline/Timeline';
import { ProjectJsonModal } from './components/ProjectJsonModal';
import { ScriptEditorModal } from './components/ScriptEditorModal';
import { ExportModal } from './components/ExportModal';
import { NewProjectModal } from './components/NewProjectModal';
import { useTimelinePlayback } from './hooks/useTimelinePlayback';
import { INITIAL_TRACKS, DEFAULT_PIXELS_PER_SECOND } from './types';
import { createSyntheticAudio, createSyntheticVideo } from './utils/sampleMedia';
import { DEFAULT_SCRIPTS, DEFAULT_PREFABS, createGameObject, createDefaultTransform } from './engine/ecs';
import { 
  pickProjectDirectory, 
  loadProjectFromDirectory, 
  saveProjectToDirectory, 
  saveMediaFileToFolder, 
  checkScriptsForChanges,
  writeScriptFile
} from './services/projectFileSystem';
import './App.css';
 
export function App() {
  const [projectName, setProjectName] = useState('new-project');
 
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
 
  // Calculate timeline duration based on entity placements
  const calculatedDuration = useMemo(() => {
    if (entities.length === 0) return 30;
    const maxEnd = Math.max(...entities.map((e) => e.startTime + e.duration));
    return Math.max(30, Math.ceil(maxEnd + 5));
  }, [entities]);
 
  const {
    isPlaying,
    currentTime,
    isLooping,
    togglePlay,
    seek,
    setIsLooping,
  } = useTimelinePlayback(calculatedDuration);
 
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
 
    const splitPoint = currentTime;
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
  }, [entities, selectedEntityId, currentTime]);
 
  // Create an Empty Clip with Transform & Shape / Renderer
  const handleAddEmptyClip = useCallback((targetTrackId = 'track-1', startTime = currentTime) => {
    const newGO = createGameObject({
      name: 'New Clip',
      trackId: targetTrackId || 'track-1',
      startTime: startTime !== undefined ? startTime : currentTime,
      duration: 5,
      type: 'shape',
      components: [
        createDefaultTransform({ x: 0, y: 0 }),
        {
          type: 'ShapeRenderer',
          shapeType: 'rounded-rect',
          width: 140,
          height: 140,
          color: '#4f46e5',
          strokeColor: '#38bdf8',
          strokeWidth: 2,
          borderRadius: 12
        }
      ]
    });
 
    setEntities(prev => [...prev, newGO]);
    setSelectedEntityId(newGO.id);
  }, [currentTime]);
 
  // Add Prefab to Timeline
  const handleAddPrefabToTimeline = (prefab, targetTrackId = 'track-1', startTime = currentTime) => {
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
  const handleAddMediaToTimeline = (asset, targetTrackId = 'track-3', startTime = currentTime) => {
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
      await saveMediaFileToFolder(projectFolderHandle, originalFile).catch(() => {});
    }
  };
 
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
    width: 1920,
    height: 1080,
    tracks,
    scripts,
    prefabs,
    mediaAssets,
    entities
  }), [projectName, tracks, scripts, prefabs, mediaAssets, entities]);
 
  // Handle Project Creation from New Project Modal — a brand new project
  // folder, so it gets a brand new (empty) undo history too.
  const handleProjectCreated = (result) => {
    setProjectFolderHandle(result.dirHandle);
    setProjectName(result.projectName);
    resetProjectHistoryState({ entities: [], tracks: result.tracks, scripts: [], prefabs: [] });
    setMediaAssets([]);
    setSelectedEntityId(null);
    setSaveStatus('saved');
  };
 
  // Open & Load an existing Project Folder from Disk
  const handleOpenProjectFolder = useCallback(async () => {
    try {
      const dirHandle = await pickProjectDirectory();
      const loaded = await loadProjectFromDirectory(dirHandle, INITIAL_TRACKS);
 
      setProjectFolderHandle(dirHandle);
      setProjectName(loaded.projectName);
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
    } catch (err) {
      if (err.name !== 'AbortError') {
        alert(`Failed to open project folder: ${err.message}`);
      }
    }
  }, [resetProjectHistoryState]);
 
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
  useEffect(() => {
    if (!projectFolderHandle) return;
 
    const poller = setInterval(async () => {
      const updatedScripts = await checkScriptsForChanges(projectFolderHandle, scripts);
      if (updatedScripts) {
        setScripts(updatedScripts);
      }
    }, 2000);
 
    return () => clearInterval(poller);
  }, [projectFolderHandle, scripts]);
 
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
 
  // Global Keyboard Shortcuts (Space, Split, Delete, Ctrl+S)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSaveProjectToDisk();
        return;
      }
 
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
 
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
      } else if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'c' || e.key === 'C' || e.key === 's' || e.key === 'S') {
        if (selectedEntityId) {
          e.preventDefault();
          handleSplitEntity(selectedEntityId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEntityId) {
          e.preventDefault();
          handleDeleteEntity(selectedEntityId);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek(currentTime - (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seek(currentTime + (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === 'n' || e.key === 'N') {
        setSnappingEnabled(prev => !prev);
      } else if (e.key === '=' || e.key === '+') {
        setPixelsPerSecond(prev => Math.min(160, prev + 10));
      } else if (e.key === '-' || e.key === '_') {
        setPixelsPerSecond(prev => Math.max(10, prev - 10));
      }
    };
 
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, selectedEntityId, handleSplitEntity, handleDeleteEntity, seek, currentTime, handleSaveProjectToDisk, undo, redo]);
 
  const selectedEntity = entities.find(e => e.id === selectedEntityId);
 
  return (
    <div className="app-container">
      {/* Top Navigation Bar */}
      <UnityHeader
        projectName={projectName}
        setProjectName={setProjectName}
        currentTime={currentTime}
        totalDuration={calculatedDuration}
        isPlaying={isPlaying}
        isLooping={isLooping}
        pixelsPerSecond={pixelsPerSecond}
        snappingEnabled={snappingEnabled}
        hasSelectedEntity={!!selectedEntityId}
        projectFolderHandle={projectFolderHandle}
        saveStatus={saveStatus}
        canUndo={canUndo}
        canRedo={canRedo}
        onTogglePlay={togglePlay}
        onSeek={seek}
        onToggleLoop={() => setIsLooping(!isLooping)}
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
      />
 
      {/* Main 3-Column Stage */}
      <main className="editor-top-stage">
        {/* Left: Project Assets Panel */}
        <ProjectPanel
          mediaAssets={mediaAssets}
          prefabs={prefabs}
          scripts={scripts}
          onAddMediaAsset={handleAddMediaAsset}
          onRemoveMediaAsset={handleRemoveMediaAsset}
          onRemovePrefab={handleRemovePrefab}
          onCreateScript={handleCreateScript}
          onOpenScriptEditor={handleOpenScriptEditor}
          onAddPrefabToTimeline={handleAddPrefabToTimeline}
          onAddMediaToTimeline={handleAddMediaToTimeline}
        />
 
        {/* Center: Normal Video Preview Player Window */}
        <EntityRenderer
          entities={entities}
          tracks={tracks}
          scripts={scripts}
          currentTime={currentTime}
          totalDuration={calculatedDuration}
          isPlaying={isPlaying}
          isLooping={isLooping}
          selectedEntityId={selectedEntityId}
          onSelectEntity={setSelectedEntityId}
          onTogglePlay={togglePlay}
          onSeek={seek}
          onToggleLoop={() => setIsLooping(!isLooping)}
        />
 
        {/* Right: Inspector */}
        <UnityInspector
          selectedEntity={selectedEntity}
          tracks={tracks}
          scripts={scripts}
          onUpdateEntity={handleUpdateEntity}
          onDeleteEntity={handleDeleteEntity}
          onOpenScriptEditor={handleOpenScriptEditor}
          onSaveAsPrefab={handleSaveAsPrefab}
        />
      </main>
 
      {/* Bottom Unified Multi-Track Timeline */}
      <footer className="editor-bottom-timeline">
        <Timeline
          tracks={tracks}
          clips={entities}
          currentTime={currentTime}
          totalDuration={calculatedDuration}
          pixelsPerSecond={pixelsPerSecond}
          selectedClipId={selectedEntityId}
          snappingEnabled={snappingEnabled}
          onSeek={seek}
          onSelectClip={setSelectedEntityId}
          onUpdateClip={handleUpdateEntity}
          onUpdateTrack={handleUpdateTrack}
          onAddTrack={handleAddTrack}
          onAddEmptyClip={handleAddEmptyClip}
          onDropItemOnTrack={handleDropItemOnTrack}
        />
      </footer>
 
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
      />
    </div>
  );
}
 
export default App;
 