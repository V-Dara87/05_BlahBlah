import { memo } from 'react';
import { ArrowLeft, Package, Sparkles, Check, RefreshCw, X } from 'lucide-react';
import './prefab-mode-bar.css';

/**
 * PrefabModeBar — Displayed at the top of the Timeline when in Prefab Editing Mode.
 *
 * Provides a Unity-like Prefab Stage breadcrumb banner allowing users to
 * clearly see they are editing an isolated prefab, inspect object counts,
 * save changes, sync directly to scene timeline instances, and exit back to the main scene timeline.
 */
export const PrefabModeBar = memo(function PrefabModeBar({
  prefab,
  onExit,
  onSave,
  onSyncToScene,
  isSaved = false,
  isSynced = false,
}) {
  const objectCount = Array.isArray(prefab?.entities)
    ? prefab.entities.length
    : (prefab ? 1 : 0);

  return (
    <div className="prefab-mode-banner">
      <div className="prefab-mode-left">
        <button
          className="prefab-mode-back-btn"
          onClick={onExit}
          title="Return to Main Project Timeline"
        >
          <ArrowLeft size={13} />
          <span>Scene</span>
        </button>

        <div className="prefab-mode-crumb-divider">/</div>

        <div className="prefab-mode-title-tag">
          <Package size={13} className="text-cyan" />
          <span className="prefab-mode-name">{prefab?.name || 'Prefab'}</span>
          <span className="prefab-mode-pill">Prefab Stage</span>
        </div>

        <span className="prefab-mode-meta">
          {objectCount} {objectCount === 1 ? 'object' : 'objects'} (Hierarchy Mode)
        </span>
      </div>

      <div className="prefab-mode-right">
        {onSave && (
          <button
            className={`prefab-mode-save-btn${isSaved ? ' saved' : ''}`}
            onClick={onSave}
            title="Save Prefab changes to disk"
          >
            {isSaved ? <Check size={12} /> : <Sparkles size={12} />}
            <span>{isSaved ? 'Saved' : 'Save Prefab'}</span>
          </button>
        )}

        {onSyncToScene && (
          <button
            className={`prefab-mode-sync-btn${isSynced ? ' synced' : ''}`}
            onClick={onSyncToScene}
            title="Push changes to all instances of this prefab on the scene timeline"
          >
            {isSynced ? <Check size={12} /> : <RefreshCw size={12} />}
            <span>{isSynced ? 'Synced to Scene!' : 'Sync to Scene'}</span>
          </button>
        )}

        <button
          className="prefab-mode-exit-btn"
          onClick={onExit}
          title="Exit Prefab Mode and return to main scene"
        >
          <X size={12} />
          <span>Exit Prefab Mode</span>
        </button>
      </div>
    </div>
  );
});
