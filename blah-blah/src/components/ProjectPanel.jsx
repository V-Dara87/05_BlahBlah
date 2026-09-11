import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import {
  Package,
  Film,
  Music,
  FileCode,
  Plus,
  Upload,
  Trash2,
  Sparkles,
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
  Film as FilmIcon
} from 'lucide-react';
import { formatTimecode } from '../utils/timeFormat';
import { detectScriptKind } from '../engine/scriptRunner';
import { importMediaFiles } from '../services/mediaImport';
import { isTauri } from '../services/tauriFsAdapter';
import { openProjectInVsCode } from '../services/ideLauncher';
import { isScriptComponent } from '../engine/ecs';
import { setDragPayload, readDragPayload, dragHasItemKind, ITEM_KIND_MEDIA, ITEM_KIND_PREFAB, ITEM_KIND_SCRIPT } from '../utils/dragData';

// Per-kind display metadata for script cards (see detectScriptKind).
const SCRIPT_KIND_META = {
  react: { icon: Sparkles, className: 'text-cyan', label: 'React Component' },
  canvas: { icon: Sparkles, className: 'text-violet', label: 'Canvas Component' },
  motion: { icon: FileCode, className: 'text-emerald', label: 'Motion Script' },
};
const scriptKindMeta = (kind) => SCRIPT_KIND_META[kind] || SCRIPT_KIND_META.motion;

const COMPONENT_TYPE_LABEL = {
  TextRenderer: 'Text',
  ShapeRenderer: 'Shape',
  VideoRenderer: 'Video',
  AudioSource: 'Audio',
  ScriptComponent: 'Script',
  MonoBehaviour: 'Script',
  Transform: 'Transform',
};

// Short display duration (drop the leading hours part like the old cards).
const shortDuration = (sec) => formatTimecode(sec).slice(3);

// Sort control options (Feature 6). Duration/size are media-only keys;
// they no-op for sections whose items don't carry those fields.
const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
];
const MEDIA_SORT_OPTIONS = [
  ...SORT_OPTIONS,
  { value: 'duration-desc', label: 'Duration (longest)' },
  { value: 'size-desc', label: 'Size (largest)' },
];

