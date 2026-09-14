import { DragNumber } from '../DragNumber';
import { Upload, Download } from 'lucide-react';
import { ArrayFieldEditor } from '../ArrayFieldEditor';
import {
  createPhrase,
  addPhrase,
  updatePhrase,
  removePhrase,
  reorderPhrases,
  recalculateSequentialPhrases,
} from '../../engine/subtitleTrack';
import { parseSrt, toSrt } from '../../engine/srt';
 
/**
 * SubtitleTrackInspector — body of the Inspector's Subtitle Track card.
 *
 * The phrase list (drag-to-reorder, add/remove, per-phrase timing and text,
 * SRT import/export) is the generic ArrayFieldEditor; this file only supplies
 * SubtitleTrack's own item schema, its two track-level mode switches, and the
 * engine mutations. The card header, foldout and remove button stay in
 * UnityInspector.jsx along with every other component's.
 *
 * Two independent notions of "mode" live here, both defined in
 * engine/subtitleTrack.js:
 *  - track-level `timingMode` ('duration' | 'range') decides whether a phrase
 *    is authored as "how long it lasts" (chained sequentially, times derived)
 *    or as an explicit in/out range.
 *  - track-level `displayMode` ('set' | 'add') and the per-phrase `mode`
 *    toggle decide whether a phrase replaces the on-screen text or accumulates
 *    onto the previous sentence. The tracker reads both in getPhraseContextAt.
 *
 * Presentation is deliberately absent here: this edits the phrase data, it
 * does not draw it — drawing is a CanvasRenderer script's job, reading this
 * via EntityRef.getPhraseAt/getCurrentText. See engine/subtitleTrack.js for
 * why that split exists.
 *
 * Row layout note: the per-phrase SET/ADD mode pill is rendered by
 * `renderActions` below and is unconditional — it appears for every phrase
 * row in BOTH timing modes, since ArrayFieldEditor always calls
 * renderItem() then renderActions() in the same flex row (see
 * ArrayFieldEditor.jsx). In 'duration' timing mode the row previously broke
 * this: the read-only "start → end" span next to the `dur` field had no
 * flex-shrink/min-width constraint, so on a narrow Inspector panel it (and
 * the dur field) could consume the entire row width and push the SET/ADD
 * pill past the visible edge before it ever got clipped by marginLeft:auto.
 * The pill was always there in the DOM and the data/logic were always
 * per-phrase — it was purely getting squeezed off-screen. Both the dur
 * field and the time-window span are now allowed to shrink (flex: '0 1 ...'
 * + minWidth constraints, with text-overflow ellipsis on the span) so the
 * row degrades gracefully instead of overflowing, and the mode pill always
 * stays visible next to the delete button, matching 'range' mode.
 */
