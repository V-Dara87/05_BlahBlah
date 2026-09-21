import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, RefreshCw, RotateCcw } from 'lucide-react';
import { getFfmpegVersion } from '../../../services/ffmpegRunner';
import { isTauri } from '../../../services/tauriFsAdapter';
import { RESETTABLE_SETTINGS } from './resetAllSettings';

/**
 * System tab — what the app is running on, whether the FFmpeg sidecar works,
 * and the "Reset all settings" escape hatch.
 *
 * Props:
 *   onResetAll  () => string[]   restores every global preference and returns
 *                                the labels that failed (see resetAllSettings.js).
 *                                When omitted the Reset section is hidden.
 */
export function SystemTab({ onResetAll }) {
  const tauriActive = isTauri();
  // Same test ExportModal uses before offering in-browser MP4 export.
  const webCodecsSupported = typeof VideoEncoder !== 'undefined';

  // ---- FFmpeg sidecar ------------------------------------------------------
  const [checking, setChecking] = useState(tauriActive);
  const [ffmpegStatus, setFfmpegStatus] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  // Only the newest check may update state (Check again pressed twice, or the
  // tab closed mid-check).
  const checkIdRef = useRef(0);

  const runFfmpegCheck = useCallback(async () => {
    const id = ++checkIdRef.current;
    setChecking(true);
    setFfmpegStatus(null);
    setErrorMsg(null);
    try {
      const version = await getFfmpegVersion();
      if (id === checkIdRef.current) setFfmpegStatus(version);
    } catch (err) {
      if (id === checkIdRef.current) setErrorMsg(err?.message || String(err));
    } finally {
      if (id === checkIdRef.current) setChecking(false);
    }
  }, []);

  // Check as soon as the tab opens, so the answer is already there. Outside
  // the desktop app there is nothing to check (see the note in the UI).
  useEffect(() => {
    if (!tauriActive) return undefined;
    runFfmpegCheck();
    return () => {
      checkIdRef.current += 1; // invalidate any in-flight check
    };
  }, [tauriActive, runFfmpegCheck]);

  let ffmpegSummary;
  let ffmpegSummaryClass = '';
  if (!tauriActive) {
    ffmpegSummary = 'Desktop app only';
  } else if (checking) {
    ffmpegSummary = 'Checking...';
  } else if (ffmpegStatus) {
    ffmpegSummary = 'Ready';
    ffmpegSummaryClass = 'ok';
  } else {
    ffmpegSummary = 'Not available';
    ffmpegSummaryClass = 'warn';
  }

  // ---- Reset all settings --------------------------------------------------
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetResult, setResetResult] = useState(null); // null | { failed: string[] }

  const handleConfirmReset = () => {
    const failed = onResetAll?.() || [];
    setResetResult({ failed });
    setConfirmingReset(false);
  };

  return (
    <div className="modal-body settings-body">
      <div className="form-field-group">
        <label className="form-label">Runtime Environment</label>
        <dl className="settings-info-list">
          <div className="settings-info-row">
            <dt>App mode</dt>
            <dd className={tauriActive ? 'ok' : ''}>
              {tauriActive ? 'Tauri desktop app (IPC available)' : 'Web browser (IPC unavailable)'}
            </dd>
          </div>
          <div className="settings-info-row">
            <dt>MP4 export (WebCodecs)</dt>
            <dd className={webCodecsSupported ? 'ok' : 'warn'}>
              {webCodecsSupported ? 'Supported' : 'Not supported in this browser'}
            </dd>
          </div>
          <div className="settings-info-row">
            <dt>FFmpeg sidecar</dt>
            <dd className={ffmpegSummaryClass}>{ffmpegSummary}</dd>
          </div>
        </dl>
      </div>

      <div className="form-field-group settings-group-spaced">
        <label className="form-label">FFmpeg Sidecar Status</label>
        <p className="hint-text-sm settings-hint-below">
          Verify that the FFmpeg sidecar binary is bundled, permissioned, and callable end-to-end.
        </p>

        {tauriActive ? (
          <div className="settings-action-row">
            <button type="button" className="btn-secondary btn-xs" onClick={runFfmpegCheck} disabled={checking}>
              <RefreshCw size={12} className={checking ? 'settings-spin' : ''} />
              {checking ? 'Checking FFmpeg...' : 'Check again'}
            </button>
          </div>
        ) : (
          <p className="settings-empty-note">
            The FFmpeg sidecar only exists in the desktop app, so there is nothing to check in a web browser.
          </p>
        )}

        {ffmpegStatus && (
          <div className="modal-alert-box success">
            <CheckCircle2 size={16} />
            <span className="settings-alert-mono">
              {ffmpegStatus}
            </span>
          </div>
        )}

        {errorMsg && (
          <div className="modal-alert-box error">
            <AlertCircle size={16} />
            <span className="settings-alert-text">
              {errorMsg}
            </span>
          </div>
        )}

        <p className="hint-text-sm settings-hint-footnote">
          Target sidecar binary location: <code>src-tauri/binaries/ffmpeg-&lt;target-triple&gt;</code>
        </p>
      </div>

      {onResetAll && (
        <div className="form-field-group settings-group-spaced">
          <label className="form-label">Reset</label>
          <p className="hint-text-sm settings-hint-below">
            Restore every app preference to its default. Your projects, shared library and recent projects are
            never touched.
          </p>

          {confirmingReset ? (
            <div className="modal-alert-box warning shortcut-conflict-box">
              <AlertTriangle size={14} className="settings-alert-icon" />
              <span>
                This resets: {RESETTABLE_SETTINGS.map((s) => s.label).join(', ')}. This can't be undone.
              </span>
              <div className="shortcut-conflict-actions">
                <button type="button" className="btn-secondary btn-xs" onClick={() => setConfirmingReset(false)}>
                  Cancel
                </button>
                <button type="button" className="btn-primary-create btn-xs" onClick={handleConfirmReset}>
                  Reset Settings
                </button>
              </div>
            </div>
          ) : (
            <div className="settings-action-row">
              <button
                type="button"
                className="btn-secondary btn-xs"
                onClick={() => {
                  setResetResult(null);
                  setConfirmingReset(true);
                }}
              >
                <RotateCcw size={12} />
                Reset all settings
              </button>
            </div>
          )}

          {resetResult && resetResult.failed.length === 0 && (
            <div className="modal-alert-box success">
              <CheckCircle2 size={16} />
              <span className="settings-alert-text">All settings were restored to their defaults.</span>
            </div>
          )}

          {resetResult && resetResult.failed.length > 0 && (
            <div className="modal-alert-box error">
              <AlertCircle size={16} />
              <span className="settings-alert-text">
                Could not reset: {resetResult.failed.join(', ')}. The rest were restored.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}