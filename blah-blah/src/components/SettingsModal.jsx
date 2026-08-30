import { useState, useEffect, useCallback } from 'react';
import { Settings, X, Mic, AlertCircle } from 'lucide-react';
import { loadAudioSettings, saveAudioSettings, listAudioInputDevices } from '../services/audioSettings';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
 
export function SettingsModal({ isOpen, onClose, onSettingsChanged }) {
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
 
  // Start/stop the live level meter while the modal is open.
  useEffect(() => {
    if (isOpen) {
      startMonitoring();
    } else {
      stopMonitoring();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, inputDeviceId]);
 
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
              <p className="modal-subtitle">Audio input device for voice recording</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
 
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
 
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
 