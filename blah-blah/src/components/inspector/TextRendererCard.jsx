import { Type, Trash2 } from 'lucide-react';
import { InspectorFieldList, FieldContextRow, TEXT_RENDERER_FIELDS } from './InspectorField';
import { FontFamilyPicker } from './FontFamilyPicker';
import { EntityRefSlot } from './RefSlot';
import { InspectorCardHeader } from './InspectorCardHeader';
import { isTextDrivenBySubtitle } from '../../engine/textRenderer';
 
export function TextRendererCard({
  textComp,
  subtitleComp,
  entities,
  selectedEntity,
  isOpen,
  onToggle,
  dragOverCompType,
  handleCardDragStart,
  handleCardDragOver,
  handleCardDrop,
  handleCardDragEnd,
  removeComponent,
  resolveComponentValues,
  tryWriteKeyframe,
  updateComponent,
  currentTime,
  onUpdateEntity,
}) {
  const resolvedText = resolveComponentValues('TextRenderer', textComp);
  const subtitleEntities = entities.filter((e) =>
    e.components?.some((c) => c.type === 'SubtitleTrack')
  );
  const drivenBySubtitle = isTextDrivenBySubtitle(textComp, selectedEntity);
  const updateTextField = (name, v) => {
    const newKfs = tryWriteKeyframe(selectedEntity, 'TextRenderer', name, v);
    if (newKfs) {
      onUpdateEntity(selectedEntity.id, { keyframes: newKfs });
    } else {
      updateComponent('TextRenderer', { [name]: v });
    }
  };
 
  return (
    <div className="inspector-card">
      <InspectorCardHeader
        icon={<Type size={13} className="text-amber" />}
        title="Text Component"
        isOpen={isOpen}
        onToggle={onToggle}
        draggable
        isDragOver={dragOverCompType === 'TextRenderer'}
        onDragStart={handleCardDragStart('TextRenderer')}
        onDragOver={handleCardDragOver('TextRenderer')}
        onDrop={handleCardDrop('TextRenderer')}
        onDragEnd={handleCardDragEnd}
        actions={
          <button className="del-btn-sm" onClick={() => removeComponent('TextRenderer')}>
            <Trash2 size={11} />
          </button>
        }
      />
 
      {isOpen && (
        <div className="inspector-card-body">
          <textarea
            className="inspector-textarea"
            rows={2}
            value={drivenBySubtitle ? '' : (textComp.text || '')}
            placeholder={drivenBySubtitle ? 'Text comes from Subtitle Track' : ''}
            disabled={drivenBySubtitle}
            onChange={(e) => updateComponent('TextRenderer', { text: e.target.value })}
          />
 
          <FieldContextRow
            field={{ name: 'subtitleSourceId', type: 'entity', defaultVal: null }}
            value={textComp.subtitleSourceId || null}
            onChange={(id) => updateComponent('TextRenderer', { subtitleSourceId: id || null })}
          >
            <span className="row-label">Subtitle Source</span>
            <EntityRefSlot
              value={textComp.subtitleSourceId || null}
              onChange={(id) => updateComponent('TextRenderer', { subtitleSourceId: id || null })}
              entities={subtitleEntities}
              emptyLabel="None"
            />
          </FieldContextRow>
          {subtitleComp && !textComp.subtitleSourceId && (
            <p className="hint-text-sm">Using this clip&apos;s Subtitle Track.</p>
          )}
 
          <InspectorFieldList
            fields={TEXT_RENDERER_FIELDS}
            values={resolvedText}
            onFieldChange={updateTextField}
            trackKey="TextRenderer"
            selectedEntity={selectedEntity}
            currentTime={currentTime}
            onUpdateEntity={onUpdateEntity}
          />
 
          <FieldContextRow
            field={{ name: 'fontFamily', type: 'font', defaultVal: 'Inter' }}
            value={textComp.fontFamily || 'Inter'}
            onChange={(family) => updateComponent('TextRenderer', { fontFamily: family })}
          >
            <span className="row-label">Font</span>
            <FontFamilyPicker
              value={textComp.fontFamily || 'Inter'}
              onChange={(family) => updateComponent('TextRenderer', { fontFamily: family })}
            />
          </FieldContextRow>
        </div>
      )}
    </div>
  );
}
 