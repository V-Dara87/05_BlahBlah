import { useState, useRef, useEffect, memo } from 'react';
import {
  Plus,
  FolderPlus,
  Upload,
  FileCode,
  Layers,
  Code,
  Pencil,
  Trash2,
  Share2,
  ArrowUpDown,
  LayoutGrid,
  List,
  PanelLeft,
  ChevronDown,
  Filter,
} from 'lucide-react';
import { SORT_OPTIONS, MEDIA_SORT_OPTIONS } from './projectPanelConstants';

export const ExplorerCommandBar = memo(function ExplorerCommandBar({
  currentLocation,
  selectedCount,
  canRename,
  canDelete,
  canShare,
  onNewFolder,
  onImportMedia,
  onNewScript,
  onNewClip,
  onOpenVsCode,
  hasVsCode,
  onRename,
  onDelete,
  onShare,
  sortBy,
  onSortChange,
  viewMode,
  onViewModeChange,
  showNavPane,
  onToggleNavPane,
  mediaTypeFilter,
  onMediaTypeFilterChange,
  scriptKindFilter,
  onScriptKindFilterChange,
}) {
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const newMenuRef = useRef(null);
  const sortMenuRef = useRef(null);
  const filterMenuRef = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleDocClick = (e) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target)) {
        setNewMenuOpen(false);
      }
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target)) {
        setSortMenuOpen(false);
      }
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target)) {
        setFilterMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, []);

  const sortOptions = currentLocation.section === 'media' ? MEDIA_SORT_OPTIONS : SORT_OPTIONS;
  const currentSortLabel = sortOptions.find((o) => o.value === sortBy)?.label || 'Sort';

  return (
    <div className="explorer-command-bar">
      {/* Left side: Action Commands */}
      <div className="explorer-command-group">
        {/* + New dropdown */}
        <div className="explorer-dropdown-wrapper" ref={newMenuRef}>
          <button
            className={`explorer-cmd-btn primary${newMenuOpen ? ' active' : ''}`}
            onClick={() => setNewMenuOpen((v) => !v)}
            title="Create new item or folder"
          >
            <Plus size={14} className="cmd-icon-plus" />
            <span className="cmd-label">New</span>
            <ChevronDown size={11} className="cmd-chevron" />
          </button>

          {newMenuOpen && (
            <div className="explorer-menu-dropdown">
              <button
                className="explorer-menu-item"
                onClick={() => {
                  setNewMenuOpen(false);
                  onNewFolder();
                }}
              >
                <FolderPlus size={13} className="text-amber" />
                <span>New Folder</span>
              </button>
              <button
                className="explorer-menu-item"
                onClick={() => {
                  setNewMenuOpen(false);
                  onImportMedia();
                }}
              >
                <Upload size={13} className="text-indigo" />
                <span>Import Media…</span>
              </button>
              <button
                className="explorer-menu-item"
                onClick={() => {
                  setNewMenuOpen(false);
                  onNewScript();
                }}
              >
                <FileCode size={13} className="text-emerald" />
                <span>New Script</span>
              </button>
              <button
                className="explorer-menu-item"
                onClick={() => {
                  setNewMenuOpen(false);
                  onNewClip();
                }}
              >
                <Layers size={13} className="text-cyan" />
                <span>New Empty Clip</span>
              </button>
              {hasVsCode && (
                <>
                  <div className="explorer-menu-divider" />
                  <button
                    className="explorer-menu-item"
                    onClick={() => {
                      setNewMenuOpen(false);
                      onOpenVsCode();
                    }}
                  >
                    <Code size={13} className="text-blue" />
                    <span>Open in VS Code</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="explorer-cmd-divider" />

        {/* Selection actions: Rename, Delete, Share */}
        <button
          className="explorer-cmd-icon-btn"
          disabled={!canRename}
          onClick={onRename}
          title="Rename (F2)"
        >
          <Pencil size={13} />
          <span className="cmd-btn-text">Rename</span>
        </button>

        <button
          className="explorer-cmd-icon-btn danger"
          disabled={!canDelete}
          onClick={onDelete}
          title="Delete (Del)"
        >
          <Trash2 size={13} />
          <span className="cmd-btn-text">
            {selectedCount > 1 ? `Delete (${selectedCount})` : 'Delete'}
          </span>
        </button>

        {canShare && (
          <button
            className="explorer-cmd-icon-btn"
            onClick={onShare}
            title="Save to Shared Library"
          >
            <Share2 size={13} />
            <span className="cmd-btn-text">Share</span>
          </button>
        )}
      </div>

      {/* Right side: View, Sort, Filter, Nav Pane toggle */}
      <div className="explorer-command-group right">
        {/* Filter popover */}
        <div className="explorer-dropdown-wrapper" ref={filterMenuRef}>
          <button
            className={`explorer-cmd-icon-btn${filterMenuOpen ? ' active' : ''}`}
            onClick={() => setFilterMenuOpen((v) => !v)}
            title="Filter by asset type"
          >
            <Filter size={13} />
            <span className="cmd-btn-text">Filter</span>
          </button>

          {filterMenuOpen && (
            <div className="explorer-menu-dropdown filter-dropdown">
              <div className="filter-dropdown-section-title">Media Types</div>
              <label className="filter-checkbox-item">
                <input
                  type="checkbox"
                  checked={mediaTypeFilter.video}
                  onChange={() =>
                    onMediaTypeFilterChange((p) => ({ ...p, video: !p.video }))
                  }
                />
                <span>Videos</span>
              </label>
              <label className="filter-checkbox-item">
                <input
                  type="checkbox"
                  checked={mediaTypeFilter.audio}
                  onChange={() =>
                    onMediaTypeFilterChange((p) => ({ ...p, audio: !p.audio }))
                  }
                />
                <span>Audio</span>
              </label>

              <div className="explorer-menu-divider" />
              <div className="filter-dropdown-section-title">Script Kinds</div>
              <label className="filter-checkbox-item">
                <input
                  type="checkbox"
                  checked={scriptKindFilter.react}
                  onChange={() =>
                    onScriptKindFilterChange((p) => ({ ...p, react: !p.react }))
                  }
                />
                <span>React Component</span>
              </label>
              <label className="filter-checkbox-item">
                <input
                  type="checkbox"
                  checked={scriptKindFilter.canvas}
                  onChange={() =>
                    onScriptKindFilterChange((p) => ({ ...p, canvas: !p.canvas }))
                  }
                />
                <span>Canvas Component</span>
              </label>
              <label className="filter-checkbox-item">
                <input
                  type="checkbox"
                  checked={scriptKindFilter.motion}
                  onChange={() =>
                    onScriptKindFilterChange((p) => ({ ...p, motion: !p.motion }))
                  }
                />
                <span>Motion Script</span>
              </label>
            </div>
          )}
        </div>

        {/* Sort menu */}
        <div className="explorer-dropdown-wrapper" ref={sortMenuRef}>
          <button
            className={`explorer-cmd-icon-btn${sortMenuOpen ? ' active' : ''}`}
            onClick={() => setSortMenuOpen((v) => !v)}
            title="Sort items"
          >
            <ArrowUpDown size={13} />
            <span className="cmd-btn-text">{currentSortLabel}</span>
            <ChevronDown size={10} />
          </button>

          {sortMenuOpen && (
            <div className="explorer-menu-dropdown">
              {sortOptions.map((opt) => (
                <button
                  key={opt.value}
                  className={`explorer-menu-item${sortBy === opt.value ? ' selected' : ''}`}
                  onClick={() => {
                    onSortChange(opt.value);
                    setSortMenuOpen(false);
                  }}
                >
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="explorer-cmd-divider" />

        {/* View toggle (Grid / List) */}
        <div className="explorer-view-toggle">
          <button
            className={`explorer-view-btn${viewMode === 'grid' ? ' active' : ''}`}
            onClick={() => onViewModeChange('grid')}
            title="Icons / Grid view"
          >
            <LayoutGrid size={13} />
          </button>
          <button
            className={`explorer-view-btn${viewMode === 'list' ? ' active' : ''}`}
            onClick={() => onViewModeChange('list')}
            title="Details view"
          >
            <List size={13} />
          </button>
        </div>

        {/* Navigation Pane Toggle */}
        <button
          className={`explorer-cmd-icon-btn${showNavPane ? ' active' : ''}`}
          onClick={onToggleNavPane}
          title={showNavPane ? 'Hide Navigation Pane' : 'Show Navigation Pane'}
        >
          <PanelLeft size={13} />
        </button>
      </div>
    </div>
  );
});
