import { useRef, useMemo, memo } from 'react';
import { Film, Music, Type, Square, FileCode } from 'lucide-react';
import { WaveformCanvas } from '../WaveformCanvas';
import { isScriptComponent } from '../../engine/ecs';

export const ClipItem = memo(function ClipItem({
  clip,
  allClips = [],
  tracks = [],
  isLocked = false,
  pixelsPerSecond,
  isSelected,
  selectedIds = [],
  onSelectClip,
  onToggleSelect,
  onRangeSelect,
  onUpdateClip,
  onUpdateClips,
  onDuplicateClips,
  snappingPoints = [],
  snappingEnabled = true,
}) {
  const isDraggingRef = useRef(false);

  const leftPx = clip.startTime * pixelsPerSecond;
  const widthPx = Math.max(16, clip.duration * pixelsPerSecond);

  // Detect components
  const hasScript = clip.components?.some((c) => isScriptComponent(c) && c.enabled !== false);
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

    // If this clip is part of a multi-selection, keep the multi-selection active
    if (!isSelectedMulti) {
      onSelectClip(clip.id);
    }

    if (isLocked) return;

    isDraggingRef.current = true;
    const startX = e.clientX;
    const origStartTime = clip.startTime;

    // Determine which clips to move: all selected + linked + descendants
    // of anything moving. Hierarchy: dragging a parent clip shifts its
    // whole child subtree by the same Δt so children stay time-locked
    // inside the parent's window (see renderPipeline.js's parent-gated
    // visibility).
    const allSelectedIds = new Set(isSelectedMulti ? selectedIds : [clip.id]);
    const moveIds = new Set(allSelectedIds);

    // Iterate both rules to a fixpoint so e.g. a parent's child that is
    // itself part of a link group pulls its linked partner along too.
    let grew = true;
    while (grew) {
      grew = false;
      // Linked clips (same linkGroupId) of any moving clip move together.
      allClips.forEach((c) => {
        if (c.linkGroupId && !moveIds.has(c.id) && allClips.some((s) => s.id !== c.id && s.linkGroupId === c.linkGroupId && moveIds.has(s.id))) {
          moveIds.add(c.id);
          grew = true;
        }
      });
      // Recursive descendants of any moving clip (children of children
      // too) stay time-locked under their parent.
      allClips.forEach((c) => {
        if (c.parentId && moveIds.has(c.parentId) && !moveIds.has(c.id)) {
          moveIds.add(c.id);
          grew = true;
        }
      });
    }

    // Snapshot original positions and track indices of all clips being moved
    const moveOriginals = allClips
      .filter((c) => moveIds.has(c.id))
      .map((c) => ({
        id: c.id,
        origStartTime: c.startTime,
        origTrackId: c.trackId,
        trackIdx: tracks.findIndex((t) => t.id === c.trackId),
        duration: c.duration,
      }));

    const minStartTime = Math.min(...moveOriginals.map((mo) => mo.origStartTime));
    const origTrackIdx = tracks.findIndex((t) => t.id === clip.trackId);

    const handlePointerMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const deltaPx = moveEvent.clientX - startX;
      const deltaTime = deltaPx / pixelsPerSecond;

      // Auto-scroll when dragging near timeline edges
      const scrollEl = document.querySelector('.lanes-wrapper');
      if (scrollEl) {
        const scrollRect = scrollEl.getBoundingClientRect();
        const edgeMargin = 60;
        const scrollSpeed = 10;
        if (moveEvent.clientX < scrollRect.left + 180 + edgeMargin) {
          scrollEl.scrollLeft = Math.max(0, scrollEl.scrollLeft - scrollSpeed);
        } else if (moveEvent.clientX > scrollRect.right - edgeMargin) {
          scrollEl.scrollLeft += scrollSpeed;
        }
      }

      // Clamp deltaTime so NO clip goes below 0
      const clampedDeltaTime = Math.max(-minStartTime, deltaTime);
      let rawNewStart = origStartTime + clampedDeltaTime;

      let finalNewStart = getSnappedTime(rawNewStart);
      const rightEdge = rawNewStart + clip.duration;
      const snappedRight = getSnappedTime(rightEdge);
      if (snappedRight !== rightEdge) {
        finalNewStart = Math.max(0, snappedRight - clip.duration);
      }

      const timeDelta = Math.max(-minStartTime, finalNewStart - origStartTime);

      // Check vertical position to detect target track
      const elementsUnderPointer = document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY);
      let targetTrackIdx = origTrackIdx;
      for (const el of elementsUnderPointer) {
        const trackEl = el.closest('[data-track-id]');
        if (trackEl) {
          const detectedTrackId = trackEl.getAttribute('data-track-id');
          const idx = tracks.findIndex((t) => t.id === detectedTrackId);
          if (idx >= 0) {
            targetTrackIdx = idx;
          }
          break;
        }
      }

      const trackDelta = (targetTrackIdx >= 0 && origTrackIdx >= 0) ? (targetTrackIdx - origTrackIdx) : 0;
      // Verify all clips stay within valid tracks and don't land on locked tracks
      const canShiftTracks = moveOriginals.every((mo) => {
        const newIdx = mo.trackIdx + trackDelta;
        return newIdx >= 0 && newIdx < tracks.length && !tracks[newIdx]?.locked;
      });

      // Prepare batch updates for all moving clips
      const batchUpdates = moveOriginals.map((mo) => {
        const newStart = Math.max(0, mo.origStartTime + timeDelta);
        const newTrackId = (canShiftTracks && trackDelta !== 0 && tracks[mo.trackIdx + trackDelta])
          ? tracks[mo.trackIdx + trackDelta].id
          : mo.origTrackId;
        return {
          id: mo.id,
          updates: { startTime: newStart, trackId: newTrackId },
        };
      });

      if (onUpdateClips) {
        onUpdateClips(batchUpdates);
      } else {
        batchUpdates.forEach((u) => onUpdateClip(u.id, u.updates));
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

  const handleLeftTrimPointerDown = (e) => {
    if (isLocked) return;
    e.stopPropagation();
    onSelectClip(clip.id);

    const startX = e.clientX;
    const origStartTime = clip.startTime;
    const origDuration = clip.duration;

    const handlePointerMove = (moveEvent) => {
      // Auto-scroll when trimming near edges
      const scrollEl = document.querySelector('.lanes-wrapper');
      if (scrollEl) {
        const scrollRect = scrollEl.getBoundingClientRect();
        const edgeMargin = 60;
        const scrollSpeed = 8;
        if (moveEvent.clientX < scrollRect.left + 180 + edgeMargin) {
          scrollEl.scrollLeft = Math.max(0, scrollEl.scrollLeft - scrollSpeed);
        } else if (moveEvent.clientX > scrollRect.right - edgeMargin) {
          scrollEl.scrollLeft += scrollSpeed;
        }
      }

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
    if (isLocked) return;
    e.stopPropagation();
    onSelectClip(clip.id);

    const startX = e.clientX;
    const origDuration = clip.duration;
    const origStartTime = clip.startTime;

    const handlePointerMove = (moveEvent) => {
      // Auto-scroll when trimming near edges
      const scrollEl = document.querySelector('.lanes-wrapper');
      if (scrollEl) {
        const scrollRect = scrollEl.getBoundingClientRect();
        const edgeMargin = 60;
        const scrollSpeed = 8;
        if (moveEvent.clientX < scrollRect.left + 180 + edgeMargin) {
          scrollEl.scrollLeft = Math.max(0, scrollEl.scrollLeft - scrollSpeed);
        } else if (moveEvent.clientX > scrollRect.right - edgeMargin) {
          scrollEl.scrollLeft += scrollSpeed;
        }
      }

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

    // Ensure this clip is selected
    if (!isSelected && !isSelectedMulti) {
      onSelectClip(clip.id);
    }

    const existing = document.querySelector('.clip-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'clip-context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const activeTargetIds = isSelectedMulti ? selectedIds : [clip.id];

    // Duplicate button
    if (onDuplicateClips && !isLocked) {
      const dupBtn = document.createElement('button');
      dupBtn.textContent = '📄 Duplicate';
      dupBtn.className = 'ctx-menu-item';
      dupBtn.onclick = () => {
        onDuplicateClips(activeTargetIds);
        menu.remove();
      };
      menu.appendChild(dupBtn);
    }

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

    if (!isLocked) {
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '🗑 Delete';
      deleteBtn.className = 'ctx-menu-item danger';
      deleteBtn.onclick = () => {
        onSelectClip(null);
        // Delete this clip and its linked clips / selected clips
        const idsToDelete = new Set([...activeTargetIds, ...linkedClips.map((lc) => lc.id)]);
        idsToDelete.forEach((id) => onUpdateClip(id, { _delete: true }));
        menu.remove();
      };
      menu.appendChild(deleteBtn);
    }

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
      className={`timeline-clip-card ${clipCategory} ${isSelected || isSelectedMulti ? 'selected' : ''} ${isLinked ? 'linked' : ''} ${isLocked ? 'is-locked' : ''}`}
      style={{
        left: `${leftPx}px`,
        width: `${widthPx}px`,
      }}
      onPointerDown={handleBodyPointerDown}
      onContextMenu={handleContextMenu}
      title={`${clip.name} (${clip.duration.toFixed(1)}s)${isLinked ? ' 🔗 Linked' : ''}${isLocked ? ' 🔒 Locked' : ''}`}
    >
      {/* Left Trim Handle */}
      {!isLocked && (
        <div
          className="clip-trim-handle left"
          onPointerDown={handleLeftTrimPointerDown}
          title="Trim Left (In-Point)"
        />
      )}

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
            <span className="script-tag" title="Attached script">
              <FileCode size={9} /> Script
            </span>
          )}
        </div>

        <span className="clip-time-text">{clip.duration.toFixed(1)}s</span>
      </div>

      {/* Right Trim Handle */}
      {!isLocked && (
        <div
          className="clip-trim-handle right"
          onPointerDown={handleRightTrimPointerDown}
          title="Trim Right (Out-Point)"
        />
      )}
    </div>
  );
});
