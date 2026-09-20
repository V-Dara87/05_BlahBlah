import { memo, useState } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
 
/**
 * ArrayFieldEditor — generic editor for an array-typed field on a component.
 *
 * Extracted from the Subtitle Track phrase list (see
 * inspector/SubtitleTrackInspector.jsx) so any component that owns a list of
 * items — subtitle phrases today, flowchart nodes or a playlist later — gets
 * the same drag-to-reorder / add / remove UI instead of a hand-copied block
 * of JSX.
 *
 * It is deliberately schema-agnostic: it never reads or writes item fields
 * itself. Every mutation is delegated to a caller-supplied callback, and each
 * one returns the *next* component, mirroring the `(component, ...) =>
 * component` shape of engine helpers like updatePhrase / addPhrase /
 * removePhrase / reorderPhrases. The editor commits that result through
 * `onItemUpdate`, so the caller stays free to re-sort, re-derive sequential
 * timings, or validate after every change.
 *
 * Layout note: each item row's outer wrapper carries the shared
 * `.inspector-row` class for consistent spacing/background with the rest of
 * the Inspector, but `.inspector-row` is itself `display: grid;
 * grid-template-columns: 75px 1fr;` (a 2-column label/value grid meant for
 * plain single-field rows elsewhere in the Inspector). Previously this outer
 * div also tried to set `flexDirection: 'column'` inline — which is a
 * flexbox property and silently does nothing on a grid container, so the
 * drag-handle / renderItem / renderActions / delete-button row (and the
 * optional renderBody row below it) were actually being placed into
 * `.inspector-row`'s 75px/1fr grid tracks instead of stacking top-to-bottom,
 * clipping whichever control landed past the 1fr column's right edge (e.g.
 * the SET/ADD pill in duration-mode subtitle rows). This wrapper now sets
 * `display: 'grid', gridTemplateColumns: '1fr'` inline to explicitly
 * override the inherited two-column template with a single full-width
 * column, so renderItem/renderActions/renderBody stack as intended
 * regardless of what `.inspector-row` elsewhere defines.
 *
 * @param {Array}     items          - the array to edit
 * @param {string}    itemIdKey      - key holding each item's stable id
 * @param {Function}  onItemUpdate   - (updatedComponent) => void — persist it
 * @param {Function}  onItemChange   - (itemId, patch) => updatedComponent
 * @param {Function}  onItemAdd      - (newItem) => updatedComponent
 * @param {Function}  onItemRemove   - (itemId) => updatedComponent
 * @param {Function}  onItemReorder  - (draggedId, targetId) => updatedComponent
 * @param {Function}  renderItem     - (item, index, onUpdate) => JSX, header row
 * @param {Function}  renderBody     - (item, index, onUpdate) => JSX, optional
 *                                     second row (a textarea, for instance)
 * @param {Function}  renderActions  - (item, index, onUpdate) => JSX, optional
 *                                     extra header-row controls
 * @param {Function}  renderToolbar  - () => JSX, optional, rendered above the list
 * @param {Function}  createNewItem  - () => item, optional
 * @param {string}    itemClassName  - extra class on every row, for styling
 * @param {string}    emptyMessage   - shown when the list is empty
 * @param {string}    addButtonText  - label for the add button
 */
