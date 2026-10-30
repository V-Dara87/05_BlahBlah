/**
 * File System Access Service for blahblah Video Editor.
 * Enables creating new blank project folders on disk, loading existing projects,
 * auto-saving, and hot-reloading from external code editors (VS Code, Cursor, etc.).
 */
 
import { CURRENT_SCHEMA_VERSION, DEFAULT_RESOLUTION } from '../types';
import {
  computeTextHash,
  ProjectConflictError,
} from '../utils/projectRevision.js';
export { computeTextHash, ProjectConflictError };
// Schema gate + migrations — pure functions in ecs.js (Node-importable +
// unit-tested), not here, because this module's `?raw` SDK import below
// breaks plain-Node tests. migrateEntities is the schemaVersion 0 → 1
// migration (old component types / keyframe tracks); migrateProjectSchema
// is the placeholder chain for future versions.
import {
  migrateEntities,
  migrateProjectSchema,
  readProjectSchemaVersion,
  warnIfSchemaVersionTooNew,
} from '../engine/ecs';
// Raw text of the SDK's type declarations, bundled at build time via
// Vite's `?raw` import so the copy written into new projects (see
// `createNewProjectFolder` below) always matches whatever is actually
// in `packages/blahblah-sdk/index.d.ts` — no separate file to keep in
// sync by hand.
import blahblahSdkDts from '../../packages/blahblah-sdk/index.d.ts?raw';
// Raw text of the SDK's runtime (the actual MotionScript/CanvasComponent
// classes `extends` resolves against at edit-time if an editor peeks past
// the .d.ts — e.g. "Go to Definition"). Vendored alongside index.d.ts for
// the same reason: scriptBundler.js resolves `@blahblah/sdk` to its OWN
// bundled copy of this file at RUN time (never reads this per-project
// copy), so this file is purely an editor-side convenience, same as the
// .d.ts. Both are written from the same source of truth
// (packages/blahblah-sdk/) so they can't drift from each other.
import blahblahSdkSource from '../../packages/blahblah-sdk/index.js?raw';
import blahblahSdkAmbientDts from '../../packages/blahblah-sdk/ambient.d.ts?raw';
 
/**
 * Basic shape validation for a `resolution` object read back from disk --
 * project.json is hand-editable (that's the whole "VS Code ready" point of
 * this app), so a stray typo or an older project saved before resolution
 * existed shouldn't crash the load; it should just fall back to the
 * default and let the project open normally.
 */
