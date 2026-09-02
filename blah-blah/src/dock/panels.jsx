 
import { memo } from 'react';
import { ProjectPanel } from '../components/ProjectPanel';
import { ClipListPanel } from '../components/ClipListPanel';
import { EntityRenderer } from '../components/EntityRenderer';
import { UnityInspector } from '../components/UnityInspector';
import { Timeline } from '../components/Timeline/Timeline';
import { Dopesheet } from '../components/Dopesheet/Dopesheet';
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
    />
  );
});
 
export const InspectorDockPanel = memo(function InspectorDockPanel() {
  const {
    entities, selectedEntityId, tracks, scripts,
    handleUpdateEntity, handleDeleteEntity,
    onOpenScriptEditor, handleSaveAsPrefab,
  } = useEditorContext();
 
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
      />
    </div>
  );
});
 
export const TimelineDockPanel = memo(function TimelineDockPanel() {
  const {
    tracks, entities, calculatedDuration, pixelsPerSecond,
    selectedEntityId, setSelectedEntityId, snappingEnabled,
    handleUpdateEntity, handleUpdateTrack,
    handleAddTrack, handleAddEmptyClip, handleDropItemOnTrack,
    recordingTrackId, onToggleRecordTrack,
  } = useEditorContext();
 
  const store = usePlaybackStore();
 
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
    />
  );
});
 
export const DopesheetDockPanel = memo(function DopesheetDockPanel() {
  const {
    entities, selectedEntityId, scripts, calculatedDuration,
    handleUpdateEntity,
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
    />
  );
});
 