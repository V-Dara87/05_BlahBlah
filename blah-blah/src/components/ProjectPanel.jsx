import { useState, useRef, useEffect, useMemo, memo } from 'react';
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
import { setDragPayload, ITEM_KIND_MEDIA, ITEM_KIND_PREFAB, ITEM_KIND_SCRIPT } from '../utils/dragData';

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

/**
 * Project file explorer — the single project navigation surface (the old
 * standalone Clips tab was removed; clips live on the timeline).
 *
 * Contents are organized as a folder tree matching the on-disk project
 * layout (Shared Library / prefabs / media incl. subfolders / scripts),
 * with a Grid ⇄ List view toggle, hover asset previews, and right-click
 * context menus (empty space: New Folder / New Empty Clip / New Script;
 * items: Rename / Delete / Save to Shared Library). Every asset card is
 * draggable onto the timeline, and script cards also drop onto Inspector /
 * timeline clips to attach scripts.
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
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const [scriptsMenuOpen, setScriptsMenuOpen] = useState(false);
  const fileInputRef = useRef(null);

  // Context menu: { x, y, target } where target is
  // { kind: 'empty' } | { kind: 'folder', name } |
  // { kind: 'shared'|'prefab'|'media'|'script', item }
  const [ctxMenu, setCtxMenu] = useState(null);
  const [preview, setPreview] = useState(null); // { x, y, kind, item }
  const [renaming, setRenaming] = useState(null); // { kind, id, name }
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  // Extra empty media subfolders created via the context menu. Kept in
  // panel state (media assets carry a folder field; an empty folder has no
  // assets to derive from, so it lives here until one lands in it).
  const [extraFolders, setExtraFolders] = useState([]);

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

  const toggleFolder = (name) => {
    setOpenFolders((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const toggleMediaSubfolder = (name) => {
    setOpenMediaSubfolders((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handleFileUpload = (files) => {
    // Shared import helper (same probe + asset shape as OS file drops,
    // see services/mediaImport.js) so the picker and desktop drag&drop
    // stay in sync.
    importMediaFiles({ files, onAddMediaAsset });
  };

  const handleCreateNewScript = () => {
    setScriptsMenuOpen(false);
    const newScript = {
      id: `script-${Date.now()}`,
      name: 'NewScript.jsx',
      description: 'Blank JavaScript Motion script',
      code: `export default class NewScript {
  static props = {};

  onUpdate({ transform, time }) {
    // Animate transform.x / transform.y / transform.rotation /
    // transform.scaleX / transform.scaleY / transform.opacity here.
    transform.x = Math.sin(time * 2) * 50; // placeholder — replace with your own motion
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

  // ── Right-click menus ────────────────────────────────────────────────────
  const openEmptyMenu = (e) => {
    e.preventDefault();
    // Cards and folder headers handle their own (item) menu / actions.
    if (e.target.closest('.asset-card') || e.target.closest('.tree-folder-header')) return;
    setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind: 'empty' } });
  };

  // Item right-clicks always suppress the native menu (browser default),
  // even for kinds with a reduced menu.
  const openItemMenuSafe = (e, kind, item) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind, item } });
  };

  const startRename = (kind, item) => {
    setRenaming({ kind, id: item.id, name: item.name || '' });
    closeCtxMenu();
  };

  const commitRename = () => {
    if (!renaming) return;
    const name = (renaming.name || '').trim();
    if (name) {
      if (renaming.kind === 'media' && onRenameMediaAsset) onRenameMediaAsset(renaming.id, name);
      else if (renaming.kind === 'prefab' && onRenamePrefab) onRenamePrefab(renaming.id, name);
      else if (renaming.kind === 'script' && onRenameScript) onRenameScript(renaming.id, name);
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

  const handleDeleteItem = (kind, item) => {
    closeCtxMenu();
    if (kind === 'media') onRemoveMediaAsset?.(item.id);
    else if (kind === 'prefab') onRemovePrefab?.(item.id);
    else if (kind === 'script') onRemoveScript?.(item.id);
    else if (kind === 'shared') onRemoveSharedItem?.(item.id);
  };

  const handleContextAction = (action) => {
    if (!ctxMenu) return;
    const { target } = ctxMenu;
    if (action === 'new-folder') {
      setCreatingFolder(true);
      setNewFolderName('');
      closeCtxMenu();
    } else if (action === 'new-clip') {
      closeCtxMenu();
      onAddEmptyClip?.();
    } else if (action === 'new-script') {
      closeCtxMenu();
      handleCreateNewScript();
    } else if (action === 'rename') {
      startRename(target.kind, target.item);
    } else if (action === 'delete') {
      handleDeleteItem(target.kind, target.item);
    } else if (action === 'share') {
      closeCtxMenu();
      if (target.kind === 'prefab') onSharePrefab?.(target.item);
      else if (target.kind === 'script') onShareScript?.(target.item);
    }
  };

  const commitNewFolder = () => {
    const name = (newFolderName || '').trim();
    if (name) {
      setExtraFolders((prev) => (prev.includes(name) ? prev : [...prev, name]));
      setOpenFolders((prev) => ({ ...prev, media: true }));
      setOpenMediaSubfolders((prev) => ({ ...prev, [name]: true }));
    }
    setCreatingFolder(false);
    setNewFolderName('');
  };

  // Folders: media subfolders derive from assets + context-menu folders.
  const allMediaFolders = useMemo(() => {
    const fromAssets = new Set(mediaAssets.filter((m) => m.folder).map((m) => m.folder));
    extraFolders.forEach((f) => fromAssets.add(f));
    return Array.from(fromAssets);
  }, [mediaAssets, extraFolders]);

  const query = searchQuery.toLowerCase();
  const filteredShared = sharedItems.filter((i) => i.name.toLowerCase().includes(query));
  const filteredPrefabs = prefabs.filter((p) => p.name.toLowerCase().includes(query));
  const filteredMedia = mediaAssets.filter((m) => m.name.toLowerCase().includes(query));
  const filteredScripts = scripts.filter((s) => s.name.toLowerCase().includes(query));

  const rootMedia = filteredMedia.filter((m) => !m.folder);
  const mediaSubfolderNames = allMediaFolders.filter((folderName) =>
    extraFolders.includes(folderName) ||
    filteredMedia.some((m) => m.folder === folderName)
  );

  // ── Hover preview ─────────────────────────────────────────────────────────
  const showPreview = (e, kind, item) => {
    setPreview({ x: e.clientX, y: e.clientY, kind, item });
  };

  // ── Grid card (shared markup for grid view + folder contents) ────────────
  const renderMediaCard = (asset) => (
    <div
      key={asset.id}
      className="asset-card media-card"
      draggable
      onDragStart={(e) => handleDragStart(e, ITEM_KIND_MEDIA, asset)}
      onMouseMove={(e) => showPreview(e, 'media', asset)}
      onMouseLeave={() => setPreview(null)}
      onContextMenu={(e) => openItemMenuSafe(e, 'media', asset)}
      onClick={(e) => {
        if (e.target.closest('button')) return;
        // Click also previews (compact quick look) for non-drag users.
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
      className="asset-list-row"
      draggable
      onDragStart={(e) => handleDragStart(e, ITEM_KIND_MEDIA, asset)}
      onMouseMove={(e) => showPreview(e, 'media', asset)}
      onMouseLeave={() => setPreview(null)}
      onContextMenu={(e) => openItemMenuSafe(e, 'media', asset)}
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
      className="asset-card prefab-card"
      draggable
      onDragStart={(e) => handleDragStart(e, ITEM_KIND_PREFAB, prefab)}
      onMouseMove={(e) => showPreview(e, 'prefab', prefab)}
      onMouseLeave={() => setPreview(null)}
      onContextMenu={(e) => openItemMenuSafe(e, 'prefab', prefab)}
      onClick={(e) => {
        if (e.target.closest('button')) return;
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
      className="asset-list-row"
      draggable
      onDragStart={(e) => handleDragStart(e, ITEM_KIND_PREFAB, prefab)}
      onMouseMove={(e) => showPreview(e, 'prefab', prefab)}
      onMouseLeave={() => setPreview(null)}
      onContextMenu={(e) => openItemMenuSafe(e, 'prefab', prefab)}
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
    return (
      <div
        key={script.id}
        className="asset-card script-card"
        onClick={() => onOpenScriptEditor(script)}
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
    return (
      <div
        key={script.id}
        className="asset-list-row"
        onClick={() => onOpenScriptEditor(script)}
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
        className="asset-card shared-card"
        title={isPrefab ? 'Shared prefab — add to timeline' : 'Shared script — copy into this project'}
        draggable
        onDragStart={(e) => handleDragStart(e, isPrefab ? ITEM_KIND_PREFAB : ITEM_KIND_SCRIPT, item.data || item)}
        onMouseMove={(e) => showPreview(e, isPrefab ? 'prefab' : 'script', item.data || item)}
        onMouseLeave={() => setPreview(null)}
        onContextMenu={(e) => openItemMenuSafe(e, 'shared', item)}
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
        className="asset-list-row"
        draggable
        onDragStart={(e) => handleDragStart(e, isPrefab ? ITEM_KIND_PREFAB : ITEM_KIND_SCRIPT, item.data || item)}
        onMouseMove={(e) => showPreview(e, isPrefab ? 'prefab' : 'script', item.data || item)}
        onMouseLeave={() => setPreview(null)}
        onContextMenu={(e) => openItemMenuSafe(e, 'shared', item)}
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
      className="project-panel"
      onContextMenu={openEmptyMenu}
      onClick={(e) => {
        if (ctxMenu && !e.target.closest('.project-context-menu')) closeCtxMenu();
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
      </div>

      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        multiple
        accept="video/*,audio/*"
        onChange={(e) => handleFileUpload(e.target.files)}
      />

      {/* Folder Tree */}
      <div className="project-tree">
        {/* ========== Shared Library (app-wide, outside any project) ========== */}
        <div className="tree-folder-group">
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
        <div className="tree-folder-group">
          <div className="tree-folder-header" onClick={() => toggleFolder('prefabs')}>
            {openFolders.prefabs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {openFolders.prefabs ? <FolderOpen size={13} className="text-cyan" /> : <Folder size={13} className="text-cyan" />}
            <span className="tree-folder-name">prefabs</span>
            <span className="tree-folder-count">{filteredPrefabs.length}</span>
          </div>

          {openFolders.prefabs && (
            <div className="tree-folder-contents">
              {filteredPrefabs.length === 0 && (
                <p className="tree-empty-hint">No prefabs yet. Save a GameObject as a Prefab from the Inspector.</p>
              )}
              {!isGridView && filteredPrefabs.length > 0 && renderListHeader()}
              {filteredPrefabs.map((prefab) => (isGridView ? renderPrefabCard(prefab) : renderPrefabRow(prefab)))}
            </div>
          )}
        </div>

        {/* ========== media/ ========== */}
        <div className="tree-folder-group">
          <div className="tree-folder-header" onClick={() => toggleFolder('media')}>
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

              {/* Subfolders (asset folders like "Recordings" + context-menu folders) */}
              {mediaSubfolderNames.map((folderName) => {
                const isOpen = !!openMediaSubfolders[folderName];
                const assetsInFolder = filteredMedia.filter((m) => m.folder === folderName);
                return (
                  <div key={folderName} className="tree-folder-group nested">
                    <div className="tree-folder-header" onClick={() => toggleMediaSubfolder(folderName)}>
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {isOpen ? <FolderOpen size={13} className="text-amber" /> : <Folder size={13} className="text-amber" />}
                      <span className="tree-folder-name">{folderName}</span>
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

              {/* New folder inline creation */}
              {creatingFolder && (
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
                      else if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); }
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
        <div className="tree-folder-group">
          <div className="tree-folder-header" onClick={() => toggleFolder('scripts')}>
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
              {filteredScripts.length === 0 && (
                <p className="tree-empty-hint">No scripts yet. Use + to create a new script.</p>
              )}
              {!isGridView && filteredScripts.length > 0 && renderListHeader()}
              {filteredScripts.map((script) => (isGridView ? renderScriptCard(script) : renderScriptRow(script)))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right-click context menu ─────────────────────────────────────── */}
      {ctxMenu && (
        <div className="project-context-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onContextMenu={(e) => e.preventDefault()}>
          {ctxMenu.target.kind === 'empty' && (
            <>
              <button className="ctx-menu-item" onClick={() => handleContextAction('new-folder')}>
                <FolderPlus size={12} /> New Folder
              </button>
              <button className="ctx-menu-item" onClick={() => handleContextAction('new-clip')}>
                <Layers size={12} /> New Empty Clip
              </button>
              <button className="ctx-menu-item" onClick={() => handleContextAction('new-script')}>
                <FileCode size={12} /> New Script
              </button>
            </>
          )}
          {ctxMenu.target.kind !== 'empty' && (
            <>
              {ctxMenu.target.kind !== 'shared' && (
                <button className="ctx-menu-item" onClick={() => handleContextAction('rename')}>
                  <Pencil size={12} /> Rename
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

// Prefab breakdown: hierarchy-aware component summary of every snapshot.
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
