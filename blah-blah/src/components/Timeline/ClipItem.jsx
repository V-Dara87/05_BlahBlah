import { useRef, memo } from 'react';
import { Film, Music, Type, Square, FileCode } from 'lucide-react';

export const ClipItem = memo(function ClipItem({
  clip,
  pixelsPerSecond,
  isSelected,
  onSelectClip,
  onUpdateClip,
  snappingPoints = [],
  snappingEnabled = true,
}) {
  const isDraggingRef = useRef(false);

  const leftPx = clip.startTime * pixelsPerSecond;
  const widthPx = Math.max(16, clip.duration * pixelsPerSecond);

  // Detect components
  const hasScript = clip.components?.some((c) => c.type === 'MonoBehaviour' && c.enabled);
  const hasText = clip.components?.some((c) => c.type === 'TextRenderer');
  const hasShape = clip.components?.some((c) => c.type === 'ShapeRenderer');
  const hasVideo = clip.components?.some((c) => c.type === 'VideoRenderer') || clip.type === 'video';
  const hasAudio = clip.components?.some((c) => c.type === 'AudioSource') || clip.type === 'audio';

  const clipCategory = hasVideo ? 'video' : hasAudio ? 'audio' : hasText ? 'text' : hasShape ? 'shape' : 'prefab';

  const getSnappedTime = (rawTime) => {
    if (!snappingEnabled || snappingPoints.length === 0) return rawTime;
    const snapThresholdSec = 10 / pixelsPerSecond;
    for (const point of snappingPoints) {
      if (Math.abs(rawTime - point) < snapThresholdSec) {
        return point;
      }
    }
    return rawTime;
  };

  const handleBodyPointerDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelectClip(clip.id);

    isDraggingRef.current = true;
    const startX = e.clientX;
    const origStartTime = clip.startTime;
    let currentTrackId = clip.trackId;

    const handlePointerMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const deltaPx = moveEvent.clientX - startX;
      const deltaTime = deltaPx / pixelsPerSecond;
      let rawNewStart = Math.max(0, origStartTime + deltaTime);
      
      let finalNewStart = getSnappedTime(rawNewStart);
      const rightEdge = rawNewStart + clip.duration;
      const snappedRight = getSnappedTime(rightEdge);
      if (snappedRight !== rightEdge) {
        finalNewStart = Math.max(0, snappedRight - clip.duration);
      }

      // Check vertical position to detect target track
      const elementsUnderPointer = document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY);
      let detectedTrackId = currentTrackId;
      for (const el of elementsUnderPointer) {
        const trackEl = el.closest('[data-track-id]');
        if (trackEl) {
          detectedTrackId = trackEl.getAttribute('data-track-id');
          break;
        }
      }

      const updates = { startTime: finalNewStart };
      if (detectedTrackId && detectedTrackId !== currentTrackId) {
        currentTrackId = detectedTrackId;
        updates.trackId = detectedTrackId;
      }

      onUpdateClip(clip.id, updates);
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleLeftTrimPointerDown = (e) => {
    e.stopPropagation();
    onSelectClip(clip.id);

    const startX = e.clientX;
    const origStartTime = clip.startTime;
    const origDuration = clip.duration;

    const handlePointerMove = (moveEvent) => {
      const deltaPx = moveEvent.clientX - startX;
      const deltaTime = deltaPx / pixelsPerSecond;

      let newStartTime = Math.max(0, origStartTime + deltaTime);
      newStartTime = getSnappedTime(newStartTime);

      const appliedDeltaTime = newStartTime - origStartTime;
      const newDuration = origDuration - appliedDeltaTime;

      if (newDuration >= 0.2) {
        // Adjust mediaOffset for VideoRenderer / AudioSource components
        const updatedComps = clip.components?.map((c) => {
          if (c.type === 'VideoRenderer' || c.type === 'AudioSource') {
            const origOffset = c.mediaOffset || 0;
            return {
              ...c,
              mediaOffset: Math.max(0, origOffset + appliedDeltaTime),
            };
          }
          return c;
        });

        onUpdateClip(clip.id, {
          startTime: newStartTime,
          duration: newDuration,
          components: updatedComps || clip.components,
        });
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleRightTrimPointerDown = (e) => {
    e.stopPropagation();
    onSelectClip(clip.id);

    const startX = e.clientX;
    const origDuration = clip.duration;
    const origStartTime = clip.startTime;

    const handlePointerMove = (moveEvent) => {
      const deltaPx = moveEvent.clientX - startX;
      const deltaTime = deltaPx / pixelsPerSecond;
      let rawNewDuration = Math.max(0.2, origDuration + deltaTime);

      const targetEnd = origStartTime + rawNewDuration;
      const snappedEnd = getSnappedTime(targetEnd);
      if (snappedEnd !== targetEnd) {
        rawNewDuration = Math.max(0.2, snappedEnd - origStartTime);
      }

      onUpdateClip(clip.id, { duration: rawNewDuration });
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <div
      className={`timeline-clip-card ${clipCategory} ${isSelected ? 'selected' : ''}`}
      style={{
        left: `${leftPx}px`,
        width: `${widthPx}px`,
      }}
      onPointerDown={handleBodyPointerDown}
      title={`${clip.name} (${clip.duration.toFixed(1)}s)`}
    >
      {/* Left Trim Handle */}
      <div
        className="clip-trim-handle left"
        onPointerDown={handleLeftTrimPointerDown}
        title="Trim Left (In-Point)"
      />

      {/* Clip Content */}
      <div className="clip-content-box">
        <div className="clip-top-row">
          {hasVideo ? (
            <Film size={12} className="type-icon" />
          ) : hasAudio ? (
            <Music size={12} className="type-icon" />
          ) : hasText ? (
            <Type size={12} className="type-icon" />
          ) : (
            <Square size={12} className="type-icon" />
          )}
          <span className="clip-title-text">{clip.name}</span>
          
          {hasScript && (
            <span className="script-tag" title="Attached C# Script">
              <FileCode size={9} /> C#
            </span>
          )}
        </div>

        <span className="clip-time-text">{clip.duration.toFixed(1)}s</span>
      </div>

      {/* Right Trim Handle */}
      <div
        className="clip-trim-handle right"
        onPointerDown={handleRightTrimPointerDown}
        title="Trim Right (Out-Point)"
      />
    </div>
  );
});