function sanitizeResolution(candidate) {
  const width = Number(candidate?.width);
  const height = Number(candidate?.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  return { ...DEFAULT_RESOLUTION };
}
 
// ─── Script type + file-extension unification ────────────────────────────────
//
// There is ONE script component type now — 'ScriptComponent' — covering
// motion scripts, React components, and Canvas components (the runtime
// dispatches per script kind, see detectScriptKind). Older projects saved
// ReactRenderer / CanvasRenderer / MonoBehaviour components and keyframed
// their props under 'ReactRenderer' / 'CanvasRenderer' track keys; both are
// migrated on load. Script FILES are canonicalized to `.jsx` on write
// (the extension never meant anything to the engine — everything compiles
// through the same JSX/TS loader); reads stay permissive so old files and
// relative imports like './helpers.js' keep working.
 
const SCRIPT_EXT_RE = /\.(js|jsx|ts|tsx)$/i;
const isScriptFile = (name) => SCRIPT_EXT_RE.test(name || '');
 
/** Canonical .jsx filename for a script (any supported extension accepted). */
const toScriptFileName = (name) => `${(name || '').replace(/\.(js|jsx|ts|tsx|cs)$/i, '')}.jsx`;
 
 
 
import { isTauri, createTauriDirectoryHandle, joinPath, isSafeChildName } from './tauriFsAdapter';
import { convertFileSrc } from '@tauri-apps/api/core';
// Real media duration probing (metadata-only, same technique + fallback as
// the import path) — reused here because reload rebuilds mediaAssets by
// scanning media/ on disk and must not stamp a placeholder duration.
import { probeMediaElementDuration, MEDIA_FALLBACK_DURATION } from './mediaImport';
 
// ─── Save coordination: per-project lock + "last synced" cache ───────────────
//
// Three different code paths write files into a project folder: the debounced
// autosave (saveProjectToDirectory), the direct single-file writers the UI
// calls on explicit actions (writeScriptFile / renameScriptFile /
// writePrefabFile / delete*), and — in the other direction — hot-reload, which
// pulls external edits from disk into memory. Left uncoordinated they race:
// an autosave that snapshotted state a moment earlier can finish AFTER a
// direct write and clobber it with the stale snapshot. That is the "my script
// got overwritten" failure mode.
//
// Two pieces of per-project state (keyed by the directory handle, so a
// different project or a re-opened handle starts clean) prevent that:
//
//  1. `lock` — a promise chain. Every writer runs inside withProjectLock, so
//     writes are strictly serialized and an autosave takes its state snapshot
//     only once it owns the lock (see saveProjectToDirectory).
//  2. Caches of what we last put on / verified against disk:
//       - projectFingerprint / prefabs: what was last WRITTEN, so an unchanged
//         file isn't rewritten (the Settings > Autosave "skip unchanged" switch);
//       - scripts: the last code known to match disk for each script file. This
//         is the "base" of a 3-way decision (memory / disk / base) that decides
//         whether memory or disk is the newer side — no file timestamps are
//         used, because the Tauri file adapter's getFile() stamps every File
//         with "now" instead of the real modification time.
//       - tombstones: script files that were just deleted/renamed, so a stale
//         snapshot can't resurrect them.
const projectSyncStates = new WeakMap();
const SCRIPT_TOMBSTONE_TTL_MS = 5000;
 
function getSyncState(dirHandle) {
  if (!dirHandle || (typeof dirHandle !== 'object' && typeof dirHandle !== 'function')) return null;
  let state = projectSyncStates.get(dirHandle);
  if (!state) {
    state = {
      lock: Promise.resolve(),
      projectFingerprint: null,
      revision: null,
      prefabs: new Map(),
      scripts: new Map(),
      tombstones: new Map(),
    };
    projectSyncStates.set(dirHandle, state);
  }
  return state;
}
 
/** Runs `task` after every previously queued write for this project finished. */
function withProjectLock(dirHandle, task) {
  const state = getSyncState(dirHandle);
  if (!state) return Promise.resolve().then(task);
  const run = state.lock.then(task, task);
  state.lock = run.then(() => undefined, () => undefined);
  return run;
}
 
/**
 * Reads + parses project.json, falling back to project.json.bak when the main
 * file is corrupt (e.g. a crash during a non-atomic write by an older build).
 * Throws a NotFoundError when there is no project.json at all, and a clear
 * Error when it exists but neither it nor its backup can be parsed — so an
 * unreadable project is never silently treated as empty and overwritten.
 */
async function readProjectJsonWithBackup(dirHandle) {
  const readParsed = async (fileName) => {
    const handle = await dirHandle.getFileHandle(fileName);
    const raw = await (await handle.getFile()).text();
    return { parsed: JSON.parse(raw), raw };
  };
  try {
    return await readParsed('project.json');
  } catch (err) {
    if (err?.name === 'NotFoundError') throw err;
    try {
      const backup = await readParsed('project.json.bak');
      console.warn('project.json could not be read; restored from project.json.bak.', err);
      return backup;
    } catch {
      throw new Error(
        `project.json is unreadable and no valid backup was found (${err?.message || err}). ` +
        'The project was not opened so that it cannot be overwritten.'
      );
    }
  }
}

const prefabFileName = (name) => (name.endsWith('.json') ? name : `${name}.prefab.json`);
 
/**
 * Brings one scripts/<fileName> in line with `code` — but only when memory is
 * genuinely the newer side. Returns nothing; the outcome is the file state.
 *
 *   known   = last code we know matched disk (state.scripts), or undefined
 *   code    = what memory holds
 *   disk    = what is on disk right now
 *
 *   code === known                -> nothing to push (don't even read disk).
 *                                    This also makes a stale in-flight snapshot
 *                                    harmless: if hot-reload already adopted an
 *                                    external edit, the snapshot still equals
 *                                    `known` and is skipped.
 *   disk  === code                -> already in sync, just remember it.
 *   disk  === known (or unknown)  -> memory changed since the last sync: write.
 *   disk differs from both        -> disk was edited externally AND memory
 *                                    differs: keep disk, hot-reload will pull it.
 */
async function syncScriptFile(scriptsDirHandle, state, fileName, code) {
  const known = state ? state.scripts.get(fileName) : undefined;
  if (known !== undefined && known === code) return;
 
  if (state) {
    const removedAt = state.tombstones.get(fileName);
    if (removedAt !== undefined) {
      if (Date.now() - removedAt < SCRIPT_TOMBSTONE_TTL_MS) return;
      state.tombstones.delete(fileName);
    }
  }
 
  let existingHandle = null;
  try {
    existingHandle = await scriptsDirHandle.getFileHandle(fileName, { create: false });
  } catch {
    // NotFoundError: the file doesn't exist yet, fall through and create it.
  }
 
  if (existingHandle) {
    const diskCode = await (await existingHandle.getFile()).text();
    if (diskCode === code) {
      if (state) state.scripts.set(fileName, code);
      return;
    }
    if (known !== undefined && diskCode !== known) {
      console.warn(
        `Autosave kept the on-disk version of scripts/${fileName}: it was edited outside the app ` +
        'and differs from the in-memory copy. The external version will be reloaded.'
      );
      return;
    }
  }
 
  const fileHandle = existingHandle || (await scriptsDirHandle.getFileHandle(fileName, { create: true }));
  const writable = await fileHandle.createWritable();
  await writable.write(code);
  await writable.close();
  if (state) state.scripts.set(fileName, code);
}
 
/**
 * Write (or overwrite) the vendored `@blahblah/sdk` copy — index.d.ts +
 * index.js — plus scripts/jsconfig.json into a project's scripts/ folder.
 * Shared by createNewProjectFolder (brand-new projects) and
 * loadProjectFromDirectory (existing projects opened before this SDK
 * existed, or before jsconfig.json existed) so both paths get the same
 * up-to-date SDK copy instead of only new projects getting one. Safe to
 * call on every load: it always overwrites with the current bundled
 * source, so a stale per-project copy from an older blahblah version
 * self-heals the next time the project is opened.
 */
async function writeSdkFiles(scriptsDirHandle) {
  const blahblahDirHandle = await scriptsDirHandle.getDirectoryHandle('.blahblah', { create: true });
  const sdkDirHandle = await blahblahDirHandle.getDirectoryHandle('sdk', { create: true });
 
  const sdkDtsHandle = await sdkDirHandle.getFileHandle('index.d.ts', { create: true });
  const sdkDtsWritable = await sdkDtsHandle.createWritable();
  await sdkDtsWritable.write(blahblahSdkDts);
  await sdkDtsWritable.close();
 
  const sdkJsHandle = await sdkDirHandle.getFileHandle('index.js', { create: true });
  const sdkJsWritable = await sdkJsHandle.createWritable();
  await sdkJsWritable.write(blahblahSdkSource);
  await sdkJsWritable.close();
 
  const sdkAmbientDtsHandle = await sdkDirHandle.getFileHandle('ambient.d.ts', { create: true });
  const sdkAmbientDtsWritable = await sdkAmbientDtsHandle.createWritable();
  await sdkAmbientDtsWritable.write(blahblahSdkAmbientDts);
  await sdkAmbientDtsWritable.close();
 
  // Only create jsconfig.json if the project doesn't already have one —
  // unlike the SDK files above, this one may have been hand-edited by the
  // user (compilerOptions tweaks, added paths, etc.) and blindly
  // overwriting it on every load would silently discard those edits.
  let hasJsconfig = true;
  try {
    await scriptsDirHandle.getFileHandle('jsconfig.json', { create: false });
  } catch {
    hasJsconfig = false;
  }
  if (!hasJsconfig) {
    const jsconfig = {
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react',
        allowJs: true,
        checkJs: true,
        // baseUrl + ignoreDeprecations: paths requires baseUrl to resolve
        // @blahblah/sdk. baseUrl is deprecated in TS 6.0+ but still works;
        // ignoreDeprecations silences the deprecation warning VS Code shows.
        baseUrl: '.',
        ignoreDeprecations: '6.0',
        // paths must be inside compilerOptions — placing it at the top level
        // of jsconfig is silently ignored by TypeScript, which is why
        // "@blahblah/sdk" showed "Cannot find module" even with baseUrl set.
        paths: {
          '@blahblah/sdk': ['./.blahblah/sdk'],
        },
        // Disable strict checks that produce noise in plain-JS scripts:
        // implicit-any fires on every destructured parameter that has no
        // type annotation, and strictNullChecks fires on normal canvas/DOM
        // patterns. Both are off by default in jsconfig — only real errors
        // (undefined names, wrong property access, etc.) stay visible.
        noImplicitAny: false,
        strictNullChecks: false,
      },
      include: ['**/*', '.blahblah/**/*'],
    };
    const jsconfigHandle = await scriptsDirHandle.getFileHandle('jsconfig.json', { create: true });
    const jsconfigWritable = await jsconfigHandle.createWritable();
    await jsconfigWritable.write(JSON.stringify(jsconfig, null, 2));
    await jsconfigWritable.close();
  }
}
 
export function isFileSystemSupported() {
  return isTauri() || (typeof window !== 'undefined' && 'showDirectoryPicker' in window);
}
 
/**
 * Verify / Request readwrite permissions for a directory handle.
 */
export async function verifyPermission(dirHandle, readWrite = true) {
  if (!dirHandle) return false;
  if (dirHandle.isTauri) return true;
  const options = {};
  if (readWrite) {
    options.mode = 'readwrite';
  }
 
  try {
    if ((await dirHandle.queryPermission(options)) === 'granted') {
      return true;
    }
    if ((await dirHandle.requestPermission(options)) === 'granted') {
      return true;
    }
  } catch (err) {
    console.warn('Permission query/request error:', err);
  }
  return false;
}
 
/**
 * Prompt user to select a directory on their computer.
 * Supports both Tauri native dialog and browser File System Access API.
 */
export async function pickProjectDirectory() {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Project Directory',
    });
    if (!selected) {
      const err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      throw err;
    }
    return createTauriDirectoryHandle(selected);
  }
 
  if (!isFileSystemSupported()) {
    throw new Error('File System Access API is not supported in this browser. Please use Chrome, Edge, or Brave.');
  }
 
  const dirHandle = await window.showDirectoryPicker({
    mode: 'readwrite',
  });
 
  const hasPermission = await verifyPermission(dirHandle, true);
  if (!hasPermission) {
    throw new Error(
      `Could not get read/write permission for "${dirHandle.name}". ` +
      `If you're using Brave, try lowering Shields (Fingerprinting protection) for this site, ` +
      `or check the address bar for a blocked permission prompt.`
    );
  }
 
  return dirHandle;
}
/**
 * Create a new dedicated project subfolder inside a chosen parent directory.
 * Sets up project.json (0 clips), scripts/ (empty), prefabs/ (empty), media/ (empty).
 */
