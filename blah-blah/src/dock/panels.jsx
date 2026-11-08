import { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ProjectPanel } from '../components/ProjectPanel';
import { EntityRenderer } from '../components/entity/EntityRenderer';
import { UnityInspector } from '../components/UnityInspector';
import { MultiInspector } from '../components/inspector/MultiInspector';
import { Timeline } from '../components/Timeline/Timeline';
import { PrefabModeBar } from '../components/Timeline/PrefabModeBar';
import { Dopesheet } from '../components/Dopesheet/Dopesheet';
import { CurveEditorTab } from '../components/shared/CurveEditor';
import { SilenceRemoverPanel } from '../components/silence-remover/SilenceRemoverPanel';
import { MixerPanel } from '../components/mixer/MixerPanel';
import { ConsolePanel } from '../components/shared/ConsolePanel';
import { setKeyframeCurve, findKeyframeById, DEFAULT_CP1, DEFAULT_CP2 } from '../engine/keyframes';
import { useEditorActions } from './EditorContext';
import { useEditorSelector, useEditorStore } from '../hooks/editorStore';
import { useRecordingLevel } from '../hooks/recordingLevel';
import { useSilencePreview } from '../hooks/silencePreview';
import { useTimelineView } from './TimelineViewContext';
import { useCurrentTime, useThrottledCurrentTime, useIsPlaying, useIsLooping, usePlaybackStore } from '../hooks/PlaybackContext';
 
export const ProjectDockPanel = memo(function ProjectDockPanel() {
  // Selector-based (see hooks/editorStore.js): this panel only shows the
  // project's assets, prefabs, scripts and shared library, so a clip edit, a
  // selection change or a recording tick no longer re-renders it.
  const mediaAssets = useEditorSelector((s) => s.mediaAssets);
  const prefabs = useEditorSelector((s) => s.prefabs);
  const scripts = useEditorSelector((s) => s.scripts);
  const projectFolderHandle = useEditorSelector((s) => s.projectFolderHandle);
  const sharedLibraryItems = useEditorSelector((s) => s.sharedLibraryItems);
  const {
    onSharePrefab, onShareScript, onShareMedia, onRemoveSharedItem, onMoveSharedItem, onImportSharedItem,
    onUpdateScriptFromLibrary, onExportSharedLibrary, onImportSharedLibrary,
    onAddMediaAsset, onRemoveMediaAsset, onRemovePrefab, onRemoveScript,
    onRenameMediaAsset, onRenamePrefab, onRenameScript,
    onCreateScript, onOpenScriptEditor,
    onAddPrefabToTimeline, onAddMediaToTimeline,
    onMoveMediaAsset, onReplaceMediaAsset, onMovePrefab, onMoveScript,
    handleAddEmptyClip,
    onEnterPrefabMode,
  } = useEditorActions();
 
  return (
    <ProjectPanel
      mediaAssets={mediaAssets}
      prefabs={prefabs}
      scripts={scripts}
      projectFolderHandle={projectFolderHandle}
      sharedItems={sharedLibraryItems}
      onRemoveSharedItem={onRemoveSharedItem}
      onMoveSharedItem={onMoveSharedItem}
      onSharePrefab={onSharePrefab}
      onShareScript={onShareScript}
      onShareMedia={onShareMedia}
      onImportSharedItem={onImportSharedItem}
      onUpdateScriptFromLibrary={onUpdateScriptFromLibrary}
      onExportSharedLibrary={onExportSharedLibrary}
      onImportSharedLibrary={onImportSharedLibrary}
      onAddMediaAsset={onAddMediaAsset}
      onRemoveMediaAsset={onRemoveMediaAsset}
      onRemovePrefab={onRemovePrefab}
      onRemoveScript={onRemoveScript}
      onRenameMediaAsset={onRenameMediaAsset}
      onRenamePrefab={onRenamePrefab}
      onRenameScript={onRenameScript}
      onCreateScript={onCreateScript}
      onOpenScriptEditor={onOpenScriptEditor}
      onAddPrefabToTimeline={onAddPrefabToTimeline}
      onAddMediaToTimeline={onAddMediaToTimeline}
      onMoveMediaAsset={onMoveMediaAsset}
      onReplaceMediaAsset={onReplaceMediaAsset}
      onMovePrefab={onMovePrefab}
      onMoveScript={onMoveScript}
      onAddEmptyClip={handleAddEmptyClip}
      onEnterPrefabMode={onEnterPrefabMode}
    />
  );
});
 
