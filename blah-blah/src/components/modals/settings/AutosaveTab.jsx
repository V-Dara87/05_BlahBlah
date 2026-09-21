import { useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  AUTOSAVE_DEFAULTS,
  AUTOSAVE_DELAY_PRESETS_MS,
  getAutosaveMaxWaitMs,
} from '../../../services/autosaveSettings';
 
/**
 * Autosave tab — every knob of useProjectAutosave (hooks/useProjectAutosave.js).
 * Values are global (localStorage, see services/autosaveSettings.js) and apply
 * to the very next change: App owns the state and passes it to both this tab
 * and the autosave hook, so there is nothing to "apply" or reload.
 */
export function AutosaveTab({ settings, onChange }) {
  const current = settings || AUTOSAVE_DEFAULTS;
  const update = (patch) => onChange?.({ ...current, ...patch });
 
  // The preset list plus whatever value is currently stored (e.g. from an
  // older build), so the <select> never shows a value that isn't an option.
  const delayOptions = useMemo(() => {
    const values = new Set(AUTOSAVE_DELAY_PRESETS_MS);
    values.add(current.delayMs);
    return Array.from(values).sort((a, b) => a - b);
  }, [current.delayMs]);
 
  const formatSeconds = (ms) => {
    const seconds = ms / 1000;
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  };
  const maxWaitSeconds = Math.round(getAutosaveMaxWaitMs(current.delayMs) / 1000);
  const isDefault = Object.keys(AUTOSAVE_DEFAULTS).every((key) => current[key] === AUTOSAVE_DEFAULTS[key]);
 
  // Groups that only matter while autosave is on get greyed out when it is off.
  const dimClass = current.enabled ? '' : 'settings-group-dimmed';
 
  return (
    <div className="modal-body settings-body">
      <div className="form-field-group">
        <label className="form-label">Autosave</label>
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={current.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span>
            Save changes to the project folder automatically
            <span className="hint-text-sm settings-hint-block">
              When off, nothing is written until you save manually (File &gt; Save Project). The header
              shows “Unsaved” while changes are waiting.
            </span>
          </span>
        </label>
      </div>
 
      <div className={`form-field-group ${dimClass}`}>
        <label className="form-label">Save delay</label>
        <select
          className="modal-text-input settings-select"
          value={current.delayMs}
          disabled={!current.enabled}
          onChange={(e) => update({ delayMs: Number(e.target.value) })}
        >
          {delayOptions.map((ms) => (
            <option key={ms} value={ms}>
              {formatSeconds(ms)}
              {ms === AUTOSAVE_DEFAULTS.delayMs ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <p className="hint-text-sm">
          Waits this long after your last change before saving, so a burst of edits becomes one save.
          If you never pause, a save is still forced about every {maxWaitSeconds} seconds.
        </p>
      </div>
 
      <div className={`form-field-group ${dimClass}`}>
        <label className="form-label">Saving on leave</label>
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={current.saveOnBlur}
            disabled={!current.enabled}
            onChange={(e) => update({ saveOnBlur: e.target.checked })}
          />
          <span>
            Save right away when the window loses focus or closes
            <span className="hint-text-sm settings-hint-block">
              Switching to VS Code flushes any pending change first. On close this is best effort: the
              operating system may end the app before the write finishes.
            </span>
          </span>
        </label>
      </div>
 
      <div className={`form-field-group ${dimClass}`}>
        <label className="form-label">Disk writes</label>
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={current.skipUnchanged}
            disabled={!current.enabled}
            onChange={(e) => update({ skipUnchanged: e.target.checked })}
          />
          <span>
            Skip project and prefab files that haven't changed
            <span className="hint-text-sm settings-hint-block">
              Avoids rewriting large files for nothing. Turn off to rewrite project.json and every prefab on
              each autosave. A manual save always writes everything.
            </span>
          </span>
        </label>
        <p className="hint-text-sm settings-hint-spaced">
          Scripts are handled separately and are never overwritten blindly: autosave only writes a script
          when the copy in the editor is newer than the file, so edits made in VS Code are kept.
        </p>
      </div>
 
      <button
        type="button"
        className="btn-secondary btn-xs"
        disabled={isDefault}
        onClick={() => onChange?.({ ...AUTOSAVE_DEFAULTS })}
      >
        <RotateCcw size={12} />
        Reset to Defaults
      </button>
    </div>
  );
}