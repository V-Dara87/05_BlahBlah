import { useRef } from 'react';

export function Playhead({
  currentTime,
  pixelsPerSecond,
  onSeek,
  timelineHeight = 300,
}) {
  const isDraggingRef = useRef(false);

  const leftPosition = currentTime * pixelsPerSecond;

  const handlePointerDown = (e) => {
    e.stopPropagation();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startTime = currentTime;

    const handlePointerMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const deltaPx = moveEvent.clientX - startX;
      const newTime = Math.max(0, startTime + deltaPx / pixelsPerSecond);
      onSeek(newTime);
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
      className="timeline-playhead"
      style={{
        transform: `translateX(${leftPosition}px)`,
        height: `${timelineHeight}px`,
      }}
      onPointerDown={handlePointerDown}
    >
      <div className="playhead-handle" title="Drag to scrub playhead">
        <div className="playhead-triangle" />
      </div>
      <div className="playhead-line" />
    </div>
  );
}
