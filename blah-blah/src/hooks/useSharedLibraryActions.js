import { useCallback } from 'react';
import { isTauri } from '../services/tauriFsAdapter';
import {
  getStorageBackend,
  planImport,
  parseLibrary,
  serializeLibrary,
  totalMediaBytes,
} from '../services/sharedLibraryStorage';
import {
  baseName,
  hashText,
  collectDeps,
  getScriptSyncStatus,
} from '../services/sharedLibraryDeps';

/**
 * useSharedLibraryActions — App-level handlers around useSharedLibrary.
 *
 * useSharedLibrary (hooks/useSharedLibrary.js) owns the app-wide shared
 * prefab/script/media library's own state (items, storage sync). This hook
 * is the thin translation layer between that library and the current
 * project: share = copy a project prefab/script/media into the app-wide
 * library; import = bring a shared item into THIS project (scripts must
 * exist in the project to run, prefabs are copied into the project's
 * prefab list so they persist with the folder on disk, media is re-created
 * from its stored bytes and saved into the project's media/ folder).
 *
 * Rules (same name = same thing, ".jsx" and case ignored):
 *   - Duplicates: sharing a script/prefab that is already in the library asks
 *     "replace it?" (identical content just says "up to date"); the
 *     replacement keeps the old item's id and folder. Media with the same name
 *     AND size is skipped. Importing a script/prefab the project already has
 *     does not create a second copy (two scripts with one name would write the
 *     same file on disk) — the existing script is opened instead.
 *   - Dependencies: sharing a script also copies the sibling scripts it
 *     imports ("./Helper", found in the project) into the library item.
 *     Importing creates the ones the project is missing and never overwrites
 *     the project's own. Imports that can't be found are listed in a warning.
 *   - Origin / update: a script imported from (or shared to) the library
 *     remembers `origin = { sharedName, hash }`, the library content it
 *     matched. That lets the app tell "library changed" from "my copy
 *     changed" (see getScriptSyncStatus) and offer "Update from Shared Library".
 *   - Backup: export the whole library to one JSON file / import it back
 *     (already-present items are skipped, never overwritten).
 *   - Honest storage: when a share could not actually be persisted (media with
 *     no IndexedDB, or no storage at all) the user is told.
 */

const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const MB = 1024 * 1024;
const BIG_MEDIA_BYTES = 250 * MB;

/** Tell the user when what they just stored will not survive a reload. */
function warnIfNotPersisted(type) {
  const backend = getStorageBackend();
  if (backend === 'memory') {
    window.alert(
      'The Shared Library could not save to this browser\'s storage, so this item will be gone after a reload.\n' +
        'Use "Export Shared Library…" to keep a copy.'
    );
  } else if (backend === 'localstorage' && type === 'media') {
    window.alert(
      'This browser has no IndexedDB, so media cannot be stored in the Shared Library. ' +
        'It will be gone after a reload.'
    );
  }
}

/** Save text as a file: native Save dialog in Tauri, a download in the browser. */
async function saveTextFile(fileName, text) {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      title: 'Export Shared Library',
      defaultPath: fileName,
      filters: [{ name: 'Shared Library backup', extensions: ['json'] }],
    });
    if (!path) return false;
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, text);
    return true;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Ask the user for one .json file. Resolves the File, or null if cancelled. */
function pickJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function useSharedLibraryActions({
  sharedLibrary,
  scripts,
  prefabs = [], // optional — gives the "already in project" check for prefabs
  setPrefabs,
  handleCreateScript,
  handleSaveScript, // optional — needed for "Update from Shared Library"
  handleSetScriptOrigin, // optional — remembers where a script came from
  onOpenScriptEditor,
  onAddMediaAsset,
}) {
  /**
   * Create the dependency scripts a library item brought along, skipping any
   * the project already has. Resolves the names whose project version differs
   * from the library's (kept as they are).
   */
  const installDeps = useCallback(
    async (deps, ownerName) => {
      const kept = [];
      for (const dep of deps || []) {
        const have = (scripts || []).find((s) => baseName(s.name) === baseName(dep.name));
        if (have) {
          if ((have.code || '') !== (dep.code || '')) kept.push(have.name);
          continue;
        }
        await handleCreateScript({
          id: uid('script'),
          name: dep.name,
          description: `Imported with ${ownerName}`,
          code: dep.code || '',
        });
      }
      return kept;
    },
    [scripts, handleCreateScript]
  );

  const warnKept = (kept) => {
    if (kept.length === 0) return;
    window.alert(
      `Kept this project's own version of: ${kept.join(', ')}.\n` +
        'Their code differs from the Shared Library copy.'
    );
  };

  /**
   * Shared path for all three kinds: dependency collection (scripts), duplicate
   * check, then store. Resolves the stored item (or the existing one when
   * nothing was stored) so callers can still file it into a folder.
   */
  const shareItem = useCallback(
    async (type, item, store) => {
      const existing = (sharedLibrary.items || []).find(
        (i) =>
          i.type === type &&
          baseName(i.name) === baseName(item?.name) &&
          (type !== 'media' || i.data?.size === item?.size)
      );

      if (type === 'media') {
        if (existing) {
          window.alert(`"${item.name}" is already in the Shared Library.`);
          return existing;
        }
        const added = await store(item);
        if (added) warnIfNotPersisted('media');
        return added;
      }

      let deps = [];
      let hash;
      if (type === 'script') {
        const found = collectDeps(item, scripts);
        deps = found.deps;
        hash = hashText(item.code || '');
        if (
          found.missing.length > 0 &&
          !window.confirm(
            `"${item.name}" imports files that are not scripts in this project:\n` +
              `${found.missing.join(', ')}\n\n` +
              'They cannot be copied, so the script will fail in a project that lacks them.\n\n' +
              'Share it anyway?'
          )
        ) {
          return undefined;
        }
      } else {
        hash = hashText(JSON.stringify(item));
      }

      const remember = (stored) => {
        if (type === 'script' && stored && item?.id) {
          handleSetScriptOrigin?.(item.id, { sharedName: baseName(item.name), hash });
        }
        return stored;
      };

      let overrides;
      if (existing) {
        const sameDeps =
          type !== 'script' || JSON.stringify(existing.data?.deps || []) === JSON.stringify(deps);
        if (existing.hash === hash && sameDeps) {
          window.alert(`"${item.name}" is already up to date in the Shared Library.`);
          return remember(existing);
        }
        const ok = window.confirm(
          `A ${type} named "${item.name}" is already in the Shared Library.\n\n` +
            'OK = replace it with this version\nCancel = keep the old one'
        );
        if (!ok) return existing;
        overrides = { id: existing.id, folder: existing.folder, createdAt: existing.createdAt };
      }

      const added = await store(type === 'script' ? { ...item, deps } : item, overrides);
      if (added) warnIfNotPersisted(type);
      return remember(added);
    },
    [sharedLibrary, scripts, handleSetScriptOrigin]
  );

  const handleSharePrefab = useCallback(
    (prefab) => shareItem('prefab', prefab, sharedLibrary.addPrefab),
    [shareItem, sharedLibrary]
  );
  const handleShareScript = useCallback(
    (script) => shareItem('script', script, sharedLibrary.addScript),
    [shareItem, sharedLibrary]
  );
  const handleShareMedia = useCallback(
    (asset) => shareItem('media', asset, sharedLibrary.addMedia),
    [shareItem, sharedLibrary]
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
      const name = data.name || sharedItem.name || 'ImportedScript.jsx';
      const existing = (scripts || []).find((s) => baseName(s.name) === baseName(name));
      if (existing) {
        window.alert(`This project already has a script named "${existing.name}". Opening it instead.`);
        onOpenScriptEditor?.(existing);
        return;
      }
      const kept = await installDeps(data.deps, name);
      const newScript = {
        id: uid('script'),
        name,
        description: data.description || 'Imported from Shared Library',
        code: data.code || '',
        origin: {
          sharedName: baseName(sharedItem.name || name),
          hash: sharedItem.hash || hashText(data.code || ''),
        },
      };
      await handleCreateScript(newScript);
      onOpenScriptEditor?.(newScript);
      warnKept(kept);
    } else if (sharedItem.type === 'media') {
      const blob = data.blob;
      if (!(blob instanceof Blob)) return;
      const mediaType = data.mediaType === 'video' ? 'video' : 'audio';
      // Rebuild a File so the normal import path (saveMediaFileToFolder in
      // useMediaAssets) copies it into the project's media/ folder.
      const file = new File([blob], sharedItem.name || 'Media', {
        type: blob.type || data.mimeType || '',
      });
      await onAddMediaAsset?.(
        {
          id: uid('asset'),
          name: file.name,
          type: mediaType,
          url: URL.createObjectURL(file),
          duration: data.duration,
          size: file.size,
          createdAt: Date.now(),
        },
        file
      );
    } else if (sharedItem.type === 'prefab') {
      if (!data || typeof data !== 'object' || !data.name) return;
      if ((prefabs || []).some((p) => baseName(p.name) === baseName(data.name))) {
        window.alert(`This project already has a prefab named "${data.name}".`);
        return;
      }
      if (Array.isArray(data.embeddedScripts)) {
        for (const scr of data.embeddedScripts) {
          const exists = (scripts || []).some(
            (s) => baseName(s.name) === baseName(scr.name) || s.id === scr.id
          );
          if (!exists) {
            await handleCreateScript({
              id: scr.id || uid('script'),
              name: scr.name,
              description: scr.description || `Imported with ${data.name}`,
              code: scr.code || '',
            });
          }
        }
      }
      setPrefabs((prev) => [
        ...prev,
        { ...JSON.parse(JSON.stringify(data)), id: uid('prefab') },
      ]);
    }
  }, [installDeps, handleCreateScript, setPrefabs, scripts, prefabs, onOpenScriptEditor, onAddMediaAsset]);

  /** Replace a project script's code with the Shared Library version. */
  const handleUpdateScriptFromLibrary = useCallback(
    async (script) => {
      if (!script || !handleSaveScript) return;
      const { status, lib } = getScriptSyncStatus(script, sharedLibrary.items);
      if (!lib) {
        window.alert('No Shared Library original was found for this script.');
        return;
      }
      if (
        status === 'conflict' &&
        !window.confirm(
          `"${script.name}" was edited in this project AND changed in the Shared Library.\n\n` +
            'Updating replaces your edits here with the library version.\n\nContinue?'
        )
      ) {
        return;
      }
      const data = lib.data || {};
      const kept = await installDeps(data.deps, lib.name);
      await handleSaveScript(script.id, { code: data.code || '' });
      handleSetScriptOrigin?.(script.id, {
        sharedName: baseName(lib.name),
        hash: lib.hash || hashText(data.code || ''),
      });
      warnKept(kept);
    },
    [sharedLibrary, installDeps, handleSaveScript, handleSetScriptOrigin]
  );

  /**
   * Make sure a Shared Library SCRIPT exists in THIS project and resolve the
   * project's script object. Unlike handleImportSharedItem it never opens the
   * editor and never alerts about duplicates, so it can back a drag-and-drop
   * of a shared script straight onto the timeline: a ScriptComponent can only
   * run a script that lives in the project, so the drop imports it first.
   * A project script with the same name is reused (never a second copy).
   */
  const ensureSharedScriptInProject = useCallback(
    async (sharedItem) => {
      if (!sharedItem || sharedItem.type !== 'script') return null;
      const data = sharedItem.data || {};
      const name = data.name || sharedItem.name || 'ImportedScript.jsx';
      const existing = (scripts || []).find((s) => baseName(s.name) === baseName(name));
      if (existing) return existing;
      const kept = await installDeps(data.deps, name);
      const newScript = {
        id: uid('script'),
        name,
        description: data.description || 'Imported from Shared Library',
        code: data.code || '',
        origin: {
          sharedName: baseName(sharedItem.name || name),
          hash: sharedItem.hash || hashText(data.code || ''),
        },
      };
      await handleCreateScript(newScript);
      warnKept(kept);
      return newScript;
    },
    [scripts, installDeps, handleCreateScript]
  );

  /** Whole library -> one .json file. */
  const handleExportSharedLibrary = useCallback(async () => {
    const items = sharedLibrary.items || [];
    if (items.length === 0) {
      window.alert('The Shared Library is empty.');
      return;
    }
    let includeMedia = true;
    const mediaBytes = totalMediaBytes(items);
    if (mediaBytes > BIG_MEDIA_BYTES) {
      includeMedia = window.confirm(
        `The media in the library is about ${Math.round(mediaBytes / MB)} MB. ` +
          'That may be too big for one backup file.\n\n' +
          'OK = include media anyway\nCancel = export scripts and prefabs only'
      );
    }
    try {
      const text = await serializeLibrary(items, { includeMedia });
      const day = new Date().toISOString().slice(0, 10);
      await saveTextFile(`blahblah-shared-library-${day}.json`, text);
    } catch (err) {
      window.alert(`Could not export the Shared Library: ${err?.message || err}`);
    }
  }, [sharedLibrary]);

  /** Pick a backup .json and add what the library does not have yet. */
  const handleImportSharedLibrary = useCallback(async () => {
    const file = await pickJsonFile();
    if (!file) return;
    try {
      const incoming = parseLibrary(await file.text());
      const { toAdd, skipped } = planImport(sharedLibrary.items, incoming);
      if (toAdd.length > 0) {
        await sharedLibrary.addMany(toAdd);
        warnIfNotPersisted(toAdd.some((i) => i.type === 'media') ? 'media' : 'script');
      }
      window.alert(
        `Imported ${toAdd.length} item(s).` +
          (skipped > 0 ? `\nSkipped ${skipped} already in the library.` : '')
      );
    } catch (err) {
      window.alert(`Could not import the backup: ${err?.message || err}`);
    }
  }, [sharedLibrary]);

  return {
    handleSharePrefab,
    handleShareScript,
    handleShareMedia,
    handleRemoveSharedItem,
    handleMoveSharedItem,
    handleImportSharedItem,
    ensureSharedScriptInProject,
    handleUpdateScriptFromLibrary,
    handleExportSharedLibrary,
    handleImportSharedLibrary,
  };
}