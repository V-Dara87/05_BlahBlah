/**
 * notesStore — module-level store for frame notes (see services/notesCore.js).
 *
 * Why a plain external store instead of App state: the Notes dock tab and the
 * timeline ruler both read the notes, either may be unmounted, and nothing in
 * App.jsx needs to know about them. <NotesSync/> (mounted once by DockLayout)
 * tells this module which project folder is open and how to read the editor
 * state / playhead; everything else goes through the functions below.
 *
 * notes.json on disk is the source of truth: it is re-read every few seconds
 * and on window focus, which is how an agent ticking a note off shows up.
 */

import { useSyncExternalStore } from 'react';
import { renderEditorFrame } from '../services/aiBridgeService';
import { showNotice } from '../utils/notice';
import {
  notesSupported,
  readNotesFile,
  mutateNotes,
  writeNoteFrame,
  removeNoteFrames,
} from '../services/notesStorage';
import {
  createNote,
  clampTime,
  roundTime,
  sanitizeDrawing,
  MAX_NOTE_TEXT,
  MAX_AGENT_REPLY,
  DEFAULT_RANGE_SECONDS,
} from '../services/notesCore';
import { compositeMarkedFrame } from '../services/notesDrawing';

const POLL_MS = 3000;
const EMPTY = Object.freeze([]);

let state = {
  projectDir: null,
  supported: false,
  loaded: false,
  notes: EMPTY,
  warnings: EMPTY,
  error: null,
  busy: 0,
  activeNoteId: null,
  focusNoteId: null,
};
const listeners = new Set();

let context = { getEditorState: null, getPlayback: null, focusPanel: null };
let pollTimer = null;
let removeFocusListener = null;
let generation = 0; // bumps when the project folder changes, so late results are ignored
let lastRaw = null;

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeNotes(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNotesSnapshot() {
  return state;
}

export function useNotes() {
  return useSyncExternalStore(subscribeNotes, getNotesSnapshot, getNotesSnapshot);
}

// ── watching disk ──────────────────────────────────────────────────────────

function stopWatching() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (removeFocusListener) removeFocusListener();
  removeFocusListener = null;
}

function startWatching() {
  stopWatching();
  if (!state.projectDir || !state.supported || typeof window === 'undefined') return;
  pollTimer = setInterval(() => {
    if (document.visibilityState !== 'hidden') void refreshNotes();
  }, POLL_MS);
  const onFocus = () => {
    void refreshNotes();
  };
  window.addEventListener('focus', onFocus);
  removeFocusListener = () => window.removeEventListener('focus', onFocus);
}

/** Re-reads notes.json. Keeps the previous notes (and reports) if the file is unreadable. */
export async function refreshNotes() {
  const dir = state.projectDir;
  if (!dir || !state.supported) return;
  const gen = generation;
  try {
    const result = await readNotesFile(dir);
    if (gen !== generation) return;
    if (state.loaded && !state.error && result.raw === lastRaw) return;
    lastRaw = result.raw;
    setState({ notes: result.notes, warnings: result.warnings, loaded: true, error: null });
  } catch (err) {
    if (gen !== generation) return;
    const message = err?.message || String(err);
    if (!state.loaded || state.error !== message) setState({ loaded: true, error: message });
  }
}

/**
 * Called by <NotesSync/>. Returns a cleanup that stops the polling timer.
 * Safe to call again with the same folder (it only refreshes the callbacks).
 */
export function configureNotes({ projectDir, getEditorState, getPlayback, focusPanel }) {
  context = { getEditorState, getPlayback, focusPanel };
  const dir = projectDir || null;
  if (dir !== state.projectDir) {
    generation += 1;
    lastRaw = null;
    setState({
      projectDir: dir,
      supported: notesSupported(dir),
      loaded: false,
      notes: EMPTY,
      warnings: EMPTY,
      error: null,
      activeNoteId: null,
      focusNoteId: null,
    });
    if (dir && state.supported) void refreshNotes();
  }
  startWatching();
  return stopWatching;
}

// ── frame capture ──────────────────────────────────────────────────────────

function currentTime() {
  return context.getPlayback?.()?.getCurrentTime?.() ?? 0;
}

/** Pauses playback (marking a moving picture is no fun). */
export function pausePlayback() {
  context.getPlayback?.()?.pause?.();
}

