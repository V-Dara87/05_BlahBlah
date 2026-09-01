import { useRef, useEffect, memo } from 'react';
import { usePlaybackStore } from '../../hooks/PlaybackContext';

export const Playhead = memo(function Playhead({
  pixelsPerSecond,
  onSeek,
  timelineHeight = 300,
}) {
  const store = usePlaybackStore();
  const playheadRef = useRef(null);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  pixelsPerSecondRef.current = pixelsPerSecond;

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, time: 0 });

  // Imperative position updates — runs in the same rAF tick as the playback
  // clock, without waiting for React to re-render the whole timeline tree.
  useEffect(() => {
    const updatePosition = (time) => {
      if (!playheadRef.current || isDraggingRef.current) return;
      playheadRef.current.style.transform = `translateX(${time * pixelsPerSecondRef.current}px)`;
    };

    updatePosition(store.getCurrentTime());
    return store.registerFrameCallback(updatePosition);
  }, [store]);

  useEffect(() => {
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${store.getCurrentTime() * pixelsPerSecond}px)`;
    }
  }, [pixelsPerSecond, store]);

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
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${newTime * pixelsPerSecondRef.current}px)`;
      }
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <div
      ref={playheadRef}
      className="timeline-playhead"
      style={{
        transform: `translateX(${store.getCurrentTime() * pixelsPerSecond}px)`,
        height: `${timelineHeight}px`,
        willChange: 'transform',
      }}
      onPointerDown={handlePointerDown}
    >
      <div className="playhead-handle" title="Drag to scrub playhead">
        <div className="playhead-triangle" />
      </div>
      <div className="playhead-line" />
    </div>
  );
});
