/**
 * scriptConsole.js — Global script console bus.
 *
 * Intercepts console.log/warn/error calls that originate from inside user
 * script execution and forwards them to any registered listeners (the
 * ConsolePanel UI). Also provides a structured log store so the panel can
 * render history without needing to be mounted when a message fires.
 *
 * Design decisions:
 *   - We do NOT monkey-patch the global console permanently. Instead,
 *     script runners call `withScriptConsole(fn)` which temporarily wraps
 *     console methods, runs `fn`, then restores originals. This avoids
 *     polluting unrelated app logs.
 *   - Each entry carries a severity ('log' | 'warn' | 'error'), the
 *     formatted message string, an optional scriptName, and a timestamp.
 *   - Compile errors are pushed separately via `pushCompileError()` so
 *     they get a distinct 'compile-error' severity and can never be
 *     confused with runtime errors.
 *   - Max 500 entries — oldest drop off to avoid unbounded memory growth.
 */

const MAX_ENTRIES = 500;

/** @type {Array<ConsoleEntry>} */
const entries = [];

/**
 * @typedef {{ id: number, severity: 'log'|'warn'|'error'|'compile-error'|'info', message: string, scriptName?: string, ts: number }} ConsoleEntry
 */

let nextId = 1;
const listeners = new Set();

function addEntry(entry) {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  listeners.forEach((fn) => fn(entry, [...entries]));
}

/** Subscribe to new entries. Returns an unsubscribe function. */
export function subscribeConsole(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Get a snapshot of all current entries. */
export function getConsoleEntries() {
  return [...entries];
}

/** Clear all entries. */
export function clearConsole() {
  entries.length = 0;
  listeners.forEach((fn) => fn(null, []));
}

/**
 * Push a structured compile error — called by scriptRunner before even
 * attempting execution, so the panel shows "COMPILE ERROR" in red with
 * full details without ever running bad code.
 */
export function pushCompileError(message, scriptName) {
  addEntry({
    id: nextId++,
    severity: 'compile-error',
    message,
    scriptName,
    ts: Date.now(),
  });
}

/**
 * Push a runtime error (thrown inside onMount/onUpdate/etc). Separate from
 * compile errors so the panel can display them differently.
 */
export function pushRuntimeError(message, scriptName) {
  addEntry({
    id: nextId++,
    severity: 'error',
    message,
    scriptName,
    ts: Date.now(),
  });
}

/**
 * Push an info message (e.g. "Script loaded OK").
 */
export function pushInfo(message, scriptName) {
  addEntry({
    id: nextId++,
    severity: 'info',
    message,
    scriptName,
    ts: Date.now(),
  });
}

/**
 * Format arbitrary console.log arguments into a single string, matching
 * what a browser devtools console would show.
 */
function formatArgs(args) {
  return args
    .map((a) => {
      if (a === null) return 'null';
      if (a === undefined) return 'undefined';
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a, null, 2);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
}

/**
 * Execute `fn` with console.log/warn/error temporarily redirected to the
 * script console bus. The real methods are still called so browser devtools
 * still show everything — we just also capture them here.
 *
 * @param {string} scriptName  — shown in the console panel next to the entry
 * @param {() => any} fn
 */
export function withScriptConsole(scriptName, fn) {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args) => {
    origLog(...args);
    addEntry({ id: nextId++, severity: 'log', message: formatArgs(args), scriptName, ts: Date.now() });
  };
  console.warn = (...args) => {
    origWarn(...args);
    addEntry({ id: nextId++, severity: 'warn', message: formatArgs(args), scriptName, ts: Date.now() });
  };
  console.error = (...args) => {
    origError(...args);
    addEntry({ id: nextId++, severity: 'error', message: formatArgs(args), scriptName, ts: Date.now() });
  };

  try {
    return fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
}

/**
 * Async variant of withScriptConsole — wraps an async fn and restores
 * console after the promise settles. Used in precompileWithBundler.
 */
export async function withScriptConsoleAsync(scriptName, fn) {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args) => {
    origLog(...args);
    addEntry({ id: nextId++, severity: 'log', message: formatArgs(args), scriptName, ts: Date.now() });
  };
  console.warn = (...args) => {
    origWarn(...args);
    addEntry({ id: nextId++, severity: 'warn', message: formatArgs(args), scriptName, ts: Date.now() });
  };
  console.error = (...args) => {
    origError(...args);
    addEntry({ id: nextId++, severity: 'error', message: formatArgs(args), scriptName, ts: Date.now() });
  };

  try {
    return await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
}
