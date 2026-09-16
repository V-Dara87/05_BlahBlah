import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import {
  Package,
  FileCode,
  Upload,
  Trash2,
  FolderPlus,
  Layers,
  Share2,
  Pencil,
} from 'lucide-react';
import { detectScriptKind } from '../engine/scriptRunner';
import { importMediaFiles } from '../services/mediaImport';
import { isTauri } from '../services/tauriFsAdapter';
import { openProjectInVsCode } from '../services/ideLauncher';
import {
  deleteFolderFromProject,
  renameFolderInProject,
} from '../services/projectFileSystem';
import {
  setDragPayload,
  readDragPayload,
  dragHasItemKind,
} from '../utils/dragData';
import { ContextMenu } from './ContextMenu';
import { AssetPreviewPopover } from './project/AssetPreviewPopover';
import { useSectionFolders } from './project/useSectionFolders';
import { KIND_REGISTRY } from './project/kindRegistry';
import {
  SECTIONS_CONFIG,
  ROOT_LOCATION,
  isSameLocation,
  selKey,
} from './project/projectPanelConstants';
import { ExplorerAddressBar } from './project/ExplorerAddressBar';
import { ExplorerCommandBar } from './project/ExplorerCommandBar';
import { ExplorerNavPane } from './project/ExplorerNavPane';
import { ExplorerContentView } from './project/ExplorerContentView';
import { ExplorerStatusBar } from './project/ExplorerStatusBar';
import './project-panel.css';

/**
 * Windows File Explorer styled Project navigation surface.
 *
 * Features:
 * - Address bar with Back / Forward / Up / Refresh navigation, interactive
 *   clickable breadcrumbs, and real-time search box.
 * - Command toolbar: New menu (Folder, Import Media, Script, Empty Clip),
 *   Rename, Delete, Share, Sort, View mode switcher, and Navigation Pane toggle.
 * - Two-pane layout:
 *   - Left Navigation Pane (folder tree with Quick Access and Project Folders).
 *   - Right Content Pane (files and subfolders of currently navigated folder).
 * - Authentic folder navigation: double-click folder to open, double-click script
 *   to edit, double-click media to add to timeline.
 * - Grid / Icons view and Details table view with clickable sortable columns.
 * - Bottom status bar with item count and selection summary.
 * - Multi-selection (Click / Ctrl+Click / Shift+Range), drag-to-folder,
 *   keyboard shortcuts (F2, Del, Backspace, Ctrl+A, Alt+Up, etc.).
 */
