import { createContext, useContext, useRef, useSyncExternalStore } from 'react';

/**
 * editorStore — a tiny external store + selector hook for the editor state.
 *
 * WHY. App used to hand every dock panel ONE `editorData` object through
 * context, so any field changing (a clip drop, a selection, an export range)
 * re-rendered all nine panels, including ones that never read the field that
 * changed. A store plus `useEditorSelector` lets each panel subscribe to just
 * the fields it uses: `ProjectPanel` no longer re-renders when clips move.
 *
 * Deliberately dependency-free (no Zustand/Redux): `useSyncExternalStore` is
 * the whole mechanism.
 *
 * @param {any} initialState
 */
export function createEditorStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  return {
    getState() {
      return state;
    },
    /**
     * Replace the state object. Subscribers are notified only when the object
     * is actually a different one — publishing the same reference (the usual
     * case for a render that changed nothing relevant) is free.
     */
    setState(next) {
      if (next === state) return;
      state = next;
      // Copy: a listener may unsubscribe (or subscribe) while being notified.
      for (const listener of Array.from(listeners)) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Shallow equality for selectors that build a small object or array from the
 * store (one level deep, `Object.is` per entry). `useEditorSelector` never
 * creates a fresh reference unless this says the value really changed, so a
 * selector may return `{ a, b }` or `[a, b]` safely.
 */
export function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Equality-cached selector, kept outside React so it can be unit-tested.
 *
 * `get()` is what `useSyncExternalStore` uses as its snapshot: it recomputes
 * the selected value and returns the PREVIOUS reference when `isEqual` says
 * the value did not change. That is what stops React from seeing a fresh
 * object on every store notification (which would loop forever), and it is
 * also why selectors may be inline arrow functions — the cached entry is the
 * one React compares against, not the selector's identity.
 */
export function createSelectionCache(store, selector, isEqual = Object.is) {
  let seeded = false;
  let value;

  // `get` is handed to useSyncExternalStore DETACHED (React calls it as a
  // plain function), so it must not rely on `this` — it closes over `cache`.
  const cache = {
    selector,
    isEqual,
    get() {
      const next = cache.selector(store.getState());
      if (seeded && cache.isEqual(value, next)) return value;
      seeded = true;
      value = next;
      return next;
    },
  };
  return cache;
}

export const EditorStoreContext = createContext(null);

/** The store itself — for the rare case a component needs `getState()` in an event handler. */
export function useEditorStore() {
  const store = useContext(EditorStoreContext);
  if (!store) {
    throw new Error('useEditorStore must be used inside <EditorStoreContext.Provider>');
  }
  return store;
}

/**
 * Subscribe to ONE slice of the editor store: re-renders only when that slice
 * changes (per `isEqual`, `Object.is` by default).
 *
 * The selector may be an inline arrow: it is re-read on every render and on
 * every store notification, and only its RESULT matters for re-rendering.
 * Selectors that return a new object/array should pass `shallowEqual` (or be
 * written to return an existing reference).
 */
export function useSelectorFromStore(store, selector, isEqual = Object.is) {
  const cacheRef = useRef(null);
  if (!cacheRef.current) {
    cacheRef.current = createSelectionCache(store, selector, isEqual);
  }
  const cache = cacheRef.current;
  cache.selector = selector;
  cache.isEqual = isEqual;
  return useSyncExternalStore(store.subscribe, cache.get, cache.get);
}

/** `useSelectorFromStore` against the App-provided store. */
export function useEditorSelector(selector, isEqual = Object.is) {
  return useSelectorFromStore(useEditorStore(), selector, isEqual);
}
