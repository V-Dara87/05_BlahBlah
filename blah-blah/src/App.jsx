import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useProjectStore } from './hooks/useProjectStore';
import { usePlaybackController } from './hooks/usePlaybackController';
import { useMediaAssets } from './hooks/useMediaAssets';
import { useSharedLibrary } from './hooks/useSharedLibrary';
import { MenuBar } from './components/MenuBar';
import { FilePlus, FolderOpen, Save, Download, Undo2, Redo2, Scissors, Trash2, Code, MousePointer2, Settings } from 'lucide-react';
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
import { loadAudioSettings } from './services/audioSettings';
import { saveProjectToDirectory } from './services/projectFileSystem';
import { precompileAllProjectScripts } from './engine/scriptRunner';
import { filterOutSubtrees } from './engine/ecs';
import { isTauri } from './services/tauriFsAdapter';
import { importMediaFiles } from './services/mediaImport';
import { openProjectInExplorer, openProjectInVsCode, openProjectInCursor } from './services/ideLauncher';
import { WindowControls } from './components/WindowControls';
import { toggleWindowMaximize } from './services/windowChrome';
import { ErrorBoundary } from './components/ErrorBoundary';
import './App.css';

/**
 * App — composition shell.
 *
 * This file is deliberately thin after the split:
 *   - useProjectStore   → entities/tracks/scripts/prefabs + undo + all
 *                         entity/track/script/prefab ops + the three
 *                         project-swap load paths (hooks/useProjectStore.js)
 *   - useMediaAssets    → mediaAssets state + import/remove
 *                         (hooks/useMediaAssets.js)
 *   - usePlaybackController → playbackStoreRef + getPlaybackTime; actual
 *                         playback state lives in PlaybackProvider
 *                         (hooks/PlaybackContext.jsx) — see that hook's
 *                         header for why
 *   - useAudioRecorder  → mic capture for per-track voice recording
 *
 * What stays here (shell-only, intentionally NOT in the undo-scoped store):
 * screen/projectName/resolution, selection (selectedEntityId/Ids), UI
 * prefs (pixelsPerSecond/snapping/autoKey/exportRange/selectedKeyId), the
 * disk folder handle + save status + autosave, modal open/close state,
 * recording arm state, dock API, and derived values (calculatedDuration,
 * projectState, menuBarConfig). These are "editor around the document"
 * concerns; the undo-scoped document model itself lives in useProjectStore.
 */
