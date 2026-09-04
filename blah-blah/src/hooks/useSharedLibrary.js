import { useState, useEffect, useCallback } from 'react';
import {
  listSharedItems,
  addSharedItem,
  removeSharedItem,
  makeSharedPrefabItem,
  makeSharedScriptItem,
} from '../services/sharedLibraryStorage';

/**
 * useSharedLibrary — app-wide shared prefab/script library state.
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

  /** Store a project prefab (any shape) into the shared library. */
  const addPrefab = useCallback(
    (prefab) => addItem(makeSharedPrefabItem(prefab)),
    [addItem]
  );

  /** Store a project script into the shared library. */
  const addScript = useCallback(
    (script) => addItem(makeSharedScriptItem(script)),
    [addItem]
  );

  const remove = useCallback(async (id) => {
    const list = await removeSharedItem(id);
    setItems(list);
  }, []);

  return {
    items,
    ready,
    addPrefab,
    addScript,
    removeSharedItem: remove,
    refresh,
  };
}
