import { useRef, memo } from 'react';
import { formatTimecode } from '../../utils/timeFormat';
import { getTickIntervalSeconds } from '../../utils/timelineLayout';
import { applyEdgeAutoScroll } from '../../utils/timelineAutoScroll';
import './time-ruler.css';
 
export const TimeRuler = memo(function TimeRuler({
  totalDuration,
  pixelsPerSecond,
  totalWidth: propTotalWidth,
  onSeek,
  exportRange,
  snappingPoints = [],
  snappingEnabled = false,
}) {
  const rulerRef = useRef(null);
  const HEADER_WIDTH = 180;
 
  const getSnappedTime = (rawTime) => {
    if (!snappingEnabled || !snappingPoints || snappingPoints.length === 0) return rawTime;
    const snapThresholdSec = 8 / pixelsPerSecond;
    for (const point of snappingPoints) {
      if (Math.abs(rawTime - point) < snapThresholdSec) {
        return point;
      }
    }
    return rawTime;
  };
 
  const handlePointerDown = (e) => {
    if (!rulerRef.current) return;
    if (e.button !== 0) return;
    e.preventDefault();
 
    const rect = rulerRef.current.getBoundingClientRect();
    // rect.left already accounts for horizontal scroll inside ruler-wrapper
    const offsetX = e.clientX - rect.left - HEADER_WIDTH;
    const rawTime = Math.max(0, offsetX / pixelsPerSecond);
    const snappedTime = getSnappedTime(rawTime);
    onSeek(snappedTime);
 
    const handlePointerMove = (moveEvent) => {
      if (!rulerRef.current) return;
      // Auto-scroll when scrubbing near edges. The shared helper also mirrors
      // the position onto our own `.ruler-wrapper` so the ticks move with the
      // lanes (this component previously scrolled only the lanes).
      applyEdgeAutoScroll(moveEvent.clientX, {
        lanesEl: document.querySelector('.lanes-wrapper'),
        rulerEl: rulerRef.current?.closest('.ruler-wrapper') || null,
        headerWidth: HEADER_WIDTH,
        edgeMargin: 50,
        scrollSpeed: 12,
      });
 
      const curRect = rulerRef.current.getBoundingClientRect();
      const moveOffsetX = moveEvent.clientX - curRect.left - HEADER_WIDTH;
      const scrubRaw = Math.max(0, moveOffsetX / pixelsPerSecond);
      const scrubSnapped = getSnappedTime(scrubRaw);
      onSeek(scrubSnapped);
    };
 
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
 
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };
 
  // Determine tick interval based on zoom level — shared with TrackLane's
  // background grid via getTickIntervalSeconds so both stay in sync.
  const tickInterval = getTickIntervalSeconds(pixelsPerSecond);
 
  const totalWidth = propTotalWidth || Math.max(totalDuration * pixelsPerSecond + 400, 1600);
  const numTicks = Math.ceil((totalWidth) / (tickInterval * pixelsPerSecond)) + 4;
 
  return (
    <div
      className="time-ruler"
      ref={rulerRef}
      onPointerDown={handlePointerDown}
      style={{ width: `${totalWidth + HEADER_WIDTH}px` }}
    >
      {/* Export range bar & markers on ruler */}
      {exportRange && (
        <>
          <div
            className="ruler-export-range-bar"
            style={{
              left: `${HEADER_WIDTH + exportRange.in * pixelsPerSecond}px`,
              width: `${Math.max(2, (exportRange.out - exportRange.in) * pixelsPerSecond)}px`,
            }}
          />
          <div
            className="ruler-export-marker in-marker"
            style={{ left: `${HEADER_WIDTH + exportRange.in * pixelsPerSecond}px` }}
            title={`Export In: ${formatTimecode(exportRange.in)}`}
          >
            <div className="ruler-marker-flag">In</div>
          </div>
          <div
            className="ruler-export-marker out-marker"
            style={{ left: `${HEADER_WIDTH + exportRange.out * pixelsPerSecond}px` }}
            title={`Export Out: ${formatTimecode(exportRange.out)}`}
          >
            <div className="ruler-marker-flag">Out</div>
          </div>
        </>
      )}
 
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
});