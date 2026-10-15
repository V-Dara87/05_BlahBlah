import { Captions, Trash2 } from 'lucide-react';
import { SubtitleTrackInspector } from './SubtitleTrackInspector';
import { InspectorCardHeader } from './InspectorCardHeader';
 
/**
 * Presentation is deliberately NOT here — this card only edits the
 * phrase list/timing (and SRT import/export). Drawing the text on screen
 * is a CanvasRenderer script's job, reading this data via
 * EntityRef.getPhraseAt/getCurrentText — see the subtitle-track feature
 * scope doc for why that split exists.
 */
export function SubtitleTrackCard({
  subtitleComp,
  selectedEntity,
  currentTime,
  onUpdateEntity,
  isOpen,
  onToggle,
  dragOverCompType,
  handleCardDragStart,
  handleCardDragOver,
  handleCardDrop,
  handleCardDragEnd,
  removeComponent,
  onOpenPackageManager,
  mediaAssets = [],
}) {
  return (
    <div className="inspector-card">
      <InspectorCardHeader
        icon={<Captions size={13} className="text-cyan" />}
        title="Subtitle Track"
        isOpen={isOpen}
        onToggle={onToggle}
        draggable
        isDragOver={dragOverCompType === 'SubtitleTrack'}
        onDragStart={handleCardDragStart('SubtitleTrack')}
        onDragOver={handleCardDragOver('SubtitleTrack')}
        onDrop={handleCardDrop('SubtitleTrack')}
        onDragEnd={handleCardDragEnd}
        actions={
          <button className="del-btn-sm" onClick={() => removeComponent('SubtitleTrack')}>
            <Trash2 size={11} />
          </button>
        }
      />
      {isOpen && (
        <div className="inspector-card-body">
          <SubtitleTrackInspector
            component={subtitleComp}
            onUpdateEntity={onUpdateEntity}
            selectedEntity={selectedEntity}
            currentTime={currentTime}
            onOpenPackageManager={onOpenPackageManager}
            mediaAssets={mediaAssets}
          />
        </div>
      )}
    </div>
  );
}
 