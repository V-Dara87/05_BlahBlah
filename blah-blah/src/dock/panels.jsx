import { ProjectPanel } from '../components/ProjectPanel';
import { ClipListPanel } from '../components/ClipListPanel';
import { EntityRenderer } from '../components/EntityRenderer';
import { UnityInspector } from '../components/UnityInspector';
import { Timeline } from '../components/Timeline/Timeline';
import { useEditorContext } from './EditorContext';
 
// Each of these is registered with dockview under a string key (see
// DOCK_COMPONENTS in DockLayout.jsx) and rendered inside a dockview "panel"
// (which supplies its own tab, drag handle, close/split affordances).
// They stay razor-thin on purpose — all real logic lives in the original
// components, untouched.
 
export function ProjectDockPanel() {
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
}
 
export function ClipsDockPanel() {
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
}
 
export function PreviewDockPanel() {
  const {
    entities, tracks, scripts, currentTime, calculatedDuration,
    isPlaying, isLooping, selectedEntityId, setSelectedEntityId,
    handleUpdateEntity, togglePlay, seek, setIsLooping,
  } = useEditorContext();
 
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
      onTogglePlay={togglePlay}
      onSeek={seek}
      onToggleLoop={() => setIsLooping((v) => !v)}
    />
  );
}
 
export function InspectorDockPanel() {
  const {
    entities, selectedEntityId, tracks, scripts,
    handleUpdateEntity, handleDeleteEntity,
    onOpenScriptEditor, handleSaveAsPrefab,
  } = useEditorContext();
 
  const selectedEntity = entities.find((e) => e.id === selectedEntityId);
 
  return (
    <UnityInspector
      selectedEntity={selectedEntity}
      tracks={tracks}
      scripts={scripts}
      onUpdateEntity={handleUpdateEntity}
      onDeleteEntity={handleDeleteEntity}
      onOpenScriptEditor={onOpenScriptEditor}
      onSaveAsPrefab={handleSaveAsPrefab}
    />
  );
}
 
export function TimelineDockPanel() {
  const {
    tracks, entities, currentTime, calculatedDuration, pixelsPerSecond,
    selectedEntityId, setSelectedEntityId, snappingEnabled,
    seek, handleUpdateEntity, handleUpdateTrack,
    handleAddTrack, handleAddEmptyClip, handleDropItemOnTrack,
  } = useEditorContext();
 
  return (
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
  );
}
 