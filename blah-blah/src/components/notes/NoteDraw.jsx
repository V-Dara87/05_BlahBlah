import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Pencil, Square, Circle, ArrowUpRight, Undo2, Trash2, Check, X, Eye, EyeOff } from 'lucide-react';
import { useNotes } from '../../hooks/notesStore';
import {
  useNoteDraw,
  startDrawing,
  cancelDrawing,
  setDrawTool,
  setDrawColor,
  setDrawSize,
  addShape,
  undoShape,
  clearShapes,
  toggleShowMarks,
  saveDrawing,
  DRAW_COLORS,
  DRAW_SIZES,
} from '../../hooks/noteDrawStore';
import { noteMarksVisibleAt, formatNoteRange } from '../../services/notesCore';
import { paintDrawing } from '../../services/notesDrawing';
import './note-draw.css';

/**
 * Draw on the preview to show WHICH PART of the video should change, then save
 * the marks as a note (see hooks/noteDrawStore.js and services/notesCore.js).
 *
 * The marks are annotations. They are drawn on a canvas that sits on top of the
 * preview only; the export / frame-capture pipeline never sees it, so nothing
 * drawn here is rendered into the video.
 *
 * Two pieces, mounted by EntityRenderer:
 *   <NoteDrawToolbar/>  above the preview: the "Mark" button, and while drawing
 *                       the tools, colours, undo and Save buttons.
 *   <NoteDrawCanvas/>   inside the preview's frame-sized layer, so it shares the
 *                       preview's pan / zoom and is sized in project pixels.
 */

const TOOLS = [
  { id: 'pen', label: 'Pen', Icon: Pencil },
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', Icon: Circle },
  { id: 'arrow', label: 'Arrow', Icon: ArrowUpRight },
];

// The overlay canvas never needs more pixels than a 1080p frame to look sharp.
const MAX_BACKING_WIDTH = 1920;
const EMPTY = [];

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export const NoteDrawCanvas = memo(function NoteDrawCanvas({ width, height, currentTime }) {
  const { notes } = useNotes();
  const draw = useNoteDraw();
  const canvasRef = useRef(null);
  const draftRef = useRef(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const scale = Math.min(1, MAX_BACKING_WIDTH / width);
  const backW = Math.max(1, Math.round(width * scale));
  const backH = Math.max(1, Math.round(height * scale));

  // Marks of saved notes that apply at the playhead. Hidden while drawing so the
  // new marks are not confused with old ones.
  const marks = useMemo(() => {
    if (draw.active || !draw.showMarks) return EMPTY;
    return notes.filter((n) => noteMarksVisibleAt(n, currentTime));
  }, [notes, currentTime, draw.active, draw.showMarks]);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  // `marks` is a new array every frame during playback; only repaint when the set changes.
  const markKey = marks.map((n) => `${n.id}:${n.updatedAt}`).join('|');

  const paintAll = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const note of marksRef.current) {
      paintDrawing(ctx, note.drawing.shapes, canvas.width, canvas.height);
    }
    const current = drawRef.current;
    if (current.active) {
      paintDrawing(ctx, current.shapes, canvas.width, canvas.height);
      if (draftRef.current) paintDrawing(ctx, [draftRef.current], canvas.width, canvas.height);
    }
  }, []);

  useLayoutEffect(() => {
    paintAll();
  }, [markKey, draw.shapes, draw.active, backW, backH, paintAll]);

  // Pointer handling. Native listeners (not React props) so stopPropagation
  // really keeps the preview's own handlers (selection, pan) from also reacting.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !draw.active) return undefined;

    let current = null;
    let pointerId = null;

    const toUnit = (e) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return [clamp01((e.clientX - rect.left) / rect.width), clamp01((e.clientY - rect.top) / rect.height)];
    };

    const onDown = (e) => {
      if (e.button !== 0) return; // right / middle button keep panning the preview
      const point = toUnit(e);
      if (!point) return;
      e.stopPropagation();
      e.preventDefault();
      const { tool, color, size } = drawRef.current;
      current =
        tool === 'pen'
          ? { type: 'pen', color, size, points: [point] }
          : { type: tool, color, size, from: point, to: point };
      draftRef.current = current;
      pointerId = e.pointerId;
      canvas.setPointerCapture?.(e.pointerId);
      paintAll();
    };

    const onMove = (e) => {
      if (!current || e.pointerId !== pointerId) return;
      const point = toUnit(e);
      if (!point) return;
      if (current.type === 'pen') {
        const last = current.points[current.points.length - 1];
        const dx = (point[0] - last[0]) * width;
        const dy = (point[1] - last[1]) * height;
        if (dx * dx + dy * dy < 4) return; // skip sub-2px jitter
        current.points.push(point);
      } else {
        current.to = point;
      }
      paintAll();
    };

    const finish = (e, commit) => {
      if (!current || e.pointerId !== pointerId) return;
      canvas.releasePointerCapture?.(e.pointerId);
      const shape = current;
      current = null;
      pointerId = null;
      draftRef.current = null;
      let keep = commit;
      if (keep && shape.type !== 'pen') {
        // A click without a drag is not a rectangle / ellipse / arrow.
        const dx = Math.abs(shape.to[0] - shape.from[0]) * width;
        const dy = Math.abs(shape.to[1] - shape.from[1]) * height;
        keep = dx >= 4 || dy >= 4;
      }
      if (keep) addShape(shape);
      else paintAll();
    };
    const onUp = (e) => finish(e, true);
    const onCancel = (e) => finish(e, false);

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      draftRef.current = null;
    };
  }, [draw.active, width, height, paintAll]);

  if (!draw.active && marks.length === 0) return null;
  return (
    <canvas
      ref={canvasRef}
      className={`note-draw-canvas${draw.active ? ' is-active' : ''}`}
      width={backW}
      height={backH}
      style={{ width: `${width}px`, height: `${height}px` }}
    />
  );
});