async function captureFrame(time) {
  if (!context.getEditorState) throw new Error('The editor is not ready yet.');
  const s = context.getEditorState();
  const result = await renderEditorFrame({
    time,
    entities: s.entities || [],
    tracks: s.tracks || [],
    scripts: s.scripts || [],
    resolution: s.resolution,
    mediaAssets: s.mediaAssets || [],
  });
  return result?.pngBase64 || null;
}

/**
 * Start frame always; end frame for range notes; and, when the note has marks,
 * a "marked" copy of the start frame with the drawing burned in so an agent can
 * see what was marked. A failed frame never blocks the note.
 */
async function captureNoteFrames(dir, noteId, time, duration, drawing = null) {
  const frames = {};
  let failed = false;
  const targets = [['start', time]];
  if (duration > 0) targets.push(['end', time + duration]);
  for (const [which, at] of targets) {
    try {
      const png = await captureFrame(at);
      frames[which] = await writeNoteFrame(dir, noteId, which, png);
      if (which === 'start' && drawing) {
        try {
          const marked = await compositeMarkedFrame(png, drawing);
          frames.marked = await writeNoteFrame(dir, noteId, 'marked', marked);
        } catch (err) {
          failed = true;
          console.warn('Notes: could not write the marked frame:', err);
        }
      }
    } catch (err) {
      failed = true;
      console.warn(`Notes: could not capture the ${which} frame:`, err);
    }
  }
  return { frames, failed };
}

// ── mutations ──────────────────────────────────────────────────────────────

function bump(delta) {
  setState({ busy: Math.max(0, state.busy + delta) });
}

function ready() {
  if (!state.projectDir || !state.supported) {
    showNotice('Notes need the desktop app with an open project.');
    return null;
  }
  return state.projectDir;
}

async function runMutation(mutator) {
  const dir = state.projectDir;
  const gen = generation;
  const result = await mutateNotes(dir, mutator);
  if (gen === generation) {
    lastRaw = result.raw;
    setState({ notes: result.notes, warnings: EMPTY, error: null, loaded: true });
  }
  return result.notes;
}

/**
 * Adds a note and captures its frame(s). Resolves to the note, or null when it
 * could not be saved (a notice explains why).
 */
export async function addNote({ time, duration = 0, text = '', capture = true, drawing = null } = {}) {
  const dir = ready();
  if (!dir) return null;
  const note = createNote({ time: time ?? currentTime(), duration, text, drawing });
  bump(1);
  try {
    if (capture) {
      const { frames, failed } = await captureNoteFrames(dir, note.id, note.time, note.duration, note.drawing);
      note.frames = frames;
      if (failed) showNotice('Note added, but its frame could not be captured.');
    }
    try {
      await runMutation((list) => [...list, note]);
    } catch (err) {
      await removeNoteFrames(dir, note.frames);
      throw err;
    }
    setState({ activeNoteId: note.id, focusNoteId: text ? null : note.id });
    return note;
  } catch (err) {
    showNotice(`Could not add the note: ${err?.message || err}`);
    return null;
  } finally {
    bump(-1);
  }
}

/** Shortcut entry: a note at the playhead, or (range) over Export In/Out, else a few seconds. */
export function addNoteAtPlayhead({ range = false, drawing = null } = {}) {
  let time = currentTime();
  let duration = 0;
  if (range) {
    const exportRange = context.getEditorState?.()?.exportRange;
    if (
      exportRange &&
      Number.isFinite(exportRange.in) &&
      Number.isFinite(exportRange.out) &&
      exportRange.out > exportRange.in
    ) {
      time = exportRange.in;
      duration = exportRange.out - exportRange.in;
    } else {
      duration = DEFAULT_RANGE_SECONDS;
    }
  }
  context.focusPanel?.();
  return addNote({ time, duration, drawing });
}

/**
 * Note at an explicit time (timeline right-click menus, ruler): `time` seconds,
 * plus `duration` > 0 for a range. Opens the Notes tab like the shortcut does.
 */
export function addNoteAt({ time, duration = 0 } = {}) {
  context.focusPanel?.();
  return addNote({ time: clampTime(time, currentTime()), duration: clampTime(duration, 0) });
}

/** Shows a note in the Notes tab: opens/focuses the tab, selects the note, focuses its text box. */
export function openNoteInPanel(id) {
  context.focusPanel?.();
  setState({ activeNoteId: id, focusNoteId: id });
}

