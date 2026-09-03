import { useRef, useMemo, memo } from 'react';
import { Film, Music, Type, Square, FileCode } from 'lucide-react';
import { WaveformCanvas } from '../WaveformCanvas';

export const ClipItem = memo(function ClipItem({
  clip,
  allClips = [],
  pixelsPerSecond,
  isSelected,
  selectedIds = [],
  onSelectClip,
  onToggleSelect,
  onRangeSelect,
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

  // Find linked clips (same linkGroupId, excluding self)
  const linkedClips = clip.linkGroupId
    ? allClips.filter((c) => c.linkGroupId === clip.linkGroupId && c.id !== clip.id)
    : [];
  const isLinked = linkedClips.length > 0;

  const isSelectedMulti = selectedIds.includes(clip.id);

  const handleBodyPointerDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    // Multi-select modifiers
    if (e.shiftKey && onRangeSelect) {
      onRangeSelect(clip.id);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && onToggleSelect) {
      onToggleSelect(clip.id);
      return;
    }

    // If this clip is part of a multi-selection, don't deselect others
    if (!isSelectedMulti) {
      onSelectClip(clip.id);
    }

    isDraggingRef.current = true;
    const startX = e.clientX;
    const origStartTime = clip.startTime;
    let currentTrackId = clip.trackId;

    // Determine which clips to move: all selected + linked
    const allSelectedIds = new Set(isSelectedMulti ? selectedIds : [clip.id]);
    // Also include linked clips of all selected
    const moveIds = new Set(allSelectedIds);
    allClips.forEach((c) => {
      if (c.linkGroupId && allClips.some((s) => s.id !== c.id && s.linkGroupId === c.linkGroupId && allSelectedIds.has(s.id))) {
        moveIds.add(c.id);
      }
    });

    // Snapshot original positions of all clips being moved
    const moveOriginals = allClips
      .filter((c) => moveIds.has(c.id))
      .map((c) => ({
        id: c.id,
        origStartTime: c.startTime,
        origTrackId: c.trackId,
      }));

    const handlePointerMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const deltaPx = moveEvent.clientX - startX;
      const deltaTime = deltaPx / pixelsPerSecond;
      let rawNewStart = Math.max(0, origStartTime + deltaTime);

      // Auto-scroll when dragging near timeline edges
      const scrollEl = document.querySelector('.lanes-wrapper');
      if (scrollEl) {
        const scrollRect = scrollEl.getBoundingClientRect();
        const edgeMargin = 60;
        const scrollSpeed = 8;
        if (moveEvent.clientX < scrollRect.left + edgeMargin) {
          scrollEl.scrollLeft = Math.max(0, scrollEl.scrollLeft - scrollSpeed);
        } else if (moveEvent.clientX > scrollRect.right - edgeMargin) {
          scrollEl.scrollLeft += scrollSpeed;
        }
      }
      
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

      const timeDelta = finalNewStart - origStartTime;

      // Move all selected clips by the same delta
      moveOriginals.forEach((mo) => {
        const newStart = Math.max(0, mo.origStartTime + timeDelta);
        const updates = { startTime: newStart };
        // Only change track for the primary clip being dragged
        if (mo.id === clip.id && detectedTrackId && detectedTrackId !== currentTrackId) {
          currentTrackId = detectedTrackId;
          updates.trackId = detectedTrackId;
        }
        onUpdateClip(mo.id, updates);
      });
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

  // Extract audio URL for waveform display (AudioSource or VideoRenderer src)
  const audioUrl = useMemo(() => {
    if (clip.src) return clip.src;
    const audioComp = clip.components?.find((c) => c.type === 'AudioSource' || c.type === 'VideoRenderer');
    return audioComp?.src || null;
  }, [clip.src, clip.components]);

  const showWaveform = hasAudio && audioUrl && widthPx > 30; // only audio clips get waveforms

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Build context menu
    const existing = document.querySelector('.clip-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'clip-context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    if (isLinked) {
      const unlinkBtn = document.createElement('button');
      unlinkBtn.textContent = '🔓 Unlink';
      unlinkBtn.className = 'ctx-menu-item';
      unlinkBtn.onclick = () => {
        onUpdateClip(clip.id, { linkGroupId: null });
        linkedClips.forEach((lc) => onUpdateClip(lc.id, { linkGroupId: null }));
        menu.remove();
      };
      menu.appendChild(unlinkBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑 Delete';
    deleteBtn.className = 'ctx-menu-item danger';
    deleteBtn.onclick = () => {
      onSelectClip(null);
      // Delete this clip and its linked clips
      const idsToDelete = [clip.id, ...linkedClips.map((lc) => lc.id)];
      idsToDelete.forEach((id) => onUpdateClip(id, { _delete: true }));
      menu.remove();
    };
    menu.appendChild(deleteBtn);

    document.body.appendChild(menu);
    const closeMenu = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closeMenu);
        document.removeEventListener('keydown', onKey);
      }
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        menu.remove();
        document.removeEventListener('pointerdown', closeMenu);
        document.removeEventListener('keydown', onKey);
      }
    };
    requestAnimationFrame(() => {
      document.addEventListener('pointerdown', closeMenu);
      document.addEventListener('keydown', onKey);
    });
  };

  return (
    <div
      className={`timeline-clip-card ${clipCategory} ${isSelected || isSelectedMulti ? 'selected' : ''} ${isLinked ? 'linked' : ''}`}
      style={{
        left: `${leftPx}px`,
        width: `${widthPx}px`,
      }}
      onPointerDown={handleBodyPointerDown}
      onContextMenu={handleContextMenu}
      title={`${clip.name} (${clip.duration.toFixed(1)}s)${isLinked ? ' 🔗 Linked' : ''}`}
    >
      {/* Left Trim Handle */}
      <div
        className="clip-trim-handle left"
        onPointerDown={handleLeftTrimPointerDown}
        title="Trim Left (In-Point)"
      />

      {/* Clip Content */}
      <div className="clip-content-box">
        {/* Linked clip indicator */}
        {isLinked && (
          <div className="clip-link-indicator" title="Linked clip">
            <span className="link-icon">🔗</span>
          </div>
        )}

        {/* Waveform overlay for audio/video clips */}
        {showWaveform && (
          <div className="clip-waveform-wrap">
            <WaveformCanvas
              url={audioUrl}
              width={widthPx - 8}
              height={48}
              color={hasAudio ? 'rgba(139, 92, 246, 0.5)' : 'rgba(56, 189, 248, 0.35)'}
              barWidth={2}
              barGap={1}
              mirror
            />
          </div>
        )}

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
