import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  addVstScanDir,
  formatScanAge,
  getVstScanDirs,
  loadVstScanCache,
  removeVstScanDir,
  scanVstPluginsCached,
} from '../../services/vstScanCache';
import { describeVstSupport, inspectVstSupport } from '../../services/vstDiagnostics';

/**
 * Effect picker. Only VST3 effects are offered; instruments and note effects
 * are listed as disabled with an explanation rather than silently hidden.
 */
export function PluginPicker({ onPick, onClose, style }) {
  const [cache, setCache] = useState(() => loadVstScanCache());
  const [dirs, setDirs] = useState(() => getVstScanDirs());
  const [support, setSupport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const status = await inspectVstSupport({ enabled: true });
      setSupport(status);
      if (!status.supported) {
        setCache(loadVstScanCache());
        return;
      }
      const next = await scanVstPluginsCached({ force, onProgress: () => {} });
      setCache(next);
      setDirs(getVstScanDirs());
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await inspectVstSupport({ enabled: true });
      if (cancelled) return;
      setSupport(status);
      if (!status.supported) return;
      const cached = loadVstScanCache();
      setCache(cached);
      if (!cached.scannedAt) await refresh(false);
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  const handleAddFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Add VST3 plugin folder' });
      if (typeof selected !== 'string' || !selected) return;
      addVstScanDir(selected);
      setDirs(getVstScanDirs());
      await refresh(true);
    } catch (err) {
      setError(err?.message || String(err));
    }
  }, [refresh]);

  const handleRemoveFolder = useCallback((dir) => {
    removeVstScanDir(dir);
    setDirs(getVstScanDirs());
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (cache.plugins || []).filter((plugin) => {
      if (!needle) return true;
      return `${plugin.name || ''} ${plugin.vendor || ''} ${plugin.path || ''}`.toLowerCase().includes(needle);
    });
  }, [cache.plugins, query]);

  return (
    <>
      <div className="fx-picker-backdrop" onMouseDown={onClose} />
      <div className="fx-picker" style={style} onMouseDown={(event) => event.stopPropagation()}>
        <div className="fx-picker-head">
          <span><SlidersHorizontal size={12} /> VST3 Effects</span>
          <button type="button" className="fx-icon-btn" onClick={onClose} title="Close picker"><X size={12} /></button>
        </div>

        <div className="fx-picker-toolbar">
          <div className="fx-picker-search">
            <Search size={12} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search effects"
            />
          </div>
          <button type="button" className="fx-icon-btn" onClick={() => refresh(true)} disabled={loading} title="Rescan plugins">
            <RefreshCw size={12} className={loading ? 'fx-spin' : ''} />
          </button>
          <button type="button" className="fx-icon-btn" onClick={handleAddFolder} disabled={loading} title="Add plugin folder">
            <FolderPlus size={12} />
          </button>
        </div>

        {!support?.supported && (
          <div className="fx-picker-note warning">{describeVstSupport(support)}</div>
        )}
        {error && <div className="fx-picker-note error">{error}</div>}

        {dirs.length > 0 && (
          <div className="fx-picker-dirs">
            {dirs.map((dir) => (
              <span key={dir} className="fx-dir-chip" title={dir}>
                {dir}
                <button type="button" onClick={() => handleRemoveFolder(dir)} title="Remove folder"><X size={9} /></button>
              </span>
            ))}
          </div>
        )}

        <div className="fx-picker-list">
          {loading && filtered.length === 0 && <div className="fx-picker-empty">Scanning plugin folders...</div>}
          {!loading && filtered.length === 0 && support?.supported && (
            <div className="fx-picker-empty">No effects found. Add a folder or rescan.</div>
          )}
          {filtered.map((plugin) => {
            const isEffect = plugin.category === 'effect' || plugin.category === 'analyzer' || plugin.category === 'tool';
            return (
              <button
                key={`${plugin.path}-${plugin.classId}`}
                type="button"
                className="fx-picker-item"
                disabled={!isEffect}
                onClick={() => onPick(plugin)}
                title={isEffect ? plugin.path : 'Instrument and MIDI plugins are not supported yet.'}
              >
                <span className="fx-picker-name">{plugin.name || 'VST3 plugin'}</span>
                <span className="fx-picker-meta">
                  {plugin.vendor || 'Unknown vendor'}
                  {plugin.category && plugin.category !== 'effect' ? ` · ${plugin.category}` : ''}
                </span>
              </button>
            );
          })}
        </div>

        <div className="fx-picker-foot">
          <span>{formatScanAge(cache.scannedAt)} · {filtered.length} effect{filtered.length === 1 ? '' : 's'}</span>
          <span>Instruments / MIDI are disabled in this release.</span>
        </div>
      </div>
    </>
  );
}
