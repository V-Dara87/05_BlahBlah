/**
 * appStorage — the editor's single entry point for localStorage.
 *
 * Why this exists:
 *  - localStorage access can THROW (private browsing, disabled storage, a
 *    sandboxed webview), and the old per-module `try { localStorage... }`
 *    blocks each had to re-discover that;
 *  - a failed write is silent, so settings looked saved but were lost on
 *    reload. Callers now get a boolean back and can fall back to memory;
 *  - JSON.parse + corrupt-value handling is written once instead of in every
 *    settings module.
 *
 * When localStorage is unavailable, values live in a module-level Map for the
 * lifetime of the page, which keeps the UI consistent instead of reverting to
 * defaults on every render.
 */

const memoryFallback = new Map();

function getStore() {
  try {
    if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Reading the property itself can throw when storage is disabled.
  }
  return null;
}

/** The raw string for `key`, or `fallback` when unset/unreadable. */
export function readString(key, fallback = null) {
  const store = getStore();
  if (!store) {
    return memoryFallback.has(key) ? memoryFallback.get(key) : fallback;
  }
  try {
    const value = store.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

/** Writes a string. Returns false when it only reached the memory fallback. */
export function writeString(key, value) {
  const store = getStore();
  if (!store) {
    memoryFallback.set(key, String(value));
    return false;
  }
  try {
    store.setItem(key, String(value));
    return true;
  } catch {
    memoryFallback.set(key, String(value));
    return false;
  }
}

/** Parsed JSON for `key`, or `fallback` when missing/corrupt. */
export function readJson(key, fallback) {
  const raw = readString(key, null);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** Serializes and writes `value`. Returns false when serialization/write failed. */
export function writeJson(key, value) {
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch {
    return false;
  }
  if (raw === undefined) return false;
  return writeString(key, raw);
}

export function removeItem(key) {
  memoryFallback.delete(key);
  const store = getStore();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // Best effort: storage may be read-only.
  }
}

export function hasItem(key) {
  if (memoryFallback.has(key)) return true;
  const store = getStore();
  if (!store) return false;
  try {
    return store.getItem(key) !== null;
  } catch {
    return false;
  }
}

/** Test hook: clears the in-memory fallback so tests don't leak into each other. */
export function clearMemoryFallback() {
  memoryFallback.clear();
}
