import { useCallback } from 'react';
 
/**
 * useSharedLibraryActions — App-level handlers around useSharedLibrary.
 *
 * useSharedLibrary (hooks/useSharedLibrary.js) owns the app-wide shared
 * prefab/script library's own state (items, storage sync). This hook is
 * the thin translation layer between that library and the current
 * project: share = copy a project prefab/script into the app-wide
 * library; import = bring a shared item into THIS project (scripts must
 * exist in the project to run, prefabs are copied into the project's
 * prefab list so they persist with the folder on disk).
 *
 * Split out from useSharedLibrary itself (rather than folded into it)
 * because importing needs project-scoped operations — handleCreateScript
 * and setPrefabs — that only make sense wired to the current project's
 * useProjectStore instance, whereas useSharedLibrary knows nothing about
 * "the current project" at all.
 */
export function useSharedLibraryActions({
  sharedLibrary,
  scripts,
  setPrefabs,
  handleCreateScript,
  onOpenScriptEditor,
}) {
  const handleSharePrefab = useCallback(
    (prefab) => { sharedLibrary.addPrefab(prefab); },
    [sharedLibrary]
  );
  const handleShareScript = useCallback(
    (script) => { sharedLibrary.addScript(script); },
    [sharedLibrary]
  );
  const handleRemoveSharedItem = useCallback(
    (id) => { sharedLibrary.removeSharedItem(id); },
    [sharedLibrary]
  );
  const handleMoveSharedItem = useCallback(
    (id, folderName) => { sharedLibrary.moveItem(id, folderName); },
    [sharedLibrary]
  );
 
  const handleImportSharedItem = useCallback(async (sharedItem) => {
    if (!sharedItem) return;
    const data = sharedItem.data || {};
    if (sharedItem.type === 'script') {
      const newScript = {
        id: `script-${Date.now()}`,
        name: data.name || sharedItem.name || 'ImportedScript.jsx',
        description: data.description || 'Imported from Shared Library',
        code: data.code || '',
      };
      await handleCreateScript(newScript);
      onOpenScriptEditor(newScript);
    } else if (sharedItem.type === 'prefab') {
      if (!data || typeof data !== 'object' || !data.name) return;
      if (Array.isArray(data.embeddedScripts)) {
        for (const scr of data.embeddedScripts) {
          const exists = (scripts || []).some((s) => s.name === scr.name || s.id === scr.id);
          if (!exists) {
            await handleCreateScript({
              id: scr.id || `script-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              name: scr.name,
              description: scr.description || `Imported with ${data.name}`,
              code: scr.code || '',
            });
          }
        }
      }
      setPrefabs((prev) => [
        ...prev,
        { ...JSON.parse(JSON.stringify(data)), id: `prefab-${Date.now()}` },
      ]);
    }
  }, [handleCreateScript, setPrefabs, scripts, onOpenScriptEditor]);
 
  return {
    handleSharePrefab,
    handleShareScript,
    handleRemoveSharedItem,
    handleMoveSharedItem,
    handleImportSharedItem,
  };
}