import { createContext, useContext } from 'react';

// Dockview panel components only receive `{ api, containerApi, params }` from
// dockview itself — not arbitrary React props. So instead of threading every
// prop through dockview's params (which breaks memoization / re-renders
// awkwardly), we push the current editor state+handlers into this context
// once per render in App.jsx, and each dock panel just reads what it needs.
export const EditorContext = createContext(null);

/**
 * The STABLE half of the editor context: callbacks and state setters only.
 *
 * App builds this object with useMemo, and every value in it keeps its identity
 * across renders (they come from useCallback / useState setters), so a consumer
 * that subscribes here re-renders only when the prefab mode actually flips —
 * never because a clip moved or a modal opened. Migrate a panel here when it
 * only needs actions; use useEditorContext() when it needs data too.
 */
export const EditorActionsContext = createContext(null);

/**
 * The CHANGING half: project data (entities/tracks/scripts/...) and editor
 * state (selection, recording level, export range, ...).
 *
 * Still one object, so every consumer of this context re-renders when any of
 * those values change — that is strictly narrower than the old single context,
 * but per-field subscription (a selector-based store) would be the next step.
 */
export const EditorDataContext = createContext(null);

/**
 * The merged view, unchanged for every caller that has not been migrated to
 * the split contexts. Panels can keep destructuring it exactly as before.
 *
 * NEW CODE SHOULD NOT USE THIS: it reads the whole editor state, so the caller
 * re-renders whenever ANY field changes. Use `useEditorSelector((s) => s.field)`
 * from hooks/editorStore.js for data (one re-render per field you actually
 * read) and `useEditorActions()` for callbacks. This still works for anything
 * un-migrated and is what the store's initial state comes from.
 */
export function useEditorContext() {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error('useEditorContext must be used inside <EditorContext.Provider>');
  }
  return ctx;
}

/** Callbacks/setters only — no re-render when the project data changes. */
export function useEditorActions() {
  // Both hooks are called unconditionally (rules of hooks); the merged context
  // is only the fallback for a caller mounted outside the split providers
  // (older call sites, tests).
  const actions = useContext(EditorActionsContext);
  const merged = useContext(EditorContext);
  if (actions) return actions;
  if (!merged) {
    throw new Error('useEditorActions must be used inside <EditorContext.Provider>');
  }
  return merged;
}

/** Project data / editor state only. */
export function useEditorData() {
  const data = useContext(EditorDataContext);
  const merged = useContext(EditorContext);
  if (data) return data;
  if (!merged) {
    throw new Error('useEditorData must be used inside <EditorContext.Provider>');
  }
  return merged;
}
