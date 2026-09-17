 
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useProjectStore } from './hooks/useProjectStore';
import { useEntityActions } from './hooks/useEntityActions';
import { usePlaybackController } from './hooks/usePlaybackController';
import { useMediaAssets } from './hooks/useMediaAssets';
import { useSharedLibrary } from './hooks/useSharedLibrary';
import { MenuBar } from './components/MenuBar';
import { FilePlus, FolderOpen, Save, Download, Undo2, Redo2, Scissors, Trash2, Code, MousePointer2, Settings, Sliders, PlaySquare, Clock, Layers, Activity, Copy, ExternalLink, Maximize2, RotateCcw, BookOpen } from 'lucide-react';
import { ProjectJsonModal } from './components/ProjectJsonModal';
import { ScriptEditorModal } from './components/ScriptEditorModal';
import { ScriptDocsModal } from './components/ScriptDocsModal';
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
import { loadKeybindSettings } from './services/keybindSettings';
import { saveProjectToDirectory } from './services/projectFileSystem';
import { precompileAllProjectScripts } from './engine/scriptRunner';
import { isScriptComponent, syncPrefabInstances } from './engine/ecs';
import { isTauri } from './services/tauriFsAdapter';
import { importMediaFiles } from './services/mediaImport';
import { openProjectInExplorer, openProjectInVsCode, openProjectInCursor } from './services/ideLauncher';
import { WindowControls } from './components/WindowControls';
import { toggleWindowMaximize } from './services/windowChrome';
import { ErrorBoundary } from './components/ErrorBoundary';
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
 
  const resetLayoutRef = useRef(null);
  const setResetLayout = useCallback((fn) => { resetLayoutRef.current = fn; }, []);
  const handleResetLayout = useCallback(() => {
    resetLayoutRef.current?.();
  }, []);
 
  const openOrFocusPanel = useCallback((componentName, defaultTitle) => {
    const api = dockApiRef.current;
    if (!api) return;
    const existing = api.panels.find((p) => p.component === componentName);
    if (existing) {
      existing.api.setActive();
    } else {
      const refPanel = api.panels[0];
      api.addPanel({
        id: `${componentName}-${Date.now()}`,
        component: componentName,
        title: defaultTitle,
        position: refPanel ? { direction: 'within', referencePanel: refPanel } : undefined,
      });
    }
  }, []);
 
  const addNewPanelInstance = useCallback((componentName, defaultTitle) => {
    const api = dockApiRef.current;
    if (!api) return;
    const count = api.panels.filter((p) => p.component === componentName).length;
    const title = count > 0 ? `${defaultTitle} (${count + 1})` : defaultTitle;
    const refPanel = api.panels.find((p) => p.component === componentName) || api.panels[0];
    api.addPanel({
      id: `${componentName}-${Date.now()}`,
      component: componentName,
      title,
      position: refPanel ? { direction: 'within', referencePanel: refPanel } : undefined,
    });
  }, []);
 
  const popoutActivePanel = useCallback(() => {
    const api = dockApiRef.current;
    if (!api) return;
    const panel = api.activePanel || api.panels[0];
    if (panel) {
      api.addPopoutGroup(panel.group);
    }
  }, []);
 
  const floatActivePanel = useCallback(() => {
    const api = dockApiRef.current;
    if (!api) return;
    const panel = api.activePanel || api.panels[0];
    if (panel) {
      api.addFloatingGroup(panel.group);
    }
  }, []);
 
  // Global hotkeys for Popout (Alt+P) and Float (Alt+F)
  useEffect(() => {
    const handleKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) {
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        popoutActivePanel();
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        floatActivePanel();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [popoutActivePanel, floatActivePanel]);
 
  /** Focus an existing dock panel by id, or add it as a new tab next to
   *  the dopesheet if it doesn't exist yet. Pass { onlyIfOpen: true } for
   *  callers that want to activate the tab only when it's already present
   *  (e.g. selecting a keyframe shouldn't force-open the Curves tab for
   *  someone who closed it — it should just switch to it if it's there). */
  const focusDockPanel = useCallback((panelId, opts) => {
    const api = dockApiRef.current;
    if (!api) return;
    const existing = api.getPanel(panelId);
    if (existing) {
      existing.api.setActive();
    } else if (!opts?.onlyIfOpen) {
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
    setPixelsPerSecond(prev => Math.max(prev - 15, 4));
  };
 
  // Project Folder Handle & Disk Save State
  const [projectFolderHandle, setProjectFolderHandle] = useState(null);
  const [saveStatus, setSaveStatus] = useState('in-memory'); // 'saved' | 'saving' | 'in-memory'
  // P1 #6 — set when an opened project.json has a schemaVersion newer than
  // this build supports (see warnIfSchemaVersionTooNew in engine/ecs.js).
  // Previously this only ever reached console.warn; now it's shown in
  // EditorHeader/UnityHeader next to the save-status badge.
  const [schemaWarning, setSchemaWarning] = useState(null);
  const isAutoSavingRef = useRef(false);
 
  // Modals
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isProjectJsonOpen, setIsProjectJsonOpen] = useState(false);
  const [isScriptEditorOpen, setIsScriptEditorOpen] = useState(false);
  const [editingScript, setEditingScript] = useState(null);
  const [isScriptDocsOpen, setIsScriptDocsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [silenceTarget, setSilenceTarget] = useState({ type: 'clip', id: null });
  const [silencePreviewData, setSilencePreviewData] = useState(null);
 
  // Voice Recording: which track (if any) is currently armed/recording,
  // and the selected input device (persisted via Settings modal).
  const [recordingTrackId, setRecordingTrackId] = useState(null);
  const [recordingStartTime, setRecordingStartTime] = useState(0);
  const [audioInputDeviceId, setAudioInputDeviceId] = useState(() => loadAudioSettings().inputDeviceId);
  const recordingStartTimeRef = useRef(0);
  // Re-entrancy guard for handleToggleRecordTrack's stop branch. pause()
  // notifies playbackStore subscribers synchronously, and the stop-on-
  // pause effect below reads recordingTrackId from its own closure, which
  // still holds the pre-stop value until React re-renders — so pause()
  // called from inside the stop branch was re-entering this same handler
  // a second time before the first stop had finished, producing a second
  // (bogus/empty) clip per single recording. This ref is set the instant
  // a stop begins and checked immediately, independent of React state.
  const isStoppingRecordingRef = useRef(false);
  const { startRecording, stopRecording, level: recordingLevel } = useAudioRecorder({ inputDeviceId: audioInputDeviceId });
 
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
    setEntities, setTracks, setPrefabs,
    undo, redo, canUndo, canRedo,
    handleUpdateEntity, handleUpdateClips, handleDuplicateClips,
    handleDeleteEntity, handleRippleTrimToPlayhead, handleSplitEntity,
    handleCutSilence,
    handleAddEmptyClip,
    handleAddPrefabToTimeline, handleAddMediaToTimeline,
    handleSplitVideoAndAudio,
    handleDropItemOnTrack, handleAttachScriptToEntity,
    handleAddTrack, handleUpdateTrack, handleDeleteTrack,
    handleSaveAsPrefab, handleUpdatePrefab, handleMovePrefab, handleMoveScript,
    handleRemovePrefab, handleCreateScript, handleRemoveScript, handleRenameScript, handleSaveScript,
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
 
  // Voice Recording — toggled from the per-track record button in
  // TrackHeader. Clicking record on a track arms that track (captures
  // from the Settings-selected input device); clicking again (or the
  // Square/stop icon) stops, saves the clip into Media > Recordings,
  // and drops it onto that same track at the time recording started.
   const handleToggleRecordTrack = useCallback(async (trackId) => {
    if (recordingTrackId === trackId) {
      // Stop & finalize this track's recording.
      // Bail immediately if a stop is already in flight for this track —
      // see isStoppingRecordingRef declaration for why this re-entrancy
      // guard is needed (pause() below can synchronously re-trigger this
      // same branch via the stop-on-pause effect before React has
      // re-rendered recordingTrackId to null).
      if (isStoppingRecordingRef.current) return;
      isStoppingRecordingRef.current = true;
      const startTime = recordingStartTimeRef.current;
      setRecordingTrackId(null);
      setRecordingStartTime(0);
      playbackStoreRef.current?.setIsRecording(false);
      playbackStoreRef.current?.pause();
      let result;
      try {
        result = await stopRecording();
      } finally {
        isStoppingRecordingRef.current = false;
      }
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
 
      // Use the FINAL resolved URL (disk URL once saved, see
      // handleAddMediaAsset's return value) for the clip we place on the
      // timeline — not asset.url, which stays a blob: URL forever since
      // handleAddMediaAsset never mutates the local `asset` object it
      // was passed, only its own internal mediaAssets state. Using
      // asset.url here was the actual cause of recorded clips losing
      // their audio after a reload.
      const finalUrl = await handleAddMediaAsset(asset, file);
      handleAddMediaToTimeline({ ...asset, url: finalUrl }, trackId, startTime);
      return;
    }
 
    if (recordingTrackId) return; // another track is already recording
 
    // Arm this track and start capturing at the current playhead position
    const startTime = getPlaybackTime();
    recordingStartTimeRef.current = startTime;
    setRecordingStartTime(startTime);
    setRecordingTrackId(trackId);
    await startRecording();
    playbackStoreRef.current?.setIsRecording(true);
    playbackStoreRef.current?.play();
  }, [recordingTrackId, getPlaybackTime, mediaAssets, startRecording, stopRecording, handleAddMediaAsset, handleAddMediaToTimeline]);
 
  // Synchronize playback stopping (spacebar / pause) with active recording.
  //
  // BUGFIX: play() is async — right after we call it in
  // handleToggleRecordTrack, the store can briefly still report
  // isPlaying() === false before playback actually engages. Without a
  // guard, that transient false was being treated as "the user stopped
  // playback", which auto-finalized the recording into a clip almost
  // immediately (near-empty blob), while the mic stream stayed open and a
  // *second* MediaRecorder session started on the next click — hence one
  // real recording turning into two clips (one silent/truncated). Fix:
  // only arm the stop-on-pause listener once we've observed isPlaying()
  // actually become true at least once for this recording session, so a
  // startup blip can't be mistaken for a real stop.
  const hasSeenPlaybackStartRef = useRef(false);
  useEffect(() => {
    if (!recordingTrackId) {
      hasSeenPlaybackStartRef.current = false;
      return;
    }
    const store = playbackStoreRef.current;
    if (!store) return;
    const unsub = store.subscribe(() => {
      const isPlaying = store.getIsPlaying();
      if (isPlaying) {
        hasSeenPlaybackStartRef.current = true;
        return;
      }
      if (hasSeenPlaybackStartRef.current && recordingTrackId) {
        handleToggleRecordTrack(recordingTrackId);
      }
    });
    return unsub;
  }, [recordingTrackId, handleToggleRecordTrack]);
 
  const handleAudioSettingsChanged = useCallback((settings) => {
    setAudioInputDeviceId(settings.inputDeviceId);
  }, []);
 
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
  const handleMoveSharedItem = useCallback(
    (id, folderName) => { sharedLibrary.moveItem(id, folderName); },
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
      if (Array.isArray(data.embeddedScripts)) {
        for (const scr of data.embeddedScripts) {
          const exists = (scripts || []).some((s) => s.name === scr.name || s.id === scr.id);
          if (!exists) {
            await handleCreateScript({
              id: scr.id || `script-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              name: scr.name,
              description: scr.description || `Imported with ${data.name}`,
              code: scr.code || '',
            });
          }
        }
      }
      setPrefabs((prev) => [
        ...prev,
        { ...JSON.parse(JSON.stringify(data)), id: `prefab-${Date.now()}` },
      ]);
    }
  }, [handleCreateScript, setPrefabs, scripts]);
 
  // ── Prefab Editing Mode State & Handlers ──────────────────────────────────
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
  }, [prefabs, tracks]);
 
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
  }, [editingPrefabId, isPrefabSaved, handleSaveCurrentPrefab]);
 
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
 
  const activeEntities = isPrefabMode ? prefabEntities : entities;
  const activeDuration = useMemo(() => {
    if (isPrefabMode) {
      if (prefabEntities.length === 0) return 0;
      const maxEnd = Math.max(...prefabEntities.map((e) => (e.startTime || 0) + (e.duration || 0)));
      return Math.max(10, Math.ceil(maxEnd + 2));
    }
    return calculatedDuration;
  }, [isPrefabMode, prefabEntities, calculatedDuration]);
 
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
        { label: isPrefabMode ? 'Save Prefab' : 'Save Project', shortcut: keybinds.saveProject, icon: <Save size={13} />, onClick: isPrefabMode ? handleSaveCurrentPrefab : handleSaveProjectToDisk, disabled: isPrefabMode ? false : !projectFolderHandle },
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
        { label: 'Undo', shortcut: keybinds.undo, icon: <Undo2 size={13} />, onClick: undo, disabled: !canUndo },
        { label: 'Redo', shortcut: keybinds.redo, icon: <Redo2 size={13} />, onClick: redo, disabled: !canRedo },
        { type: 'separator' },
        { label: 'Split Clip (Cut)', shortcut: keybinds.splitSelected, icon: <Scissors size={13} />, onClick: () => selectedEntityId && (isPrefabMode ? prefabEntityActions.handleSplitEntity(selectedEntityId) : handleSplitEntity(selectedEntityId)), disabled: !selectedEntityId },
        { label: 'Cut Silence...', icon: <Scissors size={13} />, onClick: () => handleOpenSilenceRemover(selectedEntityId), disabled: !selectedEntityId },
        { label: 'Delete Clip', shortcut: keybinds.deleteSelected, icon: <Trash2 size={13} />, onClick: () => selectedEntityId && (isPrefabMode ? prefabEntityActions.handleDeleteEntity(selectedEntityId) : handleDeleteEntity(selectedEntityId)), disabled: !selectedEntityId, danger: true },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Project Code', icon: <Code size={13} />, onClick: () => setIsProjectJsonOpen(true) },
        { label: 'Script API Docs', icon: <BookOpen size={13} />, onClick: () => setIsScriptDocsOpen(true) },
        { type: 'separator' },
        { label: 'Settings', icon: <Settings size={13} />, onClick: () => setIsSettingsOpen(true) },
      ],
    },
    {
      label: 'Window',
      items: [
        { label: 'Inspector', icon: <Sliders size={13} />, onClick: () => openOrFocusPanel('inspector', 'Inspector') },
        { label: 'Preview', icon: <PlaySquare size={13} />, onClick: () => openOrFocusPanel('preview', 'Preview') },
        { label: 'Project', icon: <FolderOpen size={13} />, onClick: () => openOrFocusPanel('project', 'Project') },
        { label: 'Timeline', icon: <Clock size={13} />, onClick: () => openOrFocusPanel('timeline', 'Timeline') },
        { label: 'Dopesheet', icon: <Layers size={13} />, onClick: () => openOrFocusPanel('dopesheet', 'Dopesheet') },
        { label: 'Curves', icon: <Activity size={13} />, onClick: () => openOrFocusPanel('curveEditor', 'Curves') },
        { label: 'Silence Remover', icon: <Scissors size={13} />, onClick: () => openOrFocusPanel('silenceRemover', 'Silence Remover') },
        { type: 'separator' },
        { label: 'New Inspector Tab', icon: <Copy size={13} />, onClick: () => addNewPanelInstance('inspector', 'Inspector') },
        { label: 'New Preview Tab', icon: <Copy size={13} />, onClick: () => addNewPanelInstance('preview', 'Preview') },
        { type: 'separator' },
        { label: 'Popout Active Window', shortcut: 'Alt+P', icon: <ExternalLink size={13} />, onClick: popoutActivePanel },
        { label: 'Float Active Window', shortcut: 'Alt+F', icon: <Maximize2 size={13} />, onClick: floatActivePanel },
        { type: 'separator' },
        { label: 'Reset Layout', icon: <RotateCcw size={13} />, onClick: handleResetLayout },
      ],
    },
  ], [
    canUndo, canRedo, undo, redo, selectedEntityId, keybinds,
    handleSplitEntity, handleOpenSilenceRemover, handleDeleteEntity, prefabEntityActions, handleOpenProjectFolder,
    handleSaveProjectToDisk, handleSaveCurrentPrefab,
    projectFolderHandle, isPrefabMode,
    openOrFocusPanel, addNewPanelInstance, popoutActivePanel, floatActivePanel, handleResetLayout,
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
     <PlaybackProvider totalDuration={activeDuration}>
      <PlaybackStoreBridge storeRef={playbackStoreRef} />
      <EditorPlaybackShortcuts
        entities={activeEntities}
        selectedEntityId={selectedEntityId}
        selectedIds={selectedIds}
        onSplitSelected={() => {
          const ids = selectedIds.length > 0 ? selectedIds : (selectedEntityId ? [selectedEntityId] : []);
          if (ids.length > 0) {
            if (isPrefabMode) prefabEntityActions.handleSplitEntity(ids);
            else handleSplitEntity(ids);
          }
        }}
        onDeleteSelected={() => {
          const idsToDelete = selectedIds.length > 0 ? selectedIds : (selectedEntityId ? [selectedEntityId] : []);
          if (idsToDelete.length > 0) {
            if (isPrefabMode) {
              prefabEntityActions.handleDeleteEntity(idsToDelete);
            } else {
              handleDeleteEntity(idsToDelete);
            }
            setSelectedIds([]);
            setSelectedEntityId(null);
          }
        }}
        onDeleteMultiple={() => {
          const idsToDelete = selectedIds.length > 0 ? selectedIds : (selectedEntityId ? [selectedEntityId] : []);
          if (idsToDelete.length > 0) {
            if (isPrefabMode) {
              prefabEntityActions.handleDeleteEntity(idsToDelete);
            } else {
              handleDeleteEntity(idsToDelete);
            }
            setSelectedIds([]);
            setSelectedEntityId(null);
          }
        }}
        onRippleDeleteBefore={(anchorId) => {
          if (isPrefabMode) prefabEntityActions.handleRippleTrimToPlayhead(anchorId, 'before');
          else handleRippleTrimToPlayhead(anchorId, 'before');
        }}
        onRippleDeleteAfter={(anchorId) => {
          if (isPrefabMode) prefabEntityActions.handleRippleTrimToPlayhead(anchorId, 'after');
          else handleRippleTrimToPlayhead(anchorId, 'after');
        }}
        onDuplicateSelected={() => {
          const ids = selectedIds.length > 0 ? selectedIds : (selectedEntityId ? [selectedEntityId] : []);
          if (ids.length > 0) {
            const handler = isPrefabMode ? prefabEntityActions.handleDuplicateClips : handleDuplicateClips;
            const newIds = handler(ids);
            if (newIds && newIds.length > 0) {
              setSelectedIds(newIds);
              setSelectedEntityId(newIds[0]);
            }
          }
        }}
        onSelectAll={() => {
          const allIds = activeEntities.map(e => e.id);
          setSelectedIds(allIds);
          setSelectedEntityId(allIds[0] || null);
        }}
        onClearSelection={() => {
          setSelectedIds([]);
          setSelectedEntityId(null);
        }}
        onSaveProject={isPrefabMode ? handleSaveCurrentPrefab : handleSaveProjectToDisk}
        onUndo={undo}
        onRedo={redo}
        onToggleSnapping={() => setSnappingEnabled((prev) => !prev)}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
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
        pixelsPerSecond={pixelsPerSecond}
        snappingEnabled={snappingEnabled}
        hasSelectedEntity={!!selectedEntityId}
        projectFolderHandle={projectFolderHandle}
        saveStatus={isPrefabMode ? (isPrefabSaved ? 'saved' : 'in-memory') : saveStatus}
        schemaWarning={schemaWarning}
        canUndo={canUndo}
        canRedo={canRedo}
        onSetPixelsPerSecond={setPixelsPerSecond}
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
          selectedEntityId, pixelsPerSecond, snappingEnabled, resolution,
          fps: projectState.fps,
          autoKeyEnabled,
          isPrefabMode,
          editingPrefab,
          isPrefabSaved,
          isPrefabSynced,
          // setters
          setSelectedEntityId,
          setAutoKeyEnabled,
          setPixelsPerSecond,
          setSnappingEnabled,
          // handlers
          undo, redo, canUndo, canRedo,
          handleUpdateEntity: isPrefabMode ? prefabEntityActions.handleUpdateEntity : handleUpdateEntity,
          handleUpdateClips: isPrefabMode ? prefabEntityActions.handleUpdateClips : handleUpdateClips,
          handleDuplicateClips: isPrefabMode ? prefabEntityActions.handleDuplicateClips : handleDuplicateClips,
          handleDeleteEntity: isPrefabMode ? prefabEntityActions.handleDeleteEntity : handleDeleteEntity,
          handleSplitEntity: isPrefabMode ? prefabEntityActions.handleSplitEntity : handleSplitEntity,
          handleSaveAsPrefab,
          handleUpdateTrack, handleDeleteTrack, handleAddTrack,
          handleAddEmptyClip: isPrefabMode ? prefabEntityActions.handleAddEmptyClip : handleAddEmptyClip,
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
          onRemoveSharedItem: handleRemoveSharedItem,
          onMoveSharedItem: handleMoveSharedItem,
          onImportSharedItem: handleImportSharedItem,
          onZoomIn: handleZoomIn,
          onZoomOut: handleZoomOut,
          exportRange, setExportRange,
          setDockApi,
          setResetLayout,
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
      />
    </div>
    </PlaybackProvider>
    </ErrorBoundary>
  );
}
 
export default App;