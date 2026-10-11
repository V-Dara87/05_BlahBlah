import {
  precompileWithBundler,
  resetScriptDisabled,
} from '../engine/scriptRunner';
import { isScriptComponent } from '../engine/ecs';
import {
  writeScriptFile,
  renameScriptFile,
  deleteScriptFileFromFolder,
  deletePrefabFileFromFolder,
  writePrefabFile,
} from '../services/projectFileSystem';

/**
 * usePrefabScriptActions — prefab and script CRUD (save/move/remove/create/
 * rename/save-code/update), plus their file-system round-trips.
 *
 * Supports hierarchical prefabs: saving an entity captures the root entity
 * and all its descendant children, mapping relative start times and preserving
 * parent-child links.
 *
 * @param {object} args
 * @param {Array}  args.entities           current entities slice (for hierarchy lookups)
 * @param {Array}  args.prefabs            current prefabs slice (for lookups)
 * @param {Array}  args.scripts            current scripts slice (for lookups)
 * @param {Function} args.setPrefabs       undo-scoped prefabs setter
 * @param {Function} args.setScripts       undo-scoped scripts setter
 * @param {object} args.projectFolderHandle FileSystemDirectoryHandle | null
 */
export function usePrefabScriptActions({
  entities = [],
  prefabs = [],
  scripts = [],
  setPrefabs,
  setScripts,
  projectFolderHandle,
}) {
  // Save a GameObject as a Prefab — captures the root entity and all of its
  // children/descendants in a multi-object hierarchy snapshot.
  const handleSaveAsPrefab = async (entity) => {
    if (!entity) return;

    // 1. Find all descendants of entity in entities array
    const descendants = [];
    const collectDescendants = (parentId) => {
      const children = (entities || []).filter((e) => e.parentId === parentId);
      for (const child of children) {
        descendants.push(child);
        collectDescendants(child.id);
      }
    };
    collectDescendants(entity.id);

    const rootStartTime = entity.startTime || 0;
    const allObjects = [entity, ...descendants];

    // Snapshot each object, normalizing start times relative to rootStartTime
    const snapshots = allObjects.map((obj) => {
      const clone = JSON.parse(JSON.stringify(obj));
      // Root entity in the prefab has parentId = null
      if (clone.id === entity.id) {
        clone.parentId = null;
      }
      clone.startTime = Math.max(0, (obj.startTime || 0) - rootStartTime);
      return clone;
    });

    const rootSnapshot = snapshots[0];

    // Collect all referenced scripts from components across all snapshots
    const usedScriptIds = new Set();
    snapshots.forEach((snap) => {
      (snap.components || []).forEach((c) => {
        if (isScriptComponent(c) && c.scriptId) {
          usedScriptIds.add(c.scriptId);
        }
      });
    });

    const embeddedScripts = (scripts || [])
      .filter((s) => usedScriptIds.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description || '',
        code: s.code || '',
      }));

    const newPrefab = {
      id: `prefab-${Date.now()}`,
      name: `${entity.name}.prefab`,
      type: entity.type,
      rootId: entity.id,
      entities: snapshots,
      components: rootSnapshot.components || [],
      embeddedScripts,
      folder: null,
      createdAt: Date.now(),
    };

    setPrefabs((prev) => [...prev, newPrefab]);

    if (projectFolderHandle) {
      await writePrefabFile(projectFolderHandle, newPrefab.name, newPrefab).catch(() => {});
    }
  };

  // Update an existing prefab's snapshots, components, or metadata
  const handleUpdatePrefab = async (prefabId, updatedData) => {
    const existing = (prefabs || []).find((p) => p.id === prefabId);
    const updatedPrefab = existing
      ? { ...existing, ...updatedData, lastModified: Date.now() }
      : { id: prefabId, ...updatedData, lastModified: Date.now() };

    setPrefabs((prev) =>
      prev.map((p) => (p.id === prefabId ? updatedPrefab : p))
    );

    if (projectFolderHandle && updatedPrefab && updatedPrefab.name) {
      await writePrefabFile(
        projectFolderHandle,
        updatedPrefab.name,
        updatedPrefab,
        updatedPrefab.folder || null
      ).catch((err) => {
        console.warn('Could not write updated prefab file:', err);
      });
    }

    return updatedPrefab;
  };

  // Reassign a prefab's folder (null = root prefabs folder) — Project
  // panel folder drag-and-drop + folder rename/delete.
  const handleMovePrefab = (prefabId, targetFolderName) => {
    setPrefabs((prev) =>
      prev.map((p) => (p.id === prefabId ? { ...p, folder: targetFolderName || null } : p))
    );
  };

  // Reassign a script's folder (null = root scripts folder) — Project
  // panel folder drag-and-drop + folder rename/delete.
  const handleMoveScript = (scriptId, targetFolderName) => {
    setScripts((prev) =>
      prev.map((s) => (s.id === scriptId ? { ...s, folder: targetFolderName || null } : s))
    );
  };

  const handleRemovePrefab = async (prefabId) => {
    const prefab = prefabs.find((p) => p.id === prefabId);
    setPrefabs((prev) => prev.filter((p) => p.id !== prefabId));
    if (projectFolderHandle && prefab) {
      await deletePrefabFileFromFolder(projectFolderHandle, prefab.name, prefab.folder || null).catch(
        () => {}
      );
    }
  };

  // Remove a script from the project's script list (Project panel context
  // menu) and delete from disk if project folder is attached.
  const handleRemoveScript = async (scriptId) => {
    const script = scripts.find((s) => s.id === scriptId);
    setScripts((prev) => prev.filter((s) => s.id !== scriptId));
    if (projectFolderHandle && script) {
      await deleteScriptFileFromFolder(projectFolderHandle, script.name, script.folder || null).catch(
        () => {}
      );
    }
  };

  // Rename both the record and its scripts/ file. Do the disk operation first
  // so a failed/colliding rename never makes the Project panel claim success.
  const handleRenameScript = async (scriptId, newName) => {
    const script = scripts.find((s) => s.id === scriptId);
    if (!script) return;
    if (projectFolderHandle) {
      await renameScriptFile(projectFolderHandle, script.name, newName, script.code);
    }
    setScripts((prev) => prev.map((s) => (s.id === scriptId ? { ...s, name: newName } : s)));
  };

  // Create & Save Script
  const handleCreateScript = async (newScript) => {
    setScripts((prev) => [...prev, newScript]);
    if (projectFolderHandle) {
      await writeScriptFile(projectFolderHandle, newScript.name, newScript.code).catch(
        (err) => console.warn('Could not write new script file:', err)
      );
    }
    // Compile EVERY new script up front (the sync path is now pending until
    // esbuild has compiled it), naming it so Console entries read
    // [ScriptName]. Nothing awaits it here — the render path polls the cache.
    return precompileWithBundler(newScript.code, projectFolderHandle, newScript.name);
  };

  // Save from the Script Editor modal. The modal calls this as
  // `onSaveScript(script.id, { name, code })`, so the first argument is the
  // script's ID (not its name) and the second is an update object. This used
  // to be declared `(name, code)`, which meant `name` received the id and
  // `code` received the whole `{ name, code }` object: the lookup by name
  // never matched, the in-memory script silently kept its old code, and the
  // next autosave then wrote that stale code back over the file on disk.
  const handleSaveScript = async (scriptId, updates = {}) => {
    const scriptObj = (scripts || []).find((s) => s.id === scriptId);
    if (!scriptObj) return;

    const nextCode = typeof updates.code === 'string' ? updates.code : scriptObj.code || '';
    const nextName = updates.name || scriptObj.name;
    const renamed = nextName !== scriptObj.name;

    // Disk first for a rename, so a colliding/failed rename never leaves the
    // Project panel claiming success (same rule as handleRenameScript).
    if (projectFolderHandle && renamed) {
      await renameScriptFile(projectFolderHandle, scriptObj.name, nextName, nextCode);
    }

    setScripts((prev) =>
      prev.map((s) =>
        s.id === scriptId ? { ...s, name: nextName, code: nextCode, lastModified: Date.now() } : s
      )
    );

    // A rename already wrote the new file via renameScriptFile.
    if (projectFolderHandle && !renamed) {
      await writeScriptFile(projectFolderHandle, nextName, nextCode).catch(
        (err) => console.warn('Could not write script file:', err)
      );
    }

    // Pressing Save is an explicit "try this again": clear any freeze-guard
    // pause and its strike counters first, even when the code string is
    // unchanged (editing the code alone would otherwise be the only way to
    // un-pause a script).
    resetScriptDisabled(nextCode);

    // Compile AFTER the setScripts above (the sync path is pending until
    // esbuild lands) and RETURN the result so the editor can report
    // "Saved ✓" vs "Saved — N error(s)". Runs even without a project folder,
    // so an unsaved project still gets an in-memory compile.
    return precompileWithBundler(nextCode, projectFolderHandle, nextName);
  };

  return {
    handleSaveAsPrefab,
    handleUpdatePrefab,
    handleMovePrefab,
    handleMoveScript,
    handleRemovePrefab,
    handleRemoveScript,
    handleRenameScript,
    handleCreateScript,
    handleSaveScript,
  };
}