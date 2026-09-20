import { useCallback } from 'react';
 
/**
 * useEditorPlaybackHandlers — handlers passed to <EditorPlaybackShortcuts>.
 *
 * EditorPlaybackShortcuts owns the actual keydown listeners (split,
 * delete, ripple-delete, duplicate, select-all, clear-selection, save,
 * undo/redo, snapping toggle, zoom, export-range) but not what any of
 * them DO — that's supplied as callback props, and every one of them
 * needs the same isPrefabMode branch (operate on prefabEntityActions vs.
 * the main scene's handlers) plus the selectedIds/selectedEntityId
 * fallback logic. Pulling that branching out of JSX props and into named,
 * memoized callbacks here keeps the render section of App.jsx to just
 * assembling the tree.
 *
 * Everything referenced (isPrefabMode, prefabEntityActions, the main
 * scene handlers, selection state/setters, zoom handlers) is owned
 * elsewhere in App.jsx and injected as params.
 */
export function useEditorPlaybackHandlers({
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
  handleZoomIn,
  handleZoomOut,
}) {
  const onSplitSelected = useCallback(() => {
    const ids = selectedIds.length > 0 ? selectedIds : (selectedEntityId ? [selectedEntityId] : []);
    if (ids.length > 0) {
      if (isPrefabMode) prefabEntityActions.handleSplitEntity(ids);
      else handleSplitEntity(ids);
    }
  }, [selectedIds, selectedEntityId, isPrefabMode, prefabEntityActions, handleSplitEntity]);
 
  const onDeleteSelected = useCallback(() => {
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
  }, [selectedIds, selectedEntityId, isPrefabMode, prefabEntityActions, handleDeleteEntity, setSelectedIds, setSelectedEntityId]);
 
  // Same body as onDeleteSelected — EditorPlaybackShortcuts binds this to
  // a different key combo (multi-delete shortcut) but the selection logic
  // is identical, so it's kept as its own callback identity rather than
  // aliased, matching the original inline props.
  const onDeleteMultiple = useCallback(() => {
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
  }, [selectedIds, selectedEntityId, isPrefabMode, prefabEntityActions, handleDeleteEntity, setSelectedIds, setSelectedEntityId]);
 
  const onRippleDeleteBefore = useCallback((anchorId) => {
    if (isPrefabMode) prefabEntityActions.handleRippleTrimToPlayhead(anchorId, 'before');
    else handleRippleTrimToPlayhead(anchorId, 'before');
  }, [isPrefabMode, prefabEntityActions, handleRippleTrimToPlayhead]);
 
  const onRippleDeleteAfter = useCallback((anchorId) => {
    if (isPrefabMode) prefabEntityActions.handleRippleTrimToPlayhead(anchorId, 'after');
    else handleRippleTrimToPlayhead(anchorId, 'after');
  }, [isPrefabMode, prefabEntityActions, handleRippleTrimToPlayhead]);
 
  const onDuplicateSelected = useCallback(() => {
    const ids = selectedIds.length > 0 ? selectedIds : (selectedEntityId ? [selectedEntityId] : []);
    if (ids.length > 0) {
      const handler = isPrefabMode ? prefabEntityActions.handleDuplicateClips : handleDuplicateClips;
      const newIds = handler(ids);
      if (newIds && newIds.length > 0) {
        setSelectedIds(newIds);
        setSelectedEntityId(newIds[0]);
      }
    }
  }, [selectedIds, selectedEntityId, isPrefabMode, prefabEntityActions, handleDuplicateClips, setSelectedIds, setSelectedEntityId]);
 
  // Copy / Cut / Paste. Selection resolves the same way as Duplicate/Delete
  // (multi-selection wins, else the single selected clip). The clipboard is
  // a module-level store (utils/clipClipboard.js), so a clip copied in prefab
  // mode can be pasted into the scene and vice-versa.
  const onCopySelected = useCallback(() => {
    const ids = selectedIds.length > 0 ? selectedIds : (selectedEntityId ? [selectedEntityId] : []);
    if (ids.length === 0) return;
    const copy = isPrefabMode ? prefabEntityActions.handleCopyClips : handleCopyClips;
    copy(ids);
  }, [selectedIds, selectedEntityId, isPrefabMode, prefabEntityActions, handleCopyClips]);
 
  // Cut = copy, then delete the originals. Descendants are stored by Copy
  // (see copyToClipboard), because deleting a parent cascades to its
  // children — so nothing is lost. Copy runs first, so if it stored nothing
  // we don't delete anything.
  const onCutSelected = useCallback(() => {
    const ids = selectedIds.length > 0 ? selectedIds : (selectedEntityId ? [selectedEntityId] : []);
    if (ids.length === 0) return;
    const copy = isPrefabMode ? prefabEntityActions.handleCopyClips : handleCopyClips;
    const stored = copy(ids);
    if (!stored) return;
    if (isPrefabMode) prefabEntityActions.handleDeleteEntity(ids);
    else handleDeleteEntity(ids);
    setSelectedIds([]);
    setSelectedEntityId(null);
  }, [selectedIds, selectedEntityId, isPrefabMode, prefabEntityActions, handleCopyClips, handleDeleteEntity, setSelectedIds, setSelectedEntityId]);
 
  const onPasteClips = useCallback(() => {
    const paste = isPrefabMode ? prefabEntityActions.handlePasteClips : handlePasteClips;
    const newIds = paste();
    if (newIds && newIds.length > 0) {
      // Select every pasted clip so the group can be moved / edited (and
      // shows up in the shared multi-clip Inspector) right away.
      setSelectedIds(newIds);
      setSelectedEntityId(newIds[0]);
    }
  }, [isPrefabMode, prefabEntityActions, handlePasteClips, setSelectedIds, setSelectedEntityId]);
 
  const onSelectAll = useCallback(() => {
    const allIds = activeEntities.map(e => e.id);
    setSelectedIds(allIds);
    setSelectedEntityId(allIds[0] || null);
  }, [activeEntities, setSelectedIds, setSelectedEntityId]);
 
  const onClearSelection = useCallback(() => {
    setSelectedIds([]);
    setSelectedEntityId(null);
  }, [setSelectedIds, setSelectedEntityId]);
 
  const onToggleSnapping = useCallback(() => {
    setSnappingEnabled((prev) => !prev);
  }, [setSnappingEnabled]);
 
  return {
    onSplitSelected,
    onDeleteSelected,
    onDeleteMultiple,
    onRippleDeleteBefore,
    onRippleDeleteAfter,
    onDuplicateSelected,
    onCopySelected,
    onCutSelected,
    onPasteClips,
    onSelectAll,
    onClearSelection,
    onToggleSnapping,
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
  };
}