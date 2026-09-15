import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import {
  Package,
  Film,
  Music,
  FileCode,
  Plus,
  Upload,
  Trash2,
  Search,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Code,
  Share2,
  LayoutGrid,
  List,
  Pencil,
  FolderPlus,
  Layers,
} from 'lucide-react';
import { formatTimecode } from '../utils/timeFormat';
import { detectScriptKind } from '../engine/scriptRunner';
import { importMediaFiles } from '../services/mediaImport';
import { isTauri } from '../services/tauriFsAdapter';
import { openProjectInVsCode } from '../services/ideLauncher';
import { setDragPayload, readDragPayload, dragHasItemKind, ITEM_KIND_MEDIA, ITEM_KIND_PREFAB, ITEM_KIND_SCRIPT, ITEM_KIND_SHARED } from '../utils/dragData';
import { ContextMenu } from './ContextMenu';
import { AssetPreviewPopover } from './project/AssetPreviewPopover';
import { useSectionFolders } from './project/useSectionFolders';
import { FolderSection } from './project/FolderSection';
import {
  scriptKindMeta,
  shortDuration,
  SORT_OPTIONS,
  MEDIA_SORT_OPTIONS,
  selKey,
} from './project/projectPanelConstants';
 
 
/**
 * Project file explorer — the single project navigation surface (the old
 * standalone Clips tab was removed; clips live on the timeline).
 *
 * Contents are organized as a folder tree matching the on-disk project
 * layout (Shared Library / prefabs incl. subfolders / media incl.
 * subfolders / scripts incl. subfolders), with a Grid ⇄ List view toggle,
 * hover asset previews, multi-select (click / Ctrl+click / Shift+range),
 * bulk actions on multi-selection (delete with confirm, save-to-shared for
 * prefab/script selections), right-click context menus (items: Rename /
 * Replace (media) / Delete / Save to Shared Library; folders: Rename /
 * Delete (moves contents to root); empty space: New Folder in the
 * right-clicked section / New Empty Clip / New Script), drag-to-folder
 * reorganization, per-section sorting, and media/script type filters.
 * Every asset card is draggable onto the timeline, and script cards also
 * drop onto Inspector / timeline clips to attach scripts.
 */
