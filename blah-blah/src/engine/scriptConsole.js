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
 *     polluting unrelated app logs. Nested captures are tracked with a
 *     depth counter (see captureConsole) so restoring out of order can
 *     never strand the wrappers on the global console.
 *   - Each entry carries a severity ('log' | 'warn' | 'error'), the
 *     formatted message string, an optional scriptName, and a timestamp.
 *   - Repeated identical consecutive entries (same severity + scriptName +
 *     message) are COLLAPSED into one entry with a `count` — safeCall runs
 *     every frame, so one bug in a canvas script would otherwise flood the
 *     500-entry buffer with identical copies.
 *   - Compile errors are pushed separately via `pushCompileError()` so
 *     they get a distinct 'compile-error' severity and can never be
 *     confused with runtime errors.
 *   - Max 500 entries — oldest drop off to avoid unbounded memory growth.
 *   - `clearConsole()` bumps a "console generation" counter. A still-broken
 *     script re-emits its compile error once when it runs again after a
 *     clear (see scriptRunner.compileScriptModule), so clearing the console
 *     does not permanently hide a real error.
 */

const MAX_ENTRIES = 500;

/** @type {Array<ConsoleEntry>} */
const entries = [];

/**
 * @typedef {{ id: number, severity: 'log'|'warn'|'error'|'compile-error'|'info', message: string, scriptName?: string, ts: number, count: number, generation: number }} ConsoleEntry
 */

let nextId = 1;
const listeners = new Set();

/**
 * Incremented by clearConsole(). Errors remember the generation at which
 * they were last pushed; when a script runs under a newer generation its
 * error is pushed again (once), so a clear is not a permanent loss.
 */
let consoleGeneration = 0;

function notify(entry) {
  listeners.forEach((fn) => fn(entry, [...entries]));
}