export const PreviewDockPanel = memo(function PreviewDockPanel() {
  // The preview renders every clip, so it does need `entities`/`tracks` — but
  // no longer the export range, the silence preview, the recording state or
  // any of the other editor fields it never read.
  const entities = useEditorSelector((s) => s.entities);
  const tracks = useEditorSelector((s) => s.tracks);
  const scripts = useEditorSelector((s) => s.scripts);
  const calculatedDuration = useEditorSelector((s) => s.calculatedDuration);
  const selectedEntityId = useEditorSelector((s) => s.selectedEntityId);
  const resolution = useEditorSelector((s) => s.resolution);
  const fps = useEditorSelector((s) => s.fps) ?? 30;
  const mediaAssets = useEditorSelector((s) => s.mediaAssets);
  const autoKeyEnabled = useEditorSelector((s) => s.autoKeyEnabled);
  const { setSelectedEntityId, handleUpdateEntity } = useEditorActions();
 
  const currentTime = useCurrentTime();
  const isPlaying = useIsPlaying();
  const isLooping = useIsLooping();
  const store = usePlaybackStore();
  // Stable references (store is a singleton) so the preview's props don't
  // change identity on every render. Wrapped, not passed as store.method, because
  // the store's methods rely on `this`.
  const handleTogglePlay = useCallback(() => store.togglePlay(), [store]);
  const handleSeek = useCallback((t) => store.seek(t), [store]);
  const handleToggleLoop = useCallback(() => store.toggleLoop(), [store]);

  return (
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
      onUpdateEntity={handleUpdateEntity}
      onTogglePlay={handleTogglePlay}
      onSeek={handleSeek}
      onToggleLoop={handleToggleLoop}
      resolution={resolution}
      fps={fps}
      mediaAssets={mediaAssets}
      autoKeyEnabled={autoKeyEnabled}
    />
  );
});
 
