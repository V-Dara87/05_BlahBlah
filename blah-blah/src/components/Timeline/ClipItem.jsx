import { useRef, useMemo, memo, useState } from 'react';
import { Film, Music, Type, Square, FileCode, Plus } from 'lucide-react';
import { WaveformCanvas } from '../WaveformCanvas';
import { isScriptComponent, collectDescendantIds } from '../../engine/ecs';
import { dragHasItemKind, ITEM_KIND_SCRIPT } from '../../utils/dragData';
import { sortChildrenOf } from '../../utils/timelineLayout';

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
  onSelectClip,
  onToggleSelect,
  onRangeSelect,
  onUpdateClip,
  onUpdateClips,
  onDuplicateClips,
  onGroupClips,
  onUngroupClips,
  onReparentEntity,
  onAttachScriptToEntity,
  onAddChildClip,
  onReorderChild,
  snappingPoints = [],
  snappingEnabled = true,
}) {
  const isDraggingRef = useRef(false);
  // DOM element currently glowing as a parenting drop target (see
  // pointer-move logic) — cleared whenever the drop zone changes or the
  // drag ends.
  const parentHighlightRef = useRef(null);
  const draggedMovedRef = useRef(false);
  const [isScriptDragOver, setIsScriptDragOver] = useState(false);

  const leftPx = clip.startTime * pixelsPerSecond;
  const widthPx = Math.max(16, clip.duration * pixelsPerSecond);

  // Detect components
  const hasScript = clip.components?.some((c) => isScriptComponent(c) && c.enabled !== false);
  const hasText = clip.components?.some((c) => c.type === 'TextRenderer');
  const hasShape = clip.components?.some((c) => c.type === 'ShapeRenderer');
  const hasVideo = clip.components?.some((c) => c.type === 'VideoRenderer') || clip.type === 'video';
  const hasAudio = clip.components?.some((c) => c.type === 'AudioSource') || clip.type === 'audio';

  const clipCategory = hasVideo ? 'video' : hasAudio ? 'audio' : hasText ? 'text' : hasShape ? 'shape' : 'prefab';

  // A child clip is allowed to live outside its parent's time window (it
  // can be dragged out of the parent's box). The portion of the clip that
  // sticks OUT of the box gets a dashed + faded overlay — the part inside
  // the parent's window stays normal (see the .clip-outside-window bars).
  const parentOfClip = clip.parentId ? allClips.find((c) => c.id === clip.parentId) : null;
  let leftOverhangSec = 0;
  let rightOverhangSec = 0;
  if (parentOfClip) {
    const pStart = parentOfClip.startTime;
    const pEnd = parentOfClip.startTime + parentOfClip.duration;
    leftOverhangSec = Math.max(0, pStart - clip.startTime);
    rightOverhangSec = Math.max(0, clip.startTime + clip.duration - pEnd);
  }
  const hasOutOfWindow = leftOverhangSec > 0.01 || rightOverhangSec > 0.01;

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

  // Find linked clips (same linkGroupId, excluding self) — legacy support:
  // new projects use the parentId hierarchy instead.
  const linkedClips = clip.linkGroupId
    ? allClips.filter((c) => c.linkGroupId === clip.linkGroupId && c.id !== clip.id)
    : [];
  const isLinked = linkedClips.length > 0;

  const isSelectedMulti = selectedIds.includes(clip.id);
  const isSelectedCard = isSelected !== undefined ? isSelected : selectedClipId === clip.id;

  // Clear the DOM highlight used to preview a parenting target.
  const clearParentHighlight = () => {
    if (parentHighlightRef.current) {
      parentHighlightRef.current.classList.remove('parent-drop-target');
      parentHighlightRef.current = null;
    }
  };

  // Highlight the element a drop would parent to (clip card or sub-lane row).
  const highlightParentTarget = (targetEl) => {
    if (parentHighlightRef.current === targetEl) return;
    clearParentHighlight();
    if (targetEl) {
      targetEl.classList.add('parent-drop-target');
      parentHighlightRef.current = targetEl;
    }
  };

  // Given the raw element list under a pointer position, decide the
  // parenting target. Excludes self + anything already being dragged.
  // Resolve the parenting target under a pointer position from the raw
  // element stack. Priority: another clip's CARD (parent to that clip), then
  // another clip's SUB-LANE ROW (parent to the clip owning that lane — with
  // per-child lanes this is the lane's own clip, enabling grandchild
  // nesting). Dropping on a ROOT MAIN-LANE (any track's top strip) is the
  // only "root" hit: it unparents a child / moves it onto that track. A
  // child's OWN lane resolves to nothing (dragging a child inside its own
  // lane must never unparent it), and empty space below lanes in an expanded
  // row is not a root drop zone.
  const resolveParentTargetAt = (elements, moveIds, selfId) => {
    let laneTrackId = null;
    for (const el of elements) {
      // Another clip's card — parent to that clip
      const card = el.closest && el.closest('.timeline-clip-card');
      if (card) {
        const targetId = card.getAttribute('data-clip-id');
        if (targetId && targetId !== selfId && !moveIds.has(targetId)) {
          return { kind: 'parent', element: card, id: targetId, viaLane: false };
        }
        continue;
      }
      // Track lane strip — move to this track
      const rowEl = el.closest && el.closest('[data-track-id]');
      if (rowEl) {
        laneTrackId = rowEl.getAttribute('data-track-id');
        break;
      }
    }
    return laneTrackId ? { kind: 'root', trackId: laneTrackId } : null;
  };

  // Probe several points around the pointer — the dragged card occludes the
  // exact pixel under the cursor, so nearby sample points catch the real
  // drop target once the drag overlaps it.
  const probeParentTarget = (x, y, moveIds, selfId) => {
    // Sub-lane rows are only 40px tall, so vertical samples stay tight
    // (±12px) to avoid spilling into a neighboring lane; horizontal samples
    // are wider to catch the zone edges occluded by the dragged card.
    const points = [
      [x, y],
      [x + 30, y],
      [x - 30, y],
      [x, y + 12],
      [x, y - 12],
    ];
    let rootHit = null;
    for (const [px, py] of points) {
      const hit = resolveParentTargetAt(document.elementsFromPoint(px, py), moveIds, selfId);
      if (!hit) continue;
      if (hit.kind === 'parent') return hit;
      rootHit = hit; // remember root-lane sighting; a parent wins over it
    }
    return rootHit;
  };

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

    // ── Alt/Option + drag = duplicate (with its whole child subtree) ──────
    // Copies are created immediately and parked exactly on top of the
    // originals, then dragged like a normal move. On release without an
    // actual drag the copies are removed again (Alt+click ≠ duplicate).
    let isAltDuplicate = false;
    let dupIds = [];
    let dupPrimaryId = clip.id;
    if (e.altKey && onDuplicateClips && !isLocked) {
      const newIds = onDuplicateClips([clip.id]);
      if (!newIds || newIds.length === 0) return;
      isAltDuplicate = true;
      dupIds = newIds;
      dupPrimaryId = newIds[0];
      // Park each copy on its original so the drag starts under the cursor.
      const subtreeIds = [clip.id, ...collectDescendantIds(allClips, clip.id)];
      const parkUpdates = newIds
        .map((newId, i) => {
          const orig = allClips.find((c) => c.id === subtreeIds[i]);
          return orig ? { id: newId, updates: { startTime: orig.startTime } } : null;
        })
        .filter(Boolean);
      if (parkUpdates.length > 0 && onUpdateClips) {
        onUpdateClips(parkUpdates);
      }
    }

    // If this clip is part of a multi-selection, keep the multi-selection
    // active (alt-drag always starts from just the pointer-down clip).
    if (!isAltDuplicate && !isSelectedMulti) {
      onSelectClip(clip.id);
    }

    if (isLocked) return;

    isDraggingRef.current = true;
    draggedMovedRef.current = false;
    const startX = e.clientX;
    const origStartTime = clip.startTime;

    // Determine which clips to move: all selected + linked + descendants
    // of anything moving (alt-drag: the freshly created copies). Hierarchy:
    // dragging a parent clip shifts its whole child subtree by the same Δt
    // so children stay time-locked inside the parent's window.
    const allSelectedIds = new Set(isAltDuplicate ? dupIds : (isSelectedMulti ? selectedIds : [clip.id]));
    const moveIds = new Set(allSelectedIds);

    // Iterate both rules to a fixpoint so e.g. a parent's child that is
    // itself part of a legacy link group pulls its linked partner along too.
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

      if (Math.abs(deltaPx) > 4 || Math.abs(moveEvent.clientY - e.clientY) > 4) {
        draggedMovedRef.current = true;
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

      // If moving a single child clip with a parent, keep it inside the parent's window
      if (clip.parentId && moveIds.size === 1) {
        const parentClip = allClips.find((c) => c.id === clip.parentId);
        if (parentClip) {
          const pStart = parentClip.startTime;
          const pEnd = parentClip.startTime + parentClip.duration;
          const maxStart = Math.max(pStart, pEnd - clip.duration);
          rawNewStart = Math.min(Math.max(rawNewStart, pStart), maxStart);
        }
      }

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

      // Parenting target preview (pointer-drag; the release commits the
      // change — see handlePointerUp). Only "parent" hits get a highlight;
      // dropping on a root lane just clears any pending parent target.
      const parentHit = probeParentTarget(moveEvent.clientX, moveEvent.clientY, moveIds, dupPrimaryId);
      if (parentHit && parentHit.kind === 'parent') {
        highlightParentTarget(parentHit.element);
      } else {
        highlightParentTarget(null);
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

    const handlePointerUp = (upEvent) => {
      isDraggingRef.current = false;
      clearParentHighlight();
      const didDrag = draggedMovedRef.current;

      if (isAltDuplicate) {
        // Cleanup a click-with-Alt that never became a drag: the copies
        // parked on top of the originals are removed again.
        if (!didDrag) {
          dupIds.forEach((id) => onUpdateClip(id, { _delete: true }));
        }
      } else if (didDrag) {
        const finalHit = probeParentTarget(upEvent.clientX, upEvent.clientY, moveIds, clip.id);
        if (finalHit && finalHit.kind === 'parent') {
          const parentEntity = allClips.find((c) => c.id === finalHit.id);
          const newParentId = finalHit.id;
          // Lane-row drop onto a SIBLING's lane space = REARRANGE the
          // nested sub-tracks (move this child to that sibling's lane
          // position). Card drops keep parenting semantics.
          const isSiblingLane =
            finalHit.viaLane &&
            !isAltDuplicate &&
            !isSelectedMulti &&
            clip.parentId &&
            parentEntity &&
            parentEntity.parentId === clip.parentId &&
            newParentId !== clip.id;
          if (isSiblingLane && onReorderChild) {
            const siblings = sortChildrenOf(allClips, clip.parentId);
            const toIdx = siblings.findIndex((s) => s.id === newParentId);
            if (toIdx >= 0) onReorderChild(clip.parentId, clip.id, toIdx);
          } else if (newParentId !== clip.parentId && onReparentEntity) {
            onReparentEntity(clip.id, newParentId);
          }
        } else if (finalHit && finalHit.kind === 'root') {
          const dropTrackId = finalHit.trackId || clip.trackId;
          if (dropTrackId !== clip.trackId) {
            onUpdateClip(clip.id, { trackId: dropTrackId });
          }
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
      if (clip.parentId) {
        const parentClip = allClips.find((c) => c.id === clip.parentId);
        if (parentClip) {
          newStartTime = Math.max(newStartTime, parentClip.startTime);
        }
      }

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

      if (clip.parentId) {
        const parentClip = allClips.find((c) => c.id === clip.parentId);
        if (parentClip) {
          const maxDur = Math.max(0.2, parentClip.startTime + parentClip.duration - origStartTime);
          rawNewDuration = Math.min(rawNewDuration, maxDur);
        }
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

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Ensure this clip is selected
    if (!isSelectedCard && !isSelectedMulti) {
      onSelectClip(clip.id);
    }

    const existing = document.querySelector('.clip-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'clip-context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const activeTargetIds = isSelectedMulti ? selectedIds : [clip.id];

    // Add Child Clip — spawn an empty child lane under the clip (nested
    // sub-track: a new lane appears in its expanded sub-area).
    if (onAddChildClip && !isLocked) {
      const addChildBtn = document.createElement('button');
      addChildBtn.textContent = '➕ Add Child Clip';
      addChildBtn.className = 'ctx-menu-item';
      addChildBtn.onclick = () => {
        activeTargetIds.forEach((id) => {
          const target = allClips.find((c) => c.id === id);
          if (target) onAddChildClip(target);
        });
        menu.remove();
      };
      menu.appendChild(addChildBtn);
    }

    // Duplicate button
    if (onDuplicateClips && !isLocked) {
      const dupBtn = document.createElement('button');
      dupBtn.textContent = '📄 Duplicate';
      dupBtn.className = 'ctx-menu-item';
      dupBtn.onclick = () => {
        const newIds = onDuplicateClips(activeTargetIds);
        if (newIds && newIds.length > 0 && onSelectClip) onSelectClip(newIds[0]);
        menu.remove();
      };
      menu.appendChild(dupBtn);
    }

    // Group button (when 2 or more clips are selected)
    if (activeTargetIds.length >= 2 && onGroupClips && !isLocked) {
      const groupBtn = document.createElement('button');
      groupBtn.textContent = '🔗 Group (Ctrl+G)';
      groupBtn.className = 'ctx-menu-item';
      groupBtn.onclick = () => {
        onGroupClips(activeTargetIds);
        menu.remove();
      };
      menu.appendChild(groupBtn);
    }

    // Ungroup button (when any target clip is grouped)
    const anyGrouped = activeTargetIds.some((id) => allClips.find((c) => c.id === id)?.linkGroupId);
    if (anyGrouped && onUngroupClips && !isLocked) {
      const ungroupBtn = document.createElement('button');
      ungroupBtn.textContent = '🔓 Ungroup (Ctrl+Shift+G)';
      ungroupBtn.className = 'ctx-menu-item';
      ungroupBtn.onclick = () => {
        onUngroupClips(activeTargetIds);
        menu.remove();
      };
      menu.appendChild(ungroupBtn);
    }

    // Detach from Parent
    if (clip.parentId && onReparentEntity && !isLocked) {
      const parentClip = allClips.find((c) => c.id === clip.parentId);
      const unparentBtn = document.createElement('button');
      unparentBtn.textContent = `⛓ Detach from ${parentClip?.name || 'Parent'}`;
      unparentBtn.className = 'ctx-menu-item';
      unparentBtn.onclick = () => {
        onReparentEntity(clip.id, null);
        menu.remove();
      };
      menu.appendChild(unparentBtn);
    }

    if (!isLocked) {
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '🗑 Delete';
      deleteBtn.className = 'ctx-menu-item danger';
      deleteBtn.onclick = () => {
        onSelectClip(null);
        // Delete this clip, its whole child subtree, and its linked clips /
        // selected clips (hierarchy-aware via the _delete store path).
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
      data-clip-id={clip.id}
      className={`timeline-clip-card ${clipCategory} ${isSelectedCard || isSelectedMulti ? 'selected' : ''} ${isLinked ? 'linked' : ''} ${isLocked ? 'is-locked' : ''} ${compact ? 'compact' : ''} ${isScriptDragOver ? 'script-drop-target' : ''} ${!isLocked && onAddChildClip && widthPx > 34 ? 'has-child-chip' : ''}`}
      style={{
        left: `${leftPx}px`,
        width: `${widthPx}px`,
      }}
      onPointerDown={handleBodyPointerDown}
      onContextMenu={handleContextMenu}
      onDragOver={handleScriptDragOver}
      onDragLeave={() => setIsScriptDragOver(false)}
      onDrop={handleScriptDrop}
      title={`${clip.name} (${clip.duration.toFixed(1)}s)${clip.parentId ? ' 🔗 Child' : ''}${hasOutOfWindow ? ' ⚠ part is outside parent window' : ''}${isLinked ? ' 🔗 Linked' : ''}${isLocked ? ' 🔒 Locked' : ''}`}
    >
      {/* Left Trim Handle */}
      {!isLocked && (
        <div
          className="clip-trim-handle left"
          onPointerDown={handleLeftTrimPointerDown}
          title="Trim Left (In-Point)"
        />
      )}

      {/* Overflow markers: the piece of this child clip that pokes outside
          its parent's box is faded + dashed; the in-box part is untouched. */}
      {hasOutOfWindow && (
        <>
          {leftOverhangSec > 0.01 && (
            <div
              className="clip-outside-window"
              style={{ left: 0, width: `${Math.min(widthPx, leftOverhangSec * pixelsPerSecond)}px` }}
            />
          )}
          {rightOverhangSec > 0.01 && (
            <div
              className="clip-outside-window"
              style={{ right: 0, width: `${Math.min(widthPx, rightOverhangSec * pixelsPerSecond)}px` }}
            />
          )}
        </>
      )}

      {/* Add Child Clip chip — every clip can host its own nested sub-track
          of children ("more tracks inside this track"). Stops pointer
          propagation so it never starts a drag / trim. */}
      {!isLocked && onAddChildClip && widthPx > 34 && (
        <button
          className={`add-child-chip ${hasVideo ? 'video' : hasAudio ? 'audio' : hasShape ? 'shape' : 'text'}`}
          title="Add child clip (creates a nested sub-track lane)"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (e.detail > 1) return; // a double-click is one child, not two
            onAddChildClip(clip);
          }}
        >
          <Plus size={9} />
        </button>
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
          
          {parentOfClip && (
            <span className="clip-parent-badge" title={`Parent: ${parentOfClip.name}`}>
              ↳ {parentOfClip.name}
            </span>
          )}

          {isLinked && (
            <span className="clip-group-badge" title="Grouped / Linked">
              🔗
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
  );
});
