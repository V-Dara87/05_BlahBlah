 
import { memo, useRef, useCallback, useMemo } from 'react';
import { ProjectPanel } from '../components/ProjectPanel';
import { ClipListPanel } from '../components/ClipListPanel';
import { EntityRenderer } from '../components/EntityRenderer';
import { UnityInspector } from '../components/UnityInspector';
import { Timeline } from '../components/Timeline/Timeline';
import { Dopesheet } from '../components/Dopesheet/Dopesheet';
import { CurveEditorTab } from '../components/CurveEditor';
import { getCurveSegment, setKeyframeCurve } from '../engine/keyframes';
import { useEditorContext } from './EditorContext';
import { useCurrentTime, useIsPlaying, useIsLooping, usePlaybackStore } from '../hooks/PlaybackContext';
 
export const ProjectDockPanel = memo(function ProjectDockPanel() {
  const {
    mediaAssets, prefabs, scripts,
    onAddMediaAsset, onRemoveMediaAsset, onRemovePrefab,
    onCreateScript, onOpenScriptEditor,
    onAddPrefabToTimeline, onAddMediaToTimeline,
  } = useEditorContext();
 
  return (
    <ProjectPanel
      mediaAssets={mediaAssets}
      prefabs={prefabs}
      scripts={scripts}
      onAddMediaAsset={onAddMediaAsset}
      onRemoveMediaAsset={onRemoveMediaAsset}
      onRemovePrefab={onRemovePrefab}
      onCreateScript={onCreateScript}
      onOpenScriptEditor={onOpenScriptEditor}
      onAddPrefabToTimeline={onAddPrefabToTimeline}
      onAddMediaToTimeline={onAddMediaToTimeline}
    />
  );
});
 
export const ClipsDockPanel = memo(function ClipsDockPanel() {
  const {
    entities, tracks, selectedEntityId, setSelectedEntityId, handleDeleteEntity,
  } = useEditorContext();
 
  return (
    <ClipListPanel
      entities={entities}
      tracks={tracks}
      selectedEntityId={selectedEntityId}
      onSelectEntity={setSelectedEntityId}
      onDeleteEntity={handleDeleteEntity}
    />
  );
});
 
export const PreviewDockPanel = memo(function PreviewDockPanel() {
  const {
    entities, tracks, scripts, calculatedDuration,
    selectedEntityId, setSelectedEntityId,
    handleUpdateEntity, resolution,
    fps = 30,
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
    />
  );
});
 
export const InspectorDockPanel = memo(function InspectorDockPanel() {
  const {
    entities, selectedEntityId, tracks, scripts,
    handleUpdateEntity, handleDeleteEntity,
    onOpenScriptEditor, handleSaveAsPrefab,
    autoKeyEnabled, setAutoKeyEnabled,
  } = useEditorContext();

  const currentTime = useCurrentTime();
  const selectedEntity = entities.find((e) => e.id === selectedEntityId);

  return (
    <div className="dock-panel-root">
      <UnityInspector
        selectedEntity={selectedEntity}
        tracks={tracks}
        scripts={scripts}
        onUpdateEntity={handleUpdateEntity}
        onDeleteEntity={handleDeleteEntity}
        onOpenScriptEditor={onOpenScriptEditor}
        onSaveAsPrefab={handleSaveAsPrefab}
        currentTime={currentTime}
        autoKeyEnabled={autoKeyEnabled}
        setAutoKeyEnabled={setAutoKeyEnabled}
      />
    </div>
  );
});
 
