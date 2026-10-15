import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  listSharedItems,
  addSharedItem,
  removeSharedItem,
  moveSharedItem,
  moveAllSharedItemsInFolder,
  addSharedItems,
  makeSharedPrefabItem,
  makeSharedScriptItem,
  makeSharedMediaItem,
} from '../services/sharedLibraryStorage';
 
/**
 * useSharedLibrary — app-wide shared prefab/script/media library state.
 *
 * The library lives OUTSIDE any project folder (see
 * services/sharedLibraryStorage.js: IndexedDB w/ localStorage fallback), so
 * items added here are available across every project this app opens. The
 * list is loaded once on mount and every mutation re-reads + replaces the
 * in-memory list from storage so the UI never drifts from what's persisted.
 */
export function useSharedLibrary() {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
 
  useEffect(() => {
    let disposed = false;
    listSharedItems().then((list) => {
      if (disposed) return;
      setItems(list);
      setReady(true);
    });
    return () => {
      disposed = true;
    };
  }, []);
 
  const refresh = useCallback(async () => {
    const list = await listSharedItems();
    setItems(list);
  }, []);
 
  const addItem = useCallback(async (item) => {
    const list = await addSharedItem(item);
    setItems(list);
    return item;
  }, []);
 
  /**
   * Store a project prefab (any shape) into the shared library.
   * `overrides` ({ id, folder, createdAt }) lets a "replace" keep the old
   * item's id and folder instead of creating a new item.
   */
  const addPrefab = useCallback(
    (prefab, overrides) =>
      addItem({ ...makeSharedPrefabItem(prefab), createdAt: Date.now(), ...overrides }),
    [addItem]
  );
 
  /** Store a project script (with its `deps`) into the shared library. */
  const addScript = useCallback(
    (script, overrides) =>
      addItem({ ...makeSharedScriptItem(script), createdAt: Date.now(), ...overrides }),
    [addItem]
  );
 
  /** Store several ready-made items at once (used by backup import). */
  const addMany = useCallback(async (list) => {
    const next = await addSharedItems(list);
    setItems(next);
    return next;
  }, []);
 
  /**
   * Store a media asset into the shared library. Uses `asset.file` when the
   * caller already holds the File (OS drops), otherwise reads the bytes from
   * `asset.url` (fetch works for both blob: and Tauri convertFileSrc URLs).
   * Either way the actual bytes are stored, so the copy survives reloads and
   * is independent of the project it came from. Resolves the stored item, or
   * null when the bytes couldn't be read.
   */
  const addMedia = useCallback(
    async (asset) => {
      if (!asset?.file && !asset?.url) return null;
      try {
        const blob = asset.file instanceof Blob
          ? asset.file
          : await (await fetch(asset.url)).blob();
        return await addItem(makeSharedMediaItem(asset, blob));
      } catch (err) {
        console.warn('Could not add media to the Shared Library:', err);
        return null;
      }
    },
    [addItem]
  );
 
  const remove = useCallback(async (id) => {
    const list = await removeSharedItem(id);
    setItems(list);
  }, []);
 
  /** Move one item into a folder (or back to root when folderName is null). */
  const moveItem = useCallback(async (id, folderName) => {
    const list = await moveSharedItem(id, folderName);
    setItems(list);
  }, []);
 
  /** Move every item out of one folder into another (or root). */
  const moveFolderContents = useCallback(async (fromFolder, toFolder) => {
    const list = await moveAllSharedItemsInFolder(fromFolder, toFolder);
    setItems(list);
  }, []);
 
  // Media items carry a Blob, not a URL. Give each one a playable object URL
  // (used by hover previews) and revoke URLs whose item is gone/replaced so
  // they don't leak. The URL is derived, never persisted.
  const urlCacheRef = useRef(new Map()); // blob -> object URL
  const itemsWithUrls = useMemo(() => {
    const cache = urlCacheRef.current;
    const live = new Set();
    const out = items.map((item) => {
      const blob = item?.type === 'media' ? item.data?.blob : null;
      if (!(blob instanceof Blob)) return item;
      live.add(blob);
      if (!cache.has(blob)) cache.set(blob, URL.createObjectURL(blob));
      return { ...item, data: { ...item.data, url: cache.get(blob) } };
    });
    for (const [blob, url] of [...cache.entries()]) {
      if (!live.has(blob)) {
        URL.revokeObjectURL(url);
        cache.delete(blob);
      }
    }
    return out;
  }, [items]);
 
  useEffect(() => {
    const cache = urlCacheRef.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);
 
  return {
    items: itemsWithUrls,
    ready,
    addPrefab,
    addScript,
    addMedia,
    addMany,
    removeSharedItem: remove,
    moveItem,
    moveFolderContents,
    refresh,
  };
}
 