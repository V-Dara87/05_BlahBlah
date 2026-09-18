import { useState, useCallback } from 'react';
import { KIND_REGISTRY } from '../../components/project/kindRegistry';
import { selKey } from '../../components/project/projectPanelConstants';
import { importMediaFiles } from '../../services/mediaImport';
import {
  deleteFolderFromProject,
  renameFolderInProject,
} from '../../services/projectFileSystem';
import {
  setDragPayload,
  readDragPayload,
  dragHasItemKind,
} from '../../utils/dragData';
 
/**
 * Owns everything that mutates the Explorer's items/folders on disk or in
 * state: renaming (items + folders), folder creation/deletion, media
 * upload/replace, new-script creation, drag-start payloads, and folder
 * drag-over/drop (including multi-item drags of the current selection).
 *
 * Drag-drop and file-ops used to be two separate hooks, but a folder drop of
 * OS files needs to call straight into file upload, and file upload needs
 * `moveItemToFolder` from drag-drop for folder-rename bookkeeping — so they're
 * combined here to avoid a ref-based workaround for the circular dependency.
 *
 * @param {object} params
 * @param {object} params.registryCtx
 * @param {any} params.projectFolderHandle
 * @param {Record<string, any[]>} params.itemsBySection
 * @param {{section:string|null, folder:string|null}} params.currentLocation
 * @param {(section:string, updater:(prev:string[]) => string[]) => void} params.setExtraFoldersFor
 * @param {(section:string, updater:(prev:object) => object) => void} params.setOpenSubfoldersFor
 * @param {Set<string>} params.selectedItems
 * @param {(kind:string, item:any) => void} params.deleteItem
 * @param {(section:string, oldName:string, newName:string) => void} params.renameCurrentFolderIfActive
 * @param {(loc:{section:string, folder:string|null}) => void} params.navigateTo
 * @param {{kind:string,id:string,name:string,section?:string}|null} params.renaming
 * @param {(r:object|null) => void} params.setRenaming
 * @param {string|null} params.creatingFolder
 * @param {(v:string|null) => void} params.setCreatingFolder
 * @param {string} params.newFolderName
 * @param {(v:string) => void} params.setNewFolderName
 * @param {() => void} params.closeCtxMenu
 * @param {any[]} params.mediaAssets
 * @param {(asset:any) => void} params.onAddMediaAsset
 * @param {(count:number) => void} params.setDupeNotice
 * @param {any} params.importTargetFolderRef
 * @param {{current:string|null}} params.replaceTarget
 * @param {(target:string|null) => void} params.setReplaceTarget
 * @param {(target:any, file:File) => void} params.onReplaceMediaAsset
 * @param {any[]} params.scripts
 * @param {(script:any) => Promise<void>} params.onCreateScript
 * @param {(script:any) => void} params.onOpenScriptEditor
 */
