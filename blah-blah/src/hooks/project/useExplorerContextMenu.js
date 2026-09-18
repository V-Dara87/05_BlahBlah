import { useCallback } from 'react';
import { selKey } from '../../components/project/projectPanelConstants';
 
/**
 * Owns the single right-click context menu's open logic and dispatches
 * its actions to the handlers supplied by navigation/selection/file-ops hooks.
 * ctxMenu state itself is owned by the caller (declared early, before the
 * selection/file-ops/drag-drop hooks that need to be able to close it).
 *
 * @param {object} params
 * @param {object|null} params.ctxMenu
 * @param {(v:object|null) => void} params.setCtxMenu
 * @param {{section:string|null, folder:string|null}} params.currentLocation
 * @param {Set<string>} params.selectedItems
 * @param {(s: Set<string>) => void} params.setSelectedItems
 * @param {{current:string|null}} params.lastClickedKeyRef
 * @param {() => Array<{kind:string, item:any}>} params.resolveSelectionEntries
 * @param {() => void} params.clearSelection
 * @param {(kind:string, item:any) => void} params.deleteItem
 * @param {(section:string, name:string) => void} params.deleteFolder
 * @param {(section:string, item:any) => void} params.startRename - actually (kind, item)
 * @param {(section:string, name:string) => void} params.startFolderRename
 * @param {(loc:{section:string, folder:string|null}) => void} params.navigateTo
 * @param {(kind:string, item:any) => void} params.handleItemDoubleClick
 * @param {(v:string|null) => void} params.setCreatingFolder
 * @param {(v:string) => void} params.setNewFolderName
 * @param {{current:any}} params.importTargetFolderRef
 * @param {{current:any}} params.fileInputRef
 * @param {{current:any}} params.replaceFileInputRef
 * @param {(id:string|null) => void} params.setReplaceTarget
 * @param {() => void} params.handleCreateNewScript
 * @param {() => void} params.onAddEmptyClip
 * @param {(id:string) => void} params.onEnterPrefabMode
 * @param {(item:any) => void} params.onAddPrefabToTimeline
 * @param {(item:any) => void} params.onReplaceMediaAsset
 * @param {(item:any) => void} params.onSharePrefab
 * @param {(item:any) => void} params.onShareScript
 */