function cleanPatch(patch) {
  const clean = {};
  if (typeof patch.text === 'string') clean.text = patch.text.slice(0, MAX_NOTE_TEXT);
  if (typeof patch.agentReply === 'string') clean.agentReply = patch.agentReply.slice(0, MAX_AGENT_REPLY);
  if (typeof patch.done === 'boolean') clean.done = patch.done;
  const time = Number(patch.time);
  if (patch.time !== undefined && Number.isFinite(time)) clean.time = roundTime(clampTime(time));
  const duration = Number(patch.duration);
  if (patch.duration !== undefined && Number.isFinite(duration)) clean.duration = roundTime(clampTime(duration));
  // The marks drawn on the preview. null (or nothing usable) removes them.
  if (patch.drawing !== undefined) clean.drawing = patch.drawing ? sanitizeDrawing(patch.drawing) : null;
  return clean;
}

export async function updateNote(id, patch) {
  if (!ready()) return null;
  const clean = cleanPatch(patch || {});
  const known = state.notes.find((n) => n.id === id);
  const sameValue = (key) =>
    key === 'drawing'
      ? JSON.stringify(known?.drawing ?? null) === JSON.stringify(clean.drawing ?? null)
      : known?.[key] === clean[key];
  if (known && Object.keys(clean).every(sameValue)) return known;

  let before = null;
  let after = null;
  try {
    await runMutation((list) =>
      list.map((n) => {
        if (n.id !== id) return n;
        before = n;
        const now = Date.now();
        after = { ...n, ...clean, updatedAt: now };
        if ('done' in clean) after.doneAt = clean.done ? now : null;
        if ('drawing' in clean && !clean.drawing) delete after.drawing;
        return after;
      })
    );
  } catch (err) {
    showNotice(`Could not update the note: ${err?.message || err}`);
    return null;
  }
  if (!after) {
    showNotice('That note no longer exists.');
    return null;
  }
  // The screenshots belong to a moment (and the marked one to its marks); moving
  // the note or changing its marks makes them stale.
  const marksChanged = JSON.stringify(before.drawing ?? null) !== JSON.stringify(after.drawing ?? null);
  if (before.time !== after.time || before.duration !== after.duration || marksChanged) {
    void recaptureNoteFrames(id);
  }
  return after;
}

export function setNoteDone(id, done) {
  return updateNote(id, { done: Boolean(done) });
}

export async function recaptureNoteFrames(id) {
  const dir = ready();
  if (!dir) return null;
  const note = state.notes.find((n) => n.id === id);
  if (!note) return null;
  bump(1);
  try {
    const { frames, failed } = await captureNoteFrames(dir, id, note.time, note.duration, note.drawing);
    if (failed) showNotice('Could not capture every frame for this note.');
    if (!(note.duration > 0) && note.frames?.end) await removeNoteFrames(dir, { end: note.frames.end });
    if (!note.drawing && note.frames?.marked) await removeNoteFrames(dir, { marked: note.frames.marked });
    await runMutation((list) =>
      list.map((n) => {
        if (n.id !== id) return n;
        const merged = { ...n.frames, ...frames };
        if (!(n.duration > 0)) delete merged.end;
        if (!n.drawing) delete merged.marked;
        return { ...n, frames: merged, updatedAt: Date.now() };
      })
    );
    return true;
  } catch (err) {
    showNotice(`Could not refresh the frame: ${err?.message || err}`);
    return null;
  } finally {
    bump(-1);
  }
}

export async function removeNote(id) {
  const dir = ready();
  if (!dir) return false;
  let removed = null;
  try {
    await runMutation((list) =>
      list.filter((n) => {
        if (n.id === id) {
          removed = n;
          return false;
        }
        return true;
      })
    );
  } catch (err) {
    showNotice(`Could not delete the note: ${err?.message || err}`);
    return false;
  }
  if (removed) await removeNoteFrames(dir, removed.frames);
  if (state.activeNoteId === id) setState({ activeNoteId: null });
  return true;
}

// ── selection ──────────────────────────────────────────────────────────────

export function setActiveNote(id) {
  if (state.activeNoteId !== id) setState({ activeNoteId: id });
}

export function clearFocusNote() {
  if (state.focusNoteId !== null) setState({ focusNoteId: null });
}

/** Moves the playhead to the start of a note and marks it active. */
export function seekToNote(note) {
  context.getPlayback?.()?.seek?.(note.time);
  setActiveNote(note.id);
}