export const NoteDrawToolbar = memo(function NoteDrawToolbar({ width, height }) {
  const draw = useNoteDraw();
  const { supported, projectDir, notes } = useNotes();

  // Marks drawn for one project must not be saved into another.
  const lastDirRef = useRef(projectDir);
  useEffect(() => {
    if (lastDirRef.current !== projectDir) {
      lastDirRef.current = projectDir;
      cancelDrawing();
    }
  }, [projectDir]);

  if (!draw.active) {
    if (!supported || !projectDir) return null;
    return (
      <div className="note-draw-idle">
        <button
          type="button"
          className="note-draw-btn"
          title="Draw on the preview to mark the part you want changed, then save it as a note (default key: B)"
          onClick={() => startDrawing()}
        >
          <Pencil size={13} />
          <span>Mark</span>
        </button>
        <button
          type="button"
          className={`note-draw-btn is-icon${draw.showMarks ? ' is-on' : ''}`}
          title={draw.showMarks ? 'Hide the marks of saved notes' : 'Show the marks of saved notes'}
          onClick={toggleShowMarks}
        >
          {draw.showMarks ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
      </div>
    );
  }

  const editing = draw.editNoteId ? notes.find((n) => n.id === draw.editNoteId) : null;
  const count = draw.shapes.length;
  const canSave = count > 0 && !draw.saving;
  const save = (range) => void saveDrawing({ range, width, height });

  return (
    <div className="note-draw-bar is-active" onPointerDown={(e) => e.stopPropagation()}>
      <div className="note-draw-group" role="group" aria-label="Drawing tool">
        {TOOLS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`note-draw-btn is-icon${draw.tool === id ? ' is-on' : ''}`}
            title={label}
            aria-pressed={draw.tool === id}
            onClick={() => setDrawTool(id)}
          >
            <Icon size={13} />
          </button>
        ))}
      </div>

      <span className="note-draw-sep" />

      <div className="note-draw-group" role="group" aria-label="Colour">
        {DRAW_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`note-draw-swatch${draw.color === color ? ' is-on' : ''}`}
            style={{ background: color }}
            title={color}
            aria-pressed={draw.color === color}
            onClick={() => setDrawColor(color)}
          />
        ))}
      </div>

      <span className="note-draw-sep" />

      <div className="note-draw-group" role="group" aria-label="Thickness">
        {DRAW_SIZES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`note-draw-btn is-icon${draw.size === s.value ? ' is-on' : ''}`}
            title={`${s.label} line`}
            aria-pressed={draw.size === s.value}
            onClick={() => setDrawSize(s.value)}
          >
            <span className="note-draw-dot" style={{ width: s.dot, height: s.dot }} />
          </button>
        ))}
      </div>

      <span className="note-draw-sep" />

      <button type="button" className="note-draw-btn is-icon" title="Undo the last mark (Ctrl+Z)" disabled={count === 0} onClick={undoShape}>
        <Undo2 size={13} />
      </button>
      <button type="button" className="note-draw-btn is-icon" title="Clear all marks" disabled={count === 0} onClick={clearShapes}>
        <Trash2 size={13} />
      </button>
      <span className="note-draw-count">
        {count} mark{count === 1 ? '' : 's'}
      </span>

      <span className="note-draw-spacer" />

      {draw.editNoteId ? (
        <>
          {editing && <span className="note-draw-label">Note {formatNoteRange(editing)}</span>}
          <button type="button" className="note-draw-btn is-primary" title="Save these marks on the note" disabled={!canSave} onClick={() => save(false)}>
            <Check size={13} /> Save marks
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="note-draw-btn is-primary"
            title="Save the marks as a note pinned to the current frame"
            disabled={!canSave}
            onClick={() => save(false)}
          >
            <Check size={13} /> Note
          </button>
          <button
            type="button"
            className="note-draw-btn is-primary"
            title="Save the marks as a range note: the Export In/Out range if set, else 3 seconds"
            disabled={!canSave}
            onClick={() => save(true)}
          >
            <Check size={13} /> Range
          </button>
        </>
      )}
      <button type="button" className="note-draw-btn is-icon" title="Stop drawing without saving (Esc)" onClick={cancelDrawing}>
        <X size={13} />
      </button>
    </div>
  );
});