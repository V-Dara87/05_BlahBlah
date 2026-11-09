/**
 * The `.blahblah` project file.
 *
 * A project is still a plain folder (project.json, scripts/, media/ ...) so VS
 * Code and the CLI keep working. The `.blahblah` file is a tiny marker that
 * lives in the root of that folder: double-click it (or pick it in Open) and
 * blahblah opens the folder it sits in. It holds no project data itself, so it
 * can never go out of sync with project.json.
 *
 * Opening one only opens its parent folder — the usual "trust this project's
 * scripts?" prompt still runs before any script is executed.
 */
import {
  isTauri,
  createTauriDirectoryHandle,
  allowProjectDirectory,
} from './tauriFsAdapter';
import { pickProjectDirectory } from './projectFileSystem';

export const PROJECT_FILE_EXT = 'blahblah';

const isProjectFileName = (name) =>
  typeof name === 'string' && name.toLowerCase().endsWith(`.${PROJECT_FILE_EXT}`);

/** Folder that contains `filePath` (handles both / and \ separators). */
function parentDirOf(filePath) {
  const trimmed = String(filePath).replace(/[/\\]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx < 0) return '';
  if (idx === 0) return trimmed.slice(0, 1); // "/file" -> "/"
  const parent = trimmed.slice(0, idx);
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}\\` : parent; // "C:" -> "C:\"
}

const baseNameOf = (filePath) => String(filePath).split(/[/\\]/).pop() || '';

/**
 * Make sure the project folder has a `.blahblah` file. Safe to call on every
 * open/save: it does nothing when one already exists, and never throws (a
 * read-only folder must not stop a project from opening).
 * @returns {Promise<string|null>} the marker's file name, or null if none.
 */
export async function ensureProjectFile(dirHandle, projectName) {
  if (!dirHandle) return null;
  try {
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle?.kind === 'file' && isProjectFileName(name)) return name;
    }

    const safeName =
      String(projectName || dirHandle.name || '')
        .trim()
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/^\.+/, '') || 'project';
    const fileName = `${safeName}.${PROJECT_FILE_EXT}`;

    const body = JSON.stringify(
      {
        blahblah: 'project',
        format: 1,
        note: 'Open this file with blahblah to open the project in this folder. The project data lives in project.json.',
      },
      null,
      2,
    );
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(body);
    await writable.close();
    return fileName;
  } catch (err) {
    console.warn('Could not write the .blahblah project file:', err);
    return null;
  }
}

/**
 * "Open Project" picker. On desktop it asks for the `.blahblah` file (a
 * project.json is accepted too, for projects made before this file existed)
 * and returns a handle to the folder that contains it. A plain browser cannot
 * learn a picked file's folder, so there it falls back to the folder picker.
 */
export async function pickProjectToOpen() {
  if (!isTauri()) return pickProjectDirectory();

  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: false,
    directory: false,
    title: 'Open blahblah Project',
    filters: [
      { name: 'blahblah Project', extensions: [PROJECT_FILE_EXT] },
      { name: 'project.json (older projects)', extensions: ['json'] },
    ],
  });
  if (!selected) {
    const err = new Error('The user aborted a request.');
    err.name = 'AbortError';
    throw err;
  }

  const fileName = baseNameOf(selected).toLowerCase();
  if (!isProjectFileName(fileName) && fileName !== 'project.json') {
    throw new Error(`Pick a .${PROJECT_FILE_EXT} project file (or a project.json).`);
  }
  return handleForFolder(parentDirOf(selected));
}

async function handleForFolder(dirPath) {
  if (!dirPath) throw new Error('Could not work out the project folder.');
  await allowProjectDirectory(dirPath);
  return createTauriDirectoryHandle(dirPath);
}

/**
 * Project folder the app was launched with (double-clicking a `.blahblah`
 * file starts the app with its path). One-shot: returns null the next time.
 */
export async function takeLaunchProjectHandle() {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const dirPath = await invoke('take_launch_project_dir');
  return dirPath ? handleForFolder(dirPath) : null;
}

/**
 * Called when a `.blahblah` file is opened while the app is already running
 * (macOS only; Windows/Linux start a new window instead).
 * @returns {Promise<() => void>} unlisten function
 */
export async function listenForOpenedProjects(onHandle) {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen('project-file-opened', async (event) => {
    try {
      onHandle(await handleForFolder(event.payload));
    } catch (err) {
      console.warn('Could not open the project that was opened from the OS:', err);
    }
  });
}