export function useExplorerContextMenu({
  ctxMenu,
  setCtxMenu,
  currentLocation,
  selectedItems,
  setSelectedItems,
  lastClickedKeyRef,
  resolveSelectionEntries,
  clearSelection,
  deleteItem,
  deleteFolder,
  startRename,
  startFolderRename,
  navigateTo,
  handleItemDoubleClick,
  setCreatingFolder,
  setNewFolderName,
  importTargetFolderRef,
  fileInputRef,
  replaceFileInputRef,
  setReplaceTarget,
  handleCreateNewScript,
  onAddEmptyClip,
  onEnterPrefabMode,
  onAddPrefabToTimeline,
  onReplaceMediaAsset,
  onSharePrefab,
  onShareScript,
}) {
  const closeCtxMenu = useCallback(() => setCtxMenu(null), [setCtxMenu]);
 
  const openEmptyMenu = useCallback((e, section, folder = null) => {
    e.preventDefault();
    if (
      e.target.closest('.asset-card') ||
      e.target.closest('.explorer-details-row') ||
      e.target.closest('.explorer-tree-node')
    )
      return;
    const sec = section || currentLocation.section || 'media';
    const fld = folder ?? (currentLocation.section === sec ? currentLocation.folder : null);
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      target: { kind: 'empty', section: sec, folder: fld || null },
    });
  }, [currentLocation]);
 
  const openItemMenuSafe = useCallback((e, kind, item) => {
    e.preventDefault();
    e.stopPropagation();
    const key = selKey(kind, item.id);
    if (selectedItems.has(key) && selectedItems.size > 1) {
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        target: { kind: 'multi', items: resolveSelectionEntries() },
      });
      return;
    }
    if (!selectedItems.has(key)) {
      setSelectedItems(new Set([key]));
      lastClickedKeyRef.current = key;
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind, item } });
  }, [selectedItems, resolveSelectionEntries, setSelectedItems, lastClickedKeyRef]);
 
  const openFolderMenu = useCallback((e, section, folderName) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      target: { kind: 'folder', section, name: folderName },
    });
  }, []);
 
  const handleContextAction = useCallback((action) => {
    if (!ctxMenu) return;
    const { target } = ctxMenu;
    if (action === 'new-folder') {
      const section = target.section || currentLocation.section || 'media';
      setCreatingFolder(section);
      setNewFolderName('');
      setCtxMenu(null);
    } else if (action === 'new-clip') {
      setCtxMenu(null);
      onAddEmptyClip?.();
    } else if (action === 'new-script') {
      setCtxMenu(null);
      handleCreateNewScript();
    } else if (action === 'import-media') {
      const destFolder =
        target.kind === 'folder'
          ? target.name
          : target.folder ??
            (currentLocation.section === 'media' ? currentLocation.folder : null);
      importTargetFolderRef.current = destFolder || null;
      setCtxMenu(null);
      fileInputRef.current?.click();
    } else if (action === 'open') {
      setCtxMenu(null);
      if (target.kind === 'folder') {
        navigateTo({ section: target.section, folder: target.name });
      } else if (target.item) {
        handleItemDoubleClick(target.kind, target.item);
      }
    } else if (action === 'edit-prefab') {
      setCtxMenu(null);
      if (target.item) {
        onEnterPrefabMode?.(target.item.id);
      }
    } else if (action === 'add-to-timeline') {
      setCtxMenu(null);
      if (target.item) {
        onAddPrefabToTimeline?.(target.item);
      }
    } else if (action === 'rename') {
      if (target.kind === 'folder') startFolderRename(target.section, target.name);
      else startRename(target.kind, target.item);
    } else if (action === 'replace') {
      if (target.kind === 'media' && onReplaceMediaAsset) {
        setReplaceTarget(target.item.id);
        setCtxMenu(null);
        setTimeout(() => replaceFileInputRef.current?.click(), 0);
      }
    } else if (action === 'delete') {
      if (target.kind === 'multi') {
        if (target.items.length > 1 && !window.confirm(`Delete ${target.items.length} item(s)?`))
          return;
        setCtxMenu(null);
        clearSelection();
        target.items.forEach(({ kind, item }) => deleteItem(kind, item));
      } else if (target.kind === 'folder') {
        deleteFolder(target.section, target.name);
      } else {
        setCtxMenu(null);
        deleteItem(target.kind, target.item);
      }
    } else if (action === 'share') {
      setCtxMenu(null);
      if (target.kind === 'multi') {
        target.items.forEach(({ kind, item }) => {
          if (kind === 'prefab') onSharePrefab?.(item);
          else if (kind === 'script') onShareScript?.(item);
        });
      } else if (target.kind === 'prefab') onSharePrefab?.(target.item);
      else if (target.kind === 'script') onShareScript?.(target.item);
    }
  }, [
    ctxMenu,
    currentLocation,
    setCreatingFolder,
    setNewFolderName,
    onAddEmptyClip,
    handleCreateNewScript,
    importTargetFolderRef,
    fileInputRef,
    navigateTo,
    handleItemDoubleClick,
    onEnterPrefabMode,
    onAddPrefabToTimeline,
    startFolderRename,
    startRename,
    onReplaceMediaAsset,
    setReplaceTarget,
    replaceFileInputRef,
    clearSelection,
    deleteItem,
    deleteFolder,
    onSharePrefab,
    onShareScript,
  ]);
 
  return {
    closeCtxMenu,
    openEmptyMenu,
    openItemMenuSafe,
    openFolderMenu,
    handleContextAction,
  };
}