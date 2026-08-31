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
const DB_VERSION = 1;
const STORE_NAME = 'projects';
 
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('lastOpenedAt', 'lastOpenedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
 
function withStore(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const result = fn(store);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
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
  const entry = {
    id: makeEntryId(dirHandle, parentName),
    name: projectName || dirHandle.name,
    dirHandle,
    createdAt: now,
    lastOpenedAt: now,
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
  const id = makeEntryId(dirHandle, parentName);
  const now = Date.now();
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
  await withStore('readwrite', (store) => store.delete(id));
}