export function App() {
  // Which top-level screen is showing. 'hub' is the landing screen (recent
  // projects + New/Open), shown on every app load before the editor mounts
  // — a separate screen from NewProjectModal, not a replacement for it.
  // Any successful create/open flips this to 'editor'.
  const [screen, setScreen] = useState('hub');
  const [projectName, setProjectName] = useState('new-project');
  // Actual pixel dimensions the project renders/exports at (see
  // NewProjectModal's resolution picker + types.js RESOLUTION_PRESETS).
  // EntityRenderer's preview frame derives its aspect-ratio from this
  // instead of a hardcoded 16:9, so the Game preview always matches
  // whatever the project was created at.
  const [resolution, setResolution] = useState(DEFAULT_RESOLUTION);

  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]); // multi-select for timeline clips
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [autoKeyEnabled, setAutoKeyEnabled] = useState(false);

  // Export range — in/out points on the timeline for selective rendering.
  // null means "export the whole project"; when set, only the range
  // [exportRange.in, exportRange.out] is rendered during export.
  const [exportRange, setExportRange] = useState(null);

  // Selected keyframe ID — shared between Dopesheet and Curve Editor
  const [selectedKeyId, setSelectedKeyId] = useState(null);

  // Dockview API ref — set by DockLayout on ready, used by focusDockPanel
  const dockApiRef = useRef(null);
  const setDockApi = useCallback((api) => { dockApiRef.current = api; }, []);

  /** Focus an existing dock panel by id, or add it as a new tab next to
   *  the dopesheet if it doesn't exist yet. */
  const focusDockPanel = useCallback((panelId) => {
    const api = dockApiRef.current;
    if (!api) return;
    const existing = api.getPanel(panelId);
    if (existing) {
      api.activePanel = existing;
    } else {
      // Add new tab next to dopesheet (or timeline if dopesheet missing)
      const refPanel = api.getPanel('dopesheet') || api.getPanel('timeline');
      if (refPanel) {
        api.addPanel({
          id: panelId,
          component: panelId,
          title: panelId === 'curveEditor' ? 'Curves' : panelId,
          position: { direction: 'within', referencePanel: refPanel },
        });
      }
    }
  }, []);

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
  const { startRecording, stopRecording } = useAudioRecorder({ inputDeviceId: audioInputDeviceId });

  // Playback: App owns no playback state (PlaybackProvider/playbackStore
  // do, so panels don't re-render every frame) — this hook just provides
  // the store ref bridge + synchronous playhead reader for handlers.
  const { playbackStoreRef, getPlaybackTime } = usePlaybackController();

  // Media library (out of undo scope by design — see hook header).
  const {
    mediaAssets, setMediaAssets, handleAddMediaAsset, handleRemoveMediaAsset,
    handleMoveMediaAsset, handleReplaceMediaAsset,
  } = useMediaAssets({ projectFolderHandle });

  // App-wide Shared Library — prefabs/scripts that persist OUTSIDE any
  // single project folder (IndexedDB/localStorage) so they're available in
  // every project. Undo-independent by nature (not part of the document).
  const sharedLibrary = useSharedLibrary();

  // OS file drag-and-drop coexistence (P2-1). The window runs with
  // dragDropEnabled: false because dockview's HTML5 DnD (tab/panel
  // movement) is what actually works in the webview then — that same flag
  // disables Tauri's onDragDropEvent, so OS file drops arrive the same
  // way they do in a browser: as DOM drag events carrying sandboxed File
  // objects. This window-level handler catches exactly those (a real drop
  // always has dataTransfer.files) and imports any video/audio into the
  // media library via the shared importMediaFiles helper. In-app drags
  // (timeline clips, project-panel cards) carry custom JSON with NO files
  // and pass straight through untouched.
  useEffect(() => {
    const isFileDrop = (e) => (e.dataTransfer?.files?.length ?? 0) > 0;

    const onDragOver = (e) => {
      if (isFileDrop(e)) e.preventDefault();
    };
    const onDrop = (e) => {
      if (!isFileDrop(e)) return;
      // Timeline track lanes handle OS file drops themselves (import + place
      // at the drop position, see TrackLane.jsx) — skip so files aren't
      // imported twice.
      if (e.target?.closest?.('.track-lane-row')) return;
      e.preventDefault();
      importMediaFiles({
        files: e.dataTransfer.files,
        onAddMediaAsset: handleAddMediaAsset,
        mediaAssets,
        // OS file drops happen outside the Project panel, so a lightweight
        // alert is the only surface available here (the panel shows an
        // inline notice for picker imports).
        onDuplicatesDetected: (count) => {
          alert(`${count} file(s) look like duplicates of existing media assets.`);
        },
      });
    };

    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [handleAddMediaAsset, mediaAssets]);

  // Project document model + undo + load paths (the undo-scoped half).
  const {
    entities, tracks, scripts, prefabs,
    setEntities, setPrefabs,
    undo, redo, canUndo, canRedo,
    handleUpdateEntity, handleUpdateClips, handleDuplicateClips,
    handleDeleteEntity, handleSplitEntity,
    handleAddEmptyClip,
    handleAddPrefabToTimeline, handleAddMediaToTimeline,
    handleDropItemOnTrack, handleAttachScriptToEntity,
    handleAddTrack, handleUpdateTrack, handleDeleteTrack,
    handleSaveAsPrefab, handleMovePrefab, handleMoveScript,
    handleRemovePrefab, handleCreateScript, handleRemoveScript, handleRenameScript, handleSaveScript,
    handleApplyProjectJson,
    handleProjectCreated,
    handleOpenProjectFolder, handleOpenRecentProject,
  } = useProjectStore({
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
  });

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
        createdAt: Date.now(),
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

  const handleOpenScriptEditor = (script) => {
    setEditingScript(script);
    setIsScriptEditorOpen(true);
  };

  // Project explorer renames (Project panel context menu). Media/prefab
  // renames are in-memory record renames; scripts rename the record too
  // (the on-disk file follows on the next editor save of that script).
  const handleRenameMediaAsset = useCallback((assetId, name) => {
    setMediaAssets((prev) => prev.map((m) => (m.id === assetId ? { ...m, name } : m)));
  }, [setMediaAssets]);
  const handleRenamePrefab = useCallback((prefabId, name) => {
    setPrefabs((prev) => prev.map((p) => (p.id === prefabId ? { ...p, name } : p)));
  }, [setPrefabs]);

  // Shared-library actions (see hooks/useSharedLibrary.js). Share = copy a
  // project prefab/script into the app-wide library; import = bring a
  // shared item into THIS project (scripts must exist in the project to
  // run, prefabs are copied into the project's prefab list so they persist
  // with the folder on disk).
  const handleSharePrefab = useCallback(
    (prefab) => { sharedLibrary.addPrefab(prefab); },
    [sharedLibrary]
  );
  const handleShareScript = useCallback(
    (script) => { sharedLibrary.addScript(script); },
    [sharedLibrary]
  );
  const handleRemoveSharedItem = useCallback(
    (id) => { sharedLibrary.removeSharedItem(id); },
    [sharedLibrary]
  );

  const handleImportSharedItem = useCallback(async (sharedItem) => {
    if (!sharedItem) return;
    const data = sharedItem.data || {};
    if (sharedItem.type === 'script') {
      const newScript = {
        id: `script-${Date.now()}`,
        name: data.name || sharedItem.name || 'ImportedScript.jsx',
        description: data.description || 'Imported from Shared Library',
        code: data.code || '',
      };
      await handleCreateScript(newScript);
      handleOpenScriptEditor(newScript);
    } else if (sharedItem.type === 'prefab') {
      if (!data || typeof data !== 'object' || !data.name) return;
      setPrefabs((prev) => [
        ...prev,
        { ...JSON.parse(JSON.stringify(data)), id: `prefab-${Date.now()}` },
      ]);
    }
  }, [handleCreateScript, setPrefabs]);

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

  // Global keyboard shortcuts live in EditorPlaybackShortcuts (inside
  // PlaybackProvider) so App never re-renders on every playback frame.

  // Menu bar configuration — Unity-style top menus.
  // Add new menus by appending to this array; MenuBar renders them
  // automatically. Each item can have: label, shortcut, icon, onClick,
  // disabled, danger. Use { type: 'separator' } for dividers.
  const menuBarConfig = useMemo(() => [
    {
      label: 'File',
      items: [
        { label: 'New Project', shortcut: 'Ctrl+N', icon: <FilePlus size={13} />, onClick: () => setIsNewProjectOpen(true) },
        { label: 'Open Project...', shortcut: 'Ctrl+O', icon: <FolderOpen size={13} />, onClick: handleOpenProjectFolder },
        { label: 'Save Project', shortcut: 'Ctrl+S', icon: <Save size={13} />, onClick: handleSaveProjectToDisk, disabled: !projectFolderHandle },
        { type: 'separator' },
        { label: 'Export Render...', shortcut: 'Ctrl+E', icon: <Download size={13} />, onClick: () => setIsExportOpen(true) },
        { type: 'separator' },
        { label: 'Open in VS Code', icon: <Code size={13} />, onClick: () => openProjectInVsCode(projectFolderHandle?.path), disabled: !isTauri() || !projectFolderHandle?.path },
        { label: 'Open in Cursor', icon: <MousePointer2 size={13} />, onClick: () => openProjectInCursor(projectFolderHandle?.path), disabled: !isTauri() || !projectFolderHandle?.path },
        { label: 'Show in Explorer', icon: <FolderOpen size={13} />, onClick: () => openProjectInExplorer(projectFolderHandle?.path), disabled: !isTauri() || !projectFolderHandle?.path },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', icon: <Undo2 size={13} />, onClick: undo, disabled: !canUndo },
        { label: 'Redo', shortcut: 'Ctrl+Shift+Z', icon: <Redo2 size={13} />, onClick: redo, disabled: !canRedo },
        { type: 'separator' },
        { label: 'Split Clip', shortcut: 'S', icon: <Scissors size={13} />, onClick: () => selectedEntityId && handleSplitEntity(selectedEntityId), disabled: !selectedEntityId },
        { label: 'Delete Clip', shortcut: 'Del', icon: <Trash2 size={13} />, onClick: () => selectedEntityId && handleDeleteEntity(selectedEntityId), disabled: !selectedEntityId, danger: true },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Project Code', icon: <Code size={13} />, onClick: () => setIsProjectJsonOpen(true) },
        { type: 'separator' },
        { label: 'Settings', icon: <Settings size={13} />, onClick: () => setIsSettingsOpen(true) },
      ],
    },
  ], [
    canUndo, canRedo, undo, redo, selectedEntityId,
    handleSplitEntity, handleDeleteEntity, handleOpenProjectFolder,
    handleSaveProjectToDisk,
    projectFolderHandle,
  ]);

  // window-controls chrome is environment-dependent but cheap to compute
  // per render; isTauri() reads a window flag synchronously.

  const framelessChrome = isTauri() && (
    <>
      {/* Drag fill: takes the whole remaining top-bar width so the window
          can be grabbed anywhere right of the menus. Double-click it to
          maximize. data-tauri-drag-region applies only to this exact
          element — the menu buttons beside it stay clickable. */}
      <div
        className="menubar-drag-fill"
        data-tauri-drag-region
        onDoubleClick={() => toggleWindowMaximize()}
      />
      <WindowControls />
    </>
  );

  if (screen === 'hub') {
    return (
      <>
        {/* Frameless desktop build: the Hub screen has no MenuBar, so it
            gets a slim native window bar (drag anywhere + window
            controls) so the window can always be moved/closed. */}
        {isTauri() && (
          <div className="hub-window-bar">
            <span className="hub-window-bar-title">blahblah</span>
            <div
              className="hub-window-bar-fill"
              data-tauri-drag-region
              onDoubleClick={() => toggleWindowMaximize()}
            />
            <WindowControls />
          </div>
        )}
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
    <ErrorBoundary>
    <PlaybackProvider totalDuration={calculatedDuration}>
      <PlaybackStoreBridge storeRef={playbackStoreRef} />
      <EditorPlaybackShortcuts
        entities={entities}
        selectedEntityId={selectedEntityId}
        selectedIds={selectedIds}
        onSplitSelected={() => {
          const ids = selectedIds.length > 0 ? selectedIds : (selectedEntityId ? [selectedEntityId] : []);
          if (ids.length > 0) handleSplitEntity(ids);
        }}
        onDeleteSelected={() => {
          const idsToDelete = selectedIds.length > 0 ? selectedIds : (selectedEntityId ? [selectedEntityId] : []);
          if (idsToDelete.length > 0) {
            setEntities((prev) => filterOutSubtrees(prev, Array.from(new Set(idsToDelete))));
            setSelectedIds([]);
            setSelectedEntityId(null);
          }
        }}
        onDeleteMultiple={() => {
          const idsToDelete = selectedIds.length > 0 ? selectedIds : (selectedEntityId ? [selectedEntityId] : []);
          if (idsToDelete.length > 0) {
            setEntities((prev) => filterOutSubtrees(prev, Array.from(new Set(idsToDelete))));
            setSelectedIds([]);
            setSelectedEntityId(null);
          }
        }}
        onDuplicateSelected={() => {
          const ids = selectedIds.length > 0 ? selectedIds : (selectedEntityId ? [selectedEntityId] : []);
          if (ids.length > 0) {
            const newIds = handleDuplicateClips(ids);
            if (newIds && newIds.length > 0) {
              setSelectedIds(newIds);
              setSelectedEntityId(newIds[0]);
            }
          }
        }}
        onSelectAll={() => {
          const allIds = entities.map(e => e.id);
          setSelectedIds(allIds);
          setSelectedEntityId(allIds[0] || null);
        }}
        onClearSelection={() => {
          setSelectedIds([]);
          setSelectedEntityId(null);
        }}
        onSaveProject={handleSaveProjectToDisk}
        onUndo={undo}
        onRedo={redo}
        onToggleSnapping={() => setSnappingEnabled((prev) => !prev)}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onSetExportRange={setExportRange}
        exportRange={exportRange}
        totalDuration={calculatedDuration}
      />
      <div className="app-container">
      {/* Top Menu Bar — Unity-style File/Edit/View menus. In the
          frameless desktop build the right end carries window controls
          and a drag region (see framelessChrome above). */}
      <MenuBar menus={menuBarConfig} trailing={framelessChrome} />

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
          projectFolderHandle,
          calculatedDuration,
          selectedEntityId, pixelsPerSecond, snappingEnabled, resolution,
          fps: projectState.fps,
          autoKeyEnabled,
          // setters
          setSelectedEntityId,
          setAutoKeyEnabled,
          setPixelsPerSecond,
          // handlers
          handleUpdateEntity, handleUpdateClips, handleDuplicateClips,
          handleDeleteEntity, handleSaveAsPrefab,
          handleUpdateTrack, handleDeleteTrack, handleAddTrack, handleAddEmptyClip,
          handleDropItemOnTrack, handleAttachScriptToEntity,
          selectedKeyId, setSelectedKeyId,
          selectedIds, setSelectedIds,
          recordingTrackId,
          onToggleRecordTrack: handleToggleRecordTrack,
          onAddMediaAsset: handleAddMediaAsset,
          onRemoveMediaAsset: handleRemoveMediaAsset,
          onMoveMediaAsset: handleMoveMediaAsset,
          onReplaceMediaAsset: handleReplaceMediaAsset,
          onMovePrefab: handleMovePrefab,
          onMoveScript: handleMoveScript,
          onRemovePrefab: handleRemovePrefab,
          onRenamePrefab: handleRenamePrefab,
          onCreateScript: handleCreateScript,
          onRemoveScript: handleRemoveScript,
          onRenameScript: handleRenameScript,
          onRenameMediaAsset: handleRenameMediaAsset,
          onOpenScriptEditor: handleOpenScriptEditor,
          onAddPrefabToTimeline: handleAddPrefabToTimeline,
          onAddMediaToTimeline: handleAddMediaToTimeline,
          // App-wide Shared Library (project-panel "shared" folder)
          sharedLibraryItems: sharedLibrary.items,
          onSharePrefab: handleSharePrefab,
          onShareScript: handleShareScript,
          onRemoveSharedItem: handleRemoveSharedItem,
          onImportSharedItem: handleImportSharedItem,
          onZoomIn: handleZoomIn,
          onZoomOut: handleZoomOut,
          exportRange, setExportRange,
          setDockApi,
          focusDockPanel,
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
        exportRange={exportRange}
        onBeforeExport={async () => {
          if (projectFolderHandle) {
            await precompileAllProjectScripts(scripts, projectFolderHandle);
          }
        }}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSettingsChanged={handleAudioSettingsChanged}
      />
    </div>
    </PlaybackProvider>
    </ErrorBoundary>
  );
}

export default App;
