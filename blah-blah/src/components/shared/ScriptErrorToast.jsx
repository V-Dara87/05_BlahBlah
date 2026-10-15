import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { subscribeConsole, requestConsoleFocus } from '../../engine/scriptConsole';
import { summarizeScriptError } from '../../engine/scriptErrorInfo';
import './script-error-toast.css';
 
/** How long a toast stays before it fades away on its own (ms). */
const TOAST_LIFETIME_MS = 15000;
/** Never stack more than this many at once — the newest win. */
const MAX_TOASTS = 3;
 
const isError = (entry) => entry.severity === 'error' || entry.severity === 'compile-error';
 
/**
 * Corner notice for script errors.
 *
 * The Console is a panel the user has to open themselves, so without this a
 * broken script looks like "the app stopped working". Whenever a script error
 * lands on the console bus this shows "Script error in Arrow.jsx", the plain
 * -language hint when we have one, and a "View details" button that opens the
 * Console with that exact entry highlighted.
 *
 * One toast per script: a newer error from the same script replaces its
 * toast, and a repeating error (the Console collapses those into "×N") only
 * bumps the counter instead of spawning more.
 */
export function ScriptErrorToast() {
  const [toasts, setToasts] = useState([]);
  // Entry ids the user already dismissed (or that already timed out) — a
  // repeat of the same entry must not bring the toast back.
  const dismissedRef = useRef(new Set());
  const timersRef = useRef(new Map());
 
  const dismiss = useCallback((key, entryId) => {
    if (entryId != null) dismissedRef.current.add(entryId);
    const timer = timersRef.current.get(key);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(key);
    setToasts((list) => list.filter((t) => t.key !== key));
  }, []);
 
  const arm = useCallback((key, entryId) => {
    const prev = timersRef.current.get(key);
    if (prev) clearTimeout(prev);
    timersRef.current.set(key, setTimeout(() => dismiss(key, entryId), TOAST_LIFETIME_MS));
  }, [dismiss]);
 
  useEffect(() => {
    const unsub = subscribeConsole((entry) => {
      if (!entry) {
        // Console cleared: nothing left to point at.
        timersRef.current.forEach((t) => clearTimeout(t));
        timersRef.current.clear();
        setToasts([]);
        return;
      }
      if (!isError(entry) || dismissedRef.current.has(entry.id)) return;
 
      const key = entry.scriptName || 'unknown-script';
      const summary = summarizeScriptError(entry.message);
      setToasts((list) => {
        const existing = list.find((t) => t.key === key);
        const next = {
          key,
          entryId: entry.id,
          scriptName: entry.scriptName,
          headline: summary.headline,
          hint: summary.hint,
          location: summary.location,
          count: entry.count || 1,
        };
        // Same entry repeating: keep the toast where it is, just bump ×N.
        if (existing && existing.entryId === entry.id) {
          return list.map((t) => (t.key === key ? next : t));
        }
        const without = list.filter((t) => t.key !== key);
        return [...without, next].slice(-MAX_TOASTS);
      });
      // A brand-new entry restarts the countdown; a repeat of one that is
      // already showing must not, or a per-frame error would never expire.
      if (!timersRef.current.has(key)) arm(key, entry.id);
    });
    const timers = timersRef.current;
    return () => {
      unsub();
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, [arm]);
 
  const handleView = useCallback((toast) => {
    requestConsoleFocus({ entryId: toast.entryId, scriptName: toast.scriptName });
    dismiss(toast.key, toast.entryId);
  }, [dismiss]);
 
  if (toasts.length === 0) return null;
 
  return (
    <div className="script-error-toast-stack" role="region" aria-label="Script errors">
      {toasts.map((t) => (
        <div
          key={t.key}
          className="script-error-toast"
          role="alert"
          // Hovering pauses the countdown so a slow reader is not cut off.
          onMouseEnter={() => {
            const timer = timersRef.current.get(t.key);
            if (timer) clearTimeout(timer);
            timersRef.current.delete(t.key);
          }}
          onMouseLeave={() => arm(t.key, t.entryId)}
        >
          <AlertTriangle size={15} className="script-error-toast-icon" />
          <div className="script-error-toast-body">
            <div className="script-error-toast-title">
              {t.scriptName ? `Script error in ${t.scriptName}` : 'Script error'}
              {t.count > 1 && <span className="script-error-toast-count">×{t.count}</span>}
            </div>
            <div className="script-error-toast-msg" title={t.headline}>{t.hint || t.headline}</div>
            {t.location && <div className="script-error-toast-loc">{t.location}</div>}
            <button type="button" className="script-error-toast-btn" onClick={() => handleView(t)}>
              View details
            </button>
          </div>
          <button
            type="button"
            className="script-error-toast-close"
            onClick={() => dismiss(t.key, t.entryId)}
            aria-label="Dismiss"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}