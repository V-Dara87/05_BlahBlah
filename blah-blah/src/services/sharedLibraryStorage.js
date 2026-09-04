/**
 * App-wide Shared Library storage — prefabs & scripts that live OUTSIDE any
 * single project directory so they persist across every project (Feature 2:
 * the app-wide shared folder). Nothing here touches the File System Access
 * project handle: storage is browser-side only.
 *
 *   interface SharedItem {
 *     id: string;
 *     name: string;
 *     type: 'prefab' | 'script';
 *     data: any;        // prefab JSON (project-prefab shape) or script
 *                       // { name, code, description }
 *     createdAt: number;
 *   }
 *
 * Backend: IndexedDB when available (the Tauri webview and all modern
 * browsers have it), with a transparent localStorage fallback so the app
 * still works in environments where IndexedDB is unavailable or throws
 * (private browsing, storage-disabled webviews). localStorage shares the
 * same record shape (the whole item list under one key), so the two
 * backends are drop-in replacements for each other.
 */
const LS_KEY = 'blahblah.sharedLibrary.v1';
const DB_NAME = 'blahblah-shared-library';
const DB_VERSION = 1;
const DB_STORE = 'items';

const hasIndexedDB = () => typeof indexedDB !== 'undefined' && indexedDB !== null;

// ─── IndexedDB plumbing ─────────────────────────────────────────────────────

let dbPromise = null;

/** Open (once) the shared-library database; resolves null on any failure. */
function openDb() {
  if (!hasIndexedDB()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** Read the whole item list out of IndexedDB (empty on failure). */
async function idbList() {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Write the whole item list into IndexedDB. */
async function idbWriteAll(items) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      store.clear();
      for (const item of items) store.put(item);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

// ─── localStorage fallback ──────────────────────────────────────────────────

function lsList() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function lsWriteAll(items) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false; // quota/disabled — shared library silently unavailable
  }
}

// ─── Public API (all async, all promise-based, never reject) ────────────────

async function mutate(mutator) {
  // Try IndexedDB first; on ANY failure fall back to localStorage, and
  // finally to the in-memory list so the UI stays consistent even when
  // both persistence backends are unavailable.
  const idbItems = await idbList();
  const items = idbItems !== null ? idbItems : lsList();
  const next = mutator(items);
  if (idbItems !== null) {
    if (await idbWriteAll(next)) return next;
  }
  if (lsWriteAll(next)) return next;
  return next; // last resort: keep this session's list in memory only
}

/** @returns {Promise<SharedItem[]>} every item in the shared library. */
export function listSharedItems() {
  return idbList().then((items) => (items !== null ? items : lsList()));
}

/** Add one item (or overwrite by id). Resolves the updated full list. */
export function addSharedItem(item) {
  return mutate((items) => [
    ...items.filter((i) => i.id !== item?.id),
    item,
  ]);
}

/** Remove an item by id. Resolves the updated full list. */
export function removeSharedItem(id) {
  return mutate((items) => items.filter((i) => i.id !== id));
}

/** Convenience: build a prefab SharedItem (not yet stored). */
export function makeSharedPrefabItem(prefab) {
  return {
    id: `shared-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: prefab?.name || 'Prefab',
    type: 'prefab',
    data: JSON.parse(JSON.stringify(prefab || {})),
    createdAt: Date.now(),
  };
}

/** Convenience: build a script SharedItem (not yet stored). */
export function makeSharedScriptItem(script) {
  return {
    id: `shared-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: script?.name || 'Script',
    type: 'script',
    data: {
      name: script?.name || 'Script',
      description: script?.description,
      code: script?.code || '',
    },
    createdAt: Date.now(),
  };
}