export function SubtitleTrackInspector({ component, onUpdateEntity, selectedEntity, currentTime }) {
  const phrases = component.phrases || [];
  const isDurationMode = (component.timingMode || 'duration') === 'duration';
 
  // Every mutation below returns a whole new SubtitleTrack component (the
  // engine helpers re-sort / re-derive sequential timings on write), so
  // committing is the same one shape no matter which control fired.
  //
  // The callbacks handed to ArrayFieldEditor close over `component` from this
  // render. That stays correct because the editor re-renders whenever this
  // one does (its callbacks are rebuilt each time, so memo can't skip the
  // update), and UnityInspector re-renders on every entity change — so each
  // commit is applied to the phrase list as it exists *now*.
  const commitComponent = (updatedComponent) => {
    onUpdateEntity(selectedEntity.id, {
      components: selectedEntity.components.map((c) =>
        c.type === 'SubtitleTrack' ? updatedComponent : c
      ),
    });
  };
 
  return (
    <>
      {/* ── Track-level modes ─────────────────────────────────────────── */}
      <div className="inspector-row" style={{ gap: 8, paddingBottom: 6, borderBottom: '1px solid var(--unity-border)' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--unity-text-dim)', textTransform: 'uppercase' }}>Timing</span>
          <select
            className="inspector-select"
            style={{ fontSize: 11, padding: '3px 6px' }}
            value={component.timingMode || 'duration'}
            onChange={(e) => {
              const newTimingMode = e.target.value;
              // Switching back to duration re-chains the existing phrases from
              // the first one's start, so the list is immediately consistent
              // instead of showing stale hand-entered in/out values.
              const nextPhrases = newTimingMode === 'duration'
                ? recalculateSequentialPhrases(phrases, phrases[0]?.startTime || 0)
                : phrases;
              commitComponent({ ...component, timingMode: newTimingMode, phrases: nextPhrases });
            }}
          >
            <option value="duration">Duration (Sequential)</option>
            <option value="range">Range (In / Out)</option>
          </select>
        </div>
 
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--unity-text-dim)', textTransform: 'uppercase' }}>Mode</span>
          <select
            className="inspector-select"
            style={{ fontSize: 11, padding: '3px 6px' }}
            value={component.displayMode || 'set'}
            onChange={(e) => {
              commitComponent({ ...component, displayMode: e.target.value });
            }}
          >
            <option value="set">Set (Replace Phrase)</option>
            <option value="add">Add (Accumulate Phrases)</option>
          </select>
        </div>
      </div>
 
      <ArrayFieldEditor
        items={phrases}
        itemIdKey="id"
        itemClassName="subtitle-phrase-row"
        onItemUpdate={commitComponent}
        onItemChange={(phraseId, patch) => updatePhrase(component, phraseId, patch)}
        onItemAdd={(newPhrase) => addPhrase(component, newPhrase)}
        onItemRemove={(phraseId) => removePhrase(component, phraseId)}
        onItemReorder={(draggedId, targetId) => reorderPhrases(component, draggedId, targetId)}
        createNewItem={() => {
          const defaultDuration = 2;
          if (isDurationMode) {
            // Chained after the last phrase; addPhrase re-derives the times and
            // records the duration, so it only needs to be seeded here.
            const startTime = phrases.length > 0 ? phrases[phrases.length - 1].endTime : 0;
            return createPhrase({ startTime, endTime: startTime + defaultDuration, text: '' });
          }
          // Range mode: drop it at the playhead (as a clip-local time) when the
          // list is empty, otherwise after the last phrase.
          const lastEnd = phrases.length > 0
            ? phrases[phrases.length - 1].endTime
            : Math.max(0, currentTime - selectedEntity.startTime);
          return createPhrase({ startTime: lastEnd, endTime: lastEnd + defaultDuration, text: '' });
        }}
        emptyMessage="No phrases yet. Import an SRT file, or add one below and adjust its timing by hand."
        addButtonText="Add Phrase"
        renderItem={(phrase, index, onUpdate) => {
          const startTime = phrase.startTime ?? 0;
          const endTime = phrase.endTime ?? 0;
          if (isDurationMode) {
            // Duration mode derives start/end from the chain, so the editable
            // field is the length and the window is shown read-only beside it.
            // Both pieces are allowed to SHRINK (flex: '0 1 ...' + minWidth,
            // ellipsis on the span) so a narrow Inspector panel degrades
            // gracefully instead of pushing the SET/ADD pill (renderActions,
            // rendered right after this) off the visible edge of the row.
            const phraseDur = Number.isFinite(phrase.duration)
              ? phrase.duration
              : Math.max(0.1, endTime - startTime);
            return (
              <>
                <div style={{ flex: '0 1 80px', minWidth: '56px' }} title="Duration this phrase shows in seconds">
                  <DragNumber
                    label="dur"
                    value={parseFloat(phraseDur.toFixed(2))}
                    step={0.05}
                    min={0.1}
                    max={600}
                    onChange={(v) => onUpdate({ duration: v })}
                  />
                </div>
                <span
                  style={{
                    flex: '0 1 auto',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontSize: 10,
                    color: 'var(--unity-text-dim)',
                    fontFamily: 'var(--font-mono, monospace)',
                    padding: '2px 4px',
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: 3,
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                  title={`Calculated playback time window: ${startTime.toFixed(2)}s → ${endTime.toFixed(2)}s`}
                >
                  {startTime.toFixed(2)}s → {endTime.toFixed(2)}s
                </span>
              </>
            );
          }
          return (
            <>
              <DragNumber
                label="in"
                value={parseFloat(startTime.toFixed(2))}
                step={0.05}
                min={0}
                onChange={(v) => onUpdate({ startTime: v })}
              />
              <DragNumber
                label="out"
                value={parseFloat(endTime.toFixed(2))}
                step={0.05}
                min={0}
                onChange={(v) => onUpdate({ endTime: v })}
              />
            </>
          );
        }}
        renderActions={(phrase, index, onUpdate) => (
          <button
            title={phrase.mode === 'add' ? 'Mode: ADD (accumulate with previous phrases)' : 'Mode: SET (replace / start new sentence)'}
            style={{
              flexShrink: 0,
              marginLeft: 'auto',
              padding: '1px 5px',
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '0.04em',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              background: phrase.mode === 'add' ? '#0e7490' : '#7c3aed',
              color: '#fff',
              lineHeight: '16px',
            }}
            onClick={() => {
              const nextMode = phrase.mode === 'add' ? 'set' : 'add';
              onUpdate({ mode: nextMode });
            }}
          >
            {phrase.mode === 'add' ? '+ADD' : 'SET'}
          </button>
        )}
        renderBody={(phrase, index, onUpdate) => (
          <textarea
            className="inspector-textarea"
            rows={1}
            value={phrase.text ?? ''}
            placeholder="Phrase text"
            onChange={(e) => onUpdate({ text: e.target.value })}
          />
        )}
        renderToolbar={() => (
          <div className="inspector-row">
            <label className="unity-btn unity-btn-secondary btn-xs" style={{ cursor: 'pointer' }}>
              <Upload size={11} />
              <span>Import SRT</span>
              <input
                type="file"
                accept=".srt"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const imported = parseSrt(String(reader.result || ''));
                    if (imported.length === 0) return;
                    // Rebuild from an empty list so each imported phrase keeps
                    // the timing the file gave it, instead of being appended to
                    // (and re-sequenced after) whatever was authored by hand.
                    const merged = imported.reduce(
                      (comp, phrase) => addPhrase(comp, phrase),
                      { ...component, phrases: [] }
                    );
                    commitComponent(merged);
                  };
                  reader.readAsText(file);
                }}
              />
            </label>
            <button
              className="unity-btn unity-btn-secondary btn-xs"
              disabled={phrases.length === 0}
              onClick={() => {
                const srtText = toSrt(phrases);
                const blob = new Blob([srtText], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${selectedEntity.name || 'subtitles'}.srt`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download size={11} />
              <span>Export SRT</span>
            </button>
          </div>
        )}
      />
    </>
  );
}