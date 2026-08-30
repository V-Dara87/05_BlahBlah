import { useState, useRef, useCallback } from 'react';
 
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
 * `reset` replaces the present value AND clears past/future — use this for
 * "load a different project" style operations that shouldn't be undoable
 * back into the previous project.
 */
export function useUndoableState(initialState) {
  const [history, setHistory] = useState({
    past: [],
    present: initialState,
    future: [],
  });
  const lastCommitRef = useRef(0);
 
  const set = useCallback((updater, options) => {
    const coalesce = !!(options && options.coalesce);
 
    setHistory((prev) => {
      const nextPresent = typeof updater === 'function' ? updater(prev.present) : updater;
      if (nextPresent === prev.present) return prev;
 
      const now = Date.now();
      const shouldCoalesce = coalesce && prev.past.length > 0 && (now - lastCommitRef.current) < COALESCE_MS;
      lastCommitRef.current = now;
 
      const past = shouldCoalesce
        ? prev.past
        : [...prev.past, prev.present].slice(-HISTORY_LIMIT);
 
      return {
        past,
        present: nextPresent,
        future: [],
      };
    });
  }, []);
 
  const undo = useCallback(() => {
    lastCommitRef.current = 0;
    setHistory((prev) => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      return {
        past: prev.past.slice(0, -1),
        present: previous,
        future: [prev.present, ...prev.future].slice(0, HISTORY_LIMIT),
      };
    });
  }, []);
 
  const redo = useCallback(() => {
    lastCommitRef.current = 0;
    setHistory((prev) => {
      if (prev.future.length === 0) return prev;
      const [next, ...rest] = prev.future;
      return {
        past: [...prev.past, prev.present].slice(-HISTORY_LIMIT),
        present: next,
        future: rest,
      };
    });
  }, []);
 
  const reset = useCallback((newState) => {
    lastCommitRef.current = 0;
    setHistory({ past: [], present: newState, future: [] });
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
 