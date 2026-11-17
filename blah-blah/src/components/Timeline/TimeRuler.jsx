import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { MessageSquarePlus, MessageSquare, Crosshair, Check, Undo2, Trash2 } from 'lucide-react';
import { ContextMenu } from '../shared/ContextMenu';
import { usePlaybackStore } from '../../hooks/PlaybackContext';
import { formatTimecode } from '../../utils/timeFormat';
import { getTickIntervalSeconds } from '../../utils/timelineLayout';
import { applyEdgeAutoScroll } from '../../utils/timelineAutoScroll';
import {
  useNotes,
  seekToNote,
  addNoteAt,
  setNoteDone,
  removeNote,
  updateNote,
  openNoteInPanel,
} from '../../hooks/notesStore';
import { formatNoteRange, DEFAULT_RANGE_SECONDS } from '../../services/notesCore';
import './time-ruler.css';
import './notes-ruler.css';

// Module-level so the default below keeps one identity across renders
// (a `= []` default parameter creates a new array every render and defeats memo).
const EMPTY_ARRAY = Object.freeze([]);
 
export const TimeRuler = memo(function TimeRuler({
  totalDuration,
  pixelsPerSecond,
  totalWidth: propTotalWidth,
  onSeek,
  exportRange,
  snappingPoints = EMPTY_ARRAY,
  snappingEnabled = false,
}) {
  const store = usePlaybackStore();
  const { notes, activeNoteId } = useNotes();
  const rulerRef = useRef(null);
  const HEADER_WIDTH = 180;

  // Right-click menu: { x, y, time, noteId } | null. `noteId` is set when the
  // click landed on a note flag, otherwise the menu offers to add a note.
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // Live preview while a note is being dragged: { id, time, duration } | null.
  // The change is written to notes.json once, when the drag ends.
  const [drag, setDrag] = useState(null);
  const noteDragCleanupRef = useRef(null);
  useEffect(() => () => {
    if (noteDragCleanupRef.current) noteDragCleanupRef.current();
  }, []);

  const menuNote = menu?.noteId ? notes.find((n) => n.id === menu.noteId) || null : null;

  const timeAtClientX = (clientX) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, (clientX - rect.left - HEADER_WIDTH) / pixelsPerSecond);
  };
  const handleContextMenu = (e) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, time: timeAtClientX(e.clientX), noteId: null });
  };
  const handleNoteContextMenu = (e, note) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, time: note.time, noteId: note.id });
  };
  const addHere = (range) => {
    const at = menu?.time ?? 0;
    closeMenu();
    void addNoteAt({ time: at, duration: range ? DEFAULT_RANGE_SECONDS : 0 });
  };
  const addForExportRange = () => {
    closeMenu();
    if (exportRange) void addNoteAt({ time: exportRange.in, duration: Math.max(0, exportRange.out - exportRange.in) });
  };
  // Ends the scrub in progress (if any): removes window listeners and clears
  // the store's scrubbing flag. Also run on unmount so the flag can't stick.
  const endScrubRef = useRef(null);
  useEffect(() => () => {
    if (endScrubRef.current) endScrubRef.current();
  }, []);
 
  const getSnappedTime = (rawTime) => {
    if (!snappingEnabled || !snappingPoints || snappingPoints.length === 0) return rawTime;
    const snapThresholdSec = 8 / pixelsPerSecond;
    for (const point of snappingPoints) {
      if (Math.abs(rawTime - point) < snapThresholdSec) {
        return point;
      }
    }
    return rawTime;
  };
 
  // Drag a note flag to move it; drag the handle at the end of a range note's
  // bar to change its length. A press without movement is a click: jump to it.
  const startNoteDrag = (e, note, mode) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (noteDragCleanupRef.current) noteDragCleanupRef.current();
    const startX = e.clientX;
    const origTime = note.time;
    const origDuration = note.duration;
    let moved = false;
    let latest = { id: note.id, time: origTime, duration: origDuration };

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const delta = dx / pixelsPerSecond;
      if (mode === 'move') {
        latest = { id: note.id, time: Math.max(0, getSnappedTime(origTime + delta)), duration: origDuration };
      } else {
        const end = Math.max(origTime + 0.1, getSnappedTime(origTime + origDuration + delta));
        latest = { id: note.id, time: origTime, duration: end - origTime };
      }
      setDrag(latest);
    };
    const detach = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      noteDragCleanupRef.current = null;
    };
    const onUp = async () => {
      detach();
      if (!moved) {
        setDrag(null);
        seekToNote(note);
        return;
      }
      try {
        await updateNote(note.id, mode === 'move' ? { time: latest.time } : { duration: latest.duration });
      } finally {
        setDrag(null);
      }
    };
    const onCancel = () => {
      detach();
      setDrag(null);
    };
    noteDragCleanupRef.current = onCancel;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  const handlePointerDown = (e) => {
    if (!rulerRef.current) return;
    if (e.button !== 0) return;
    e.preventDefault();
    if (endScrubRef.current) endScrubRef.current();
    store.setScrubbing(true);
 
    const rect = rulerRef.current.getBoundingClientRect();
    // rect.left already accounts for horizontal scroll inside ruler-wrapper
    const offsetX = e.clientX - rect.left - HEADER_WIDTH;
    const rawTime = Math.max(0, offsetX / pixelsPerSecond);
    const snappedTime = getSnappedTime(rawTime);
    onSeek(snappedTime);
 
    const handlePointerMove = (moveEvent) => {
      if (!rulerRef.current) return;
      // Auto-scroll when scrubbing near edges. The shared helper also mirrors
      // the position onto our own `.ruler-wrapper` so the ticks move with the
      // lanes (this component previously scrolled only the lanes).
      applyEdgeAutoScroll(moveEvent.clientX, {
        lanesEl: document.querySelector('.lanes-wrapper'),
        rulerEl: rulerRef.current?.closest('.ruler-wrapper') || null,
        headerWidth: HEADER_WIDTH,
        edgeMargin: 50,
        scrollSpeed: 12,
      });
 
      const curRect = rulerRef.current.getBoundingClientRect();
      const moveOffsetX = moveEvent.clientX - curRect.left - HEADER_WIDTH;
      const scrubRaw = Math.max(0, moveOffsetX / pixelsPerSecond);
      const scrubSnapped = getSnappedTime(scrubRaw);
      onSeek(scrubSnapped);
    };
 
    const handlePointerUp = () => {
      endScrubRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      // Flushes display-only consumers to the final time.
      store.setScrubbing(false);
    };
    endScrubRef.current = handlePointerUp;
 
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };
 
  // Determine tick interval based on zoom level — shared with TrackLane's
  // background grid via getTickIntervalSeconds so both stay in sync.
  const tickInterval = getTickIntervalSeconds(pixelsPerSecond);
 
  const totalWidth = propTotalWidth || Math.max(totalDuration * pixelsPerSecond + 400, 1600);
  const numTicks = Math.ceil((totalWidth) / (tickInterval * pixelsPerSecond)) + 4;
 
  return (
    <div
      className="time-ruler"
      ref={rulerRef}
      onPointerDown={handlePointerDown}
      onContextMenu={handleContextMenu}
      style={{ width: `${totalWidth + HEADER_WIDTH}px` }}
    >
      {/* Export range bar & markers on ruler */}
      {exportRange && (
        <>
          <div
            className="ruler-export-range-bar"
            style={{
              left: `${HEADER_WIDTH + exportRange.in * pixelsPerSecond}px`,
              width: `${Math.max(2, (exportRange.out - exportRange.in) * pixelsPerSecond)}px`,
            }}
          />
          <div
            className="ruler-export-marker in-marker"
            style={{ left: `${HEADER_WIDTH + exportRange.in * pixelsPerSecond}px` }}
            title={`Export In: ${formatTimecode(exportRange.in)}`}
          >
            <div className="ruler-marker-flag">In</div>
          </div>
          <div
            className="ruler-export-marker out-marker"
            style={{ left: `${HEADER_WIDTH + exportRange.out * pixelsPerSecond}px` }}
            title={`Export Out: ${formatTimecode(exportRange.out)}`}
          >
            <div className="ruler-marker-flag">Out</div>
          </div>
        </>
      )}
 
      {/* Frame notes (ai-notes/notes.json): flag at the start, bar along the bottom for a range.
          Drag the flag to move a note; drag the handle on a range bar to resize it. */}
      {notes.map((rawNote) => {
        const note = drag && drag.id === rawNote.id ? { ...rawNote, time: drag.time, duration: drag.duration } : rawNote;
        const dragging = drag?.id === note.id;
        return (
          <div
            key={note.id}
            className={`ruler-note${note.done ? ' is-done' : ''}${activeNoteId === note.id ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}`}
            style={{ left: `${HEADER_WIDTH + note.time * pixelsPerSecond}px` }}
            title={`${formatNoteRange(note)}${note.text ? ` — ${note.text.slice(0, 80)}` : ''}${note.done ? ' (done)' : ''} — drag to move`}
            onPointerDown={(e) => startNoteDrag(e, rawNote, 'move')}
            onContextMenu={(e) => handleNoteContextMenu(e, rawNote)}
          >
            <div className="ruler-note-flag" />
            {note.duration > 0 && (
              <div className="ruler-note-bar" style={{ width: `${Math.max(3, note.duration * pixelsPerSecond)}px` }}>
                <div
                  className="ruler-note-handle"
                  title="Drag to change the length"
                  onPointerDown={(e) => startNoteDrag(e, rawNote, 'resize')}
                />
              </div>
            )}
          </div>
        );
      })}

      {menu && !menuNote && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu} className="clip-context-menu" minWidth={200}>
          <button className="ctx-menu-item ctx-menu-row" onClick={() => addHere(false)}>
            <span className="ctx-menu-label"><MessageSquarePlus size={12} /> Add Note Here</span>
            <span className="ctx-menu-hint">{formatTimecode(menu.time).slice(3)}</span>
          </button>
          <button className="ctx-menu-item ctx-menu-row" onClick={() => addHere(true)}>
            <span className="ctx-menu-label"><MessageSquarePlus size={12} /> Add Range Note Here</span>
            <span className="ctx-menu-hint">{DEFAULT_RANGE_SECONDS}s</span>
          </button>
          {exportRange && (
            <button className="ctx-menu-item ctx-menu-row" onClick={addForExportRange}>
              <span className="ctx-menu-label"><MessageSquarePlus size={12} /> Add Note for Export Range</span>
            </button>
          )}
        </ContextMenu>
      )}
      {menu && menuNote && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu} className="clip-context-menu" minWidth={190}>
          <button className="ctx-menu-item" onClick={() => { closeMenu(); openNoteInPanel(menuNote.id); }}>
            <MessageSquare size={12} /> Open in Notes
          </button>
          <button className="ctx-menu-item" onClick={() => { closeMenu(); seekToNote(menuNote); }}>
            <Crosshair size={12} /> Go to Note
          </button>
          <button className="ctx-menu-item" onClick={() => { closeMenu(); void setNoteDone(menuNote.id, !menuNote.done); }}>
            {menuNote.done ? <Undo2 size={12} /> : <Check size={12} />} {menuNote.done ? 'Mark as To Do' : 'Mark as Implemented'}
          </button>
          <div className="ctx-menu-divider" />
          <button
            className="ctx-menu-item"
            onClick={() => {
              closeMenu();
              if (window.confirm('Delete this note and its saved frames?')) void removeNote(menuNote.id);
            }}
          >
            <Trash2 size={12} /> Delete Note
          </button>
        </ContextMenu>
      )}

      {Array.from({ length: numTicks }).map((_, i) => {
        const timeSec = i * tickInterval;
        const leftPos = HEADER_WIDTH + timeSec * pixelsPerSecond;
        const isMajor = i % 2 === 0;
 
        return (
          <div
            key={i}
            className={`ruler-tick ${isMajor ? 'major' : 'minor'}`}
            style={{ left: `${leftPos}px` }}
          >
            <span className="tick-label">
              {formatTimecode(timeSec).slice(3)}
            </span>
            <div className="tick-line" />
          </div>
        );
      })}
    </div>
  );
});