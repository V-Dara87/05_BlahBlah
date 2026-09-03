/**
 * Persistent cache for fetched npm-package ESM sources (the "offline after
 * first use" half of real `import` support).
 *
 * Storage: IndexedDB, one object store (`modules`) keyed by
 * `${packageName}@${resolvedVersion}` (plus a second tiny store, `pins`,
 * mapping a bare package name -> the resolved version it was first fetched
 * at, so a script's `import 'three'` keeps resolving to the SAME version
 * forever after — no surprise upgrades, and it works with the network off
 * once the first fetch has landed).
 *
 * A synchronous in-memory mirror of both stores is kept so callers on the
 * sync render path can ask "is this key cached?" without awaiting IndexedDB
 * (which is always async). The IDB layer is deliberately a thin, dumb
 * key/value store — all resolution/compilation logic lives in
 * packageResolver.js / scriptBundler.js.
 *
 * Falls back to memory-only storage when IndexedDB is unavailable (e.g.
 * Node test harnesses, or a browser with it disabled): caching then just
 * lasts for the page session instead of across restarts, which is a
 * graceful degradation, not a failure.
 */

const DB_NAME = 'blahblah-module-cache';
const DB_VERSION = 1;
const MODULES_STORE = 'modules';
const PINS_STORE = 'pins';

// In-memory mirrors — these are the sync-check source of truth.
const moduleSourceMirror = new Map(); // `${name}@${version}` -> source text
const pinMirror = new Map(); // packageName -> resolved version

let dbPromise = null;
let cacheReady = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MODULES_STORE)) {
        db.createObjectStore(MODULES_STORE); // keyPath-less, keyed by explicit key
      }
      if (!db.objectStoreNames.contains(PINS_STORE)) {
        db.createObjectStore(PINS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

/** Load every stored record into the in-memory mirrors (once). */
async function loadMirrors(db) {
  const modulesTxn = db.transaction(MODULES_STORE, 'readonly');
  const modulesReq = modulesTxn.objectStore(MODULES_STORE).getAllKeys();
  const modulesValuesReq = modulesTxn.objectStore(MODULES_STORE).getAll();
  const [keys, values] = await Promise.all([
    new Promise((res, rej) => {
      modulesReq.onsuccess = () => res(modulesReq.result);
      modulesReq.onerror = () => rej(modulesReq.error);
    }),
    new Promise((res, rej) => {
      modulesValuesReq.onsuccess = () => res(modulesValuesReq.result);
      modulesValuesReq.onerror = () => rej(modulesValuesReq.error);
    }),
  ]);
  keys.forEach((key, i) => moduleSourceMirror.set(key, values[i]));

  const pinsTxn = db.transaction(PINS_STORE, 'readonly');
  const pinsReq = pinsTxn.objectStore(PINS_STORE).getAllKeys();
  const pinsValuesReq = pinsTxn.objectStore(PINS_STORE).getAll();
  const [pinKeys, pinValues] = await Promise.all([
    new Promise((res, rej) => {
      pinsReq.onsuccess = () => res(pinsReq.result);
      pinsReq.onerror = () => rej(pinsReq.error);
    }),
    new Promise((res, rej) => {
      pinsValuesReq.onsuccess = () => res(pinsValuesReq.result);
      pinsValuesReq.onerror = () => rej(pinsValuesReq.error);
    }),
  ]);
  pinKeys.forEach((key, i) => pinMirror.set(key, pinValues[i]));
}

/**
 * Ensure the cache is open and mirrors are loaded. Safe to call many times;
 * resolves once. Never rejects — IndexedDB failures fall back to
 * memory-only caching rather than breaking script compilation.
 */
export function initModuleCache() {
  if (cacheReady) return cacheReady;
  cacheReady = (async () => {
    if (typeof indexedDB === 'undefined' || typeof window === 'undefined') {
      // Memory-only backend (Node tests, restricted browsers).
      return;
    }
    try {
      const db = await openDb();
      dbPromise = db;
      await loadMirrors(db);
    } catch (err) {
      console.warn('moduleCache: IndexedDB unavailable, using in-memory cache only:', err);
      dbPromise = null;
    }
  })();
  return cacheReady;
}

/**
 * Synchronous cached-source check. Only meaningful after
 * `await initModuleCache()` has resolved at least once.
 */
export function hasCachedModuleSource(key) {
  return moduleSourceMirror.has(key);
}

/** Async cached-source read (awaits mirror load). Returns text or null. */
export async function getCachedModuleSource(key) {
  await initModuleCache();
  return moduleSourceMirror.get(key) ?? null;
}

/** Store a fetched module source under `${name}@${version}` (or a chunk path). */
export async function putCachedModuleSource(key, sourceText) {
  await initModuleCache();
  moduleSourceMirror.set(key, sourceText);
  if (!dbPromise) return;
  try {
    const txn = dbPromise.transaction(MODULES_STORE, 'readwrite');
    txn.objectStore(MODULES_STORE).put(sourceText, key);
    await new Promise((res, rej) => {
      txn.oncomplete = res;
      txn.onerror = () => rej(txn.error);
    });
  } catch (err) {
    console.warn('moduleCache: failed to persist module to IndexedDB:', err);
  }
}

/** Synchronous pinned-version lookup for a bare package name. */
export function getPinnedPackageVersion(packageName) {
  return pinMirror.get(packageName) ?? null;
}

/** Record that a bare import of `packageName` resolved to `version`. */
export async function pinPackageVersion(packageName, version) {
  if (!packageName || !version) return;
  await initModuleCache();
  pinMirror.set(packageName, version);
  if (!dbPromise) return;
  try {
    const txn = dbPromise.transaction(PINS_STORE, 'readwrite');
    txn.objectStore(PINS_STORE).put(version, packageName);
    await new Promise((res, rej) => {
      txn.oncomplete = res;
      txn.onerror = () => rej(txn.error);
    });
  } catch (err) {
    console.warn('moduleCache: failed to persist version pin to IndexedDB:', err);
  }
}

/** Clear every cached module + pin (used by tests and future "clear cache" UI). */
export async function clearModuleCache() {
  await initModuleCache();
  moduleSourceMirror.clear();
  pinMirror.clear();
  if (!dbPromise) return;
  try {
    const txn = dbPromise.transaction([MODULES_STORE, PINS_STORE], 'readwrite');
    txn.objectStore(MODULES_STORE).clear();
    txn.objectStore(PINS_STORE).clear();
    await new Promise((res, rej) => {
      txn.oncomplete = res;
      txn.onerror = () => rej(txn.error);
    });
  } catch (err) {
    console.warn('moduleCache: failed to clear IndexedDB:', err);
  }
}