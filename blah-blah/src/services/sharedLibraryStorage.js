/**
 * App-wide Shared Library storage — prefabs, scripts & media that live OUTSIDE any
 * single project directory so they persist across every project (Feature 2:
 * the app-wide shared folder). Nothing here touches the File System Access
 * project handle: storage is browser-side only.
 *
 *   interface SharedItem {
 *     id: string;
 *     name: string;
 *     type: 'prefab' | 'script' | 'media';
 *     data: any;        // prefab JSON (project-prefab shape), script
 *                       // { name, code, description, deps }, or media
 *                       // { blob, mediaType: 'video'|'audio', duration,
 *                       //   size, mimeType }. The Blob itself is stored
 *                       // (IndexedDB structured-clones Blobs) because a
 *                       // blob:/asset URL would not survive a reload.
 *                       // script `deps` = [{ name, code }]: sibling scripts
 *                       // the script imports, copied along with it.
 *     hash?: string;    // content hash of a script's code / a prefab's JSON
 *                       // (see sharedLibraryDeps.hashText). Lets the app tell
 *                       // "library changed" from "my copy changed".
 *     createdAt: number;
 *     folder?: string;  // optional one-level subfolder name within the
 *                       // Shared Library section (same model as project
 *                       // media/prefabs/scripts — see ProjectPanel.jsx)
 *   }
 *
 * Backend: IndexedDB when available (the Tauri webview and all modern
 * browsers have it), with a transparent localStorage fallback so the app
 * still works in environments where IndexedDB is unavailable or throws
 * (private browsing, storage-disabled webviews). localStorage shares the
 * same record shape (the whole item list under one key), so the two
 * backends are drop-in replacements for each other.
 *
 * IndexedDB writes touch ONLY the item that changed (put / delete). The old
 * version cleared the whole store and rewrote every item — including every
 * media Blob — on each rename/move/share, which got slower as media was added
 * and let two quick writes (e.g. sharing a multi-selection) overwrite each
 * other. getStorageBackend() reports where the last write actually landed so
 * callers can warn when something was NOT persisted.
 *
 * The file also holds backup helpers: serializeLibrary / parseLibrary turn the
 * library into a single JSON file (media as base64) and back, and planImport
 * decides what an imported file adds.
 */
import { baseName, hashText } from './sharedLibraryDeps.js';

const LS_KEY = 'blahblah.sharedLibrary.v1';
const DB_NAME = 'blahblah-shared-library';
const DB_VERSION = 1;
const DB_STORE = 'items';

export const LIBRARY_FILE_FORMAT = 'blahblah-shared-library';
export const LIBRARY_FILE_VERSION = 1;

const hasIndexedDB = () => typeof indexedDB !== 'undefined' && indexedDB !== null;

// 'indexeddb' = fully persisted · 'localstorage' = persisted, but media can't be
// · 'memory' = nothing persisted, this session only.
let backend = 'indexeddb';

/** Where the most recent read/write landed. */
export function getStorageBackend() {
  return backend;
}

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

/** Read the whole item list out of IndexedDB (null when IndexedDB is unusable). */
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

/** Insert/overwrite items (one transaction). Resolves true on success. */
async function idbPutMany(items) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      for (const item of items) store.put(item);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** Delete one item by id. Resolves true on success. */
async function idbDelete(id) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
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
    // A Blob JSON-stringifies to "{}", which would persist a silently broken
    // media item. The fallback can't hold binary data, so media is left out
    // of it (media sharing simply needs IndexedDB, which every real target
    // — the Tauri webview and modern browsers — has).
    const storable = items.filter((i) => i?.type !== 'media');
    localStorage.setItem(LS_KEY, JSON.stringify(storable));
    return true;
  } catch {
    return false; // quota/disabled — shared library silently unavailable
  }
}

// ─── Public API (all async, all promise-based, never reject) ────────────────

/**
 * Apply one change. `idbOp` is the targeted IndexedDB write; `mutator` is the
 * same change as a pure list transform, used for the localStorage fallback
 * and as the last-resort in-memory result. Resolves the updated full list.
 */
async function commit(idbOp, mutator) {
  const idbItems = await idbList();
  if (idbItems !== null && (await idbOp(idbItems))) {
    backend = 'indexeddb';
    return (await idbList()) ?? mutator(idbItems);
  }
  const items = idbItems !== null ? idbItems : lsList();
  const next = mutator(items);
  backend = lsWriteAll(next) ? 'localstorage' : 'memory'; // 'memory': this session's list only
  return next;
}

/** @returns {Promise<SharedItem[]>} every item in the shared library. */
export function listSharedItems() {
  return idbList().then((items) => {
    if (items !== null) {
      backend = 'indexeddb';
      return items;
    }
    backend = 'localstorage';
    return lsList();
  });
}

/** Add one item (or overwrite by id). Resolves the updated full list. */
export function addSharedItem(item) {
  return addSharedItems([item]);
}

/** Add/overwrite several items at once (one write). Resolves the full list. */
export function addSharedItems(newItems) {
  const list = (newItems || []).filter(Boolean);
  const ids = new Set(list.map((i) => i.id));
  return commit(
    () => idbPutMany(list),
    (items) => [...items.filter((i) => !ids.has(i.id)), ...list]
  );
}

/** Remove an item by id. Resolves the updated full list. */
export function removeSharedItem(id) {
  return commit(
    () => idbDelete(id),
    (items) => items.filter((i) => i.id !== id)
  );
}

/**
 * Move an item into a folder (or back to root when folderName is null).
 * Resolves the updated full list. No-op if the id isn't found.
 */
