import { useCallback, useEffect, useRef } from 'react';
import { getAutosaveMaxWaitMs } from '../services/autosaveSettings';
 
/**
 * useProjectAutosave — decides WHEN the project is written to disk.
 * (HOW a save runs — one at a time, coalesced follow-ups, status badge — is
 * useProjectPersistence's `requestSave`.)
 *
 * Called from App.jsx AFTER `projectState` exists, unlike useProjectPersistence
 * which has to be called before it (see that hook's header). That ordering is
 * the point of this hook being separate: it can depend on the real document
 * data instead of a getter function.
 *
 * Why it depends on the individual document slices, not on a getter:
 * the autosave effect used to depend on `getProjectState`, an inline arrow
 * `() => projectState` created anew on EVERY App render. So any re-render —
 * selecting a clip, opening a modal, focusing a panel — restarted the debounce
 * and ended in a full save even though nothing in the document had changed.
 * Here the effect depends only on the pieces that are actually written to
 * disk (projectName, resolution, tracks, entities, scripts, prefabs), whose
 * identities change only when the document does. `mediaAssets` is left out on
 * purpose: it is never written to project.json, so an asset finishing its
 * thumbnail/duration probe shouldn't cause a save.
 *
 * Behaviors (each driven by the Settings > Autosave tab):
 *  - enabled       master switch; off = only manual saves touch the disk.
 *  - delayMs       debounce: save this long after the LAST change.
 *  - max wait      a burst of edits can't postpone a save forever: it is forced
 *                  at most getAutosaveMaxWaitMs(delayMs) after the burst began.
 *  - saveOnBlur    flush a pending change immediately when the window loses
 *                  focus / is hidden / is closing (best effort on close: the OS
 *                  may end the process before async file writes complete).
 *  - skipUnchanged forwarded to the save (don't rewrite identical project.json
 *                  / prefab files).
 *
 * The first document snapshot seen after a folder is opened or created is
 * treated as "what is on disk" and is not saved: opening a project no longer
 * rewrites it, only real edits do.
 *
 * @param {object} args
 * @param {FileSystemDirectoryHandle|null} args.projectFolderHandle
 * @param {object}   args.projectState  { projectName, resolution, tracks, entities, scripts, prefabs, ... }
 * @param {Function} args.requestSave   from useProjectPersistence
 * @param {Function} args.setSaveStatus from useProjectPersistence
 * @param {{ enabled: boolean, delayMs: number, saveOnBlur: boolean, skipUnchanged: boolean }} args.settings
 */
export function useProjectAutosave({
  projectFolderHandle,
  projectState,
  requestSave,
  setSaveStatus,
  settings,
}) {
  const { enabled, delayMs, saveOnBlur, skipUnchanged } = settings;
  const maxWaitMs = getAutosaveMaxWaitMs(delayMs);
  const { projectName, resolution, tracks, entities, scripts, prefabs } = projectState;
 
  const timerRef = useRef(null);
  // 0 = nothing pending; otherwise when the current burst of unsaved edits began.
  const dirtySinceRef = useRef(0);
  const baselineHandleRef = useRef(null);
  const skipUnchangedRef = useRef(skipUnchanged);
  skipUnchangedRef.current = skipUnchanged;
  const setSaveStatusRef = useRef(setSaveStatus);
  setSaveStatusRef.current = setSaveStatus;
 
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
 
  // Save right now (used by the debounce timer and by the blur/close flush).
  const saveNow = useCallback(() => {
    clearTimer();
    dirtySinceRef.current = 0;
    return requestSave({ skipUnchanged: skipUnchangedRef.current }).then(() => {
      // Edits that landed while this save was running are still unsaved.
      if (dirtySinceRef.current) setSaveStatusRef.current?.('unsaved');
    });
  }, [clearTimer, requestSave]);
 
  // 1) Note that the document changed. Declared before the scheduler effect so
  //    that, within one commit, the flag is set before the scheduler reads it.
  useEffect(() => {
    if (!projectFolderHandle) {
      baselineHandleRef.current = null;
      dirtySinceRef.current = 0;
      return;
    }
    if (baselineHandleRef.current !== projectFolderHandle) {
      // First snapshot for this folder = what was just loaded/created.
      baselineHandleRef.current = projectFolderHandle;
      dirtySinceRef.current = 0;
      return;
    }
    if (!dirtySinceRef.current) dirtySinceRef.current = Date.now();
    setSaveStatusRef.current?.('unsaved');
  }, [projectFolderHandle, projectName, resolution, tracks, entities, scripts, prefabs]);
 
  // 2) Debounce: (re)arm the timer whenever the document or a setting changes.
  useEffect(() => {
    if (!enabled || !projectFolderHandle || !dirtySinceRef.current) return undefined;
 
    const elapsed = Date.now() - dirtySinceRef.current;
    const wait = Math.max(0, Math.min(delayMs, maxWaitMs - elapsed));
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      saveNow();
    }, wait);
    return clearTimer;
  }, [
    enabled, projectFolderHandle, delayMs, maxWaitMs,
    projectName, resolution, tracks, entities, scripts, prefabs,
    saveNow, clearTimer,
  ]);
 
  // 3) Flush a pending change when the user leaves the window or it closes.
  useEffect(() => {
    if (!enabled || !saveOnBlur || !projectFolderHandle) return undefined;
 
    const flush = () => {
      if (dirtySinceRef.current) saveNow();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
 
    window.addEventListener('blur', flush);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', flush);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, saveOnBlur, projectFolderHandle, saveNow]);
}