export const ProjectPanel = memo(function ProjectPanel({
  mediaAssets = [],
  prefabs = [],
  scripts = [],
  projectFolderHandle,
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
  const registryCtx = useMemo(
    () => ({
      mediaAssets,
      prefabs,
      scripts,
      sharedItems,
      onRemoveMediaAsset,
      onRemovePrefab,
      onRemoveScript,
      onRemoveSharedItem,
      onMoveMediaAsset,
      onMovePrefab,
      onMoveScript,
      onMoveSharedItem,
      onRenameMediaAsset,
      onRenamePrefab,
      onRenameScript,
    }),
    [
      mediaAssets,
      prefabs,
      scripts,
      sharedItems,
      onRemoveMediaAsset,
      onRemovePrefab,
      onRemoveScript,
      onRemoveSharedItem,
      onMoveMediaAsset,
      onMovePrefab,
      onMoveScript,
      onMoveSharedItem,
      onRenameMediaAsset,
      onRenamePrefab,
      onRenameScript,
    ]
  );

  // ── Navigation & History State ───────────────────────────────────────────
  const [currentLocation, setCurrentLocation] = useState(ROOT_LOCATION);
  const [history, setHistory] = useState([ROOT_LOCATION]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // ── Multi-select ─────────────────────────────────────────────────────────
  const [selectedItems, setSelectedItems] = useState(() => new Set());
  const lastClickedKeyRef = useRef(null);

  const clearSelection = useCallback(() => setSelectedItems(new Set()), [setSelectedItems]);

  const navigateTo = useCallback((newLoc) => {
    setCurrentLocation((prev) => {
      if (isSameLocation(prev, newLoc)) return prev;
      setHistory((prevHist) => {
        const sliced = prevHist.slice(0, historyIndex + 1);
        return [...sliced, newLoc];
      });
      setHistoryIndex((prevIdx) => prevIdx + 1);
      return newLoc;
    });
    setSelectedItems(new Set());
  }, [historyIndex, setSelectedItems]);

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1;
      setHistoryIndex(nextIdx);
      setCurrentLocation(history[nextIdx]);
      setSelectedItems(new Set());
    }
  }, [historyIndex, history]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      setHistoryIndex(nextIdx);
      setCurrentLocation(history[nextIdx]);
      setSelectedItems(new Set());
    }
  }, [historyIndex, history]);

  const goUp = useCallback(() => {
    if (currentLocation.folder) {
      navigateTo({ section: currentLocation.section, folder: null });
    } else if (currentLocation.section) {
      navigateTo(ROOT_LOCATION);
    }
  }, [currentLocation, navigateTo]);

  // ── Explorer Layout & View State ─────────────────────────────────────────
  const [showNavPane, setShowNavPane] = useState(true);
  const [navPaneWidth, setNavPaneWidth] = useState(165);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('name-asc');
  const [mediaTypeFilter, setMediaTypeFilter] = useState({ video: true, audio: true });
  const [scriptKindFilter, setScriptKindFilter] = useState({ react: true, canvas: true, motion: true });

  const [treeOpenSections, setTreeOpenSections] = useState({
    media: true,
    prefabs: true,
    scripts: true,
    shared: true,
  });

  const toggleSectionOpen = useCallback((sec) => {
    setTreeOpenSections((prev) => ({ ...prev, [sec]: !prev[sec] }));
  }, []);

  const [dupeNotice, setDupeNotice] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [replaceTarget, setReplaceTarget] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [preview, setPreview] = useState(null);
  const [renaming, setRenaming] = useState(null); // { kind, id, name, section? }
  const [creatingFolder, setCreatingFolder] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');

  const panelRef = useRef(null);
  const fileInputRef = useRef(null);
  const replaceFileInputRef = useRef(null);

  // ── Folder Section Store Hook ────────────────────────────────────────────
  const itemsBySection = useMemo(
    () => ({
      media: KIND_REGISTRY.media.getAllItems(registryCtx),
      prefabs: KIND_REGISTRY.prefab.getAllItems(registryCtx),
      scripts: KIND_REGISTRY.script.getAllItems(registryCtx),
      shared: KIND_REGISTRY.shared.getAllItems(registryCtx),
    }),
    [registryCtx]
  );

  const {
    foldersBySection,
    setExtraFoldersFor,
    setOpenSubfoldersFor,
  } = useSectionFolders({ projectFolderHandle, itemsBySection });


  // ── Sorting & Filtering ──────────────────────────────────────────────────
  const sortList = useCallback(
    (list) => {
      const sorted = [...list];
      switch (sortBy) {
        case 'name-asc':
          sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          break;
        case 'name-desc':
          sorted.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
          break;
        case 'date-asc':
          sorted.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          break;
        case 'date-desc':
          sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          break;
        case 'duration-desc':
          sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0));
          break;
        case 'duration-asc':
          sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0));
          break;
        case 'size-desc':
          sorted.sort((a, b) => (b.size || 0) - (a.size || 0));
          break;
        case 'size-asc':
          sorted.sort((a, b) => (a.size || 0) - (b.size || 0));
          break;
        default:
          break;
      }
      return sorted;
    },
    [sortBy]
  );

  const handleSortByColumn = useCallback((col) => {
    setSortBy((prev) => {
      if (prev === `${col}-asc`) return `${col}-desc`;
      return `${col}-asc`;
    });
  }, []);

  const query = searchQuery.toLowerCase().trim();

  // Filtered lists per section
  const filteredShared = useMemo(
    () => sortList(sharedItems.filter((i) => (i.name || '').toLowerCase().includes(query))),
    [sharedItems, query, sortList]
  );

  const filteredPrefabs = useMemo(
    () => sortList(prefabs.filter((p) => (p.name || '').toLowerCase().includes(query))),
    [prefabs, query, sortList]
  );

  const filteredMedia = useMemo(
    () =>
      sortList(
        mediaAssets.filter(
          (m) =>
            (m.name || '').toLowerCase().includes(query) &&
            ((mediaTypeFilter.video && m.type === 'video') ||
              (mediaTypeFilter.audio && m.type === 'audio'))
        )
      ),
    [mediaAssets, query, mediaTypeFilter, sortList]
  );

  const filteredScripts = useMemo(
    () =>
      sortList(
        scripts.filter((s) => {
          if (!(s.name || '').toLowerCase().includes(query)) return false;
          const kind = detectScriptKind(s.code || '');
          return scriptKindFilter[kind] !== false;
        })
      ),
    [scripts, query, scriptKindFilter, sortList]
  );

  // Active items for the CURRENT navigated location
  const currentSectionItems = useMemo(() => {
    if (!currentLocation.section) return [];
    if (currentLocation.section === 'media') return filteredMedia;
    if (currentLocation.section === 'prefabs') return filteredPrefabs;
    if (currentLocation.section === 'scripts') return filteredScripts;
    if (currentLocation.section === 'shared') return filteredShared;
    return [];
  }, [currentLocation.section, filteredMedia, filteredPrefabs, filteredScripts, filteredShared]);

  const filteredItemsInView = useMemo(() => {
    if (!currentLocation.section) return [];
    if (searchQuery) {
      // While searching, show all matching items in this section regardless of folder
      return currentSectionItems;
    }
    if (currentLocation.folder) {
      return currentSectionItems.filter((i) => i.folder === currentLocation.folder);
    }
    // At section root: show items with no folder
    return currentSectionItems.filter((i) => !i.folder);
  }, [currentLocation, currentSectionItems, searchQuery]);

  const subfolderNamesInView = useMemo(() => {
    if (!currentLocation.section || currentLocation.folder || searchQuery) return [];
    const all = foldersBySection[currentLocation.section] || [];
    return all;
  }, [currentLocation, foldersBySection, searchQuery]);

  // ── Selection helpers ────────────────────────────────────────────────────
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
  };

  // Double click handlers
  const handleItemDoubleClick = (kind, item) => {
    if (kind === 'script') {
      onOpenScriptEditor(item);
    } else if (kind === 'media') {
      onAddMediaToTimeline(item);
    } else if (kind === 'prefab') {
      onAddPrefabToTimeline(item);
    } else if (kind === 'shared') {
      if (item.type === 'prefab') onAddPrefabToTimeline(item.data);
      else onImportSharedItem(item);
    }
  };

  const handleFolderDoubleClick = (section, folderName) => {
    navigateTo({ section, folder: folderName });
  };

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  const handleDragStart = (e, itemType, itemData) => {
    setDragPayload(e.dataTransfer, itemType, itemData);
  };

  const moveItemToFolder = (kind, id, folderName) => {
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
    if (selectedItems.has(key) && selectedItems.size > 1) {
      selectedItems.forEach((k) => {
        const [kKind, id] = k.split(':');
        if (kKind === section) moveItemToFolder(kKind, id, folderName);
      });
    } else {
      moveItemToFolder(section, draggedId, folderName);
    }
  };

  // ── Deletion ─────────────────────────────────────────────────────────────
  const deleteItem = useCallback((kind, item) => {
    KIND_REGISTRY[kind]?.deleteFn(item.id, registryCtx);
  }, [registryCtx]);

  const bulkDeleteSelected = useCallback(() => {
    if (selectedItems.size === 0) return;
    const entries = resolveSelectionEntries();
    if (entries.length === 0) return;
    if (entries.length > 1 && !window.confirm(`Delete ${entries.length} item(s)?`)) return;
    setCtxMenu(null);
    clearSelection();
    entries.forEach(({ kind, item }) => deleteItem(kind, item));
  }, [selectedItems, resolveSelectionEntries, deleteItem, clearSelection]);

  // ── Renaming ─────────────────────────────────────────────────────────────
  const startRename = (kind, item) => {
    setRenaming({ kind, id: item.id, name: item.name || '' });
    setCtxMenu(null);
  };

  const startFolderRename = (section, name) => {
    setRenaming({ kind: 'folder', section, id: name, name });
    setCtxMenu(null);
  };

  const commitFolderRename = async (section, oldName, newName) => {
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

    if (currentLocation.section === section && currentLocation.folder === oldName) {
      setCurrentLocation((prev) => ({ ...prev, folder: newName }));
    }
  };

  const commitRename = async () => {
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
  };

  // ── Folder creation & deletion ───────────────────────────────────────────
  const commitNewFolder = async () => {
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
  };

  const deleteFolder = async (section, name) => {
    setCtxMenu(null);
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
  };

  // ── File actions ─────────────────────────────────────────────────────────
  const handleFileUpload = (files) => {
    importMediaFiles({
      files,
      onAddMediaAsset: (asset) => {
        if (currentLocation.section === 'media' && currentLocation.folder) {
          asset.folder = currentLocation.folder;
        }
        onAddMediaAsset?.(asset);
      },
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
  };

  // ── Context Menus ────────────────────────────────────────────────────────
  const openEmptyMenu = (e, section) => {
    e.preventDefault();
    if (
      e.target.closest('.asset-card') ||
      e.target.closest('.explorer-details-row') ||
      e.target.closest('.explorer-tree-node')
    )
      return;
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      target: { kind: 'empty', section: section || currentLocation.section || 'media' },
    });
  };

  const openItemMenuSafe = (e, kind, item) => {
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
  };

  const openFolderMenu = (e, section, folderName) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      target: { kind: 'folder', section, name: folderName },
    });
  };

  const handleContextAction = (action) => {
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
      setCtxMenu(null);
      fileInputRef.current?.click();
    } else if (action === 'open') {
      setCtxMenu(null);
      if (target.kind === 'folder') {
        navigateTo({ section: target.section, folder: target.name });
      } else if (target.item) {
        handleItemDoubleClick(target.kind, target.item);
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
  };

  // ── Keyboard Navigation ──────────────────────────────────────────────────
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
    selectedItems,
    ctxMenu,
    currentLocation,
    filteredItemsInView,
    goBack,
    goForward,
    goUp,
    resolveSelectionEntries,
    bulkDeleteSelected,
    clearSelection,
  ]);

  // Focus panel on selection
  useEffect(() => {
    if (selectedItems.size > 0) panelRef.current?.focus({ preventScroll: true });
  }, [selectedItems]);

  // Auto-dismiss duplicate notice
  useEffect(() => {
    if (dupeNotice == null) return;
    const t = setTimeout(() => setDupeNotice(null), 5000);
    return () => clearTimeout(t);
  }, [dupeNotice]);

  // Selected entry summaries for command bar & status bar
  const selectedEntries = resolveSelectionEntries();
  const canRenameSelected =
    selectedEntries.length === 1 && selectedEntries[0].kind !== 'shared';
  const canDeleteSelected = selectedEntries.length > 0;
  const canShareSelected =
    selectedEntries.length > 0 &&
    selectedEntries.every(({ kind }) => kind === 'prefab' || kind === 'script');
  const selectedTotalSize = selectedEntries.reduce(
    (acc, { item }) => acc + (item?.size || 0),
    0
  );

  const totalItemsCountInView =
    (currentLocation.section ? filteredItemsInView.length : 4) +
    subfolderNamesInView.length;

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="project-panel explorer-root-container"
      onClick={(e) => {
        if (ctxMenu && !e.target.closest('.project-context-menu')) setCtxMenu(null);
        if (
          !e.target.closest('.asset-card') &&
          !e.target.closest('.explorer-details-row') &&
          !e.target.closest('.explorer-tree-node') &&
          !e.target.closest('input') &&
          !e.target.closest('button')
        ) {
          clearSelection();
        }
      }}
    >
      {/* 1. Top Windows Explorer Address Bar */}
      <ExplorerAddressBar
        currentLocation={currentLocation}
        canGoBack={historyIndex > 0}
        canGoForward={historyIndex < history.length - 1}
        canGoUp={Boolean(currentLocation.section || currentLocation.folder)}
        onGoBack={goBack}
        onGoForward={goForward}
        onGoUp={goUp}
        onNavigate={navigateTo}
        onRefresh={() => {
          // Re-trigger scan if project folder attached
          if (currentLocation.section && currentLocation.folder) {
            navigateTo({ ...currentLocation });
          } else {
            navigateTo(currentLocation);
          }
        }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* 2. Command Toolbar */}
      <ExplorerCommandBar
        currentLocation={currentLocation}
        selectedCount={selectedEntries.length}
        canRename={canRenameSelected}
        canDelete={canDeleteSelected}
        canShare={canShareSelected}
        onNewFolder={() => {
          const sec = currentLocation.section || 'media';
          setCreatingFolder(sec);
          setNewFolderName('');
        }}
        onImportMedia={() => fileInputRef.current?.click()}
        onNewScript={handleCreateNewScript}
        onNewClip={onAddEmptyClip}
        onOpenVsCode={() => projectFolderHandle?.path && openProjectInVsCode(projectFolderHandle.path)}
        hasVsCode={Boolean(projectFolderHandle?.path && isTauri())}
        onRename={() => {
          if (canRenameSelected) {
            const [entry] = selectedEntries;
            startRename(entry.kind, entry.item);
          }
        }}
        onDelete={bulkDeleteSelected}
        onShare={() => {
          selectedEntries.forEach(({ kind, item }) => {
            if (kind === 'prefab') onSharePrefab?.(item);
            else if (kind === 'script') onShareScript?.(item);
          });
        }}
        sortBy={sortBy}
        onSortChange={setSortBy}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showNavPane={showNavPane}
        onToggleNavPane={() => setShowNavPane((v) => !v)}
        mediaTypeFilter={mediaTypeFilter}
        onMediaTypeFilterChange={setMediaTypeFilter}
        scriptKindFilter={scriptKindFilter}
        onScriptKindFilterChange={setScriptKindFilter}
      />

      {/* Duplicate notice */}
      {dupeNotice != null && (
        <div className="project-dupe-notice">
          <span>
            {dupeNotice} file(s) look like duplicates of existing assets — imported as new entries.
          </span>
          <button onClick={() => setDupeNotice(null)} title="Dismiss">
            ×
          </button>
        </div>
      )}

      {/* 3. Main Split View: Left Nav Pane + Right Content View */}
      <div className="explorer-main-area">
        {showNavPane && (
          <ExplorerNavPane
            width={navPaneWidth}
            onWidthChange={setNavPaneWidth}
            currentLocation={currentLocation}
            onNavigate={navigateTo}
            treeOpenSections={treeOpenSections}
            onToggleSectionOpen={toggleSectionOpen}
            foldersBySection={foldersBySection}
            itemsBySection={itemsBySection}
            dragOverKey={dragOverKey}
            onFolderDragOver={handleFolderDragOver}
            onFolderDragLeave={handleFolderDragLeave}
            onFolderDrop={handleFolderDrop}
            onOpenFolderMenu={openFolderMenu}
          />
        )}

        <ExplorerContentView
          currentLocation={currentLocation}
          onNavigate={navigateTo}
          viewMode={viewMode}
          sortBy={sortBy}
          onSortByColumn={handleSortByColumn}
          itemsBySection={itemsBySection}
          foldersBySection={foldersBySection}
          subfolderNames={subfolderNamesInView}
          filteredItems={filteredItemsInView}
          selectedItems={selectedItems}
          onItemClick={handleItemClick}
          onItemDoubleClick={handleItemDoubleClick}
          onFolderDoubleClick={handleFolderDoubleClick}
          renameInput={renameInput}
          folderRenameInput={folderRenameInput}
          creatingFolder={creatingFolder}
          newFolderName={newFolderName}
          setNewFolderName={setNewFolderName}
          commitNewFolder={commitNewFolder}
          setCreatingFolder={setCreatingFolder}
          dragOverKey={dragOverKey}
          onFolderDragOver={handleFolderDragOver}
          onFolderDragLeave={handleFolderDragLeave}
          onFolderDrop={handleFolderDrop}
          onItemContextMenu={openItemMenuSafe}
          onFolderContextMenu={openFolderMenu}
          onEmptyContextMenu={openEmptyMenu}
          onDragStart={handleDragStart}
          showPreview={(e, kind, item) =>
            setPreview({ x: e.clientX, y: e.clientY, kind, item })
          }
          setPreview={setPreview}
          onAddMediaToTimeline={onAddMediaToTimeline}
          onAddPrefabToTimeline={onAddPrefabToTimeline}
          onImportSharedItem={onImportSharedItem}
          onSharePrefab={onSharePrefab}
          onShareScript={onShareScript}
          onImportMedia={() => fileInputRef.current?.click()}
          onNewScript={handleCreateNewScript}
        />
      </div>

      {/* 4. Bottom Windows Explorer Status Bar */}
      <ExplorerStatusBar
        itemCount={totalItemsCountInView}
        selectedCount={selectedEntries.length}
        selectedSize={selectedTotalSize}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        multiple
        accept="video/*,audio/*"
        onChange={(e) => handleFileUpload(e.target.files)}
      />
      <input
        type="file"
        ref={replaceFileInputRef}
        style={{ display: 'none' }}
        accept="video/*,audio/*"
        onChange={handleReplaceFile}
      />

      {/* Context Menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          className="project-context-menu"
          minWidth={175}
        >
          {ctxMenu.target.kind === 'empty' && (
            <>
              <button
                className="ctx-menu-item"
                onClick={() => handleContextAction('new-folder')}
              >
                <FolderPlus size={13} className="text-amber" /> New Folder
              </button>
              <button
                className="ctx-menu-item"
                onClick={() => handleContextAction('import-media')}
              >
                <Upload size={13} className="text-indigo" /> Import Media…
              </button>
              <button
                className="ctx-menu-item"
                onClick={() => handleContextAction('new-script')}
              >
                <FileCode size={13} className="text-emerald" /> New Script
              </button>
              <button
                className="ctx-menu-item"
                onClick={() => handleContextAction('new-clip')}
              >
                <Layers size={13} className="text-cyan" /> New Empty Clip
              </button>
            </>
          )}

          {ctxMenu.target.kind === 'folder' && (
            <>
              <button
                className="ctx-menu-item"
                onClick={() => handleContextAction('open')}
              >
                <Package size={13} /> Open
              </button>
              {ctxMenu.target.name && (
                <>
                  <button
                    className="ctx-menu-item"
                    onClick={() => handleContextAction('rename')}
                  >
                    <Pencil size={13} /> Rename Folder
                  </button>
                  <button
                    className="ctx-menu-item danger"
                    onClick={() => handleContextAction('delete')}
                  >
                    <Trash2 size={13} /> Delete Folder
                  </button>
                </>
              )}
            </>
          )}

          {ctxMenu.target.kind === 'multi' && (
            <>
              {ctxMenu.target.items.length > 0 &&
                ctxMenu.target.items.every(
                  ({ kind }) => kind === 'prefab' || kind === 'script'
                ) && (
                  <button
                    className="ctx-menu-item"
                    onClick={() => handleContextAction('share')}
                  >
                    <Share2 size={13} /> Save to Shared Library
                  </button>
                )}
              <button
                className="ctx-menu-item danger"
                onClick={() => handleContextAction('delete')}
              >
                <Trash2 size={13} /> Delete {ctxMenu.target.items.length} items
              </button>
            </>
          )}

          {ctxMenu.target.kind !== 'empty' &&
            ctxMenu.target.kind !== 'folder' &&
            ctxMenu.target.kind !== 'multi' && (
              <>
                <button
                  className="ctx-menu-item"
                  onClick={() => handleContextAction('open')}
                >
                  <Package size={13} /> Open
                </button>
                {ctxMenu.target.kind !== 'shared' && (
                  <button
                    className="ctx-menu-item"
                    onClick={() => handleContextAction('rename')}
                  >
                    <Pencil size={13} /> Rename
                  </button>
                )}
                {ctxMenu.target.kind === 'media' && onReplaceMediaAsset && (
                  <button
                    className="ctx-menu-item"
                    onClick={() => handleContextAction('replace')}
                  >
                    <Upload size={13} /> Replace…
                  </button>
                )}
                {(ctxMenu.target.kind === 'prefab' ||
                  ctxMenu.target.kind === 'script') && (
                  <button
                    className="ctx-menu-item"
                    onClick={() => handleContextAction('share')}
                  >
                    <Share2 size={13} /> Save to Shared Library
                  </button>
                )}
                <button
                  className="ctx-menu-item danger"
                  onClick={() => handleContextAction('delete')}
                >
                  <Trash2 size={13} /> Delete
                </button>
              </>
            )}
        </ContextMenu>
      )}

      {/* Asset Preview Popover */}
      {preview && (
        <AssetPreviewPopover
          x={preview.x}
          y={preview.y}
          kind={preview.kind}
          item={preview.item}
        />
      )}
    </aside>
  );
});