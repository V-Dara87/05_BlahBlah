import { useState, useEffect, useCallback, useMemo } from 'react';
import { Settings, X, Mic, AlertCircle, Keyboard, RotateCcw, Pencil } from 'lucide-react';
import { loadAudioSettings, saveAudioSettings, listAudioInputDevices } from '../services/audioSettings';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import {
  SHORTCUT_ACTIONS,
  loadKeybindSettings,
  saveKeybindSettings,
  resetKeybindSettings,
  normalizeKeyEvent,
  findConflict,
  getDefaultBinding,
} from '../services/keybindSettings';
 
const TABS = [
  { id: 'audio', label: 'Audio', icon: Mic },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
];
 
export function SettingsModal({ isOpen, onClose, onSettingsChanged }) {
  const [activeTab, setActiveTab] = useState('audio');
 
  const [inputDeviceId, setInputDeviceId] = useState('default');
  const [devices, setDevices] = useState([]);
  const [devicesError, setDevicesError] = useState(null);
 
  const { isMonitoring, level, error, startMonitoring, stopMonitoring } = useAudioRecorder({ inputDeviceId });
 
  // Load persisted settings + device list whenever the modal opens.
  useEffect(() => {
    if (!isOpen) return;
 
    const stored = loadAudioSettings();
    setInputDeviceId(stored.inputDeviceId);
 
    (async () => {
      try {
        // Request a throwaway permission grant first so device labels
        // are populated (browsers blank them out until mic access has
        // been granted at least once).
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach((t) => t.stop());
        const list = await listAudioInputDevices();
        setDevices(list);
        setDevicesError(null);
      } catch (err) {
        setDevicesError(err.message || 'Microphone permission was not granted');
      }
    })();
  }, [isOpen]);
 
  // Start/stop the live level meter while the modal is open — and only
  // while the Audio tab is actually visible, so switching to Keyboard
  // Shortcuts doesn't keep the mic hot in the background.
  useEffect(() => {
    if (isOpen && activeTab === 'audio') {
      startMonitoring();
    } else {
      stopMonitoring();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, inputDeviceId]);
 
  const handleDeviceChange = useCallback((e) => {
    const next = e.target.value;
    setInputDeviceId(next);
    const settings = { inputDeviceId: next };
    saveAudioSettings(settings);
    onSettingsChanged?.(settings);
  }, [onSettingsChanged]);
 
  if (!isOpen) return null;
 
  const levelPercent = Math.round(level * 100);
 
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge">
              <Settings size={18} className="text-cyan" />
            </div>
            <div>
              <h3>Settings</h3>
              <p className="modal-subtitle">
                {activeTab === 'audio' ? 'Audio input device for voice recording' : 'Customize your keyboard shortcuts'}
              </p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
 
        <div className="settings-tab-bar">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={`settings-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            );
          })}
        </div>
 
        {activeTab === 'audio' && (
          <div className="modal-body settings-body">
            {(devicesError || error) && (
              <div className="modal-alert-box error">
                <AlertCircle size={14} />
                <span>{devicesError || error}</span>
              </div>
            )}
 
            <div className="form-field-group">
              <label className="form-label">Input Device</label>
              <select
                className="modal-text-input settings-select"
                value={inputDeviceId}
                onChange={handleDeviceChange}
              >
                <option value="default">System Default</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
              </select>
            </div>
 
            <div className="form-field-group">
              <label className="form-label">Mic Level</label>
              <div className="level-meter-row">
                <Mic size={16} className={isMonitoring ? 'text-cyan' : 'text-dim'} />
                <div className="level-meter-track">
                  <div
                    className={`level-meter-fill ${levelPercent > 85 ? 'hot' : ''}`}
                    style={{ width: `${levelPercent}%` }}
                  />
                </div>
                <span className="level-meter-value">{levelPercent}%</span>
              </div>
              <p className="hint-text-sm">
                {isMonitoring ? 'Listening — speak to check your levels.' : 'Requesting microphone access...'}
              </p>
            </div>
          </div>
        )}
 
        {activeTab === 'shortcuts' && <KeyboardShortcutsTab />}
 
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
 
/**
 * Keyboard Shortcuts tab — lists every rebindable action (grouped, per
 * SHORTCUT_ACTIONS in services/keybindSettings.js), each with its
 * current binding and a "rebind" control. Click a shortcut's key chip to
 * start listening for the next keypress; the very next non-modifier key
 * becomes its new binding. Conflicts with another action are flagged and
 * require confirmation before the old owner is cleared, so a rebind
 * can't silently break a different shortcut.
 */
function KeyboardShortcutsTab() {
  const [bindings, setBindings] = useState(() => loadKeybindSettings());
  const [listeningFor, setListeningFor] = useState(null); // action id currently capturing a keypress
  const [conflict, setConflict] = useState(null); // { actionId, binding, conflictsWith } awaiting confirmation
 
  const groups = useMemo(() => {
    const byGroup = new Map();
    for (const action of SHORTCUT_ACTIONS) {
      if (!byGroup.has(action.group)) byGroup.set(action.group, []);
      byGroup.get(action.group).push(action);
    }
    return Array.from(byGroup.entries());
  }, []);
 
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
  };
 
  const handleResetOne = (actionId) => {
    commitBinding(actionId, getDefaultBinding(actionId));
  };
 
  const conflictAction = conflict ? SHORTCUT_ACTIONS.find((a) => a.id === conflict.conflictsWith) : null;
  const rebindingAction = conflict ? SHORTCUT_ACTIONS.find((a) => a.id === conflict.actionId) : null;
 
  return (
    <div className="modal-body settings-body shortcuts-body">
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
 
      <div className="shortcuts-header-row">
        <p className="hint-text-sm">Click a shortcut to change it, then press a new key combo. Esc cancels.</p>
        <button type="button" className="btn-secondary btn-xs" onClick={handleResetAll}>
          <RotateCcw size={12} />
          Reset All to Defaults
        </button>
      </div>
 
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
                      onClick={() => setListeningFor(action.id)}
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