export const InspectorDockPanel = memo(function InspectorDockPanel() {
  // `entities` is still needed here (UnityInspector/MultiInspector take the
  // whole list), so a clip edit still re-renders this panel — but the derived
  // selected entity below is a selector, and the recording level, silence
  // preview and export range no longer reach it at all.
  const entities = useEditorSelector((s) => s.entities);
  const selectedEntityId = useEditorSelector((s) => s.selectedEntityId);
  const selectedIds = useEditorSelector((s) => s.selectedIds);
  const tracks = useEditorSelector((s) => s.tracks);
  const scripts = useEditorSelector((s) => s.scripts);
  const prefabs = useEditorSelector((s) => s.prefabs);
  const mediaAssets = useEditorSelector((s) => s.mediaAssets);
  const resolution = useEditorSelector((s) => s.resolution);
  const fps = useEditorSelector((s) => s.fps) ?? 30;
  const autoKeyEnabled = useEditorSelector((s) => s.autoKeyEnabled);
  const {
    setSelectedIds, setSelectedEntityId,
    handleUpdateEntity, handleUpdateClips, handleDeleteEntity,
    onOpenScriptEditor, handleSaveAsPrefab,
    handleAttachScriptToEntity,
    setAutoKeyEnabled,
    onEnterPrefabMode,
    onDetachPrefab,
    onRevertToPrefab,
    onApplyToPrefab,
    onOpenPackageManager,
  } = useEditorActions();

  const [isLocked, setIsLocked] = useState(false);
  const [lockedEntityId, setLockedEntityId] = useState(null);
 
  // If locked entity was deleted, fall back to unlocked
  const activeEntityId = (isLocked && lockedEntityId && entities.some(e => e.id === lockedEntityId))
    ? lockedEntityId
    : selectedEntityId;
 
  const handleToggleLock = useCallback(() => {
    setIsLocked((prev) => {
      if (!prev) {
        if (selectedEntityId) {
          setLockedEntityId(selectedEntityId);
          return true;
        }
        return false;
      }
      setLockedEntityId(null);
      return false;
    });
  }, [selectedEntityId]);
 
  // Display-only: the Inspector is the heaviest panel, so cap it while playing.
  const currentTime = useThrottledCurrentTime(10);
  // Derived by selector: the result only changes identity when THAT entity's
  // object changes (structural sharing in the undo history keeps the others).
  const selectedEntity = useEditorSelector(
    (s) => (s.entities || []).find((e) => e.id === activeEntityId) || null
  );
 
  // Multi-select: 2+ existing clips selected on the timeline (and the
  // Inspector isn't pinned to one entity via the lock) -> shared editing.
  // Stale ids (deleted clips) are filtered out so a delete can't leave the
  // panel showing a phantom selection.
  const handleDeleteMany = useCallback((ids) => {
    handleDeleteEntity(ids);
    setSelectedIds([]);
    setSelectedEntityId(null);
  }, [handleDeleteEntity, setSelectedIds, setSelectedEntityId]);
 
  const multiEntities = useMemo(() => {
    if (isLocked || !selectedIds || selectedIds.length < 2) return [];
    const idSet = new Set(selectedIds);
    return entities.filter((e) => idSet.has(e.id));
  }, [isLocked, selectedIds, entities]);
 
  if (multiEntities.length >= 2) {
    return (
      <div className="dock-panel-root">
        <MultiInspector
          selectedEntities={multiEntities}
          entities={entities}
          tracks={tracks}
          scripts={scripts}
          mediaAssets={mediaAssets}
          onUpdateClips={handleUpdateClips}
          onDeleteEntities={handleDeleteMany}
          currentTime={currentTime}
          autoKeyEnabled={autoKeyEnabled}
          setAutoKeyEnabled={setAutoKeyEnabled}
        />
      </div>
    );
  }
 
  return (
    <div className="dock-panel-root">
      <UnityInspector
        selectedEntity={selectedEntity}
        entities={entities}
        tracks={tracks}
        scripts={scripts}
        prefabs={prefabs}
        onUpdateEntity={handleUpdateEntity}
        onDeleteEntity={handleDeleteEntity}
        onOpenScriptEditor={onOpenScriptEditor}
        onSaveAsPrefab={handleSaveAsPrefab}
        onAttachScriptToEntity={handleAttachScriptToEntity}
        onEnterPrefabMode={onEnterPrefabMode}
        onDetachPrefab={onDetachPrefab}
        onRevertToPrefab={onRevertToPrefab}
        onApplyToPrefab={onApplyToPrefab}
        currentTime={currentTime}
        autoKeyEnabled={autoKeyEnabled}
        setAutoKeyEnabled={setAutoKeyEnabled}
        mediaAssets={mediaAssets}
        resolution={resolution}
        fps={fps}
        isLocked={isLocked}
        onToggleLock={handleToggleLock}
        onOpenPackageManager={onOpenPackageManager}
      />
    </div>
  );
});
 
