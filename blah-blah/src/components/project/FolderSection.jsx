import { Folder, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react';
import './folder-section.css';
 
/**
 * One top-level tree section in the Project panel (Shared Library / prefabs
 * / media / scripts). All four sections used to carry their own copy of the
 * open/close header, drag&drop-to-folder wiring, subfolder rendering,
 * inline "new folder" row, and root-items list. That logic was identical
 * across sections except for a handful of labels/colors/hints — this
 * component is the single implementation; ProjectPanel now supplies the
 * per-section differences as props.
 *
 * `sectionKey` is the plural section name used for openFolders / folder
 * bookkeeping (e.g. "prefabs"). `dropKind` is the singular item kind used
 * for drag payloads and moveItemToFolder (e.g. "prefab") — for media/scripts/
 * shared these are the same word, but prefabs is the one exception, so both
 * are passed explicitly rather than derived from one another.
 */
export function FolderSection({
  sectionKey,
  dropKind,
  itemKind,
  label,
  colorClass,
  isOpen,
  onToggleOpen,
  count,
  dragOverKey,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  headerAddon = null,
  emptyHint,
  extraContent = null,
  subfolderNames,
  openSubfolders,
  onToggleSubfolder,
  onOpenFolderMenu,
  folderRenameInput,
  itemsInFolder,
  emptyFolderHint,
  isGridView,
  renderListHeader,
  renderItem,
  rootItems,
  creatingFolder,
  newFolderName,
  setNewFolderName,
  commitNewFolder,
  setCreatingFolder,
}) {
  const rootDropKey = `${dropKind}:__root__`;
  const isEmptySection = rootItems.length === 0 && subfolderNames.length === 0;
 
  return (
    <div className="tree-folder-group" data-section={sectionKey}>
      <div
        className={`tree-folder-header${dragOverKey === rootDropKey ? ' drag-over' : ''}`}
        onClick={onToggleOpen}
        onDragOver={(e) => onFolderDragOver(e, itemKind, rootDropKey)}
        onDragLeave={onFolderDragLeave}
        onDrop={(e) => onFolderDrop(e, dropKind, null, itemKind)}
      >
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {isOpen ? <FolderOpen size={13} className={colorClass} /> : <Folder size={13} className={colorClass} />}
        <span className="tree-folder-name">{label}</span>
        <span className="tree-folder-count">{count}</span>
        {headerAddon}
      </div>
 
      {isOpen && (
        <div className="tree-folder-contents">
          {isEmptySection && <p className="tree-empty-hint">{emptyHint}</p>}
 
          {extraContent}
 
          {subfolderNames.map((folderName) => {
            const isSubOpen = !!openSubfolders[folderName];
            const itemsHere = itemsInFolder(folderName);
            const subDropKey = `${dropKind}:${folderName}`;
            return (
              <div key={folderName} className="tree-folder-group nested">
                <div
                  className={`tree-folder-header${dragOverKey === subDropKey ? ' drag-over' : ''}`}
                  onClick={() => onToggleSubfolder(folderName)}
                  onContextMenu={(e) => onOpenFolderMenu(e, folderName)}
                  onDragOver={(e) => onFolderDragOver(e, itemKind, subDropKey)}
                  onDragLeave={onFolderDragLeave}
                  onDrop={(e) => onFolderDrop(e, dropKind, folderName, itemKind)}
                >
                  {isSubOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {isSubOpen ? <FolderOpen size={13} className={colorClass} /> : <Folder size={13} className={colorClass} />}
                  {folderRenameInput(folderName) || <span className="tree-folder-name">{folderName}</span>}
                  <span className="tree-folder-count">{itemsHere.length}</span>
                </div>
                {isSubOpen && (
                  <div className="tree-folder-contents">
                    {itemsHere.length === 0 && <p className="tree-empty-hint">{emptyFolderHint}</p>}
                    {!isGridView && itemsHere.length > 0 && renderListHeader()}
                    {itemsHere.map(renderItem)}
                  </div>
                )}
              </div>
            );
          })}
 
          {creatingFolder === sectionKey && (
            <div className="tree-folder-group nested new-folder-row">
              <Folder size={13} className={colorClass} />
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
 
          {!isGridView && rootItems.length > 0 && renderListHeader()}
          {rootItems.map(renderItem)}
        </div>
      )}
    </div>
  );
}
 