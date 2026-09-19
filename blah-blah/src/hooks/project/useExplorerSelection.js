import { useState, useRef, useCallback } from 'react';
import { selKey } from '../../components/project/projectPanelConstants';
 
/**
 * Owns multi-selection state (Click / Ctrl+Click / Shift+Range) for the
 * Explorer content view, plus resolving selected keys back into real items
 * and bulk-deleting the current selection.
 *
 * @param {object} params
 * @param {any[]} params.mediaAssets
 * @param {any[]} params.prefabs
 * @param {any[]} params.scripts
 * @param {any[]} params.sharedItems
 * @param {{kind:string,id:string,name:string}|null} params.renaming
 * @param {(kind:string, item:any) => void} params.deleteItem
 * @param {() => void} params.closeCtxMenu - called before bulk-deleting to dismiss any open context menu
 */
export function useExplorerSelection({
  mediaAssets,
  prefabs,
  scripts,
  sharedItems,
  renaming,
  deleteItem,
  closeCtxMenu,
}) {
  const [selectedItems, setSelectedItems] = useState(() => new Set());
  const lastClickedKeyRef = useRef(null);
 
  const clearSelection = useCallback(() => setSelectedItems(new Set()), []);
 
  const resolveSelectionEntries = useCallback(() => {
    const byId = {
      media: new Map(mediaAssets.map((i) => [i.id, i])),
      prefab: new Map(prefabs.map((i) => [i.id, i])),
      script: new Map(scripts.map((i) => [i.id, i])),
      shared: new Map(sharedItems.map((i) => [i.id, i])),
    };
    const out = [];
    selectedItems.forEach((key) => {
      const [kind, id] = key.split(':');
      const item = byId[kind]?.get(id);
      if (item) out.push({ kind, item });
    });
    return out;
  }, [selectedItems, mediaAssets, prefabs, scripts, sharedItems]);
 
  const handleItemClick = useCallback((e, kind, item, filteredItemsInView) => {
    if (renaming && renaming.kind === kind && renaming.id === item.id) return;
    const key = selKey(kind, item.id);
    if (e.ctrlKey || e.metaKey) {
      setSelectedItems((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      lastClickedKeyRef.current = key;
    } else if (e.shiftKey) {
      const visibleKeys = filteredItemsInView.map((i) => selKey(kind, i.id));
      const fromIdx = visibleKeys.indexOf(lastClickedKeyRef.current);
      const toIdx = visibleKeys.indexOf(key);
      if (lastClickedKeyRef.current && fromIdx !== -1 && toIdx !== -1) {
        const min = Math.min(fromIdx, toIdx);
        const max = Math.max(fromIdx, toIdx);
        setSelectedItems(new Set(visibleKeys.slice(min, max + 1)));
      } else {
        setSelectedItems(new Set([key]));
      }
      lastClickedKeyRef.current = key;
    } else {
      setSelectedItems(new Set([key]));
      lastClickedKeyRef.current = key;
    }
  }, [renaming]);
 
  const bulkDeleteSelected = useCallback(() => {
    if (selectedItems.size === 0) return;
    const entries = resolveSelectionEntries();
    if (entries.length === 0) return;
    // Previously only prompted when 2+ items were selected, so deleting a
    // single selected item via the Delete key skipped confirmation entirely.
    // Name-aware prompt for the single-item case so it reads naturally.
    if (entries.length > 1) {
      if (!window.confirm(`Delete ${entries.length} item(s)?`)) return;
    } else {
      const label = entries[0].item?.name ? `"${entries[0].item.name}"` : 'this item';
      if (!window.confirm(`Delete ${label}? This can't be undone.`)) return;
    }
    closeCtxMenu();
    clearSelection();
    entries.forEach(({ kind, item }) => deleteItem(kind, item));
  }, [selectedItems, resolveSelectionEntries, deleteItem, clearSelection, closeCtxMenu]);
 
  return {
    selectedItems,
    setSelectedItems,
    lastClickedKeyRef,
    clearSelection,
    resolveSelectionEntries,
    handleItemClick,
    bulkDeleteSelected,
  };
}