export const TimelineDockPanel = memo(function TimelineDockPanel() {
  const tracks = useEditorSelector((s) => s.tracks);
  const entities = useEditorSelector((s) => s.entities);
  const mediaAssets = useEditorSelector((s) => s.mediaAssets);
  const calculatedDuration = useEditorSelector((s) => s.calculatedDuration);
  // Global editor preferences: the timeline's canvas renderer toggle lives
  // in services/editorSettings.js and is exposed here via the settings modal
  // (Settings -> System -> Timeline rendering).
  const editorSettings = useEditorSelector((s) => s.editorSettings);
  const selectedEntityId = useEditorSelector((s) => s.selectedEntityId);
  const snappingEnabled = useEditorSelector((s) => s.snappingEnabled);
  const selectedIds = useEditorSelector((s) => s.selectedIds);
  const recordingTrackId = useEditorSelector((s) => s.recordingTrackId);
  const recordingStartTime = useEditorSelector((s) => s.recordingStartTime);
  const exportRange = useEditorSelector((s) => s.exportRange);
  const isPrefabMode = useEditorSelector((s) => s.isPrefabMode);
  const editingPrefab = useEditorSelector((s) => s.editingPrefab);
  const isPrefabSaved = useEditorSelector((s) => s.isPrefabSaved);
  const isPrefabSynced = useEditorSelector((s) => s.isPrefabSynced);
  // Hot values, each in its own tiny store: a mic-level tick or a silence
  // preview update re-renders only this panel, never the whole dock.
  const recordingLevel = useRecordingLevel();
  const silencePreviewData = useSilencePreview();
  const {
    setSelectedEntityId, setSelectedIds,
    handleUpdateEntity, handleUpdateClips, handleDuplicateClips, handleDeleteEntity,
    onCopySelected, onCutSelected, onPasteClips,
    handleUpdateTrack, handleDeleteTrack,
    handleAddTrack, handleAddEmptyClip, handleAddTransitionClip,
    handleDropItemOnTrack, handleAttachScriptToEntity,
    onAddMediaAsset,
    onToggleRecordTrack,
    setExportRange,
    onSplitVideoAndAudio,
    onOpenSilenceRemover,
    onOpenSilenceRemoverForTrack,
    onExitPrefabMode,
    onSaveCurrentPrefab,
    onSyncPrefabToSceneInstances,
  } = useEditorActions();

  const store = usePlaybackStore();
  // Stable so the memo'd Timeline / TimeRuler / PlayheadHandle / PlayheadLine
  // are not re-rendered just because this panel re-rendered.
  const handleSeek = useCallback((t) => store.seek(t), [store]);
  // Hot zoom state comes from its own narrow context (see
  // dock/TimelineViewContext.jsx) so zoom only re-renders the timeline,
  // not every EditorContext consumer.
  const { pixelsPerSecond, setPixelsPerSecond, zoomIn: onZoomIn, zoomOut: onZoomOut } = useTimelineView();

  const handleToggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      // Ctrl+click toggles membership. When nothing is in the multi-list
      // yet, the clip that is currently single-selected counts as the
      // first member — otherwise Ctrl+clicking a second clip produced a
      // one-element list and never became a real multi-selection.
      const base = prev.length === 0 && selectedEntityId ? [selectedEntityId] : prev;
      if (base.includes(id)) return base.filter((i) => i !== id);
      return [...base, id];
    });
  }, [setSelectedIds, selectedEntityId]);
 
  const handleRangeSelect = useCallback((endId) => {
    if (!selectedEntityId || selectedEntityId === endId) return;
    const startIdx = entities.findIndex((e) => e.id === selectedEntityId);
    const endIdx = entities.findIndex((e) => e.id === endId);
    if (startIdx < 0 || endIdx < 0) return;
    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);
    const rangeIds = entities.slice(min, max + 1).map((e) => e.id);
    setSelectedIds((prev) => [...new Set([...prev, ...rangeIds])]);
  }, [selectedEntityId, entities, setSelectedIds]);
 
  const handleClearSelection = useCallback(() => {
    setSelectedIds([]);
  }, [setSelectedIds]);
 
  // A plain (non-modifier) click selects ONE clip. ClipItem only calls
  // onSelectClip for that case (Ctrl/Shift go through onToggleSelect /
  // onRangeSelect), but it never told the multi-selection to reset — so a
  // stale selectedIds list survived and the Inspector kept showing the old
  // multi-selection. Keep clicks inside the current multi-selection alone
  // (e.g. starting a drag on one of several selected clips).
  const handleSelectClip = useCallback((id) => {
    setSelectedEntityId(id);
    setSelectedIds((prev) => (id && prev.includes(id) ? prev : []));
  }, [setSelectedEntityId, setSelectedIds]);
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }}>
      {isPrefabMode && (
        <PrefabModeBar
          prefab={editingPrefab}
          onExit={onExitPrefabMode}
          onSave={onSaveCurrentPrefab}
          onSyncToScene={onSyncPrefabToSceneInstances}
          isSaved={isPrefabSaved}
          isSynced={isPrefabSynced}
        />
      )}
      <Timeline
        tracks={tracks}
        clips={entities}
        mediaAssets={mediaAssets}
        totalDuration={calculatedDuration}
        pixelsPerSecond={pixelsPerSecond}
        selectedClipId={selectedEntityId}
        snappingEnabled={snappingEnabled}
        recordingTrackId={recordingTrackId}
        recordingStartTime={recordingStartTime}
        recordingLevel={recordingLevel}
        onSeek={handleSeek}
        onSelectClip={handleSelectClip}
        onUpdateClip={handleUpdateEntity}
        onUpdateClips={handleUpdateClips}
        onDuplicateClips={handleDuplicateClips}
        onDeleteClip={handleDeleteEntity}
        onCopySelected={onCopySelected}
        onCutSelected={onCutSelected}
        onPasteClips={onPasteClips}
        zoomAnchorMode={editorSettings?.zoomAnchorMode === 'playhead' ? 'playhead' : 'cursor'}
        defaultTrackHeight={editorSettings?.defaultTrackHeight}
        onUpdateTrack={handleUpdateTrack}
        onDeleteTrack={handleDeleteTrack}
        onAddTrack={handleAddTrack}
        onAddEmptyClip={handleAddEmptyClip}
        onAddTransitionClip={handleAddTransitionClip}
        onDropItemOnTrack={handleDropItemOnTrack}
        onAttachScriptToEntity={handleAttachScriptToEntity}
        onAddMediaAsset={onAddMediaAsset}
        onSplitVideoAndAudio={onSplitVideoAndAudio}
        onOpenSilenceRemover={onOpenSilenceRemover}
        onOpenSilenceRemoverForTrack={onOpenSilenceRemoverForTrack}
        silencePreviewData={silencePreviewData}
        onToggleRecordTrack={onToggleRecordTrack}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onSetPixelsPerSecond={setPixelsPerSecond}
        exportRange={exportRange}
        onSetExportRange={setExportRange}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onRangeSelect={handleRangeSelect}
        onClearSelection={handleClearSelection}
        setSelectedIds={setSelectedIds}
        setSelectedEntityId={setSelectedEntityId}
      />
    </div>
  );
});
 
