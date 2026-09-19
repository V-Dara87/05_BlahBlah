import { useRef, useMemo, memo, useState } from 'react';
import { Film, Music, Type, Square, FileCode, Link2, X, Copy, Scissors, Unlink } from 'lucide-react';
import { WaveformCanvas } from '../shared/WaveformCanvas';
import { isScriptComponent, isVideoEntity, isAudioEntity } from '../../engine/ecs';
import { dragHasItemKind, ITEM_KIND_SCRIPT, setDragPayload, ITEM_KIND_ENTITY } from '../../utils/dragData';
import { computeTrimmedOffset } from '../../utils/mediaOffset';
import { ContextMenu } from '../shared/ContextMenu';
import './clip-item.css';
 
/** Return true if candidateChild is a descendant of ancestorId (cycle guard). */
function isDescendantOf(candidateChildId, ancestorId, allClips) {
  if (!candidateChildId || !ancestorId || candidateChildId === ancestorId) return false;
  const visited = new Set();
  let curr = allClips.find((c) => c.id === candidateChildId);
  while (curr?.parentId) {
    if (curr.parentId === ancestorId) return true;
    if (visited.has(curr.parentId)) break;
    visited.add(curr.parentId);
    curr = allClips.find((c) => c.id === curr.parentId);
  }
  return false;
}
 
// Fallback clip card height for the rare case rowHeight isn't known yet
// (matches the old .timeline-clip-card CSS default). Once a rowHeight is
// available the card always sizes off of it instead — see availableHeight
// below — so the card (and its waveform) actually track a resized track,
// and split evenly into sub-lanes when clips overlap in time.
const DEFAULT_CLIP_HEIGHT = 54;
const CLIP_VERTICAL_MARGIN = 10; // 5px top + 5px bottom, matching the CSS `top: 5px` convention
 