export const ProjectPanel = memo(function ProjectPanel({
  mediaAssets,
  prefabs,
  scripts,
  projectFolderHandle,
  // App-wide Shared Library (persists outside any project folder)
  sharedItems = [],
  onRemoveSharedItem,
  onMoveSharedItem,
  onSharePrefab,
  onShareScript,
  onImportSharedItem,
  onAddMediaAsset,
  onRemoveMediaAsset,
  onMoveMediaAsset,
  onReplaceMediaAsset,
  onMovePrefab,
  onMoveScript,
  onRemovePrefab,
  onRemoveScript,
  onRenameMediaAsset,
  onRenamePrefab,
  onRenameScript,
  onCreateScript,
  onOpenScriptEditor,
  onAddPrefabToTimeline,
  onAddMediaToTimeline,
  onAddEmptyClip,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [openFolders, setOpenFolders] = useState({
    shared: true,
    prefabs: true,
    media: true,
    scripts: true,
  });
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const [scriptsMenuOpen, setScriptsMenuOpen] = useState(false);
  const fileInputRef = useRef(null);
  const replaceFileInputRef = useRef(null);
  const panelRef = useRef(null);
  const [replaceTarget, setReplaceTarget] = useState(null); // media asset id awaiting a replacement file
 
  // Context menu: { x, y, target } where target is
  // { kind: 'empty', section? } | { kind: 'folder', section, name } |
  // { kind: 'multi', items: [{kind, item}, ...] } |
  // { kind: 'shared'|'prefab'|'media'|'script', item }
  const [ctxMenu, setCtxMenu] = useState(null);
  const [preview, setPreview] = useState(null); // { x, y, kind, item }
  const [renaming, setRenaming] = useState(null); // { kind, id, name, section? }
  // Section-aware folder creation: null (off) | 'media' | 'prefabs' | 'scripts'
  const [creatingFolder, setCreatingFolder] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  // Folder-tree state for all four sections (open subfolders, context-menu
  // folders, and the derived folder lists) lives in one hook now.
  // See project/useSectionFolders.js.
  const itemsBySection = useMemo(
    () => ({ media: mediaAssets, prefabs, scripts, shared: sharedItems }),
    [mediaAssets, prefabs, scripts, sharedItems],
  );
  const {
    openSubfolders,
    extraFolders: extraFoldersBySection,
    foldersBySection,
    setExtraFoldersFor,
    setOpenSubfoldersFor,
    toggleSubfolder,
  } = useSectionFolders({ projectFolderHandle, itemsBySection });
 
  const openMediaSubfolders = openSubfolders.media;
  const openPrefabSubfolders = openSubfolders.prefabs;
  const openScriptSubfolders = openSubfolders.scripts;
  const openSharedSubfolders = openSubfolders.shared;
  const allMediaFolders = foldersBySection.media;
  const allPrefabFolders = foldersBySection.prefabs;
  const allScriptFolders = foldersBySection.scripts;
  const allSharedFolders = foldersBySection.shared;
  const extraFolders = extraFoldersBySection.media;
  const prefabExtraFolders = extraFoldersBySection.prefabs;
  const scriptExtraFolders = extraFoldersBySection.scripts;
  const sharedExtraFolders = extraFoldersBySection.shared;
 
  // ── Multi-select (Feature 1) ─────────────────────────────────────────────
  // Set of composite keys `${kind}:${id}`. Can span kinds via Ctrl+click,
  // but shift-range is confined to one section (see sectionOrder below).
  const [selectedItems, setSelectedItems] = useState(() => new Set());
  const lastClickedKeyRef = useRef(null);
 
  // ── Sorting (Feature 6) ──────────────────────────────────────────────────
  const [sortBy, setSortBy] = useState('date-desc');
 
  // ── Type filtering (Feature 7) ───────────────────────────────────────────
  const [mediaTypeFilter, setMediaTypeFilter] = useState({ video: true, audio: true });
  const [scriptKindFilter, setScriptKindFilter] = useState({ react: true, canvas: true, motion: true });
 
  // ── Duplicate-import notice (Feature 8) ──────────────────────────────────
  const [dupeNotice, setDupeNotice] = useState(null); // count of likely duplicates
 
  // Folder currently glowing as a drag-drop target: `${section}:${folderName}`
  const [dragOverKey, setDragOverKey] = useState(null);
 
  // Outside-click / Escape-to-close now lives in the shared <ContextMenu>
  // shell (see components/ContextMenu.jsx) — it owns its own listeners and
  // calls this back once its closing animation finishes.
  const closeCtxMenu = () => setCtxMenu(null);
 
  // ── Selection helpers (Feature 1) ────────────────────────────────────────
  const clearSelection = () => setSelectedItems(new Set());
 
  const isSelected = (kind, item) => selectedItems.has(selKey(kind, item.id));
 
  // Contiguous order of one section's visible items, used for shift-range.
  const sectionOrder = (kind) => {
    if (kind === 'shared') return filteredShared.map((i) => selKey('shared', i.id));
    if (kind === 'prefab') return filteredPrefabs.map((i) => selKey('prefab', i.id));
    if (kind === 'media') return filteredMedia.map((i) => selKey('media', i.id));
    if (kind === 'script') return filteredScripts.map((i) => selKey('script', i.id));
    return [];
  };
 
  // Selection click policy: plain = select only this; Ctrl/Cmd = toggle;
  // Shift = range-select within the same section (a missing / cross-section
  // anchor degrades to a fresh single-select, per spec).
  const handleItemClick = (e, kind, item) => {
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
      const order = sectionOrder(kind);
      const fromIdx = order.indexOf(lastClickedKeyRef.current);
      const toIdx = order.indexOf(key);
      if (lastClickedKeyRef.current && fromIdx !== -1 && toIdx !== -1) {
        const min = Math.min(fromIdx, toIdx);
        const max = Math.max(fromIdx, toIdx);
        setSelectedItems(new Set(order.slice(min, max + 1)));
      } else {
        setSelectedItems(new Set([key]));
      }
      lastClickedKeyRef.current = key;
    } else {
      setSelectedItems(new Set([key]));
      lastClickedKeyRef.current = key;
    }
  };
 
  // Resolve every selected key to its live { kind, item } pair (stale keys
  // from deleted items are dropped).
  const resolveSelectionEntries = () => {
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
  };
 
  const deleteItem = (kind, item) => {
    if (kind === 'media') onRemoveMediaAsset?.(item.id);
    else if (kind === 'prefab') onRemovePrefab?.(item.id);
    else if (kind === 'script') onRemoveScript?.(item.id);
    else if (kind === 'shared') onRemoveSharedItem?.(item.id);
  };
 
  // Bulk delete for multi-selection (keyboard Delete/Backspace too). Deletes
  // are sequenced per item (handlers are synchronous state updates; ordering
  // avoids write races with any async side effects).
  const bulkDeleteSelected = useCallback(() => {
    if (selectedItems.size === 0) return;
    const entries = resolveSelectionEntries();
    if (entries.length === 0) return;
    if (entries.length > 1 && !window.confirm(`Delete ${entries.length} item(s)?`)) return;
    closeCtxMenu();
    clearSelection();
    entries.forEach(({ kind, item }) => deleteItem(kind, item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItems, mediaAssets, prefabs, scripts, sharedItems]);
 
  // Give the panel focus whenever a selection exists, so the keyboard
  // handlers below know the user is working in the panel (the timeline has
  // its own Delete handler — without this focus guard the two would both
  // fire when both selections exist).
  useEffect(() => {
    if (selectedItems.size > 0) panelRef.current?.focus({ preventScroll: true });
  }, [selectedItems]);
 
  // Keyboard: Delete/Backspace bulk-deletes the selection when the panel is
  // focused (never while an input is focused); Escape clears the selection
  // (rename/search inputs handle their own Escape).
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const inInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const panel = panelRef.current;
      const panelFocused = panel && (panel.contains(t) || panel === document.activeElement);
      if (e.key === 'Escape') {
        if (selectedItems.size > 0 && !inInput) clearSelection();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput && panelFocused && selectedItems.size > 0) {
        e.preventDefault();
        bulkDeleteSelected();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedItems, bulkDeleteSelected]);
 
  // Auto-dismiss the duplicate-import notice.
  useEffect(() => {
    if (dupeNotice == null) return;
    const t = setTimeout(() => setDupeNotice(null), 5000);
    return () => clearTimeout(t);
  }, [dupeNotice]);
 
  const toggleFolder = (name) => {
    setOpenFolders((prev) => ({ ...prev, [name]: !prev[name] }));
  };
 
  const toggleMediaSubfolder = (name) => toggleSubfolder('media', name);
  const togglePrefabSubfolder = (name) => toggleSubfolder('prefabs', name);
  const toggleScriptSubfolder = (name) => toggleSubfolder('scripts', name);
  const toggleSharedSubfolder = (name) => toggleSubfolder('shared', name);
 
  const handleFileUpload = (files) => {
    // Shared import helper (same probe + asset shape as OS file drops,
    // see services/mediaImport.js) so the picker and desktop drag&drop
    // stay in sync. mediaAssets enables duplicate detection; the count is
    // surfaced as a non-blocking inline notice (Feature 8).
    importMediaFiles({
      files,
      onAddMediaAsset,
      mediaAssets,
      onDuplicatesDetected: (count) => setDupeNotice(count),
    });
  };
 
  const handleReplaceFile = (e) => {
    const file = e.target.files?.[0];
    if (file && replaceTarget) onReplaceMediaAsset?.(replaceTarget, file);
    e.target.value = '';
    setReplaceTarget(null);
  };
 
  const handleCreateNewScript = async () => {
    setScriptsMenuOpen(false);
    // Creating "New Script" repeatedly used to overwrite NewScript.jsx on
    // disk. Pick an unused display/file name before the store writes it.
    const usedNames = new Set(scripts.map((script) => script.name.toLowerCase()));
    let number = 1;
    let name = 'NewScript.jsx';
    while (usedNames.has(name.toLowerCase())) {
      number += 1;
      name = `NewScript ${number}.jsx`;
    }
    const newScript = {
      id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
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
    // Draw here — this.ctx is a CanvasRenderingContext2D.
    // Example placeholder motion:
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
}`
    };
    try {
      await onCreateScript?.(newScript);
    } catch (err) {
      console.error('Could not create script file:', err);
      return;
    }
    onOpenScriptEditor(newScript);
  };
 
  // ── Drag sources (payloads shared with Timeline/Inspector drop zones) ────
  const handleDragStart = (e, itemType, itemData) => {
    setDragPayload(e.dataTransfer, itemType, itemData);
  };
 
  // ── Folder drag-and-drop (Feature 3, extended to prefabs/scripts by
  //    Feature 5) ───────────────────────────────────────────────────────────
  const moveItemToFolder = (kind, id, folderName) => {
    if (kind === 'media') onMoveMediaAsset?.(id, folderName);
    else if (kind === 'prefab') onMovePrefab?.(id, folderName);
    else if (kind === 'script') onMoveScript?.(id, folderName);
    else if (kind === 'shared') onMoveSharedItem?.(id, folderName);
  };
 
  const handleFolderDragOver = (e, itemKind, dropKey) => {
    if (!dragHasItemKind(e.dataTransfer, itemKind)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dragOverKey !== dropKey) setDragOverKey(dropKey);
  };
 
  const handleFolderDragLeave = () => setDragOverKey(null);
 
  const handleFolderDrop = (e, section, folderName, itemKind) => {
    if (!dragHasItemKind(e.dataTransfer, itemKind)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverKey(null);
    const payload = readDragPayload(e.dataTransfer);
    const draggedId = payload?.itemData?.id;
    if (!draggedId) return;
    const key = selKey(section, draggedId);
    // Standard file-manager behavior: dragging a member of a
    // multi-selection moves the whole selection (of the same kind).
    if (selectedItems.has(key) && selectedItems.size > 1) {
      selectedItems.forEach((k) => {
        const [kind, id] = k.split(':');
        if (kind === section) moveItemToFolder(kind, id, folderName);
      });
    } else {
      moveItemToFolder(section, draggedId, folderName);
    }
  };
 
  // ── Right-click menus ────────────────────────────────────────────────────
  const openEmptyMenu = (e) => {
    e.preventDefault();
    // Cards and folder headers handle their own (item) menu / actions.
    if (e.target.closest('.asset-card') || e.target.closest('.asset-list-row') || e.target.closest('.tree-folder-header')) return;
    // The section the user right-clicked inside decides where a "New
    // Folder" lands (falls back to media for clicks outside any section).
    const sectionEl = e.target.closest && e.target.closest('[data-section]');
    const section = sectionEl ? sectionEl.getAttribute('data-section') : 'media';
    setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind: 'empty', section } });
  };
 
  // Item right-clicks always suppress the native menu (browser default),
  // even for kinds with a reduced menu. Right-clicking part of a
  // multi-selection opens the bulk menu; right-clicking an unselected item
  // resets the selection to just that item first (OS file-manager
  // behavior), then opens the single-item menu.
  const openItemMenuSafe = (e, kind, item) => {
    e.preventDefault();
    e.stopPropagation();
    const key = selKey(kind, item.id);
    if (selectedItems.has(key) && selectedItems.size > 1) {
      setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind: 'multi', items: resolveSelectionEntries() } });
      return;
    }
    if (!selectedItems.has(key)) {
      setSelectedItems(new Set([key]));
      lastClickedKeyRef.current = key;
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind, item } });
  };
 
  const openFolderMenu = (e, section, folderName) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind: 'folder', section, name: folderName } });
  };
 
  const startRename = (kind, item) => {
    setRenaming({ kind, id: item.id, name: item.name || '' });
    closeCtxMenu();
  };
 
  const startFolderRename = (section, name) => {
    setRenaming({ kind: 'folder', section, id: name, name });
    closeCtxMenu();
  };
 
  const renameInput = (kind, item) => {
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
  };
 
  const folderRenameInput = (section, folderName) => {
    if (!renaming || renaming.kind !== 'folder' || renaming.section !== section || renaming.id !== folderName) return null;
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
  };
 
  const commitRename = async () => {
    if (!renaming) return;
    const name = (renaming.name || '').trim();
    if (name) {
      if (renaming.kind === 'folder') {
        commitFolderRename(renaming.section, renaming.id, name);
      } else if (renaming.kind === 'media' && onRenameMediaAsset) onRenameMediaAsset(renaming.id, name);
      else if (renaming.kind === 'prefab' && onRenamePrefab) onRenamePrefab(renaming.id, name);
      else if (renaming.kind === 'script' && onRenameScript) {
        try {
          await onRenameScript(renaming.id, name);
        } catch (err) {
          console.error('Could not rename script:', err);
          return;
        }
      }
    }
    setRenaming(null);
  };
 
  // ── Folder helpers (section state comes from useSectionFolders) ─────────
  const itemsForSection = (section) => itemsBySection[section] || itemsBySection.media;
 
  const sectionKindForFolder = (section) =>
    section === 'prefabs' ? 'prefab' : section === 'scripts' ? 'script' : section === 'shared' ? 'shared' : 'media';
 
  // Move every item of a folder to another folder (null = root). Used by
  // folder delete (contents → root) and rename (contents → new name,
  // merging on collision rather than erroring).
  const moveAllInFolder = (section, fromFolder, toFolder) => {
    const kind = sectionKindForFolder(section);
    (itemsForSection(section) || [])
      .filter((i) => i.folder === fromFolder)
      .forEach((i) => moveItemToFolder(kind, i.id, toFolder));
  };
 
  const commitFolderRename = (section, oldName, newName) => {
    if (!newName || newName === oldName) return;
    moveAllInFolder(section, oldName, newName);
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
  };
 
  const deleteFolder = (section, name) => {
    closeCtxMenu();
    // Non-destructive: assets move to the root folder; the (now empty)
    // folder registration is dropped.
    moveAllInFolder(section, name, null);
    setExtraFoldersFor(section, (prev) => prev.filter((f) => f !== name));
    setOpenSubfoldersFor(section, (prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };
 
  const handleDeleteItem = (kind, item) => {
    closeCtxMenu();
    deleteItem(kind, item);
  };
 
  const handleContextAction = (action) => {
    if (!ctxMenu) return;
    const { target } = ctxMenu;
    if (action === 'new-folder') {
      const section = target.section || 'media';
      setCreatingFolder(section);
      setNewFolderName('');
      closeCtxMenu();
    } else if (action === 'new-clip') {
      closeCtxMenu();
      onAddEmptyClip?.();
    } else if (action === 'new-script') {
      closeCtxMenu();
      handleCreateNewScript();
    } else if (action === 'rename') {
      if (target.kind === 'folder') startFolderRename(target.section, target.name);
      else startRename(target.kind, target.item);
    } else if (action === 'replace') {
      if (target.kind === 'media' && onReplaceMediaAsset) {
        setReplaceTarget(target.item.id);
        closeCtxMenu();
        // Open the picker after the context menu unmounts.
        setTimeout(() => replaceFileInputRef.current?.click(), 0);
      }
    } else if (action === 'delete') {
      if (target.kind === 'multi') {
        if (target.items.length > 1 && !window.confirm(`Delete ${target.items.length} item(s)?`)) return;
        closeCtxMenu();
        clearSelection();
        target.items.forEach(({ kind, item }) => deleteItem(kind, item));
      } else if (target.kind === 'folder') {
        deleteFolder(target.section, target.name);
      } else {
        handleDeleteItem(target.kind, target.item);
      }
    } else if (action === 'share') {
      closeCtxMenu();
      if (target.kind === 'multi') {
        target.items.forEach(({ kind, item }) => {
          if (kind === 'prefab') onSharePrefab?.(item);
          else if (kind === 'script') onShareScript?.(item);
        });
      } else if (target.kind === 'prefab') onSharePrefab?.(target.item);
      else if (target.kind === 'script') onShareScript?.(target.item);
    }
  };
 
  const commitNewFolder = async () => {
    const section = creatingFolder || 'media';
    const name = (newFolderName || '').trim();
    // One level only: the Project tab's tree and persistence model use a
    // single `folder` name, so accepting a path here would create a folder
    // users could not address or rename safely.
    if (name && !/[\\/:*?"<>|]/.test(name) && name !== '.' && name !== '..') {
      const rootName = section === 'prefabs' ? 'prefabs' : section;
      // The Shared Library lives in browser storage, not the project
      // folder (see services/sharedLibraryStorage.js) — there's no disk
      // directory to create for it, unlike media/prefabs/scripts.
      if (section !== 'shared') {
        try {
          if (projectFolderHandle) {
            const root = await projectFolderHandle.getDirectoryHandle(rootName, { create: true });
            await root.getDirectoryHandle(name, { create: true });
          }
        } catch (err) {
          console.error('Could not create project folder:', err);
          return;
        }
      }
      setExtraFoldersFor(section, (prev) => (prev.includes(name) ? prev : [...prev, name]));
      setOpenFolders((prev) => ({ ...prev, [section]: true }));
      setOpenSubfoldersFor(section, (prev) => ({ ...prev, [name]: true }));
    }
    setCreatingFolder(null);
    setNewFolderName('');
  };
 
  // ── Search + type filters + sort (Features 6 & 7) ───────────────────────
  const query = searchQuery.toLowerCase();
 
  // Stable sort applied independently per section, after filtering.
  const sortList = (list) => {
    const sorted = [...list];
    switch (sortBy) {
      case 'name-asc': sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
      case 'name-desc': sorted.sort((a, b) => (b.name || '').localeCompare(a.name || '')); break;
      case 'date-asc': sorted.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); break;
      case 'date-desc': sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); break;
      case 'duration-desc': sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0)); break;
      case 'size-desc': sorted.sort((a, b) => (b.size || 0) - (a.size || 0)); break;
      default: break;
    }
    return sorted;
  };
 
  const filteredShared = sortList(sharedItems.filter((i) => i.name.toLowerCase().includes(query)));
  const filteredPrefabs = sortList(prefabs.filter((p) => p.name.toLowerCase().includes(query)));
  const filteredMedia = sortList(
    mediaAssets.filter(
      (m) =>
        m.name.toLowerCase().includes(query) &&
        ((mediaTypeFilter.video && m.type === 'video') || (mediaTypeFilter.audio && m.type === 'audio'))
    )
  );
  const filteredScripts = sortList(
    scripts.filter((s) => {
      if (!s.name.toLowerCase().includes(query)) return false;
      const kind = detectScriptKind(s.code || '');
      return scriptKindFilter[kind] !== false;
    })
  );
 
  const rootMedia = filteredMedia.filter((m) => !m.folder);
  const mediaSubfolderNames = allMediaFolders.filter((folderName) =>
    extraFolders.includes(folderName) || filteredMedia.some((m) => m.folder === folderName)
  );
  const rootPrefabs = filteredPrefabs.filter((p) => !p.folder);
  const prefabSubfolderNames = allPrefabFolders.filter((folderName) =>
    prefabExtraFolders.includes(folderName) || filteredPrefabs.some((p) => p.folder === folderName)
  );
  const rootScripts = filteredScripts.filter((s) => !s.folder);
  const scriptSubfolderNames = allScriptFolders.filter((folderName) =>
    scriptExtraFolders.includes(folderName) || filteredScripts.some((s) => s.folder === folderName)
  );
  const rootShared = filteredShared.filter((s) => !s.folder);
  const sharedSubfolderNames = allSharedFolders.filter((folderName) =>
    sharedExtraFolders.includes(folderName) || filteredShared.some((s) => s.folder === folderName)
  );
 
  // ── Hover preview ─────────────────────────────────────────────────────────
  const showPreview = (e, kind, item) => {
    setPreview({ x: e.clientX, y: e.clientY, kind, item });
  };
 
  // ── Grid card (shared markup for grid view + folder contents) ────────────
  const renderMediaCard = (asset) => (
    <div
      key={asset.id}
      className={`asset-card media-card${isSelected('media', asset) ? ' selected' : ''}`}
      draggable
      onDragStart={(e) => handleDragStart(e, ITEM_KIND_MEDIA, asset)}
      onMouseMove={(e) => showPreview(e, 'media', asset)}
      onMouseLeave={() => setPreview(null)}
      onContextMenu={(e) => openItemMenuSafe(e, 'media', asset)}
      onClick={(e) => {
        if (e.target.closest('button')) return;
        // Selection + preview both fire — selection is persistent state,
        // preview is a hover-driven side panel (not mutually exclusive).
        handleItemClick(e, 'media', asset);
        showPreview(e, 'media', asset);
      }}
    >
      <div className={`asset-icon-box ${asset.type === 'video' ? 'text-indigo' : 'text-emerald'}`}>
        {asset.type === 'video' ? <Film size={20} /> : <Music size={20} />}
        <span className="duration-tag">{formatTimecode(asset.duration).slice(3)}</span>
      </div>
      <div className="asset-info-box">
        {renameInput('media', asset) || <span className="asset-title-main">{asset.name}</span>}
        <span className="asset-subtitle">{asset.type.toUpperCase()}</span>
      </div>
      <div className="asset-card-btns">
        <button
          className="card-action-btn add-btn"
          title="Add to timeline"
          onClick={() => onAddMediaToTimeline(asset)}
        >
          <Plus size={14} />
        </button>
        <button
          className="card-action-btn del-btn"
          title="Delete asset"
          onClick={() => onRemoveMediaAsset(asset.id)}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
 
  // ── List view row (Name | Type | Duration/Size | Actions) ────────────────
  const renderMediaRow = (asset) => (
    <div
      key={asset.id}
      className={`asset-list-row${isSelected('media', asset) ? ' selected' : ''}`}
      draggable
      onDragStart={(e) => handleDragStart(e, ITEM_KIND_MEDIA, asset)}
      onMouseMove={(e) => showPreview(e, 'media', asset)}
      onMouseLeave={() => setPreview(null)}
      onContextMenu={(e) => openItemMenuSafe(e, 'media', asset)}
      onClick={(e) => {
        if (e.target.closest('button')) return;
        handleItemClick(e, 'media', asset);
        showPreview(e, 'media', asset);
      }}
    >
      <span className={`asset-row-icon ${asset.type === 'video' ? 'text-indigo' : 'text-emerald'}`}>
        {asset.type === 'video' ? <Film size={13} /> : <Music size={13} />}
      </span>
      {renameInput('media', asset) || <span className="asset-row-name">{asset.name}</span>}
      <span className="asset-row-type">{asset.type}</span>
      <span className="asset-row-meta">{shortDuration(asset.duration)}</span>
      <span className="asset-row-actions">
        <button className="card-action-btn add-btn" title="Add to timeline" onClick={() => onAddMediaToTimeline(asset)}>
          <Plus size={12} />
        </button>
        <button className="card-action-btn del-btn" title="Delete" onClick={() => onRemoveMediaAsset(asset.id)}>
          <Trash2 size={11} />
        </button>
      </span>
    </div>
  );
 
  const renderPrefabCard = (prefab) => (
    <div
      key={prefab.id}
      className={`asset-card prefab-card${isSelected('prefab', prefab) ? ' selected' : ''}`}
      draggable
      onDragStart={(e) => handleDragStart(e, ITEM_KIND_PREFAB, prefab)}
      onMouseMove={(e) => showPreview(e, 'prefab', prefab)}
      onMouseLeave={() => setPreview(null)}
      onContextMenu={(e) => openItemMenuSafe(e, 'prefab', prefab)}
      onClick={(e) => {
        if (e.target.closest('button')) return;
        handleItemClick(e, 'prefab', prefab);
        showPreview(e, 'prefab', prefab);
      }}
    >
      <div className="asset-icon-box text-cyan">
        <Package size={20} />
      </div>
      <div className="asset-info-box">
        {renameInput('prefab', prefab) || <span className="asset-title-main">{prefab.name}</span>}
        <span className="asset-subtitle">Prefab GameObject</span>
      </div>
      <div className="asset-card-btns">
        <button className="card-action-btn add-btn" title="Add to timeline" onClick={() => onAddPrefabToTimeline(prefab)}>
          <Plus size={14} />
        </button>
        <button
          className="card-action-btn share-btn"
          title="Save to Shared Library (available in every project)"
          onClick={() => onSharePrefab(prefab)}
        >
          <Share2 size={12} />
        </button>
        <button className="card-action-btn del-btn" title="Delete prefab" onClick={() => onRemovePrefab(prefab.id)}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
 
  const renderPrefabRow = (prefab) => (
    <div
      key={prefab.id}
      className={`asset-list-row${isSelected('prefab', prefab) ? ' selected' : ''}`}
      draggable
      onDragStart={(e) => handleDragStart(e, ITEM_KIND_PREFAB, prefab)}
      onMouseMove={(e) => showPreview(e, 'prefab', prefab)}
      onMouseLeave={() => setPreview(null)}
      onContextMenu={(e) => openItemMenuSafe(e, 'prefab', prefab)}
      onClick={(e) => {
        if (e.target.closest('button')) return;
        handleItemClick(e, 'prefab', prefab);
        showPreview(e, 'prefab', prefab);
      }}
    >
      <span className="asset-row-icon text-cyan"><Package size={13} /></span>
      {renameInput('prefab', prefab) || <span className="asset-row-name">{prefab.name}</span>}
      <span className="asset-row-type">prefab</span>
      <span className="asset-row-meta">
        {Array.isArray(prefab.entities) && prefab.entities.length > 1 ? `${prefab.entities.length} objects` : '1 object'}
      </span>
      <span className="asset-row-actions">
        <button className="card-action-btn add-btn" title="Add to timeline" onClick={() => onAddPrefabToTimeline(prefab)}>
          <Plus size={12} />
        </button>
        <button className="card-action-btn share-btn" title="Save to Shared Library" onClick={() => onSharePrefab(prefab)}>
          <Share2 size={11} />
        </button>
        <button className="card-action-btn del-btn" title="Delete" onClick={() => onRemovePrefab(prefab.id)}>
          <Trash2 size={11} />
        </button>
      </span>
    </div>
  );
 
  const renderScriptCard = (script) => {
    const Meta = scriptKindMeta(detectScriptKind(script.code || ''));
    const renamingThis = renaming && renaming.kind === 'script' && renaming.id === script.id;
    return (
      <div
        key={script.id}
        className={`asset-card script-card${isSelected('script', script) ? ' selected' : ''}`}
        onClick={(e) => {
          if (e.target.closest('button')) return;
          if (renamingThis) return;
          handleItemClick(e, 'script', script);
          onOpenScriptEditor(script);
        }}
        draggable
        onDragStart={(e) => handleDragStart(e, ITEM_KIND_SCRIPT, script)}
        onMouseMove={(e) => showPreview(e, 'script', script)}
        onMouseLeave={() => setPreview(null)}
        onContextMenu={(e) => openItemMenuSafe(e, 'script', script)}
      >
        <div className={`asset-icon-box ${Meta.className}`}>
          <Meta.icon size={20} />
        </div>
        <div className="asset-info-box">
          {renameInput('script', script) || <span className="asset-title-main">{script.name}</span>}
          <span className="asset-subtitle">{Meta.label}</span>
        </div>
        <div className="asset-card-btns">
          <button
            className="card-action-btn share-btn"
            title="Save to Shared Library (available in every project)"
            onClick={(e) => {
              e.stopPropagation();
              onShareScript(script);
            }}
          >
            <Share2 size={12} />
          </button>
        </div>
      </div>
    );
  };
 
  const renderScriptRow = (script) => {
    const Meta = scriptKindMeta(detectScriptKind(script.code || ''));
    const renamingThis = renaming && renaming.kind === 'script' && renaming.id === script.id;
    return (
      <div
        key={script.id}
        className={`asset-list-row${isSelected('script', script) ? ' selected' : ''}`}
        onClick={(e) => {
          if (e.target.closest('button')) return;
          if (renamingThis) return;
          handleItemClick(e, 'script', script);
          onOpenScriptEditor(script);
        }}
        draggable
        onDragStart={(e) => handleDragStart(e, ITEM_KIND_SCRIPT, script)}
        onMouseMove={(e) => showPreview(e, 'script', script)}
        onMouseLeave={() => setPreview(null)}
        onContextMenu={(e) => openItemMenuSafe(e, 'script', script)}
      >
        <span className={`asset-row-icon ${Meta.className}`}><Meta.icon size={13} /></span>
        {renameInput('script', script) || <span className="asset-row-name">{script.name}</span>}
        <span className="asset-row-type">{Meta.label.toLowerCase()}</span>
        <span className="asset-row-meta">jsx</span>
        <span className="asset-row-actions">
          <button className="card-action-btn share-btn" title="Save to Shared Library" onClick={(e) => { e.stopPropagation(); onShareScript(script); }}>
            <Share2 size={11} />
          </button>
        </span>
      </div>
    );
  };
 
  const renderSharedCard = (item) => {
    const isPrefab = item.type === 'prefab';
    return (
      <div
        key={item.id}
        className={`asset-card shared-card${isSelected('shared', item) ? ' selected' : ''}`}
        title={isPrefab ? 'Shared prefab — add to timeline' : 'Shared script — copy into this project'}
        draggable
        onDragStart={(e) => handleDragStart(e, ITEM_KIND_SHARED, item)}
        onMouseMove={(e) => showPreview(e, isPrefab ? 'prefab' : 'script', item.data || item)}
        onMouseLeave={() => setPreview(null)}
        onContextMenu={(e) => openItemMenuSafe(e, 'shared', item)}
        onClick={(e) => {
          if (e.target.closest('button')) return;
          handleItemClick(e, 'shared', item);
          showPreview(e, isPrefab ? 'prefab' : 'script', item.data || item);
        }}
      >
        <div className={`asset-icon-box ${isPrefab ? 'text-violet' : 'text-emerald'}`}>
          {isPrefab ? <Package size={20} /> : <FileCode size={20} />}
        </div>
        <div className="asset-info-box">
          <span className="asset-title-main">{item.name}</span>
          <span className="asset-subtitle">{isPrefab ? 'Prefab · shared' : 'Script · shared'}</span>
        </div>
        <div className="asset-card-btns">
          <button
            className="card-action-btn add-btn"
            title={isPrefab ? 'Add to timeline' : 'Copy into this project'}
            onClick={() => (isPrefab ? onAddPrefabToTimeline(item.data) : onImportSharedItem(item))}
          >
            <Plus size={14} />
          </button>
          <button
            className="card-action-btn del-btn"
            title="Remove from shared library"
            onClick={() => onRemoveSharedItem(item.id)}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    );
  };
 
  const isGridView = viewMode === 'grid';
 
  const renderSharedItem = (item) =>
    isGridView
      ? renderSharedCard(item)
      : renderSharedRow(item);
 
  const renderSharedRow = (item) => {
    const isPrefab = item.type === 'prefab';
    return (
      <div
        key={item.id}
        className={`asset-list-row${isSelected('shared', item) ? ' selected' : ''}`}
        draggable
        onDragStart={(e) => handleDragStart(e, ITEM_KIND_SHARED, item)}
        onMouseMove={(e) => showPreview(e, isPrefab ? 'prefab' : 'script', item.data || item)}
        onMouseLeave={() => setPreview(null)}
        onContextMenu={(e) => openItemMenuSafe(e, 'shared', item)}
        onClick={(e) => {
          if (e.target.closest('button')) return;
          handleItemClick(e, 'shared', item);
          showPreview(e, isPrefab ? 'prefab' : 'script', item.data || item);
        }}
      >
        <span className={`asset-row-icon ${isPrefab ? 'text-violet' : 'text-emerald'}`}>
          {isPrefab ? <Package size={13} /> : <FileCode size={13} />}
        </span>
        <span className="asset-row-name">{item.name}</span>
        <span className="asset-row-type">shared</span>
        <span className="asset-row-meta">{isPrefab ? 'prefab' : 'jsx'}</span>
        <span className="asset-row-actions">
          <button
            className="card-action-btn add-btn"
            title={isPrefab ? 'Add to timeline' : 'Copy into this project'}
            onClick={() => (isPrefab ? onAddPrefabToTimeline(item.data) : onImportSharedItem(item))}
          >
            <Plus size={12} />
          </button>
          <button className="card-action-btn del-btn" title="Remove from shared library" onClick={() => onRemoveSharedItem(item.id)}>
            <Trash2 size={11} />
          </button>
        </span>
      </div>
    );
  };
 
  const renderListHeader = () => (
    <div className="asset-list-header">
      <span className="asset-row-icon" />
      <span className="asset-row-name">Name</span>
      <span className="asset-row-type">Type</span>
      <span className="asset-row-meta">Duration/Size</span>
      <span className="asset-row-actions" />
    </div>
  );
 
  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="project-panel"
      onContextMenu={openEmptyMenu}
      onClick={(e) => {
        if (ctxMenu && !e.target.closest('.project-context-menu')) closeCtxMenu();
        // Clicking empty space clears the selection.
        if (
          !e.target.closest('.asset-card') &&
          !e.target.closest('.asset-list-row') &&
          !e.target.closest('.tree-folder-header') &&
          !e.target.closest('input') &&
          !e.target.closest('button')
        ) {
          clearSelection();
        }
      }}
    >
      {/* Panel Header */}
      <div className="panel-top-header">
        <h3 className="panel-title-text">Project</h3>
        <div className="project-header-tools">
          <div className="search-bar-sm">
            <Search size={11} className="search-icon" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {/* Sort control (Feature 6) — media sections get extra keys */}
          <select
            className="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            title="Sort items"
          >
            {(mediaAssets.length > 0 ? MEDIA_SORT_OPTIONS : SORT_OPTIONS).map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <div className="project-view-toggle" title="Toggle Grid / List view">
            <button
              className={`view-toggle-btn ${isGridView ? 'active' : ''}`}
              title="Grid view"
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid size={13} />
            </button>
            <button
              className={`view-toggle-btn ${!isGridView ? 'active' : ''}`}
              title="List view"
              onClick={() => setViewMode('list')}
            >
              <List size={13} />
            </button>
          </div>
        </div>
        {/* Type filters (Feature 7) — additive to search */}
        <div className="filter-chips">
          <button
            className={`filter-chip${mediaTypeFilter.video ? ' active' : ''}`}
            title="Show video assets"
            onClick={() => setMediaTypeFilter((p) => ({ ...p, video: !p.video }))}
          >
            Video
          </button>
          <button
            className={`filter-chip${mediaTypeFilter.audio ? ' active' : ''}`}
            title="Show audio assets"
            onClick={() => setMediaTypeFilter((p) => ({ ...p, audio: !p.audio }))}
          >
            Audio
          </button>
          <button
            className={`filter-chip${scriptKindFilter.react ? ' active' : ''}`}
            title="Show React-component scripts"
            onClick={() => setScriptKindFilter((p) => ({ ...p, react: !p.react }))}
          >
            React
          </button>
          <button
            className={`filter-chip${scriptKindFilter.canvas ? ' active' : ''}`}
            title="Show Canvas-component scripts"
            onClick={() => setScriptKindFilter((p) => ({ ...p, canvas: !p.canvas }))}
          >
            Canvas
          </button>
          <button
            className={`filter-chip${scriptKindFilter.motion ? ' active' : ''}`}
            title="Show motion scripts"
            onClick={() => setScriptKindFilter((p) => ({ ...p, motion: !p.motion }))}
          >
            Motion
          </button>
        </div>
      </div>
 
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        multiple
        accept="video/*,audio/*"
        onChange={(e) => handleFileUpload(e.target.files)}
      />
 
      {/* Replace picker (Feature 9) — single file, target set by the menu */}
      <input
        type="file"
        ref={replaceFileInputRef}
        style={{ display: 'none' }}
        accept="video/*,audio/*"
        onChange={handleReplaceFile}
      />
 
      {/* Folder Tree */}
      <div className="project-tree">
        <FolderSection
          sectionKey="shared"
          dropKind="shared"
          itemKind={ITEM_KIND_SHARED}
          label="Shared Library"
          colorClass="text-violet"
          isOpen={openFolders.shared}
          onToggleOpen={() => toggleFolder('shared')}
          count={filteredShared.length}
          dragOverKey={dragOverKey}
          onFolderDragOver={handleFolderDragOver}
          onFolderDragLeave={handleFolderDragLeave}
          onFolderDrop={handleFolderDrop}
          emptyHint="App-wide library — use the share button on a prefab or script below to keep it available across every project."
          subfolderNames={sharedSubfolderNames}
          openSubfolders={openSharedSubfolders}
          onToggleSubfolder={toggleSharedSubfolder}
          onOpenFolderMenu={(e, folderName) => openFolderMenu(e, 'shared', folderName)}
          folderRenameInput={(folderName) => folderRenameInput('shared', folderName)}
          itemsInFolder={(folderName) => filteredShared.filter((s) => s.folder === folderName)}
          emptyFolderHint="Empty folder — drop shared items here."
          isGridView={isGridView}
          renderListHeader={renderListHeader}
          renderItem={renderSharedItem}
          rootItems={rootShared}
          creatingFolder={creatingFolder}
          newFolderName={newFolderName}
          setNewFolderName={setNewFolderName}
          commitNewFolder={commitNewFolder}
          setCreatingFolder={setCreatingFolder}
        />
 
        <FolderSection
          sectionKey="prefabs"
          dropKind="prefab"
          itemKind={ITEM_KIND_PREFAB}
          label="prefabs"
          colorClass="text-cyan"
          isOpen={openFolders.prefabs}
          onToggleOpen={() => toggleFolder('prefabs')}
          count={filteredPrefabs.length}
          dragOverKey={dragOverKey}
          onFolderDragOver={handleFolderDragOver}
          onFolderDragLeave={handleFolderDragLeave}
          onFolderDrop={handleFolderDrop}
          emptyHint="No prefabs yet. Save a GameObject as a Prefab from the Inspector."
          subfolderNames={prefabSubfolderNames}
          openSubfolders={openPrefabSubfolders}
          onToggleSubfolder={togglePrefabSubfolder}
          onOpenFolderMenu={(e, folderName) => openFolderMenu(e, 'prefabs', folderName)}
          folderRenameInput={(folderName) => folderRenameInput('prefabs', folderName)}
          itemsInFolder={(folderName) => filteredPrefabs.filter((p) => p.folder === folderName)}
          emptyFolderHint="Empty folder — save prefabs into it or drop them here."
          isGridView={isGridView}
          renderListHeader={renderListHeader}
          renderItem={(p) => (isGridView ? renderPrefabCard(p) : renderPrefabRow(p))}
          rootItems={rootPrefabs}
          creatingFolder={creatingFolder}
          newFolderName={newFolderName}
          setNewFolderName={setNewFolderName}
          commitNewFolder={commitNewFolder}
          setCreatingFolder={setCreatingFolder}
        />
 
        <FolderSection
          sectionKey="media"
          dropKind="media"
          itemKind={ITEM_KIND_MEDIA}
          label="media"
          colorClass="text-indigo"
          isOpen={openFolders.media}
          onToggleOpen={() => toggleFolder('media')}
          count={filteredMedia.length}
          dragOverKey={dragOverKey}
          onFolderDragOver={handleFolderDragOver}
          onFolderDragLeave={handleFolderDragLeave}
          onFolderDrop={handleFolderDrop}
          headerAddon={(
            <div className="tree-folder-add-wrapper">
              <button
                className="tree-folder-add-btn"
                title="Add media"
                onClick={(e) => { e.stopPropagation(); setMediaMenuOpen((v) => !v); }}
              >
                <Plus size={12} />
              </button>
              {mediaMenuOpen && (
                <div className="tree-add-popover" onClick={(e) => e.stopPropagation()}>
                  <button className="popover-item" onClick={() => { setMediaMenuOpen(false); fileInputRef.current?.click(); }}>
                    <Upload size={12} />
                    <span>Import Media</span>
                  </button>
                </div>
              )}
            </div>
          )}
          emptyHint="No media yet. Use + to import a clip."
          extraContent={dupeNotice != null && (
            <div className="project-dupe-notice">
              <span>{dupeNotice} file(s) look like duplicates of existing assets — imported as new entries.</span>
              <button onClick={() => setDupeNotice(null)} title="Dismiss">×</button>
            </div>
          )}
          subfolderNames={mediaSubfolderNames}
          openSubfolders={openMediaSubfolders}
          onToggleSubfolder={toggleMediaSubfolder}
          onOpenFolderMenu={(e, folderName) => openFolderMenu(e, 'media', folderName)}
          folderRenameInput={(folderName) => folderRenameInput('media', folderName)}
          itemsInFolder={(folderName) => filteredMedia.filter((m) => m.folder === folderName)}
          emptyFolderHint="Empty folder — import media into it or drop files here."
          isGridView={isGridView}
          renderListHeader={renderListHeader}
          renderItem={(m) => (isGridView ? renderMediaCard(m) : renderMediaRow(m))}
          rootItems={rootMedia}
          creatingFolder={creatingFolder}
          newFolderName={newFolderName}
          setNewFolderName={setNewFolderName}
          commitNewFolder={commitNewFolder}
          setCreatingFolder={setCreatingFolder}
        />
 
        <FolderSection
          sectionKey="scripts"
          dropKind="script"
          itemKind={ITEM_KIND_SCRIPT}
          label="scripts"
          colorClass="text-emerald"
          isOpen={openFolders.scripts}
          onToggleOpen={() => toggleFolder('scripts')}
          count={filteredScripts.length}
          dragOverKey={dragOverKey}
          onFolderDragOver={handleFolderDragOver}
          onFolderDragLeave={handleFolderDragLeave}
          onFolderDrop={handleFolderDrop}
          headerAddon={(
            <div className="tree-folder-add-wrapper">
              {projectFolderHandle?.path && isTauri() && (
                <button
                  className="tree-folder-add-btn"
                  title="Open scripts in VS Code"
                  onClick={(e) => { e.stopPropagation(); openProjectInVsCode(projectFolderHandle.path); }}
                  style={{ marginRight: 4 }}
                >
                  <Code size={12} />
                </button>
              )}
              <button
                className="tree-folder-add-btn"
                title="New script"
                onClick={(e) => { e.stopPropagation(); setScriptsMenuOpen((v) => !v); }}
              >
                <Plus size={12} />
              </button>
              {scriptsMenuOpen && (
                <div className="tree-add-popover" onClick={(e) => e.stopPropagation()}>
                  <button className="popover-item" onClick={handleCreateNewScript}>
                    <FileCode size={12} className="text-emerald" />
                    <span>+ New Script</span>
                  </button>
                </div>
              )}
            </div>
          )}
          emptyHint="No scripts yet. Use + to create a new script."
          subfolderNames={scriptSubfolderNames}
          openSubfolders={openScriptSubfolders}
          onToggleSubfolder={toggleScriptSubfolder}
          onOpenFolderMenu={(e, folderName) => openFolderMenu(e, 'scripts', folderName)}
          folderRenameInput={(folderName) => folderRenameInput('scripts', folderName)}
          itemsInFolder={(folderName) => filteredScripts.filter((s) => s.folder === folderName)}
          emptyFolderHint="Empty folder — create scripts into it or drop them here."
          isGridView={isGridView}
          renderListHeader={renderListHeader}
          renderItem={(s) => (isGridView ? renderScriptCard(s) : renderScriptRow(s))}
          rootItems={rootScripts}
          creatingFolder={creatingFolder}
          newFolderName={newFolderName}
          setNewFolderName={setNewFolderName}
          commitNewFolder={commitNewFolder}
          setCreatingFolder={setCreatingFolder}
        />
      </div>
 
      {/* ── Right-click context menu ─────────────────────────────────────── */}
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={closeCtxMenu} className="project-context-menu" minWidth={170}>
          {ctxMenu.target.kind === 'empty' && (
            <>
              {ctxMenu.target.section && (
                <button className="ctx-menu-item" onClick={() => handleContextAction('new-folder')}>
                  <FolderPlus size={12} /> New Folder
                </button>
              )}
              <button className="ctx-menu-item" onClick={() => handleContextAction('new-clip')}>
                <Layers size={12} /> New Empty Clip
              </button>
              <button className="ctx-menu-item" onClick={() => handleContextAction('new-script')}>
                <FileCode size={12} /> New Script
              </button>
            </>
          )}
          {ctxMenu.target.kind === 'folder' && (
            <>
              <button className="ctx-menu-item" onClick={() => handleContextAction('rename')}>
                <Pencil size={12} /> Rename Folder
              </button>
              <button className="ctx-menu-item danger" onClick={() => handleContextAction('delete')}>
                <Trash2 size={12} /> Delete Folder
              </button>
            </>
          )}
          {ctxMenu.target.kind === 'multi' && (
            <>
              {ctxMenu.target.items.length > 0 && ctxMenu.target.items.every(({ kind }) => kind === 'prefab' || kind === 'script') && (
                <button className="ctx-menu-item" onClick={() => handleContextAction('share')}>
                  <Share2 size={12} /> Save to Shared Library
                </button>
              )}
              <button className="ctx-menu-item danger" onClick={() => handleContextAction('delete')}>
                <Trash2 size={12} /> Delete {ctxMenu.target.items.length} item(s)
              </button>
            </>
          )}
          {ctxMenu.target.kind !== 'empty' && ctxMenu.target.kind !== 'folder' && ctxMenu.target.kind !== 'multi' && (
            <>
              {ctxMenu.target.kind !== 'shared' && (
                <button className="ctx-menu-item" onClick={() => handleContextAction('rename')}>
                  <Pencil size={12} /> Rename
                </button>
              )}
              {ctxMenu.target.kind === 'media' && onReplaceMediaAsset && (
                <button className="ctx-menu-item" onClick={() => handleContextAction('replace')}>
                  <Upload size={12} /> Replace…
                </button>
              )}
              {(ctxMenu.target.kind === 'prefab' || ctxMenu.target.kind === 'script') && (
                <button className="ctx-menu-item" onClick={() => handleContextAction('share')}>
                  <Share2 size={12} /> Save to Shared Library
                </button>
              )}
              <button className="ctx-menu-item danger" onClick={() => handleContextAction('delete')}>
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
        </ContextMenu>
      )}
 
      {/* ── Hover / click asset preview ───────────────────────────────────── */}
      {preview && (
        <AssetPreviewPopover x={preview.x} y={preview.y} kind={preview.kind} item={preview.item} />
      )}
    </aside>
  );
});