export const DopesheetDockPanel = memo(function DopesheetDockPanel() {
  const selectedEntityId = useEditorSelector((s) => s.selectedEntityId);
  const scripts = useEditorSelector((s) => s.scripts);
  const calculatedDuration = useEditorSelector((s) => s.calculatedDuration);
  const selectedKeyId = useEditorSelector((s) => s.selectedKeyId);
  const canUndo = useEditorSelector((s) => s.canUndo);
  const canRedo = useEditorSelector((s) => s.canRedo);
  const snappingEnabled = useEditorSelector((s) => s.snappingEnabled);
  const {
    handleUpdateEntity,
    setSelectedKeyId,
    // Timeline-parity shortcuts — same handlers App.jsx's Edit menu and
    // EditorPlaybackShortcuts already use, now also fed to the Dopesheet
    // toolbar (see Dopesheet.jsx's new onUndo/onSplitSelected/etc. props).
    undo, redo,
    handleSplitEntity, handleDeleteEntity, handleDuplicateClips,
    setSelectedIds,
    setSnappingEnabled,
  } = useEditorActions();
 
  const currentTime = useThrottledCurrentTime(30);
  const store = usePlaybackStore();
  // Only this entity's object, so an unrelated clip edit doesn't re-render the
  // sheet's tracks.
  const selectedEntity = useEditorSelector(
    (s) => (s.entities || []).find((e) => e.id === selectedEntityId) || null
  );

  const handleSeek = useCallback((t) => store.seek(t), [store]);
  const handleSplitSelected = useCallback(() => {
    if (selectedEntityId) handleSplitEntity(selectedEntityId);
  }, [selectedEntityId, handleSplitEntity]);
  const handleDeleteSelected = useCallback(() => {
    if (selectedEntityId) handleDeleteEntity(selectedEntityId);
  }, [selectedEntityId, handleDeleteEntity]);
  const handleDuplicateSelected = useCallback(() => {
    if (!selectedEntityId) return;
    const newIds = handleDuplicateClips([selectedEntityId]);
    if (newIds && newIds.length > 0) setSelectedIds(newIds);
  }, [selectedEntityId, handleDuplicateClips, setSelectedIds]);
  // setSnappingEnabled is a React state setter (stable); the updater form
  // means this never needs the current value.
  const handleToggleSnapping = useCallback(() => setSnappingEnabled((v) => !v), [setSnappingEnabled]);

  return (
    <Dopesheet
      selectedEntity={selectedEntity}
      scripts={scripts}
      currentTime={currentTime}
      totalDuration={calculatedDuration}
      onSeek={handleSeek}
      onUpdateEntity={handleUpdateEntity}
      selectedKeyId={selectedKeyId}
      onSelectedKeyChange={setSelectedKeyId}
      onUndo={undo}
      onRedo={redo}
      canUndo={canUndo}
      canRedo={canRedo}
      onSplitSelected={handleSplitSelected}
      onDeleteSelected={handleDeleteSelected}
      onDuplicateSelected={handleDuplicateSelected}
      onToggleSnapping={handleToggleSnapping}
      snappingEnabled={snappingEnabled}
    />
  );
});
 
