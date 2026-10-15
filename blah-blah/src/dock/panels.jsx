 
import { memo, useState, useCallback, useMemo } from 'react';
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
import { useEditorContext } from './EditorContext';
import { useTimelineView } from './TimelineViewContext';
import { useCurrentTime, useIsPlaying, useIsLooping, usePlaybackStore } from '../hooks/PlaybackContext';
 
export const ProjectDockPanel = memo(function ProjectDockPanel() {
  const {
    mediaAssets, prefabs, scripts,
    projectFolderHandle,
    sharedLibraryItems,
    onSharePrefab, onShareScript, onShareMedia, onRemoveSharedItem, onMoveSharedItem, onImportSharedItem,
    onUpdateScriptFromLibrary, onExportSharedLibrary, onImportSharedLibrary,
    onAddMediaAsset, onRemoveMediaAsset, onRemovePrefab, onRemoveScript,
    onRenameMediaAsset, onRenamePrefab, onRenameScript,
    onCreateScript, onOpenScriptEditor,
    onAddPrefabToTimeline, onAddMediaToTimeline,
    onMoveMediaAsset, onReplaceMediaAsset, onMovePrefab, onMoveScript,
    handleAddEmptyClip,
    onEnterPrefabMode,
  } = useEditorContext();
 
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
  const {
    entities, tracks, scripts, calculatedDuration,
    selectedEntityId, setSelectedEntityId,
    handleUpdateEntity, resolution,
    fps = 30,
    mediaAssets,
    autoKeyEnabled,
  } = useEditorContext();
 
  const currentTime = useCurrentTime();
  const isPlaying = useIsPlaying();
  const isLooping = useIsLooping();
  const store = usePlaybackStore();
 
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
      onTogglePlay={() => store.togglePlay()}
      onSeek={(t) => store.seek(t)}
      onToggleLoop={() => store.toggleLoop()}
      resolution={resolution}
      fps={fps}
      mediaAssets={mediaAssets}
      autoKeyEnabled={autoKeyEnabled}
    />
  );
});
 