export async function createNewProjectFolder(parentDirHandle, projectName, defaultTracks = [], resolution = DEFAULT_RESOLUTION) {
  if (!parentDirHandle) {
    throw new Error('Parent directory is required');
  }
 
  await verifyPermission(parentDirHandle, true);
 
  // Clean folder name
  const safeName = projectName.trim().replace(/[\\/:*?"<>|]/g, '-');
  if (!safeName) {
    throw new Error('Please enter a valid project name');
  }
 
  // Create the project directory inside parent
  const projectDirHandle = await parentDirHandle.getDirectoryHandle(safeName, { create: true });
  await verifyPermission(projectDirHandle, true);
 
  // Create subfolders
  const scriptsDirHandle = await projectDirHandle.getDirectoryHandle('scripts', { create: true });
  await projectDirHandle.getDirectoryHandle('prefabs', { create: true });
  await projectDirHandle.getDirectoryHandle('media', { create: true });
 
  // Vendor a copy of the SDK (index.d.ts + index.js) and scripts/
  // jsconfig.json into the project itself, instead of pointing jsconfig
  // at `../packages/blahblah-sdk`. That relative path only worked if the
  // project folder happened to be created next to this repo's
  // `packages/` folder, but `pickProjectDirectory()` lets the user
  // choose ANY location on disk via the native folder picker — for
  // most users the relative path pointed at nothing and type
  // resolution silently failed. A self-contained per-project copy works
  // no matter where the project lives. See writeSdkFiles for why this is
  // shared with loadProjectFromDirectory rather than being new-project-only.
  await writeSdkFiles(scriptsDirHandle);
 
  const projectResolution = sanitizeResolution(resolution);
 
  const initialProjectJson = {
    name: safeName,
    version: '1.0',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: Date.now(),
    lastModified: Date.now(),
    resolution: projectResolution,
    tracks: defaultTracks.length > 0 ? defaultTracks : [
      { id: 'track-1', name: 'Track 1', type: 'layer', muted: false, locked: false, visible: true, volume: 1.0 },
      { id: 'track-2', name: 'Track 2', type: 'layer', muted: false, locked: false, visible: true, volume: 1.0 },
      { id: 'track-3', name: 'Track 3', type: 'layer', muted: false, locked: false, visible: true, volume: 1.0 },
      { id: 'track-4', name: 'Track 4', type: 'layer', muted: false, locked: false, visible: true, volume: 1.0 },
    ],
    entities: [],
    // See saveProjectToDirectory / loadProjectFromDirectory below: maps each
    // scripts/ filename back to the script id that ScriptComponent
    // components reference in their `scriptId` field, so ids survive a save
    // + reload instead of being re-derived from the filename (which loses
    // any id that wasn't already filename-shaped, e.g. ids created as
    // `script-${Date.now()}`).
    scriptIndex: [],
  };
 
  const projectJsonStr = JSON.stringify(initialProjectJson, null, 2);
  const projectFileHandle = await projectDirHandle.getFileHandle('project.json', { create: true });
  const writable = await projectFileHandle.createWritable();
  await writable.write(projectJsonStr);
  await writable.close();
  const newSyncState = getSyncState(projectDirHandle);
  if (newSyncState) {
    newSyncState.revision = await computeTextHash(projectJsonStr);
    newSyncState.projectFingerprint = JSON.stringify({ ...initialProjectJson, lastModified: 0 });
  }
 
  return {
    dirHandle: projectDirHandle,
    projectName: safeName,
    resolution: projectResolution,
    tracks: initialProjectJson.tracks,
    entities: [],
    scripts: [],
    prefabs: [],
    mediaAssets: [],
  };
}
 
/**
 * Load project state from a directory handle.
 * Reads project.json, scripts/, prefabs/, and media/.
 * Starts completely clean (0 dummy clips) if empty.
 */
export async function loadProjectFromDirectory(dirHandle, fallbackTracks = []) {
  if (!dirHandle) return null;
  await verifyPermission(dirHandle, true);
 
  // P1 #6 — surfaced up through the return value (see `return` below) so
  // the caller can show it in the UI. Previously warnIfSchemaVersionTooNew
  // only reached console.warn, so a project saved by a newer build could
  // silently lose data on the next save with no way for the user to know
  // short of opening devtools.
  let schemaWarning = null;
 
  let projectMeta = {
    name: dirHandle.name || 'my-project',
    tracks: fallbackTracks,
    entities: [],
    resolution: { ...DEFAULT_RESOLUTION },
  };    // scriptIndex maps a scripts/ filename -> the script id it was saved
    // with, so ids created in-app (e.g. `script-${Date.now()}`) survive a
    // save + reload instead of being replaced by a filename-derived id that
    // nothing on the timeline actually references. Keyed by filename since
    // that's the only thing that reliably ties a project.json record back to
    // a file that may have been renamed/edited/added outside the app.
    // (ScriptComponent.scriptId is the only place those ids are referenced.)
  let scriptIndex = new Map();
 
  let projectRaw = null;
  // 1. Read project.json if present
  try {
    const { parsed, raw } = await readProjectJsonWithBackup(dirHandle);
    projectRaw = raw;
    // Schema gate — a project from a NEWER build warns (never blocks the
    // load); a missing schemaVersion reads as 0, which is exactly the
    // pre-unification format migrateEntities below handles (the 0 → 1
    // migration). migrateProjectSchema is the future structural-migration
    // chain (currently a pass-through).
    const fromVersion = readProjectSchemaVersion(parsed);
    schemaWarning = warnIfSchemaVersionTooNew(parsed);
    const schemaProject = migrateProjectSchema(parsed, fromVersion, CURRENT_SCHEMA_VERSION);
    projectMeta = {
      name: schemaProject.name || dirHandle.name,
      tracks: schemaProject.tracks && schemaProject.tracks.length > 0 ? schemaProject.tracks : fallbackTracks,
      entities: migrateEntities(Array.isArray(schemaProject.entities) ? schemaProject.entities : []),
      // Older projects saved before resolution existed (or a hand-edited
      // project.json missing/mangling it) fall back to the default rather
      // than failing to load.
      resolution: sanitizeResolution(schemaProject.resolution),
    };
    if (Array.isArray(schemaProject.scriptIndex)) {
      scriptIndex = new Map(
        schemaProject.scriptIndex
          .filter((entry) => entry && entry.name && entry.id)
          .map((entry) => [entry.name, entry])
      );
    }
  } catch (err) {
    // A missing project.json is fine (it is created on save). Anything else
    // means an existing project could not be read: stop rather than let the
    // next autosave overwrite it with an empty project.
    if (err?.name !== 'NotFoundError') throw err;
  }
 
  // 2. Read scripts/ folder
  const loadedScripts = [];
  // A fresh load is the ground truth for what is on disk: reset this handle's
  // write caches (they may be left over from an earlier open of the same
  // folder) and seed the scripts cache below with exactly what we read.
  const syncState = getSyncState(dirHandle);
  if (syncState) {
    syncState.projectFingerprint = null;
    syncState.revision = projectRaw ? await computeTextHash(projectRaw) : null;
    syncState.prefabs.clear();
    syncState.scripts.clear();
    syncState.tombstones.clear();
  }
  try {
    const scriptsDirHandle = await dirHandle.getDirectoryHandle('scripts', { create: true });
    // Self-heal projects created/opened before @blahblah/sdk existed (or
    // whose vendored copy predates a newer SDK): (re)write index.d.ts +
    // index.js unconditionally, and add jsconfig.json only if missing —
    // same helper createNewProjectFolder uses, see writeSdkFiles for the
    // overwrite-vs-preserve rationale. Best-effort: a permission issue or
    // read-only mount here shouldn't block the project from loading.
    try {
      await writeSdkFiles(scriptsDirHandle);
    } catch (err) {
      console.warn('Could not write/update @blahblah/sdk files in scripts/:', err);
    }
    for await (const entry of scriptsDirHandle.values()) {
      if (entry.kind === 'file' && isScriptFile(entry.name)) {
        const file = await entry.getFile();
        const code = await file.text();
        // Prefer the id recorded in project.json's scriptIndex for this
        // filename (keeps ScriptComponent.scriptId references intact across
        // save/reload); only fall back to a filename-derived id for scripts
        // that have no index entry yet (e.g. a file dropped into scripts/
        // by hand, or a project saved before scriptIndex existed).
        const indexed = scriptIndex.get(entry.name);
        if (syncState) syncState.scripts.set(toScriptFileName(entry.name), code);
        loadedScripts.push({
          id: indexed ? indexed.id : `script-${entry.name.replace(/\.[^.]+$/, '')}`,
          name: entry.name,
          description: indexed ? indexed.description : undefined,
          // Folder + sort metadata round-trip through scriptIndex (the
          // code itself lives in the file, so it's the only place these
          // panel-level fields can persist).
          folder: indexed?.folder ?? null,
          createdAt: indexed?.createdAt ?? undefined,
          // Shared Library baseline ({ sharedName, hash }) — see
          // hooks/useSharedLibraryActions.js. Undefined for scripts that never
          // touched the library.
          origin: indexed?.origin ?? undefined,
          code: code,
          lastModified: file.lastModified,
        });
      }
    }
  } catch (err) {
    console.warn('Could not read scripts directory:', err);
  }
 
  // 3. Read prefabs/ folder
  const loadedPrefabs = [];
  try {
    const prefabsDirHandle = await dirHandle.getDirectoryHandle('prefabs', { create: true });
    const prefabEntries = [];
    for await (const entry of prefabsDirHandle.values()) {
      if (entry.kind === 'directory' && !entry.name.startsWith('.')) {
        try {
          const subDirHandle = await prefabsDirHandle.getDirectoryHandle(entry.name, { create: false });
          for await (const subEntry of subDirHandle.values()) {
            prefabEntries.push({ entry: subEntry, folderName: entry.name });
          }
        } catch (err) {
          console.warn(`Could not read prefabs subfolder ${entry.name}:`, err);
        }
      } else if (entry.kind === 'file') {
        prefabEntries.push({ entry, folderName: null });
      }
    }
 
    for (const { entry, folderName } of prefabEntries) {
      if (entry.kind === 'file' && (entry.name.endsWith('.json') || entry.name.endsWith('.prefab'))) {
        const file = await entry.getFile();
        const text = await file.text();
        try {
          const prefabObj = JSON.parse(text);
          const isNested = Array.isArray(prefabObj.entities);
          loadedPrefabs.push({
            id: `prefab-${(folderName ? `${folderName}-` : '')}${entry.name.replace(/\.[^.]+$/, '')}`,
            name: prefabObj.name || entry.name,
            type: prefabObj.type || 'prefab',
            rootId: prefabObj.rootId ?? null,
            ...(folderName ? { folder: folderName } : (prefabObj.folder ? { folder: prefabObj.folder } : {})),
            // Same ReactRenderer/CanvasRenderer/MonoBehaviour migration as
            // entities, applied to the prefab's component list(s). Nested
            // prefabs carry an `entities` array (root + children snapshot);
            // legacy flat prefabs carry only `components`.
            components: isNested
              ? prefabObj.components || []
              : migrateEntities([{ components: prefabObj.components || [] }])[0].components,
            entities: isNested ? migrateEntities(prefabObj.entities) : undefined,
          });
        } catch {
          // Skip invalid JSON
        }
      }
    }
  } catch (err) {
    console.warn('Could not read prefabs directory:', err);
  }
 
  // 4. Read media/ folder (one level deep, so subfolders like
  // media/Recordings/ created by the voice-recording feature are also
  // picked back up on load and tagged with their folder name).
  const loadedMedia = [];
  const readMediaEntry = async (entry, folderName) => {
    if (entry.kind !== 'file') return null;
    // Hidden files are never media — and in particular the `.cache/` folder
    // (generated peak files) must never be picked up by a project scan.
    if (!entry.name || entry.name.startsWith('.')) return null;
    const ext = entry.name.toLowerCase();
    // Voice takes recorded by older builds were saved as audio-only .webm
    // (MediaRecorder/Opus) inside media/Recordings/. A bare .webm is normally a
    // VIDEO container, so without this they reloaded as video assets. Only the
    // Recordings folder is reclassified — real .webm video elsewhere (e.g. an
    // export dropped into media/) must stay video. New takes are .wav.
    const isLegacyRecording = folderName === 'Recordings' && ext.endsWith('.webm');
    const isVideo = !isLegacyRecording && (ext.endsWith('.mp4') || ext.endsWith('.webm') || ext.endsWith('.mov'));
    const isAudio = isLegacyRecording || ext.endsWith('.mp3') || ext.endsWith('.wav') || ext.endsWith('.ogg') || ext.endsWith('.aac');
 
    if (!isVideo && !isAudio) return null;
 
    // Tauri: stream straight off disk through the asset protocol
    // (HTTP Range requests) instead of slurping the whole file into
    // memory to make a blob URL — large video/audio files load in
    // O(1) and seek instantly. The native directory-handle adapter
    // exposes each entry's absolute `path`; size comes from a cheap
    // stat, not a full read.
    const isNative = isTauri() && entry.path;
    let url;
    let size = 0;
    if (isNative) {
      url = convertFileSrc(entry.path);
      try {
        const { stat } = await import('@tauri-apps/plugin-fs');
        const info = await stat(entry.path);
        size = info?.size || 0;
      } catch (err) {
        console.warn('Could not stat media file:', entry.path, err);
      }
    } else {
      const file = await entry.getFile();
      url = URL.createObjectURL(file);
      size = file.size;
    }
 
    // Re-derive the REAL duration with a metadata-only probe against the
    // playable URL (blob: in the browser, convertFileSrc asset URL under
    // Tauri) — same technique and fallback the import path uses. Without
    // this, reloading a project would stamp a placeholder on every asset
    // and silently discard the durations import probed correctly.
    const probedDuration = await probeMediaElementDuration(url, isVideo);
    const duration = probedDuration || MEDIA_FALLBACK_DURATION[isVideo ? 'video' : 'audio'];
 
    return {
      id: `asset-${(folderName || '')}${entry.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      name: entry.name,
      type: isVideo ? 'video' : 'audio',
      url: url,
      size: size,
      duration,
      thumbnail: isVideo ? '🎬' : '🎵',
      // Absolute on-disk path (Tauri only) — lets the app re-stream or
      // reveal the file without re-importing it.
      ...(entry.path ? { path: entry.path } : {}),
      ...(folderName ? { folder: folderName } : {}),
    };
  };
 
  try {
    const mediaDirHandle = await dirHandle.getDirectoryHandle('media', { create: true });
    const mediaEntries = [];
    for await (const entry of mediaDirHandle.values()) {
      // Skip hidden entries (e.g. `.cache/`) so generated peak files are
      // never mistaken for imported media.
      if (!entry.name || entry.name.startsWith('.')) continue;
      if (entry.kind === 'directory') {
        const subDirHandle = await mediaDirHandle.getDirectoryHandle(entry.name, { create: false });
        for await (const subEntry of subDirHandle.values()) {
          mediaEntries.push({ entry: subEntry, folderName: entry.name });
        }
      } else {
        mediaEntries.push({ entry, folderName: null });
      }
    }
    // Probe durations in parallel (like importMediaFiles does with
    // Promise.all) instead of serially — a folder of N media files would
    // otherwise wait on N back-to-back metadata loads. Promise.all keeps
    // the directory iteration order, so the media list doesn't shuffle
    // between reloads.
    const mediaAssets = await Promise.all(
      mediaEntries.map(({ entry, folderName }) => readMediaEntry(entry, folderName))
    );
    for (const asset of mediaAssets) {
      if (asset) loadedMedia.push(asset);
    }
  } catch (err) {
    console.warn('Could not read media directory:', err);
  }
 
  // Reconcile entity src with live media URLs (e.g. convertFileSrc or fresh blobs)
  if (loadedMedia.length > 0 && Array.isArray(projectMeta.entities)) {
    const mediaMap = new Map();
    for (const m of loadedMedia) {
      mediaMap.set(m.name.toLowerCase(), m.url);
      const cleanBase = m.name.replace(/\.[^.]+$/, '').toLowerCase();
      mediaMap.set(cleanBase, m.url);
    }
 
    projectMeta.entities = projectMeta.entities.map((e) => {
      let freshUrl = null;
      if (e.src) {
        const urlParts = e.src.split(/[/\\]/);
        const lastPart = decodeURIComponent(urlParts[urlParts.length - 1] || '').toLowerCase();
        if (mediaMap.has(lastPart)) {
          freshUrl = mediaMap.get(lastPart);
        }
      }
      if (!freshUrl && e.name) {
        const cleanName = e.name.replace(/[🎵🎬\s]+$/g, '').trim().toLowerCase();
        if (mediaMap.has(cleanName)) {
          freshUrl = mediaMap.get(cleanName);
        }
      }
 
      if (freshUrl) {
        const updatedComponents = (e.components || []).map((c) => {
          if ((c.type === 'VideoRenderer' || c.type === 'AudioSource') && c.src) {
            return { ...c, src: freshUrl };
          }
          return c;
        });
        return { ...e, src: freshUrl, components: updatedComponents };
      }
      return e;
    });
  }
 
  return {
    projectName: projectMeta.name,
    tracks: projectMeta.tracks,
    entities: projectMeta.entities,
    resolution: projectMeta.resolution,
    scripts: loadedScripts,
    prefabs: loadedPrefabs,
    mediaAssets: loadedMedia,
    schemaWarning,
    revision: syncState?.revision || null,
  };
}
 
/**
 * Save project state to disk.
 * Writes project.json, scripts/, and prefabs/.
 *
 * `projectStateOrGetter` may be a function; it is then called only AFTER this
 * save owns the project lock, so the snapshot is as fresh as possible and can
 * never predate a direct write (writeScriptFile etc.) that ran while this save
 * was queued.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {object|Function} projectStateOrGetter
 * @param {object}  [options]
 * @param {boolean} [options.force=false]         Rewrite project.json and every prefab even if unchanged
 *                                                (manual "Save Project to Disk").
 * @param {boolean} [options.skipUnchanged=true]  Skip project.json / prefab files whose serialized
 *                                                content matches what was last written. Scripts are
 *                                                always reconciled against disk (see syncScriptFile).
 */
export async function saveProjectToDirectory(dirHandle, projectStateOrGetter, options = {}) {
  if (!dirHandle) return false;
  const { force = false, skipUnchanged = true, ignoreConflict = false } = options || {};
  const skipIfUnchanged = skipUnchanged && !force;
 
  return withProjectLock(dirHandle, async () => {
    const hasPerm = await verifyPermission(dirHandle, true);
    if (!hasPerm) {
      throw new Error('Permission to write to directory was not granted.');
    }
 
    const projectState =
      typeof projectStateOrGetter === 'function' ? projectStateOrGetter() : projectStateOrGetter;
    const syncState = getSyncState(dirHandle);

    // Conflict check: ensure project.json on disk was not modified externally since load/last save
    if (!ignoreConflict && syncState?.revision) {
      let diskRaw = null;
      try {
        const handle = await dirHandle.getFileHandle('project.json', { create: false });
        diskRaw = await (await handle.getFile()).text();
      } catch (err) {
        if (err?.name !== 'NotFoundError') throw err;
      }
      if (diskRaw !== null) {
        const diskHash = await computeTextHash(diskRaw);
        if (diskHash !== syncState.revision) {
          throw new ProjectConflictError(
            'project.json changed on disk while it was being edited (external CLI, MCP, or editor edits detected).'
          );
        }
      }
    }
 
    // 1. Write project.json
    //
    // `lastModified` changes on every call, so it is left out of the
    // fingerprint — otherwise no two saves would ever compare equal.
    const buildProjectJson = (lastModified) => ({
      name: projectState.projectName,
      version: '1.0',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      lastModified,
      resolution: sanitizeResolution(projectState.resolution),
      tracks: projectState.tracks,
      entities: (projectState.entities || []).map(e => ({
        ...e,
        id: e.id,
        name: e.name,
        parentId: e.parentId || null,
        trackId: e.trackId,
        startTime: e.startTime,
        duration: e.duration,
        type: e.type,
        src: e.src,
        active: e.active !== false,
        color: e.color,
        tag: e.tag || 'Untagged',
        layer: e.layer || 'Default',
        components: e.components,
        keyframes: e.keyframes,
      })),
      // Filename -> id (+ description) map so loadProjectFromDirectory can
      // restore each script's ORIGINAL id instead of re-deriving one from the
      // filename. Without this, any script whose id wasn't already
      // filename-shaped (e.g. `script-${Date.now()}`) gets a new id on
      // reload that no ScriptComponent's `scriptId` matches anymore, so the
      // attached script silently stops resolving.
      scriptIndex: (projectState.scripts || []).map(s => ({
        name: toScriptFileName(s.name),
        id: s.id,
        description: s.description,
        folder: s.folder || null,
        createdAt: s.createdAt || null,
        origin: s.origin || undefined,
      })),
    });
 
    const projectFingerprint = JSON.stringify(buildProjectJson(0));
    if (!(skipIfUnchanged && syncState && syncState.projectFingerprint === projectFingerprint)) {
      if (!dirHandle.isTauri) {
        try {
          const existing = await dirHandle.getFileHandle('project.json', { create: false });
          const oldText = await (await existing.getFile()).text();
          const bakHandle = await dirHandle.getFileHandle('project.json.bak', { create: true });
          const bakWritable = await bakHandle.createWritable();
          await bakWritable.write(oldText);
          await bakWritable.close();
        } catch {
          // Backup is best-effort
        }
      }
      const jsonText = JSON.stringify(buildProjectJson(Date.now()), null, 2);
      const projectFileHandle = await dirHandle.getFileHandle('project.json', { create: true });
      const projectWritable = await projectFileHandle.createWritable();
      await projectWritable.write(jsonText);
      await projectWritable.close();
      if (syncState) {
        syncState.projectFingerprint = projectFingerprint;
        syncState.revision = await computeTextHash(jsonText);
      }
    }
 
    // 2. Sync scripts to scripts/ folder
    //
    // This used to rewrite EVERY script on EVERY autosave, which is what made
    // scripts "randomly get overwritten": whatever stale copy memory held at
    // that moment replaced the file on disk, including an edit made in VS Code
    // a moment earlier. Now each file goes through syncScriptFile, which only
    // writes when memory is the newer side (see its comment).
    const scripts = Array.isArray(projectState.scripts) ? projectState.scripts : [];
    if (scripts.length > 0) {
      const scriptsDirHandle = await dirHandle.getDirectoryHandle('scripts', { create: true });
 
      // Two scripts can canonicalize to the same file (legacy `Foo.js` next to
      // `Foo.jsx`). Writing both would make them overwrite each other on every
      // save, so each file is synced once, preferring the one already named
      // with the canonical extension.
      const byFile = new Map();
      for (const script of scripts) {
        const fileName = toScriptFileName(script.name);
        const previous = byFile.get(fileName);
        if (!previous || (script.name === fileName && previous.name !== fileName)) {
          byFile.set(fileName, script);
        }
      }
      for (const [fileName, script] of byFile) {
        if (!isSafeChildName(fileName)) {
          console.warn(`Skipped saving script with unsafe file name: ${fileName}`);
          continue;
        }
        await syncScriptFile(scriptsDirHandle, syncState, fileName, script.code || '');
      }
    }
 
    // 3. Sync prefabs to prefabs/ folder
    if (projectState.prefabs && projectState.prefabs.length > 0) {
      const prefabsDirHandle = await dirHandle.getDirectoryHandle('prefabs', { create: true });
      for (const prefab of projectState.prefabs) {
        const fileName = prefabFileName(prefab.name);
        if (!isSafeChildName(fileName)) {
          console.warn(`Skipped saving prefab with unsafe file name: ${fileName}`);
          continue;
        }
        const text = JSON.stringify(prefab, null, 2);
        if (skipIfUnchanged && syncState && syncState.prefabs.get(fileName) === text) continue;
        const prefabFileHandle = await prefabsDirHandle.getFileHandle(fileName, { create: true });
        const prefabWritable = await prefabFileHandle.createWritable();
        await prefabWritable.write(text);
        await prefabWritable.close();
        if (syncState) syncState.prefabs.set(fileName, text);
      }
    }
 
    return true;
  });
}
 
/**
 * Save a single script file to scripts/ folder (e.g. when edited in editor).
 * Runs under the project lock so it can't interleave with an autosave, and
 * records what it wrote as the script's last-synced content.
 */
export async function writeScriptFile(dirHandle, scriptName, scriptCode) {
  if (!dirHandle) return;
  await withProjectLock(dirHandle, async () => {
    await verifyPermission(dirHandle, true);
    const scriptsDirHandle = await dirHandle.getDirectoryHandle('scripts', { create: true });
    // Canonical .jsx on write — the extension never meant anything to the
    // engine (everything compiles through the same JSX/TS loader), so a
    // single canonical extension removes the .js-vs-.jsx confusion.
    const fileName = toScriptFileName(scriptName);
    const text = typeof scriptCode === 'string' ? scriptCode : String(scriptCode ?? '');
    const fileHandle = await scriptsDirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
 
    const syncState = getSyncState(dirHandle);
    if (syncState) {
      syncState.scripts.set(fileName, text);
      syncState.tombstones.delete(fileName);
    }
  });
}
 
/**
 * Rename a script on disk without leaving its previous filename behind.
 * The File System Access API has no portable rename primitive, so this is a
 * safe write-new-then-remove-old operation. Existing destination files are
 * rejected rather than silently overwritten.
 */
export async function renameScriptFile(dirHandle, oldName, newName, scriptCode) {
  if (!dirHandle) return;
  await withProjectLock(dirHandle, async () => {
    await verifyPermission(dirHandle, true);
    const scriptsDirHandle = await dirHandle.getDirectoryHandle('scripts', { create: true });
    const oldFileName = toScriptFileName(oldName);
    const newFileName = toScriptFileName(newName);
    if (oldFileName === newFileName) return;
 
    try {
      await scriptsDirHandle.getFileHandle(newFileName, { create: false });
      throw new Error(`A script named "${newFileName}" already exists.`);
    } catch (err) {
      if (err?.message?.includes('already exists')) throw err;
      // NotFoundError is expected: the destination is available.
    }
 
    const text = scriptCode || '';
    const nextHandle = await scriptsDirHandle.getFileHandle(newFileName, { create: true });
    const writable = await nextHandle.createWritable();
    await writable.write(text);
    await writable.close();
 
    try {
      await scriptsDirHandle.removeEntry(oldFileName);
    } catch (err) {
      // Do not report a false success: both files would otherwise appear after
      // reload and users could unknowingly edit the stale one.
      try { await scriptsDirHandle.removeEntry(newFileName); } catch { /* best effort rollback */ }
      throw new Error(`Renamed file was created, but the old file could not be removed: ${err?.message || err}`);
    }
 
    const syncState = getSyncState(dirHandle);
    if (syncState) {
      syncState.scripts.delete(oldFileName);
      syncState.tombstones.set(oldFileName, Date.now());
      syncState.scripts.set(newFileName, text);
      syncState.tombstones.delete(newFileName);
    }
  });
}
 
/**
 * Save an uploaded media file directly into the media/ folder.
 * Pass `subfolder` (e.g. "Recordings") to nest it inside media/<subfolder>/
 * instead of directly in media/ — used for mic recordings so they land
 * in their own folder on disk, matching the Media tab's folder grouping.
 * Pass `targetName` to write the bytes under a DIFFERENT filename than
 * the File's own name (used by asset replace, which overwrites the
 * existing on-disk copy in place so paths stay stable).
 */
export async function saveMediaFileToFolder(dirHandle, file, subfolder = null, targetName = null) {
  if (!dirHandle) return;
  await verifyPermission(dirHandle, true);
  let mediaDirHandle = await dirHandle.getDirectoryHandle('media', { create: true });
  if (subfolder) {
    mediaDirHandle = await mediaDirHandle.getDirectoryHandle(subfolder, { create: true });
  }
  const fileName = targetName || file.name;
  const fileHandle = await mediaDirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(file);
  await writable.close();
 
  // Tauri: report the on-disk absolute path of the saved copy so callers
  // can stream it via convertFileSrc instead of keeping a blob in memory.
  return mediaDirHandle?.path ? joinPath(mediaDirHandle.path, fileName) : null;
}
 
// ─── Peak-file cache (.cache/peaks) ──────────────────────────────────────
//
// Waveform peaks for long media are generated once (services/peakGenerator.js)
// and stored in a hidden `.cache/peaks/` folder inside the project, so they
// survive restarts and are read back in slices instead of re-decoding the
// source. These helpers are deliberately small: they only do path/handle I/O;
// naming, the memory LRU and the generation queue live in services/peakCache.js.
//
// Nothing creates `.cache/` up front — a project only grows one the first
// time it actually generates peaks (see the `.cache` guards in the media scan
// below). New projects therefore need no changes at all.

export const PROJECT_CACHE_DIR = '.cache';
export const PEAKS_SUBDIR = 'peaks';
export const PEAKS_TEMP_SUBDIR = 'tmp';

/** Absolute `.cache/peaks` path, or null outside Tauri. */
export function peakDirPath(dirHandle) {
  if (!dirHandle?.path) return null;
  return joinPath(dirHandle.path, PROJECT_CACHE_DIR, PEAKS_SUBDIR);
}

/** Absolute `.cache/peaks/tmp` path for FFmpeg's temp PCM file, or null outside Tauri. */
export function peakTempDirPath(dirHandle) {
  if (!dirHandle?.path) return null;
  return joinPath(dirHandle.path, PROJECT_CACHE_DIR, PEAKS_SUBDIR, PEAKS_TEMP_SUBDIR);
}

async function getPeaksDirHandle(dirHandle, create) {
  if (!dirHandle) return null;
  const cacheDir = await dirHandle.getDirectoryHandle(PROJECT_CACHE_DIR, { create });
  return cacheDir.getDirectoryHandle(PEAKS_SUBDIR, { create });
}

/** Persist a generated peak file. Returns false when there is no project handle. */
export async function writePeakFile(dirHandle, fileName, bytes) {
  if (!dirHandle || !fileName || !bytes) return false;
  const dir = await getPeaksDirHandle(dirHandle, true);
  if (!dir) return false;
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(bytes);
  await writable.close();
  return true;
}

/** Read a peak file's bytes, or null when it is missing/unreadable. */
export async function readPeakFile(dirHandle, fileName) {
  if (!dirHandle || !fileName) return null;
  try {
    const dir = await getPeaksDirHandle(dirHandle, false);
    if (!dir) return null;
    const fileHandle = await dir.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

/** True when a peak file exists on disk. */
export async function peakFileExists(dirHandle, fileName) {
  if (!dirHandle || !fileName) return false;
  try {
    const dir = await getPeaksDirHandle(dirHandle, false);
    if (!dir) return false;
    await dir.getFileHandle(fileName, { create: false });
    return true;
  } catch {
    return false;
  }
}

/** Best-effort delete of one cached peak file. */
export async function deletePeakFile(dirHandle, fileName) {
  if (!dirHandle || !fileName) return;
  try {
    const dir = await getPeaksDirHandle(dirHandle, false);
    if (!dir) return;
    await dir.removeEntry(fileName).catch(() => {});
  } catch {
    // nothing to delete
  }
}

/**
 * Delete a media file from the media/ directory on disk.
 */
export async function deleteMediaFileFromFolder(dirHandle, fileName, subfolder = null, assetPath = null) {
  if (!dirHandle || !fileName) return;
 
  // Tauri direct removal
  if (isTauri() && assetPath) {
    try {
      const { remove, exists } = await import('@tauri-apps/plugin-fs');
      if (await exists(assetPath)) {
        await remove(assetPath);
        return;
      }
    } catch (err) {
      console.warn('Tauri direct remove failed, falling back to directory handle:', err);
    }
  }
 
  // Directory handle removal
  try {
    await verifyPermission(dirHandle, true);
    const mediaDirHandle = await dirHandle.getDirectoryHandle('media', { create: false });
    const targetDir = subfolder
      ? await mediaDirHandle.getDirectoryHandle(subfolder, { create: false })
      : mediaDirHandle;
    await targetDir.removeEntry(fileName);
  } catch (err) {
    console.warn(`Could not remove ${fileName} from media folder:`, err);
  }
}
 
/**
 * Move a media file between media root and subfolders on disk.
 */
export async function moveMediaFileOnDisk(dirHandle, fileName, oldFolder = null, newFolder = null, assetPath = null) {
  if (!dirHandle || !fileName || oldFolder === newFolder) return assetPath;
 
  if (isTauri() && dirHandle.path) {
    try {
      const { rename, exists, mkdir } = await import('@tauri-apps/plugin-fs');
      const mediaPath = joinPath(dirHandle.path, 'media');
      const sourcePath = assetPath || (oldFolder ? joinPath(mediaPath, oldFolder, fileName) : joinPath(mediaPath, fileName));
      const targetDir = newFolder ? joinPath(mediaPath, newFolder) : mediaPath;
      const targetPath = joinPath(targetDir, fileName);
 
      // Guard: never rename if sourcePath somehow resolved to the whole media folder
      if (sourcePath === mediaPath || sourcePath === dirHandle.path) {
        console.error('Refusing to move: sourcePath resolved to directory root');
        return assetPath;
      }
 
      if (await exists(sourcePath)) {
        if (!(await exists(targetDir))) {
          await mkdir(targetDir, { recursive: true });
        }
        await rename(sourcePath, targetPath);
        return targetPath;
      }
    } catch (err) {
      console.warn('Tauri direct move failed, falling back to directory handle:', err);
    }
  }
 
  try {
    await verifyPermission(dirHandle, true);
    const mediaDirHandle = await dirHandle.getDirectoryHandle('media', { create: true });
    const sourceDir = oldFolder
      ? await mediaDirHandle.getDirectoryHandle(oldFolder, { create: false })
      : mediaDirHandle;
    const targetDir = newFolder
      ? await mediaDirHandle.getDirectoryHandle(newFolder, { create: true })
      : mediaDirHandle;
 
    const sourceFileHandle = await sourceDir.getFileHandle(fileName, { create: false });
    const file = await sourceFileHandle.getFile();
 
    const destFileHandle = await targetDir.getFileHandle(fileName, { create: true });
    const writable = await destFileHandle.createWritable();
    await writable.write(file);
    await writable.close();
 
    await sourceDir.removeEntry(fileName);
    return targetDir?.path ? joinPath(targetDir.path, fileName) : null;
  } catch (err) {
    console.warn(`Could not move ${fileName} on disk:`, err);
    return assetPath;
  }
}
 
/**
 * Delete an entire folder directory from a project section on disk.
 */
export async function deleteFolderFromProject(dirHandle, section, folderName) {
  if (!dirHandle || !section || !folderName || section === 'shared') return;
  if (!isSafeChildName(section) || !isSafeChildName(folderName)) {
    console.error(`Refusing to delete folder with unsafe name: ${section}/${folderName}`);
    return;
  }
  const rootName = section === 'prefabs' ? 'prefabs' : section;
 
  if (isTauri() && dirHandle.path) {
    try {
      const { remove, exists } = await import('@tauri-apps/plugin-fs');
      const rootPath = joinPath(dirHandle.path, rootName);
      const targetPath = joinPath(dirHandle.path, rootName, folderName);
 
      // Safety guard: targetPath must be strictly deeper than rootPath
      if (targetPath === rootPath || targetPath === dirHandle.path) {
        console.error(`Refusing to delete: targetPath resolved to section root: ${targetPath}`);
        return;
      }
 
      if (await exists(targetPath)) {
        await remove(targetPath, { recursive: true });
        return;
      }
    } catch (err) {
      console.warn('Tauri direct folder remove failed, falling back to handle:', err);
    }
  }
 
  try {
    await verifyPermission(dirHandle, true);
    const rootDir = await dirHandle.getDirectoryHandle(rootName, { create: false });
    await rootDir.removeEntry(folderName, { recursive: true });
  } catch (err) {
    console.warn(`Could not remove folder ${rootName}/${folderName}:`, err);
  }
}
 
/**
 * Rename a folder directory in a project section on disk.
 */
export async function renameFolderInProject(dirHandle, section, oldName, newName) {
  if (!dirHandle || !section || !oldName || !newName || section === 'shared' || oldName === newName) return;
  if (!isSafeChildName(section) || !isSafeChildName(oldName) || !isSafeChildName(newName)) {
    console.error(`Refusing to rename folder with unsafe name: ${section}/${oldName} -> ${newName}`);
    return;
  }
  const rootName = section === 'prefabs' ? 'prefabs' : section;
 
  if (isTauri() && dirHandle.path) {
    try {
      const { rename, exists } = await import('@tauri-apps/plugin-fs');
      const rootPath = joinPath(dirHandle.path, rootName);
      const oldPath = joinPath(dirHandle.path, rootName, oldName);
      const newPath = joinPath(dirHandle.path, rootName, newName);
 
      // Safety guard: oldPath/newPath must be strictly deeper than rootPath
      if (oldPath === rootPath || newPath === rootPath || oldPath === dirHandle.path || newPath === dirHandle.path) {
        console.error(`Refusing to rename: path resolved to section root: ${oldPath} -> ${newPath}`);
        return;
      }
 
      if (await exists(oldPath)) {
        await rename(oldPath, newPath);
        return;
      }
    } catch (err) {
      console.warn('Tauri direct folder rename failed, falling back to handle:', err);
    }
  }
 
  try {
    await verifyPermission(dirHandle, true);
    const rootDir = await dirHandle.getDirectoryHandle(rootName, { create: false });
    const oldDir = await rootDir.getDirectoryHandle(oldName, { create: false });
    const newDir = await rootDir.getDirectoryHandle(newName, { create: true });
 
    for await (const entry of oldDir.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        const newFileHandle = await newDir.getFileHandle(entry.name, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(file);
        await writable.close();
      }
    }
    await rootDir.removeEntry(oldName, { recursive: true });
  } catch (err) {
    console.warn(`Could not rename folder ${rootName}/${oldName} to ${newName}:`, err);
  }
}
 
/**
 * Delete a script file from scripts/ on disk.
 * Leaves a short-lived tombstone so an autosave that snapshotted state before
 * the delete can't recreate the file.
 */
export async function deleteScriptFileFromFolder(dirHandle, scriptName, subfolder = null) {
  if (!dirHandle || !scriptName) return;
  await withProjectLock(dirHandle, async () => {
    const fileName = toScriptFileName(scriptName);
    try {
      await verifyPermission(dirHandle, true);
      let scriptsDir = await dirHandle.getDirectoryHandle('scripts', { create: false });
      if (subfolder) {
        scriptsDir = await scriptsDir.getDirectoryHandle(subfolder, { create: false });
      }
      await scriptsDir.removeEntry(fileName);
    } catch (err) {
      console.warn(`Could not remove script ${scriptName} from disk:`, err);
    }
    const syncState = getSyncState(dirHandle);
    if (syncState) {
      syncState.scripts.delete(fileName);
      syncState.tombstones.set(fileName, Date.now());
    }
  });
}
 
export async function deletePrefabFileFromFolder(dirHandle, prefabName, subfolder = null) {
  if (!dirHandle || !prefabName) return;
  await withProjectLock(dirHandle, async () => {
    const fileName = prefabFileName(prefabName);
    try {
      await verifyPermission(dirHandle, true);
      let prefabsDir = await dirHandle.getDirectoryHandle('prefabs', { create: false });
      if (subfolder) {
        prefabsDir = await prefabsDir.getDirectoryHandle(subfolder, { create: false });
      }
      await prefabsDir.removeEntry(fileName);
    } catch (err) {
      console.warn(`Could not remove prefab ${prefabName} from disk:`, err);
    }
    const syncState = getSyncState(dirHandle);
    if (syncState && !subfolder) syncState.prefabs.delete(fileName);
  });
}
 
/**
 * Write a single prefab file (root prefabs/ or a subfolder). Runs under the
 * project lock; a root-level write also updates the autosave's "last written"
 * cache so the next autosave doesn't redundantly rewrite the same content.
 */
export async function writePrefabFile(dirHandle, prefabName, prefabData, subfolder = null) {
  if (!dirHandle || !prefabName || !prefabData) return;
  await withProjectLock(dirHandle, async () => {
    try {
      await verifyPermission(dirHandle, true);
      let prefabsDir = await dirHandle.getDirectoryHandle('prefabs', { create: true });
      if (subfolder) {
        prefabsDir = await prefabsDir.getDirectoryHandle(subfolder, { create: true });
      }
      const fileName = prefabFileName(prefabName);
      const text = JSON.stringify(prefabData, null, 2);
      const fileHandle = await prefabsDir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      const syncState = getSyncState(dirHandle);
      if (syncState && !subfolder) syncState.prefabs.set(fileName, text);
    } catch (err) {
      console.warn(`Could not write prefab ${prefabName} to disk:`, err);
    }
  });
}
 
/**
 * Check scripts/ directory for external changes (e.g. edited in VS Code) for hot-reload.
 *
 * Returns the new scripts array when something changed (a file's content, a
 * new file, or a file that was deleted outside the app), otherwise null.
 */
export async function checkScriptsForChanges(dirHandle, existingScripts) {
  if (!dirHandle) return null;
 
  try {
    const scriptsDirHandle = await dirHandle.getDirectoryHandle('scripts', { create: false });
    const syncState = getSyncState(dirHandle);
    let hasChanges = false;
    // Key by the CANONICAL on-disk filename (always .jsx). Scripts are written
    // as `<name>.jsx` (see toScriptFileName), so an in-memory script named
    // `Foo.js` lives on disk as `Foo.jsx`; keying by the raw in-memory name
    // meant that script never matched its own file, was treated as brand new
    // every poll, and got re-created (losing its metadata) each time.
    const currentScriptsMap = new Map(
      (existingScripts || []).map((s) => [toScriptFileName(s.name), s])
    );
    const updatedScripts = [];
    const seen = new Set();
 
    for await (const entry of scriptsDirHandle.values()) {
      if (entry.kind === 'file' && isScriptFile(entry.name)) {
        const file = await entry.getFile();
        const code = await file.text();
        const canonical = toScriptFileName(entry.name);
        const existing = currentScriptsMap.get(canonical);
        seen.add(canonical);
 
        if (!existing || existing.code !== code) {
          hasChanges = true;
        }
 
        updatedScripts.push({
          // Spread `existing` FIRST so every panel-level field the disk file
          // can't carry (folder, description, createdAt, ...) survives a
          // hot-reload. Previously this rebuilt the object from scratch with
          // only id/name/code/lastModified, silently dropping the script's
          // folder assignment and description on every external edit.
          ...(existing || {}),
          id: existing ? existing.id : `script-${entry.name.replace(/\.[^.]+$/, '')}`,
          name: existing ? existing.name : entry.name,
          code: code,
          lastModified: file.lastModified,
        });
      }
    }
 
    // A script that is in memory but has no file on disk is one of two things:
    //  - never written yet (just created / added from a prefab, write still in
    //    flight): keep it, the next save will create the file;
    //  - known to have been on disk before (its file is in the last-synced
    //    cache) and now gone: it was deleted outside the app, so drop it — the
    //    same as the hot-reload always did before.
    for (const [canonical, script] of currentScriptsMap) {
      if (seen.has(canonical)) continue;
      if (syncState && syncState.scripts.has(canonical)) {
        syncState.scripts.delete(canonical);
        hasChanges = true;
      } else {
        updatedScripts.push(script);
      }
    }
 
    if (hasChanges) {
      return updatedScripts;
    }
  } catch {
    // Ignore read errors during hot-reload polling
  }
 
  return null;
}
 
/**
 * Tauri-only: subscribe to OS file-system events for the project's
 * scripts/ folder instead of the 2s polling loop used in the browser.
 * External saves from VS Code / Cursor land as near-instant native events
 * (create / modify / remove) rather than on the next poll tick.
 *
 * Events are filtered down to script files (.js/.jsx/.ts/.tsx) and
 * debounced by the fs plugin (delayMs), so one save burst fires a single
 * callback. The callback itself is expected to re-scan the folder (see
 * checkScriptsForChanges) since native events only say "something under
 * scripts/ changed", not what the new contents are.
 *
 * @returns {Promise<(() => void) | null>} unwatch function, or null when
 *   not running under Tauri / the watcher couldn't be created (callers
 *   then fall back to polling).
 */
export async function watchScriptsDirectory(dirHandle, onChange) {
  if (!isTauri() || !dirHandle?.path) return null;
 
  try {
    const { watch, exists } = await import('@tauri-apps/plugin-fs');
    const scriptsPath = joinPath(dirHandle.path, 'scripts');
    if (!(await exists(scriptsPath))) return null;
 
    const unwatch = await watch(
      scriptsPath,
      (event) => {
        const paths = Array.isArray(event?.paths) ? event.paths : [];
        const touchedScript = paths.some((p) => isScriptFile(String(p || '').split(/[\\/]/).pop() || p));
        if (touchedScript) {
          onChange?.();
        }
      },
      { recursive: true, delayMs: 250 }
    );
    return unwatch;
  } catch (err) {
    console.warn('fs watch unavailable — falling back to polling:', err);
    return null;
  }
}

/**
 * Checks if project.json on disk has been changed by another process (MCP, CLI, VS Code)
 * since it was loaded or last saved.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<boolean>} true if project.json changed externally
 */
export async function checkProjectJsonForChanges(dirHandle) {
  if (!dirHandle) return false;
  const syncState = getSyncState(dirHandle);
  if (!syncState || !syncState.revision) return false;
  try {
    const handle = await dirHandle.getFileHandle('project.json', { create: false });
    const file = await handle.getFile();
    const raw = await file.text();
    const currentHash = await computeTextHash(raw);
    return currentHash !== syncState.revision;
  } catch {
    return false;
  }
}

/**
 * Subscribes to native filesystem events for project.json.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {() => void} onChange
 * @returns {Promise<(() => void) | null>}
 */
export async function watchProjectFile(dirHandle, onChange) {
  if (!isTauri() || !dirHandle?.path) return null;
  try {
    const { watch, exists } = await import('@tauri-apps/plugin-fs');
    const projectPath = joinPath(dirHandle.path, 'project.json');
    if (!(await exists(projectPath))) return null;
    const unwatch = await watch(
      dirHandle.path,
      (event) => {
        const paths = Array.isArray(event?.paths) ? event.paths : [];
        const touched = paths.some((p) => /(^|[\\/])project\.json$/i.test(String(p || '')));
        if (touched) {
          onChange?.();
        }
      },
      { recursive: false, delayMs: 250 }
    );
    return unwatch;
  } catch (err) {
    console.warn('project.json watch unavailable — falling back to polling:', err);
    return null;
  }
}
