import { useRef, useEffect, memo } from 'react';
import { usePlaybackStore } from '../../hooks/PlaybackContext';
import { applyEdgeAutoScroll, getTimelineElements } from '../../utils/timelineAutoScroll';
import './playhead.css';

// Track header column width — clips/lanes start after this, so anything
// positioned from the lanes-surface's own left edge needs the same offset
// to line up with them.
const HEADER_WIDTH = 180;

/**
 * Shared drag-to-scrub logic. Both the ruler handle and the lane line use
 * this so dragging either one scrubs the playhead identically.
 */
function usePlayheadDrag({ pixelsPerSecond, onSeek, onDragPosition, isDraggingRef }) {
  const store = usePlaybackStore();
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  useEffect(() => {
    pixelsPerSecondRef.current = pixelsPerSecond;
  }, [pixelsPerSecond]);
  const dragStartRef = useRef({ x: 0, time: 0 });

  const handlePointerDown = (e) => {
    e.stopPropagation();
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, time: store.getCurrentTime() };

    const handlePointerMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const { x, time } = dragStartRef.current;

      // Auto-scroll when scrubbing near the edge. The shared helper also
      // mirrors the position onto the ruler's scroll container, so dragging
      // the playhead handle near an edge no longer desyncs the ticks.
      {
        const { lanesEl, rulerEl } = getTimelineElements();
        applyEdgeAutoScroll(moveEvent.clientX, {
          lanesEl,
          rulerEl,
          headerWidth: HEADER_WIDTH,
          edgeMargin: 50,
          scrollSpeed: 12,
        });
      }

      const deltaPx = moveEvent.clientX - x;
      const newTime = Math.max(0, time + deltaPx / pixelsPerSecondRef.current);
      onSeek(newTime);
      onDragPosition(newTime);
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  return handlePointerDown;
}

/**
 * The grab handle, rendered inside the ruler (not the scrolling lane
 * content). The ruler's own scrollLeft is kept in sync with the lanes by
 * the parent, so this handle's horizontal position is correct for free —
 * no CSS `sticky` + `transform` interaction to fight with, and it never
 * scrolls out of view vertically since the ruler doesn't scroll on Y.
 */
export const PlayheadHandle = memo(function PlayheadHandle({ pixelsPerSecond, onSeek }) {
  const store = usePlaybackStore();
  const handleRef = useRef(null);
  const isDraggingRef = useRef(false);
  // Latest pixelsPerSecond, read fresh by the frame callback below instead
  // of the callback being torn down and rebuilt on every pixelsPerSecond
  // change (see the effect's old deps array). During a zoom gesture
  // pixelsPerSecond changes on almost every animation frame, so
  // resubscribing the frame callback that often meant there could be a
  // frame where this component's position briefly used a stale
  // pixelsPerSecond (from before unsubscribe) while the canvas/ruler,
  // which redraw synchronously off React state, had already moved to the
  // new zoom level — the playhead visibly stepping out of sync with
  // everything else during zoom (reported: "seekbar itself glitching,
  // clips/ruler don't"). Reading a ref means the SAME frame callback keeps
  // running across the whole gesture and just uses whatever pps is
  // current on each frame, no resubscribe, no gap.
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  useEffect(() => {
    pixelsPerSecondRef.current = pixelsPerSecond;
  }, [pixelsPerSecond]);

  const setPosition = (time) => {
    if (!handleRef.current) return;
    handleRef.current.style.transform = `translateX(${HEADER_WIDTH + time * pixelsPerSecondRef.current}px)`;
  };

  const onPointerDown = usePlayheadDrag({
    pixelsPerSecond,
    onSeek,
    onDragPosition: setPosition,
    isDraggingRef,
  });

  useEffect(() => {
    const updatePosition = (time) => {
      if (isDraggingRef.current) return;
      setPosition(time);
    };
    updatePosition(store.getCurrentTime());
    return store.registerFrameCallback(updatePosition);
    // Deliberately NOT keyed on pixelsPerSecond anymore — see
    // pixelsPerSecondRef above. Re-subscribing on every zoom tick was the
    // bug; the callback itself already reads the live ref, so it never
    // needs to be rebuilt for a pps change, only if the store instance
    // itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Also correct the position immediately (no need to wait for the next
  // frame callback tick) whenever pixelsPerSecond changes while not
  // dragging — this is what actually keeps it visually glued to the
  // clips/ruler during a fast zoom burst instead of trailing them by up to
  // one rAF.
  useEffect(() => {
    if (isDraggingRef.current) return;
    setPosition(store.getCurrentTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelsPerSecond]);

  return (
    <div
      ref={handleRef}
      className="playhead-handle"
      title="Drag to scrub playhead"
      style={{
        transform: `translateX(${HEADER_WIDTH + store.getCurrentTime() * pixelsPerSecond}px)`,
      }}
      onPointerDown={onPointerDown}
    >
      <div className="playhead-triangle" />
    </div>
  );
});

/**
 * The vertical red line, rendered inside the scrolling lane content so it
 * naturally scrolls with the tracks/clips — same coordinate space as
 * everything else in `.lanes-surface`, no special-casing needed.
 */
export const PlayheadLine = memo(function PlayheadLine({ pixelsPerSecond, onSeek, timelineHeight = 300 }) {
  const store = usePlaybackStore();
  const lineRef = useRef(null);
  const isDraggingRef = useRef(false);
  // See PlayheadHandle above for why this ref exists: avoids resubscribing
  // the frame callback on every pixelsPerSecond change during a zoom
  // gesture, which caused this line to visibly lag/glitch relative to the
  // canvas/ruler for one frame per tick.
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  useEffect(() => {
    pixelsPerSecondRef.current = pixelsPerSecond;
  }, [pixelsPerSecond]);

  const setPosition = (time) => {
    if (!lineRef.current) return;
    lineRef.current.style.transform = `translateX(${HEADER_WIDTH + time * pixelsPerSecondRef.current}px)`;
  };

  const onPointerDown = usePlayheadDrag({
    pixelsPerSecond,
    onSeek,
    onDragPosition: setPosition,
    isDraggingRef,
  });

  useEffect(() => {
    const updatePosition = (time) => {
      if (isDraggingRef.current) return;
      setPosition(time);
    };
    updatePosition(store.getCurrentTime());
    return store.registerFrameCallback(updatePosition);
    // Deliberately NOT keyed on pixelsPerSecond — see pixelsPerSecondRef
    // above and the matching comment in PlayheadHandle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Snap to the correct position immediately on zoom, same as
  // PlayheadHandle, instead of waiting for the next frame-callback tick.
  useEffect(() => {
    if (isDraggingRef.current) return;
    setPosition(store.getCurrentTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelsPerSecond]);

  return (
    <div
      ref={lineRef}
      className="timeline-playhead"
      style={{
        transform: `translateX(${HEADER_WIDTH + store.getCurrentTime() * pixelsPerSecond}px)`,
        height: `${timelineHeight}px`,
        willChange: 'transform',
      }}
      onPointerDown={onPointerDown}
    >
      <div className="playhead-line" />
    </div>
  );
});