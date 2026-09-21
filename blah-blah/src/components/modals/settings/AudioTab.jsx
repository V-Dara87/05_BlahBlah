import { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { loadAudioSettings, saveAudioSettings, listAudioInputDevices } from '../../../services/audioSettings';
import { useAudioRecorder } from '../../../hooks/useAudioRecorder';

/**
 * Turns the browser's microphone error into something a person can act on.
 * The raw messages ("Permission denied", "Requested device not found") are
 * terse and differ between Chrome, Firefox and WebView2, so we key off the
 * standard DOMException `name` instead.
 */
function describeMicError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was blocked. Allow microphone access for this app in your system or browser settings, then press Retry.';
    case 'NotFoundError':
      return 'No microphone was found. Plug one in, then press Retry.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone could not be opened. It may be in use by another app. Close that app, then press Retry.';
    case 'OverconstrainedError':
      return 'The selected microphone is not available. Choose another input device.';
    default:
      return err?.message || 'Microphone permission was not granted';
  }
}

/**
 * Audio tab — picks the microphone input device and shows a live level meter.
 *
 * This component only exists while the Audio tab is the visible one, so:
 *  - the device list / saved device load on mount, and
 *  - the level meter starts on mount and is released on unmount. useAudioRecorder
 *    already closes its stream when its host component unmounts, so leaving this
 *    tab (or closing the modal) still turns the mic off.
 *
 * Status the person can see (never a permanent "Requesting..."):
 *  - listening       meter is live
 *  - requesting      brief, while the browser/OS answers the permission prompt
 *  - blocked/failed  a specific message + a Retry button
 *  - saved mic gone  the remembered device is not plugged in; one click falls
 *                    back to System Default
 */
export function AudioTab({ onSettingsChanged }) {
  const [inputDeviceId, setInputDeviceId] = useState('default');
  const [devices, setDevices] = useState([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState(null);

  const { isMonitoring, level, error, startMonitoring, stopMonitoring } = useAudioRecorder({ inputDeviceId });

  // Only the newest device request may update state, so a slow earlier
  // request can never overwrite a fresher list (Refresh pressed twice, etc.).
  const latestLoadRef = useRef(0);

  const loadDevices = useCallback(async () => {
    const requestId = ++latestLoadRef.current;
    setDevicesLoading(true);
    try {
      // Request a throwaway permission grant first so device labels
      // are populated (browsers blank them out until mic access has
      // been granted at least once).
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach((t) => t.stop());
      const list = await listAudioInputDevices();
      if (requestId !== latestLoadRef.current) return;
      setDevices(list);
      setDevicesLoaded(true);
      setDevicesError(null);
    } catch (err) {
      if (requestId !== latestLoadRef.current) return;
      setDevicesError(describeMicError(err));
    } finally {
      if (requestId === latestLoadRef.current) setDevicesLoading(false);
    }
  }, []);

  // Load persisted settings + device list when the tab opens.
  useEffect(() => {
    setInputDeviceId(loadAudioSettings().inputDeviceId);
    loadDevices();
  }, [loadDevices]);

  // Start/stop the live level meter for the selected device. Mounted only
  // while the Audio tab is visible, so switching to another tab doesn't keep
  // the mic hot in the background.
  useEffect(() => {
    startMonitoring();
    return () => stopMonitoring();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputDeviceId]);

  const selectDevice = useCallback((next) => {
    setInputDeviceId(next);
    const settings = { inputDeviceId: next };
    saveAudioSettings(settings);
    onSettingsChanged?.(settings);
  }, [onSettingsChanged]);

  const handleDeviceChange = useCallback((e) => selectDevice(e.target.value), [selectDevice]);

  // Retry both halves: ask for permission / re-list devices, and reopen the meter.
  const handleRetry = useCallback(() => {
    loadDevices();
    startMonitoring();
  }, [loadDevices, startMonitoring]);

  // A remembered device that is no longer connected. Only judged once the
  // device list has actually loaded, so it never flashes during startup.
  const savedDeviceMissing =
    devicesLoaded &&
    inputDeviceId !== 'default' &&
    !devices.some((d) => d.deviceId === inputDeviceId);

  // The raw meter error is just a side effect of the missing device, so the
  // dedicated warning replaces it instead of stacking two alerts.
  const problem = savedDeviceMissing ? null : (devicesError || error);

  const levelPercent = Math.round(level * 100);

  let statusHint;
  if (problem || savedDeviceMissing) statusHint = 'Level meter paused.';
  else if (isMonitoring) statusHint = 'Listening — speak to check your levels.';
  else statusHint = 'Requesting microphone access...';

  return (
    <div className="modal-body settings-body">
      {problem && (
        <div className="modal-alert-box error">
          <AlertCircle size={14} className="settings-alert-icon" />
          <span className="settings-alert-text">{problem}</span>
          <button type="button" className="btn-secondary btn-xs settings-alert-action" onClick={handleRetry}>
            <RefreshCw size={11} />
            Retry
          </button>
        </div>
      )}

      {savedDeviceMissing && (
        <div className="modal-alert-box warning">
          <AlertTriangle size={14} className="settings-alert-icon" />
          <span className="settings-alert-text">
            Your saved microphone isn't connected. Recording will fail until you pick another input or
            reconnect it.
          </span>
          <button
            type="button"
            className="btn-secondary btn-xs settings-alert-action"
            onClick={() => selectDevice('default')}
          >
            Use System Default
          </button>
        </div>
      )}

      <div className="form-field-group">
        <label className="form-label" htmlFor="settings-input-device">Input Device</label>
        <div className="settings-field-row">
          <select
            id="settings-input-device"
            className="modal-text-input settings-select"
            value={inputDeviceId}
            onChange={handleDeviceChange}
          >
            <option value="default">System Default</option>
            {savedDeviceMissing && <option value={inputDeviceId}>Saved microphone (not connected)</option>}
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn-secondary btn-xs settings-refresh-btn"
            onClick={loadDevices}
            disabled={devicesLoading}
            title="Look for newly connected microphones"
          >
            <RefreshCw size={12} className={devicesLoading ? 'settings-spin' : ''} />
            Refresh
          </button>
        </div>
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
        <p className="hint-text-sm">{statusHint}</p>
      </div>
    </div>
  );
}