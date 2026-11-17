import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Copy, Check, RefreshCw, Trash2, Camera, Pencil, Eye, EyeOff } from 'lucide-react';
import {
  useNotes,
  addNoteAtPlayhead,
  setNoteDone,
  updateNote,
  removeNote,
  recaptureNoteFrames,
  refreshNotes,
  seekToNote,
  setActiveNote,
  clearFocusNote,
} from '../../hooks/notesStore';
import { startDrawing, startEditingNote, useNoteDraw, toggleShowMarks } from '../../hooks/noteDrawStore';
import { readNoteFrameBytes } from '../../services/notesStorage';
import { sortNotes, countNotes, formatNoteRange, buildAgentPrompt } from '../../services/notesCore';
import { showNotice } from '../../utils/notice';
import './notes-panel.css';

/** Thumbnail of a saved frame. Read through the fs plugin (no asset-protocol scope needed). */
const NoteFrame = memo(function NoteFrame({ projectDir, relative, label, version }) {
  const [url, setUrl] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!relative) return undefined;
    let cancelled = false;
    let objectUrl = null;
    setUrl(null);
    (async () => {
      const bytes = await readNoteFrameBytes(projectDir, relative);
      if (cancelled || !bytes) return;
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectDir, relative, version]);

  if (!relative) return null;
  return (
    <figure className={`notes-frame${expanded ? ' is-expanded' : ''}`}>
      {url ? (
        <img src={url} alt={`${label} frame`} title="Click to enlarge" onClick={() => setExpanded((v) => !v)} />
      ) : (
        <div className="notes-frame-missing">frame not available</div>
      )}
      <figcaption>{label}</figcaption>
    </figure>
  );
});

const NoteCard = memo(function NoteCard({ note, projectDir, active, shouldFocus }) {
  const [draft, setDraft] = useState(note.text);
  const [start, setStart] = useState(String(note.time));
  const [length, setLength] = useState(String(note.duration));
  const draftRef = useRef(note.text);
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);
  const textRef = useRef(null);
  const cardRef = useRef(null);

  // Outside edits (an agent changed notes.json) show up unless the user is typing here.
  useEffect(() => {
    if (!dirtyRef.current) {
      setDraft(note.text);
      draftRef.current = note.text;
    }
  }, [note.text]);
  useEffect(() => setStart(String(note.time)), [note.time]);
  useEffect(() => setLength(String(note.duration)), [note.duration]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    void updateNote(note.id, { text: draftRef.current });
  }, [note.id]);
  useEffect(() => flush, [flush]);

  useEffect(() => {
    if (!shouldFocus) return;
    textRef.current?.focus();
    cardRef.current?.scrollIntoView?.({ block: 'nearest' });
    clearFocusNote();
  }, [shouldFocus]);

  useEffect(() => {
    if (active) cardRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const onTextChange = (e) => {
    const value = e.target.value;
    setDraft(value);
    draftRef.current = value;
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 800);
  };

  const commitNumber = (raw, key, reset) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n) || n < 0) {
      reset(String(note[key]));
      return;
    }
    if (n !== note[key]) void updateNote(note.id, { [key]: n });
  };
  const blurOnEnter = (e) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  const handleDelete = () => {
    if (window.confirm('Delete this note and its saved frames?')) void removeNote(note.id);
  };

  const classes = ['notes-card', note.done ? 'is-done' : '', active ? 'is-active' : ''].filter(Boolean).join(' ');
  const version = note.updatedAt;

  return (
    <div className={classes} ref={cardRef} onClick={() => setActiveNote(note.id)}>
      <div className="notes-card-head">
        <label className="notes-check" title="Tick when this note has been implemented">
          <input type="checkbox" checked={note.done} onChange={(e) => void setNoteDone(note.id, e.target.checked)} />
          <span>{note.done ? 'Implemented' : 'To do'}</span>
        </label>
        <button type="button" className="notes-time" title="Jump to this time" onClick={() => seekToNote(note)}>
          {formatNoteRange(note)}
        </button>
        <span className="notes-spacer" />
        <button
          type="button"
          className="notes-icon-btn"
          title={note.drawing ? 'Edit the marks drawn on the preview' : 'Draw marks on the preview for this note'}
          onClick={() => startEditingNote(note.id)}
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          className="notes-icon-btn"
          title="Re-capture the frame(s) at the current time"
          onClick={() => void recaptureNoteFrames(note.id)}
        >
          <Camera size={12} />
        </button>
        <button type="button" className="notes-icon-btn is-danger" title="Delete note" onClick={handleDelete}>
          <Trash2 size={12} />
        </button>
      </div>

      <textarea
        ref={textRef}
        className="notes-text"
        value={draft}
        rows={3}
        placeholder="What should change at this moment? (an AI agent reads this)"
        onChange={onTextChange}
        onBlur={flush}
      />

      <div className="notes-timing">
        <label>
          Start
          <input
            type="number"
            min="0"
            step="0.1"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            onBlur={() => commitNumber(start, 'time', setStart)}
            onKeyDown={blurOnEnter}
          />
          s
        </label>
        <label title="0 = a single frame; above 0 = a range that starts at Start">
          Length
          <input
            type="number"
            min="0"
            step="0.1"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            onBlur={() => commitNumber(length, 'duration', setLength)}
            onKeyDown={blurOnEnter}
          />
          s
        </label>
        {note.drawing && (
          <span className="notes-marks" title="Marks drawn on the preview. They are annotations and are never rendered into the video.">
            {note.drawing.shapes.length} mark{note.drawing.shapes.length === 1 ? '' : 's'} ·{' '}
            <button type="button" className="notes-link-btn" onClick={() => void updateNote(note.id, { drawing: null })}>
              remove
            </button>
          </span>
        )}
      </div>

      {(note.frames?.start || note.frames?.end || note.frames?.marked) && (
        <div className="notes-frames">
          <NoteFrame projectDir={projectDir} relative={note.frames.marked} label="marked" version={version} />
          <NoteFrame projectDir={projectDir} relative={note.frames.start} label="start" version={version} />
          <NoteFrame projectDir={projectDir} relative={note.frames.end} label="end" version={version} />
        </div>
      )}

      {note.agentReply && (
        <div className="notes-reply">
          <strong>AI</strong> {note.agentReply}
        </div>
      )}
    </div>
  );
});

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'To do' },
  { id: 'done', label: 'Done' },
];

