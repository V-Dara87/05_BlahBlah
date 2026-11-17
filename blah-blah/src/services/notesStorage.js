/**
 * Disk I/O for frame notes: <project>/ai-notes/{notes.json, NOTES.md,
 * README_FOR_AI.md, frames/*.png}.
 *
 * notes.json is shared with external AI agents that tick notes off while the
 * editor is open. So every change here is read-modify-write on the file as it
 * is on disk right now (never "save my in-memory copy"), under a per-project
 * lock, and a file that cannot be parsed is never overwritten.
 *
 * Needs the Tauri fs plugin (same as the AI bridge); in a plain browser every
 * call reports that notes are unavailable.
 */

import { isTauri, joinPath } from './tauriFsAdapter';
import { base64ToUint8Array } from '../utils/aiBridgeCore';
import {
  NOTES_DIR_NAME,
  NOTES_FILE_NAME,
  NOTES_MARKDOWN_NAME,
  NOTES_README_NAME,
  NOTES_FRAMES_DIR,
  MAX_NOTES,
  MAX_NOTES_FILE_CHARS,
  sanitizeNotesFile,
  serializeNotesFile,
  buildNotesMarkdown,
  buildAgentReadme,
  isSafeNoteId,
  isSafeFramePath,
} from './notesCore';

export class NotesFileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotesFileError';
  }
}

export function notesSupported(projectDir) {
  return Boolean(projectDir) && isTauri();
}

export function getNotesPaths(projectDir) {
  const dir = joinPath(projectDir, NOTES_DIR_NAME);
  return {
    dir,
    file: joinPath(dir, NOTES_FILE_NAME),
    markdown: joinPath(dir, NOTES_MARKDOWN_NAME),
    readme: joinPath(dir, NOTES_README_NAME),
    frames: joinPath(dir, NOTES_FRAMES_DIR),
  };
}

async function getFs() {
  if (!isTauri()) return null;
  try {
    return await import('@tauri-apps/plugin-fs');
  } catch (err) {
    console.warn('Notes: Tauri fs plugin could not be imported:', err);
    return null;
  }
}

// One queue per project folder, so two edits never interleave their
// read-modify-write cycles.
const locks = new Map();
function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.then(task, task);
  locks.set(
    key,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

async function writeTextAtomic(fs, filePath, text) {
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeTextFile(tmp, text);
    await fs.rename(tmp, filePath);
  } catch {
    try {
      await fs.remove(tmp);
    } catch {
      // best effort
    }
    await fs.writeTextFile(filePath, text);
  }
}

async function writeBytesAtomic(fs, filePath, bytes) {
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, filePath);
  } catch {
    try {
      await fs.remove(tmp);
    } catch {
      // best effort
    }
    await fs.writeFile(filePath, bytes);
  }
}

function folderName(projectDir) {
  const parts = String(projectDir || '').split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || 'project';
}

/**
 * Reads notes.json as it is on disk.
 * @returns {Promise<{supported: boolean, exists: boolean, notes: object[], warnings: string[], raw: string}>}
 * @throws {NotesFileError} when the file exists but cannot be used (the caller
 *   must then leave it alone — an agent may be in the middle of writing it).
 */
export async function readNotesFile(projectDir) {
  const fs = await getFs();
  if (!fs || !projectDir) return { supported: false, exists: false, notes: [], warnings: [], raw: '' };
  const paths = getNotesPaths(projectDir);
  if (!(await fs.exists(paths.file))) {
    return { supported: true, exists: false, notes: [], warnings: [], raw: '' };
  }
  const raw = await fs.readTextFile(paths.file);
  if (raw.length > MAX_NOTES_FILE_CHARS) {
    throw new NotesFileError('notes.json is too large to open.');
  }
  if (raw.trim() === '') return { supported: true, exists: true, notes: [], warnings: [], raw };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new NotesFileError(
      `notes.json is not valid JSON (${err.message}). It may be in the middle of an edit; the editor will retry.`
    );
  }
  try {
    const { notes, warnings } = sanitizeNotesFile(parsed);
    return { supported: true, exists: true, notes, warnings, raw };
  } catch (err) {
    throw new NotesFileError(err.message);
  }
}

async function writeMirrors(fs, paths, notes, projectDir) {
  // NOTES.md and the README are conveniences for agents; failing to write them
  // must never fail the edit that was already saved to notes.json.
  try {
    await writeTextAtomic(fs, paths.markdown, buildNotesMarkdown(notes, { projectName: folderName(projectDir) }));
    const readme = buildAgentReadme();
    let current = null;
    try {
      current = (await fs.exists(paths.readme)) ? await fs.readTextFile(paths.readme) : null;
    } catch {
      current = null;
    }
    if (current !== readme) await writeTextAtomic(fs, paths.readme, readme);
  } catch (err) {
    console.warn('Notes: could not update NOTES.md / README:', err);
  }
}

/**
 * Applies `mutator(notesOnDisk)` and writes the result.
 * `mutator` returns the complete new notes array.
 * @returns {Promise<{notes: object[], raw: string}>}
 */
export function mutateNotes(projectDir, mutator) {
  return withLock(projectDir, async () => {
    const fs = await getFs();
    if (!fs || !projectDir) throw new NotesFileError('Notes need the BlahBlah desktop app and an open project folder.');
    const paths = getNotesPaths(projectDir);
    await fs.mkdir(paths.frames, { recursive: true });

    const current = await readNotesFile(projectDir);
    const next = await mutator(current.notes);
    if (!Array.isArray(next)) throw new Error('Notes mutation must return an array.');
    if (next.length > MAX_NOTES) throw new NotesFileError(`A project can hold at most ${MAX_NOTES} notes.`);

    const raw = serializeNotesFile(next);
    await writeTextAtomic(fs, paths.file, raw);
    await writeMirrors(fs, paths, next, projectDir);
    return { notes: sanitizeNotesFile(JSON.parse(raw)).notes, raw };
  });
}

/**
 * Saves one captured frame and returns its path relative to ai-notes/.
 * `which` is "start", "end" or "marked". Re-capturing overwrites the same file.
 */
export async function writeNoteFrame(projectDir, noteId, which, pngBase64) {
  if (!isSafeNoteId(noteId) || (which !== 'start' && which !== 'end' && which !== 'marked')) {
    throw new Error('Invalid note frame target.');
  }
  if (!pngBase64) throw new Error('Frame capture returned no image data.');
  const fs = await getFs();
  if (!fs) throw new NotesFileError('Notes need the BlahBlah desktop app.');
  const paths = getNotesPaths(projectDir);
  await fs.mkdir(paths.frames, { recursive: true });
  const relative = `${NOTES_FRAMES_DIR}/${noteId}-${which}.png`;
  await writeBytesAtomic(fs, joinPath(paths.dir, relative), base64ToUint8Array(pngBase64));
  return relative;
}

export async function removeNoteFrames(projectDir, frames) {
  const fs = await getFs();
  if (!fs || !frames) return;
  const paths = getNotesPaths(projectDir);
  for (const relative of [frames.start, frames.end, frames.marked]) {
    if (!isSafeFramePath(relative)) continue;
    try {
      await fs.remove(joinPath(paths.dir, relative));
    } catch {
      // already gone
    }
  }
}

/** Bytes of a saved frame, for thumbnails. Null when it is missing. */
export async function readNoteFrameBytes(projectDir, relative) {
  if (!isSafeFramePath(relative)) return null;
  const fs = await getFs();
  if (!fs) return null;
  try {
    return await fs.readFile(joinPath(getNotesPaths(projectDir).dir, relative));
  } catch {
    return null;
  }
}