import { useState, useEffect, useMemo, useCallback } from 'react';
import { Package, X, Download, Trash2, Plus, CheckCircle, RefreshCw, AlertCircle, Copy, Check } from 'lucide-react';
import {
  loadManifest,
  getInstalledPackagesRegistry,
  downloadPackage,
  deletePackage,
  addCustomPackage,
  removeCustomPackage,
  getPackagePath,
} from '../../services/packageManager.js';
import './package-manager-modal.css';

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function PackageManagerModal({ isOpen, onClose, initialCategory = 'all' }) {
  const [packages, setPackages] = useState([]);
  const [registry, setRegistry] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [searchQuery, setSearchQuery] = useState('');
  const [installedPaths, setInstalledPaths] = useState({});

  // Download state: { [pkgId]: { bytesDownloaded, totalBytes, percent } }
  const [downloadProgress, setDownloadProgress] = useState({});
  const [isDownloading, setIsDownloading] = useState({});
  const [errorMap, setErrorMap] = useState({});
  const [copiedCode, setCopiedCode] = useState(false);

  // Custom model form state
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customForm, setCustomForm] = useState({
    displayName: '',
    url: '',
    category: 'custom-model',
    tags: 'custom',
    description: '',
  });

  const refreshData = useCallback(async () => {
    try {
      const [allPkgs, reg] = await Promise.all([
        loadManifest(),
        getInstalledPackagesRegistry(),
      ]);
      setPackages(allPkgs);
      setRegistry(reg);

      // Resolve paths for installed packages
      const paths = {};
      for (const p of allPkgs) {
        if (reg[p.id]) {
          paths[p.id] = await getPackagePath(p.id);
        }
      }
      setInstalledPaths(paths);

      // Default selection if none
      if (!selectedId && allPkgs.length > 0) {
        setSelectedId(allPkgs[0].id);
      }
    } catch (err) {
      console.error('[PackageManagerModal] Failed to refresh data:', err);
    }
  }, [selectedId]);

  useEffect(() => {
    if (isOpen) {
      if (initialCategory) {
        setActiveCategory(initialCategory);
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

  const filteredPackages = useMemo(() => {
    return packages.filter((pkg) => {
      if (activeCategory !== 'all' && pkg.category !== activeCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = pkg.displayName.toLowerCase().includes(q);
        const matchesDesc = (pkg.description || '').toLowerCase().includes(q);
        const matchesTags = (pkg.tags || []).some((t) => t.toLowerCase().includes(q));
        if (!matchesName && !matchesDesc && !matchesTags) return false;
      }
      return true;
    });
  }, [packages, activeCategory, searchQuery]);

  const selectedPackage = useMemo(() => {
    return packages.find((p) => p.id === selectedId) || filteredPackages[0] || null;
  }, [packages, selectedId, filteredPackages]);

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
      console.error(`Download failed for ${pkgId}:`, err);
      setErrorMap((prev) => ({
        ...prev,
        [pkgId]: err.message || 'Download failed',
      }));
    } finally {
      setIsDownloading((prev) => ({ ...prev, [pkgId]: false }));
    }
  };

  const handleCopyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
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

  const handleSaveCustom = async (e) => {
    e.preventDefault();
    if (!customForm.displayName || !customForm.url) return;
    try {
      const created = await addCustomPackage({
        displayName: customForm.displayName,
        url: customForm.url,
        category: customForm.category,
        tags: customForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
        description: customForm.description,
      });
      setShowAddCustom(false);
      setCustomForm({
        displayName: '',
        url: '',
        category: 'custom-model',
        tags: 'custom',
        description: '',
      });
      await refreshData();
      setSelectedId(created.id);
    } catch (err) {
      alert(`Failed to add custom package: ${err.message}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="pkg-modal-backdrop" onClick={onClose}>
      <div className="pkg-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pkg-modal-header">
          <div className="pkg-modal-title">
            <Package size={16} className="text-cyan" />
            <span>Package Manager — AI Models & Assets</span>
          </div>
          <button className="pkg-modal-close-btn" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="pkg-modal-body">
          {/* Left Column: Categories and List */}
          <div className="pkg-sidebar">
            <div className="pkg-search-box">
              <input
                type="text"
                className="pkg-search-input"
                placeholder="Search models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="pkg-category-tabs">
              <button
                className={`pkg-cat-btn ${activeCategory === 'all' ? 'active' : ''}`}
                onClick={() => setActiveCategory('all')}
              >
                All
              </button>
              <button
                className={`pkg-cat-btn ${activeCategory === 'whisper-model-official' ? 'active' : ''}`}
                onClick={() => setActiveCategory('whisper-model-official')}
              >
                Whisper Official
              </button>
              <button
                className={`pkg-cat-btn ${activeCategory === 'whisper-model-khmer' ? 'active' : ''}`}
                onClick={() => setActiveCategory('whisper-model-khmer')}
              >
                Khmer Community
              </button>
              <button
                className={`pkg-cat-btn ${activeCategory === 'script-library' ? 'active' : ''}`}
                onClick={() => setActiveCategory('script-library')}
              >
                Script Libraries
              </button>
              <button
                className={`pkg-cat-btn ${activeCategory === 'component-pack' ? 'active' : ''}`}
                onClick={() => setActiveCategory('component-pack')}
              >
                Component Packs
              </button>
              <button
                className={`pkg-cat-btn ${activeCategory === 'custom-model' ? 'active' : ''}`}
                onClick={() => setActiveCategory('custom-model')}
              >
                Custom
              </button>
            </div>

            <div className="pkg-items-list">
              {filteredPackages.map((pkg) => {
                const isInstalled = Boolean(registry[pkg.id]);
                const isSelected = selectedPackage?.id === pkg.id;
                const downloading = Boolean(isDownloading[pkg.id]);

                return (
                  <div
                    key={pkg.id}
                    className={`pkg-list-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedId(pkg.id);
                      setShowAddCustom(false);
                    }}
                  >
                    <div className="pkg-item-title">{pkg.displayName}</div>
                    <div className="pkg-item-meta">
                      <span>{formatBytes(pkg.sizeBytes)}</span>
                      {downloading ? (
                        <span className="pkg-status-badge" style={{ color: '#38bdf8' }}>
                          DL {(downloadProgress[pkg.id]?.percent || 0).toFixed(0)}%
                        </span>
                      ) : isInstalled ? (
                        <span className="pkg-status-badge pkg-status-installed">Installed</span>
                      ) : (
                        <span className="pkg-status-badge pkg-status-uninstalled">Available</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredPackages.length === 0 && (
                <div style={{ padding: 12, fontSize: 11, color: 'var(--unity-text-dim)' }}>
                  No packages found.
                </div>
              )}
            </div>

            <div className="pkg-sidebar-footer">
              <button
                className="unity-btn unity-btn-secondary btn-xs"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setShowAddCustom(true)}
              >
                <Plus size={11} />
                <span>Add Custom Model</span>
              </button>
            </div>
          </div>

          {/* Right Column: Details or Custom Form */}
          <div className="pkg-detail-pane">
            {showAddCustom ? (
              <form className="pkg-custom-form" onSubmit={handleSaveCustom}>
                <h4 style={{ margin: 0, fontSize: 13, color: '#fff' }}>Add Custom GGML Model</h4>
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
                    placeholder="e.g. en, custom"
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
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="submit" className="unity-btn unity-btn-primary btn-xs">
                    Save Package
                  </button>
                  <button
                    type="button"
                    className="unity-btn unity-btn-secondary btn-xs"
                    onClick={() => setShowAddCustom(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : selectedPackage ? (
              <>
                <div className="pkg-detail-header">
                  <div className="pkg-detail-title-group">
                    <h3>{selectedPackage.displayName}</h3>
                    <div className="pkg-tags-row">
                      <span className="pkg-tag">{selectedPackage.category}</span>
                      {(selectedPackage.tags || []).map((t) => (
                        <span key={t} className="pkg-tag">
                          {t}
                        </span>
                      ))}
                      {selectedPackage.attribution && (
                        <span className="pkg-tag" style={{ color: '#38bdf8' }}>
                          {selectedPackage.attribution}
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    {registry[selectedPackage.id] ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          color: '#34d399',
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        <CheckCircle size={13} /> Installed
                      </span>
                    ) : (
                      <span style={{ color: 'var(--unity-text-dim)', fontSize: 11 }}>
                        Not installed
                      </span>
                    )}
                  </div>
                </div>

                <div className="pkg-detail-grid">
                  <div>
                    <div className="pkg-detail-stat-label">Package ID</div>
                    <div className="pkg-detail-stat-val">{selectedPackage.id}</div>
                  </div>
                  <div>
                    <div className="pkg-detail-stat-label">File Size</div>
                    <div className="pkg-detail-stat-val">
                      {formatBytes(selectedPackage.sizeBytes)}
                    </div>
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <div className="pkg-detail-stat-label">Install Location</div>
                    <div
                      className="pkg-detail-stat-val"
                      style={{ fontSize: 10, color: 'var(--unity-text-dim)' }}
                    >
                      {installedPaths[selectedPackage.id] || selectedPackage.installPath || '—'}
                    </div>
                  </div>
                  {selectedPackage.sha256 && (
                    <div style={{ gridColumn: 'span 2' }}>
                      <div className="pkg-detail-stat-label">SHA-256 Checksum</div>
                      <div
                        className="pkg-detail-stat-val"
                        style={{ fontSize: 9, color: 'var(--unity-text-dim)' }}
                      >
                        {selectedPackage.sha256}
                      </div>
                    </div>
                  )}
                </div>

                <div className="pkg-detail-desc">
                  {selectedPackage.description || 'No description provided.'}
                </div>

                {selectedPackage.sampleCode && (
                  <div className="pkg-code-preview">
                    <div className="pkg-code-preview-header">
                      <span>Example Script Usage</span>
                      <button
                        type="button"
                        className="unity-btn unity-btn-secondary btn-xs"
                        style={{ padding: '2px 6px', fontSize: 10 }}
                        onClick={() => handleCopyCode(selectedPackage.sampleCode)}
                      >
                        {copiedCode ? <Check size={11} className="text-emerald" /> : <Copy size={11} />}
                        <span>{copiedCode ? 'Copied!' : 'Copy Snippet'}</span>
                      </button>
                    </div>
                    <pre className="pkg-code-block">{selectedPackage.sampleCode}</pre>
                  </div>
                )}

                {errorMap[selectedPackage.id] && (
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid #ef4444',
                      padding: '8px 12px',
                      borderRadius: 4,
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

                <div className="pkg-actions-box">
                  {isDownloading[selectedPackage.id] ? (
                    <div className="pkg-progress-box">
                      <div className="pkg-progress-labels">
                        <span>Downloading package...</span>
                        <span>
                          {formatBytes(downloadProgress[selectedPackage.id]?.bytesDownloaded)} /{' '}
                          {formatBytes(
                            downloadProgress[selectedPackage.id]?.totalBytes || selectedPackage.sizeBytes
                          )}
                        </span>
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
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        className="unity-btn unity-btn-secondary btn-xs"
                        style={{ color: '#ef4444' }}
                        onClick={() => handleDelete(selectedPackage.id)}
                      >
                        <Trash2 size={12} />
                        <span>
                          Uninstall{' '}
                          {selectedPackage.category === 'script-library'
                            ? 'Library'
                            : selectedPackage.category === 'component-pack'
                            ? 'Preset Pack'
                            : 'Model'}
                        </span>
                      </button>
                      {selectedPackage.isCustom && (
                        <button
                          className="unity-btn unity-btn-secondary btn-xs"
                          onClick={async () => {
                            if (confirm('Remove this custom model definition?')) {
                              await removeCustomPackage(selectedPackage.id);
                              await refreshData();
                            }
                          }}
                        >
                          Delete Custom Entry
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        className="unity-btn unity-btn-primary btn-xs"
                        onClick={() => handleDownload(selectedPackage.id)}
                      >
                        <Download size={12} />
                        <span>
                          Install{' '}
                          {selectedPackage.category === 'script-library'
                            ? 'Library'
                            : selectedPackage.category === 'component-pack'
                            ? 'Preset Pack'
                            : 'Model'}{' '}
                          ({formatBytes(selectedPackage.sizeBytes)})
                        </span>
                      </button>
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
                  color: 'var(--unity-text-dim)',
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
