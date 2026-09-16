import { useState, useEffect, useMemo, useCallback } from 'react';
import { isTauri, joinPath } from '../../services/tauriFsAdapter';

/**
 * Folder-tree state for the Project panel, shared by all four sections.
 *
 * Persists known and scanned folders so empty folders remain in place
 * when items inside them are deleted, instead of vanishing.
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

const STORAGE_KEY = 'blahblah:section-folders';

function loadStoredFolders(storageKey, itemsBySection = null) {
  const out = emptyBySection(() => []);
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        SECTIONS.forEach((s) => {
          if (Array.isArray(parsed[s])) out[s] = parsed[s];
        });
      }
    }
  } catch {}

  if (itemsBySection) {
    SECTIONS.forEach((section) => {
      const itemFolders = (itemsBySection[section] || [])
        .filter((i) => i.folder)
        .map((i) => i.folder);
      if (itemFolders.length > 0) {
        out[section] = Array.from(new Set([...out[section], ...itemFolders]));
      }
    });
  }

  return out;
}

function saveStoredFolders(storageKey, folders) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(folders));
  } catch {}
}

/**
 * @param {object}  args
 * @param {object}  args.projectFolderHandle  FileSystemDirectoryHandle | null
 * @param {object}  args.itemsBySection       { media, prefabs, scripts, shared } arrays
 */
export function useSectionFolders({ projectFolderHandle, itemsBySection }) {
  const projectKey = useMemo(() => {
    if (projectFolderHandle?.path) return `${STORAGE_KEY}:${projectFolderHandle.path}`;
    if (projectFolderHandle?.name) return `${STORAGE_KEY}:${projectFolderHandle.name}`;
    return STORAGE_KEY;
  }, [projectFolderHandle]);

  const [prevProjectKey, setPrevProjectKey] = useState(projectKey);
  const [openSubfolders, setOpenSubfolders] = useState(() => emptyBySection(() => ({})));
  const [extraFolders, setExtraFolders] = useState(() => loadStoredFolders(projectKey, itemsBySection));

  // Sync state if project switch occurs
  if (projectKey !== prevProjectKey) {
    setPrevProjectKey(projectKey);
    setExtraFolders(loadStoredFolders(projectKey, itemsBySection));
  }

  // Empty folders have no asset metadata from which to reconstruct their
  // tree row. Read their real on-disk entries whenever a project is attached.
  useEffect(() => {
    if (!projectFolderHandle) return undefined;
    let cancelled = false;

    const scan = async (section, dirName) => {
      try {
        const names = [];

        // Fast path for Tauri native file system
        if (isTauri() && projectFolderHandle.path) {
          const { readDir, exists } = await import('@tauri-apps/plugin-fs');
          const targetPath = joinPath(projectFolderHandle.path, dirName);
          if (await exists(targetPath)) {
            const entries = await readDir(targetPath);
            entries.forEach((e) => {
              if (e.isDirectory && !e.name.startsWith('.')) names.push(e.name);
            });
          }
        } else {
          const root = await projectFolderHandle.getDirectoryHandle(dirName, { create: false });
          for await (const entry of root.values()) {
            if (entry.kind === 'directory' && !entry.name.startsWith('.')) names.push(entry.name);
          }
        }

        if (cancelled || names.length === 0) return;
        setExtraFolders((prev) => {
          const combined = Array.from(new Set([...(prev[section] || []), ...names]));
          if (combined.length === (prev[section] || []).length) return prev;
          const next = { ...prev, [section]: combined };
          saveStoredFolders(projectKey, next);
          return next;
        });
      } catch { /* folder may not exist in an older project */ }
    };

    Object.entries(SECTION_DIR).forEach(([section, dirName]) => { scan(section, dirName); });
    return () => { cancelled = true; };
  }, [projectFolderHandle, projectKey]);

  const setExtraFoldersFor = useCallback((section, updater) => {
    setExtraFolders((prev) => {
      const updatedList = applyUpdater(updater, prev[section] || []);
      const next = { ...prev, [section]: updatedList };
      saveStoredFolders(projectKey, next);
      return next;
    });
  }, [projectKey]);

  const setOpenSubfoldersFor = useCallback((section, updater) => {
    setOpenSubfolders((prev) => ({ ...prev, [section]: applyUpdater(updater, prev[section]) }));
  }, []);

  const toggleSubfolder = useCallback((section, name) => {
    setOpenSubfoldersFor(section, (prev) => ({ ...prev, [name]: !prev[name] }));
  }, [setOpenSubfoldersFor]);

  // Folders per section: derived from item `folder` fields + extra/stored folders.
  // Namespaces stay separate (media / prefabs / scripts / shared).
  const foldersBySection = useMemo(() => {
    const out = {};
    SECTIONS.forEach((section) => {
      const names = new Set(extraFolders[section] || []);
      (itemsBySection[section] || []).forEach((i) => {
        if (i.folder) names.add(i.folder);
      });
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