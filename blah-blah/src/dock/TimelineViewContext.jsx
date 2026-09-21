import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DEFAULT_PIXELS_PER_SECOND } from '../types';

/**
 * TimelineViewContext — the HOT timeline view state, split out of
 * EditorContext on purpose.
 *
 * pixelsPerSecond changes on every wheel-zoom frame. It used to live in
 * App's state, and App's <EditorContext.Provider value={{ ... }}> is a fresh
 * object literal on every render — so each zoom tick re-created the value
 * and re-rendered EVERY useEditorContext() consumer (Inspector, Project,
 * Preview, Dopesheet, ...), which is what made zoom feel laggy.
 *
 * Keeping the zoom state in this small provider means App does not re-render
 * on zoom at all, so the big EditorContext value keeps its identity and only
 * the components that actually read zoom state (the timeline itself and the
 * header's zoom readout) re-render.
 *
 * Keep this context small: anything added here re-renders its consumers on
 * every change, so only genuinely hot, timeline-scoped state belongs.
 */

export const MIN_PIXELS_PER_SECOND = 4;
export const MAX_PIXELS_PER_SECOND = 240;
/** Step used by the toolbar zoom buttons and the keyboard zoom shortcuts. */
export const ZOOM_STEP = 15;

const TimelineViewContext = createContext(null);

export function TimelineViewProvider({ children }) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);

  const zoomIn = useCallback(() => {
    setPixelsPerSecond((prev) => Math.min(prev + ZOOM_STEP, MAX_PIXELS_PER_SECOND));
  }, []);

  const zoomOut = useCallback(() => {
    setPixelsPerSecond((prev) => Math.max(prev - ZOOM_STEP, MIN_PIXELS_PER_SECOND));
  }, []);

  const value = useMemo(
    () => ({ pixelsPerSecond, setPixelsPerSecond, zoomIn, zoomOut }),
    [pixelsPerSecond, zoomIn, zoomOut]
  );

  return (
    <TimelineViewContext.Provider value={value}>
      {children}
    </TimelineViewContext.Provider>
  );
}

export function useTimelineView() {
  const ctx = useContext(TimelineViewContext);
  if (!ctx) {
    throw new Error('useTimelineView must be used inside <TimelineViewProvider>');
  }
  return ctx;
}