export const InspectorDockPanel = memo(function InspectorDockPanel() {
  const {
    entities, selectedEntityId, selectedIds, setSelectedIds, setSelectedEntityId, tracks, scripts, prefabs,
    handleUpdateEntity, handleUpdateClips, handleDeleteEntity,
    onOpenScriptEditor, handleSaveAsPrefab,
    handleAttachScriptToEntity,
    autoKeyEnabled, setAutoKeyEnabled,    mediaAssets,
    resolution,
    fps = 30,
    onEnterPrefabMode,
    onDetachPrefab,
    onRevertToPrefab,
    onApplyToPrefab,
    onOpenPackageManager,
  } = useEditorContext();

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
 
  const currentTime = useCurrentTime();
  const selectedEntity = entities.find((e) => e.id === activeEntityId);
 
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
  const {
    tracks, entities, mediaAssets, calculatedDuration,
    // Global editor preferences: the timeline's canvas renderer toggle lives
    // in services/editorSettings.js and is exposed here via the settings modal
    // (Settings -> System -> Timeline rendering).
    editorSettings,
    selectedEntityId, setSelectedEntityId, snappingEnabled,
    selectedIds, setSelectedIds,
    handleUpdateEntity, handleUpdateClips, handleDuplicateClips, handleDeleteEntity,
    onCopySelected, onCutSelected, onPasteClips,
    handleUpdateTrack, handleDeleteTrack,
    handleAddTrack, handleAddEmptyClip, handleAddTransitionClip,
    handleDropItemOnTrack, handleAttachScriptToEntity,
    onAddMediaAsset,
    recordingTrackId, recordingStartTime, recordingLevel, onToggleRecordTrack,
    exportRange, setExportRange,
    onSplitVideoAndAudio,
    onOpenSilenceRemover,
    onOpenSilenceRemoverForTrack,
    silencePreviewData,
    isPrefabMode,
    editingPrefab,
    onExitPrefabMode,
    onSaveCurrentPrefab,
    onSyncPrefabToSceneInstances,
    isPrefabSaved,
    isPrefabSynced,  } = useEditorContext();

  const store = usePlaybackStore();
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
        onSeek={(t) => store.seek(t)}
        onSelectClip={handleSelectClip}
        onUpdateClip={handleUpdateEntity}
        onUpdateClips={handleUpdateClips}
        onDuplicateClips={handleDuplicateClips}
        onDeleteClip={handleDeleteEntity}
        onCopySelected={onCopySelected}
        onCutSelected={onCutSelected}
        onPasteClips={onPasteClips}
        zoomAnchorMode={editorSettings?.zoomAnchorMode === 'playhead' ? 'playhead' : 'cursor'}
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
  const {
    entities, selectedEntityId, scripts, calculatedDuration,
    handleUpdateEntity,
    selectedKeyId, setSelectedKeyId,
    // Timeline-parity shortcuts — same handlers App.jsx's Edit menu and
    // EditorPlaybackShortcuts already use, now also fed to the Dopesheet
    // toolbar (see Dopesheet.jsx's new onUndo/onSplitSelected/etc. props).
    undo, redo, canUndo, canRedo,
    handleSplitEntity, handleDeleteEntity, handleDuplicateClips,
    setSelectedIds,
    snappingEnabled, setSnappingEnabled,
  } = useEditorContext();
 
  const currentTime = useCurrentTime();
  const store = usePlaybackStore();
  const selectedEntity = entities.find((e) => e.id === selectedEntityId);
 
  return (
    <Dopesheet
      selectedEntity={selectedEntity}
      scripts={scripts}
      currentTime={currentTime}
      totalDuration={calculatedDuration}
      onSeek={(t) => store.seek(t)}
      onUpdateEntity={handleUpdateEntity}
      selectedKeyId={selectedKeyId}
      onSelectedKeyChange={setSelectedKeyId}
      onUndo={undo}
      onRedo={redo}
      canUndo={canUndo}
      canRedo={canRedo}
      onSplitSelected={() => selectedEntityId && handleSplitEntity(selectedEntityId)}
      onDeleteSelected={() => selectedEntityId && handleDeleteEntity(selectedEntityId)}
      onDuplicateSelected={() => {
        if (!selectedEntityId) return;
        const newIds = handleDuplicateClips([selectedEntityId]);
        if (newIds && newIds.length > 0) setSelectedIds(newIds);
      }}
      onToggleSnapping={() => setSnappingEnabled((v) => !v)}
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
  const { entities, selectedEntityId, selectedKeyId, handleUpdateEntity } = useEditorContext();
  const selectedEntity = entities.find((e) => e.id === selectedEntityId);
 
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
 
export const SilenceRemoverDockPanel = memo(function SilenceRemoverDockPanel() {
  const {
    entities,
    tracks,
    mediaAssets,
    selectedEntityId,
    silenceTarget,
    handleCutSilence,
    setSilencePreviewCuts,
  } = useEditorContext();
 
  return (
    <SilenceRemoverPanel
      activeTargetType={silenceTarget?.type || 'clip'}
      activeTargetId={silenceTarget?.id || selectedEntityId}
      allEntities={entities}
      allTracks={tracks}
      mediaAssets={mediaAssets}
      onApplyCutSilence={handleCutSilence}
      onUpdatePreviewCuts={setSilencePreviewCuts}
    />
  );
});

export const MixerDockPanel = memo(function MixerDockPanel() {
  const { tracks, handleUpdateTrack } = useEditorContext();

  return (
    <MixerPanel
      tracks={tracks}
      onUpdateTrack={handleUpdateTrack}
    />
  );
});

export const ConsoleDockPanel = memo(function ConsoleDockPanel() {
  const { scripts, onOpenScriptEditor } = useEditorContext();
  // Console entries carry a script NAME; the editor opens a script OBJECT.
  // Only wire the click-through when both sides are available, so the panel
  // works unchanged when this prop is missing (e.g. tests, older callers).
  const handleOpenScript = onOpenScriptEditor
    ? (name) => {
        const script = (scripts || []).find((s) => s.name === name);
        if (script) onOpenScriptEditor(script);
      }
    : undefined;
  return <ConsolePanel onOpenScript={handleOpenScript} />;
});