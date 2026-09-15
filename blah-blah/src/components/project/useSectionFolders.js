import { useState, useEffect, useMemo, useCallback } from 'react';
 
/**
 * Folder-tree state for the Project panel, shared by all four sections.
 *
 * The panel used to keep four parallel copies of everything below
 * (openMediaSubfolders / openPrefabSubfolders / openScriptSubfolders /
 * openSharedSubfolders, plus four extra-folder arrays and a chain of
 * if/else setter dispatchers). They are all keyed by section here instead,
 * so adding a section is a one-line change to SECTIONS.
 *
 * "Extra" folders are empty folders created from the context menu. Assets
 * carry a `folder` field, so a folder with contents can be derived from the
 * items; an empty one has nothing to derive from and lives in state until
 * something lands in it.
 */
 
export const SECTIONS = ['media', 'prefabs', 'scripts', 'shared'];
 
// On-disk directory per section. The Shared Library lives in browser
// storage (see services/sharedLibraryStorage.js), so it has no entry.
const SECTION_DIR = {
  media: 'media',
  prefabs: 'prefabs',
  scripts: 'scripts',
};
 
const emptyBySection = (value) =>
  SECTIONS.reduce((acc, section) => ({ ...acc, [section]: value() }), {});
 
const applyUpdater = (updater, previous) =>
  typeof updater === 'function' ? updater(previous) : updater;
 
/**
 * @param {object}  args
 * @param {object}  args.projectFolderHandle  FileSystemDirectoryHandle | null
 * @param {object}  args.itemsBySection       { media, prefabs, scripts, shared } arrays
 */
export function useSectionFolders({ projectFolderHandle, itemsBySection }) {
  const [openSubfolders, setOpenSubfolders] = useState(() => emptyBySection(() => ({})));
  const [extraFolders, setExtraFolders] = useState(() => emptyBySection(() => []));
 
  // Empty folders have no asset metadata from which to reconstruct their
  // tree row. Read their real on-disk entries whenever a project is attached.
  useEffect(() => {
    if (!projectFolderHandle) return undefined;
    let cancelled = false;
 
    const scan = async (section, dirName) => {
      try {
        const root = await projectFolderHandle.getDirectoryHandle(dirName, { create: false });
        const names = [];
        for await (const entry of root.values()) {
          if (entry.kind === 'directory' && !entry.name.startsWith('.')) names.push(entry.name);
        }
        if (cancelled || names.length === 0) return;
        setExtraFolders((prev) => ({
          ...prev,
          [section]: Array.from(new Set([...prev[section], ...names])),
        }));
      } catch { /* folder may not exist in an older project */ }
    };
 
    Object.entries(SECTION_DIR).forEach(([section, dirName]) => { scan(section, dirName); });
    return () => { cancelled = true; };
  }, [projectFolderHandle]);
 
  const setExtraFoldersFor = useCallback((section, updater) => {
    setExtraFolders((prev) => ({ ...prev, [section]: applyUpdater(updater, prev[section]) }));
  }, []);
 
  const setOpenSubfoldersFor = useCallback((section, updater) => {
    setOpenSubfolders((prev) => ({ ...prev, [section]: applyUpdater(updater, prev[section]) }));
  }, []);
 
  const toggleSubfolder = useCallback((section, name) => {
    setOpenSubfoldersFor(section, (prev) => ({ ...prev, [name]: !prev[name] }));
  }, [setOpenSubfoldersFor]);
 
  // Folders per section: derived from item `folder` fields + context-menu
  // folders. Namespaces stay separate (media / prefabs / scripts / shared).
  const foldersBySection = useMemo(() => {
    const out = {};
    SECTIONS.forEach((section) => {
      const names = new Set(
        (itemsBySection[section] || []).filter((i) => i.folder).map((i) => i.folder),
      );
      (extraFolders[section] || []).forEach((f) => names.add(f));
      out[section] = Array.from(names);
    });
    return out;
  }, [itemsBySection, extraFolders]);
 
  return {
    openSubfolders,
    extraFolders,
    foldersBySection,
    setExtraFoldersFor,
    setOpenSubfoldersFor,
    toggleSubfolder,
  };
}