export const NotesDockPanel = memo(function NotesDockPanel() {
  const { notes, supported, loaded, error, warnings, busy, projectDir, activeNoteId, focusNoteId } = useNotes();
  const [filter, setFilter] = useState('all');
  const [copied, setCopied] = useState(false);
  const { showMarks } = useNoteDraw();

  const counts = useMemo(() => countNotes(notes), [notes]);
  const visible = useMemo(
    () =>
      sortNotes(notes).filter((n) => (filter === 'all' ? true : filter === 'open' ? !n.done : n.done)),
    [notes, filter]
  );

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildAgentPrompt());
      setCopied(true);
    } catch {
      showNotice('Could not copy to the clipboard.');
    }
  };

  if (!projectDir) {
    return <div className="notes-panel notes-empty">Open a project to use notes.</div>;
  }
  if (!supported) {
    return (
      <div className="notes-panel notes-empty">
        Notes are saved as files in your project folder (ai-notes/), so they need the BlahBlah desktop app.
      </div>
    );
  }

  return (
    <div className="notes-panel">
      <div className="notes-toolbar">
        <span className="notes-title">Notes</span>
        <span className="notes-badge" title="Notes still to do / all notes">
          {counts.open} to do · {counts.total} total
        </span>
        {busy > 0 && <span className="notes-busy">Capturing frame…</span>}
        <span className="notes-spacer" />
        <button
          type="button"
          className="notes-btn"
          title="Pin a note and a screenshot to the current frame (default key: M)"
          onClick={() => void addNoteAtPlayhead({ range: false })}
        >
          <Plus size={12} /> Note
        </button>
        <button
          type="button"
          className="notes-btn"
          title="Pin a note to a time range: the Export In/Out range if set, else 3 seconds (default key: Shift+M)"
          onClick={() => void addNoteAtPlayhead({ range: true })}
        >
          <Plus size={12} /> Range
        </button>
        <button
          type="button"
          className="notes-btn"
          title="Draw on the preview to mark the part you want changed, then save it as a note (default key: B)"
          onClick={() => startDrawing()}
        >
          <Pencil size={12} /> Draw
        </button>
        <button
          type="button"
          className="notes-icon-btn"
          title={showMarks ? 'Marks are shown on the preview. Click to hide them.' : 'Marks are hidden on the preview. Click to show them.'}
          aria-pressed={!showMarks}
          onClick={toggleShowMarks}
        >
          {showMarks ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <button
          type="button"
          className="notes-btn"
          title="Copy a prompt to paste into your AI agent (Antigravity, Freebuff, Claude Code, ...)"
          onClick={copyPrompt}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'AI prompt'}
        </button>
        <button type="button" className="notes-icon-btn" title="Reload notes from disk" onClick={() => void refreshNotes()}>
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="notes-filters" role="tablist" aria-label="Filter notes">
        {FILTERS.map((f) => {
          const count = f.id === 'all' ? counts.total : f.id === 'open' ? counts.open : counts.done;
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`notes-filter${filter === f.id ? ' is-on' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label} <span>{count}</span>
            </button>
          );
        })}
      </div>

      {error && <div className="notes-banner is-error">{error}</div>}
      {!error && warnings.length > 0 && (
        <div className="notes-banner" title={warnings.join('\n')}>
          notes.json had {warnings.length} issue{warnings.length === 1 ? '' : 's'}; hover for details.
        </div>
      )}

      <div className="notes-list">
        {loaded && visible.length === 0 && (
          <div className="notes-empty">
            {counts.total === 0
              ? 'No notes yet. Move the playhead and press M (or click + Note) to pin a note and a screenshot to that frame, or click Draw to mark the part you want changed.'
              : 'Nothing in this filter.'}
          </div>
        )}
        {visible.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            projectDir={projectDir}
            active={activeNoteId === note.id}
            shouldFocus={focusNoteId === note.id}
          />
        ))}
      </div>

      <div className="notes-footer">Agents read ai-notes/NOTES.md and tick notes off in ai-notes/notes.json.</div>
    </div>
  );
});