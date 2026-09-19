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
  Plus,
} from 'lucide-react';
import { isTauri } from '../services/tauriFsAdapter';
import { openProjectInVsCode } from '../services/ideLauncher';
import { ContextMenu } from './shared/ContextMenu';
import { AssetPreviewPopover } from './project/AssetPreviewPopover';
import { useSectionFolders } from './project/useSectionFolders';
import { KIND_REGISTRY } from './project/kindRegistry';
import {
  ROOT_LOCATION,
} from './project/projectPanelConstants';
import { ExplorerAddressBar } from './project/ExplorerAddressBar';
import { ExplorerCommandBar } from './project/ExplorerCommandBar';
import { ExplorerNavPane } from './project/ExplorerNavPane';
import { ExplorerContentView } from './project/ExplorerContentView';
import { ExplorerStatusBar } from './project/ExplorerStatusBar';
import { useExplorerNavigation } from '../hooks/project/useExplorerNavigation';
import { useExplorerSelection } from '../hooks/project/useExplorerSelection';
import { useExplorerFilters } from '../hooks/project/useExplorerFilters';
import { useExplorerFileManager } from '../hooks/project/useExplorerFileManager';
import { useExplorerContextMenu } from '../hooks/project/useExplorerContextMenu';
import { useExplorerKeyboardShortcuts } from '../hooks/project/useExplorerKeyboardShortcuts';
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
  onEnterPrefabMode,
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
 
  // ── Explorer Layout & View State ─────────────────────────────────────────
  const [showNavPane, setShowNavPane] = useState(true);
  const [navPaneWidth, setNavPaneWidth] = useState(165);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
 
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
  const [replaceTarget, setReplaceTarget] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [preview, setPreview] = useState(null);
  const [renaming, setRenaming] = useState(null); // { kind, id, name, section? }
  const [creatingFolder, setCreatingFolder] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
 
  const panelRef = useRef(null);
  const fileInputRef = useRef(null);
  const replaceFileInputRef = useRef(null);
  const importTargetFolderRef = useRef(undefined);
 
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
 
  // ── Navigation, Selection & Filters (hooks) ──────────────────────────────
  const deleteItem = useCallback((kind, item) => {
    KIND_REGISTRY[kind]?.deleteFn(item.id, registryCtx);
  }, [registryCtx]);
 
  const {
    selectedItems,
    setSelectedItems,
    lastClickedKeyRef,
    clearSelection,
    resolveSelectionEntries,
    handleItemClick: handleItemClickBase,
    bulkDeleteSelected,
  } = useExplorerSelection({
    mediaAssets,
    prefabs,
    scripts,
    sharedItems,
    renaming,
    deleteItem,
    closeCtxMenu: () => setCtxMenu(null),
  });
 
  const {
    currentLocation,
    history,
    historyIndex,
    navigateTo,
    goBack,
    goForward,
    goUp,
    renameCurrentFolderIfActive,
  } = useExplorerNavigation({
    rootLocation: ROOT_LOCATION,
    clearSelection,
  });
 
  const {
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    mediaTypeFilter,
    setMediaTypeFilter,
    scriptKindFilter,
    setScriptKindFilter,
    sortList,
    handleSortByColumn,
    filteredShared,
    filteredPrefabs,
    filteredMedia,
    filteredScripts,
    currentSectionItems,
    filteredItemsInView,
    subfolderNamesInView,
  } = useExplorerFilters({
    mediaAssets,
    prefabs,
    scripts,
    sharedItems,
    currentLocation,
    foldersBySection,
  });
 
  const handleItemClick = useCallback(
    (e, kind, item) => handleItemClickBase(e, kind, item, filteredItemsInView),
    [handleItemClickBase, filteredItemsInView]
  );
 
  // Double click handlers
  const handleItemDoubleClick = (kind, item) => {
    if (kind === 'script') {
      onOpenScriptEditor(item);
    } else if (kind === 'media') {
      onAddMediaToTimeline(item);
    } else if (kind === 'prefab') {
      if (onEnterPrefabMode) {
        onEnterPrefabMode(item.id);
      } else {
        onAddPrefabToTimeline(item);
      }
    } else if (kind === 'shared') {
      if (item.type === 'prefab') {
        if (onEnterPrefabMode && item.data?.id) {
          onEnterPrefabMode(item.data.id);
        } else {
          onAddPrefabToTimeline(item.data);
        }
      } else {
        onImportSharedItem(item);
      }
    }
  };
 
  const handleFolderDoubleClick = (section, folderName) => {
    navigateTo({ section, folder: folderName });
  };
 
  // ── Drag & Drop and File Ops (merged hook) ───────────────────────────────
  const {
    dragOverKey,
    handleDragStart,
    moveItemToFolder,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleFolderDrop,
    startRename,
    startFolderRename,
    commitFolderRename,
    commitRename,
    renameInput,
    folderRenameInput,
    commitNewFolder,
    deleteFolder,
    handleFileUpload,
    handleReplaceFile,
    handleCreateNewScript,
  } = useExplorerFileManager({
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
    closeCtxMenu: () => setCtxMenu(null),
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
  });
 
  // ── Context Menu (hook) ──────────────────────────────────────────────────
  const {
    closeCtxMenu,
    openEmptyMenu,
    openItemMenuSafe,
    openFolderMenu,
    handleContextAction,
  } = useExplorerContextMenu({
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
  });
 
  // ── Keyboard Shortcuts (hook) ─────────────────────────────────────────────
  useExplorerKeyboardShortcuts({
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
  });
 
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
    0,
  );
 
  const totalItemsCountInView =
    (currentLocation.section ? filteredItemsInView.length : 4) +
    subfolderNamesInView.length;
 
  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      data-project-current-section={currentLocation.section || ''}
      data-project-current-folder={currentLocation.folder || ''}
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
        onImportMedia={() => {
          importTargetFolderRef.current =
            currentLocation.section === 'media' ? currentLocation.folder : null;
          fileInputRef.current?.click();
        }}
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
          onImportMedia={() => {
            importTargetFolderRef.current =
              currentLocation.section === 'media' ? currentLocation.folder : null;
            fileInputRef.current?.click();
          }}
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
              {(ctxMenu.target.section === 'media' ||
                (!ctxMenu.target.section && currentLocation.section === 'media')) && (
                <button
                  className="ctx-menu-item"
                  onClick={() => handleContextAction('import-media')}
                >
                  <Upload size={13} className="text-indigo" /> Import Media…
                </button>
              )}
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
                {ctxMenu.target.kind === 'prefab' ? (
                  <>
                    <button
                      className="ctx-menu-item"
                      onClick={() => handleContextAction('edit-prefab')}
                    >
                      <Layers size={13} /> Edit in Prefab Mode
                    </button>
                    <button
                      className="ctx-menu-item"
                      onClick={() => handleContextAction('add-to-timeline')}
                    >
                      <Plus size={13} /> Add to Timeline
                    </button>
                  </>
                ) : (
                  <button
                    className="ctx-menu-item"
                    onClick={() => handleContextAction('open')}
                  >
                    <Package size={13} /> Open
                  </button>
                )}
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