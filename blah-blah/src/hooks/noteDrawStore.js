/**
 * noteDrawStore — module-level store for "draw on the preview" mode.
 *
 * The user draws marks (pen, rectangle, ellipse, arrow) straight on the
 * preview to show WHICH PART of the video should change, then saves them as a
 * note. The marks are annotations: they live in notes.json (note.drawing) and
 * in a marked copy of the frame, and are never part of the project or of the
 * rendered video.
 *
 * Same shape as notesStore: a plain external store read with
 * useSyncExternalStore, so the toolbar (above the preview), the drawing
 * canvas (inside the preview frame), the Notes panel and the keyboard
 * shortcuts can all reach it without App state.
 */

import { useSyncExternalStore } from 'react';
import { showNotice } from '../utils/notice';
import { readJson, writeJson } from '../utils/appStorage';
import { MAX_DRAWING_SHAPES, MAX_PEN_POINTS } from '../services/notesCore';
import { addNoteAtPlayhead, updateNote, seekToNote, getNotesSnapshot, pausePlayback } from './notesStore';

export const DRAW_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#38bdf8', '#ffffff'];

/** `value` is a fraction of the frame width; `dot` is the toolbar swatch size in px. */
export const DRAW_SIZES = [
  { id: 'thin', label: 'Thin', value: 0.0025, dot: 3 },
  { id: 'medium', label: 'Medium', value: 0.005, dot: 6 },
  { id: 'thick', label: 'Thick', value: 0.009, dot: 10 },
];

const EMPTY = Object.freeze([]);
const SHOW_MARKS_KEY = 'blahblah.noteMarks.show.v1';

function loadShowMarks() {
  try {
    return readJson(SHOW_MARKS_KEY, true) !== false;
  } catch {
    return true;
  }
}

let state = {
  active: false,
  saving: false,
  editNoteId: null, // null = drawing for a new note; otherwise editing that note's marks
  tool: 'pen',
  color: DRAW_COLORS[0],
  size: DRAW_SIZES[1].value,
  shapes: EMPTY,
  showMarks: loadShowMarks(), // show the marks of saved notes on the preview (remembered between sessions)
};
const listeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeNoteDraw(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNoteDrawSnapshot() {
  return state;
}

export function useNoteDraw() {
  return useSyncExternalStore(subscribeNoteDraw, getNoteDrawSnapshot, getNoteDrawSnapshot);
}

export function isDrawingActive() {
  return state.active;
}

// ── mode ───────────────────────────────────────────────────────────────────

/** Starts drawing marks for a NEW note at the playhead. */
export function startDrawing() {
  const notes = getNotesSnapshot();
  if (!notes.projectDir || !notes.supported) {
    showNotice('Notes need the desktop app with an open project.');
    return false;
  }
  pausePlayback();
  setState({ active: true, saving: false, editNoteId: null, shapes: EMPTY });
  return true;
}

/** Starts editing the marks of an existing note (jumps the playhead to it). */
export function startEditingNote(id) {
  const notes = getNotesSnapshot();
  const note = notes.notes.find((n) => n.id === id);
  if (!note) return false;
  pausePlayback();
  seekToNote(note);
  const shapes = (note.drawing?.shapes || []).map((shape) => JSON.parse(JSON.stringify(shape)));
  setState({ active: true, saving: false, editNoteId: id, shapes: Object.freeze(shapes) });
  return true;
}

export function cancelDrawing() {
  if (!state.active && state.shapes.length === 0 && state.editNoteId === null) return;
  setState({ active: false, saving: false, editNoteId: null, shapes: EMPTY });
}

export function toggleDrawing() {
  if (state.active) cancelDrawing();
  else startDrawing();
}

// ── tools ──────────────────────────────────────────────────────────────────

export function setDrawTool(tool) {
  setState({ tool });
}

export function setDrawColor(color) {
  setState({ color });
}

export function setDrawSize(size) {
  setState({ size });
}

export function toggleShowMarks() {
  const next = !state.showMarks;
  try {
    writeJson(SHOW_MARKS_KEY, next);
  } catch {
    // not remembered; still applies for this session
  }
  setState({ showMarks: next });
}

// ── shapes ─────────────────────────────────────────────────────────────────

function decimate(points, max) {
  if (points.length <= max) return points;
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)]);
  return out;
}

export function addShape(shape) {
  if (!state.active || !shape) return;
  if (state.shapes.length >= MAX_DRAWING_SHAPES) {
    showNotice(`A note can hold at most ${MAX_DRAWING_SHAPES} marks.`);
    return;
  }
  const next = shape.type === 'pen' ? { ...shape, points: decimate(shape.points, MAX_PEN_POINTS) } : shape;
  setState({ shapes: Object.freeze([...state.shapes, next]) });
}

export function undoShape() {
  if (state.shapes.length === 0) return;
  setState({ shapes: Object.freeze(state.shapes.slice(0, -1)) });
}

export function clearShapes() {
  if (state.shapes.length === 0) return;
  setState({ shapes: EMPTY });
}

// ── saving ─────────────────────────────────────────────────────────────────

/**
 * Saves the marks. New note: at the playhead (`range` = a range note, like
 * Shift+M). Editing: replaces that note's marks. Stays in drawing mode when the
 * save fails, so the work is not lost.
 *
 * @param {{ range?: boolean, width: number, height: number }} args  frame size in project pixels
 */
export async function saveDrawing({ range = false, width, height } = {}) {
  if (state.saving) return null;
  if (state.shapes.length === 0) {
    showNotice('Draw something first.');
    return null;
  }
  const drawing = { width, height, shapes: state.shapes };
  const editId = state.editNoteId;
  setState({ saving: true });
  try {
    const note = editId ? await updateNote(editId, { drawing }) : await addNoteAtPlayhead({ range, drawing });
    if (note) cancelDrawing();
    return note;
  } finally {
    if (state.active) setState({ saving: false });
  }
}