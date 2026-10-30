import { useCallback, useEffect, useRef } from 'react';
import { INITIAL_TRACKS, DEFAULT_RESOLUTION } from '../types';
import {
  pickProjectDirectory,
  loadProjectFromDirectory,
  checkScriptsForChanges,
  verifyPermission,
  watchScriptsDirectory,
  watchProjectFile,
  checkProjectJsonForChanges,
} from '../services/projectFileSystem';
import { recordProjectCreated, recordProjectOpened } from '../services/recentProjects';
import { precompileAllProjectScripts } from '../engine/scriptRunner';
 
/**
 * useProjectFileActions — the project-swap load paths (New Project / Open
 * Folder / Open Recent, each of which resets undo history) and the
 * scripts/ hot-reload poll.
 *
 * Extracted from useProjectStore.js: everything here revolves around
 * `resetProjectHistoryState` — a full replace of the undo-scoped slices,
 * not an edit to them — plus the shell-owned view/project metadata setters.
 * A faithful move: no logic changes, useCallback dep arrays preserved
 * verbatim so handler identity/cadence is unchanged for callers (the
 * scripts hot-reload effect in particular depends on this: it only
 * re-subscribes when `projectFolderHandle` changes, not on every
 * `scripts` update — see the comment on isPollingScriptsRef below).
 *
 * @param {object} args
 * @param {Array}    args.scripts                current scripts slice (hot-reload ref)
 * @param {Function} args.setScripts             undo-scoped scripts setter
 * @param {Function} args.resetProjectHistoryState  replaces entities/tracks/scripts/prefabs + clears undo
 * @param {object}   args.projectFolderHandle    FileSystemDirectoryHandle | null
 * @param {Function} args.setProjectFolderHandle
 * @param {Function} args.setProjectName
 * @param {Function} args.setResolution
 * @param {Function} args.setSelectedEntityId
 * @param {Function} args.setSaveStatus
 * @param {Function} args.setSchemaWarning
 * @param {Function} args.setScreen
 * @param {Function} args.setMediaAssets
 */
