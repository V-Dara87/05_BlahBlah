import { useRef, useEffect, memo } from 'react';
import { usePlaybackStore } from '../../hooks/PlaybackContext';
import './live-recording-clip-preview.css';

function formatElapsed(seconds) {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

/**
 * LiveRecordingClipPreview — visual real-time preview clip rendered on
 * the track lane while audio recording is in progress.
 *
 * Advances smoothly at 60fps via PlaybackStore registerFrameCallback,
 * showing live elapsed recording time and mic audio level.
 */
export const LiveRecordingClipPreview = memo(function LiveRecordingClipPreview({
  startTime = 0,
  pixelsPerSecond = 100,
  rowHeight = 64,
  level = 0,
}) {
  const store = usePlaybackStore();
  const previewRef = useRef(null);
  const timeTextRef = useRef(null);
  const meterBarRef = useRef(null);

  useEffect(() => {
    const update = (time) => {
      if (!previewRef.current) return;
      const elapsed = Math.max(0, time - startTime);
      const widthPx = Math.max(16, elapsed * pixelsPerSecond);
      previewRef.current.style.width = `${widthPx}px`;
      if (timeTextRef.current) {
        timeTextRef.current.textContent = `REC ${formatElapsed(elapsed)}`;
      }
    };
    update(store.getCurrentTime());
    return store.registerFrameCallback(update);
  }, [store, startTime, pixelsPerSecond]);

  useEffect(() => {
    if (meterBarRef.current) {
      const pct = Math.min(100, Math.max(4, Math.round(level * 100)));
      meterBarRef.current.style.width = `${pct}%`;
      if (pct > 80) {
        meterBarRef.current.style.backgroundColor = '#ef4444';
      } else if (pct > 50) {
        meterBarRef.current.style.backgroundColor = '#f59e0b';
      } else {
        meterBarRef.current.style.backgroundColor = '#10b981';
      }
    }
  }, [level]);

  const leftPx = startTime * pixelsPerSecond;

  return (
    <div
      ref={previewRef}
      className="live-recording-clip-preview"
      style={{
        left: `${leftPx}px`,
        top: '2px',
        height: `${Math.max(20, rowHeight - 4)}px`,
      }}
      title={`Recording Audio starting at ${startTime.toFixed(2)}s`}
    >
      <div className="recording-preview-inner">
        <div className="recording-preview-header">
          <span className="recording-live-pulse-dot" />
          <span ref={timeTextRef} className="recording-live-time-text">
            REC 00:00.0
          </span>
        </div>

        <div className="recording-live-meter-wrap">
          <div ref={meterBarRef} className="recording-live-meter-bar" />
        </div>
      </div>
    </div>
  );
});
