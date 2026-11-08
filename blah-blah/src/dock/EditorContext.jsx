import { createContext, use, useContext } from 'react';

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
  const actions = useContext(EditorActionsContext);
  if (actions) return actions;
  // Fallback for a caller mounted outside the split providers (older call
  // sites, tests) — and ONLY for it. `use()` is allowed after a conditional
  // return (unlike useContext, which must run on every render), so a consumer
  // under the split providers never subscribes to the merged context. Reading
  // it unconditionally used to re-render every panel on every editorData
  // change, which defeated the selector store.
  const merged = use(EditorContext);
  if (!merged) {
    throw new Error('useEditorActions must be used inside <EditorContext.Provider>');
  }
  return merged;
}

/** Project data / editor state only. */
export function useEditorData() {
  const data = useContext(EditorDataContext);
  if (data) return data;
  // Same conditional fallback as useEditorActions above.
  const merged = use(EditorContext);
  if (!merged) {
    throw new Error('useEditorData must be used inside <EditorContext.Provider>');
  }
  return merged;
}
