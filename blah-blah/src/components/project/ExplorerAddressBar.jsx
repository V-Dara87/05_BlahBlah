import { useState, useRef, useEffect, memo } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RotateCw,
  Search,
  X,
  Laptop,
  Folder,
  FolderOpen,
  ChevronRight,
  Copy,
  Check,
} from 'lucide-react';
import { SECTIONS_CONFIG } from './projectPanelConstants';

export const ExplorerAddressBar = memo(function ExplorerAddressBar({
  currentLocation,
  canGoBack,
  canGoForward,
  canGoUp,
  onGoBack,
  onGoForward,
  onGoUp,
  onNavigate,
  onRefresh,
  searchQuery,
  onSearchChange,
  projectName = 'This Project',
}) {
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [textPath, setTextPath] = useState('');
  const [copied, setCopied] = useState(false);
  const pathInputRef = useRef(null);
  const searchInputRef = useRef(null);

  // Compute display crumbs
  const crumbs = [{ label: projectName, location: { section: null, folder: null }, isRoot: true }];

  if (currentLocation.section) {
    const secConfig = SECTIONS_CONFIG[currentLocation.section];
    crumbs.push({
      label: secConfig?.label || currentLocation.section,
      location: { section: currentLocation.section, folder: null },
      colorClass: secConfig?.colorClass,
    });
  }

  if (currentLocation.folder) {
    crumbs.push({
      label: currentLocation.folder,
      location: { section: currentLocation.section, folder: currentLocation.folder },
    });
  }

  const rawPathString = crumbs.map((c) => c.label).join('\\');

  const handleStartEditPath = () => {
    setTextPath(rawPathString);
    setIsEditingPath(true);
  };

  useEffect(() => {
    if (isEditingPath && pathInputRef.current) {
      pathInputRef.current.focus();
      pathInputRef.current.select();
    }
  }, [isEditingPath]);

  const handleCopyPath = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(rawPathString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCommitPath = () => {
    setIsEditingPath(false);
    const trimmed = textPath.trim().replace(/^\\+|\\+$/g, '');
    const parts = trimmed.split(/[\\/]+/).filter(Boolean);
    if (parts.length === 0 || parts.length === 1) {
      onNavigate({ section: null, folder: null });
      return;
    }
    const secCandidate = parts[1]?.toLowerCase();
    const matchedSec = Object.keys(SECTIONS_CONFIG).find(
      (k) => k.toLowerCase() === secCandidate || SECTIONS_CONFIG[k].label.toLowerCase() === secCandidate
    );
    if (matchedSec) {
      const folderPart = parts.slice(2).join('/');
      onNavigate({ section: matchedSec, folder: folderPart || null });
    }
  };

  return (
    <div className="explorer-address-bar">
      {/* Navigation Buttons */}
      <div className="explorer-nav-buttons">
        <button
          className="explorer-nav-btn"
          disabled={!canGoBack}
          onClick={onGoBack}
          title="Back (Alt + Left Arrow)"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          className="explorer-nav-btn"
          disabled={!canGoForward}
          onClick={onGoForward}
          title="Forward (Alt + Right Arrow)"
        >
          <ArrowRight size={14} />
        </button>
        <button
          className="explorer-nav-btn"
          disabled={!canGoUp}
          onClick={onGoUp}
          title="Up to parent folder (Alt + Up Arrow)"
        >
          <ArrowUp size={14} />
        </button>
        <button
          className="explorer-nav-btn"
          onClick={onRefresh}
          title="Refresh"
        >
          <RotateCw size={13} />
        </button>
      </div>

      {/* Address Path Bar */}
      <div className="explorer-address-box" onClick={handleStartEditPath}>
        {isEditingPath ? (
          <input
            ref={pathInputRef}
            type="text"
            className="explorer-address-input"
            value={textPath}
            onChange={(e) => setTextPath(e.target.value)}
            onBlur={handleCommitPath}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCommitPath();
              else if (e.key === 'Escape') setIsEditingPath(false);
            }}
          />
        ) : (
          <div className="explorer-breadcrumbs">
            {crumbs.map((crumb, idx) => {
              const isLast = idx === crumbs.length - 1;
              return (
                <div key={idx} className="explorer-crumb-segment">
                  {idx > 0 && <ChevronRight size={12} className="crumb-separator" />}
                  <button
                    className={`explorer-crumb-btn${isLast ? ' current' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate(crumb.location);
                    }}
                    title={`Navigate to ${crumb.label}`}
                  >
                    {crumb.isRoot ? (
                      <Laptop size={13} className="crumb-icon root-icon" />
                    ) : isLast ? (
                      <FolderOpen size={13} className={`crumb-icon ${crumb.colorClass || 'text-amber'}`} />
                    ) : (
                      <Folder size={13} className={`crumb-icon ${crumb.colorClass || 'text-amber'}`} />
                    )}
                    <span className="crumb-text">{crumb.label}</span>
                  </button>
                </div>
              );
            })}
            <div className="explorer-address-spacer" />
            <button
              className="explorer-copy-path-btn"
              onClick={handleCopyPath}
              title="Copy path to clipboard"
            >
              {copied ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
            </button>
          </div>
        )}
      </div>

      {/* Search Input Box */}
      <div className="explorer-search-box">
        <Search size={12} className="search-icon" />
        <input
          ref={searchInputRef}
          type="text"
          placeholder={`Search ${currentLocation.folder || (currentLocation.section ? SECTIONS_CONFIG[currentLocation.section]?.title : 'Project')}`}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searchQuery && (
          <button
            className="search-clear-btn"
            onClick={() => onSearchChange('')}
            title="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
});
