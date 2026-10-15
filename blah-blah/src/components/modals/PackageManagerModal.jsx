import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Package,
  X,
  Download,
  Trash2,
  Plus,
  CheckCircle,
  AlertCircle,
  Copy,
  Check,
  FolderOpen,
  HardDrive,
  Search,
  Zap,
  Sparkles,
  Code,
  Mic,
  Wrench,
  Star,
  FileText,
  XCircle,
  FolderPlus,
  Layers,
} from 'lucide-react';
import {
  loadManifest,
  getInstalledPackagesRegistry,
  downloadPackage,
  cancelDownload,
  deletePackage,
  addCustomPackage,
  removeCustomPackage,
  getPackagePath,
  openModelsDirectory,
  revealPackageInExplorer,
  importLocalModelFile,
  installPresetToProject,
  getTotalInstalledSize,
} from '../../services/packageManager.js';
import { isTauri } from '../../services/tauriFsAdapter.js';
import './package-manager-modal.css';

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function PackageManagerModal({
  isOpen,
  onClose,
  initialCategory = 'all',
  onCreateScript,
  onOpenScriptEditor,
}) {
  const [packages, setPackages] = useState([]);
  const [registry, setRegistry] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'installed' | 'available'
  const [sortBy, setSortBy] = useState('recommended'); // 'recommended' | 'name' | 'size-asc' | 'size-desc'
  const [searchQuery, setSearchQuery] = useState('');
  const [installedPaths, setInstalledPaths] = useState({});
  const [totalStorageBytes, setTotalStorageBytes] = useState(0);

  // Download state: { [pkgId]: { bytesDownloaded, totalBytes, percent } }
  const [downloadProgress, setDownloadProgress] = useState({});
  const [isDownloading, setIsDownloading] = useState({});
  const [errorMap, setErrorMap] = useState({});
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedSha, setCopiedSha] = useState(false);
  const [addedToProjectMap, setAddedToProjectMap] = useState({});

  // Custom modal/form: null | 'url' | 'local'
  const [customMode, setCustomMode] = useState(null);
  const [customForm, setCustomForm] = useState({
    displayName: '',
    url: '',
    filePath: '',
    category: 'custom-model',
    tags: 'custom',
    description: '',
  });

  const isDesktop = useMemo(() => isTauri(), []);

  const refreshData = useCallback(async () => {
    try {
      const [allPkgs, reg, totalSize] = await Promise.all([
        loadManifest(),
        getInstalledPackagesRegistry(),
        getTotalInstalledSize(),
      ]);
      setPackages(allPkgs);
      setRegistry(reg);
      setTotalStorageBytes(totalSize);

      // Resolve paths for installed packages
      const paths = {};
      for (const p of allPkgs) {
        if (reg[p.id]) {
          paths[p.id] = await getPackagePath(p.id);
        }
      }
      setInstalledPaths(paths);

      // Default selection
      if (!selectedId && allPkgs.length > 0) {
        setSelectedId(allPkgs[0].id);
      }
    } catch (err) {
      console.error('[PackageManagerModal] Failed to refresh data:', err);
    }
  }, [selectedId]);

  useEffect(() => {
    if (isOpen) {
      if (initialCategory && initialCategory !== 'all') {
        if (initialCategory.startsWith('whisper')) {
          setActiveCategory('whisper');
        } else {
          setActiveCategory(initialCategory);
        }
      }
      refreshData();
    }
  }, [isOpen, initialCategory, refreshData]);

  // Keyboard escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts = { all: packages.length, whisper: 0, preset: 0, library: 0, custom: 0 };
    for (const p of packages) {
      if (p.category?.startsWith('whisper-model')) counts.whisper++;
      else if (p.category === 'component-pack') counts.preset++;
      else if (p.category === 'script-library') counts.library++;
      else if (p.category === 'custom-model' || p.isCustom) counts.custom++;
    }
    return counts;
  }, [packages]);

  // Filtered & Sorted packages
  const filteredPackages = useMemo(() => {
    let list = packages.filter((pkg) => {
      // Category filter
      if (activeCategory === 'whisper') {
        if (!pkg.category?.startsWith('whisper-model')) return false;
      } else if (activeCategory === 'preset') {
        if (pkg.category !== 'component-pack') return false;
      } else if (activeCategory === 'library') {
        if (pkg.category !== 'script-library') return false;
      } else if (activeCategory === 'custom') {
        if (pkg.category !== 'custom-model' && !pkg.isCustom) return false;
      }

      // Status filter
      const isInstalled = Boolean(registry[pkg.id]);
      if (statusFilter === 'installed' && !isInstalled) return false;
      if (statusFilter === 'available' && isInstalled) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = pkg.displayName.toLowerCase().includes(q);
        const matchesDesc = (pkg.description || '').toLowerCase().includes(q);
        const matchesTags = (pkg.tags || []).some((t) => t.toLowerCase().includes(q));
        const matchesCategory = (pkg.category || '').toLowerCase().includes(q);
        if (!matchesName && !matchesDesc && !matchesTags && !matchesCategory) return false;
      }

      return true;
    });

    // Sorting
    list.sort((a, b) => {
      if (sortBy === 'recommended') {
        if (a.recommended && !b.recommended) return -1;
        if (!a.recommended && b.recommended) return 1;
        return a.displayName.localeCompare(b.displayName);
      }
      if (sortBy === 'name') {
        return a.displayName.localeCompare(b.displayName);
      }
      if (sortBy === 'size-asc') {
        return (a.sizeBytes || 0) - (b.sizeBytes || 0);
      }
      if (sortBy === 'size-desc') {
        return (b.sizeBytes || 0) - (a.sizeBytes || 0);
      }
      return 0;
    });

    return list;
  }, [packages, activeCategory, statusFilter, searchQuery, sortBy, registry]);

  const selectedPackage = useMemo(() => {
    return packages.find((p) => p.id === selectedId) || filteredPackages[0] || null;
  }, [packages, selectedId, filteredPackages]);

  // Start Download
  const handleDownload = async (pkgId) => {
    setErrorMap((prev) => ({ ...prev, [pkgId]: null }));
    setIsDownloading((prev) => ({ ...prev, [pkgId]: true }));
    setDownloadProgress((prev) => ({
      ...prev,
      [pkgId]: { bytesDownloaded: 0, percent: 0 },
    }));

    try {
      await downloadPackage(pkgId, {
        onProgress: (p) => {
          setDownloadProgress((prev) => ({
            ...prev,
            [pkgId]: p,
          }));
        },
      });
      await refreshData();
    } catch (err) {
      if (err.message?.includes('cancelled')) {
        console.log(`Download for ${pkgId} was cancelled.`);
      } else {
        console.error(`Download failed for ${pkgId}:`, err);
        setErrorMap((prev) => ({
          ...prev,
          [pkgId]: err.message || 'Download failed',
        }));
      }
    } finally {
      setIsDownloading((prev) => ({ ...prev, [pkgId]: false }));
    }
  };

  // Cancel Download
  const handleCancelDownload = async (pkgId) => {
    try {
      await cancelDownload(pkgId);
      setIsDownloading((prev) => ({ ...prev, [pkgId]: false }));
      setDownloadProgress((prev) => ({ ...prev, [pkgId]: null }));
      setErrorMap((prev) => ({ ...prev, [pkgId]: 'Download cancelled by user.' }));
    } catch (err) {
      console.warn('Failed to cancel download:', err);
    }
  };

  // Delete Package
  const handleDelete = async (pkgId) => {
    if (!confirm('Are you sure you want to uninstall this package and free up disk space?')) return;
    try {
      await deletePackage(pkgId);
      await refreshData();
    } catch (err) {
      alert(`Failed to delete package: ${err.message}`);
    }
  };

  // Reveal Package in OS Explorer
  const handleRevealInExplorer = async (pkgId) => {
    try {
      await revealPackageInExplorer(pkgId);
    } catch (err) {
      console.warn('Failed to reveal file:', err);
    }
  };

  // Open Models Directory
  const handleOpenFolder = async () => {
    try {
      await openModelsDirectory();
    } catch (err) {
      console.warn('Failed to open models folder:', err);
    }
  };

  // Copy code snippet
  const handleCopyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (err) {
      console.warn('Failed to copy code:', err);
    }
  };

  // Copy SHA-256
  const handleCopySha = async (sha) => {
    try {
      await navigator.clipboard.writeText(sha);
      setCopiedSha(true);
      setTimeout(() => setCopiedSha(false), 2000);
    } catch (err) {
      console.warn('Failed to copy SHA:', err);
    }
  };

  // Add Preset to current project
  const handleAddToProject = async (pkg) => {
    try {
      if (typeof onCreateScript === 'function') {
        const cleanName = (pkg.componentName || `${pkg.displayName.replace(/\s+/g, '')}.jsx`).replace(/\.jsx$/, '');
        await onCreateScript({
          id: `script-${cleanName}-${Date.now()}`,
          name: cleanName,
          code: pkg.sampleCode,
          type: 'canvas',
        });
        setAddedToProjectMap((prev) => ({ ...prev, [pkg.id]: true }));
        setTimeout(() => {
          setAddedToProjectMap((prev) => ({ ...prev, [pkg.id]: false }));
        }, 3000);
      }
    } catch (err) {
      alert(`Failed to add preset to project: ${err.message}`);
    }
  };

  // Browse local .bin file in desktop mode
  const handleBrowseLocalFile = async () => {
    if (!isDesktop) return;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'GGML Model Files (*.bin)', extensions: ['bin'] }],
      });
      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[/\\]/).pop() || '';
        setCustomForm((prev) => ({
          ...prev,
          filePath: selected,
          displayName: prev.displayName || fileName.replace(/\.bin$/i, ''),
        }));
      }
    } catch (err) {
      console.warn('Failed to open file picker:', err);
    }
  };

  // Submit custom package
  const handleSaveCustom = async (e) => {
    e.preventDefault();
    if (customMode === 'local') {
      if (!customForm.filePath) {
        alert('Please select or specify a local .bin file path.');
        return;
      }
      try {
        const imported = await importLocalModelFile({
          filePath: customForm.filePath,
          displayName: customForm.displayName,
          category: customForm.category,
          tags: customForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
          description: customForm.description,
        });
        setCustomMode(null);
        await refreshData();
        setSelectedId(imported.id);
      } catch (err) {
        alert(`Failed to import local model: ${err.message}`);
      }
    } else {
      if (!customForm.displayName || !customForm.url) return;
      try {
        const created = await addCustomPackage({
          displayName: customForm.displayName,
          url: customForm.url,
          category: customForm.category,
          tags: customForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
          description: customForm.description,
        });
        setCustomMode(null);
        await refreshData();
        setSelectedId(created.id);
      } catch (err) {
        alert(`Failed to add custom package: ${err.message}`);
      }
    }
  };

  // Helper for category icon
  const getCategoryIcon = (category, size = 15) => {
    if (category?.startsWith('whisper-model')) return <Mic size={size} />;
    if (category === 'component-pack') return <Sparkles size={size} />;
    if (category === 'script-library') return <Code size={size} />;
    return <Wrench size={size} />;
  };

  const getCategoryClass = (category) => {
    if (category?.startsWith('whisper-model')) return 'whisper';
    if (category === 'component-pack') return 'preset';
    if (category === 'script-library') return 'library';
    return 'custom';
  };

  if (!isOpen) return null;

  return (
    <div className="pkg-modal-backdrop" onClick={onClose}>
      <div className="pkg-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pkg-modal-header">
          <div className="pkg-header-left">
            <div className="pkg-modal-icon-badge">
              <Package size={17} />
            </div>
            <div className="pkg-modal-titles">
              <span className="pkg-modal-title">Package Manager</span>
              <span className="pkg-modal-subtitle">
                AI Speech Models, Motion Presets & Script Libraries
              </span>
            </div>
          </div>

          <div className="pkg-header-right">
            {isDesktop && (
              <>
                <div className="pkg-storage-pill" title="Total storage consumed by installed packages">
                  <HardDrive size={13} style={{ color: '#38bdf8' }} />
                  <span>{formatBytes(totalStorageBytes)} installed</span>
                </div>
                <button
                  className="unity-btn unity-btn-secondary btn-xs"
                  onClick={handleOpenFolder}
                  title="Open models storage folder in File Explorer"
                >
                  <FolderOpen size={13} />
                  <span>Models Folder</span>
                </button>
              </>
            )}
            <button className="pkg-modal-close-btn" onClick={onClose} title="Close (Esc)">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="pkg-modal-body">
          {/* Left Column: Navigation & Items */}
          <div className="pkg-sidebar">
            <div className="pkg-sidebar-top">
              <div className="pkg-search-wrapper">
                <Search size={13} className="pkg-search-icon" />
                <input
                  type="text"
                  className="pkg-search-input"
                  placeholder="Filter packages..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button className="pkg-search-clear" onClick={() => setSearchQuery('')}>
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* Vertical Category Navigation */}
            <div className="pkg-categories-nav">
              <button
                className={`pkg-nav-btn ${activeCategory === 'all' ? 'active' : ''}`}
                onClick={() => { setActiveCategory('all'); setCustomMode(null); }}
              >
                <div className="pkg-nav-btn-content">
                  <Layers size={13} />
                  <span>All Packages</span>
                </div>
                <span className="pkg-nav-count">{categoryCounts.all}</span>
              </button>
              <button
                className={`pkg-nav-btn ${activeCategory === 'whisper' ? 'active' : ''}`}
                onClick={() => { setActiveCategory('whisper'); setCustomMode(null); }}
              >
                <div className="pkg-nav-btn-content">
                  <Mic size={13} />
                  <span>Whisper Models</span>
                </div>
                <span className="pkg-nav-count">{categoryCounts.whisper}</span>
              </button>
              <button
                className={`pkg-nav-btn ${activeCategory === 'preset' ? 'active' : ''}`}
                onClick={() => { setActiveCategory('preset'); setCustomMode(null); }}
              >
                <div className="pkg-nav-btn-content">
                  <Sparkles size={13} />
                  <span>Component Presets</span>
                </div>
                <span className="pkg-nav-count">{categoryCounts.preset}</span>
              </button>
              <button
                className={`pkg-nav-btn ${activeCategory === 'library' ? 'active' : ''}`}
                onClick={() => { setActiveCategory('library'); setCustomMode(null); }}
              >
                <div className="pkg-nav-btn-content">
                  <Code size={13} />
                  <span>Script Libraries</span>
                </div>
                <span className="pkg-nav-count">{categoryCounts.library}</span>
              </button>
              <button
                className={`pkg-nav-btn ${activeCategory === 'custom' ? 'active' : ''}`}
                onClick={() => { setActiveCategory('custom'); setCustomMode(null); }}
              >
                <div className="pkg-nav-btn-content">
                  <Wrench size={13} />
                  <span>Custom & Local</span>
                </div>
                <span className="pkg-nav-count">{categoryCounts.custom}</span>
              </button>
            </div>

            {/* Status Chips & Sort Controls */}
            <div className="pkg-controls-row">
              <div className="pkg-status-filters">
                <button
                  className={`pkg-filter-pill ${statusFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setStatusFilter('all')}
                >
                  All
                </button>
                <button
                  className={`pkg-filter-pill ${statusFilter === 'installed' ? 'active' : ''}`}
                  onClick={() => setStatusFilter('installed')}
                >
                  Installed
                </button>
                <button
                  className={`pkg-filter-pill ${statusFilter === 'available' ? 'active' : ''}`}
                  onClick={() => setStatusFilter('available')}
                >
                  Available
                </button>
              </div>

              <select
                className="pkg-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="recommended">Recommended</option>
                <option value="name">Name (A-Z)</option>
                <option value="size-asc">Size (Low)</option>
                <option value="size-desc">Size (High)</option>
              </select>
            </div>

            {/* Packages List */}
            <div className="pkg-items-list">
              {filteredPackages.map((pkg) => {
                const isInstalled = Boolean(registry[pkg.id]);
                const isSelected = selectedPackage?.id === pkg.id && !customMode;
                const downloading = Boolean(isDownloading[pkg.id]);
                const iconClass = getCategoryClass(pkg.category);

                return (
                  <div
                    key={pkg.id}
                    className={`pkg-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedId(pkg.id);
                      setCustomMode(null);
                    }}
                  >
                    <div className={`pkg-card-icon ${iconClass}`}>
                      {getCategoryIcon(pkg.category, 14)}
                    </div>

                    <div className="pkg-card-main">
                      <div className="pkg-card-title-row">
                        <span className="pkg-card-title">{pkg.displayName}</span>
                        {pkg.recommended && (
                          <Star size={11} style={{ color: '#fbbf24', flexShrink: 0 }} />
                        )}
                      </div>

                      <div className="pkg-card-meta">
                        <span>{formatBytes(pkg.sizeBytes)}</span>
                        {pkg.version && <span className="pkg-meta-badge">v{pkg.version}</span>}

                        <span style={{ marginLeft: 'auto' }}>
                          {downloading ? (
                            <span className="pkg-status-badge pkg-status-downloading">
                              DL {(downloadProgress[pkg.id]?.percent || 0).toFixed(0)}%
                            </span>
                          ) : isInstalled ? (
                            <span className="pkg-status-badge pkg-status-installed">
                              <CheckCircle size={9} /> Installed
                            </span>
                          ) : (
                            <span className="pkg-status-badge pkg-status-available">Available</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredPackages.length === 0 && (
                <div style={{ padding: 18, textAlign: 'center', color: '#64748b', fontSize: 11 }}>
                  No matching packages found.
                </div>
              )}
            </div>

            {/* Sidebar Footer */}
            <div className="pkg-sidebar-footer">
              <button
                className="unity-btn unity-btn-secondary btn-xs"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setCustomMode('url')}
              >
                <Plus size={11} />
                <span>Add URL</span>
              </button>

              <button
                className="unity-btn unity-btn-secondary btn-xs"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => {
                  if (isDesktop) {
                    handleBrowseLocalFile();
                    setCustomMode('local');
                  } else {
                    setCustomMode('local');
                  }
                }}
              >
                <FolderPlus size={11} />
                <span>Import .bin</span>
              </button>
            </div>
          </div>

          {/* Right Column: Detail Pane or Custom Form */}
          <div className="pkg-detail-pane">
            {customMode ? (
              <form className="pkg-custom-form" onSubmit={handleSaveCustom}>
                <div className="pkg-custom-tabs">
                  <button
                    type="button"
                    className={`pkg-custom-tab-btn ${customMode === 'url' ? 'active' : ''}`}
                    onClick={() => setCustomMode('url')}
                  >
                    Direct Download URL
                  </button>
                  <button
                    type="button"
                    className={`pkg-custom-tab-btn ${customMode === 'local' ? 'active' : ''}`}
                    onClick={() => setCustomMode('local')}
                  >
                    Import Local .bin File
                  </button>
                </div>

                <h4 style={{ margin: 0, fontSize: 13, color: '#fff' }}>
                  {customMode === 'local' ? 'Import Existing Model File' : 'Add Custom GGML Model URL'}
                </h4>

                {customMode === 'local' ? (
                  <div className="pkg-form-row">
                    <label className="pkg-form-label">Local File Path (.bin)</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text"
                        required
                        className="pkg-form-input"
                        style={{ flex: 1 }}
                        placeholder="C:\models\whisper\ggml-custom.bin"
                        value={customForm.filePath}
                        onChange={(e) => setCustomForm({ ...customForm, filePath: e.target.value })}
                      />
                      {isDesktop && (
                        <button
                          type="button"
                          className="unity-btn unity-btn-secondary btn-xs"
                          onClick={handleBrowseLocalFile}
                        >
                          Browse...
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="pkg-form-row">
                    <label className="pkg-form-label">Direct Download URL (.bin)</label>
                    <input
                      type="url"
                      required
                      className="pkg-form-input"
                      placeholder="https://huggingface.co/.../ggml-model.bin"
                      value={customForm.url}
                      onChange={(e) => setCustomForm({ ...customForm, url: e.target.value })}
                    />
                  </div>
                )}

                <div className="pkg-form-row">
                  <label className="pkg-form-label">Display Name</label>
                  <input
                    type="text"
                    required
                    className="pkg-form-input"
                    placeholder="e.g. Whisper Custom Fine-Tune"
                    value={customForm.displayName}
                    onChange={(e) => setCustomForm({ ...customForm, displayName: e.target.value })}
                  />
                </div>

                <div className="pkg-form-row">
                  <label className="pkg-form-label">Category</label>
                  <select
                    className="pkg-form-input"
                    value={customForm.category}
                    onChange={(e) => setCustomForm({ ...customForm, category: e.target.value })}
                  >
                    <option value="custom-model">Custom Model</option>
                    <option value="whisper-model-official">Whisper Official</option>
                    <option value="whisper-model-khmer">Whisper Khmer</option>
                  </select>
                </div>

                <div className="pkg-form-row">
                  <label className="pkg-form-label">Tags (comma separated)</label>
                  <input
                    type="text"
                    className="pkg-form-input"
                    placeholder="e.g. en, custom, fine-tune"
                    value={customForm.tags}
                    onChange={(e) => setCustomForm({ ...customForm, tags: e.target.value })}
                  />
                </div>

                <div className="pkg-form-row">
                  <label className="pkg-form-label">Description</label>
                  <textarea
                    rows={2}
                    className="pkg-form-input"
                    placeholder="Optional notes or attribution"
                    value={customForm.description}
                    onChange={(e) => setCustomForm({ ...customForm, description: e.target.value })}
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button type="submit" className="unity-btn unity-btn-primary btn-xs">
                    {customMode === 'local' ? 'Import Model' : 'Save Package'}
                  </button>
                  <button
                    type="button"
                    className="unity-btn unity-btn-secondary btn-xs"
                    onClick={() => setCustomMode(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : selectedPackage ? (
              <>
                {/* Hero Header */}
                <div className="pkg-hero">
                  <div className="pkg-hero-left">
                    <div className={`pkg-hero-icon ${getCategoryClass(selectedPackage.category)}`}>
                      {getCategoryIcon(selectedPackage.category, 24)}
                    </div>

                    <div className="pkg-hero-details">
                      <h3>{selectedPackage.displayName}</h3>
                      <div className="pkg-hero-tags">
                        {selectedPackage.version && (
                          <span className="pkg-hero-tag">v{selectedPackage.version}</span>
                        )}
                        <span className="pkg-hero-tag">{selectedPackage.category}</span>
                        {selectedPackage.attribution && (
                          <span className="pkg-hero-tag" style={{ color: '#38bdf8' }}>
                            {selectedPackage.attribution}
                          </span>
                        )}
                        {selectedPackage.recommended && (
                          <span className="pkg-recommended-pill">
                            <Star size={11} fill="#fbbf24" /> Recommended
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    {registry[selectedPackage.id] ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          color: '#34d399',
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        <CheckCircle size={15} /> Installed
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 500 }}>
                        Available for Download
                      </span>
                    )}
                  </div>
                </div>

                {/* Web mode warning banner for native whisper models */}
                {!isDesktop && selectedPackage.category?.startsWith('whisper') && (
                  <div className="pkg-web-banner">
                    <AlertCircle size={15} />
                    <span>
                      Native Whisper models run via Tauri sidecar binaries and are only executable in the
                      desktop app. In web mode, try Script Libraries and Component Presets!
                    </span>
                  </div>
                )}

                {/* Action Toolbar */}
                <div className="pkg-action-toolbar">
                  {isDownloading[selectedPackage.id] ? (
                    <div className="pkg-progress-panel">
                      <div className="pkg-progress-header">
                        <span style={{ fontWeight: 600, color: '#38bdf8' }}>
                          Downloading package...{' '}
                          {(downloadProgress[selectedPackage.id]?.percent || 0).toFixed(1)}%
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ color: '#94a3b8' }}>
                            {formatBytes(downloadProgress[selectedPackage.id]?.bytesDownloaded)} /{' '}
                            {formatBytes(
                              downloadProgress[selectedPackage.id]?.totalBytes ||
                                selectedPackage.sizeBytes
                            )}
                          </span>
                          <button
                            className="unity-btn unity-btn-secondary btn-xs"
                            style={{ color: '#ef4444' }}
                            onClick={() => handleCancelDownload(selectedPackage.id)}
                          >
                            <XCircle size={12} />
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>
                      <div className="pkg-progress-bar-track">
                        <div
                          className="pkg-progress-bar-fill"
                          style={{
                            width: `${Math.min(
                              100,
                              downloadProgress[selectedPackage.id]?.percent || 0
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : registry[selectedPackage.id] ? (
                    <>
                      <button
                        className="unity-btn unity-btn-secondary btn-xs"
                        style={{ color: '#ef4444' }}
                        onClick={() => handleDelete(selectedPackage.id)}
                      >
                        <Trash2 size={12} />
                        <span>Uninstall</span>
                      </button>

                      {isDesktop && (
                        <button
                          className="unity-btn unity-btn-secondary btn-xs"
                          onClick={() => handleRevealInExplorer(selectedPackage.id)}
                        >
                          <FolderOpen size={12} />
                          <span>Show in Explorer</span>
                        </button>
                      )}

                      {/* Presets: Add directly to current project scripts */}
                      {selectedPackage.category === 'component-pack' && (
                        <button
                          className="unity-btn unity-btn-primary btn-xs"
                          onClick={() => handleAddToProject(selectedPackage)}
                        >
                          {addedToProjectMap[selectedPackage.id] ? (
                            <>
                              <Check size={12} className="text-emerald" />
                              <span>Added to Project!</span>
                            </>
                          ) : (
                            <>
                              <Plus size={12} />
                              <span>Add to Current Project</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Script libraries: Copy import */}
                      {selectedPackage.category === 'script-library' && (
                        <button
                          className="unity-btn unity-btn-secondary btn-xs"
                          onClick={() =>
                            handleCopyCode(`import * as ${selectedPackage.packageName?.toUpperCase() || 'LIB'} from '${selectedPackage.packageName || selectedPackage.id}';`)
                          }
                        >
                          <Copy size={12} />
                          <span>Copy Import</span>
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      className="unity-btn unity-btn-primary btn-xs"
                      disabled={!isDesktop && selectedPackage.category?.startsWith('whisper')}
                      onClick={() => handleDownload(selectedPackage.id)}
                    >
                      <Download size={13} />
                      <span>
                        Install {selectedPackage.displayName}{' '}
                        ({formatBytes(selectedPackage.sizeBytes)})
                      </span>
                    </button>
                  )}
                </div>

                {/* Error message */}
                {errorMap[selectedPackage.id] && (
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid #ef4444',
                      padding: '8px 12px',
                      borderRadius: 6,
                      color: '#fca5a5',
                      fontSize: 11,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <AlertCircle size={14} />
                    <span>{errorMap[selectedPackage.id]}</span>
                  </div>
                )}

                {/* Spec & Performance Matrix */}
                <div className="pkg-spec-grid">
                  <div>
                    <div className="pkg-spec-label">File Size</div>
                    <div className="pkg-spec-value highlight">
                      {formatBytes(selectedPackage.sizeBytes)}
                    </div>
                  </div>

                  <div>
                    <div className="pkg-spec-label">
                      {selectedPackage.category?.startsWith('whisper') ? 'Inference Speed' : 'Format'}
                    </div>
                    <div className="pkg-spec-value">
                      {selectedPackage.speedRating || selectedPackage.packageType || 'Universal'}
                    </div>
                  </div>

                  <div>
                    <div className="pkg-spec-label">
                      {selectedPackage.category?.startsWith('whisper') ? 'RAM Required' : 'Version'}
                    </div>
                    <div className="pkg-spec-value">
                      {selectedPackage.ramRequired || selectedPackage.version || '1.0.0'}
                    </div>
                  </div>

                  <div>
                    <div className="pkg-spec-label">
                      {selectedPackage.category?.startsWith('whisper') ? 'Accuracy' : 'Source'}
                    </div>
                    <div className="pkg-spec-value">
                      {selectedPackage.accuracyRating || selectedPackage.packageName || 'Preset'}
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div className="pkg-desc-box">
                  {selectedPackage.description || 'No description provided.'}
                </div>

                {/* Example Script Usage / Code Preview */}
                {selectedPackage.sampleCode && (
                  <div className="pkg-code-preview">
                    <div className="pkg-code-preview-header">
                      <span>Example Script Usage</span>
                      <button
                        type="button"
                        className="unity-btn unity-btn-secondary btn-xs"
                        style={{ padding: '2px 8px', fontSize: 10 }}
                        onClick={() => handleCopyCode(selectedPackage.sampleCode)}
                      >
                        {copiedCode ? (
                          <Check size={11} className="text-emerald" />
                        ) : (
                          <Copy size={11} />
                        )}
                        <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                      </button>
                    </div>
                    <pre className="pkg-code-block">{selectedPackage.sampleCode}</pre>
                  </div>
                )}

                {/* Technical / File Location Box */}
                <div className="pkg-tech-box">
                  <div className="pkg-tech-row">
                    <span className="pkg-tech-label">Install Location:</span>
                    <span className="pkg-tech-val">
                      {installedPaths[selectedPackage.id] || selectedPackage.installPath || '—'}
                    </span>
                  </div>

                  {selectedPackage.sha256 && (
                    <div className="pkg-tech-row">
                      <span className="pkg-tech-label">SHA-256:</span>
                      <span
                        className="pkg-tech-val"
                        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        onClick={() => handleCopySha(selectedPackage.sha256)}
                        title="Click to copy hash"
                      >
                        {selectedPackage.sha256}
                        {copiedSha ? <Check size={10} className="text-emerald" /> : <Copy size={10} />}
                      </span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: '#64748b',
                  fontSize: 12,
                }}
              >
                Select a package to view details.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
