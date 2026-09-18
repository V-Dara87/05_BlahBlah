import { useEffect } from 'react';
import { SECTIONS_CONFIG, selKey } from '../../components/project/projectPanelConstants';
 
/**
 * Wires the Explorer's keyboard shortcuts (Escape, Alt+Arrow nav, F2, Delete,
 * Ctrl/Cmd+A) to a single document-level keydown listener, active only while
 * the Explorer panel has focus (except Escape, which is global).
 *
 * @param {object} params
 * @param {{current: HTMLElement|null}} params.panelRef
 * @param {Set<string>} params.selectedItems
 * @param {(s: Set<string>) => void} params.setSelectedItems
 * @param {() => void} params.clearSelection
 * @param {object|null} params.ctxMenu
 * @param {(v:object|null) => void} params.setCtxMenu
 * @param {{section:string|null, folder:string|null}} params.currentLocation
 * @param {any[]} params.filteredItemsInView
 * @param {() => void} params.goBack
 * @param {() => void} params.goForward
 * @param {() => void} params.goUp
 * @param {() => Array<{kind:string, item:any}>} params.resolveSelectionEntries
 * @param {(kind:string, item:any) => void} params.startRename
 * @param {() => void} params.bulkDeleteSelected
 */
export function useExplorerKeyboardShortcuts({
  panelRef,
  selectedItems,
  setSelectedItems,
  clearSelection,
  ctxMenu,
  setCtxMenu,
  currentLocation,
  filteredItemsInView,
  goBack,
  goForward,
  goUp,
  resolveSelectionEntries,
  startRename,
  bulkDeleteSelected,
}) {
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const inInput =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const panel = panelRef.current;
      const panelFocused = panel && (panel.contains(t) || panel === document.activeElement);
 
      if (e.key === 'Escape') {
        if (selectedItems.size > 0 && !inInput) clearSelection();
        if (ctxMenu) setCtxMenu(null);
        return;
      }
 
      if (inInput) return;
 
      if (panelFocused) {
        // Alt + Left = Go Back
        if (e.altKey && e.key === 'ArrowLeft') {
          e.preventDefault();
          goBack();
          return;
        }
        // Alt + Right = Go Forward
        if (e.altKey && e.key === 'ArrowRight') {
          e.preventDefault();
          goForward();
          return;
        }
        // Alt + Up or Backspace = Go Up
        if ((e.altKey && e.key === 'ArrowUp') || e.key === 'Backspace') {
          e.preventDefault();
          goUp();
          return;
        }
        // F2 = Rename
        if (e.key === 'F2' && selectedItems.size === 1) {
          e.preventDefault();
          const [entry] = resolveSelectionEntries();
          if (entry && entry.kind !== 'shared') startRename(entry.kind, entry.item);
          return;
        }
        // Delete = Delete selected
        if (e.key === 'Delete' && selectedItems.size > 0) {
          e.preventDefault();
          bulkDeleteSelected();
          return;
        }
        // Ctrl + A = Select all
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
          e.preventDefault();
          if (currentLocation.section) {
            const kind = SECTIONS_CONFIG[currentLocation.section]?.dropKind;
            if (kind) {
              const allKeys = filteredItemsInView.map((i) => selKey(kind, i.id));
              setSelectedItems(new Set(allKeys));
            }
          }
          return;
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    panelRef,
    selectedItems,
    setSelectedItems,
    clearSelection,
    ctxMenu,
    setCtxMenu,
    currentLocation,
    filteredItemsInView,
    goBack,
    goForward,
    goUp,
    resolveSelectionEntries,
    startRename,
    bulkDeleteSelected,
  ]);
}