function addEntry(entry) {
  // Collapse an identical consecutive entry into the previous one. The
  // ConsolePanel renders the resulting `count` as "×N". Only the LAST entry
  // is compared: two different errors interleaved on separate lines should
  // stay separate, even if their text matches.
  const last = entries[entries.length - 1];
  if (
    last &&
    last.severity === entry.severity &&
    last.scriptName === entry.scriptName &&
    last.message === entry.message
  ) {
    last.count += 1;
    last.ts = entry.ts;
    last.generation = entry.generation;
    notify(last);
    return last;
  }

  entry.count = 1;
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  notify(entry);
  return entry;
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

/** The generation a still-broken script compares against to re-emit once. */
export function getConsoleGeneration() {
  return consoleGeneration;
}

/** Clear all entries. */
export function clearConsole() {
  entries.length = 0;
  // Bump the generation so a later execution of a still-broken script knows
  // its compile error was cleared and re-surfaces it exactly once.
  consoleGeneration += 1;
  listeners.forEach((fn) => fn(null, []));
}

/**
 * Push a structured compile error — called by scriptRunner before even
 * attempting execution, so the panel shows "COMPILE ERROR" in red with
 * full details without ever running bad code.
 */
export function pushCompileError(message, scriptName) {
  return addEntry({
    id: nextId++,
    severity: 'compile-error',
    message,
    scriptName,
    ts: Date.now(),
    generation: consoleGeneration,
  });
}

/**
 * Push a runtime error (thrown inside onMount/onUpdate/etc). Separate from
 * compile errors so the panel can display them differently.
 */
export function pushRuntimeError(message, scriptName) {
  return addEntry({
    id: nextId++,
    severity: 'error',
    message,
    scriptName,
    ts: Date.now(),
    generation: consoleGeneration,
  });
}

/**
 * Push an info message (e.g. "Script loaded OK").
 */
export function pushInfo(message, scriptName) {
  return addEntry({
    id: nextId++,
    severity: 'info',
    message,
    scriptName,
    ts: Date.now(),
    generation: consoleGeneration,
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

// ─── console capture (shared by the sync + async wrappers) ───────────────────
//
// Both withScriptConsole and withScriptConsoleAsync need the exact same
// wrappers; they differ only in whether they await `fn`. Rather than keep
// two ~30-line copies in sync, the capture lives here once. A depth counter
// makes nested captures safe: the true originals are saved only at depth 0
// and restored only when the outermost capture releases, so an inner capture
// finishing first cannot restore the console out from under an outer one.

let captureDepth = 0;
let savedConsole = null;

function captureConsole(scriptName) {
  if (captureDepth === 0) {
    savedConsole = { log: console.log, warn: console.warn, error: console.error };
  }
  captureDepth += 1;

  const record = (severity, args) => {
    addEntry({
      id: nextId++,
      severity,
      message: formatArgs(args),
      scriptName,
      ts: Date.now(),
      generation: consoleGeneration,
    });
  };

  // Forward to the saved originals (not the current console.* — that may
  // already be an outer wrapper, and calling it would double-log).
  console.log = (...args) => { savedConsole.log(...args); record('log', args); };
  console.warn = (...args) => { savedConsole.warn(...args); record('warn', args); };
  console.error = (...args) => { savedConsole.error(...args); record('error', args); };

  return function release() {
    captureDepth = Math.max(0, captureDepth - 1);
    if (captureDepth === 0) {
      console.log = savedConsole.log;
      console.warn = savedConsole.warn;
      console.error = savedConsole.error;
      savedConsole = null;
    }
  };
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
  const release = captureConsole(scriptName);
  try {
    return fn();
  } finally {
    release();
  }
}

/**
 * Async variant of withScriptConsole — wraps an async fn and restores
 * console after the promise settles.
 */
export async function withScriptConsoleAsync(scriptName, fn) {
  const release = captureConsole(scriptName);
  try {
    return await fn();
  } finally {
    release();
  }
}

// ─── global (async + uncaught) error forwarding ──────────────────────────────
//
// Errors thrown by a user script OUTSIDE our try/catch — most commonly a
// rejected promise from an async onMount — never reach withScriptConsole's
// try/finally, so the Console panel would stay silent. These window
// listeners forward them.
//
// Attribution is STRICT: only a stack containing our own
// `blahblah-script:<name>` marker is treated as a script error, and the script
// name is read straight out of that marker. The marker is added to every
// compiled script's evaluated body by runCompiledModule (see scriptRunner.js).
//
// Matching `<anonymous>`, `blob:` or `new Function` instead — the previous
// rule — blamed unrelated browser, worker, Tauri and dockview errors on
// scripts, because those frames appear in plenty of stacks that have nothing to
// do with a script.

const SCRIPT_MARKER_RE = /blahblah-script:([A-Za-z0-9_.-]+)/;
// Legacy fallback only: esbuild's sourcefile name for a script bundle, kept so
// scripts compiled before the marker existed are not silently lost.
const LEGACY_FRAME_RE = /entry\.jsx/;

/**
 * The script a stack belongs to, or null when it is not a script's stack.
 * @returns {string|null}
 */
function scriptNameFromStack(text) {
  const marker = SCRIPT_MARKER_RE.exec(text);
  if (marker) return marker[1];
  return LEGACY_FRAME_RE.test(text) ? 'script' : null;
}

export function installGlobalScriptErrorHandlers() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }

  const onUnhandledRejection = (event) => {
    const reason = event?.reason;
    const text = String(reason?.stack || reason?.message || reason || '');
    const scriptName = scriptNameFromStack(text);
    if (!scriptName) return;
    pushRuntimeError(
      `Unhandled promise rejection in a script:\n${text}`,
      reason?.scriptName || scriptName,
    );
  };

  const onError = (event) => {
    const err = event?.error;
    const text = String(err?.stack || event?.message || '');
    const scriptName = scriptNameFromStack(`${event?.filename || ''} ${text}`);
    if (!scriptName) return;
    pushRuntimeError(`Uncaught error in a script:\n${text}`, err?.scriptName || scriptName);
  };

  window.addEventListener('unhandledrejection', onUnhandledRejection);
  window.addEventListener('error', onError);

  // Returning a disposer lets main.jsx / HMR remove the listeners on reload
  // instead of stacking a new pair on every module evaluation.
  return () => {
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    window.removeEventListener('error', onError);
  };
}