export const ArrayFieldEditor = memo(function ArrayFieldEditor({
  items = [],
  itemIdKey = 'id',
  onItemUpdate,
  onItemChange,
  onItemAdd,
  onItemRemove,
  onItemReorder,
  renderItem,
  renderBody,
  renderActions,
  renderToolbar,
  createNewItem,
  itemClassName = '',
  emptyMessage = 'No items yet.',
  addButtonText = 'Add Item',
}) {
  const [dragItemId, setDragItemId] = useState(null);
  const [dragOverItemId, setDragOverItemId] = useState(null);
 
  // Every handler below resolves to "the next component", or to nothing when
  // the callback is absent (e.g. a read-only list) — so committing is one
  // line in each case instead of each control knowing its own mutation shape.
  const commit = (updatedComponent) => {
    if (updatedComponent) onItemUpdate?.(updatedComponent);
  };
 
  const handleDragStart = (itemId) => (e) => {
    setDragItemId(itemId);
    e.dataTransfer.effectAllowed = 'move';
  };
 
  const handleDragOver = (itemId) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverItemId !== itemId) setDragOverItemId(itemId);
  };
 
  const handleDrop = (itemId) => (e) => {
    e.preventDefault();
    if (dragItemId && dragItemId !== itemId) {
      commit(onItemReorder?.(dragItemId, itemId));
    }
    setDragItemId(null);
    setDragOverItemId(null);
  };
 
  const handleDragEnd = () => {
    setDragItemId(null);
    setDragOverItemId(null);
  };
 
  const handleAdd = () => {
    const newItem = createNewItem ? createNewItem() : { [itemIdKey]: crypto.randomUUID() };
    commit(onItemAdd?.(newItem));
  };
 
  const handleRemove = (itemId) => {
    commit(onItemRemove?.(itemId));
  };
 
  // Curried so renderItem/renderBody/renderActions all receive the same
  // `onUpdate(patch)`-style callback for the item they were given.
  const patchItem = (itemId) => (patch) => {
    commit(onItemChange?.(itemId, patch));
  };
 
  return (
    <div
      className="array-field-editor"
      style={{
        border: '1px solid var(--border-subtle, #333)',
        borderRadius: 6,
        padding: 6,
      }}
    >
      {renderToolbar && renderToolbar()}
 
      {items.length === 0 && (
        <p className="hint-text-sm">{emptyMessage}</p>
      )}
 
      {items.map((item, index) => {
        const itemId = item[itemIdKey];
        const onUpdate = patchItem(itemId);
        const isDragging = dragItemId === itemId;
        const isDropTarget = dragOverItemId === itemId && dragItemId !== itemId;
        return (
          <div key={itemId} style={{ position: 'relative' }}>
            {/* Drop-position indicator — shown ABOVE this row when it's the
                current drag-over target, so reordering has a clear, visible
                insertion point instead of only a background-color class
                toggle (easy to miss, and gave no real feedback once a list
                is boxed the way nested struct[] items are below). */}
            {isDropTarget && (
              <div
                className="array-field-drop-indicator"
                style={{
                  position: 'absolute',
                  top: -3,
                  left: 4,
                  right: 4,
                  height: 2,
                  background: 'var(--accent, #4f9eff)',
                  borderRadius: 1,
                  zIndex: 1,
                }}
              />
            )}
            <div
              className={`inspector-row array-field-item${itemClassName ? ` ${itemClassName}` : ''}${isDropTarget ? ' drag-over' : ''}${isDragging ? ' dragging' : ''}`}
              style={{
                // Override .inspector-row's inherited 75px/1fr two-column grid
                // template with a single full-width column, so this row's two
                // stacked children (the controls row below, and the optional
                // renderBody row) lay out top-to-bottom as intended instead of
                // being split across label/value grid tracks meant for plain
                // single-field rows elsewhere in the Inspector.
                display: 'grid',
                gridTemplateColumns: '1fr',
                rowGap: 4,
                alignItems: 'stretch',
                // Boxed container: every array item — including a struct[]
                // item that itself contains another struct[] field — gets a
                // visible border/background, so a nested list reads as
                // "box inside box" instead of running flush into its parent.
                border: '1px solid var(--border-subtle, #333)',
                borderRadius: 4,
                padding: '6px 6px 6px 4px',
                marginBottom: 4,
                background: 'var(--bg-inset, rgba(255,255,255,0.02))',
                opacity: isDragging ? 0.5 : 1,
              }}
              onDragOver={handleDragOver(itemId)}
              onDrop={handleDrop(itemId)}
            >
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                <span
                  className="card-drag-handle"
                  title="Drag to reorder"
                  draggable
                  onDragStart={handleDragStart(itemId)}
                  onDragEnd={handleDragEnd}
                  style={{ cursor: 'grab', flexShrink: 0 }}
                >
                  <GripVertical size={12} />
                </span>
 
                {/* Stable 1-based index — independent of the item's own id
                    or content, so reordering is easy to verify by eye
                    (matches Unity's List<T> element index display). */}
                <span
                  className="array-field-index"
                  title={`Index ${index}`}
                  style={{
                    flexShrink: 0,
                    fontSize: 14,
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--text-secondary, #aaa)',
                    minWidth: 22,
                    textAlign: 'right',
                  }}
                >
                  {index + 1}
                </span>
 
                {renderItem(item, index, onUpdate)}
                {renderActions && renderActions(item, index, onUpdate)}
 
                <button
                  className="del-btn-sm"
                  title="Remove item"
                  style={{ flexShrink: 0 }}
                  onClick={() => handleRemove(itemId)}
                >
                  <Trash2 size={11} />
                </button>
              </div>
 
              {renderBody && renderBody(item, index, onUpdate)}
            </div>
          </div>
        );
      })}
 
      <button
        className="unity-btn unity-btn-secondary full-width btn-xs"
        onClick={handleAdd}
      >
        <Plus size={11} />
        <span>{addButtonText}</span>
      </button>
    </div>
  );
});