export function moveSharedItem(id, folderName) {
  const change = (i) => ({ ...i, folder: folderName || undefined });
  return commit(
    (items) => {
      const hit = items.find((i) => i.id === id);
      return hit ? idbPutMany([change(hit)]) : true;
    },
    (items) => items.map((i) => (i.id === id ? change(i) : i))
  );
}

/**
 * Rename every item in one folder to live in another (used for folder
 * rename/delete, same "move contents" semantics as project folders).
 * Pass toFolder = null to move everything back to root.
 */
export function moveAllSharedItemsInFolder(fromFolder, toFolder) {
  const change = (i) => ({ ...i, folder: toFolder || undefined });
  return commit(
    (items) => idbPutMany(items.filter((i) => i.folder === fromFolder).map(change)),
    (items) => items.map((i) => (i.folder === fromFolder ? change(i) : i))
  );
}

const newId = () => `shared-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Convenience: build a prefab SharedItem (not yet stored). */
export function makeSharedPrefabItem(prefab) {
  const data = JSON.parse(JSON.stringify(prefab || {}));
  return {
    id: newId(),
    name: prefab?.name || 'Prefab',
    type: 'prefab',
    data,
    hash: hashText(JSON.stringify(data)),
    createdAt: Date.now(),
  };
}

/**
 * Convenience: build a media SharedItem (not yet stored).
 * @param {{ name: string, type: 'video'|'audio', duration?: number, size?: number }} asset
 * @param {Blob} blob  the file's actual bytes
 */
export function makeSharedMediaItem(asset, blob) {
  return {
    id: newId(),
    name: asset?.name || 'Media',
    type: 'media',
    data: {
      blob,
      mediaType: asset?.type === 'video' ? 'video' : 'audio',
      duration: asset?.duration,
      size: blob?.size ?? asset?.size,
      mimeType: blob?.type || '',
    },
    createdAt: Date.now(),
  };
}

/**
 * Convenience: build a script SharedItem (not yet stored).
 * `script.deps` ([{ name, code }]) are the sibling scripts it imports.
 */
export function makeSharedScriptItem(script) {
  const code = script?.code || '';
  return {
    id: newId(),
    name: script?.name || 'Script',
    type: 'script',
    data: {
      name: script?.name || 'Script',
      description: script?.description,
      code,
      deps: Array.isArray(script?.deps)
        ? script.deps.map((d) => ({ name: d.name, code: d.code || '' }))
        : [],
    },
    hash: hashText(code),
    createdAt: Date.now(),
  };
}

// ─── Backup: export / import ────────────────────────────────────────────────

/** Total media bytes in a list of items (to warn before a huge export). */
export function totalMediaBytes(items) {
  return (items || []).reduce(
    (sum, i) => sum + (i?.type === 'media' ? i.data?.blob?.size || i.data?.size || 0 : 0),
    0
  );
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBlob(b64, mimeType) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || '' });
}

/**
 * Library -> one JSON string. Media Blobs become base64.
 * @param {SharedItem[]} items
 * @param {{ includeMedia?: boolean }} [options]
 */
export async function serializeLibrary(items, { includeMedia = true } = {}) {
  const out = [];
  for (const item of items || []) {
    if (!item) continue;
    if (item.type === 'media') {
      if (!includeMedia || !(item.data?.blob instanceof Blob)) continue;
      const { blob, url, ...rest } = item.data; // `url` is a derived object URL — never stored
      out.push({
        ...item,
        data: { ...rest, mimeType: blob.type || rest.mimeType || '', base64: await blobToBase64(blob) },
      });
    } else {
      const { data, ...rest } = item;
      out.push({ ...rest, data });
    }
  }
  return JSON.stringify({
    format: LIBRARY_FILE_FORMAT,
    version: LIBRARY_FILE_VERSION,
    exportedAt: Date.now(),
    items: out,
  });
}

/**
 * JSON string from serializeLibrary -> SharedItem[] (Blobs rebuilt).
 * Throws an Error with a readable message when the file isn't a library file.
 */
export function parseLibrary(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!doc || doc.format !== LIBRARY_FILE_FORMAT || !Array.isArray(doc.items)) {
    throw new Error('This is not a Shared Library backup file.');
  }
  if (typeof doc.version === 'number' && doc.version > LIBRARY_FILE_VERSION) {
    throw new Error('This backup was made by a newer version of the app.');
  }
  const items = [];
  for (const raw of doc.items) {
    if (!raw || !['prefab', 'script', 'media'].includes(raw.type) || !raw.name) continue;
    if (raw.type === 'media') {
      const { base64, ...rest } = raw.data || {};
      if (typeof base64 !== 'string') continue;
      const blob = base64ToBlob(base64, rest.mimeType);
      items.push({ ...raw, data: { ...rest, blob, size: blob.size } });
    } else if (raw.data && typeof raw.data === 'object') {
      items.push(raw);
    }
  }
  return items;
}

/**
 * Decide what an imported list adds to the library. Same type + same name
 * (".jsx"/case ignored; media also needs the same size) counts as already
 * there and is skipped — the library you already have always wins. Every added
 * item gets a fresh id so imports can never overwrite something by id.
 * @returns {{ toAdd: SharedItem[], skipped: number }}
 */
export function planImport(existing, incoming) {
  const keyOf = (i) =>
    `${i.type}:${baseName(i.name)}${i.type === 'media' ? `:${i.data?.size ?? i.data?.blob?.size ?? ''}` : ''}`;
  const have = new Set((existing || []).map(keyOf));
  const toAdd = [];
  let skipped = 0;
  for (const item of incoming || []) {
    const key = keyOf(item);
    if (have.has(key)) {
      skipped++;
      continue;
    }
    have.add(key);
    toAdd.push({ ...item, id: newId() });
  }
  return { toAdd, skipped };
}