export const ClipItem = memo(function ClipItem({
  clip,
  allClips = [],
  tracks = [],
  isLocked = false,
  pixelsPerSecond,
  selectedClipId,
  isSelected,
  selectedIds = [],
  compact = false,
  rowHeight,
  laneIndex = 0,
  laneCount = 1,
  onSelectClip,
  onToggleSelect,
  onRangeSelect,
  onUpdateClip,
  onUpdateClips,
  onDuplicateClips,
  onAttachScriptToEntity,
  onSplitVideoAndAudio,
  onOpenSilenceRemover,
  silencePreviewCuts = null,
  onAdjustSilenceCutEdge = null,
  snappingPoints = [],
  snappingEnabled = true,
}) {
  const isDraggingRef = useRef(false);
  const draggedMovedRef = useRef(false);
  const [isScriptDragOver, setIsScriptDragOver] = useState(false);
 
  const leftPx = clip.startTime * pixelsPerSecond;
  const widthPx = Math.max(16, clip.duration * pixelsPerSecond);
 
  // Full available height for the track row (minus the standard top/bottom
  // margin), before any sub-lane splitting. Tracks the track's own
  // rowHeight once it's been resized taller than the standard row — a
  // track left at default height keeps the original fixed CSS height, so
  // nothing shifts for projects that never touch the resize handle.
  const availableHeight = rowHeight ? Math.max(24, rowHeight - CLIP_VERTICAL_MARGIN) : DEFAULT_CLIP_HEIGHT;
 
  // DaVinci-style compression: when this clip overlaps others in time,
  // laneCount > 1 and the row is split evenly between the concurrent
  // clips (half/half for 2 overlapping, thirds for 3, etc.) — each clip
  // gets its own sub-lane instead of stacking fully on top of one
  // another. A clip with nothing overlapping (laneCount 1) fills the
  // whole row exactly as before, so plain single-clip tracks are
  // unaffected.
  const safeLaneCount = Math.max(1, laneCount);
  const safeLaneIndex = Math.min(Math.max(0, laneIndex), safeLaneCount - 1);
  const cardHeight = Math.max(16, availableHeight / safeLaneCount);
  const cardTop = CLIP_VERTICAL_MARGIN / 2 + safeLaneIndex * cardHeight;
 
  // Detect components
  const hasScript = clip.components?.some((c) => isScriptComponent(c) && c.enabled !== false);
  const hasText = clip.components?.some((c) => c.type === 'TextRenderer');
  const hasShape = clip.components?.some((c) => c.type === 'ShapeRenderer');
  const hasVideo = isVideoEntity(clip);
  const hasAudio = isAudioEntity(clip);
 
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
 
  const isSelectedMulti = selectedIds.includes(clip.id);
  const isSelectedCard = isSelected !== undefined ? isSelected : selectedClipId === clip.id;
  const [isPickwhipActive, setIsPickwhipActive] = useState(false);
 
  // Active selection set across timeline
  const activeSelectedSet = useMemo(() => {
    const s = new Set(selectedIds);
    if (selectedClipId) s.add(selectedClipId);
    return s;
  }, [selectedIds, selectedClipId]);
 
  // Is this clip a child of an active selected clip?
  const isChildOfSelected = clip.parentId ? activeSelectedSet.has(clip.parentId) : false;
 
  // Is this clip a parent of an active selected clip?
  const isParentOfSelected = useMemo(() => {
    return allClips.some((c) => activeSelectedSet.has(c.id) && c.parentId === clip.id);
  }, [allClips, activeSelectedSet, clip.id]);
 
  // Ancestry chain for breadcrumb
  const ancestryChain = useMemo(() => {
    const chain = [];
    const visited = new Set();
    let curr = clip;
    while (curr?.parentId) {
      if (visited.has(curr.parentId)) break;
      visited.add(curr.parentId);
      const parent = allClips.find((c) => c.id === curr.parentId);
      if (!parent) break;
      chain.unshift(parent);
      curr = parent;
    }
    return chain;
  }, [clip, allClips]);
 
  const directParent = ancestryChain.length > 0 ? ancestryChain[ancestryChain.length - 1] : null;
 
  const handlePickwhipPointerDown = (e) => {
    if (isLocked) return;
    e.stopPropagation();
    e.preventDefault();
    setIsPickwhipActive(true);
 
    let currentTargetEl = null;
 
    // Create a floating badge following cursor
    const badge = document.createElement('div');
    badge.className = 'pickwhip-drag-ghost';
    badge.textContent = `🔗 Link "${clip.name}" to...`;
    document.body.appendChild(badge);
 
    const updateBadgePos = (ev) => {
      badge.style.left = `${ev.clientX + 14}px`;
      badge.style.top = `${ev.clientY + 14}px`;
    };
    updateBadgePos(e);
 
    const handlePointerMove = (moveEv) => {
      updateBadgePos(moveEv);
 
      const els = document.elementsFromPoint(moveEv.clientX, moveEv.clientY);
      let foundCard = null;
      for (const el of els) {
        const card = el.closest && el.closest('.timeline-clip-card');
        if (card && card.getAttribute('data-clip-id') !== clip.id) {
          foundCard = card;
          break;
        }
      }
 
      if (currentTargetEl && currentTargetEl !== foundCard) {
        currentTargetEl.classList.remove('link-drop-target');
        currentTargetEl = null;
      }
 
      if (foundCard) {
        const targetId = foundCard.getAttribute('data-clip-id');
        const isCycle = isDescendantOf(targetId, clip.id, allClips);
        if (!isCycle) {
          currentTargetEl = foundCard;
          currentTargetEl.classList.add('link-drop-target');
          const targetClip = allClips.find((c) => c.id === targetId);
          badge.textContent = `🔗 Link "${clip.name}" to "${targetClip?.name || 'Clip'}"`;
          badge.classList.add('valid');
        } else {
          badge.textContent = `⚠️ Cannot link to descendant (Circular)`;
          badge.classList.remove('valid');
        }
      } else {
        badge.textContent = `🔗 Drag onto another clip to link (or drop here to cancel)`;
        badge.classList.remove('valid');
      }
    };
 
    const handlePointerUp = () => {
      setIsPickwhipActive(false);
      badge.remove();
      if (currentTargetEl) {
        currentTargetEl.classList.remove('link-drop-target');
        const targetId = currentTargetEl.getAttribute('data-clip-id');
        if (targetId && targetId !== clip.id && !isDescendantOf(targetId, clip.id, allClips)) {
          onUpdateClip(clip.id, { parentId: targetId });
        }
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
 
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };
 
  const handleBodyPointerDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
 
    // Multi-select modifiers
    if (e.shiftKey && onRangeSelect) {
      onRangeSelect(clip.id);
      return;
    }
    // NOTE: Ctrl/Cmd is now overloaded for two things:
    //   - Ctrl+click (no movement)   -> toggle multi-select (existing behavior)
    //   - Ctrl+drag  (with movement) -> drag-to-parent onto another clip
    // We can't tell which one this is yet at pointerdown time, so the
    // actual toggle-select call is deferred into handlePointerUp below,
    // gated on whether the pointer ever moved (draggedMovedRef).
    const ctrlHeldOnDown = e.ctrlKey || e.metaKey;
 
    // ── Alt/Option + drag = duplicate ─────────────────────────────────────
    // The copy is created immediately and parked exactly on top of the
    // original, then dragged like a normal move. On release without an
    // actual drag the copy is removed again (Alt+click ≠ duplicate).
    let isAltDuplicate = false;
    let dupIds = [];
    if (e.altKey && onDuplicateClips && !isLocked) {
      const newIds = onDuplicateClips([clip.id]);
      if (!newIds || newIds.length === 0) return;
      isAltDuplicate = true;
      dupIds = newIds;
      // Park the copy on its original so the drag starts under the cursor.
      const parkUpdates = newIds.map((newId) => ({
        id: newId,
        updates: { startTime: clip.startTime },
      }));
      if (parkUpdates.length > 0 && onUpdateClips) {
        onUpdateClips(parkUpdates);
      }
    }
 
    // If this clip is part of a multi-selection, keep the multi-selection
    // active (alt-drag always starts from just the pointer-down clip).
    // Skipped when Ctrl is held on down: a Ctrl+drag should not disturb
    // selection, and a plain Ctrl+click's toggle is handled in
    // handlePointerUp below instead of here.
    if (!isAltDuplicate && !isSelectedMulti && !ctrlHeldOnDown) {
      onSelectClip(clip.id);
    }
 
    if (isLocked) return;
 
    isDraggingRef.current = true;
    draggedMovedRef.current = false;
    const startX = e.clientX;
    const origStartTime = clip.startTime;
 
    // Determine which clips to move: the current selection (or the freshly
    // created copies on alt-drag).
    const allSelectedIds = new Set(isAltDuplicate ? dupIds : (isSelectedMulti ? selectedIds : [clip.id]));
    const moveIds = new Set(allSelectedIds);
 
    // Expand moveIds to include all recursive children so children move together with their parent
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const c of allClips) {
        if (!moveIds.has(c.id) && c.parentId && moveIds.has(c.parentId)) {
          moveIds.add(c.id);
          expanded = true;
        }
      }
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
 
    // -- Ctrl+drag = drag-to-parent --------------------------------------
    // Reuses the same "find clip under cursor + cycle guard" approach as
    // the pickwhip handle (handlePickwhipPointerDown above), but is
    // triggered by holding Ctrl/Cmd while dragging the clip body itself,
    // instead of grabbing the dedicated pickwhip button. While active we
    // skip the normal move/track-retarget updates entirely, so the clip's
    // startTime/trackId are never touched -- on release we either set
    // parentId (valid target) or do nothing; either way the clip visually
    // stays exactly where it started (it never moved to begin with).
    let ctrlParentTargetEl = null;
    let ctrlParentBadge = null;
    let ctrlParentActive = false;
 
    const updateCtrlParentBadgePos = (ev) => {
      if (ctrlParentBadge) {
        ctrlParentBadge.style.left = `${ev.clientX + 14}px`;
        ctrlParentBadge.style.top = `${ev.clientY + 14}px`;
      }
    };
 
    const handlePointerMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const deltaPx = moveEvent.clientX - startX;
      const deltaTime = deltaPx / pixelsPerSecond;
 
      if (Math.abs(deltaPx) > 4 || Math.abs(moveEvent.clientY - e.clientY) > 4) {
        draggedMovedRef.current = true;
      }
 
      // Re-check ctrlKey on every move (not just at pointerdown) so
      // pressing/releasing Ctrl mid-drag is respected in both directions.
      if (moveEvent.ctrlKey || moveEvent.metaKey) {
        ctrlParentActive = true;
        if (!ctrlParentBadge) {
          ctrlParentBadge = document.createElement('div');
          ctrlParentBadge.className = 'pickwhip-drag-ghost';
          document.body.appendChild(ctrlParentBadge);
        }
        updateCtrlParentBadgePos(moveEvent);
 
        const els = document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY);
        let foundCard = null;
        for (const el of els) {
          const card = el.closest && el.closest('.timeline-clip-card');
          if (card && card.getAttribute('data-clip-id') !== clip.id) {
            foundCard = card;
            break;
          }
        }
 
        if (ctrlParentTargetEl && ctrlParentTargetEl !== foundCard) {
          ctrlParentTargetEl.classList.remove('link-drop-target');
          ctrlParentTargetEl = null;
        }
 
        if (foundCard) {
          const targetId = foundCard.getAttribute('data-clip-id');
          const isCycle = isDescendantOf(targetId, clip.id, allClips);
          if (!isCycle) {
            ctrlParentTargetEl = foundCard;
            ctrlParentTargetEl.classList.add('link-drop-target');
            const targetClip = allClips.find((c) => c.id === targetId);
            ctrlParentBadge.textContent = `🔗 Set parent: "${targetClip?.name || 'Clip'}"`;
            ctrlParentBadge.classList.add('valid');
          } else {
            ctrlParentBadge.textContent = `⚠️ Cannot link to descendant (Circular)`;
            ctrlParentBadge.classList.remove('valid');
          }
        } else {
          ctrlParentBadge.textContent = `🔗 Drag onto another clip to set parent`;
          ctrlParentBadge.classList.remove('valid');
        }
 
        // Skip all normal move/track logic below while Ctrl is held --
        // the clip stays put; only the hover highlight/badge update.
        return;
      } else if (ctrlParentBadge) {
        // Ctrl was released mid-drag: clean up the ctrl-parent visuals
        // and fall through to normal move behavior below (note:
        // ctrlParentActive stays true so pointerup still knows this
        // gesture started as a ctrl-drag, in case that matters later --
        // currently it doesn't since a normal move already took over).
        ctrlParentBadge.remove();
        ctrlParentBadge = null;
        if (ctrlParentTargetEl) {
          ctrlParentTargetEl.classList.remove('link-drop-target');
          ctrlParentTargetEl = null;
        }
      }
 
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
        const trackEl = el.closest && el.closest('[data-track-id]');
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
      const didDrag = draggedMovedRef.current;
 
      // Finalize a ctrl-drag-to-parent gesture: set parentId on the
      // hovered target (if any/valid), clean up visuals. The clip's
      // own startTime/trackId were never touched during the drag, so
      // there's nothing to "snap back" -- it's still exactly where it
      // started.
      if (ctrlParentBadge) {
        ctrlParentBadge.remove();
        ctrlParentBadge = null;
      }
      if (ctrlParentTargetEl) {
        ctrlParentTargetEl.classList.remove('link-drop-target');
        const targetId = ctrlParentTargetEl.getAttribute('data-clip-id');
        if (targetId && targetId !== clip.id && !isDescendantOf(targetId, clip.id, allClips)) {
          onUpdateClip(clip.id, { parentId: targetId });
        }
        ctrlParentTargetEl = null;
      }
 
      // A plain Ctrl+click (held on pointerdown, but never actually
      // dragged) still means "toggle multi-select", same as before this
      // feature existed.
      if (ctrlHeldOnDown && !ctrlParentActive && !didDrag && onToggleSelect) {
        onToggleSelect(clip.id);
      }
 
      if (isAltDuplicate) {
        // Cleanup a click-with-Alt that never became a drag: the copies
        // parked on top of the originals are removed again.
        if (!didDrag) {
          dupIds.forEach((id) => onUpdateClip(id, { _delete: true }));
        }
      }
 
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
        // Adjust mediaOffset for VideoRenderer / AudioSource components.
        // appliedDeltaTime is a TIMELINE delta, so it must be scaled by the
        // component's own speed to get the correct SOURCE-time offset —
        // see utils/mediaOffset.js for why this matters.
        const updatedComps = clip.components?.map((c) => {
          if (c.type === 'VideoRenderer' || c.type === 'AudioSource') {
            const origOffset = c.mediaOffset || 0;
            const speed = c.speed || 1;
            return {
              ...c,
              mediaOffset: computeTrimmedOffset(origOffset, appliedDeltaTime, speed),
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
 
  // Drag either edge of an auto-detected silence-cut region, directly on
  // the timeline overlay. Mirrors the clip trim handles above (pixel
  // delta -> time delta, converted to clip-local seconds since cut.start/
  // end are relative to the clip's own [0, duration) span, not the
  // timeline). Reports through onAdjustSilenceCutEdge rather than
  // mutating anything locally — SilenceRemoverPanel owns the actual cut
  // data and merges this into its manualCutOverrides (see that file for
  // why: cuts are otherwise fully re-derived on every detection run).
  const handleCutEdgePointerDown = (cutId, edge) => (e) => {
    if (!onAdjustSilenceCutEdge) return;
    e.stopPropagation();
    e.preventDefault();
 
    const startX = e.clientX;
    const cut = (silencePreviewCuts || []).find((c) => (c.id ?? silencePreviewCuts.indexOf(c)) === cutId);
    const origValue = edge === 'start' ? cut?.start ?? 0 : cut?.end ?? clip.duration;
 
    const handlePointerMove = (moveEvent) => {
      const deltaPx = moveEvent.clientX - startX;
      const deltaTime = deltaPx / pixelsPerSecond;
      const newTime = Math.max(0, Math.min(clip.duration, origValue + deltaTime));
      onAdjustSilenceCutEdge(cutId, edge, newTime);
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
 
  // mediaOffset is the clip's in-point into the source file — updated by
  // handleLeftTrimPointerDown/handleRightTrimPointerDown above (and by
  // applying silence-cut results) every time the clip is trimmed. Without
  // passing this window through to WaveformCanvas, the waveform always
  // showed the FULL original file stretched across the clip's current
  // width, regardless of trims — the actual audio played back correctly,
  // but the picture didn't match it. mediaOffset + clip.duration gives
  // the exact [start, end) slice of the source file this clip now plays.
  const mediaOffset = useMemo(() => {
    const audioComp = clip.components?.find((c) => c.type === 'AudioSource' || c.type === 'VideoRenderer');
    return audioComp?.mediaOffset || 0;
  }, [clip.components]);
 
  const showWaveform = hasAudio && audioUrl && widthPx > 30; // only audio clips get waveforms
 
  // ── Script assignment drag & drop (Project panel script → this clip) ────
  const handleScriptDragOver = (e) => {
    if (isLocked || !onAttachScriptToEntity) return;
    if (!dragHasItemKind(e.dataTransfer, ITEM_KIND_SCRIPT)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!isScriptDragOver) setIsScriptDragOver(true);
  };
 
  const handleScriptDrop = (e) => {
    if (isLocked || !onAttachScriptToEntity) return;
    const dataStr = e.dataTransfer?.getData('application/json');
    if (!dataStr) return;
    let data;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return;
    }
    if (data.itemType !== 'script' || !data.itemData?.id) return;
    e.preventDefault();
    e.stopPropagation();
    setIsScriptDragOver(false);
    onAttachScriptToEntity(clip.id, data.itemData.id);
    if (onSelectClip) onSelectClip(clip.id);
  };
 
  // Right-click menu content — rendered through the shared <ContextMenu>
  // shell (see components/ContextMenu.jsx and the JSX return below) so it
  // gets the same portal/positioning/animation as every other menu in the
  // app, instead of the old hand-built document.createElement popup with
  // its own duplicated close-on-outside-click/Escape listeners.
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y } | null
  const closeCtxMenu = () => setCtxMenu(null);
 
  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
 
    // Ensure this clip is selected
    if (!isSelectedCard && !isSelectedMulti) {
      onSelectClip(clip.id);
    }
 
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };
 
  const activeTargetIds = isSelectedMulti ? selectedIds : [clip.id];
  const hasAudioChild = allClips.some((c) => c.parentId === clip.id && isAudioEntity(c));
  const showSplitAudio = !isLocked && isVideoEntity(clip) && !hasAudioChild && onSplitVideoAndAudio;
  const eligibleParents = allClips.filter(
    (c) => c.id !== clip.id && c.id !== clip.parentId && !isDescendantOf(c.id, clip.id, allClips)
  );
  const showQuickLinks = !isLocked && eligibleParents.length > 0 && eligibleParents.length <= 6;
 
  const handleDuplicate = () => {
    const newIds = onDuplicateClips(activeTargetIds);
    if (newIds && newIds.length > 0 && onSelectClip) onSelectClip(newIds[0]);
    closeCtxMenu();
  };
  const handleSplitAudio = () => {
    onSplitVideoAndAudio(clip.id);
    closeCtxMenu();
  };
  const handleUnlinkParent = () => {
    onUpdateClip(clip.id, { parentId: null });
    closeCtxMenu();
  };
  const handleSetParent = (parentId) => {
    onUpdateClip(clip.id, { parentId });
    closeCtxMenu();
  };
 
  return (
    <>
    <div
      data-clip-id={clip.id}
      className={`timeline-clip-card ${clipCategory} ${isSelectedCard || isSelectedMulti ? 'selected' : ''} ${isChildOfSelected ? 'is-linked-child' : ''} ${isParentOfSelected ? 'is-linked-parent' : ''} ${clip.parentId ? 'is-child' : ''} ${isLocked ? 'is-locked' : ''} ${compact ? 'compact' : ''} ${isScriptDragOver ? 'script-drop-target' : ''}`}
      style={{
        left: `${leftPx}px`,
        top: `${cardTop}px`,
        width: `${widthPx}px`,
        height: `${cardHeight}px`,
      }}
      onPointerDown={handleBodyPointerDown}
      onContextMenu={handleContextMenu}
      onDragOver={handleScriptDragOver}
      onDragLeave={() => setIsScriptDragOver(false)}
      onDrop={handleScriptDrop}
      title={`${clip.name} (${clip.duration.toFixed(1)}s)${directParent ? ` [Parent: ${directParent.name}]` : ''}${isLocked ? ' 🔒 Locked' : ''}`}
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
        {/* Waveform overlay for audio/video clips */}
        {showWaveform && (
          <div className="clip-waveform-wrap">
            <WaveformCanvas
              url={audioUrl}
              width={widthPx - 8}
              height={cardHeight - 6}
              color={hasAudio ? 'rgba(139, 92, 246, 0.55)' : 'rgba(56, 189, 248, 0.4)'}
              mirror
              startSec={mediaOffset}
              endSec={mediaOffset + clip.duration}
            />
          </div>
        )}
 
        {/* Live Silence Cut Overlay on Timeline */}
        {silencePreviewCuts && silencePreviewCuts.length > 0 && (
          <div className="clip-silence-cut-overlay">
            {silencePreviewCuts.map((cut, idx) => {
              const cutId = cut.id ?? idx;
              const leftRatio = Math.max(0, cut.start / clip.duration);
              const widthRatio = Math.max(0, cut.duration / clip.duration);
              return (
                <div
                  key={cutId}
                  className="clip-silence-cut-slice"
                  style={{
                    left: `${leftRatio * 100}%`,
                    width: `${widthRatio * 100}%`,
                  }}
                  title={`Cut Silence: ${cut.duration.toFixed(2)}s`}
                >
                  {onAdjustSilenceCutEdge && !isLocked && (
                    <>
                      <div
                        className="silence-cut-edge-handle left"
                        onPointerDown={handleCutEdgePointerDown(cutId, 'start')}
                        title="Drag to adjust cut start"
                      />
                      <div
                        className="silence-cut-edge-handle right"
                        onPointerDown={handleCutEdgePointerDown(cutId, 'end')}
                        title="Drag to adjust cut end"
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
 
        <div className="clip-top-row">
          <span
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              setDragPayload(e.dataTransfer, ITEM_KIND_ENTITY, { id: clip.id, name: clip.name });
            }}
            style={{ display: 'inline-flex', cursor: 'grab' }}
            title="Drag to reference in Inspector"
          >
            {hasVideo ? (
              <Film size={12} className="type-icon" />
            ) : hasAudio ? (
              <Music size={12} className="type-icon" />
            ) : hasText ? (
              <Type size={12} className="type-icon" />
            ) : (
              <Square size={12} className="type-icon" />
            )}
          </span>
          <span className="clip-title-text">{clip.name}</span>
 
          {/* Pickwhip Drag-to-Parent Handle */}
          {!isLocked && (
            <button
              type="button"
              className={`clip-pickwhip-btn ${isPickwhipActive ? 'active' : ''}`}
              title="Drag to another clip to link as child (Pickwhip)"
              onPointerDown={handlePickwhipPointerDown}
            >
              <Link2 size={10} />
            </button>
          )}
 
          {/* Linked Parent Badge */}
          {directParent && (
            <span
              className="clip-parent-tag"
              title={
                ancestryChain.length > 1
                  ? `Parent Chain: ${ancestryChain.map((p) => p.name).join(' > ')} (Click to select parent)`
                  : `Parent: ${directParent.name} (Click to select parent)`
              }
              onClick={(e) => {
                e.stopPropagation();
                if (onSelectClip) onSelectClip(directParent.id);
              }}
            >
              <Link2 size={9} />
              <span className="parent-tag-name">{directParent.name}</span>
              {!isLocked && (
                <button
                  type="button"
                  className="parent-tag-unlink"
                  title="Unlink parent"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateClip(clip.id, { parentId: null });
                  }}
                >
                  <X size={8} />
                </button>
              )}
            </span>
          )}
 
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
 
    {ctxMenu && (
      <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={closeCtxMenu} className="clip-context-menu" minWidth={140}>
        {onDuplicateClips && !isLocked && (
          <button className="ctx-menu-item" onClick={handleDuplicate}>
            <Copy size={12} /> Duplicate
          </button>
        )}
        {showSplitAudio && (
          <button className="ctx-menu-item" onClick={handleSplitAudio}>
            <Scissors size={12} /> Split Video &amp; Audio
          </button>
        )}
        {onOpenSilenceRemover && !isLocked && (hasAudio || hasVideo) && (
          <button className="ctx-menu-item" onClick={() => { closeCtxMenu(); onOpenSilenceRemover(clip.id); }}>
            <Scissors size={12} /> Cut Silence...
          </button>
        )}
        {!isLocked && clip.parentId && (
          <button className="ctx-menu-item" onClick={handleUnlinkParent}>
            <Unlink size={12} /> Unlink Parent
          </button>
        )}
        {showQuickLinks && eligibleParents.map((p) => (
          <button key={p.id} className="ctx-menu-item" onClick={() => handleSetParent(p.id)}>
            <Link2 size={12} /> Set Parent: {p.name}
          </button>
        ))}
      </ContextMenu>
    )}
    </>
  );
});
 
 