export function useExplorerFileManager({
  registryCtx,
  projectFolderHandle,
  itemsBySection,
  currentLocation,
  setExtraFoldersFor,
  setOpenSubfoldersFor,
  selectedItems,
  deleteItem,
  renameCurrentFolderIfActive,
  navigateTo,
  renaming,
  setRenaming,
  creatingFolder,
  setCreatingFolder,
  newFolderName,
  setNewFolderName,
  closeCtxMenu,
  mediaAssets,
  onAddMediaAsset,
  setDupeNotice,
  importTargetFolderRef,
  replaceTarget,
  setReplaceTarget,
  onReplaceMediaAsset,
  scripts,
  onCreateScript,
  onOpenScriptEditor,
}) {
  // ── Drag & Drop primitives (defined first: file-ops' handleFileUpload and
  // commitFolderRename both need moveItemToFolder) ────────────────────────
  const [dragOverKey, setDragOverKeyState] = useState(null);
 
  const handleDragStart = useCallback((e, itemType, itemData) => {
    setDragPayload(e.dataTransfer, itemType, itemData);
  }, []);
 
  const moveItemToFolder = useCallback((kind, id, folderName) => {
    KIND_REGISTRY[kind]?.moveFn(id, folderName, registryCtx);
    if (folderName) {
      const section =
        kind === 'prefab'
          ? 'prefabs'
          : kind === 'script'
          ? 'scripts'
          : kind === 'shared'
          ? 'shared'
          : 'media';
      setExtraFoldersFor(section, (prev) =>
        prev.includes(folderName) ? prev : [...prev, folderName]
      );
    }
  }, [registryCtx, setExtraFoldersFor]);
 
  const isOsFileDrag = useCallback(
    (dt) => Boolean(dt?.types && Array.from(dt.types).includes('Files')),
    []
  );
 
  const handleFolderDragOver = useCallback((e, itemKind, dropKey) => {
    const isOsFile = isOsFileDrag(e.dataTransfer);
    if (!dragHasItemKind(e.dataTransfer, itemKind) && !(isOsFile && itemKind === 'media')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverKeyState((prev) => (prev !== dropKey ? dropKey : prev));
  }, [isOsFileDrag]);
 
  const handleFolderDragLeave = useCallback(() => setDragOverKeyState(null), []);
 
  // ── Renaming ───────────────────────────────────────────────────────────
  const startRename = useCallback((kind, item) => {
    setRenaming({ kind, id: item.id, name: item.name || '' });
    closeCtxMenu();
  }, [setRenaming, closeCtxMenu]);
 
  const startFolderRename = useCallback((section, name) => {
    setRenaming({ kind: 'folder', section, id: name, name });
    closeCtxMenu();
  }, [setRenaming, closeCtxMenu]);
 
  const commitFolderRename = useCallback(async (section, oldName, newName) => {
    if (!newName || newName === oldName) return;
    const kind = section === 'prefabs' ? 'prefab' : section === 'scripts' ? 'script' : section === 'shared' ? 'shared' : 'media';
 
    if (projectFolderHandle && section !== 'shared') {
      await renameFolderInProject(projectFolderHandle, section, oldName, newName).catch((err) => {
        console.warn('Could not rename folder on disk:', err);
      });
    }
 
    (itemsBySection[section] || [])
      .filter((i) => i.folder === oldName)
      .forEach((i) => moveItemToFolder(kind, i.id, newName));
 
    setExtraFoldersFor(section, (prev) => {
      const next = prev.filter((f) => f !== oldName);
      if (!next.includes(newName)) next.push(newName);
      return next;
    });
    setOpenSubfoldersFor(section, (prev) => {
      const next = { ...prev };
      delete next[oldName];
      next[newName] = true;
      return next;
    });
 
    renameCurrentFolderIfActive(section, oldName, newName);
  }, [
    projectFolderHandle,
    itemsBySection,
    moveItemToFolder,
    setExtraFoldersFor,
    setOpenSubfoldersFor,
    renameCurrentFolderIfActive,
  ]);
 
  const commitRename = useCallback(async () => {
    if (!renaming) return;
    const name = (renaming.name || '').trim();
    if (name) {
      if (renaming.kind === 'folder') {
        commitFolderRename(renaming.section, renaming.id, name);
      } else {
        try {
          await KIND_REGISTRY[renaming.kind]?.renameFn?.(renaming.id, name, registryCtx);
        } catch (err) {
          console.error('Could not rename item:', err);
          return;
        }
      }
    }
    setRenaming(null);
  }, [renaming, commitFolderRename, registryCtx, setRenaming]);
 
  const renameInput = useCallback((kind, item) => {
    if (!renaming || renaming.kind !== kind || renaming.id !== item.id) return null;
    return (
      <input
        type="text"
        className="asset-rename-input"
        value={renaming.name}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitRename();
          else if (e.key === 'Escape') setRenaming(null);
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }, [renaming, setRenaming, commitRename]);
 
  const folderRenameInput = useCallback((section, folderName) => {
    if (!renaming || renaming.kind !== 'folder' || renaming.section !== section || renaming.id !== folderName)
      return null;
    return (
      <input
        type="text"
        className="asset-rename-input"
        value={renaming.name}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitRename();
          else if (e.key === 'Escape') setRenaming(null);
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }, [renaming, setRenaming, commitRename]);
 
  // ── Folder creation & deletion ────────────────────────────────────────
  const commitNewFolder = useCallback(async () => {
    const section = creatingFolder || currentLocation.section || 'media';
    const name = (newFolderName || '').trim();
    if (name && !/[\\/:*?"<>|]/.test(name) && name !== '.' && name !== '..') {
      const rootName = section === 'prefabs' ? 'prefabs' : section;
      if (section !== 'shared' && projectFolderHandle) {
        try {
          const root = await projectFolderHandle.getDirectoryHandle(rootName, { create: true });
          await root.getDirectoryHandle(name, { create: true });
        } catch (err) {
          console.error('Could not create folder on disk:', err);
        }
      }
      setExtraFoldersFor(section, (prev) => (prev.includes(name) ? prev : [...prev, name]));
      setOpenSubfoldersFor(section, (prev) => ({ ...prev, [name]: true }));
    }
    setCreatingFolder(null);
    setNewFolderName('');
  }, [
    creatingFolder,
    currentLocation.section,
    newFolderName,
    projectFolderHandle,
    setExtraFoldersFor,
    setOpenSubfoldersFor,
    setCreatingFolder,
    setNewFolderName,
  ]);
 
  const deleteFolder = useCallback(async (section, name) => {
    closeCtxMenu();
    if (!section || !name) return; // Prevent deleting root or null folders
    const kind =
      section === 'prefabs'
        ? 'prefab'
        : section === 'scripts'
        ? 'script'
        : section === 'shared'
        ? 'shared'
        : 'media';
 
    const itemsInThisFolder = (itemsBySection[section] || []).filter(
      (i) => i.folder === name
    );
 
    if (
      itemsInThisFolder.length > 0 &&
      !window.confirm(
        `Delete folder "${name}" and all ${itemsInThisFolder.length} item(s) inside it?`
      )
    ) {
      return;
    }
 
    for (const item of itemsInThisFolder) {
      deleteItem(kind, item);
    }
 
    if (projectFolderHandle && section !== 'shared') {
      await deleteFolderFromProject(projectFolderHandle, section, name).catch((err) => {
        console.warn('Could not delete folder from disk:', err);
      });
    }
 
    setExtraFoldersFor(section, (prev) => prev.filter((f) => f !== name));
    setOpenSubfoldersFor(section, (prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
 
    if (currentLocation.section === section && currentLocation.folder === name) {
      navigateTo({ section, folder: null });
    }
  }, [
    closeCtxMenu,
    itemsBySection,
    deleteItem,
    projectFolderHandle,
    setExtraFoldersFor,
    setOpenSubfoldersFor,
    currentLocation,
    navigateTo,
  ]);
 
  // ── File actions ──────────────────────────────────────────────────────
  const handleFileUpload = useCallback((files, explicitFolder = undefined) => {
    const destFolder =
      explicitFolder !== undefined
        ? explicitFolder
        : importTargetFolderRef.current !== undefined
        ? importTargetFolderRef.current
        : currentLocation.section === 'media' && currentLocation.folder
        ? currentLocation.folder
        : null;
    importTargetFolderRef.current = undefined;
 
    importMediaFiles({
      files,
      onAddMediaAsset: (asset) => {
        if (destFolder) {
          asset.folder = destFolder;
        }
        onAddMediaAsset?.(asset);
      },
      mediaAssets,
      onDuplicatesDetected: (count) => setDupeNotice(count),
    });
  }, [importTargetFolderRef, currentLocation, onAddMediaAsset, mediaAssets, setDupeNotice]);
 
  const handleReplaceFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file && replaceTarget) onReplaceMediaAsset?.(replaceTarget, file);
    e.target.value = '';
    setReplaceTarget(null);
  }, [replaceTarget, onReplaceMediaAsset, setReplaceTarget]);
 
  const handleCreateNewScript = useCallback(async () => {
    const usedNames = new Set(scripts.map((s) => s.name.toLowerCase()));
    let number = 1;
    let name = 'NewScript.jsx';
    while (usedNames.has(name.toLowerCase())) {
      number += 1;
      name = `NewScript ${number}.jsx`;
    }
    const targetFolder =
      currentLocation.section === 'scripts' && currentLocation.folder
        ? currentLocation.folder
        : null;
 
    const newScript = {
      id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      folder: targetFolder,
      description: 'Blank JavaScript Motion script',
      code: `import { CanvasComponent } from '@blahblah/sdk';
 
export default class NewScript extends CanvasComponent {
  static props = {};
 
  onMount({ container, canvasWidth, canvasHeight }) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = canvasWidth || 800;
    this.canvas.height = canvasHeight || 600;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }
 
  onUpdate({ time, canvasWidth, canvasHeight }) {
    if (!this.ctx) return;
    if (this.canvas.width !== canvasWidth || this.canvas.height !== canvasHeight) {
      this.canvas.width = canvasWidth;
      this.canvas.height = canvasHeight;
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const x = this.canvas.width / 2 + Math.sin(time * 2) * 50;
    const y = this.canvas.height / 2;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.beginPath();
    this.ctx.arc(x, y, 8, 0, Math.PI * 2);
    this.ctx.fill();
  }
 
  onUnmount({ container }) {
    if (this.canvas?.parentNode === container) {
      container.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
  }
}`,
    };
    try {
      await onCreateScript?.(newScript);
    } catch (err) {
      console.error('Could not create script:', err);
      return;
    }
    onOpenScriptEditor?.(newScript);
  }, [scripts, currentLocation, onCreateScript, onOpenScriptEditor]);
 
  // ── Folder drop (needs handleFileUpload + moveItemToFolder, both above) ─
  const handleFolderDrop = useCallback((e, section, folderName, itemKind) => {
    const isOsFile = isOsFileDrag(e.dataTransfer);
    const hasFiles = (e.dataTransfer?.files?.length ?? 0) > 0;
 
    if (isOsFile && hasFiles && (section === 'media' || itemKind === 'media')) {
      e.preventDefault();
      e.stopPropagation();
      setDragOverKeyState(null);
      handleFileUpload(e.dataTransfer.files, folderName || null);
      return;
    }
 
    if (!dragHasItemKind(e.dataTransfer, itemKind)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverKeyState(null);
    const payload = readDragPayload(e.dataTransfer);
    const draggedId = payload?.itemData?.id;
    if (!draggedId) return;
    const key = selKey(section, draggedId);
    if (selectedItems.has(key) && selectedItems.size > 1) {
      selectedItems.forEach((k) => {
        const [kKind, id] = k.split(':');
        if (kKind === section) moveItemToFolder(kKind, id, folderName);
      });
    } else {
      moveItemToFolder(section, draggedId, folderName);
    }
  }, [isOsFileDrag, handleFileUpload, selectedItems, moveItemToFolder]);
 
  return {
    // drag & drop
    dragOverKey,
    handleDragStart,
    moveItemToFolder,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleFolderDrop,
    // renaming
    startRename,
    startFolderRename,
    commitFolderRename,
    commitRename,
    renameInput,
    folderRenameInput,
    // folders
    commitNewFolder,
    deleteFolder,
    // files
    handleFileUpload,
    handleReplaceFile,
    handleCreateNewScript,
  };
}