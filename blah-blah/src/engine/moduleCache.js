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
 * A synchronous in-memory mirror of the KEYS (and the tiny pin map) is kept so
 * callers on the sync render path can ask "is this key cached?" without
 * awaiting IndexedDB (which is always async). Module SOURCES are not all held
 * in memory: startup only reads the keys, and sources are fetched from
 * IndexedDB on demand into a small size-bounded LRU, so a large package cache
 * no longer costs its full size in RAM on every launch. The IDB layer is
 * deliberately a thin, dumb key/value store — all resolution/compilation logic
 * lives in packageResolver.js / scriptBundler.js.
 *
 * Falls back to memory-only storage when IndexedDB is unavailable (e.g.
 * Node test harnesses, or a browser with it disabled): caching then just
 * lasts for the page session instead of across restarts, which is a
 * graceful degradation, not a failure.
 */

const DB_NAME = 'blahblah-module-cache';
const DB_VERSION = 2;
const MODULES_STORE = 'modules';
const PINS_STORE = 'pins';
// key -> SHA-256 (hex) of the module source, recorded the first time it is
// stored and re-checked every time it is read back from disk.
const HASHES_STORE = 'hashes';

// In-memory mirrors — these are the sync-check source of truth.
const moduleKeyMirror = new Set(); // every cached `${name}@${version}` key
const pinMirror = new Map(); // packageName -> resolved version

// Bounded LRU of module SOURCE text (string length is used as the size
// estimate). With a working IndexedDB, anything evicted is re-read from disk on
// demand. Without IndexedDB (memory-only fallback) nothing is ever evicted,
// because memory is then the only copy.
const MAX_RESIDENT_SOURCE_CHARS = 16 * 1024 * 1024;
const residentSources = new Map(); // key -> source text, oldest first
let residentChars = 0;

function rememberSource(key, text) {
  const previous = residentSources.get(key);
  if (previous !== undefined) {
    residentChars -= previous.length;
    residentSources.delete(key);
  }
  residentSources.set(key, text);
  residentChars += text.length;
  if (!dbPromise) return; // memory-only: this Map is the only copy, never evict
  for (const oldestKey of residentSources.keys()) {
    if (residentChars <= MAX_RESIDENT_SOURCE_CHARS || residentSources.size <= 1) break;
    if (oldestKey === key) continue;
    residentChars -= residentSources.get(oldestKey).length;
    residentSources.delete(oldestKey);
  }
}

function readResidentSource(key) {
  const text = residentSources.get(key);
  if (text === undefined) return undefined;
  residentSources.delete(key); // refresh recency
  residentSources.set(key, text);
  return text;
}

let dbPromise = null;
let cacheReady = null;

/** SHA-256 of a string as lowercase hex, or null when WebCrypto is unavailable. */
async function sha256Hex(text) {
  const subtle = typeof globalThis !== 'undefined' ? globalThis.crypto?.subtle : null;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function idbRequest(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function idbTransactionDone(txn) {
  return new Promise((res, rej) => {
    txn.oncomplete = res;
    txn.onerror = () => rej(txn.error);
    txn.onabort = () => rej(txn.error || new Error('IndexedDB transaction aborted'));
  });
}

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
      if (!db.objectStoreNames.contains(HASHES_STORE)) {
        db.createObjectStore(HASHES_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

/** Load every stored KEY and pin into the in-memory mirrors (once). */
async function loadMirrors(db) {
  const modulesTxn = db.transaction(MODULES_STORE, 'readonly');
  const modulesReq = modulesTxn.objectStore(MODULES_STORE).getAllKeys();
  const keys = await new Promise((res, rej) => {
    modulesReq.onsuccess = () => res(modulesReq.result);
    modulesReq.onerror = () => rej(modulesReq.error);
  });
  keys.forEach((key) => moduleKeyMirror.add(key));

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
  return moduleKeyMirror.has(key);
}

/** Async cached-source read (awaits mirror load). Returns text or null. */
export async function getCachedModuleSource(key) {
  await initModuleCache();
  const resident = readResidentSource(key);
  if (resident !== undefined) return resident;
  if (!dbPromise || !moduleKeyMirror.has(key)) return null;
  try {
    const readTxn = dbPromise.transaction([MODULES_STORE, HASHES_STORE], 'readonly');
    const [text, storedHash] = await Promise.all([
      idbRequest(readTxn.objectStore(MODULES_STORE).get(key)),
      idbRequest(readTxn.objectStore(HASHES_STORE).get(key)),
    ]);
    if (typeof text !== 'string') return null;

    const actualHash = await sha256Hex(text);
    if (actualHash && typeof storedHash === 'string' && storedHash !== actualHash) {
      // The bytes on disk are not the bytes we stored: corrupted or tampered.
      // Drop it so the caller re-fetches instead of running unknown code.
      console.warn(`moduleCache: integrity check failed for "${key}"; discarding cached copy.`);
      await discardCachedModule(key);
      return null;
    }
    if (actualHash && typeof storedHash !== 'string') {
      // Entry written before hashes existed: trust it once and record its hash.
      await storeHash(key, actualHash);
    }
    rememberSource(key, text);
    return text;
  } catch (err) {
    console.warn('moduleCache: failed to read module from IndexedDB:', err);
    return null;
  }
}

async function storeHash(key, hash) {
  if (!dbPromise) return;
  try {
    const txn = dbPromise.transaction(HASHES_STORE, 'readwrite');
    txn.objectStore(HASHES_STORE).put(hash, key);
    await idbTransactionDone(txn);
  } catch (err) {
    console.warn('moduleCache: failed to record module hash:', err);
  }
}

async function discardCachedModule(key) {
  moduleKeyMirror.delete(key);
  const resident = residentSources.get(key);
  if (resident !== undefined) {
    residentChars -= resident.length;
    residentSources.delete(key);
  }
  if (!dbPromise) return;
  try {
    const txn = dbPromise.transaction([MODULES_STORE, HASHES_STORE], 'readwrite');
    txn.objectStore(MODULES_STORE).delete(key);
    txn.objectStore(HASHES_STORE).delete(key);
    await idbTransactionDone(txn);
  } catch (err) {
    console.warn('moduleCache: failed to discard module from IndexedDB:', err);
  }
}

/** Store a fetched module source under `${name}@${version}` (or a chunk path). */
export async function putCachedModuleSource(key, sourceText) {
  await initModuleCache();
  moduleKeyMirror.add(key);
  rememberSource(key, sourceText);
  if (!dbPromise) return;
  try {
    const hash = await sha256Hex(sourceText);
    const txn = dbPromise.transaction([MODULES_STORE, HASHES_STORE], 'readwrite');
    txn.objectStore(MODULES_STORE).put(sourceText, key);
    if (hash) txn.objectStore(HASHES_STORE).put(hash, key);
    else txn.objectStore(HASHES_STORE).delete(key);
    await idbTransactionDone(txn);
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
  moduleKeyMirror.clear();
  residentSources.clear();
  residentChars = 0;
  pinMirror.clear();
  if (!dbPromise) return;
  try {
    const txn = dbPromise.transaction([MODULES_STORE, PINS_STORE, HASHES_STORE], 'readwrite');
    txn.objectStore(MODULES_STORE).clear();
    txn.objectStore(PINS_STORE).clear();
    txn.objectStore(HASHES_STORE).clear();
    await new Promise((res, rej) => {
      txn.oncomplete = res;
      txn.onerror = () => rej(txn.error);
    });
  } catch (err) {
    console.warn('moduleCache: failed to clear IndexedDB:', err);
  }
}