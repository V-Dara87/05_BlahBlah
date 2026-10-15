 
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useProjectStore } from './hooks/useProjectStore';
import { usePlaybackController } from './hooks/usePlaybackController';
import { useMediaAssets } from './hooks/useMediaAssets';
import { useSharedLibrary } from './hooks/useSharedLibrary';
import { useSharedLibraryActions } from './hooks/useSharedLibraryActions';
import { useDockPanels } from './hooks/useDockPanels';
import { useProjectPersistence } from './hooks/useProjectPersistence';
import { useProjectAutosave } from './hooks/useProjectAutosave';
import { useAutosaveSettings } from './hooks/useAutosaveSettings';
import { useEditorSettings } from './hooks/useEditorSettings';
import { useExportSettings } from './hooks/useExportSettings';
import { useThemeSettings } from './hooks/useThemeSettings';
import { useAudioRecording } from './hooks/useAudioRecording';
import { usePrefabEditing } from './hooks/usePrefabEditing';
import { useOsFileDrop } from './hooks/useOsFileDrop';
import { useMenuBarConfig } from './hooks/useMenuBarConfig';
import { useEditorPlaybackHandlers } from './hooks/useEditorPlaybackHandlers';
import { MenuBar } from './components/shell/MenuBar';
import { ProjectJsonModal } from './components/modals/ProjectJsonModal';
import { ScriptEditorModal } from './components/modals/ScriptEditorModal';
import { ScriptDocsModal } from './components/modals/ScriptDocsModal';
import { ExportModal } from './components/modals/ExportModal';
import { NewProjectModal } from './components/modals/NewProjectModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { PackageManagerModal } from './components/modals/PackageManagerModal';
import { HubScreen } from './components/shell/HubScreen';
import { DockLayout } from './dock/DockLayout';
import { EditorContext } from './dock/EditorContext';
import { TimelineViewProvider } from './dock/TimelineViewContext';
import { PlaybackProvider } from './hooks/PlaybackContext';
import { EditorHeader } from './components/shell/EditorHeader';
import { EditorPlaybackShortcuts } from './components/shell/EditorPlaybackShortcuts';
import { PlaybackStoreBridge } from './components/shell/PlaybackStoreBridge';
import { INITIAL_TRACKS, DEFAULT_RESOLUTION } from './types';
import { loadKeybindSettings } from './services/keybindSettings';
import { precompileAllProjectScripts } from './engine/scriptRunner';
import { isTauri } from './services/tauriFsAdapter';
import { WindowControls } from './components/shell/WindowControls';
import { toggleWindowMaximize } from './services/windowChrome';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import './App.css';
import './app-shell.css';
import './styles/shared.css';
 
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
 *   - useDockPanels     → dock API ref, open/focus/popout/float panel
 *                         handlers, layout reset, Alt+P/Alt+F hotkeys
 *                         (hooks/useDockPanels.js)
 *   - useProjectPersistence → disk folder handle, save status/schema
 *                         warning, manual save + the one-at-a-time save
 *                         queue (hooks/useProjectPersistence.js)
 *   - useProjectAutosave → WHEN to autosave: debounce on real document
 *                         changes, blur/close flush, driven by the
 *                         Settings > Autosave values (useAutosaveSettings)
 *                         (hooks/useProjectAutosave.js)
 *   - useEditorSettings / useExportSettings → live copies of the global
 *                         Settings > Timeline / Export defaults, owned here
 *                         so the modal and their consumers share one state
 *                         (hooks/useEditorSettings.js, useExportSettings.js)
 *   - useThemeSettings → live copy of the global Settings > Appearance accent
 *                         theme; writes the derived palette onto <html> so one
 *                         state change re-colours every stylesheet
 *                         (hooks/useThemeSettings.js)
 *   - useAudioRecording → mic capture for per-track voice recording,
 *                         arm/stop/finalize, stop-on-pause sync
 *                         (hooks/useAudioRecording.js)
 *   - usePrefabEditing  → prefab edit-mode state + its own entity actions
 *                         (enter/save/sync/exit) (hooks/usePrefabEditing.js)
 *   - useSharedLibraryActions → share/remove/move/import handlers wrapping
 *                         useSharedLibrary (hooks/useSharedLibraryActions.js)
 *   - useOsFileDrop     → global OS file drag-and-drop listener
 *                         (hooks/useOsFileDrop.js)
 *   - useMenuBarConfig  → File/Edit/View/Window menu definitions
 *                         (hooks/useMenuBarConfig.js)
 *   - useEditorPlaybackHandlers → isPrefabMode-branching handlers passed
 *                         to <EditorPlaybackShortcuts>
 *                         (hooks/useEditorPlaybackHandlers.js)
 *
 * What stays here (shell-only, intentionally NOT in the undo-scoped store):
 * screen/projectName/resolution, selection (selectedEntityId/Ids), UI
 * prefs (pixelsPerSecond/snapping/autoKey/exportRange/selectedKeyId), modal
 * open/close state, and derived values (calculatedDuration, projectState,
 * menuBarConfig). These are "editor around the document" concerns; the
 * undo-scoped document model itself lives in useProjectStore.
 *
 * ORDERING NOTE: useProjectPersistence is called early (right after
 * useDockPanels) purely for its `projectFolderHandle` state + setter,
 * which useMediaAssets and useProjectStore both need as inputs. It
 * doesn't get `projectState` itself until later, once useProjectStore and
 * useMediaAssets have produced the pieces `projectState` is built from —
 * see that hook's header for how the lazy `getProjectState` getter
 * resolves that circular dependency. useProjectAutosave is the opposite:
 * it is called AFTER `projectState` is built (it depends on the document
 * pieces themselves, not on a getter).
 */