// Composite selection key `${kind}:${id}` (Feature 1).
const selKey = (kind, id) => `${kind}:${id}`;

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
  const [openMediaSubfolders, setOpenMediaSubfolders] = useState({});
  const [openPrefabSubfolders, setOpenPrefabSubfolders] = useState({});
  const [openScriptSubfolders, setOpenScriptSubfolders] = useState({});
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
  // Extra empty subfolders created via the context menu, per section. Kept
  // in panel state (assets carry a folder field; an empty folder has no
  // assets to derive from, so it lives here until something lands in it).
  const [extraFolders, setExtraFolders] = useState([]); // media
  const [prefabExtraFolders, setPrefabExtraFolders] = useState([]);
  const [scriptExtraFolders, setScriptExtraFolders] = useState([]);

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

  const closeCtxMenu = () => setCtxMenu(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e) => {
      if (!e.target.closest || !e.target.closest('.project-context-menu')) closeCtxMenu();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') closeCtxMenu();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

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

  const toggleMediaSubfolder = (name) => {
    setOpenMediaSubfolders((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const togglePrefabSubfolder = (name) => {
    setOpenPrefabSubfolders((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const toggleScriptSubfolder = (name) => {
    setOpenScriptSubfolders((prev) => ({ ...prev, [name]: !prev[name] }));
  };

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

  const handleCreateNewScript = () => {
    setScriptsMenuOpen(false);
    const newScript = {
      id: `script-${Date.now()}`,
      name: 'NewScript.jsx',
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
    onCreateScript(newScript);
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

  const commitRename = () => {
    if (!renaming) return;
    const name = (renaming.name || '').trim();
    if (name) {
      if (renaming.kind === 'folder') {
        commitFolderRename(renaming.section, renaming.id, name);
      } else if (renaming.kind === 'media' && onRenameMediaAsset) onRenameMediaAsset(renaming.id, name);
      else if (renaming.kind === 'prefab' && onRenamePrefab) onRenamePrefab(renaming.id, name);
      else if (renaming.kind === 'script' && onRenameScript) onRenameScript(renaming.id, name);
    }
    setRenaming(null);
  };

  // ── Folder helpers (per-section state; media / prefabs / scripts) ───────
  const setExtraFoldersFor = (section, updater) => {
    if (section === 'prefabs') setPrefabExtraFolders(updater);
    else if (section === 'scripts') setScriptExtraFolders(updater);
    else setExtraFolders(updater);
  };

  const itemsForSection = (section) =>
    section === 'prefabs' ? prefabs : section === 'scripts' ? scripts : mediaAssets;

  const setOpenSubfoldersFor = (section, updater) => {
    if (section === 'prefabs') setOpenPrefabSubfolders(updater);
    else if (section === 'scripts') setOpenScriptSubfolders(updater);
    else setOpenMediaSubfolders(updater);
  };

  // Move every item of a folder to another folder (null = root). Used by
  // folder delete (contents → root) and rename (contents → new name,
  // merging on collision rather than erroring).
  const moveAllInFolder = (section, fromFolder, toFolder) => {
    (itemsForSection(section) || [])
      .filter((i) => i.folder === fromFolder)
      .forEach((i) => moveItemToFolder(section, i.id, toFolder));
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
      const section = target.section && target.section !== 'shared' ? target.section : 'media';
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

  const commitNewFolder = () => {
    const section = creatingFolder || 'media';
    const name = (newFolderName || '').trim();
    if (name) {
      setExtraFoldersFor(section, (prev) => (prev.includes(name) ? prev : [...prev, name]));
      setOpenFolders((prev) => ({ ...prev, [section]: true }));
      setOpenSubfoldersFor(section, (prev) => ({ ...prev, [name]: true }));
    }
    setCreatingFolder(null);
    setNewFolderName('');
  };

  // Folders per section: derive from item `folder` fields + context-menu
  // folders. Separate namespaces (media / prefabs / scripts).
  const allMediaFolders = useMemo(() => {
    const fromAssets = new Set(mediaAssets.filter((m) => m.folder).map((m) => m.folder));
    extraFolders.forEach((f) => fromAssets.add(f));
    return Array.from(fromAssets);
  }, [mediaAssets, extraFolders]);

  const allPrefabFolders = useMemo(() => {
    const fromItems = new Set(prefabs.filter((p) => p.folder).map((p) => p.folder));
    prefabExtraFolders.forEach((f) => fromItems.add(f));
    return Array.from(fromItems);
  }, [prefabs, prefabExtraFolders]);

  const allScriptFolders = useMemo(() => {
    const fromItems = new Set(scripts.filter((s) => s.folder).map((s) => s.folder));
    scriptExtraFolders.forEach((f) => fromItems.add(f));
    return Array.from(fromItems);
  }, [scripts, scriptExtraFolders]);

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
        onDragStart={(e) => handleDragStart(e, isPrefab ? ITEM_KIND_PREFAB : ITEM_KIND_SCRIPT, item.data || item)}
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
        onDragStart={(e) => handleDragStart(e, isPrefab ? ITEM_KIND_PREFAB : ITEM_KIND_SCRIPT, item.data || item)}
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
        {/* ========== Shared Library (app-wide, outside any project) ========== */}
        <div className="tree-folder-group" data-section="shared">
          <div className="tree-folder-header" onClick={() => toggleFolder('shared')}>
            {openFolders.shared ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {openFolders.shared ? <FolderOpen size={13} className="text-violet" /> : <Folder size={13} className="text-violet" />}
            <span className="tree-folder-name">Shared Library</span>
            <span className="tree-folder-count">{filteredShared.length}</span>
          </div>

          {openFolders.shared && (
            <div className="tree-folder-contents">
              {filteredShared.length === 0 && (
                <p className="tree-empty-hint">
                  App-wide library — use the share button on a prefab or script below to keep it
                  available across every project.
                </p>
              )}
              {!isGridView && filteredShared.length > 0 && renderListHeader()}
              {filteredShared.map(renderSharedItem)}
            </div>
          )}
        </div>

        {/* ========== prefabs/ ========== */}
        <div className="tree-folder-group" data-section="prefabs">
          <div
            className={`tree-folder-header${dragOverKey === 'prefab:__root__' ? ' drag-over' : ''}`}
            onClick={() => toggleFolder('prefabs')}
            onDragOver={(e) => handleFolderDragOver(e, ITEM_KIND_PREFAB, 'prefab:__root__')}
            onDragLeave={handleFolderDragLeave}
            onDrop={(e) => handleFolderDrop(e, 'prefab', null, ITEM_KIND_PREFAB)}
          >
            {openFolders.prefabs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {openFolders.prefabs ? <FolderOpen size={13} className="text-cyan" /> : <Folder size={13} className="text-cyan" />}
            <span className="tree-folder-name">prefabs</span>
            <span className="tree-folder-count">{filteredPrefabs.length}</span>
          </div>

          {openFolders.prefabs && (
            <div className="tree-folder-contents">
              {filteredPrefabs.length === 0 && prefabExtraFolders.length === 0 && (
                <p className="tree-empty-hint">No prefabs yet. Save a GameObject as a Prefab from the Inspector.</p>
              )}

              {/* Prefab subfolders (Feature 5) */}
              {prefabSubfolderNames.map((folderName) => {
                const isOpen = !!openPrefabSubfolders[folderName];
                const itemsInFolder = filteredPrefabs.filter((p) => p.folder === folderName);
                return (
                  <div key={folderName} className="tree-folder-group nested">
                    <div
                      className={`tree-folder-header${dragOverKey === `prefab:${folderName}` ? ' drag-over' : ''}`}
                      onClick={() => togglePrefabSubfolder(folderName)}
                      onContextMenu={(e) => openFolderMenu(e, 'prefabs', folderName)}
                      onDragOver={(e) => handleFolderDragOver(e, ITEM_KIND_PREFAB, `prefab:${folderName}`)}
                      onDragLeave={handleFolderDragLeave}
                      onDrop={(e) => handleFolderDrop(e, 'prefab', folderName, ITEM_KIND_PREFAB)}
                    >
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {isOpen ? <FolderOpen size={13} className="text-cyan" /> : <Folder size={13} className="text-cyan" />}
                      {folderRenameInput('prefabs', folderName) || <span className="tree-folder-name">{folderName}</span>}
                      <span className="tree-folder-count">{itemsInFolder.length}</span>
                    </div>
                    {isOpen && (
                      <div className="tree-folder-contents">
                        {itemsInFolder.length === 0 && (
                          <p className="tree-empty-hint">Empty folder — save prefabs into it or drop them here.</p>
                        )}
                        {!isGridView && itemsInFolder.length > 0 && renderListHeader()}
                        {itemsInFolder.map((p) => (isGridView ? renderPrefabCard(p) : renderPrefabRow(p)))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* New prefab folder inline creation */}
              {creatingFolder === 'prefabs' && (
                <div className="tree-folder-group nested new-folder-row">
                  <Folder size={13} className="text-cyan" />
                  <input
                    type="text"
                    className="asset-rename-input"
                    placeholder="Folder name"
                    value={newFolderName}
                    autoFocus
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitNewFolder();
                      else if (e.key === 'Escape') { setCreatingFolder(null); setNewFolderName(''); }
                    }}
                    onBlur={commitNewFolder}
                  />
                </div>
              )}

              {!isGridView && rootPrefabs.length > 0 && renderListHeader()}
              {rootPrefabs.map((prefab) => (isGridView ? renderPrefabCard(prefab) : renderPrefabRow(prefab)))}
            </div>
          )}
        </div>

        {/* ========== media/ ========== */}
        <div className="tree-folder-group" data-section="media">
          <div
            className={`tree-folder-header${dragOverKey === 'media:__root__' ? ' drag-over' : ''}`}
            onClick={() => toggleFolder('media')}
            onDragOver={(e) => handleFolderDragOver(e, ITEM_KIND_MEDIA, 'media:__root__')}
            onDragLeave={handleFolderDragLeave}
            onDrop={(e) => handleFolderDrop(e, 'media', null, ITEM_KIND_MEDIA)}
          >
            {openFolders.media ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {openFolders.media ? <FolderOpen size={13} className="text-indigo" /> : <Folder size={13} className="text-indigo" />}
            <span className="tree-folder-name">media</span>
            <span className="tree-folder-count">{filteredMedia.length}</span>
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
          </div>

          {openFolders.media && (
            <div className="tree-folder-contents">
              {filteredMedia.length === 0 && extraFolders.length === 0 && (
                <p className="tree-empty-hint">No media yet. Use + to import a clip.</p>
              )}

              {/* Duplicate-import notice (Feature 8) */}
              {dupeNotice != null && (
                <div className="project-dupe-notice">
                  <span>{dupeNotice} file(s) look like duplicates of existing assets — imported as new entries.</span>
                  <button onClick={() => setDupeNotice(null)} title="Dismiss">×</button>
                </div>
              )}

              {/* Media subfolders (asset folders like "Recordings" + context-menu folders) */}
              {mediaSubfolderNames.map((folderName) => {
                const isOpen = !!openMediaSubfolders[folderName];
                const assetsInFolder = filteredMedia.filter((m) => m.folder === folderName);
                return (
                  <div key={folderName} className="tree-folder-group nested">
                    <div
                      className={`tree-folder-header${dragOverKey === `media:${folderName}` ? ' drag-over' : ''}`}
                      onClick={() => toggleMediaSubfolder(folderName)}
                      onContextMenu={(e) => openFolderMenu(e, 'media', folderName)}
                      onDragOver={(e) => handleFolderDragOver(e, ITEM_KIND_MEDIA, `media:${folderName}`)}
                      onDragLeave={handleFolderDragLeave}
                      onDrop={(e) => handleFolderDrop(e, 'media', folderName, ITEM_KIND_MEDIA)}
                    >
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {isOpen ? <FolderOpen size={13} className="text-amber" /> : <Folder size={13} className="text-amber" />}
                      {folderRenameInput('media', folderName) || <span className="tree-folder-name">{folderName}</span>}
                      <span className="tree-folder-count">{assetsInFolder.length}</span>
                    </div>
                    {isOpen && (
                      <div className="tree-folder-contents">
                        {assetsInFolder.length === 0 && (
                          <p className="tree-empty-hint">Empty folder — import media into it or drop files here.</p>
                        )}
                        {!isGridView && assetsInFolder.length > 0 && renderListHeader()}
                        {assetsInFolder.map((m) => (isGridView ? renderMediaCard(m) : renderMediaRow(m)))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* New media folder inline creation */}
              {creatingFolder === 'media' && (
                <div className="tree-folder-group nested new-folder-row">
                  <Folder size={13} className="text-amber" />
                  <input
                    type="text"
                    className="asset-rename-input"
                    placeholder="Folder name"
                    value={newFolderName}
                    autoFocus
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitNewFolder();
                      else if (e.key === 'Escape') { setCreatingFolder(null); setNewFolderName(''); }
                    }}
                    onBlur={commitNewFolder}
                  />
                </div>
              )}

              {!isGridView && rootMedia.length > 0 && renderListHeader()}
              {rootMedia.map((m) => (isGridView ? renderMediaCard(m) : renderMediaRow(m)))}
            </div>
          )}
        </div>

        {/* ========== scripts/ ========== */}
        <div className="tree-folder-group" data-section="scripts">
          <div
            className={`tree-folder-header${dragOverKey === 'script:__root__' ? ' drag-over' : ''}`}
            onClick={() => toggleFolder('scripts')}
            onDragOver={(e) => handleFolderDragOver(e, ITEM_KIND_SCRIPT, 'script:__root__')}
            onDragLeave={handleFolderDragLeave}
            onDrop={(e) => handleFolderDrop(e, 'script', null, ITEM_KIND_SCRIPT)}
          >
            {openFolders.scripts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {openFolders.scripts ? <FolderOpen size={13} className="text-emerald" /> : <Folder size={13} className="text-emerald" />}
            <span className="tree-folder-name">scripts</span>
            <span className="tree-folder-count">{filteredScripts.length}</span>
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
          </div>

          {openFolders.scripts && (
            <div className="tree-folder-contents">
              {filteredScripts.length === 0 && scriptExtraFolders.length === 0 && (
                <p className="tree-empty-hint">No scripts yet. Use + to create a new script.</p>
              )}

              {/* Script subfolders (Feature 5) */}
              {scriptSubfolderNames.map((folderName) => {
                const isOpen = !!openScriptSubfolders[folderName];
                const itemsInFolder = filteredScripts.filter((s) => s.folder === folderName);
                return (
                  <div key={folderName} className="tree-folder-group nested">
                    <div
                      className={`tree-folder-header${dragOverKey === `script:${folderName}` ? ' drag-over' : ''}`}
                      onClick={() => toggleScriptSubfolder(folderName)}
                      onContextMenu={(e) => openFolderMenu(e, 'scripts', folderName)}
                      onDragOver={(e) => handleFolderDragOver(e, ITEM_KIND_SCRIPT, `script:${folderName}`)}
                      onDragLeave={handleFolderDragLeave}
                      onDrop={(e) => handleFolderDrop(e, 'script', folderName, ITEM_KIND_SCRIPT)}
                    >
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {isOpen ? <FolderOpen size={13} className="text-emerald" /> : <Folder size={13} className="text-emerald" />}
                      {folderRenameInput('scripts', folderName) || <span className="tree-folder-name">{folderName}</span>}
                      <span className="tree-folder-count">{itemsInFolder.length}</span>
                    </div>
                    {isOpen && (
                      <div className="tree-folder-contents">
                        {itemsInFolder.length === 0 && (
                          <p className="tree-empty-hint">Empty folder — create scripts into it or drop them here.</p>
                        )}
                        {!isGridView && itemsInFolder.length > 0 && renderListHeader()}
                        {itemsInFolder.map((s) => (isGridView ? renderScriptCard(s) : renderScriptRow(s)))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* New script folder inline creation */}
              {creatingFolder === 'scripts' && (
                <div className="tree-folder-group nested new-folder-row">
                  <Folder size={13} className="text-emerald" />
                  <input
                    type="text"
                    className="asset-rename-input"
                    placeholder="Folder name"
                    value={newFolderName}
                    autoFocus
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitNewFolder();
                      else if (e.key === 'Escape') { setCreatingFolder(null); setNewFolderName(''); }
                    }}
                    onBlur={commitNewFolder}
                  />
                </div>
              )}

              {!isGridView && rootScripts.length > 0 && renderListHeader()}
              {rootScripts.map((script) => (isGridView ? renderScriptCard(script) : renderScriptRow(script)))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right-click context menu ─────────────────────────────────────── */}
      {ctxMenu && (
        <div className="project-context-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onContextMenu={(e) => e.preventDefault()}>
          {ctxMenu.target.kind === 'empty' && (
            <>
              {ctxMenu.target.section && ctxMenu.target.section !== 'shared' && (
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
        </div>
      )}

      {/* ── Hover / click asset preview ───────────────────────────────────── */}
      {preview && (
        <AssetPreviewPopover x={preview.x} y={preview.y} kind={preview.kind} item={preview.item} />
      )}
    </aside>
  );
});

// ── Compact hover preview ---------------------------------------------------

function AssetPreviewPopover({ x, y, kind, item }) {
  return (
    <div className="asset-hover-preview" style={{ left: Math.min(x + 16, window.innerWidth - 300), top: Math.min(y + 16, window.innerHeight - 200) }} onMouseLeave={() => {}}>
      {kind === 'media' && <MediaPreview asset={item} />}
      {kind === 'script' && <ScriptPreview script={item} />}
      {kind === 'prefab' && <PrefabPreview prefab={item} />}
    </div>
  );
}

function MediaPreview({ asset }) {
  if (asset?.type === 'video') {
    return (
      <>
        <div className="asset-preview-head">
          <FilmIcon size={12} className="text-indigo" />
          <span className="asset-preview-title">{asset.name}</span>
        </div>
        <video
          className="asset-preview-media"
          src={asset.url}
          muted
          autoPlay
          loop
          playsInline
          preload="metadata"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <div className="asset-preview-meta">Video · {shortDuration(asset.duration)}</div>
      </>
    );
  }
  return (
    <>
      <div className="asset-preview-head">
        <Music size={12} className="text-emerald" />
        <span className="asset-preview-title">{asset?.name}</span>
      </div>
      <div className="asset-preview-audio">
        <audio src={asset?.url} muted autoPlay loop controls preload="metadata" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      </div>
      <div className="asset-preview-meta">Audio · {shortDuration(asset?.duration)}</div>
    </>
  );
}

function ScriptPreview({ script }) {
  const Meta = scriptKindMeta(detectScriptKind(script?.code || ''));
  const snippet = (script?.code || '').slice(0, 900);
  return (
    <>
      <div className="asset-preview-head">
        <Meta.icon size={12} className={Meta.className} />
        <span className="asset-preview-title">{script?.name}</span>
      </div>
      <pre className="asset-preview-code">
        {snippet}
        {(script?.code || '').length > 900 ? '\n…' : ''}
      </pre>
    </>
  );
}

// Prefab breakdown: component summary of every snapshot.
function PrefabPreview({ prefab }) {
  const snapshots = (Array.isArray(prefab?.entities) && prefab.entities.length > 0 ? prefab.entities : null);
  const roots = snapshots || (prefab ? [{ components: prefab.components || [], name: prefab.name }] : []);
  return (
    <>
      <div className="asset-preview-head">
        <Package size={12} className="text-cyan" />
        <span className="asset-preview-title">{prefab?.name}</span>
      </div>
      <div className="asset-preview-breakdown">
        {roots.map((entity) => {
          const comps = Array.isArray(entity.components) ? entity.components : [];
          const kinds = comps
            .filter((c) => c.type !== 'Transform')
            .map((c) => {
              if (isScriptComponent(c)) return `Script · ${c.scriptName || ''}`;
              return COMPONENT_TYPE_LABEL[c.type] || c.type;
            });
          return (
            <div key={entity.id || entity.name} className="preview-entity-row">
              <span className="preview-entity-name">{entity.name || prefab?.name}</span>
              <span className="preview-entity-comps">{kinds.length ? kinds.join(' · ') : 'empty'}</span>
            </div>
          );
        })}
        {snapshots && snapshots.length > 1 && (
          <div className="asset-preview-meta">{snapshots.length} objects · hierarchical</div>
        )}
      </div>
    </>
  );
}
