/**
 * Recent / known project folders, for the Hub screen.
 *
 * Stores the actual FileSystemDirectoryHandle for each project folder the
 * user has created or opened, so the Hub can reopen a project with one
 * click instead of the user re-browsing to it every time. Handles are
 * structured-cloneable but not JSON-serializable, so this uses IndexedDB
 * (not localStorage) — it's the only persistent web storage that can hold
 * a FileSystemDirectoryHandle directly.
 *
 * Every folder ever created or opened is kept (this is the app's "all
 * folders" record, not just a capped MRU list) — the Hub is responsible
 * for how much of that list it surfaces.
 */
 
const DB_NAME = 'blahblah-hub';
const DB_VERSION = 2;
const STORE_NAME = 'projects';
/**
 * User-made folders for organising the project list. Kept as their own store
 * so a folder survives having no projects in it, and so renaming/deleting one
 * is a single record write.
 */
const FOLDER_STORE_NAME = 'folders';
 
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Both stores are created only if missing, so upgrading a v1 database
      // (which has projects but no folders) adds the folder store without
      // touching the projects already in there.
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('lastOpenedAt', 'lastOpenedAt');
      }
      if (!db.objectStoreNames.contains(FOLDER_STORE_NAME)) {
        db.createObjectStore(FOLDER_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
 
function withStore(mode, fn, storeName = STORE_NAME) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const result = fn(store);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}
 
import { isTauri, createTauriDirectoryHandle } from './tauriFsAdapter';

const TAURI_STORAGE_KEY = 'blahblah-tauri-recent-projects-v1';
const TAURI_FOLDER_KEY = 'blahblah-tauri-project-folders-v1';

function getTauriFolders() {
  try {
    const raw = localStorage.getItem(TAURI_FOLDER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTauriFolders(folders) {
  try {
    localStorage.setItem(TAURI_FOLDER_KEY, JSON.stringify(folders));
  } catch {
    // Ignore storage failures
  }
}

function getTauriRecents() {
  try {
    const raw = localStorage.getItem(TAURI_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTauriRecents(recents) {
  try {
    localStorage.setItem(TAURI_STORAGE_KEY, JSON.stringify(recents));
  } catch {
    // Ignore storage failures
  }
}

/**
 * A stable-ish identity for a directory handle so reopening the same
 * folder updates its existing entry instead of duplicating it. The File
 * System Access API doesn't expose a real path, so this combines the
 * handle's own name with the parent folder name passed in by the caller
 * (best-effort de-dup, not a guarantee — two different folders that
 * happen to share both names would collide, which just means one entry
 * gets reused, not a crash or data loss).
 */
function makeEntryId(dirHandle, parentName) {
  return `${parentName || ''}::${dirHandle.name}`;
}
 
/**
 * Record that a project folder was just created. Adds a new entry with
 * matching createdAt/lastOpenedAt.
 */
export async function recordProjectCreated(dirHandle, projectName, parentName) {
  const now = Date.now();

  if (isTauri() && dirHandle?.path) {
    const recents = getTauriRecents();
    const id = dirHandle.path;
    const entry = {
      id,
      name: projectName || dirHandle.name,
      path: dirHandle.path,
      createdAt: now,
      lastOpenedAt: now,
    };
    const filtered = recents.filter((r) => r.id !== id);
    saveTauriRecents([entry, ...filtered]);
    return { ...entry, dirHandle };
  }

  const entry = {
    id: makeEntryId(dirHandle, parentName),
    name: projectName || dirHandle.name,
    dirHandle,
    createdAt: now,
    lastOpenedAt: now,
    folderId: null,
  };
  await withStore('readwrite', (store) => store.put(entry));
  return entry;
}
 
/**
 * Record that an existing project folder was just opened. If it's already
 * known (same folder reopened, or picked via Browse instead of the Hub),
 * this bumps lastOpenedAt and refreshes the stored handle/name while
 * preserving the original createdAt. Otherwise it's a folder the app
 * didn't create itself (e.g. picked directly via "Open Folder") — it's
 * added as new, with createdAt falling back to now since the real
 * creation time isn't knowable from here.
 */
export async function recordProjectOpened(dirHandle, projectName, parentName) {
  const now = Date.now();

  if (isTauri() && dirHandle?.path) {
    const recents = getTauriRecents();
    const id = dirHandle.path;
    const existing = recents.find((r) => r.id === id);
    const entry = {
      id,
      name: projectName || dirHandle.name,
      path: dirHandle.path,
      createdAt: existing ? existing.createdAt : now,
      lastOpenedAt: now,
      // Opening a project must never lose which folder it was filed under.
      folderId: existing?.folderId ?? null,
    };
    const filtered = recents.filter((r) => r.id !== id);
    saveTauriRecents([entry, ...filtered]);
    return { ...entry, dirHandle };
  }

  const id = makeEntryId(dirHandle, parentName);
  return withStore('readwrite', (store) => {
    const getReq = store.get(id);
    return new Promise((resolve, reject) => {
      getReq.onsuccess = () => {
        const existing = getReq.result;
        const entry = {
          id,
          name: projectName || dirHandle.name,
          dirHandle,
          createdAt: existing ? existing.createdAt : now,
          lastOpenedAt: now,
          // Opening a project must never lose which folder it was filed under.
          folderId: existing?.folderId ?? null,
        };
        const putReq = store.put(entry);
        putReq.onsuccess = () => resolve(entry);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }).then((result) => result);
}
 
/**
 * All known project folders, most-recently-opened first.
 */
export async function listRecentProjects() {
  if (isTauri()) {
    const recents = getTauriRecents();
    return recents
      .map((item) => ({
        ...item,
        dirHandle: createTauriDirectoryHandle(item.path, item.name),
      }))
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  const entries = await withStore('readonly', (store) => {
    const req = store.getAll();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
  return entries.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}
 
/**
 * Remove a folder from the recent/known list (does not touch anything on
 * disk — just forgets the handle).
 */
export async function forgetProject(id) {
  if (isTauri()) {
    const recents = getTauriRecents();
    saveTauriRecents(recents.filter((r) => r.id !== id));
    return;
  }

  await withStore('readwrite', (store) => store.delete(id));
}
/* ===========================================================================
   PROJECT FOLDERS

   Folders are purely a HUB-organisation concept: they never touch the disk,
   and deleting one only unfiles its projects (see deleteProjectFolder). They
   exist because the recents list is "every folder ever created or opened" and
   that gets unusable fast — grouping is the difference between a list you scan
   and a list you search.
   =========================================================================== */

/** Monotonic counter so two folders created in the same millisecond differ. */
let folderSeq = 0;

function makeFolderId() {
  folderSeq += 1;
  return `folder-${Date.now()}-${folderSeq}`;
}

/** Trim + clamp a folder name to something displayable. */
function cleanFolderName(name) {
  const clean = String(name ?? '').trim().slice(0, 60);
  return clean;
}

/** Every folder the user has made, oldest first (i.e. stable creation order). */
export async function listProjectFolders() {
  if (isTauri()) {
    return getTauriFolders().slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  const folders = await withStore('readonly', (store) => {
    const req = store.getAll();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }, FOLDER_STORE_NAME);
  return folders.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/**
 * Create a folder. A blank name is refused (returns null) rather than creating
 * an unnameable folder the user cannot find or delete.
 */
export async function createProjectFolder(name) {
  const clean = cleanFolderName(name);
  if (!clean) return null;

  const folder = { id: makeFolderId(), name: clean, createdAt: Date.now() };
  if (isTauri()) {
    saveTauriFolders([...getTauriFolders(), folder]);
    return folder;
  }
  await withStore('readwrite', (store) => store.put(folder), FOLDER_STORE_NAME);
  return folder;
}

/** Rename a folder. Blank names are refused, same as createProjectFolder. */
export async function renameProjectFolder(id, name) {
  const clean = cleanFolderName(name);
  if (!id || !clean) return null;

  if (isTauri()) {
    const folders = getTauriFolders();
    const target = folders.find((f) => f.id === id);
    if (!target) return null;
    const next = { ...target, name: clean };
    saveTauriFolders(folders.map((f) => (f.id === id ? next : f)));
    return next;
  }

  return withStore('readwrite', (store) => {
    const getReq = store.get(id);
    return new Promise((resolve, reject) => {
      getReq.onsuccess = () => {
        if (!getReq.result) {
          resolve(null);
          return;
        }
        const next = { ...getReq.result, name: clean };
        const putReq = store.put(next);
        putReq.onsuccess = () => resolve(next);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }, FOLDER_STORE_NAME);
}

/**
 * Delete a folder. The projects inside it are NOT deleted (they are real
 * folders on disk) — they are moved back to "Unfiled" first, so a delete can
 * never make a project disappear from the Hub.
 */
export async function deleteProjectFolder(id) {
  if (!id) return;

  const projects = await listRecentProjects();
  const affected = projects.filter((project) => project.folderId === id);
  for (const project of affected) {
    await assignProjectToFolder(project.id, null);
  }

  if (isTauri()) {
    saveTauriFolders(getTauriFolders().filter((f) => f.id !== id));
    return;
  }
  await withStore('readwrite', (store) => store.delete(id), FOLDER_STORE_NAME);
}

/**
 * File a project under a folder (or `null` for Unfiled). Reading the entry back
 * first is deliberate: the entry holds the live FileSystemDirectoryHandle, and
 * writing a partial record would replace it with a handle-less one.
 */
export async function assignProjectToFolder(projectId, folderId) {
  if (!projectId) return;

  if (isTauri()) {
    const recents = getTauriRecents();
    const target = recents.find((r) => r.id === projectId);
    if (!target) return;
    const next = { ...target, folderId: folderId ?? null };
    saveTauriRecents(recents.map((r) => (r.id === projectId ? next : r)));
    return;
  }

  return withStore('readwrite', (store) => {
    const getReq = store.get(projectId);
    return new Promise((resolve, reject) => {
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) {
          resolve(null);
          return;
        }
        const putReq = store.put({ ...existing, folderId: folderId ?? null });
        putReq.onsuccess = () => resolve(putReq.result);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  });
}
