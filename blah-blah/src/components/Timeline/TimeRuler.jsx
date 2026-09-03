import { useRef } from 'react';
import { formatTimecode } from '../../utils/timeFormat';

export function TimeRuler({
  totalDuration,
  pixelsPerSecond,
  onSeek,
}) {
  const rulerRef = useRef(null);
  // Reserve the same width as the track-header column so ticks land
  // directly above the clip positions they correspond to.
  const HEADER_WIDTH = 180;

  const handlePointerDown = (e) => {
    if (!rulerRef.current) return;
    // Account for scroll offset of the lanes-wrapper
    const lanesWrapper = document.querySelector('.lanes-wrapper');
    const scrollLeft = lanesWrapper?.scrollLeft || 0;
    const rect = rulerRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left + scrollLeft - HEADER_WIDTH;
    const newTime = Math.max(0, offsetX / pixelsPerSecond);
    onSeek(newTime);

    const handlePointerMove = (moveEvent) => {
      const moveOffsetX = moveEvent.clientX - rect.left + scrollLeft - HEADER_WIDTH;
      const scrubTime = Math.max(0, moveOffsetX / pixelsPerSecond);
      onSeek(scrubTime);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // Determine tick interval based on zoom level
  let tickInterval = 5; // seconds
  if (pixelsPerSecond >= 80) tickInterval = 1;
  else if (pixelsPerSecond >= 40) tickInterval = 2;
  else if (pixelsPerSecond >= 20) tickInterval = 5;
  else tickInterval = 10;

  const numTicks = Math.ceil(totalDuration / tickInterval) + 2;
  const totalWidth = Math.max(totalDuration * pixelsPerSecond + 200, 1200);

  return (
    <div
      className="time-ruler"
      ref={rulerRef}
      onPointerDown={handlePointerDown}
      style={{ width: `${totalWidth + HEADER_WIDTH}px` }}
    >
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
}
