/**
 * logger — one leveled logging facade for the editor.
 *
 * The code base used raw console.* calls: no way to silence debug chatter in
 * production, no consistent prefix, and no shared place to route logs later.
 * This keeps the same console output shape but adds:
 *   - levels (debug < info < warn < error < silent),
 *   - a scope prefix, e.g. `[blahblah:bridge]`,
 *   - a per-build default (debug in dev, info in production),
 *   - an override stored in localStorage under `blahblah.logLevel`.
 *
 * Logging must never break the caller: every call is wrapped so a missing
 * console (or a throwing storage implementation) can't reject a save.
 */

import { readString } from './appStorage';

export const LOG_LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
});

const STORAGE_KEY = 'blahblah.logLevel';

function readConfiguredLevel() {
  try {
    const stored = readString(STORAGE_KEY, null);
    return stored && stored in LOG_LEVELS ? stored : null;
  } catch {
    return null;
  }
}

function defaultLevel() {
  try {
    return import.meta.env?.DEV ? 'debug' : 'info';
  } catch {
    return 'info';
  }
}

let currentLevelName = null;

export function getLogLevel() {
  return currentLevelName || readConfiguredLevel() || defaultLevel();
}

export function setLogLevel(level) {
  if (!(level in LOG_LEVELS)) {
    throw new Error(`Unknown log level "${level}". Use one of: ${Object.keys(LOG_LEVELS).join(', ')}.`);
  }
  currentLevelName = level;
}

function shouldLog(level) {
  return LOG_LEVELS[level] >= LOG_LEVELS[getLogLevel()];
}

function write(level, scope, args) {
  if (!shouldLog(level)) return;
  const prefix = scope ? `[blahblah:${scope}]` : '[blahblah]';
  try {
    const method =
      level === 'debug' ? console.debug
        : level === 'info' ? console.info
          : level === 'error' ? console.error
            : console.warn;
    (method || console.log).call(console, prefix, ...args);
  } catch {
    // Logging is best-effort; never let it throw into a render/save path.
  }
}

/**
 * Creates a logger bound to one subsystem. Modules should create one at module
 * scope (`const log = createLogger('persistence')`) rather than passing scopes
 * around.
 */
export function createLogger(scope = '') {
  return {
    debug: (...args) => write('debug', scope, args),
    info: (...args) => write('info', scope, args),
    warn: (...args) => write('warn', scope, args),
    error: (...args) => write('error', scope, args),
    child: (childScope) => createLogger(scope ? `${scope}:${childScope}` : childScope),
  };
}

export const logger = createLogger();
