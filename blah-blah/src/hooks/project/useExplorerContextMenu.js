import { useCallback } from 'react';
import { selKey } from '../../components/project/projectPanelConstants';
import { joinPath } from '../../services/tauriFsAdapter';
import { openProjectInExplorer, revealPathInExplorer } from '../../services/ideLauncher';
 
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
 * @param {(kind:'prefab'|'script'|'media', item:any) => any} params.onShareToLibrary
 *   Copies one project item into the app-wide Shared Library.
 * @param {{path?:string}|null} params.projectFolderHandle - project root (Tauri handles carry `.path`)
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
  onShareToLibrary,
  projectFolderHandle,
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
    // Root ("This Project") has no context menu: nothing can be created or
    // imported outside a section. Previously this silently fell back to
    // 'media', which showed a misleading New Folder / Import menu at root.
    const sec = section || currentLocation.section;
    if (!sec) return;
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
    // At root the four system-folder cards/rows must not open a menu.
    // (The nav-pane tree is unaffected: it lives outside the root content view
    // and keeps its Open / Import Media menu for sections and subfolders.)
    if (!currentLocation.section && !folderName && !e.target.closest('.explorer-tree-node')) {
      return;
    }
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      target: { kind: 'folder', section, name: folderName },
    });
  }, [currentLocation]);
 
  // Sections that actually live on disk under the project root. The Shared
  // Library is browser storage (see sharedLibraryStorage.js) — no path.
  const DISK_SECTIONS = { media: 'media', prefabs: 'prefabs', scripts: 'scripts' };
  const KIND_TO_SECTION = { media: 'media', prefab: 'prefabs', script: 'scripts' };
 
  /**
   * Resolve a context-menu target to { path, reveal } for the OS file manager.
   *   reveal:true  -> select this file inside its parent (revealItemInDir)
   *   reveal:false -> open this folder (openPath)
   * Returns null when there is nothing on disk to show (Shared Library,
   * no project path, browser build, or an unresolvable target).
   */
  const resolveDiskTarget = useCallback((target) => {
    const root = projectFolderHandle?.path;
    if (!root || !target) return null;
    const folderPath = (section, folder) => {
      const dir = DISK_SECTIONS[section];
      return dir ? joinPath(root, dir, folder || '') : null;
    };
 
    if (target.kind === 'empty') {
      const path = folderPath(target.section, target.folder);
      return path ? { path, reveal: false } : null;
    }
    if (target.kind === 'folder') {
      const path = folderPath(target.section, target.name);
      return path ? { path, reveal: false } : null;
    }
    if (target.kind === 'multi') {
      // Can't reveal several files at once — open the folder being browsed.
      const path = folderPath(currentLocation.section, currentLocation.folder);
      return path ? { path, reveal: false } : null;
    }
 
    const section = KIND_TO_SECTION[target.kind];
    const item = target.item;
    if (!section || !item) return null; // 'shared' and unknown kinds
 
    if (target.kind === 'media') {
      if (item.path) return { path: item.path, reveal: true };
      const dir = folderPath('media', item.folder);
      return dir ? { path: joinPath(dir, item.name), reveal: true } : null;
    }
    const dir = folderPath(section, item.folder);
    if (!dir) return null;
    const rawName = String(item.name || '');
    const fileName =
      target.kind === 'script'
        ? `${rawName.replace(/\.(js|jsx|ts|tsx|cs)$/i, '')}.jsx`
        : /\.json$/i.test(rawName)
        ? rawName
        : `${rawName}.prefab.json`;
    return { path: joinPath(dir, fileName), reveal: true };
  }, [projectFolderHandle, currentLocation]);
 
  const handleContextAction = useCallback((action) => {
    if (!ctxMenu) return;
    const { target } = ctxMenu;
    if (action === 'open-in-explorer') {
      const disk = resolveDiskTarget(target);
      setCtxMenu(null);
      if (!disk) return;
      if (disk.reveal) revealPathInExplorer(disk.path);
      else openProjectInExplorer(disk.path);
      return;
    }
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
        // Single item (media/prefab/script/shared): previously deleted
        // immediately with no confirmation, unlike the multi-select and
        // folder-with-contents paths above. Name-aware prompt so it reads
        // naturally for one item instead of the generic "1 item(s)?".
        const label = target.item?.name ? `"${target.item.name}"` : 'this item';
        if (!window.confirm(`Delete ${label}? This can't be undone.`)) return;
        setCtxMenu(null);
        deleteItem(target.kind, target.item);
      }
    } else if (action === 'share') {
      setCtxMenu(null);
      if (target.kind === 'multi') {
        target.items.forEach(({ kind, item }) => onShareToLibrary?.(kind, item));
      } else {
        onShareToLibrary?.(target.kind, target.item);
      }
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
    onShareToLibrary,
    resolveDiskTarget,
  ]);
 
  return {
    closeCtxMenu,
    openEmptyMenu,
    openItemMenuSafe,
    openFolderMenu,
    handleContextAction,
    resolveDiskTarget,
  };
}