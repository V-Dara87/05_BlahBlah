import { useState, useEffect, useMemo } from 'react';
import { AlertCircle, AlertTriangle, RotateCcw, Pencil, Search } from 'lucide-react';
import {
  SHORTCUT_ACTIONS,
  loadKeybindSettings,
  saveKeybindSettings,
  resetKeybindSettings,
  normalizeKeyEvent,
  findConflict,
  getDefaultBinding,
} from '../../../services/keybindSettings';
 
/**
 * Does a shortcut's key combo match what was typed in the search box?
 *
 * Plain substring matching is wrong for keys: "ctrl+s" is a prefix of
 * "ctrl+shift+z", so searching for Ctrl+S would also list Redo. Instead the
 * query is split into key tokens ("ctrl s" and "ctrl+s" are the same) and:
 *
 *   - one token        matches when any key in the combo starts with it
 *                      ("ctrl" -> every Ctrl shortcut, "f5" -> F5)
 *   - several tokens   match when they are exactly the combo's keys, in any
 *                      order ("ctrl z" -> Ctrl+Z only, not Ctrl+Shift+Z)
 *   - a longer last token ("ctrl+sh") is treated as still being typed and
 *                      matches by prefix, so results narrow as you type
 */
function keyComboMatches(binding, query) {
  const keys = splitKeys(binding, false);
  const tokens = splitKeys(query, true);
  if (keys.length === 0 || tokens.length === 0) return false;

  if (tokens.length === 1) return keys.some((k) => k.startsWith(tokens[0]));

  // Exact combo: same keys, any order.
  if (tokens.length === keys.length && tokens.every((t) => keys.includes(t))) return true;

  // Still typing the last key: earlier tokens exact, last one a prefix.
  const last = tokens[tokens.length - 1];
  if (last.length >= 2) {
    const head = tokens.slice(0, -1);
    const rest = keys.filter((k) => !head.includes(k));
    return head.every((t) => keys.includes(t)) && rest.some((k) => k.startsWith(last));
  }
  return false;
}

/**
 * Split "Ctrl+Shift+Z" (or a typed query like "ctrl shift z") into lowercase
 * key names. "+" is both the separator and a real key, so a trailing "++" (as
 * in "Shift++", the + key) or a lone "+" is read as the plus key. In a search
 * query a single trailing "+" ("ctrl+") just means "still typing", so it is
 * dropped rather than read as a key.
 */
function splitKeys(value, isQuery) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return [];
  if (text === '+') return ['+'];
  const plus = text.endsWith('++');
  const body = plus ? text.slice(0, -2) : text;
  const keys = body.split(isQuery ? /[\s+]+/ : '+').filter(Boolean);
  if (plus) keys.push('+');
  return keys;
}

/**
 * Keyboard Shortcuts tab — lists every rebindable action (grouped, per
 * SHORTCUT_ACTIONS in services/keybindSettings.js), each with its
 * current binding and a "rebind" control. Click a shortcut's key chip to
 * start listening for the next keypress; the very next non-modifier key
 * becomes its new binding. Conflicts with another action are flagged and
 * require confirmation before the old owner is cleared, so a rebind
 * can't silently break a different shortcut.
 *
 * Also: a search box (matches action name, group, or the current key), a
 * count of how many shortcuts differ from their defaults, and a confirmation
 * before "Reset All" so one stray click can't wipe every custom binding.
 */
