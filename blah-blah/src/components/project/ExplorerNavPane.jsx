import { useState, useCallback, memo } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Laptop,
  Star,
} from 'lucide-react';
import { SECTIONS_CONFIG, isSameLocation } from './projectPanelConstants';

const SECTION_KEYS = ['media', 'prefabs', 'scripts', 'shared'];

export const ExplorerNavPane = memo(function ExplorerNavPane({
  width,
  onWidthChange,
  currentLocation,
  onNavigate,
  treeOpenSections,
  onToggleSectionOpen,
  foldersBySection,
  itemsBySection,
  dragOverKey,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  onOpenFolderMenu,
}) {
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback(
    (e) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.max(130, Math.min(320, startWidth + delta));
        onWidthChange(newWidth);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [width, onWidthChange]
  );

  return (
    <div className="explorer-nav-pane" style={{ width: `${width}px` }}>
      <div className="explorer-tree-scroll">
        {/* Quick Access / Root group */}
        <div className="explorer-tree-group-label">
          <Star size={11} className="text-amber" />
          <span>Quick Access</span>
        </div>

        {/* This Project Root node */}
        <div
          className={`explorer-tree-node root-node${isSameLocation(currentLocation, { section: null, folder: null }) ? ' active' : ''}`}
          onClick={() => onNavigate({ section: null, folder: null })}
        >
          <span className="tree-node-expander spacer" />
          <Laptop size={13} className="tree-node-icon root-icon" />
          <span className="tree-node-name">This Project</span>
        </div>

        <div className="explorer-tree-divider" />

        <div className="explorer-tree-group-label">
          <Folder size={11} className="text-muted" />
          <span>Project Folders</span>
        </div>

        {/* Section nodes */}
        {SECTION_KEYS.map((secKey) => {
          const cfg = SECTIONS_CONFIG[secKey];
          const isSectionActive =
            currentLocation.section === secKey && !currentLocation.folder;
          const isSectionOpen = !!treeOpenSections[secKey];
          const subfolders = foldersBySection[secKey] || [];
          const hasSubfolders = subfolders.length > 0;
          const items = itemsBySection[secKey] || [];
          const dropKey = `${cfg.dropKind}:__root__`;

          return (
            <div key={secKey} className="explorer-tree-section-wrapper">
              <div
                className={`explorer-tree-node section-node${isSectionActive ? ' active' : ''}${dragOverKey === dropKey ? ' drag-over' : ''}`}
                onClick={() => onNavigate({ section: secKey, folder: null })}
                onContextMenu={(e) => onOpenFolderMenu?.(e, secKey, null)}
                onDragOver={(e) => onFolderDragOver?.(e, cfg.dropKind, dropKey)}
                onDragLeave={onFolderDragLeave}
                onDrop={(e) => onFolderDrop?.(e, cfg.dropKind, null, cfg.dropKind)}
              >
                {/* Expander arrow */}
                {hasSubfolders ? (
                  <span
                    className="tree-node-expander"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSectionOpen(secKey);
                    }}
                  >
                    {isSectionOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </span>
                ) : (
                  <span className="tree-node-expander spacer" />
                )}

                {/* Section icon */}
                {isSectionActive ? (
                  <FolderOpen size={13} className={`tree-node-icon ${cfg.colorClass}`} />
                ) : (
                  <Folder size={13} className={`tree-node-icon ${cfg.colorClass}`} />
                )}

                <span className="tree-node-name">{cfg.label}</span>
                <span className="tree-node-count">{items.length}</span>
              </div>

              {/* Subfolders list */}
              {isSectionOpen && hasSubfolders && (
                <div className="explorer-tree-subfolders">
                  {subfolders.map((folderName) => {
                    const isFolderActive =
                      currentLocation.section === secKey &&
                      currentLocation.folder === folderName;
                    const folderItems = items.filter((i) => i.folder === folderName);
                    const subDropKey = `${cfg.dropKind}:${folderName}`;

                    return (
                      <div
                        key={folderName}
                        className={`explorer-tree-node subfolder-node${isFolderActive ? ' active' : ''}${dragOverKey === subDropKey ? ' drag-over' : ''}`}
                        onClick={() =>
                          onNavigate({ section: secKey, folder: folderName })
                        }
                        onContextMenu={(e) => onOpenFolderMenu?.(e, secKey, folderName)}
                        onDragOver={(e) => onFolderDragOver?.(e, cfg.dropKind, subDropKey)}
                        onDragLeave={onFolderDragLeave}
                        onDrop={(e) => onFolderDrop?.(e, cfg.dropKind, folderName, cfg.dropKind)}
                      >
                        <span className="tree-node-expander spacer" />
                        {isFolderActive ? (
                          <FolderOpen size={13} className={`tree-node-icon ${cfg.colorClass}`} />
                        ) : (
                          <Folder size={13} className={`tree-node-icon ${cfg.colorClass}`} />
                        )}
                        <span className="tree-node-name">{folderName}</span>
                        <span className="tree-node-count">{folderItems.length}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Resize handle */}
      <div
        className={`explorer-nav-resizer${isResizing ? ' resizing' : ''}`}
        onMouseDown={startResizing}
      />
    </div>
  );
});