export function App() {
  // Which top-level screen is showing. 'hub' is the landing screen (recent
  // projects + New/Open), shown on every app load before the editor mounts
  // — a separate screen from NewProjectModal, not a replacement for it.
  // Any successful create/open flips this to 'editor'.
  const [screen, setScreen] = useState('hub');
  const [projectName, setProjectName] = useState('new-project');
  // Live keybind state for the menu bar's right-aligned shortcut hints
  // (see menuBarConfig below) — Settings -> Keyboard Shortcuts dispatches
  // 'blahblah:keybinds-changed' on every rebind (see keybindSettings.js),
  // so a rebind is reflected in the menu immediately without a reload.
  // EditorPlaybackShortcuts listens to the same event for the actual key
  // handling; this is purely the display string shown next to each item.
  const [keybinds, setKeybinds] = useState(() => loadKeybindSettings());
  useEffect(() => {
    const handleKeybindsChanged = (e) => setKeybinds(e.detail || loadKeybindSettings());
    window.addEventListener('blahblah:keybinds-changed', handleKeybindsChanged);
    return () => window.removeEventListener('blahblah:keybinds-changed', handleKeybindsChanged);
  }, []);
  // Actual pixel dimensions the project renders/exports at (see
  // NewProjectModal's resolution picker + types.js RESOLUTION_PRESETS).
  // EntityRenderer's preview frame derives its aspect-ratio from this
  // instead of a hardcoded 16:9, so the Preview always matches
  // whatever the project was created at.
  const [resolution, setResolution] = useState(DEFAULT_RESOLUTION);
 
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]); // multi-select for timeline clips
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [autoKeyEnabled, setAutoKeyEnabled] = useState(false);
 
  // Export range — in/out points on the timeline for selective rendering.
  // null means "export the whole project"; when set, only the range
  // [exportRange.in, exportRange.out] is rendered during export.
  const [exportRange, setExportRange] = useState(null);
 
  // Selected keyframe ID — shared between Dopesheet and Curve Editor
  const [selectedKeyId, setSelectedKeyId] = useState(null);
 
  const {
    setDockApi,
    setResetLayout,
    handleResetLayout,
    openOrFocusPanel,
    addNewPanelInstance,
    popoutActivePanel,
    floatActivePanel,
    focusDockPanel,
  } = useDockPanels();
 
  // Modals
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isProjectJsonOpen, setIsProjectJsonOpen] = useState(false);
  const [isScriptEditorOpen, setIsScriptEditorOpen] = useState(false);
  const [editingScript, setEditingScript] = useState(null);
  const [isScriptDocsOpen, setIsScriptDocsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPackageManagerOpen, setIsPackageManagerOpen] = useState(false);
  const [packageManagerCategory, setPackageManagerCategory] = useState('all');
  const handleOpenPackageManager = useCallback((category = 'all') => {
    setPackageManagerCategory(category);
    setIsPackageManagerOpen(true);
  }, []);
  // Global autosave preferences (Settings > Autosave). Shared with the modal below.
  const { autosaveSettings, updateAutosaveSettings } = useAutosaveSettings();
  // Global editor + export defaults (Settings > Timeline / Export). Called before
  // useProjectStore on purpose: the store creates its undo history, which needs
  // the undo depth.
  const { editorSettings, updateEditorSettings } = useEditorSettings();
  const { exportSettings, updateExportSettings } = useExportSettings();
  // Global accent theme (Settings > Appearance). The hook writes the palette to
  // <html> as CSS custom properties; main.jsx applies the stored one before the
  // first render so there is no flash of the default blue.
  const { themeSettings, updateThemeSettings } = useThemeSettings();
  const [silenceTarget, setSilenceTarget] = useState({ type: 'clip', id: null });
  const [silencePreviewData, setSilencePreviewData] = useState(null);
 
  // Disk folder handle + save status + autosave (see ORDERING NOTE above
  // and useProjectPersistence's header for why this is called this early,
  // ahead of the hooks that produce projectState).
  const {
    projectFolderHandle,
    setProjectFolderHandle,
    saveStatus,
    setSaveStatus,
    schemaWarning,
    setSchemaWarning,
    handleSaveProjectToDisk,
    requestSave,
  } = useProjectPersistence({
    getProjectState: () => projectState,
    onNeedNewProject: () => setIsNewProjectOpen(true),
  });
 
  // Playback: App owns no playback state (PlaybackProvider/playbackStore
  // do, so panels don't re-render every frame) — this hook just provides
  // the store ref bridge + synchronous playhead reader for handlers.
  const { playbackStoreRef, getPlaybackTime } = usePlaybackController();
 
  // Media library (out of undo scope by design — see hook header).
  // reconcileAssetUrlRef bridges a chicken-and-egg ordering problem: this
  // hook needs to notify "an asset's URL just changed from blob X to disk
  // URL Y, please fix any clip entity still pointing at X" but useEntities
  // (which owns setEntities) is initialized further below, using state
  // this hook itself provides. A ref lets the actual reconciliation
  // function be filled in after useProjectStore runs, while still being
  // callable from inside handleAddMediaAsset above at any time.
  const reconcileAssetUrlRef = useRef(null);
  const {
    mediaAssets, setMediaAssets, handleAddMediaAsset, handleRemoveMediaAsset,
    handleMoveMediaAsset, handleReplaceMediaAsset,
  } = useMediaAssets({
    projectFolderHandle,
    onReconcileAssetUrl: (oldUrl, newUrl) => reconcileAssetUrlRef.current?.(oldUrl, newUrl),
  });
 
  // App-wide Shared Library — prefabs/scripts that persist OUTSIDE any
  // single project folder (IndexedDB/localStorage) so they're available in
  // every project. Undo-independent by nature (not part of the document).
  const sharedLibrary = useSharedLibrary();
 
  // OS file drag-and-drop coexistence — see hooks/useOsFileDrop.js header
  // for why this has to be a window-level listener rather than something
  // scoped to a component.
  useOsFileDrop({ mediaAssets, handleAddMediaAsset });
 
  // Project document model + undo + load paths (the undo-scoped half).
  const {
    entities, tracks, scripts, prefabs,
    setEntities, setTracks, setPrefabs,
    undo, redo, canUndo, canRedo,
    handleUpdateEntity, handleUpdateClips, handleDuplicateClips,
    handleCopyClips, handlePasteClips,
    handleDeleteEntity, handleRippleTrimToPlayhead, handleSplitEntity,
    handleCutSilence,
    handleAddEmptyClip, handleAddTransitionClip,
    handleAddPrefabToTimeline, handleAddMediaToTimeline,
    handleSplitVideoAndAudio,
    handleDropItemOnTrack, handleAttachScriptToEntity,
    handleAddTrack, handleUpdateTrack, handleDeleteTrack,
    handleSaveAsPrefab, handleUpdatePrefab, handleMovePrefab, handleMoveScript,
    handleRemovePrefab, handleCreateScript, handleRemoveScript, handleRenameScript, handleSaveScript,
    handleSetScriptOrigin,
    handleDetachPrefab, handleRevertToPrefab, handleApplyToPrefab,
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
    setSchemaWarning,
    setScreen,
    setMediaAssets,
    mediaAssets,
    getPlaybackTime,
  });
 
  // Populate reconcileAssetUrlRef (see its declaration above): re-point
  // any entity/component whose src still matches a stale blob: URL at
  // the fresh on-disk URL, the moment an asset finishes saving to disk —
  // not just on the next project reload, since by then the original blob
  // URL has already been revoked and is unrecoverable. This is what
  // actually fixes recorded clips losing their audio after a reload.
  useEffect(() => {
    reconcileAssetUrlRef.current = (oldUrl, newUrl) => {
      if (!oldUrl || !newUrl || oldUrl === newUrl) return;
      setEntities((prev) => prev.map((e) => {
        let changed = false;
        const nextEntity = { ...e };
        if (e.src === oldUrl) {
          nextEntity.src = newUrl;
          changed = true;
        }
        const comps = e.components;
        if (comps && comps.some((c) => (c.type === 'VideoRenderer' || c.type === 'AudioSource') && c.src === oldUrl)) {
          nextEntity.components = comps.map((c) =>
            (c.type === 'VideoRenderer' || c.type === 'AudioSource') && c.src === oldUrl
              ? { ...c, src: newUrl }
              : c
          );
          changed = true;
        }
        return changed ? nextEntity : e;
      }));
    };
  }, [setEntities]);
 
  const {
    recordingTrackId,
    recordingStartTime,
    recordingLevel,
    handleToggleRecordTrack,
    handleAudioSettingsChanged,
  } = useAudioRecording({
    playbackStoreRef,
    getPlaybackTime,
    mediaAssets,
    handleAddMediaAsset,
    handleAddMediaToTimeline,
  });
 
  const handleOpenScriptEditor = (script) => {
    setEditingScript(script);
    setIsScriptEditorOpen(true);
  };
 
  const handleOpenSilenceRemover = useCallback((clipId) => {
    setSilenceTarget({ type: 'clip', id: clipId });
    openOrFocusPanel('silenceRemover', 'Silence Remover');
  }, [openOrFocusPanel]);
 
  const handleOpenSilenceRemoverForTrack = useCallback((trackId) => {
    setSilenceTarget({ type: 'track', id: trackId });
    openOrFocusPanel('silenceRemover', 'Silence Remover');
  }, [openOrFocusPanel]);
 
  // Project explorer renames (Project panel context menu). Media/prefab
  // renames are in-memory record renames; scripts rename the record too
  // (the on-disk file follows on the next editor save of that script).
  const handleRenameMediaAsset = useCallback((assetId, name) => {
    setMediaAssets((prev) => prev.map((m) => (m.id === assetId ? { ...m, name } : m)));
  }, [setMediaAssets]);
  const handleRenamePrefab = useCallback((prefabId, name) => {
    setPrefabs((prev) => prev.map((p) => (p.id === prefabId ? { ...p, name } : p)));
  }, [setPrefabs]);
 
  const {
    handleSharePrefab,
    handleShareScript,
    handleShareMedia,
    handleRemoveSharedItem,
    handleMoveSharedItem,
    handleImportSharedItem,
    handleUpdateScriptFromLibrary,
    handleExportSharedLibrary,
    handleImportSharedLibrary,
  } = useSharedLibraryActions({
    sharedLibrary,
    scripts,
    prefabs,
    setPrefabs,
    handleCreateScript,
    handleSaveScript,
    handleSetScriptOrigin,
    onOpenScriptEditor: handleOpenScriptEditor,
    onAddMediaAsset: handleAddMediaAsset,
  });
 
  const {
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
  } = usePrefabEditing({
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
  });
 
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
    // Always keep at least 5 minutes (300s) of timeline visible so users can
    // place clips well past the current content end, then grow as needed —
    // + 60s trailing buffer ensures there's always scrollable empty space
    // beyond the last clip (was +5s, which made it impossible to drag/drop
    // into empty space near the right edge).
    if (entities.length === 0) return 300;
    const maxEnd = Math.max(...entities.map((e) => e.startTime + e.duration));
    return Math.max(300, Math.ceil(maxEnd + 60));
  }, [entities]);
 
  const activeEntities = isPrefabMode ? prefabEntities : entities;
 
  // Handlers for <EditorPlaybackShortcuts> — see
  // hooks/useEditorPlaybackHandlers.js for the isPrefabMode branching
  // each of these needs.
  const editorPlaybackHandlers = useEditorPlaybackHandlers({
    isPrefabMode,
    prefabEntityActions,
    selectedIds,
    selectedEntityId,
    setSelectedIds,
    setSelectedEntityId,
    activeEntities,
    handleSplitEntity,
    handleDeleteEntity,
    handleRippleTrimToPlayhead,
    handleDuplicateClips,
    handleCopyClips,
    handlePasteClips,
    setSnappingEnabled,
  });
 
  const activeDuration = useMemo(() => {
    if (isPrefabMode) {
      if (prefabEntities.length === 0) return 0;
      const maxEnd = Math.max(...prefabEntities.map((e) => (e.startTime || 0) + (e.duration || 0)));
      return Math.max(10, Math.ceil(maxEnd + 2));
    }
    // For playback purposes, 0 on an empty project keeps the play() guard
    // in useTimelinePlayback working (it refuses to start if duration <= 0).
    // The timeline display width (calculatedDuration) uses 300s minimum
    // separately so the ruler always shows scrollable space.
    if (entities.length === 0) return 0;
    return calculatedDuration;
  }, [isPrefabMode, prefabEntities, calculatedDuration, entities]);
 
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
 
  // Autosave — decides WHEN to write projectState to disk (debounce on real
  // document changes, flush on blur/close, honoring Settings > Autosave).
  // Must come after projectState; the save itself runs through requestSave.
  useProjectAutosave({
    projectFolderHandle,
    projectState,
    requestSave,
    setSaveStatus,
    settings: autosaveSettings,
  });
 
  // Global keyboard shortcuts live in EditorPlaybackShortcuts (inside
  // PlaybackProvider) so App never re-renders on every playback frame.
 
  // Menu bar configuration — Unity-style top menus (File/Edit/View/Window).
  // See hooks/useMenuBarConfig.js for the actual menu item definitions.
  const menuBarConfig = useMenuBarConfig({
    keybinds,
    isPrefabMode,
    selectedEntityId,
    projectFolderHandle,
    canUndo,
    canRedo,
    undo,
    redo,
    handleSplitEntity,
    handleDeleteEntity,
    handleAddTransitionClip,
    prefabEntityActions,
    handleOpenProjectFolder,
    handleSaveProjectToDisk,
    handleSaveCurrentPrefab,
    handleOpenSilenceRemover,
    openOrFocusPanel,
    addNewPanelInstance,
    popoutActivePanel,
    floatActivePanel,
    handleResetLayout,
    setIsNewProjectOpen,
    setIsExportOpen,
    setIsProjectJsonOpen,
    setIsScriptDocsOpen,
    setIsSettingsOpen,
    onOpenPackageManager: handleOpenPackageManager,
  });
 
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
     <PlaybackProvider totalDuration={activeDuration}>
      <PlaybackStoreBridge storeRef={playbackStoreRef} />
      {/* Hot timeline zoom state lives in its own provider so a wheel-zoom
          tick no longer re-renders App / rebuilds the EditorContext value
          (and therefore no longer re-renders the unrelated dock panels). */}
      <TimelineViewProvider>
      <EditorPlaybackShortcuts
        entities={activeEntities}
        selectedEntityId={selectedEntityId}
        selectedIds={selectedIds}
        {...editorPlaybackHandlers}
        onSaveProject={isPrefabMode ? handleSaveCurrentPrefab : handleSaveProjectToDisk}
        onUndo={undo}
        onRedo={redo}
        onSetExportRange={setExportRange}
        exportRange={exportRange}
        totalDuration={activeDuration}
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
        totalDuration={activeDuration}
        snappingEnabled={snappingEnabled}
        hasSelectedEntity={!!selectedEntityId}
        projectFolderHandle={projectFolderHandle}
        saveStatus={isPrefabMode ? (isPrefabSaved ? 'saved' : 'in-memory') : saveStatus}
        schemaWarning={schemaWarning}
        canUndo={canUndo}
        canRedo={canRedo}
        onSetSnappingEnabled={setSnappingEnabled}
        onSplitSelected={() => selectedEntityId && (isPrefabMode ? prefabEntityActions.handleSplitEntity(selectedEntityId) : handleSplitEntity(selectedEntityId))}
        onDeleteSelected={() => selectedEntityId && (isPrefabMode ? prefabEntityActions.handleDeleteEntity(selectedEntityId) : handleDeleteEntity(selectedEntityId))}
        onUndo={undo}
        onRedo={redo}
        onOpenProjectJson={() => setIsProjectJsonOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onNewProject={() => setIsNewProjectOpen(true)}
        onOpenProjectFolder={handleOpenProjectFolder}
        onSaveProjectToDisk={isPrefabMode ? handleSaveCurrentPrefab : handleSaveProjectToDisk}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onGoToHub={() => setScreen('hub')}
      />
 
      {/* Unity-style dockable workspace: every panel below (Project,
          Preview, Inspector, Timeline) can be dragged to any edge,
          split, or merged into tabs, same as Unity's editor windows.
          Panels read their props from EditorContext instead of being
          passed props directly, since dockview owns their mounting. */}
      <EditorContext.Provider
        value={{
          // data
          entities: activeEntities,
          tracks, scripts, prefabs, mediaAssets,
          projectFolderHandle,
          calculatedDuration: activeDuration,
          selectedEntityId, snappingEnabled, resolution,
          fps: projectState.fps,
          autoKeyEnabled,
          // Global editor preferences (services/editorSettings.js) — the
          // timeline reads zoomAnchorMode from here (via the Timeline dock
          // panel) and the Settings modal edits it.
          editorSettings,
          isPrefabMode,
          editingPrefab,
          isPrefabSaved,
          isPrefabSynced,
          // setters
          setSelectedEntityId,
          setAutoKeyEnabled,
          setSnappingEnabled,
          // handlers
          undo, redo, canUndo, canRedo,
          handleUpdateEntity: isPrefabMode ? prefabEntityActions.handleUpdateEntity : handleUpdateEntity,
          handleUpdateClips: isPrefabMode ? prefabEntityActions.handleUpdateClips : handleUpdateClips,
          handleDuplicateClips: isPrefabMode ? prefabEntityActions.handleDuplicateClips : handleDuplicateClips,
          // Copy / Cut / Paste for the Timeline right-click menus. These are
          // the SAME handlers the Ctrl+C / Ctrl+X / Ctrl+V shortcuts use
          // (they already handle prefab mode, multi-selection, children and
          // paste-at-playhead), so the menu and the keyboard can never drift.
          onCopySelected: editorPlaybackHandlers.onCopySelected,
          onCutSelected: editorPlaybackHandlers.onCutSelected,
          onPasteClips: editorPlaybackHandlers.onPasteClips,
          handleDeleteEntity: isPrefabMode ? prefabEntityActions.handleDeleteEntity : handleDeleteEntity,
          handleSplitEntity: isPrefabMode ? prefabEntityActions.handleSplitEntity : handleSplitEntity,
          handleSaveAsPrefab,
          handleUpdateTrack, handleDeleteTrack, handleAddTrack,
          handleAddEmptyClip: isPrefabMode ? prefabEntityActions.handleAddEmptyClip : handleAddEmptyClip,
          handleAddTransitionClip: isPrefabMode ? prefabEntityActions.handleAddTransitionClip : handleAddTransitionClip,
          handleDropItemOnTrack: isPrefabMode ? prefabEntityActions.handleDropItemOnTrack : handleDropItemOnTrack,
          handleAttachScriptToEntity: isPrefabMode ? prefabEntityActions.handleAttachScriptToEntity : handleAttachScriptToEntity,
          onEnterPrefabMode: handleEnterPrefabMode,
          onExitPrefabMode: handleExitPrefabMode,
          onSaveCurrentPrefab: handleSaveCurrentPrefab,
          onSyncPrefabToSceneInstances: handleSyncPrefabToSceneInstances,
          onDetachPrefab: handleDetachPrefab,
          onRevertToPrefab: handleRevertToPrefab,
          onApplyToPrefab: handleApplyToPrefab,
          selectedKeyId, setSelectedKeyId,
          selectedIds, setSelectedIds,
          recordingTrackId,
          recordingStartTime,
          recordingLevel,
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
          onAddPrefabToTimeline: isPrefabMode ? prefabEntityActions.handleAddPrefabToTimeline : handleAddPrefabToTimeline,
          onAddMediaToTimeline: isPrefabMode ? prefabEntityActions.handleAddMediaToTimeline : handleAddMediaToTimeline,
          handleSplitVideoAndAudio: isPrefabMode ? prefabEntityActions.handleSplitVideoAndAudio : handleSplitVideoAndAudio,
          onSplitVideoAndAudio: isPrefabMode ? prefabEntityActions.handleSplitVideoAndAudio : handleSplitVideoAndAudio,
          onOpenSilenceRemover: handleOpenSilenceRemover,
          onOpenSilenceRemoverForTrack: handleOpenSilenceRemoverForTrack,
          handleCutSilence: isPrefabMode ? prefabEntityActions.handleCutSilence : handleCutSilence,
          silenceTarget,
          setSilenceTarget,
          silencePreviewData,
          setSilencePreviewCuts: setSilencePreviewData,
          // App-wide Shared Library (project-panel "shared" folder)
          sharedLibraryItems: sharedLibrary.items,
          onSharePrefab: handleSharePrefab,
          onShareScript: handleShareScript,
          onShareMedia: handleShareMedia,
          onRemoveSharedItem: handleRemoveSharedItem,
          onMoveSharedItem: handleMoveSharedItem,
          onImportSharedItem: handleImportSharedItem,
          onUpdateScriptFromLibrary: handleUpdateScriptFromLibrary,
          onExportSharedLibrary: handleExportSharedLibrary,
          onImportSharedLibrary: handleImportSharedLibrary,
          exportRange, setExportRange,
          setDockApi,
          setResetLayout,
          focusDockPanel,
          onOpenPackageManager: handleOpenPackageManager,
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
 
      <ScriptDocsModal
        isOpen={isScriptDocsOpen}
        onClose={() => setIsScriptDocsOpen(false)}
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
        mediaAssets={mediaAssets}
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
        resolution={resolution}
        onResolutionChange={setResolution}
        autosaveSettings={autosaveSettings}
        onAutosaveSettingsChange={updateAutosaveSettings}
        editorSettings={editorSettings}
        onEditorSettingsChange={updateEditorSettings}
        exportSettings={exportSettings}
        onExportSettingsChange={updateExportSettings}
        themeSettings={themeSettings}
        onThemeSettingsChange={updateThemeSettings}
      />

      <PackageManagerModal
        isOpen={isPackageManagerOpen}
        onClose={() => setIsPackageManagerOpen(false)}
        initialCategory={packageManagerCategory}
        onCreateScript={handleCreateScript}
        onOpenScriptEditor={(script) => {
          setEditingScript(script);
          setIsScriptEditorOpen(true);
        }}
      />
    </div>
      </TimelineViewProvider>
    </PlaybackProvider>
    </ErrorBoundary>
  );
}
 
export default App;