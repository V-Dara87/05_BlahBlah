import { useState, useCallback } from 'react';

const HISTORY_LIMIT = 100;
// Rapid-fire updates that land within this window of the previous one
// (drag-move, drag-resize, DragNumber scrubbing, etc.) are coalesced into
// a single undo step instead of one step per intermediate value.
const COALESCE_MS = 400;

/**
 * Generic snapshot-stack undo/redo for a single state value.
 *
 * `present` mirrors what useState would give you; `set` mirrors setState
 * (accepts either a value or an updater function) but also accepts a
 * second `{ coalesce }` argument so call sites that fire many times in a
 * row for one logical gesture (dragging a clip, scrubbing a number field)
 * can be merged into one history entry.
 *
 * `coalesce` may be `true` or a string key. Two updates are only merged when
 * they carry the SAME key (and land within COALESCE_MS), so two unrelated
 * edits made back to back stay two separate undo steps. Call sites should
 * pass a key that identifies the target of the gesture (e.g. `entity:<id>`);
 * plain `true` is treated as one shared key for backwards compatibility.
 *
 * The updater passed to setHistory is PURE: the timestamp and key are read
 * outside of it and the "last commit" bookkeeping lives inside the history
 * state itself, so React StrictMode's double-invoked updaters give the same
 * result both times.
 *
 * `reset` replaces the present value AND clears past/future — use this for
 * "load a different project" style operations that shouldn't be undoable
 * back into the previous project.
 */
export function useUndoableState(initialState) {
  const [history, setHistory] = useState({
    past: [],
    present: initialState,
    future: [],
    // { at: ms timestamp of the last commit, key: coalesce key or null }
    stamp: { at: 0, key: null },
  });

  const set = useCallback((updater, options) => {
    const coalesce = options && options.coalesce;
    const key = coalesce ? (coalesce === true ? '__default__' : String(coalesce)) : null;
    const now = Date.now();

    setHistory((prev) => {
      const nextPresent = typeof updater === 'function' ? updater(prev.present) : updater;
      if (nextPresent === prev.present) return prev;

      const shouldCoalesce = key !== null
        && prev.past.length > 0
        && prev.stamp.key === key
        && (now - prev.stamp.at) < COALESCE_MS;

      const past = shouldCoalesce
        ? prev.past
        : [...prev.past, prev.present].slice(-HISTORY_LIMIT);

      return {
        past,
        present: nextPresent,
        future: [],
        stamp: { at: now, key },
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      return {
        past: prev.past.slice(0, -1),
        present: previous,
        future: [prev.present, ...prev.future].slice(0, HISTORY_LIMIT),
        stamp: { at: 0, key: null },
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((prev) => {
      if (prev.future.length === 0) return prev;
      const [next, ...rest] = prev.future;
      return {
        past: [...prev.past, prev.present].slice(-HISTORY_LIMIT),
        present: next,
        future: rest,
        stamp: { at: 0, key: null },
      };
    });
  }, []);

  const reset = useCallback((newState) => {
    setHistory({ past: [], present: newState, future: [], stamp: { at: 0, key: null } });
  }, []);

  return {
    present: history.present,
    set,
    undo,
    redo,
    reset,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}