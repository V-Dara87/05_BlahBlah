/**
 * Your own folders in the project root (exports/, notes/, references/ ...).
 *
 * media/, scripts/ and prefabs/ belong to the app and are managed through the
 * Project panel. Everything else you create here is a plain folder on disk:
 * the app only lists, creates and deletes it — it never reads what is inside.
 */

// Folders the app owns or tools create; they can't be created or deleted here.
const RESERVED_NAMES = new Set(['scripts', 'prefabs', 'media', 'node_modules']);

// Names Windows refuses for a folder, whatever the extension.
const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** @returns {{ok: true, name: string} | {ok: false, error: string}} */
export function validateFolderName(rawName) {
  const name = String(rawName ?? '').trim();
  if (!name) return { ok: false, error: 'Type a folder name.' };
  if (name.length > 80) return { ok: false, error: 'That name is too long.' };
  if (/[\\/:*?"<>|\0]/.test(name)) {
    return { ok: false, error: 'A folder name cannot contain \\ / : * ? " < > |' };
  }
  if (name.startsWith('.')) return { ok: false, error: 'A folder name cannot start with a dot.' };
  if (/[. ]$/.test(name)) return { ok: false, error: 'A folder name cannot end with a dot or space.' };
  if (WINDOWS_DEVICE_NAMES.test(name)) return { ok: false, error: `"${name}" is not allowed as a folder name.` };
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    return { ok: false, error: `"${name}" is used by the app.` };
  }
  return { ok: true, name };
}

/** Names of the custom folders in the project root, sorted. */
export async function listCustomFolders(dirHandle) {
  if (!dirHandle) return [];
  const names = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle?.kind !== 'directory') continue;
    if (name.startsWith('.') || RESERVED_NAMES.has(name.toLowerCase())) continue;
    names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** Creates the folder. Throws an Error with a readable message on a bad or taken name. */
export async function createCustomFolder(dirHandle, rawName) {
  const checked = validateFolderName(rawName);
  if (!checked.ok) throw new Error(checked.error);

  // Case-insensitive on purpose: "Notes" and "notes" are the same folder on Windows/macOS.
  const existing = new Set();
  for await (const [name] of dirHandle.entries()) existing.add(name.toLowerCase());
  if (existing.has(checked.name.toLowerCase())) {
    throw new Error(`"${checked.name}" already exists in this project.`);
  }

  await dirHandle.getDirectoryHandle(checked.name, { create: true });
  return checked.name;
}

/** Deletes a custom folder and everything inside it. */
export async function deleteCustomFolder(dirHandle, name) {
  const checked = validateFolderName(name);
  if (!checked.ok) throw new Error(checked.error);
  await dirHandle.removeEntry(checked.name, { recursive: true });
}