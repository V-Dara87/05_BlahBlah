import { memo } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { formatFileSize } from './projectPanelConstants';

export const ExplorerStatusBar = memo(function ExplorerStatusBar({
  itemCount,
  selectedCount,
  selectedSize,
  viewMode,
  onViewModeChange,
}) {
  return (
    <div className="explorer-status-bar">
      <div className="status-bar-info">
        <span className="status-item-count">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
        {selectedCount > 0 && (
          <>
            <span className="status-bar-separator">|</span>
            <span className="status-selection-info">
              {selectedCount} {selectedCount === 1 ? 'item selected' : 'items selected'}
              {selectedSize > 0 && ` (${formatFileSize(selectedSize)})`}
            </span>
          </>
        )}
      </div>

      <div className="status-bar-views">
        <button
          className={`status-view-btn${viewMode === 'grid' ? ' active' : ''}`}
          onClick={() => onViewModeChange('grid')}
          title="Icons / Grid view"
        >
          <LayoutGrid size={12} />
        </button>
        <button
          className={`status-view-btn${viewMode === 'list' ? ' active' : ''}`}
          onClick={() => onViewModeChange('list')}
          title="Details view"
        >
          <List size={12} />
        </button>
      </div>
    </div>
  );
});
