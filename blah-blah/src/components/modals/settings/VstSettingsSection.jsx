import { useCallback, useEffect, useState } from 'react';
import { FolderPlus, RefreshCw, Trash2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { loadAudioSettings, updateAudioSettings } from '../../../services/audioSettings';
import {
  addVstScanDir,
  formatScanAge,
  getVstScanDirs,
  loadVstScanCache,
  removeVstScanDir,
  scanVstPluginsCached,
} from '../../../services/vstScanCache';
import { clearVstCache, getVstCacheStats } from '../../../services/trackFxBounce';
import { describeVstSupport, inspectVstSupport } from '../../../services/vstDiagnostics';

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 1024 * 1024 * 100 ? 0 : 1)} MB`;
}

/**
 * Settings > Audio > Plugins. The flag is stored in audioSettings, but the
 * sidecar/scan/cache controls live here so the feature is discoverable without
 * adding a separate top-level settings tab.
 */
export function VstSettingsSection() {
  const [enabled, setEnabled] = useState(() => loadAudioSettings().vstEnabled);
  const [support, setSupport] = useState(null);
  const [cache, setCache] = useState(() => loadVstScanCache());
  const [dirs, setDirs] = useState(() => getVstScanDirs());
  const [stats, setStats] = useState({ bytes: 0, files: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refreshStatus = useCallback(async () => {
    const status = await inspectVstSupport({ enabled });
    setSupport(status);
    if (status.supported) {
      setStats(await getVstCacheStats());
    }
  }, [enabled]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleToggle = useCallback((next) => {
    setEnabled(next);
    updateAudioSettings({ vstEnabled: next });
    setError(null);
  }, []);

  const handleScan = useCallback(async (force = true) => {
    setLoading(true);
    setError(null);
    try {
      const status = await inspectVstSupport({ enabled });
      setSupport(status);
      if (!status.supported) return;
      const next = await scanVstPluginsCached({ force });
      setCache(next);
      setDirs(getVstScanDirs());
      setStats(await getVstCacheStats());
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const handleAddFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Add VST3 plugin folder' });
      if (typeof selected !== 'string' || !selected) return;
      addVstScanDir(selected);
      setDirs(getVstScanDirs());
      await handleScan(true);
    } catch (err) {
      setError(err?.message || String(err));
    }
  }, [handleScan]);

  const handleRemoveFolder = useCallback((dir) => {
    removeVstScanDir(dir);
    setDirs(getVstScanDirs());
  }, []);

  const handleClearCache = useCallback(async () => {
    await clearVstCache();
    setStats(await getVstCacheStats());
  }, []);

  return (
    <div className="settings-vst-section">
      <div className="settings-section-heading">Plugins</div>

      <label className="settings-check-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => handleToggle(event.target.checked)}
        />
        <span>
          Enable experimental VST3 insert effects
          <span className="settings-hint-inline">Windows desktop only · effects only</span>
        </span>
      </label>

      <p className="hint-text-sm">
        Inserts are processed in a separate sidecar process, per track and pre-fader. The webview never loads plugin binaries.
        Instruments and MIDI plugins are not supported in this release.
      </p>

      <div className={`settings-vst-status ${support?.supported ? 'is-ready' : ''}`}>
        <span>{describeVstSupport(support)}</span>
        <button type="button" className="btn-secondary btn-xs" onClick={() => refreshStatus()}>
          <RefreshCw size={11} /> Check
        </button>
      </div>

      {error && <div className="settings-vst-error">{error}</div>}

      <div className="settings-vst-toolbar">
        <span className="settings-vst-summary">
          {cache.plugins?.length || 0} effect{cache.plugins?.length === 1 ? '' : 's'} · {formatScanAge(cache.scannedAt)}
        </span>
        <div className="settings-vst-actions">
          <button type="button" className="btn-secondary btn-xs" onClick={() => handleScan(true)} disabled={!enabled || loading || !support?.supported}>
            <RefreshCw size={11} className={loading ? 'settings-spin' : ''} /> Scan
          </button>
          <button type="button" className="btn-secondary btn-xs" onClick={handleAddFolder} disabled={!enabled}>
            <FolderPlus size={11} /> Add Folder
          </button>
        </div>
      </div>

      {dirs.length > 0 ? (
        <div className="settings-vst-dirs">
          {dirs.map((dir) => (
            <div className="settings-vst-dir" key={dir} title={dir}>
              <span>{dir}</span>
              <button type="button" onClick={() => handleRemoveFolder(dir)} title="Remove folder">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint-text-sm">No custom folders. Scanning uses the standard Windows VST3 folders.</p>
      )}

      <div className="settings-vst-cache">
        <span>Bounce cache: {formatBytes(stats.bytes)} · {stats.files} file{stats.files === 1 ? '' : 's'}</span>
        <button type="button" className="btn-secondary btn-xs" onClick={handleClearCache} disabled={stats.files === 0}>
          <Trash2 size={11} /> Clear
        </button>
      </div>
    </div>
  );
}