export function useProjectFileActions({
  scripts,
  setScripts,
  resetProjectHistoryState,
  projectFolderHandle,
  setProjectFolderHandle,
  setProjectName,
  setResolution,
  setSelectedEntityId,
  saveStatus,
  setSaveStatus,
  setSchemaWarning,
  setScreen,
  setMediaAssets,
}) {
  // Handle Project Creation from New Project Modal — a brand new project
  // folder, so it gets a brand new (empty) undo history too.
  const handleProjectCreated = (result) => {
    setProjectFolderHandle(result.dirHandle);
    setProjectName(result.projectName);
    setResolution(result.resolution || DEFAULT_RESOLUTION);
    resetProjectHistoryState({ entities: [], tracks: result.tracks, scripts: [], prefabs: [] });
    setMediaAssets([]);
    setSelectedEntityId(null);
    setSaveStatus('saved');
    setSchemaWarning?.(null); // clear any warning left over from a previously opened project
    setScreen('editor');
    // Record it in the Hub's recent/known-folders list. The folder's
    // parent isn't tracked here, so pass null — NewProjectModal already
    // confirmed the folder itself is fresh, so a name collision with an
    // unrelated same-named folder elsewhere on disk is an acceptable
    // rare edge case for de-duping recent entries.
    recordProjectCreated(result.dirHandle, result.projectName, null).catch((err) => {
      console.warn('Could not record project in recent list:', err);
    });
  };
 
  // Shared by "Open Folder" (hub + in-editor header) — loads a directory
  // handle into the editor and records it as a known/recent project.
  const openProjectFromHandle = useCallback(async (dirHandle) => {
    const loaded = await loadProjectFromDirectory(dirHandle, INITIAL_TRACKS);
 
    setProjectFolderHandle(dirHandle);
    setProjectName(loaded.projectName);
    setResolution(loaded.resolution || DEFAULT_RESOLUTION);
    // Opening a different project folder is a fresh start, not an edit —
    // fresh undo history, same as New Project.
    resetProjectHistoryState({
      entities: loaded.entities, // 0 clips if empty project!
      tracks: loaded.tracks,
      scripts: loaded.scripts,   // only files actually on disk
      prefabs: loaded.prefabs,
    });
    setMediaAssets(loaded.mediaAssets);
    setSelectedEntityId(null);
    setSaveStatus('saved');
    // P1 #6 — surface a too-new project.json schemaVersion in the UI
    // (previously this only reached console.warn); null clears any
    // warning left over from a previously opened project.
    setSchemaWarning?.(loaded.schemaWarning || null);
    setScreen('editor');
 
    // Compile EVERY script up front with esbuild, so by the time the user
    // scrubs the sync compile path's cache is already warm (and the
    // Inspector shows "Compiling…" instead of a false error while it is).
    precompileAllProjectScripts(loaded.scripts, dirHandle).catch(() => {});
 
    recordProjectOpened(dirHandle, loaded.projectName, null).catch((err) => {
      console.warn('Could not record project in recent list:', err);
    });
  }, [resetProjectHistoryState]);
 
  // Open & Load an existing Project Folder from Disk via the native picker
  // (used by the in-editor "Open" button, and by the Hub's "Open Folder"
  // action once it has a handle from its own picker call).
  const handleOpenProjectFolder = useCallback(async (dirHandleFromCaller) => {
    try {
      const dirHandle = dirHandleFromCaller || (await pickProjectDirectory());
      await openProjectFromHandle(dirHandle);
    } catch (err) {
      if (err.name !== 'AbortError') {
        alert(`Failed to open project folder: ${err.message}`);
      }
    }
  }, [openProjectFromHandle]);
 
  // Reopen a project directly from a Hub "recent" entry — it already has a
  // stored dirHandle, so this just needs to re-confirm permission (browsers
  // don't persist FS Access permission grants across app restarts even
  // though they persist the handle itself) before loading it the same way
  // as any other Open Folder flow. Left to throw on failure — the Hub
  // screen surfaces the error inline instead of via alert().
  const handleOpenRecentProject = useCallback(async (entry) => {
    const hasPermission = await verifyPermission(entry.dirHandle, true);
    if (!hasPermission) {
      throw new Error(`Permission to access "${entry.name}" was not granted.`);
    }
    await openProjectFromHandle(entry.dirHandle);
  }, [openProjectFromHandle]);
 
  // Hot-Reload: Poll scripts/ directory for external edits in VS Code
  //
  // PERF/FREEZE FIX -- this previously listed `scripts` in its dependency
  // array. Every time a poll found a real change and called setScripts, this
  // effect re-ran (new `scripts` identity), tearing down and recreating the
  // interval. Worse, there was no "poll in progress" guard (unlike the
  // autosave effect in App.jsx, which has `isAutoSavingRef`):
  // checkScriptsForChanges does real File System Access API I/O
  // (getDirectoryHandle -> iterate -> getFile -> file.text() per script
  // file), and on a slow disk or with many script files that can take
  // longer than the 2000ms interval. When that happens, overlapping polls
  // pile up awaiting file reads on the main thread -- which reads as a
  // freeze that (a) doesn't require anything on the timeline, since it only
  // needs `projectFolderHandle` to be set, and (b) gets worse with more
  // objects/scripts, since each poll iterates every script file.
  // `scriptsRef` lets the interval read the latest scripts without
  // restarting on every change, and `isPollingRef` skips a tick entirely if
  // the previous one hasn't finished yet, matching the guard pattern the
  // autosave effect already uses.
  const scriptsRef = useRef(scripts);
  useEffect(() => {
    scriptsRef.current = scripts;
  }, [scripts]);
 
  const isPollingScriptsRef = useRef(false);
  useEffect(() => {
    if (!projectFolderHandle) return;
 
    let disposed = false;
    let unwatchFn = null;
    let poller = null;
 
    // Shared by both the native watcher callback and the browser poll
    // fallback below — re-scan scripts/ and apply + precompile any diff.
    const refreshScripts = async () => {
      if (isPollingScriptsRef.current) return;
      isPollingScriptsRef.current = true;
      try {
        const updatedScripts = await checkScriptsForChanges(projectFolderHandle, scriptsRef.current);
        if (updatedScripts && !disposed) {
          setScripts(updatedScripts);
          // An external edit may have changed any script — recompile every
          // changed one in the background (unchanged ones are skipped by
          // exact source string).
          precompileAllProjectScripts(updatedScripts, projectFolderHandle).catch(() => {});
        }
      } finally {
        isPollingScriptsRef.current = false;
      }
    };
 
    // Hot-Reload — two backends, same refreshScripts core:
    //
    // 1. Tauri desktop: subscribe to OS file-system events on scripts/
    //    (create/modify/remove, recursive, debounced) for near-instant
    //    reload with zero polling overhead. watchScriptsDirectory returns
    //    an unwatch fn when the native watcher is active, or null when
    //    running in a plain browser / the watcher can't be created.
    // 2. Browser fallback: the old 2s setInterval poll. Kept only for
    //    `npm run dev` in a browser — native events don't exist there.
    watchScriptsDirectory(projectFolderHandle, refreshScripts).then((unwatch) => {
      if (disposed) {
        try { unwatch?.(); } catch { /* already unregistered */ }
        return;
      }
      unwatchFn = unwatch;
      if (!unwatchFn) {
        poller = setInterval(() => {
          refreshScripts();
        }, 2000);
      }
    });
 
    return () => {
      disposed = true;
      if (unwatchFn) {
        try { unwatchFn(); } catch { /* already unregistered */ }
      }
      if (poller) clearInterval(poller);
    };
  }, [projectFolderHandle]);
 


  const saveStatusRef = useRef(saveStatus);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);

  const isCheckingProjectRef = useRef(false);
  const debounceProjectTimerRef = useRef(null);

  useEffect(() => {
    if (!projectFolderHandle) return;

    let disposed = false;
    let unwatchFn = null;
    let poller = null;

    const handleProjectJsonChanged = () => {
      if (disposed) return;
      if (debounceProjectTimerRef.current) {
        clearTimeout(debounceProjectTimerRef.current);
      }
      debounceProjectTimerRef.current = setTimeout(async () => {
        if (disposed || isCheckingProjectRef.current) return;
        isCheckingProjectRef.current = true;
        try {
          const changed = await checkProjectJsonForChanges(projectFolderHandle);
          if (!changed || disposed) return;

          const currentStatus = saveStatusRef.current;
          if (currentStatus === 'saved') {
            console.info('project.json changed externally; reloading project...');
            await openProjectFromHandle(projectFolderHandle);
          } else {
            const confirmReload = typeof window !== 'undefined' && window.confirm(
              'project.json was modified externally, but you have unsaved changes in the editor.\n\n' +
              'Reload from disk and discard your unsaved changes?'
            );
            if (confirmReload && !disposed) {
              await openProjectFromHandle(projectFolderHandle);
            }
          }
        } catch (err) {
          console.warn('Failed to handle external project.json update:', err);
        } finally {
          isCheckingProjectRef.current = false;
        }
      }, 300);
    };

    watchProjectFile(projectFolderHandle, handleProjectJsonChanged).then((unwatch) => {
      if (disposed) {
        try { unwatch?.(); } catch {}
        return;
      }
      unwatchFn = unwatch;
      if (!unwatchFn) {
        poller = setInterval(() => {
          handleProjectJsonChanged();
        }, 2000);
      }
    });

    return () => {
      disposed = true;
      if (debounceProjectTimerRef.current) {
        clearTimeout(debounceProjectTimerRef.current);
      }
      if (unwatchFn) {
        try { unwatchFn(); } catch {}
      }
      if (poller) clearInterval(poller);
    };
  }, [projectFolderHandle, openProjectFromHandle]);

  return {
    handleProjectCreated,
    handleOpenProjectFolder,
    handleOpenRecentProject,
  };
}