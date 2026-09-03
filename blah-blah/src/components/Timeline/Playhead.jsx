import { useRef, useEffect, memo } from 'react';
import { usePlaybackStore } from '../../hooks/PlaybackContext';

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
  pixelsPerSecondRef.current = pixelsPerSecond;
  const dragStartRef = useRef({ x: 0, time: 0 });

  const handlePointerDown = (e) => {
    e.stopPropagation();
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, time: store.getCurrentTime() };

    const handlePointerMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const { x, time } = dragStartRef.current;
      const deltaPx = moveEvent.clientX - x;
      const newTime = Math.max(0, time + deltaPx / pixelsPerSecondRef.current);
      onSeek(newTime);
      onDragPosition(newTime);
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
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

  const setPosition = (time) => {
    if (!handleRef.current) return;
    handleRef.current.style.transform = `translateX(${HEADER_WIDTH + time * pixelsPerSecond}px)`;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, pixelsPerSecond]);

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

  const setPosition = (time) => {
    if (!lineRef.current) return;
    lineRef.current.style.transform = `translateX(${HEADER_WIDTH + time * pixelsPerSecond}px)`;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, pixelsPerSecond]);

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