/**
 * CurveEditorDockPanel — the dockable "Curves" tab. Reads `selectedKeyId`
 * from the same EditorContext slice the Dopesheet writes to, so selecting
 * a keyframe there automatically drives what shows here — no separate
 * wiring needed. Renders the empty state when nothing is selected, or
 * when the selected keyframe is the last one in its field's list (no
 * outgoing segment to curve).
 */
export const CurveEditorDockPanel = memo(function CurveEditorDockPanel() {
  const selectedKeyId = useEditorSelector((s) => s.selectedKeyId);
  const selectedEntity = useEditorSelector(
    (s) => (s.entities || []).find((e) => e.id === s.selectedEntityId) || null
  );
  const { handleUpdateEntity } = useEditorActions();
 
  const found = useMemo(
    () => findKeyframeById(selectedEntity, selectedKeyId),
    [selectedEntity, selectedKeyId]
  );
 
  // Curve/easing is stored on the "from" keyframe. If the selected
  // keyframe is the last one in its list, there's no outgoing segment
  // to shape a curve for.
  const hasOutgoingSegment = found && found.index < found.list.length - 1;
 
  const cp1 = found?.keyframe?.cp1 || DEFAULT_CP1;
  const cp2 = found?.keyframe?.cp2 || DEFAULT_CP2;
 
  const handleChange = useCallback((nextCp1, nextCp2) => {
    if (!selectedEntity || !found) return;
    const keyframes = setKeyframeCurve(
      selectedEntity, found.trackKey, found.fieldName, found.keyframe.id, nextCp1, nextCp2
    );
    handleUpdateEntity(selectedEntity.id, { keyframes });
  }, [selectedEntity, found, handleUpdateEntity]);
 
  const handleReset = useCallback(() => {
    if (!selectedEntity || !found) return;
    const keyframes = setKeyframeCurve(
      selectedEntity, found.trackKey, found.fieldName, found.keyframe.id, null, null
    );
    handleUpdateEntity(selectedEntity.id, { keyframes });
  }, [selectedEntity, found, handleUpdateEntity]);
 
  return (
    <CurveEditorTab
      cp1={cp1}
      cp2={cp2}
      onChange={handleChange}
      onReset={handleReset}
      selectedKeyId={hasOutgoingSegment ? selectedKeyId : null}
      keyframeInfo={hasOutgoingSegment ? { trackKey: found.trackKey, fieldName: found.fieldName, time: found.keyframe.time } : null}
    />
  );
});
 
