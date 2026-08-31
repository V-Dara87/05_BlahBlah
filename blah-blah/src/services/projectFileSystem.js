/**
 * File System Access Service for blahblah Video Editor.
 * Enables creating new blank project folders on disk, loading existing projects,
 * auto-saving, and hot-reloading from external code editors (VS Code, Cursor, etc.).
 */
 
import { DEFAULT_RESOLUTION } from '../types';
 
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
 
export function isFileSystemSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}
 
/**
 * Verify / Request readwrite permissions for a directory handle.
 */
export async function verifyPermission(dirHandle, readWrite = true) {
  if (!dirHandle) return false;
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
 * NOTE: throws if the returned handle doesn't actually have readwrite
 * permission (e.g. Brave's fingerprinting shield silently blocking the
 * permission prompt) instead of returning a handle that looks valid
 * but fails on every later write.
 */
export async function pickProjectDirectory() {
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
  await projectDirHandle.getDirectoryHandle('scripts', { create: true });
  await projectDirHandle.getDirectoryHandle('prefabs', { create: true });
  await projectDirHandle.getDirectoryHandle('media', { create: true });
 
  const projectResolution = sanitizeResolution(resolution);
 
  const initialProjectJson = {
    name: safeName,
    version: '1.0',
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
    // scripts/ filename back to the script id that ScriptComponent /
    // ReactRenderer / CanvasRenderer components reference in their
    // `scriptId` field, so ids survive a save + reload instead of being
    // re-derived from the filename (which loses any id that wasn't already
    // filename-shaped, e.g. ids created as `script-${Date.now()}`).
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
 
  let projectMeta = {
    name: dirHandle.name || 'my-project',
    tracks: fallbackTracks,
    entities: [],
    resolution: { ...DEFAULT_RESOLUTION },
  };
 
  // scriptIndex maps a scripts/ filename -> the script id it was saved
  // with, so ids created in-app (e.g. `script-${Date.now()}`) survive a
  // save + reload instead of being replaced by a filename-derived id that
  // nothing on the timeline actually references. Keyed by filename since
  // that's the only thing that reliably ties a project.json record back to
  // a file that may have been renamed/edited/added outside the app.
  let scriptIndex = new Map();
 
  // 1. Read project.json if present
  try {
    const projectJsonHandle = await dirHandle.getFileHandle('project.json');
    const projectJsonFile = await projectJsonHandle.getFile();
    const projectJsonText = await projectJsonFile.text();
    const parsed = JSON.parse(projectJsonText);
    projectMeta = {
      name: parsed.name || dirHandle.name,
      tracks: parsed.tracks && parsed.tracks.length > 0 ? parsed.tracks : fallbackTracks,
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      // Older projects saved before resolution existed (or a hand-edited
      // project.json missing/mangling it) fall back to the default rather
      // than failing to load.
      resolution: sanitizeResolution(parsed.resolution),
    };
    if (Array.isArray(parsed.scriptIndex)) {
      scriptIndex = new Map(
        parsed.scriptIndex
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
    for await (const entry of scriptsDirHandle.values()) {
      if (entry.kind === 'file' && (entry.name.endsWith('.js') || entry.name.endsWith('.jsx') || entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.cs'))) {
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
          loadedPrefabs.push({
            id: `prefab-${entry.name.replace(/\.[^.]+$/, '')}`,
            name: prefabObj.name || entry.name,
            type: prefabObj.type || 'prefab',
            components: prefabObj.components || [],
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
    if (entry.kind !== 'file') return;
    const file = await entry.getFile();
    const ext = entry.name.toLowerCase();
    const isVideo = ext.endsWith('.mp4') || ext.endsWith('.webm') || ext.endsWith('.mov');
    const isAudio = ext.endsWith('.mp3') || ext.endsWith('.wav') || ext.endsWith('.ogg') || ext.endsWith('.aac');
 
    if (isVideo || isAudio) {
      const url = URL.createObjectURL(file);
      loadedMedia.push({
        id: `asset-${(folderName || '')}${entry.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        name: entry.name,
        type: isVideo ? 'video' : 'audio',
        url: url,
        size: file.size,
        duration: 10,
        thumbnail: isVideo ? '🎬' : '🎵',
        ...(folderName ? { folder: folderName } : {}),
      });
    }
  };
 
  try {
    const mediaDirHandle = await dirHandle.getDirectoryHandle('media', { create: true });
    for await (const entry of mediaDirHandle.values()) {
      if (entry.kind === 'directory') {
        const subDirHandle = await mediaDirHandle.getDirectoryHandle(entry.name, { create: false });
        for await (const subEntry of subDirHandle.values()) {
          await readMediaEntry(subEntry, entry.name);
        }
      } else {
        await readMediaEntry(entry, null);
      }
    }
  } catch (err) {
    console.warn('Could not read media directory:', err);
  }
 
  return {
    projectName: projectMeta.name,
    tracks: projectMeta.tracks,
    entities: projectMeta.entities,
    resolution: projectMeta.resolution,
    scripts: loadedScripts,
    prefabs: loadedPrefabs,
    mediaAssets: loadedMedia,
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
    })),
    // Filename -> id (+ description) map so loadProjectFromDirectory can
    // restore each script's ORIGINAL id instead of re-deriving one from the
    // filename. Without this, any script whose id wasn't already
    // filename-shaped (e.g. `script-${Date.now()}`, created via "+ Motion
    // Script" / "+ React Clip") gets a new id on reload that no
    // ScriptComponent/ReactRenderer/CanvasRenderer's `scriptId` matches
    // anymore, so the attached script silently stops resolving.
    scriptIndex: (projectState.scripts || []).map(s => ({
      name: /\.(js|jsx|ts|tsx|cs)$/i.test(s.name) ? s.name : `${s.name}.js`,
      id: s.id,
      description: s.description,
    })),
  };
 
  const projectFileHandle = await dirHandle.getFileHandle('project.json', { create: true });
  const projectWritable = await projectFileHandle.createWritable();
  await projectWritable.write(JSON.stringify(projectJson, null, 2));
  await projectWritable.close();
 
  // 2. Sync scripts to scripts/ folder
  if (projectState.scripts && projectState.scripts.length > 0) {
    const scriptsDirHandle = await dirHandle.getDirectoryHandle('scripts', { create: true });
    for (const script of projectState.scripts) {
      const fileName = /\.(js|jsx|ts|tsx|cs)$/i.test(script.name)
        ? script.name 
        : `${script.name}.js`;
 
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
  const fileName = /\.(js|jsx|ts|tsx|cs)$/i.test(scriptName) ? scriptName : `${scriptName}.js`;
  const fileHandle = await scriptsDirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(scriptCode);
  await writable.close();
}
 
/**
 * Save an uploaded media file directly into the media/ folder.
 * Pass `subfolder` (e.g. "Recordings") to nest it inside media/<subfolder>/
 * instead of directly in media/ — used for mic recordings so they land
 * in their own folder on disk, matching the Media tab's folder grouping.
 */
export async function saveMediaFileToFolder(dirHandle, file, subfolder = null) {
  if (!dirHandle) return;
  await verifyPermission(dirHandle, true);
  let mediaDirHandle = await dirHandle.getDirectoryHandle('media', { create: true });
  if (subfolder) {
    mediaDirHandle = await mediaDirHandle.getDirectoryHandle(subfolder, { create: true });
  }
  const fileHandle = await mediaDirHandle.getFileHandle(file.name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(file);
  await writable.close();
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
      if (entry.kind === 'file' && (entry.name.endsWith('.js') || entry.name.endsWith('.jsx') || entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.cs'))) {
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