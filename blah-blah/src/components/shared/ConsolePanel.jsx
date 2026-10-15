import { useState, useEffect, useRef, useCallback, useContext, useMemo } from 'react';
import {
  subscribeConsole,
  getConsoleEntries,
  clearConsole,
  getConsoleFocus,
  subscribeConsoleFocus,
  clearConsoleFocus,
  sameScriptName,
} from '../../engine/scriptConsole';
import { getScriptError } from '../../engine/scriptRunner';
import { EditorContext } from '../../dock/EditorContext';
import { explainErrorText, parseErrorBlocks } from '../../engine/scriptErrorInfo';
import { Trash2, Terminal, Copy, Check, Lightbulb, FileCode, FileWarning } from 'lucide-react';
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
 
/**
 * One-click copy button — shows a ✓ checkmark for 1.5s after copying.
 * `text` can be a string or a function returning one, so a big payload (a whole
 * script + errors) is only built when the button is actually clicked.
 */
function CopyButton({ text, className = '', icon: Icon = Copy, title = 'Copy to clipboard', badge = null }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);
 
  const handleCopy = useCallback((e) => {
    e.stopPropagation();
    const payload = typeof text === 'function' ? text() : text;
    const doCopy = () => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(payload).then(doCopy).catch(() => {
        fallbackCopy(payload);
        doCopy();
      });
    } else {
      fallbackCopy(payload);
      doCopy();
    }
  }, [text]);
 
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
 
  return (
    <button
      className={`console-copy-btn ${className}`}
      onClick={handleCopy}
      title={copied ? 'Copied' : title}
    >
      {copied ? <Check size={12} /> : <Icon size={12} />}
      {badge != null && !copied && <span className="console-copy-badge">{badge}</span>}
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
 
const isErrorSeverity = (s) => s === 'error' || s === 'compile-error';
const isLogSeverity = (s) => s === 'log' || s === 'info';
 
const AI_PROMPT = 'Fix the error(s) below. Return the full corrected script.';
const MAX_ERRORS_PER_SCRIPT = 5;
 
/** Markdown fence long enough that backticks inside the code can't close it. */
function fenced(code, lang = 'jsx') {
  const longest = (String(code).match(/`+/g) || []).reduce((m, r) => Math.max(m, r.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${code}\n${fence}`;
}
 
/** The script a console entry belongs to (entries may omit the ".jsx"). */
function findScript(scripts, scriptName) {
  if (!scriptName || !Array.isArray(scripts)) return null;
  return scripts.find((s) => s.name === scriptName)
    || scripts.find((s) => sameScriptName(s.name, scriptName))
    || null;
}
 
/** One entry, ready to paste into an AI: the error plus the script it came from. */
function buildErrorWithScript(entry, script) {
  const kind = entry.severity === 'compile-error' ? 'Compile error' : 'Runtime error';
  return [
    AI_PROMPT,
    '',
    `Script: ${script.name}`,
    `${kind}:`,
    fenced(entry.message, ''),
    '',
    'Script code:',
    fenced(script.code || '', 'jsx'),
  ].join('\n');
}
 
/**
 * Scripts that are broken RIGHT NOW. A compile error only counts while the
 * script's current code still fails to compile (getScriptError is keyed by the
 * code itself, so fixing the script drops it automatically). A runtime error
 * has no such live flag, so it counts while it is still in the console.
 */
function collectBrokenScripts(scripts, entries) {
  if (!Array.isArray(scripts)) return [];
  const broken = [];
  for (const script of scripts) {
    if (!script?.code) continue;
    const compileNow = getScriptError(script.code);
    const own = entries.filter((e) => isErrorSeverity(e.severity) && sameScriptName(e.scriptName, script.name));
    const live = own.filter((e) => e.severity === 'error' || compileNow);
    const messages = [...new Set(live.map((e) => e.message))].slice(-MAX_ERRORS_PER_SCRIPT);
    if (messages.length === 0 && compileNow) {
      const text = typeof compileNow === 'string' ? compileNow : (compileNow.message || String(compileNow));
      messages.push(text);
    }
    if (messages.length > 0) broken.push({ script, messages });
  }
  return broken;
}
 
/** Every currently broken script with its errors, as one paste. */
function buildBrokenScriptsText(broken) {
  const parts = broken.map(({ script, messages }) => [
    `### ${script.name}`,
    messages.length > 1 ? 'Errors:' : 'Error:',
    ...messages.map((m) => fenced(m, '')),
    '',
    'Script code:',
    fenced(script.code || '', 'jsx'),
  ].join('\n'));
  return [AI_PROMPT, '', parts.join('\n\n---\n\n')].join('\n');
}
 
/**
 * ConsolePanel — dockable script console.
 *
 * Shows compile errors (Rust-style), runtime errors, and console.log/warn/error
 * output from user scripts. Each entry has a one-click copy button so errors
 * can be pasted straight into an AI for fixing.
 *
 * All colours live in console-panel.css and resolve to the theme variables, so
 * the panel follows Settings -> Appearance.
 */
export function ConsolePanel({ onOpenScript, scripts: scriptsProp }) {
  // Script sources come from the editor context when the panel is docked in the
  // app. useContext (not useEditorContext) because that hook throws outside the
  // provider, and this panel should still render without it (tests, pop-outs).
  const editorCtx = useContext(EditorContext);
  const scripts = scriptsProp ?? editorCtx?.scripts;
  const [entries, setEntries] = useState(() => getConsoleEntries());
  const [filter, setFilter] = useState('all'); // 'all' | 'errors' | 'logs'
  const bottomRef = useRef(null);
  const autoScrollRef = useRef(true);
  const containerRef = useRef(null);
  // The entry a toast / Inspector badge asked us to point at. Read once on
  // mount too: the request that opened this panel may have fired before it
  // existed.
  const [focusId, setFocusId] = useState(() => getConsoleFocus());
 
  useEffect(() => subscribeConsoleFocus((id) => {
    setFocusId(id);
    // The target might be hidden by the Logs filter — show everything.
    if (id !== null) setFilter('all');
  }), []);
 
  // Scroll the focused entry into view (and stop auto-following the bottom,
  // which would immediately scroll it away again).
  useEffect(() => {
    if (focusId === null) return;
    const el = containerRef.current?.querySelector(`[data-entry-id="${focusId}"]`);
    if (el) {
      autoScrollRef.current = false;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, [focusId, entries]);
 
  const handleEntriesClick = useCallback(() => {
    if (focusId !== null) clearConsoleFocus();
  }, [focusId]);
 
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
    if (filter === 'errors') return isErrorSeverity(e.severity);
    if (filter === 'logs') return isLogSeverity(e.severity);
    return true;
  });
 
  const brokenScripts = useMemo(() => collectBrokenScripts(scripts, entries), [scripts, entries]);
 
  const errorCount = entries.filter((e) => isErrorSeverity(e.severity)).length;
  const warnCount = entries.filter((e) => e.severity === 'warn').length;
  const logCount = entries.filter((e) => isLogSeverity(e.severity)).length;
 
  // Full text of all visible entries for "copy all errors" button in toolbar
  const allText = filtered
    .map((e) => `[${SEVERITY_LABELS[e.severity] || e.severity}]${e.scriptName ? ` [${e.scriptName}]` : ''}\n${e.message}`)
    .join('\n\n---\n\n');
 
  const filterButtons = [
    { id: 'all', label: 'All', count: entries.length },
    { id: 'errors', label: 'Errors', count: errorCount },
    { id: 'logs', label: 'Logs', count: logCount },
  ];
 
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
 
        <div className="console-filters" role="tablist" aria-label="Console filter">
          {filterButtons.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              className={`console-filter-btn${filter === f.id ? ' is-active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {f.count > 0 && <span className="console-filter-count">{f.count}</span>}
            </button>
          ))}
        </div>
 
        <div className="console-toolbar-actions">
          {brokenScripts.length > 0 && (
            <CopyButton
              text={() => buildBrokenScriptsText(brokenScripts)}
              className="console-ai-btn console-broken-btn"
              icon={FileWarning}
              badge={brokenScripts.length}
              title={`Copy ${brokenScripts.length} broken script${brokenScripts.length !== 1 ? 's' : ''} + their errors (for AI)`}
            />
          )}
          {filtered.length > 0 && (
            <CopyButton
              text={allText}
              className="console-copy-all-btn"
              title="Copy all visible entries"
            />
          )}
          <button className="console-clear-btn" onClick={handleClear} title="Clear console">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
 
      <div
        className="console-entries"
        ref={containerRef}
        onScroll={handleScroll}
        onClick={handleEntriesClick}
      >
        {filtered.length === 0 && (
          <div className="console-empty">
            <Terminal size={22} />
            <span>
              No output yet. Script errors and <code>console.log()</code> will appear here.
            </span>
          </div>
        )}
        {filtered.map((entry) => {
          const isError = isErrorSeverity(entry.severity);
          const entryScript = isError ? findScript(scripts, entry.scriptName) : null;
          // One plain-language line under the raw message for common mistakes.
          const hint = isError ? explainErrorText(parseErrorBlocks(entry.message)[0]?.text) || explainErrorText(entry.message) : null;
          return (
          <div
            key={entry.id}
            data-entry-id={entry.id}
            className={`console-entry console-entry--${entry.severity}${entry.id === focusId ? ' is-focused' : ''}`}
          >
            <span className="console-entry-time">{formatTime(entry.ts)}</span>
            <span className={`console-entry-level console-entry-level--${entry.severity}`}>
              {SEVERITY_LABELS[entry.severity] || entry.severity.toUpperCase()}
            </span>
            {entry.scriptName && (
              onOpenScript ? (
                <button
                  type="button"
                  className="console-entry-script console-entry-script--link"
                  onClick={(e) => { e.stopPropagation(); onOpenScript(entry.scriptName); }}
                  title={`Open ${entry.scriptName} in the script editor`}
                >
                  {entry.scriptName}
                </button>
              ) : (
                <span className="console-entry-script">{entry.scriptName}</span>
              )
            )}
            {entry.count > 1 && (
              <span className="console-entry-count" title={`Repeated ${entry.count} times`}>
                ×{entry.count}
              </span>
            )}
            <div className="console-entry-body">
              {hint && (
                <div className="console-entry-hint">
                  <Lightbulb size={12} />
                  <span>{hint}</span>
                </div>
              )}
              <pre className="console-entry-msg">{entry.message}</pre>
            </div>
            {entryScript && (
              <CopyButton
                text={() => buildErrorWithScript(entry, entryScript)}
                className="console-entry-copy console-ai-btn"
                icon={FileCode}
                title="Copy error + script (for AI)"
              />
            )}
            <CopyButton text={entry.message} className="console-entry-copy" title="Copy error only" />
          </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
 