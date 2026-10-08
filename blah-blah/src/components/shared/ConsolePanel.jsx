import { useState, useEffect, useRef, useCallback } from 'react';
import { subscribeConsole, getConsoleEntries, clearConsole } from '../../engine/scriptConsole';
import { Trash2, Terminal, Copy, Check } from 'lucide-react';
import './console-panel.css';

const SEVERITY_LABELS = {
  'compile-error': 'ERROR',
  'error': 'ERROR',
  'warn': 'WARN',
  'log': 'LOG',
  'info': 'INFO',
};

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** One-click copy button — shows a ✓ checkmark for 1.5s after copying. */
function CopyButton({ text, className = '' }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  const handleCopy = useCallback((e) => {
    e.stopPropagation();
    const doCopy = () => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(doCopy).catch(() => {
        fallbackCopy(text);
        doCopy();
      });
    } else {
      fallbackCopy(text);
      doCopy();
    }
  }, [text]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <button
      className={`console-copy-btn ${className}`}
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch { /* ignore */ }
  document.body.removeChild(ta);
}

/**
 * ConsolePanel — dockable script console.
 *
 * Shows compile errors (Rust-style), runtime errors, and console.log/warn/error
 * output from user scripts. Each entry has a one-click copy button so errors
 * can be pasted straight into an AI for fixing.
 */
export function ConsolePanel() {
  const [entries, setEntries] = useState(() => getConsoleEntries());
  const [filter, setFilter] = useState('all'); // 'all' | 'errors' | 'logs'
  const bottomRef = useRef(null);
  const autoScrollRef = useRef(true);
  const containerRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeConsole((_entry, allEntries) => {
      setEntries([...allEntries]);
    });
    return unsub;
  }, []);

  // Auto-scroll to bottom when new entries arrive, unless user scrolled up
  useEffect(() => {
    if (autoScrollRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'instant' });
    }
  }, [entries]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  }, []);

  const handleClear = useCallback(() => {
    clearConsole();
    setEntries([]);
  }, []);

  const filtered = entries.filter((e) => {
    if (filter === 'errors') return e.severity === 'error' || e.severity === 'compile-error';
    if (filter === 'logs') return e.severity === 'log' || e.severity === 'info';
    return true;
  });

  const errorCount = entries.filter((e) => e.severity === 'error' || e.severity === 'compile-error').length;
  const warnCount = entries.filter((e) => e.severity === 'warn').length;

  // Full text of all visible entries for "copy all errors" button in toolbar
  const allText = filtered
    .map((e) => `[${SEVERITY_LABELS[e.severity] || e.severity}]${e.scriptName ? ` [${e.scriptName}]` : ''}\n${e.message}`)
    .join('\n\n---\n\n');

  return (
    <div className="console-panel">
      <div className="console-toolbar">
        <Terminal size={13} className="console-icon" />
        <span className="console-title">Console</span>
        {errorCount > 0 && (
          <span className="console-badge console-badge--error">
            {errorCount} error{errorCount !== 1 ? 's' : ''}
          </span>
        )}
        {warnCount > 0 && (
          <span className="console-badge console-badge--warn">
            {warnCount} warn{warnCount !== 1 ? 's' : ''}
          </span>
        )}

        <div className="console-filters">
          <button
            className={`console-filter-btn${filter === 'all' ? ' is-active' : ''}`}
            onClick={() => setFilter('all')}
          >All</button>
          <button
            className={`console-filter-btn${filter === 'errors' ? ' is-active' : ''}`}
            onClick={() => setFilter('errors')}
          >Errors</button>
          <button
            className={`console-filter-btn${filter === 'logs' ? ' is-active' : ''}`}
            onClick={() => setFilter('logs')}
          >Logs</button>
        </div>

        <div className="console-toolbar-actions">
          {filtered.length > 0 && (
            <CopyButton
              text={allText}
              className="console-copy-all-btn"
            />
          )}
          <button className="console-clear-btn" onClick={handleClear} title="Clear console">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div
        className="console-entries"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {filtered.length === 0 && (
          <div className="console-empty">
            No output yet. Script errors and <code>console.log()</code> will appear here.
          </div>
        )}
        {filtered.map((entry) => (
          <div key={entry.id} className={`console-entry console-entry--${entry.severity}`}>
            <span className="console-entry-time">{formatTime(entry.ts)}</span>
            <span className={`console-entry-level console-entry-level--${entry.severity}`}>
              {SEVERITY_LABELS[entry.severity] || entry.severity.toUpperCase()}
            </span>
            {entry.scriptName && (
              <span className="console-entry-script">[{entry.scriptName}]</span>
            )}
            <pre className="console-entry-msg">{entry.message}</pre>
            <CopyButton text={entry.message} className="console-entry-copy" />
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