export const TimelineDockPanel = memo(function TimelineDockPanel() {
  const {
    tracks, entities, calculatedDuration, pixelsPerSecond,
    selectedEntityId, setSelectedEntityId, snappingEnabled,
    selectedIds, setSelectedIds,
    handleUpdateEntity, handleUpdateTrack,
    handleAddTrack, handleAddEmptyClip, handleDropItemOnTrack,
    recordingTrackId, onToggleRecordTrack,
    onZoomIn, onZoomOut,
    exportRange, setExportRange,
  } = useEditorContext();

  const store = usePlaybackStore();

  const handleToggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id);
      return [...prev, id];
    });
  }, [setSelectedIds]);

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

  return (
    <Timeline
      tracks={tracks}
      clips={entities}
      totalDuration={calculatedDuration}
      pixelsPerSecond={pixelsPerSecond}
      selectedClipId={selectedEntityId}
      snappingEnabled={snappingEnabled}
      recordingTrackId={recordingTrackId}
      onSeek={(t) => store.seek(t)}
      onSelectClip={setSelectedEntityId}
      onUpdateClip={handleUpdateEntity}
      onUpdateTrack={handleUpdateTrack}
      onAddTrack={handleAddTrack}
      onAddEmptyClip={handleAddEmptyClip}
      onDropItemOnTrack={handleDropItemOnTrack}
      onToggleRecordTrack={onToggleRecordTrack}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      exportRange={exportRange}
      onSetExportRange={setExportRange}
      selectedIds={selectedIds}
      onToggleSelect={handleToggleSelect}
      onRangeSelect={handleRangeSelect}
      onClearSelection={handleClearSelection}
      setSelectedIds={setSelectedIds}
      setSelectedEntityId={setSelectedEntityId}
    />
  );
});
 
export const DopesheetDockPanel = memo(function DopesheetDockPanel() {
  const {
    entities, selectedEntityId, scripts, calculatedDuration,
    handleUpdateEntity,
    selectedKeyId, setSelectedKeyId,
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
    />
  );
});

export function CurveEditorDockPanel() {
  const {
    entities, selectedEntityId, handleUpdateEntity,
    selectedKeyId,
  } = useEditorContext();

  const selectedEntity = entities.find((e) => e.id === selectedEntityId);

  // Find the selected keyframe's location and curve segment
  const { curveSegment, trackKey, fieldName, keyframeTime } = useMemo(() => {
    if (!selectedKeyId || !selectedEntity?.keyframes) return {};
    for (const [tk, byField] of Object.entries(selectedEntity.keyframes)) {
      for (const [fn, kfs] of Object.entries(byField)) {
        const idx = kfs.findIndex((k) => k.id === selectedKeyId);
        if (idx >= 0) {
          // Use the next keyframe's segment if available, otherwise show the current key's curve
          const segment = idx < kfs.length - 1
            ? getCurveSegment(kfs[idx], kfs[idx + 1])
            : getCurveSegment(kfs[idx], kfs[idx]); // single key — show its own curve as fallback
          return {
            trackKey: tk,
            fieldName: fn,
            keyframeTime: kfs[idx].time,
            curveSegment: segment,
          };
        }
      }
    }
    return {};
  }, [selectedKeyId, selectedEntity]);

  // Use refs for the latest values so callbacks never go stale
  const stateRef = useRef({});
  stateRef.current = { trackKey, fieldName, selectedEntity, selectedKeyId };

  const handleChangeCurve = useCallback((cp1, cp2) => {
    const { trackKey: tk, fieldName: fn, selectedEntity: ent, selectedKeyId: kid } = stateRef.current;
    if (!tk || !fn || !ent) return;
    const keyframes = setKeyframeCurve(ent, tk, fn, kid, cp1, cp2);
    handleUpdateEntity(ent.id, { keyframes });
  }, [handleUpdateEntity]);

  const handleApplyPreset = useCallback((cp1, cp2) => {
    const { trackKey: tk, fieldName: fn, selectedEntity: ent, selectedKeyId: kid } = stateRef.current;
    if (!tk || !fn || !ent) return;
    const keyframes = setKeyframeCurve(ent, tk, fn, kid, cp1, cp2);
    handleUpdateEntity(ent.id, { keyframes });
  }, [handleUpdateEntity]);

  const handleResetCurve = useCallback(() => {
    const { trackKey: tk, fieldName: fn, selectedEntity: ent, selectedKeyId: kid } = stateRef.current;
    if (!tk || !fn || !ent) return;
    const keyframes = setKeyframeCurve(ent, tk, fn, kid, null, null);
    handleUpdateEntity(ent.id, { keyframes });
  }, [handleUpdateEntity]);

  const cp1 = curveSegment?.cp1 || { x: 0.33, y: 0 };
  const cp2 = curveSegment?.cp2 || { x: 0.67, y: 1 };

  return (
    <CurveEditorTab
      cp1={cp1}
      cp2={cp2}
      onChange={handleChangeCurve}
      onPresetApply={handleApplyPreset}
      onReset={handleResetCurve}
      selectedKeyId={selectedKeyId}
      keyframeInfo={trackKey ? { trackKey, fieldName, time: keyframeTime } : null}
    />
  );
}
 