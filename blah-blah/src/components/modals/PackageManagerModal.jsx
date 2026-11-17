import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Package,
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
  Sparkles,
  Code,
  Mic,
  Wrench,
  Star,
  XCircle,
  FolderPlus,
  Layers,
  X,
} from 'lucide-react';
import {
  loadManifest,
  getInstalledPackagesRegistry,
  downloadPackage,
  cancelDownload,
  deletePackage,
  addCustomPackage,
  getPackagePath,
  openModelsDirectory,
  revealPackageInExplorer,
  importLocalModelFile,
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

const TABS = [
  { id: 'all',     label: 'All',        icon: Layers   },
  { id: 'whisper', label: 'Speech',     icon: Mic      },
  { id: 'preset',  label: 'Presets',    icon: Sparkles },
  { id: 'library', label: 'Libraries',  icon: Code     },
  { id: 'custom',  label: 'Custom',     icon: Wrench   },
];

/**
 * Speech models that run locally on the desktop (Whisper's sidecar, Qwen3-ASR's
 * Python helper). They share the "Speech" tab, the desktop-only warning, and
 * the speed/RAM/accuracy spec labels.
 */
function isNativeSpeechPackage(pkg) {
  const category = pkg?.category || '';
  // 'whisper-model-*' engines and 'asr-*' (Qwen3-ASR model + forced aligner).
  return category.startsWith('whisper-model') || category.startsWith('asr-');
}

/** Maps a package category (or an already-resolved tab id) to a package tab. */
function tabForCategory(category) {
  const value = String(category || '');
  return value.startsWith('whisper') || value.startsWith('asr-') ? 'whisper' : category;
}

/**
 * PackageManagerPanel — the inline dock-panel version of the package manager.
 * Renders as a plain full-height panel (no modal backdrop or close button).
 * Pass `initialCategory` to open on a specific tab.
 */
export function PackageManagerPanel({
  initialCategory = 'all',
  onCreateScript,
  onOpenScriptEditor,
}) {
  const [packages, setPackages] = useState([]);
  const [registry, setRegistry] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('recommended');
  const [searchQuery, setSearchQuery] = useState('');
  const [installedPaths, setInstalledPaths] = useState({});
  const [totalStorageBytes, setTotalStorageBytes] = useState(0);

  const [downloadProgress, setDownloadProgress] = useState({});
  const [isDownloading, setIsDownloading] = useState({});
  const [errorMap, setErrorMap] = useState({});
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedSha, setCopiedSha] = useState(false);
  const [addedToProjectMap, setAddedToProjectMap] = useState({});

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

      const paths = {};
      for (const p of allPkgs) {
        if (reg[p.id]) {
          paths[p.id] = await getPackagePath(p.id);
        }
      }
      setInstalledPaths(paths);

      if (!selectedId && allPkgs.length > 0) {
        setSelectedId(allPkgs[0].id);
      }
    } catch (err) {
      console.error('[PackageManagerPanel] Failed to refresh data:', err);
    }
  }, [selectedId]);

  useEffect(() => {
    if (initialCategory && initialCategory !== 'all') {
      setActiveCategory(tabForCategory(initialCategory));
    }
    refreshData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-sync category when parent requests a different one (e.g. via dock focus)
  useEffect(() => {
    if (initialCategory && initialCategory !== 'all') {
      setActiveCategory(tabForCategory(initialCategory));
    }
  }, [initialCategory]);

  // Global event listener for activating tabs from buttons in the app
  useEffect(() => {
    const handleCategoryEvent = (e) => {
      const cat = e.detail?.category;
      if (cat) {
        setActiveCategory(tabForCategory(cat));
        setCustomMode(null);
      }
    };
    window.addEventListener('blahblah:package-manager-tab', handleCategoryEvent);
    return () => window.removeEventListener('blahblah:package-manager-tab', handleCategoryEvent);
  }, []);

  const categoryCounts = useMemo(() => {
    const counts = { all: packages.length, whisper: 0, preset: 0, library: 0, custom: 0 };
    for (const p of packages) {
      if (isNativeSpeechPackage(p)) counts.whisper++;
      else if (p.category === 'component-pack') counts.preset++;
      else if (p.category === 'script-library') counts.library++;
      else if (p.category === 'custom-model' || p.isCustom) counts.custom++;
    }
    return counts;
  }, [packages]);

  const filteredPackages = useMemo(() => {
    let list = packages.filter((pkg) => {
      if (activeCategory === 'whisper') {
        if (!isNativeSpeechPackage(pkg)) return false;
      } else if (activeCategory === 'preset') {
        if (pkg.category !== 'component-pack') return false;
      } else if (activeCategory === 'library') {
        if (pkg.category !== 'script-library') return false;
      } else if (activeCategory === 'custom') {
        if (pkg.category !== 'custom-model' && !pkg.isCustom) return false;
      }

      const isInstalled = Boolean(registry[pkg.id]);
      if (statusFilter === 'installed' && !isInstalled) return false;
      if (statusFilter === 'available' && isInstalled) return false;

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

    list.sort((a, b) => {
      if (sortBy === 'recommended') {
        if (a.recommended && !b.recommended) return -1;
        if (!a.recommended && b.recommended) return 1;
        return a.displayName.localeCompare(b.displayName);
      }
      if (sortBy === 'name') return a.displayName.localeCompare(b.displayName);
      if (sortBy === 'size-asc') return (a.sizeBytes || 0) - (b.sizeBytes || 0);
      if (sortBy === 'size-desc') return (b.sizeBytes || 0) - (a.sizeBytes || 0);
      return 0;
    });

    return list;
  }, [packages, activeCategory, statusFilter, searchQuery, sortBy, registry]);

  const selectedPackage = useMemo(
    () => packages.find((p) => p.id === selectedId) || filteredPackages[0] || null,
    [packages, selectedId, filteredPackages]
  );

  const handleDownload = async (pkgId) => {
    setErrorMap((prev) => ({ ...prev, [pkgId]: null }));
    setIsDownloading((prev) => ({ ...prev, [pkgId]: true }));
    setDownloadProgress((prev) => ({ ...prev, [pkgId]: { bytesDownloaded: 0, percent: 0 } }));
    try {
      await downloadPackage(pkgId, {
        onProgress: (p) => setDownloadProgress((prev) => ({ ...prev, [pkgId]: p })),
      });
      await refreshData();
    } catch (err) {
      if (!err.message?.includes('cancelled')) {
        setErrorMap((prev) => ({ ...prev, [pkgId]: err.message || 'Download failed' }));
      }
    } finally {
      setIsDownloading((prev) => ({ ...prev, [pkgId]: false }));
    }
  };

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

  const handleDelete = async (pkgId) => {
    if (!confirm('Are you sure you want to uninstall this package?')) return;
    try {
      await deletePackage(pkgId);
      await refreshData();
    } catch (err) {
      alert(`Failed to delete package: ${err.message}`);
    }
  };

  const handleRevealInExplorer = async (pkgId) => {
    try { await revealPackageInExplorer(pkgId); } catch {}
  };

  const handleOpenFolder = async () => {
    try { await openModelsDirectory(); } catch {}
  };

  const handleCopyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {}
  };

  const handleCopySha = async (sha) => {
    try {
      await navigator.clipboard.writeText(sha);
      setCopiedSha(true);
      setTimeout(() => setCopiedSha(false), 2000);
    } catch {}
  };

  const handleAddToProject = async (pkg) => {
    try {
      if (typeof onCreateScript === 'function') {
        const cleanName = (pkg.componentName || `${pkg.displayName.replace(/\s+/g, '')}.jsx`).replace(/\.jsx$/, '');
        await onCreateScript({
          id: `script-${cleanName}-${crypto.randomUUID()}`,
          name: cleanName,
          code: pkg.sampleCode,
          type: 'canvas',
        });
        setAddedToProjectMap((prev) => ({ ...prev, [pkg.id]: true }));
        setTimeout(() => setAddedToProjectMap((prev) => ({ ...prev, [pkg.id]: false })), 3000);
      }
    } catch (err) {
      alert(`Failed to add preset to project: ${err.message}`);
    }
  };

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
        const { allowUserPath } = await import('../../services/tauriFsAdapter.js');
        await allowUserPath(selected);
        const fileName = selected.split(/[/\\]/).pop() || '';
        setCustomForm((prev) => ({
          ...prev,
          filePath: selected,
          displayName: prev.displayName || fileName.replace(/\.bin$/i, ''),
        }));
      }
    } catch {}
  };

  const handleSaveCustom = async (e) => {
    e.preventDefault();
    if (customMode === 'local') {
      if (!customForm.filePath) { alert('Please select or specify a local .bin file path.'); return; }
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
      } catch (err) { alert(`Failed to import local model: ${err.message}`); }
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
      } catch (err) { alert(`Failed to add custom package: ${err.message}`); }
    }
  };

  const getCategoryIcon = (category, size = 15) => {
    if (category?.startsWith('whisper-model') || category?.startsWith('asr-')) return <Mic size={size} />;
    if (category === 'component-pack') return <Sparkles size={size} />;
    if (category === 'script-library') return <Code size={size} />;
    return <Wrench size={size} />;
  };

  const getCategoryClass = (category) => {
    if (category?.startsWith('whisper-model') || category?.startsWith('asr-')) return 'whisper';
    if (category === 'component-pack') return 'preset';
    if (category === 'script-library') return 'library';
    return 'custom';
  };

  return (
    <div className="pkg-panel-root">

      {/* ── Tab Bar ── */}
      <div className="pkg-tab-bar">
        <div className="pkg-tabs">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`pkg-tab ${activeCategory === id ? 'active' : ''}`}
              onClick={() => { setActiveCategory(id); setCustomMode(null); }}
            >
              <Icon size={12} />
              <span>{label}</span>
              <span className="pkg-tab-count">{categoryCounts[id] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="pkg-tab-bar-right">
          {isDesktop && (
            <>
              <div className="pkg-storage-pill" title="Storage used by installed packages">
                <HardDrive size={11} style={{ color: '#38bdf8' }} />
                <span>{formatBytes(totalStorageBytes)}</span>
              </div>
              <button
                className="unity-btn unity-btn-secondary btn-xs"
                onClick={handleOpenFolder}
                title="Open models folder"
              >
                <FolderOpen size={11} />
              </button>
            </>
          )}

          <div className="pkg-search-wrapper">
            <Search size={11} className="pkg-search-icon" />
            <input
              type="text"
              className="pkg-search-input"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="pkg-search-clear" onClick={() => setSearchQuery('')}>
                <X size={10} />
              </button>
            )}
          </div>

          <div className="pkg-status-filters">
            {['all', 'installed', 'available'].map((f) => (
              <button
                key={f}
                className={`pkg-filter-pill ${statusFilter === f ? 'active' : ''}`}
                onClick={() => setStatusFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <select
            className="pkg-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="recommended">Recommended</option>
            <option value="name">Name (A–Z)</option>
            <option value="size-asc">Size (Low)</option>
            <option value="size-desc">Size (High)</option>
          </select>
        </div>
      </div>

      {/* ── Body: list + detail ── */}
      <div className="pkg-panel-body">

        {/* Package List */}
        <div className="pkg-sidebar">
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
                  onClick={() => { setSelectedId(pkg.id); setCustomMode(null); }}
                >
                  <div className={`pkg-card-icon ${iconClass}`}>
                    {getCategoryIcon(pkg.category, 13)}
                  </div>
                  <div className="pkg-card-main">
                    <div className="pkg-card-title-row">
                      <span className="pkg-card-title">{pkg.displayName}</span>
                      {pkg.recommended && <Star size={10} style={{ color: '#fbbf24', flexShrink: 0 }} />}
                    </div>
                    <div className="pkg-card-meta">
                      <span>{formatBytes(pkg.sizeBytes)}</span>
                      {pkg.version && <span className="pkg-meta-badge">v{pkg.version}</span>}
                      <span style={{ marginLeft: 'auto' }}>
                        {downloading ? (
                          <span className="pkg-status-badge pkg-status-downloading">
                            {(downloadProgress[pkg.id]?.percent || 0).toFixed(0)}%
                          </span>
                        ) : isInstalled ? (
                          <span className="pkg-status-badge pkg-status-installed">
                            <CheckCircle size={8} /> OK
                          </span>
                        ) : (
                          <span className="pkg-status-badge pkg-status-available">Get</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredPackages.length === 0 && (
              <div style={{ padding: '20px 12px', textAlign: 'center', color: '#64748b', fontSize: 11 }}>
                No matching packages.
              </div>
            )}
          </div>

          <div className="pkg-sidebar-footer">
            <button
              className="unity-btn unity-btn-secondary btn-xs"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => setCustomMode('url')}
            >
              <Plus size={10} />
              <span>Add URL</span>
            </button>
            <button
              className="unity-btn unity-btn-secondary btn-xs"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => { if (isDesktop) handleBrowseLocalFile(); setCustomMode('local'); }}
            >
              <FolderPlus size={10} />
              <span>Import .bin</span>
            </button>
          </div>
        </div>

        {/* Detail / Form Pane */}
        <div className="pkg-detail-pane">
          {customMode ? (
            <form className="pkg-custom-form" onSubmit={handleSaveCustom}>
              <div className="pkg-custom-tabs">
                <button type="button" className={`pkg-custom-tab-btn ${customMode === 'url' ? 'active' : ''}`} onClick={() => setCustomMode('url')}>
                  URL Download
                </button>
                <button type="button" className={`pkg-custom-tab-btn ${customMode === 'local' ? 'active' : ''}`} onClick={() => setCustomMode('local')}>
                  Import Local .bin
                </button>
              </div>

              <h4 style={{ margin: 0, fontSize: 12, color: '#fff' }}>
                {customMode === 'local' ? 'Import Existing Model File' : 'Add Custom GGML Model URL'}
              </h4>

              {customMode === 'local' ? (
                <div className="pkg-form-row">
                  <label className="pkg-form-label">Local File Path (.bin)</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="text" required className="pkg-form-input" style={{ flex: 1 }}
                      placeholder="C:\models\whisper\ggml-custom.bin"
                      value={customForm.filePath}
                      onChange={(e) => setCustomForm({ ...customForm, filePath: e.target.value })}
                    />
                    {isDesktop && (
                      <button type="button" className="unity-btn unity-btn-secondary btn-xs" onClick={handleBrowseLocalFile}>Browse…</button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="pkg-form-row">
                  <label className="pkg-form-label">Download URL (.bin)</label>
                  <input type="url" required className="pkg-form-input"
                    placeholder="https://huggingface.co/.../ggml-model.bin"
                    value={customForm.url}
                    onChange={(e) => setCustomForm({ ...customForm, url: e.target.value })}
                  />
                </div>
              )}

              <div className="pkg-form-row">
                <label className="pkg-form-label">Display Name</label>
                <input type="text" required className="pkg-form-input"
                  placeholder="e.g. Whisper Custom Fine-Tune"
                  value={customForm.displayName}
                  onChange={(e) => setCustomForm({ ...customForm, displayName: e.target.value })}
                />
              </div>

              <div className="pkg-form-row">
                <label className="pkg-form-label">Category</label>
                <select className="pkg-form-input" value={customForm.category}
                  onChange={(e) => setCustomForm({ ...customForm, category: e.target.value })}>
                  <option value="custom-model">Custom Model</option>
                  <option value="whisper-model-official">Whisper Official</option>
                  <option value="whisper-model-khmer">Whisper Khmer</option>
                </select>
              </div>

              <div className="pkg-form-row">
                <label className="pkg-form-label">Tags (comma separated)</label>
                <input type="text" className="pkg-form-input"
                  placeholder="e.g. en, custom, fine-tune"
                  value={customForm.tags}
                  onChange={(e) => setCustomForm({ ...customForm, tags: e.target.value })}
                />
              </div>

              <div className="pkg-form-row">
                <label className="pkg-form-label">Description</label>
                <textarea rows={2} className="pkg-form-input"
                  placeholder="Optional notes or attribution"
                  value={customForm.description}
                  onChange={(e) => setCustomForm({ ...customForm, description: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="submit" className="unity-btn unity-btn-primary btn-xs">
                  {customMode === 'local' ? 'Import Model' : 'Save Package'}
                </button>
                <button type="button" className="unity-btn unity-btn-secondary btn-xs" onClick={() => setCustomMode(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : selectedPackage ? (
            <>
              {/* Hero */}
              <div className="pkg-hero">
                <div className="pkg-hero-left">
                  <div className={`pkg-hero-icon ${getCategoryClass(selectedPackage.category)}`}>
                    {getCategoryIcon(selectedPackage.category, 22)}
                  </div>
                  <div className="pkg-hero-details">
                    <h3>{selectedPackage.displayName}</h3>
                    <div className="pkg-hero-tags">
                      {selectedPackage.version && <span className="pkg-hero-tag">v{selectedPackage.version}</span>}
                      <span className="pkg-hero-tag">{selectedPackage.category}</span>
                      {selectedPackage.attribution && <span className="pkg-hero-tag" style={{ color: '#38bdf8' }}>{selectedPackage.attribution}</span>}
                      {selectedPackage.recommended && (
                        <span className="pkg-recommended-pill"><Star size={10} fill="#fbbf24" /> Recommended</span>
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  {registry[selectedPackage.id] ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#34d399', fontSize: 11, fontWeight: 700 }}>
                      <CheckCircle size={13} /> Installed
                    </span>
                  ) : (
                    <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 500 }}>Available</span>
                  )}
                </div>
              </div>

              {/* Web warning */}
              {!isDesktop && isNativeSpeechPackage(selectedPackage) && (
                <div className="pkg-web-banner">
                  <AlertCircle size={13} />
                  <span>Native Whisper models only run in the desktop app.</span>
                </div>
              )}

              {/* Actions */}
              <div className="pkg-action-toolbar">
                {isDownloading[selectedPackage.id] ? (
                  <div className="pkg-progress-panel">
                    <div className="pkg-progress-header">
                      <span style={{ fontWeight: 600, color: '#38bdf8', fontSize: 11 }}>
                        Downloading… {(downloadProgress[selectedPackage.id]?.percent || 0).toFixed(1)}%
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#94a3b8', fontSize: 10 }}>
                          {formatBytes(downloadProgress[selectedPackage.id]?.bytesDownloaded)} / {formatBytes(downloadProgress[selectedPackage.id]?.totalBytes || selectedPackage.sizeBytes)}
                        </span>
                        <button className="unity-btn unity-btn-secondary btn-xs" style={{ color: '#ef4444' }}
                          onClick={() => handleCancelDownload(selectedPackage.id)}>
                          <XCircle size={11} /><span>Cancel</span>
                        </button>
                      </div>
                    </div>
                    <div className="pkg-progress-bar-track">
                      <div className="pkg-progress-bar-fill"
                        style={{ width: `${Math.min(100, downloadProgress[selectedPackage.id]?.percent || 0)}%` }} />
                    </div>
                  </div>
                ) : registry[selectedPackage.id] ? (
                  <>
                    <button className="unity-btn unity-btn-secondary btn-xs" style={{ color: '#ef4444' }}
                      onClick={() => handleDelete(selectedPackage.id)}>
                      <Trash2 size={11} /><span>Uninstall</span>
                    </button>
                    {isDesktop && (
                      <button className="unity-btn unity-btn-secondary btn-xs"
                        onClick={() => handleRevealInExplorer(selectedPackage.id)}>
                        <FolderOpen size={11} /><span>Show in Explorer</span>
                      </button>
                    )}
                    {selectedPackage.category === 'component-pack' && (
                      <button className="unity-btn unity-btn-primary btn-xs"
                        onClick={() => handleAddToProject(selectedPackage)}>
                        {addedToProjectMap[selectedPackage.id]
                          ? <><Check size={11} className="text-emerald" /><span>Added!</span></>
                          : <><Plus size={11} /><span>Add to Project</span></>}
                      </button>
                    )}
                    {selectedPackage.category === 'script-library' && (
                      <button className="unity-btn unity-btn-secondary btn-xs"
                        onClick={() => handleCopyCode(`import * as ${selectedPackage.packageName?.toUpperCase() || 'LIB'} from '${selectedPackage.packageName || selectedPackage.id}';`)}>
                        <Copy size={11} /><span>Copy Import</span>
                      </button>
                    )}
                  </>
                ) : (
                  <button className="unity-btn unity-btn-primary btn-xs"
                    disabled={!isDesktop && isNativeSpeechPackage(selectedPackage)}
                    onClick={() => handleDownload(selectedPackage.id)}>
                    <Download size={12} />
                    <span>Install ({formatBytes(selectedPackage.sizeBytes)})</span>
                  </button>
                )}
              </div>

              {errorMap[selectedPackage.id] && (
                <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444', padding: '7px 11px', borderRadius: 6, color: '#fca5a5', fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertCircle size={13} /><span>{errorMap[selectedPackage.id]}</span>
                </div>
              )}

              {/* Spec grid */}
              <div className="pkg-spec-grid">
                <div>
                  <div className="pkg-spec-label">Size</div>
                  <div className="pkg-spec-value highlight">{formatBytes(selectedPackage.sizeBytes)}</div>
                </div>
                <div>
                  <div className="pkg-spec-label">{isNativeSpeechPackage(selectedPackage) ? 'Speed' : 'Format'}</div>
                  <div className="pkg-spec-value">{selectedPackage.speedRating || selectedPackage.packageType || 'Universal'}</div>
                </div>
                <div>
                  <div className="pkg-spec-label">{isNativeSpeechPackage(selectedPackage) ? 'RAM' : 'Version'}</div>
                  <div className="pkg-spec-value">{selectedPackage.ramRequired || selectedPackage.version || '1.0.0'}</div>
                </div>
                <div>
                  <div className="pkg-spec-label">{isNativeSpeechPackage(selectedPackage) ? 'Accuracy' : 'Source'}</div>
                  <div className="pkg-spec-value">{selectedPackage.accuracyRating || selectedPackage.packageName || 'Preset'}</div>
                </div>
              </div>

              {/* Description */}
              <div className="pkg-desc-box">{selectedPackage.description || 'No description provided.'}</div>

              {/* Code preview */}
              {selectedPackage.sampleCode && (
                <div className="pkg-code-preview">
                  <div className="pkg-code-preview-header">
                    <span>Example Usage</span>
                    <button type="button" className="unity-btn unity-btn-secondary btn-xs"
                      style={{ padding: '2px 7px', fontSize: 10 }}
                      onClick={() => handleCopyCode(selectedPackage.sampleCode)}>
                      {copiedCode ? <Check size={10} className="text-emerald" /> : <Copy size={10} />}
                      <span>{copiedCode ? 'Copied!' : 'Copy'}</span>
                    </button>
                  </div>
                  <pre className="pkg-code-block">{selectedPackage.sampleCode}</pre>
                </div>
              )}

              {/* Tech info */}
              <div className="pkg-tech-box">
                <div className="pkg-tech-row">
                  <span className="pkg-tech-label">Install Location:</span>
                  <span className="pkg-tech-val">{installedPaths[selectedPackage.id] || selectedPackage.installPath || '—'}</span>
                </div>
                {selectedPackage.sha256 && (
                  <div className="pkg-tech-row">
                    <span className="pkg-tech-label">SHA-256:</span>
                    <span className="pkg-tech-val" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={() => handleCopySha(selectedPackage.sha256)} title="Click to copy">
                      {selectedPackage.sha256}
                      {copiedSha ? <Check size={9} className="text-emerald" /> : <Copy size={9} />}
                    </span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', fontSize: 11 }}>
              Select a package to view details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * PackageManagerModal — kept for backward compatibility but now simply
 * wraps PackageManagerPanel in a modal shell.
 */
export function PackageManagerModal({
  isOpen,
  onClose,
  initialCategory = 'all',
  onCreateScript,
  onOpenScriptEditor,
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="pkg-modal-backdrop" onClick={onClose}>
      <div className="pkg-modal-wrap" onClick={(e) => e.stopPropagation()}>
        <PackageManagerPanel
          initialCategory={initialCategory}
          onCreateScript={onCreateScript}
          onOpenScriptEditor={onOpenScriptEditor}
        />
      </div>
    </div>
  );
}
