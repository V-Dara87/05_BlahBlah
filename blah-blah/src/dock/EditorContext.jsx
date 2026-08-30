import { createContext, useContext } from 'react';

// Dockview panel components only receive `{ api, containerApi, params }` from
// dockview itself — not arbitrary React props. So instead of threading every
// prop through dockview's params (which breaks memoization / re-renders
// awkwardly), we push the current editor state+handlers into this context
// once per render in App.jsx, and each dock panel just reads what it needs.
export const EditorContext = createContext(null);

export function useEditorContext() {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error('useEditorContext must be used inside <EditorContext.Provider>');
  }
  return ctx;
}
