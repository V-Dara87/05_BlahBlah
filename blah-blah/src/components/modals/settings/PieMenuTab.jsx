import { useEffect, useMemo, useState } from 'react';
import { Keyboard, RotateCcw, Trash2, AlertTriangle } from 'lucide-react';
import {
  PIE_ACTIVATE_MODES,
  PIE_DEFAULTS,
  PIE_SLOT_COUNT,
  DEFAULT_PIE_SLOTS,
  formatHotkey,
  hotkeyFromEvent,
  normalizePieSlots,
  resetPieSettings,
} from '../../../services/pieMenuSettings';
import { getPieAction, groupPieActions } from '../../../services/pieActions';
import { loadKeybindSettings, findConflict } from '../../../services/keybindSettings';
import '../../pie/pie-menu.css';

const EMPTY = '__empty__';

// The binding string keybindSettings.js uses ("Ctrl+Alt+Shift+Key"), so the
// pie shortcut can be checked against the editor shortcuts for a clash.
function toKeybindString(h) {
  const parts = [];
  if (h.ctrl) parts.push('Ctrl');
  if (h.alt) parts.push('Alt');
  if (h.shift) parts.push('Shift');
  const k = h.key === ' ' ? 'Space' : h.key;
  parts.push(k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1));
  return parts.join('+');
}

/**
 * Radial Menu tab — the shortcut that opens the wheel, how a slice is
 * confirmed, and which action sits in each of the eight slices. State is owned
 * by App (pieSettings + onChange) and persisted by services/pieMenuSettings.js.
 * Every action offered here comes from services/pieActions.js.
 */
export function PieMenuTab({ settings, onChange }) {
  const current = settings || PIE_DEFAULTS;
  const update = (patch) => onChange?.({ ...current, ...patch });
  const [capturing, setCapturing] = useState(false);

  const slots = useMemo(() => normalizePieSlots(current.slots), [current.slots]);
  const groups = useMemo(() => groupPieActions(), []);
  const keyLabel = formatHotkey(current.hotkey);
  const filled = slots.filter((id) => id && getPieAction(id)).length;

  // Warn when the wheel's shortcut is also an editor shortcut (the wheel wins).
  const clash = useMemo(() => {
    const id = findConflict(loadKeybindSettings(), toKeybindString(current.hotkey), null);
    return id ? getPieAction(id)?.label || id : null;
  }, [current.hotkey]);

  // Record the next key combination as the shortcut. Capture phase + stop so
  // the key does not also reach the editor shortcuts while rebinding.
  useEffect(() => {
    if (!capturing) return undefined;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(false); return; }
      const next = hotkeyFromEvent(e);
      if (!next) return; // bare modifier or a bare letter: keep listening
      update({ hotkey: next });
      setCapturing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, current]);

  const setSlot = (index, value) => {
    const next = slots.slice();
    next[index] = value === EMPTY ? '' : value;
    update({ slots: next });
  };

  const isDefault = JSON.stringify(current) === JSON.stringify(PIE_DEFAULTS);

  return (
    <div className="modal-body settings-body">
      <div className="form-field-group">
        <label className="form-label">Radial menu</label>
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={current.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span>
            Open a wheel of actions at the cursor
            <span className="hint-text-sm settings-hint-block">
              Press <kbd className="pie-kbd">{keyLabel}</kbd> anywhere in the editor (not while typing in a
              field or with a dialog open). Empty slices stay dark and do nothing.
            </span>
          </span>
        </label>
      </div>

      <div className={`form-field-group ${current.enabled ? '' : 'settings-group-dimmed'}`}>
        <label className="form-label">Shortcut</label>
        <div className="settings-action-row">
          <button
            type="button"
            className={`shortcut-key-chip pie-key-btn ${capturing ? 'listening' : ''}`}
            disabled={!current.enabled}
            onClick={() => setCapturing((v) => !v)}
            title="Click to rebind"
          >
            <Keyboard size={12} /> {capturing ? 'Press keys…' : keyLabel}
          </button>
          <button
            type="button"
            className="btn-secondary btn-xs"
            disabled={!current.enabled}
            onClick={() => { setCapturing(false); update({ hotkey: PIE_DEFAULTS.hotkey }); }}
          >
            Reset
          </button>
        </div>
        <p className="hint-text-sm">
          {capturing
            ? 'Press the key combination now. Esc cancels.'
            : 'Click to record. Letters and numbers need Ctrl, Alt or Shift; Tab and F1–F24 work on their own.'}
        </p>
        {clash && (
          <div className="modal-alert-box warning">
            <AlertTriangle size={14} className="settings-alert-icon" />
            <span>
              {keyLabel} is also the shortcut for “{clash}”. The radial menu takes the key, so that
              shortcut stops working. Rebind one of them.
            </span>
          </div>
        )}
      </div>

      <div className={`form-field-group ${current.enabled ? '' : 'settings-group-dimmed'}`}>
        <label className="form-label">Run a slice</label>
        <div className="pie-mode-list" role="radiogroup" aria-label="How a slice runs">
          {PIE_ACTIVATE_MODES.map((m) => (
            <label key={m.id} className={`pie-mode-option ${current.mode === m.id ? 'is-active' : ''}`}>
              <input
                type="radio"
                name="pie-activate-mode"
                value={m.id}
                checked={current.mode === m.id}
                disabled={!current.enabled}
                onChange={() => update({ mode: m.id })}
              />
              <span className="pie-mode-text">
                <span className="pie-mode-label">{m.label}</span>
                <span className="pie-mode-hint">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className={`form-field-group ${current.enabled ? '' : 'settings-group-dimmed'}`}>
        <label className="form-label">Slices</label>
        <div className="settings-action-row">
          <button
            type="button"
            className="btn-secondary btn-xs"
            disabled={!current.enabled}
            onClick={() => update({ slots: DEFAULT_PIE_SLOTS.slice() })}
          >
            <RotateCcw size={12} /> Default slices
          </button>
          <button
            type="button"
            className="btn-secondary btn-xs"
            disabled={!current.enabled}
            onClick={() => update({ slots: new Array(PIE_SLOT_COUNT).fill('') })}
          >
            <Trash2 size={12} /> Clear all
          </button>
        </div>
        <p className="hint-text-sm">
          {filled} of {PIE_SLOT_COUNT} slices filled. Slice 1 is at the top and they go clockwise, so
          you can also press <kbd className="pie-kbd">1</kbd>–<kbd className="pie-kbd">{PIE_SLOT_COUNT}</kbd> while
          the wheel is open.
        </p>

        {slots.map((id, i) => {
          const action = id ? getPieAction(id) : null;
          const value = action ? id : EMPTY;
          return (
            <div className="pie-slot-row" key={i}>
              <span className="pie-slot-index">{i + 1}</span>
              <select
                className="modal-text-input settings-select pie-slot-select"
                value={value}
                disabled={!current.enabled}
                onChange={(e) => setSlot(i, e.target.value)}
                aria-label={`Action for slice ${i + 1}`}
              >
                <option value={EMPTY}>Empty slice</option>
                {groups.map((group) => (
                  <optgroup key={group.name} label={group.name}>
                    {group.items.map((a) => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="pie-slot-hint">{action ? action.hint : ''}</span>
            </div>
          );
        })}
      </div>

      <div className="form-field-group">
        <button
          type="button"
          className="btn-secondary btn-xs"
          disabled={isDefault}
          onClick={() => { setCapturing(false); resetPieSettings(); }}
        >
          <RotateCcw size={12} /> Reset radial menu to defaults
        </button>
      </div>
    </div>
  );
}