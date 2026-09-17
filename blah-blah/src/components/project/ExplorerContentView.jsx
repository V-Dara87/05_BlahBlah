import { memo } from 'react';
import {
  Folder,
  FolderOpen,
  Film,
  Music,
  Package,
  FileCode,
  Share2,
  Plus,
  ArrowUp,
  ArrowDown,
  Upload,
} from 'lucide-react';
import {
  formatTimecode,
} from '../../utils/timeFormat';
import {
  SECTIONS_CONFIG,
  shortDuration,
  formatFileSize,
  formatDate,
  scriptKindMeta,
  selKey,
} from './projectPanelConstants';
import { detectScriptKind } from '../../engine/scriptRunner';
import {
  ITEM_KIND_MEDIA,
  ITEM_KIND_PREFAB,
  ITEM_KIND_SCRIPT,
  ITEM_KIND_SHARED,
} from '../../utils/dragData';

const SECTION_KEYS = ['media', 'prefabs', 'scripts', 'shared'];

export const ExplorerContentView = memo(function ExplorerContentView({
  currentLocation,
  onNavigate,
  viewMode,
  sortBy,
  onSortByColumn,
  itemsBySection,
  foldersBySection,
  subfolderNames,
  filteredItems,
  selectedItems,
  onItemClick,
  onItemDoubleClick,
  onFolderDoubleClick,
  renameInput,
  folderRenameInput,
  creatingFolder,
  newFolderName,
  setNewFolderName,
  commitNewFolder,
  setCreatingFolder,
  dragOverKey,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  onItemContextMenu,
  onFolderContextMenu,
  onEmptyContextMenu,
  onDragStart,
  showPreview,
  setPreview,
  onAddMediaToTimeline,
  onAddPrefabToTimeline,
  onImportSharedItem,
  onSharePrefab,
  onShareScript,
  onImportMedia,
  onNewScript,
}) {
  const isGridView = viewMode === 'grid';
  const isRoot = currentLocation.section === null;

  // Render sorting arrow on column header
  const renderSortArrow = (columnKey) => {
    if (sortBy === `${columnKey}-asc`) {
      return <ArrowUp size={11} className="sort-column-arrow" />;
    }
    if (sortBy === `${columnKey}-desc`) {
      return <ArrowDown size={11} className="sort-column-arrow" />;
    }
    return null;
  };

  // ── Render Root View (This Project) ──────────────────────────────────────
  if (isRoot) {
    return (
      <div
        className={`explorer-content-view is-root${isGridView ? ' grid-mode' : ' list-mode'}`}
        onContextMenu={(e) => onEmptyContextMenu(e, null)}
      >
        {!isGridView && (
          <div className="explorer-details-header">
            <div
              className="details-col col-name"
              onClick={() => onSortByColumn('name')}
            >
              <span>Name</span>
              {renderSortArrow('name')}
            </div>
            <div className="details-col col-type">
              <span>Type</span>
            </div>
            <div className="details-col col-size">
              <span>Items</span>
            </div>
          </div>
        )}

        <div className={isGridView ? 'explorer-grid-container' : 'explorer-list-container'}>
          {SECTION_KEYS.map((secKey) => {
            const cfg = SECTIONS_CONFIG[secKey];
            const items = itemsBySection[secKey] || [];
            const subfolders = foldersBySection[secKey] || [];
            const dropKey = `${cfg.dropKind}:__root__`;
            const totalCount = items.length;

            if (isGridView) {
              return (
                <div
                  key={secKey}
                  data-project-section={secKey}
                  className={`explorer-folder-card${dragOverKey === dropKey ? ' drag-over' : ''}`}
                  onClick={() => {}}
                  onDoubleClick={() => onNavigate({ section: secKey, folder: null })}
                  onContextMenu={(e) => onFolderContextMenu(e, secKey, null)}
                  onDragOver={(e) => onFolderDragOver(e, cfg.dropKind, dropKey)}
                  onDragLeave={onFolderDragLeave}
                  onDrop={(e) => onFolderDrop(e, cfg.dropKind, null, cfg.dropKind)}
                  title={`Double-click to open ${cfg.label}`}
                >
                  <div className="folder-card-icon-wrapper">
                    <Folder size={44} className={`folder-card-icon ${cfg.colorClass}`} />
                  </div>
                  <div className="folder-card-info">
                    <span className="folder-card-name">{cfg.label}</span>
                    <span className="folder-card-sub">
                      {totalCount} {totalCount === 1 ? 'item' : 'items'}
                      {subfolders.length > 0 && ` · ${subfolders.length} folders`}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={secKey}
                data-project-section={secKey}
                className={`explorer-details-row folder-row${dragOverKey === dropKey ? ' drag-over' : ''}`}
                onDoubleClick={() => onNavigate({ section: secKey, folder: null })}
                onContextMenu={(e) => onFolderContextMenu(e, secKey, null)}
                onDragOver={(e) => onFolderDragOver(e, cfg.dropKind, dropKey)}
                onDragLeave={onFolderDragLeave}
                onDrop={(e) => onFolderDrop(e, cfg.dropKind, null, cfg.dropKind)}
                title={`Double-click to open ${cfg.label}`}
              >
                <div className="details-col col-name">
                  <Folder size={15} className={`details-row-icon ${cfg.colorClass}`} />
                  <span className="details-row-name-text">{cfg.label}</span>
                </div>
                <div className="details-col col-type">System Folder</div>
                <div className="details-col col-size">{totalCount} items</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Render Section / Subfolder View ──────────────────────────────────────
  const sectionKey = currentLocation.section;
  const currentFolder = currentLocation.folder;
  const cfg = SECTIONS_CONFIG[sectionKey] || SECTIONS_CONFIG.media;
  const itemKind = cfg.dropKind;

  const hasSubfolders = !currentFolder && subfolderNames.length > 0;
  const isEmpty = filteredItems.length === 0 && (!hasSubfolders && !creatingFolder);

  return (
    <div
      data-project-section={sectionKey}
      data-project-current-folder={currentFolder || ''}
      className={`explorer-content-view${isGridView ? ' grid-mode' : ' list-mode'}`}
      onContextMenu={(e) => onEmptyContextMenu(e, sectionKey, currentFolder)}
    >
      {/* Details View Table Header */}
      {!isGridView && (
        <div className="explorer-details-header">
          <div
            className="details-col col-name"
            onClick={() => onSortByColumn('name')}
            title="Sort by Name"
          >
            <span>Name</span>
            {renderSortArrow('name')}
          </div>
          <div
            className="details-col col-date"
            onClick={() => onSortByColumn('date')}
            title="Sort by Date modified"
          >
            <span>Date modified</span>
            {renderSortArrow('date')}
          </div>
          <div className="details-col col-type">
            <span>Type</span>
          </div>
          <div
            className="details-col col-size"
            onClick={() => onSortByColumn(sectionKey === 'media' ? 'duration' : 'name')}
            title="Sort by Size / Duration"
          >
            <span>Size / Duration</span>
            {renderSortArrow('duration') || renderSortArrow('size')}
          </div>
        </div>
      )}

      {isEmpty ? (
        <div className="explorer-empty-state">
          <FolderOpen size={42} className="empty-icon text-muted" />
          <p className="empty-title">This folder is empty.</p>
          <p className="empty-subtitle">
            {currentFolder ? cfg.subfolderEmptyHint : cfg.emptyHint}
          </p>
          <div className="empty-actions">
            {sectionKey === 'media' && (
              <button className="empty-action-btn" onClick={onImportMedia}>
                <Upload size={13} />
                <span>Import Media</span>
              </button>
            )}
            {sectionKey === 'scripts' && (
              <button className="empty-action-btn" onClick={onNewScript}>
                <FileCode size={13} />
                <span>New Script</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className={isGridView ? 'explorer-grid-container' : 'explorer-list-container'}>
          {/* Subfolders displayed first (only when at section root) */}
          {hasSubfolders &&
            subfolderNames.map((folderName) => {
              const itemsInThisFolder = (itemsBySection[sectionKey] || []).filter(
                (i) => i.folder === folderName
              );
              const subDropKey = `${itemKind}:${folderName}`;

              if (isGridView) {
                return (
                  <div
                    key={folderName}
                    data-project-section={sectionKey}
                    data-project-folder={folderName}
                    className={`explorer-folder-card subfolder${dragOverKey === subDropKey ? ' drag-over' : ''}`}
                    onDoubleClick={() => onFolderDoubleClick(sectionKey, folderName)}
                    onContextMenu={(e) => onFolderContextMenu(e, sectionKey, folderName)}
                    onDragOver={(e) => onFolderDragOver(e, itemKind, subDropKey)}
                    onDragLeave={onFolderDragLeave}
                    onDrop={(e) => onFolderDrop(e, sectionKey, folderName, itemKind)}
                    title={`Double-click to open ${folderName}`}
                  >
                    <div className="folder-card-icon-wrapper">
                      <Folder size={42} className={`folder-card-icon ${cfg.colorClass}`} />
                    </div>
                    <div className="folder-card-info">
                      {folderRenameInput(sectionKey, folderName) || (
                        <span className="folder-card-name">{folderName}</span>
                      )}
                      <span className="folder-card-sub">
                        {itemsInThisFolder.length}{' '}
                        {itemsInThisFolder.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={folderName}
                  data-project-section={sectionKey}
                  data-project-folder={folderName}
                  className={`explorer-details-row folder-row${dragOverKey === subDropKey ? ' drag-over' : ''}`}
                  onDoubleClick={() => onFolderDoubleClick(sectionKey, folderName)}
                  onContextMenu={(e) => onFolderContextMenu(e, sectionKey, folderName)}
                  onDragOver={(e) => onFolderDragOver(e, itemKind, subDropKey)}
                  onDragLeave={onFolderDragLeave}
                  onDrop={(e) => onFolderDrop(e, sectionKey, folderName, itemKind)}
                  title={`Double-click to open ${folderName}`}
                >
                  <div className="details-col col-name">
                    <Folder size={15} className={`details-row-icon ${cfg.colorClass}`} />
                    {folderRenameInput(sectionKey, folderName) || (
                      <span className="details-row-name-text">{folderName}</span>
                    )}
                  </div>
                  <div className="details-col col-date">—</div>
                  <div className="details-col col-type">File folder</div>
                  <div className="details-col col-size">
                    {itemsInThisFolder.length} items
                  </div>
                </div>
              );
            })}

          {/* Inline Folder Creation Row */}
          {creatingFolder === sectionKey && (
            <div
              className={
                isGridView
                  ? 'explorer-folder-card new-folder-card'
                  : 'explorer-details-row new-folder-row'
              }
            >
              {isGridView ? (
                <>
                  <div className="folder-card-icon-wrapper">
                    <Folder size={42} className={`folder-card-icon ${cfg.colorClass}`} />
                  </div>
                  <div className="folder-card-info">
                    <input
                      type="text"
                      className="asset-rename-input"
                      placeholder="Folder name"
                      value={newFolderName}
                      autoFocus
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitNewFolder();
                        else if (e.key === 'Escape') {
                          setCreatingFolder(null);
                          setNewFolderName('');
                        }
                      }}
                      onBlur={commitNewFolder}
                    />
                  </div>
                </>
              ) : (
                <div className="details-col col-name">
                  <Folder size={15} className={`details-row-icon ${cfg.colorClass}`} />
                  <input
                    type="text"
                    className="asset-rename-input"
                    placeholder="Folder name"
                    value={newFolderName}
                    autoFocus
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitNewFolder();
                      else if (e.key === 'Escape') {
                        setCreatingFolder(null);
                        setNewFolderName('');
                      }
                    }}
                    onBlur={commitNewFolder}
                  />
                </div>
              )}
            </div>
          )}

          {/* Asset Items */}
          {filteredItems.map((item) => {
            const isSelected = selectedItems.has(selKey(itemKind, item.id));

            // Item-kind specifics
            let iconElement;
            let typeLabel = itemKind;
            let metaString = '';
            let dateString = formatDate(item.createdAt || item.updatedAt);
            let sizeString = '';

            if (itemKind === 'media') {
              const isVideo = item.type === 'video';
              iconElement = isVideo ? (
                <Film size={isGridView ? 28 : 15} className="text-indigo" />
              ) : (
                <Music size={isGridView ? 28 : 15} className="text-emerald" />
              );
              typeLabel = isVideo ? 'Video' : 'Audio';
              metaString = shortDuration(item.duration);
              sizeString = item.size ? formatFileSize(item.size) : metaString;
            } else if (itemKind === 'prefab') {
              iconElement = (
                <Package size={isGridView ? 28 : 15} className="text-cyan" />
              );
              typeLabel = 'Prefab';
              const entityCount = Array.isArray(item.entities)
                ? item.entities.length
                : 1;
              metaString = `${entityCount} obj`;
              sizeString = metaString;
            } else if (itemKind === 'script') {
              const kind = detectScriptKind(item.code || '');
              const Meta = scriptKindMeta(kind);
              iconElement = (
                <Meta.icon size={isGridView ? 28 : 15} className={Meta.className} />
              );
              typeLabel = Meta.label;
              metaString = 'jsx';
              sizeString = 'JSX File';
            } else if (itemKind === 'shared') {
              const isPrefab = item.type === 'prefab';
              iconElement = isPrefab ? (
                <Package size={isGridView ? 28 : 15} className="text-violet" />
              ) : (
                <FileCode size={isGridView ? 28 : 15} className="text-emerald" />
              );
              typeLabel = isPrefab ? 'Shared Prefab' : 'Shared Script';
              metaString = isPrefab ? 'prefab' : 'jsx';
              sizeString = 'Shared';
            }

            // Drag item kind payload
            const dragPayloadKind =
              itemKind === 'media'
                ? ITEM_KIND_MEDIA
                : itemKind === 'prefab'
                ? ITEM_KIND_PREFAB
                : itemKind === 'script'
                ? ITEM_KIND_SCRIPT
                : ITEM_KIND_SHARED;

            // ── Grid View Asset Card ──
            if (isGridView) {
              return (
                <div
                  key={item.id}
                  className={`asset-card ${itemKind}-card${isSelected ? ' selected' : ''}`}
                  draggable
                  onDragStart={(e) => onDragStart(e, dragPayloadKind, item)}
                  onMouseMove={(e) =>
                    showPreview(
                      e,
                      itemKind === 'shared' ? item.type : itemKind,
                      item.data || item
                    )
                  }
                  onMouseLeave={() => setPreview(null)}
                  onContextMenu={(e) => onItemContextMenu(e, itemKind, item)}
                  onClick={(e) => {
                    if (e.target.closest('button')) return;
                    onItemClick(e, itemKind, item);
                    showPreview(
                      e,
                      itemKind === 'shared' ? item.type : itemKind,
                      item.data || item
                    );
                  }}
                  onDoubleClick={() => onItemDoubleClick(itemKind, item)}
                >
                  <div className="asset-icon-box">
                    {iconElement}
                    {item.duration != null && (
                      <span className="duration-tag">
                        {formatTimecode(item.duration).slice(3)}
                      </span>
                    )}
                  </div>
                  <div className="asset-info-box">
                    {renameInput(itemKind, item) || (
                      <span className="asset-title-main" title={item.name}>
                        {item.name}
                      </span>
                    )}
                    <span className="asset-subtitle">{typeLabel}</span>
                  </div>
                  <div className="asset-card-btns">
                    {itemKind === 'media' && (
                      <button
                        className="card-action-btn add-btn"
                        title="Add to timeline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddMediaToTimeline(item);
                        }}
                      >
                        <Plus size={13} />
                      </button>
                    )}
                    {itemKind === 'prefab' && (
                      <button
                        className="card-action-btn add-btn"
                        title="Add to timeline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddPrefabToTimeline(item);
                        }}
                      >
                        <Plus size={13} />
                      </button>
                    )}
                    {itemKind === 'shared' && (
                      <button
                        className="card-action-btn add-btn"
                        title={
                          item.type === 'prefab'
                            ? 'Add to timeline'
                            : 'Copy to project'
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (item.type === 'prefab') {
                            onAddPrefabToTimeline(item.data);
                          } else {
                            onImportSharedItem(item);
                          }
                        }}
                      >
                        <Plus size={13} />
                      </button>
                    )}
                    {(itemKind === 'prefab' || itemKind === 'script') && (
                      <button
                        className="card-action-btn share-btn"
                        title="Save to Shared Library"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (itemKind === 'prefab') onSharePrefab(item);
                          else onShareScript(item);
                        }}
                      >
                        <Share2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            }

            // ── Details View Asset Row ──
            return (
              <div
                key={item.id}
                className={`explorer-details-row item-row${isSelected ? ' selected' : ''}`}
                draggable
                onDragStart={(e) => onDragStart(e, dragPayloadKind, item)}
                onMouseMove={(e) =>
                  showPreview(
                    e,
                    itemKind === 'shared' ? item.type : itemKind,
                    item.data || item
                  )
                }
                onMouseLeave={() => setPreview(null)}
                onContextMenu={(e) => onItemContextMenu(e, itemKind, item)}
                onClick={(e) => {
                  if (e.target.closest('button')) return;
                  onItemClick(e, itemKind, item);
                  showPreview(
                    e,
                    itemKind === 'shared' ? item.type : itemKind,
                    item.data || item
                  );
                }}
                onDoubleClick={() => onItemDoubleClick(itemKind, item)}
              >
                <div className="details-col col-name">
                  <span className="details-row-icon">{iconElement}</span>
                  {renameInput(itemKind, item) || (
                    <span className="details-row-name-text" title={item.name}>
                      {item.name}
                    </span>
                  )}
                </div>
                <div className="details-col col-date">{dateString}</div>
                <div className="details-col col-type">{typeLabel}</div>
                <div className="details-col col-size">{sizeString}</div>

                <div className="details-row-actions">
                  {itemKind === 'media' && (
                    <button
                      className="card-action-btn add-btn"
                      title="Add to timeline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddMediaToTimeline(item);
                      }}
                    >
                      <Plus size={12} />
                    </button>
                  )}
                  {itemKind === 'prefab' && (
                    <button
                      className="card-action-btn add-btn"
                      title="Add to timeline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddPrefabToTimeline(item);
                      }}
                    >
                      <Plus size={12} />
                    </button>
                  )}
                  {itemKind === 'shared' && (
                    <button
                      className="card-action-btn add-btn"
                      title={
                        item.type === 'prefab'
                          ? 'Add to timeline'
                          : 'Copy to project'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.type === 'prefab') {
                          onAddPrefabToTimeline(item.data);
                        } else {
                          onImportSharedItem(item);
                        }
                      }}
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
