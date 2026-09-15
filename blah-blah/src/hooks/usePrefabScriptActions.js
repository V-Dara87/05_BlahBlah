import {
  precompileWithBundler,
} from '../engine/scriptRunner';
import {
  writeScriptFile,
  renameScriptFile,
} from '../services/projectFileSystem';
 
/**
 * usePrefabScriptActions — prefab and script CRUD (save/move/remove/create/
 * rename/save-code), plus their scripts/ file-system round-trips.
 *
 * Extracted from useProjectStore.js: this slice only ever touches
 * `setPrefabs` / `setScripts` (never entities or tracks), so it's a clean
 * cut — no shared local state with the rest of the store beyond the params
 * below. A faithful move: no logic changes, useCallback dep arrays are not
 * used here because none of the originals were (these handlers were plain
 * functions in useProjectStore too — not memoized), so identity/cadence is
 * unchanged for callers.
 *
 * @param {object} args
 * @param {Array}  args.scripts             current scripts slice (for lookups)
 * @param {Function} args.setPrefabs        undo-scoped prefabs setter
 * @param {Function} args.setScripts        undo-scoped scripts setter
 * @param {object} args.projectFolderHandle FileSystemDirectoryHandle | null
 */
export function usePrefabScriptActions({ scripts, setPrefabs, setScripts, projectFolderHandle }) {
  // Save a GameObject as a Prefab — a single-entity snapshot (flat model:
  // no child hierarchy to carry along). Legacy group/parent fields from
  // old saved entities are stripped.
  const handleSaveAsPrefab = (entity) => {
    const { linkGroupId: _linkGroupId, parentId: _parentId, ...snapshot } = JSON.parse(JSON.stringify(entity));
    const newPrefab = {
      id: `prefab-${Date.now()}`,
      name: `${entity.name}.prefab`,
      type: entity.type,
      components: snapshot.components || [],
      // Folder tree: null = root prefabs folder. createdAt powers the
      // "Date Added" sort option (falls back to 0 for legacy items).
      folder: null,
      createdAt: Date.now(),
    };
    setPrefabs(prev => [...prev, newPrefab]);
  };
 
  // Reassign a prefab's folder (null = root prefabs folder) — Project
  // panel folder drag-and-drop + folder rename/delete.
  const handleMovePrefab = (prefabId, targetFolderName) => {
    setPrefabs(prev => prev.map(p => p.id === prefabId ? { ...p, folder: targetFolderName || null } : p));
  };
 
  // Reassign a script's folder (null = root scripts folder) — Project
  // panel folder drag-and-drop + folder rename/delete.
  const handleMoveScript = (scriptId, targetFolderName) => {
    setScripts(prev => prev.map(s => s.id === scriptId ? { ...s, folder: targetFolderName || null } : s));
  };
 
  const handleRemovePrefab = (prefabId) => {
    setPrefabs(prev => prev.filter(p => p.id !== prefabId));
  };
 
  // Remove a script from the project's script list (Project panel context
  // menu). In-memory only — scripts already attached to clips keep their
  // component but lose their runtime definition.
  const handleRemoveScript = (scriptId) => {
    setScripts(prev => prev.filter(s => s.id !== scriptId));
  };
 
  // Rename both the record and its scripts/ file. Do the disk operation first
  // so a failed/colliding rename never makes the Project panel claim success.
  const handleRenameScript = async (scriptId, newName) => {
    const script = scripts.find((s) => s.id === scriptId);
    if (!script) return;
    if (projectFolderHandle) {
      await renameScriptFile(projectFolderHandle, script.name, newName, script.code);
    }
    setScripts(prev => prev.map(s => s.id === scriptId ? { ...s, name: newName } : s));
  };
 
  // Create & Save Script
  const handleCreateScript = async (newScript) => {
    // Stamp folder (root) + createdAt (sort key) — callers may provide
    // either, but the defaults keep new scripts consistent.
    setScripts(prev => [...prev, {
      ...newScript,
      folder: newScript.folder ?? null,
      createdAt: newScript.createdAt ?? Date.now(),
    }]);
    if (projectFolderHandle) {
      await writeScriptFile(projectFolderHandle, newScript.name, newScript.code).catch(() => {});
    }
    // Real-import support: kick off the async bundle right away so the
    // script is compiled (or shows its error) by the time it's scrubbed to.
    if (newScript.code) {
      precompileWithBundler(newScript.code, projectFolderHandle).catch(() => {});
    }
  };
 
  const handleSaveScript = async (scriptId, updates) => {
    setScripts(prev => prev.map(s => s.id === scriptId ? { ...s, ...updates } : s));
    const scriptObj = scripts.find(s => s.id === scriptId);
    if (projectFolderHandle && scriptObj) {
      const code = updates.code !== undefined ? updates.code : scriptObj.code;
      const name = updates.name || scriptObj.name;
      await writeScriptFile(projectFolderHandle, name, code).catch(() => {});
      precompileWithBundler(code, projectFolderHandle).catch(() => {});
    }
  };
 
  return {
    handleSaveAsPrefab,
    handleMovePrefab,
    handleMoveScript,
    handleRemovePrefab,
    handleRemoveScript,
    handleRenameScript,
    handleCreateScript,
    handleSaveScript,
  };
}