/**
 * Whether this dock panel's tab is currently visible. Dockview keeps hidden
 * tabs mounted, so a panel has to ask. Falls back to "visible" when the panel
 * API is missing (tests, older callers) so behaviour is unchanged there.
 */
function useDockPanelVisible(api) {
  const [visible, setVisible] = useState(() => (api && typeof api.isVisible === 'boolean' ? api.isVisible : true));
  useEffect(() => {
    if (!api) return undefined;
    if (typeof api.isVisible === 'boolean') setVisible(api.isVisible);
    const sub = typeof api.onDidVisibilityChange === 'function'
      ? api.onDidVisibilityChange((e) => setVisible(!!e?.isVisible))
      : null;
    return () => {
      if (sub && typeof sub.dispose === 'function') sub.dispose();
    };
  }, [api]);
  return visible;
}

export const SilenceRemoverDockPanel = memo(function SilenceRemoverDockPanel({ api } = {}) {
  const isVisible = useDockPanelVisible(api);
  const entities = useEditorSelector((s) => s.entities);
  const tracks = useEditorSelector((s) => s.tracks);
  const mediaAssets = useEditorSelector((s) => s.mediaAssets);
  const selectedEntityId = useEditorSelector((s) => s.selectedEntityId);
  const silenceTarget = useEditorSelector((s) => s.silenceTarget);
  const { handleCutSilence, setSilencePreviewCuts } = useEditorActions();
 
  // While the tab is hidden nothing is on screen, so keep feeding the panel the
  // props it had when it was last visible. Its memo() then skips every render
  // caused by clip edits / drags, and it gets fresh props the moment the tab is
  // shown again.
  const live = {
    activeTargetType: silenceTarget?.type || 'clip',
    activeTargetId: silenceTarget?.id || selectedEntityId,
    allEntities: entities,
    allTracks: tracks,
    mediaAssets,
    onApplyCutSilence: handleCutSilence,
    onUpdatePreviewCuts: setSilencePreviewCuts,
  };
  const shownPropsRef = useRef(live);
  if (isVisible) shownPropsRef.current = live;
  const shown = shownPropsRef.current;

  return (
    <SilenceRemoverPanel
      activeTargetType={shown.activeTargetType}
      activeTargetId={shown.activeTargetId}
      allEntities={shown.allEntities}
      allTracks={shown.allTracks}
      mediaAssets={shown.mediaAssets}
      onApplyCutSilence={shown.onApplyCutSilence}
      onUpdatePreviewCuts={shown.onUpdatePreviewCuts}
      isVisible={isVisible}
    />
  );
});

export const MixerDockPanel = memo(function MixerDockPanel() {
  const tracks = useEditorSelector((s) => s.tracks);
  const { handleUpdateTrack } = useEditorActions();

  return (
    <MixerPanel
      tracks={tracks}
      onUpdateTrack={handleUpdateTrack}
    />
  );
});

export const ConsoleDockPanel = memo(function ConsoleDockPanel() {
  // Subscribes to nothing: the console shows log lines, and the script list is
  // only needed when a log line is clicked — read on demand from the store.
  const store = useEditorStore();
  const { onOpenScriptEditor } = useEditorActions();
  // Console entries carry a script NAME; the editor opens a script OBJECT.
  // Only wire the click-through when both sides are available, so the panel
  // works unchanged when this prop is missing (e.g. tests, older callers).
  const handleOpenScript = useCallback((name) => {
    if (!onOpenScriptEditor) return;
    const script = (store.getState().scripts || []).find((s) => s.name === name);
    if (script) onOpenScriptEditor(script);
  }, [store, onOpenScriptEditor]);
  return <ConsolePanel onOpenScript={onOpenScriptEditor ? handleOpenScript : undefined} />;
});