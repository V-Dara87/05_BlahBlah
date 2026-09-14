/**
 * File System Access Service for blahblah Video Editor.
 * Enables creating new blank project folders on disk, loading existing projects,
 * auto-saving, and hot-reloading from external code editors (VS Code, Cursor, etc.).
 */
 
import { CURRENT_SCHEMA_VERSION, DEFAULT_RESOLUTION } from '../types';
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


 
import { isTauri, createTauriDirectoryHandle, joinPath } from './tauriFsAdapter';
import { convertFileSrc } from '@tauri-apps/api/core';
// Real media duration probing (metadata-only, same technique + fallback as
// the import path) — reused here because reload rebuilds mediaAssets by
// scanning media/ on disk and must not stamp a placeholder duration.
import { probeMediaElementDuration, MEDIA_FALLBACK_DURATION } from './mediaImport';

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
 
  const projectFileHandle = await projectDirHandle.getFileHandle('project.json', { create: true });
  const writable = await projectFileHandle.createWritable();
  await writable.write(JSON.stringify(initialProjectJson, null, 2));
  await writable.close();
 
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
 
  // 1. Read project.json if present
  try {
    const projectJsonHandle = await dirHandle.getFileHandle('project.json');
    const projectJsonFile = await projectJsonHandle.getFile();
    const projectJsonText = await projectJsonFile.text();
    const parsed = JSON.parse(projectJsonText);
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
  } catch {
    // project.json doesn't exist yet; will create on save
  }
 
  // 2. Read scripts/ folder
  const loadedScripts = [];
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
        loadedScripts.push({
          id: indexed ? indexed.id : `script-${entry.name.replace(/\.[^.]+$/, '')}`,
          name: entry.name,
          description: indexed ? indexed.description : undefined,
          // Folder + sort metadata round-trip through scriptIndex (the
          // code itself lives in the file, so it's the only place these
          // panel-level fields can persist).
          folder: indexed?.folder ?? null,
          createdAt: indexed?.createdAt ?? undefined,
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
    for await (const entry of prefabsDirHandle.values()) {
      if (entry.kind === 'file' && (entry.name.endsWith('.json') || entry.name.endsWith('.prefab'))) {
        const file = await entry.getFile();
        const text = await file.text();
        try {
          const prefabObj = JSON.parse(text);
          const isNested = Array.isArray(prefabObj.entities);
          loadedPrefabs.push({
            id: `prefab-${entry.name.replace(/\.[^.]+$/, '')}`,
            name: prefabObj.name || entry.name,
            type: prefabObj.type || 'prefab',
            rootId: prefabObj.rootId ?? null,
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
    const ext = entry.name.toLowerCase();
    const isVideo = ext.endsWith('.mp4') || ext.endsWith('.webm') || ext.endsWith('.mov');
    const isAudio = ext.endsWith('.mp3') || ext.endsWith('.wav') || ext.endsWith('.ogg') || ext.endsWith('.aac');
 
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
  };
}
 
/**
 * Save project state to disk.
 * Writes project.json, scripts/, and prefabs/.
 */
export async function saveProjectToDirectory(dirHandle, projectState) {
  if (!dirHandle) return false;
 
  const hasPerm = await verifyPermission(dirHandle, true);
  if (!hasPerm) {
    throw new Error('Permission to write to directory was not granted.');
  }
 
  // 1. Write project.json
  const projectJson = {
    name: projectState.projectName,
    version: '1.0',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    lastModified: Date.now(),
    resolution: sanitizeResolution(projectState.resolution),
    tracks: projectState.tracks,
    entities: (projectState.entities || []).map(e => ({
      id: e.id,
      name: e.name,
      trackId: e.trackId,
      startTime: e.startTime,
      duration: e.duration,
      type: e.type,
      src: e.src,
      active: e.active !== false,
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
    })),
  };
 
  const projectFileHandle = await dirHandle.getFileHandle('project.json', { create: true });
  const projectWritable = await projectFileHandle.createWritable();
  await projectWritable.write(JSON.stringify(projectJson, null, 2));
  await projectWritable.close();
 
  // 2. Sync scripts to scripts/ folder
  if (projectState.scripts && projectState.scripts.length > 0) {    const scriptsDirHandle = await dirHandle.getDirectoryHandle('scripts', { create: true });
    for (const script of projectState.scripts) {
      const fileName = toScriptFileName(script.name);

      const scriptFileHandle = await scriptsDirHandle.getFileHandle(fileName, { create: true });
      const scriptWritable = await scriptFileHandle.createWritable();
      await scriptWritable.write(script.code || '');
      await scriptWritable.close();
    }
  }
 
  // 3. Sync prefabs to prefabs/ folder
  if (projectState.prefabs && projectState.prefabs.length > 0) {
    const prefabsDirHandle = await dirHandle.getDirectoryHandle('prefabs', { create: true });
    for (const prefab of projectState.prefabs) {
      const fileName = prefab.name.endsWith('.json') ? prefab.name : `${prefab.name}.prefab.json`;
      const prefabFileHandle = await prefabsDirHandle.getFileHandle(fileName, { create: true });
      const prefabWritable = await prefabFileHandle.createWritable();
      await prefabWritable.write(JSON.stringify(prefab, null, 2));
      await prefabWritable.close();
    }
  }
 
  return true;
}
 
/**
 * Save a single script file to scripts/ folder (e.g. when edited in editor).
 */
export async function writeScriptFile(dirHandle, scriptName, scriptCode) {
  if (!dirHandle) return;
  await verifyPermission(dirHandle, true);
  const scriptsDirHandle = await dirHandle.getDirectoryHandle('scripts', { create: true });
  // Canonical .jsx on write — the extension never meant anything to the
  // engine (everything compiles through the same JSX/TS loader), so a
  // single canonical extension removes the .js-vs-.jsx confusion.
  const fileName = toScriptFileName(scriptName);
  const fileHandle = await scriptsDirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(scriptCode);
  await writable.close();
}

/**
 * Rename a script on disk without leaving its previous filename behind.
 * The File System Access API has no portable rename primitive, so this is a
 * safe write-new-then-remove-old operation. Existing destination files are
 * rejected rather than silently overwritten.
 */
export async function renameScriptFile(dirHandle, oldName, newName, scriptCode) {
  if (!dirHandle) return;
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

  const nextHandle = await scriptsDirHandle.getFileHandle(newFileName, { create: true });
  const writable = await nextHandle.createWritable();
  await writable.write(scriptCode || '');
  await writable.close();

  try {
    await scriptsDirHandle.removeEntry(oldFileName);
  } catch (err) {
    // Do not report a false success: both files would otherwise appear after
    // reload and users could unknowingly edit the stale one.
    try { await scriptsDirHandle.removeEntry(newFileName); } catch { /* best effort rollback */ }
    throw new Error(`Renamed file was created, but the old file could not be removed: ${err?.message || err}`);
  }
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
 
/**
 * Check scripts/ directory for external changes (e.g. edited in VS Code) for hot-reload.
 */
export async function checkScriptsForChanges(dirHandle, existingScripts) {
  if (!dirHandle) return null;
 
  try {
    const scriptsDirHandle = await dirHandle.getDirectoryHandle('scripts', { create: false });
    let hasChanges = false;
    const currentScriptsMap = new Map(existingScripts.map(s => [s.name, s]));
    const updatedScripts = [];
 
    for await (const entry of scriptsDirHandle.values()) {
      if (entry.kind === 'file' && isScriptFile(entry.name)) {
        const file = await entry.getFile();
        const code = await file.text();
        const existing = currentScriptsMap.get(entry.name);
 
        if (!existing || existing.code !== code) {
          hasChanges = true;
        }
 
        updatedScripts.push({
          // Unchanged: hot-reload polling already keeps the in-memory id
          // (via `existing`) for any file it already knew about, and only
          // derives a fresh id for genuinely new files — this path was
          // never the source of the save/reload bug, only the initial
          // directory load in loadProjectFromDirectory was.
          id: existing ? existing.id : `script-${entry.name.replace(/\.[^.]+$/, '')}`,
          name: entry.name,
          code: code,
          lastModified: file.lastModified,
        });
      }
    }
 
    if (hasChanges || updatedScripts.length !== existingScripts.length) {
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