export function KeyboardShortcutsTab() {
  const [bindings, setBindings] = useState(() => loadKeybindSettings());
  const [listeningFor, setListeningFor] = useState(null); // action id currently capturing a keypress
  const [conflict, setConflict] = useState(null); // { actionId, binding, conflictsWith } awaiting confirmation
  const [confirmingReset, setConfirmingReset] = useState(false); // "Reset All" awaiting confirmation
  const [query, setQuery] = useState('');
 
  const modifiedCount = useMemo(
    () => SHORTCUT_ACTIONS.filter((a) => bindings[a.id] !== a.default).length,
    [bindings]
  );

  // Groups after applying the search box. Matches the action label, its group
  // name, or its CURRENT binding ("ctrl z" and "ctrl+z" both find Ctrl+Z).
  // Groups left with no rows are dropped.
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const byGroup = new Map();
    for (const action of SHORTCUT_ACTIONS) {
      if (needle) {
        const matches =
          action.label.toLowerCase().includes(needle) ||
          action.group.toLowerCase().includes(needle) ||
          keyComboMatches(bindings[action.id], needle);
        if (!matches) continue;
      }
      if (!byGroup.has(action.group)) byGroup.set(action.group, []);
      byGroup.get(action.group).push(action);
    }
    return Array.from(byGroup.entries());
  }, [query, bindings]);
 
  // Captures the next keydown while a rebind is in progress. Attached
  // only while `listeningFor` is set, and stops propagation so it never
  // also triggers EditorPlaybackShortcuts' own listener (which reads
  // localStorage, not this component's in-progress edit) while the user
  // is picking a new key.
  useEffect(() => {
    if (!listeningFor) return;
 
    const handleCapture = (e) => {
      e.preventDefault();
      e.stopPropagation();
 
      if (e.key === 'Escape') {
        setListeningFor(null);
        return;
      }
 
      const binding = normalizeKeyEvent(e);
      if (!binding) return; // bare modifier — keep listening
 
      const conflictsWith = findConflict(bindings, binding, listeningFor);
      if (conflictsWith) {
        setConflict({ actionId: listeningFor, binding, conflictsWith });
        setListeningFor(null);
        return;
      }
 
      commitBinding(listeningFor, binding);
      setListeningFor(null);
    };
 
    window.addEventListener('keydown', handleCapture, true);
    return () => window.removeEventListener('keydown', handleCapture, true);
  }, [listeningFor, bindings]);
 
  const commitBinding = (actionId, binding) => {
    const next = { ...bindings, [actionId]: binding };
    setBindings(next);
    saveKeybindSettings(next);
  };
 
  const handleConfirmConflict = () => {
    if (!conflict) return;
    // Reassign: the new action gets the binding, the old owner is
    // cleared entirely (set to '' — "unbound") rather than left with a
    // duplicate, since two actions sharing one binding would make the
    // reverse-lookup in EditorPlaybackShortcuts ambiguous.
    const next = { ...bindings, [conflict.actionId]: conflict.binding, [conflict.conflictsWith]: '' };
    setBindings(next);
    saveKeybindSettings(next);
    setConflict(null);
  };
 
  const handleResetAll = () => {
    setBindings(resetKeybindSettings());
    setConfirmingReset(false);
  };

  // Opening one confirmation closes the other, and a half-finished rebind is
  // cancelled, so only one prompt is ever on screen.
  const requestResetAll = () => {
    setListeningFor(null);
    setConflict(null);
    setConfirmingReset(true);
  };

  // Typing must never be captured as a new binding, and a row that is being
  // rebound could disappear from the filtered list, so any search activity
  // cancels a pending rebind.
  const handleQueryChange = (e) => {
    setListeningFor(null);
    setQuery(e.target.value);
  };
 
  const handleResetOne = (actionId) => {
    commitBinding(actionId, getDefaultBinding(actionId));
  };
 
  const conflictAction = conflict ? SHORTCUT_ACTIONS.find((a) => a.id === conflict.conflictsWith) : null;
  const rebindingAction = conflict ? SHORTCUT_ACTIONS.find((a) => a.id === conflict.actionId) : null;
 
  return (
    <div className="modal-body settings-body">
      <div className="shortcuts-sticky-top">
        <div className="shortcuts-toolbar">
          <div className="settings-search settings-search-inline">
            <Search size={12} className="settings-search-icon" />
            <input
              type="text"
              className="settings-search-input"
              placeholder="Search by action or key"
              value={query}
              onChange={handleQueryChange}
              onFocus={() => setListeningFor(null)}
              aria-label="Search shortcuts"
            />
          </div>
          <span className={`settings-count-pill ${modifiedCount > 0 ? 'active' : ''}`}>
            {modifiedCount > 0 ? `${modifiedCount} modified` : 'All default'}
          </span>
          <button
            type="button"
            className="btn-secondary btn-xs"
            onClick={requestResetAll}
            disabled={modifiedCount === 0}
            title={modifiedCount === 0 ? 'Every shortcut is already at its default' : 'Restore every shortcut to its default'}
          >
            <RotateCcw size={12} />
            Reset All to Defaults
          </button>
        </div>

        {conflict && (
          <div className="modal-alert-box error shortcut-conflict-box">
            <AlertCircle size={14} />
            <span>
              <strong>{conflict.binding}</strong> is already used by "{conflictAction?.label}". Reassign it to
              "{rebindingAction?.label}"?
            </span>
            <div className="shortcut-conflict-actions">
              <button type="button" className="btn-secondary btn-xs" onClick={() => setConflict(null)}>
                Cancel
              </button>
              <button type="button" className="btn-primary-create btn-xs" onClick={handleConfirmConflict}>
                Reassign
              </button>
            </div>
          </div>
        )}
 

        {confirmingReset && (
          <div className="modal-alert-box warning shortcut-conflict-box">
            <AlertTriangle size={14} className="settings-alert-icon" />
            <span>
              Reset {modifiedCount === 1 ? 'the 1 customized shortcut' : `all ${modifiedCount} customized shortcuts`} to
              their defaults? Your current key assignments will be lost.
            </span>
            <div className="shortcut-conflict-actions">
              <button type="button" className="btn-secondary btn-xs" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary-create btn-xs" onClick={handleResetAll}>
                Reset All
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="hint-text-sm">Click a shortcut to change it, then press a new key combo. Esc cancels.</p>

      {groups.length === 0 && (
        <p className="settings-empty-note">No shortcuts match “{query.trim()}”.</p>
      )}
 
      {groups.map(([groupName, actions]) => (
        <div className="form-field-group shortcut-group" key={groupName}>
          <label className="form-label">{groupName}</label>
          <div className="shortcut-list">
            {actions.map((action) => {
              const binding = bindings[action.id];
              const isListening = listeningFor === action.id;
              const isCustomized = binding !== action.default;
              return (
                <div className="shortcut-row" key={action.id}>
                  <span className="shortcut-row-label">{action.label}</span>
                  <div className="shortcut-row-controls">
                    <button
                      type="button"
                      className={`shortcut-key-chip ${isListening ? 'listening' : ''}`}
                      onClick={() => {
                        setConfirmingReset(false);
                        setListeningFor(action.id);
                      }}
                      title="Click to rebind"
                    >
                      {isListening ? 'Press a key…' : (binding || 'Unbound')}
                      {!isListening && <Pencil size={11} />}
                    </button>
                    {isCustomized && (
                      <button
                        type="button"
                        className="shortcut-reset-btn"
                        title={`Reset to default (${action.default})`}
                        onClick={() => handleResetOne(action.id)}
                      >
                        <RotateCcw size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}