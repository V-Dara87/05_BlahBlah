import { memo, useMemo, useRef, useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { ContextMenu } from '../shared/ContextMenu';
import { getTransitionClipComponent } from '../../engine/ecs';
import { getTransitionPreset } from '../../engine/glTransitions';
import {
  findTransitionNeighbours,
  maxTransitionDuration,
  resizeTransitionAboutCut,
  snapTransitionToCut,
  buildMediaDurationsFromAssets,
  TRANSITION_MIN_DURATION,
} from '../../engine/renderPipeline';
import './transition-clip-item.css';

/**
 * TransitionClipItem — the timeline block for a TransitionClip.
 *
 * A transition is not an ordinary clip: it sits CENTRED on the cut between two
 * back-to-back clips, so it overlaps both of them by design. That is why it
 * has its own component instead of being another branch of ClipItem:
 *
 *   - It is drawn as an overlay on the full row height (TrackLane excludes it
 *     from sub-lane packing, see utils/timelineLayout.js getPackableClips, so
 *     the two clips it blends are not squeezed to half height).
 *   - MOVING it snaps its centre to the nearest cut on the track under the
 *     pointer (engine/renderPipeline.js snapTransitionToCut), because a
 *     transition anywhere else would not resolve to a neighbour pair.
 *   - Dragging either EDGE resizes it symmetrically about the cut
 *     (resizeTransitionAboutCut): the resolver derives the cut as
 *     start + duration / 2, so the centre must never move on a resize. The
 *     length is clamped to the spare footage on both sides
 *     (maxTransitionDuration).
 *   - It cannot be split, duplicated, copied or given a parent — none of that
 *     means anything for something defined by a cut — so its context menu is
 *     just Delete.
 *
 * All the geometry lives in renderPipeline.js as pure functions (checked with
 * Node scripts); this component only turns pointer events into calls to them
 * and pushes the result through onUpdateClip, which coalesces a whole drag
 * into one undo step.
 */
export const TransitionClipItem = memo(function TransitionClipItem({
  clip,
  allClips = [],
  tracks = [],
  mediaAssets = [],
  isLocked = false,
  pixelsPerSecond,
  selectedClipId,
  selectedIds = [],
  rowHeight,
  onSelectClip,
  onToggleSelect,
  onRangeSelect,
  onUpdateClip,
  onDeleteClip,
}) {
  const draggingRef = useRef(false);
  const [ctxMenu, setCtxMenu] = useState(null);

  const leftPx = clip.startTime * pixelsPerSecond;
  const widthPx = Math.max(12, clip.duration * pixelsPerSecond);
  const cardHeight = rowHeight ? Math.max(24, rowHeight - 10) : 54;

  const comp = getTransitionClipComponent(clip);
  const presetId = comp?.preset || 'crossfade';
  const presetLabel = useMemo(() => getTransitionPreset(presetId)?.name || presetId, [presetId]);

  const isSelected = selectedClipId === clip.id || selectedIds.includes(clip.id);

  // Does this transition still sit on a real cut? Editing the clips around it
  // (moving one away, trimming it) can leave it orphaned; export refuses to
  // blend an orphan, so the block says so instead of looking healthy.
  const neighbours = useMemo(() => findTransitionNeighbours(clip, allClips), [clip, allClips]);
  const isOrphan = !neighbours.a || !neighbours.b;

  // Edit-time stand-in for the export loader's per-file durations.
  const mediaDurations = useMemo(
    () => buildMediaDurationsFromAssets(allClips, mediaAssets),
    [allClips, mediaAssets],
  );

  const handleBodyPointerDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    if (e.shiftKey && onRangeSelect) {
      onRangeSelect(clip.id);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      onToggleSelect?.(clip.id);
      return;
    }
    onSelectClip?.(clip.id);
    if (isLocked) return;

    draggingRef.current = true;
    const startX = e.clientX;
    const origStart = clip.startTime;
    const origDuration = clip.duration;
    let moved = false;

    const handlePointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return; // a click, not a drag
      moved = true;

      // Track under the pointer decides which cuts are candidates.
      let trackId = clip.trackId;
      for (const el of document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY)) {
        const trackEl = el.closest && el.closest('[data-track-id]');
        if (trackEl) {
          const detected = trackEl.getAttribute('data-track-id');
          const t = tracks.find((tr) => tr.id === detected);
          if (t && !t.locked) trackId = detected;
          break;
        }
      }

      const rawCentre = origStart + origDuration / 2 + dx / pixelsPerSecond;
      const snapped = snapTransitionToCut({
        entities: allClips.filter((c) => c.id !== clip.id),
        trackId,
        rawCentreTime: rawCentre,
        duration: origDuration,
        mediaDurations,
      });
      // No cut on that track: leave the clip exactly where it is rather than
      // dropping it somewhere it would resolve to nothing.
      if (!snapped) return;
      onUpdateClip(clip.id, {
        trackId,
        startTime: snapped.startTime,
        duration: snapped.duration,
      });
    };

    const handlePointerUp = () => {
      draggingRef.current = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const makeEdgePointerDown = (edge) => (e) => {
    if (e.button !== 0 || isLocked) return;
    e.stopPropagation();
    onSelectClip?.(clip.id);

    draggingRef.current = true;
    const origStart = clip.startTime;
    const origDuration = clip.duration;
    const startX = e.clientX;
    const edgeStartTime = edge === 'start' ? origStart : origStart + origDuration;
    // The ceiling is fixed for the whole gesture: the neighbours are the ones
    // that were there when the drag began (this clip's own geometry changing
    // must not move the goalposts mid-drag).
    const { a, b } = findTransitionNeighbours(clip, allClips);
    const ceiling = a && b ? maxTransitionDuration(a, b, mediaDurations) : Infinity;

    const handlePointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const { startTime, duration } = resizeTransitionAboutCut({
        edge,
        origStart,
        origDuration,
        rawEdgeTime: edgeStartTime + dx / pixelsPerSecond,
        maxDuration: ceiling,
      });
      onUpdateClip(clip.id, { startTime, duration });
    };
    const handlePointerUp = () => {
      draggingRef.current = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectClip?.(clip.id);
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const closeCtxMenu = () => setCtxMenu(null);
  const handleDelete = () => {
    closeCtxMenu();
    onDeleteClip?.(clip.id);
  };

  const title = isOrphan
    ? `${clip.name} — not on a cut between two clips, so it will not render. Move it onto a cut or delete it.`
    : `${clip.name}: ${presetLabel} (${clip.duration.toFixed(2)}s)`;

  return (
    <>
      <div
        data-clip-id={clip.id}
        className={`timeline-transition-card ${isSelected ? 'selected' : ''} ${isLocked ? 'is-locked' : ''} ${isOrphan ? 'is-orphan' : ''}`}
        style={{
          left: `${leftPx}px`,
          width: `${widthPx}px`,
          height: `${cardHeight}px`,
        }}
        onPointerDown={handleBodyPointerDown}
        onContextMenu={handleContextMenu}
        title={title}
      >
        {!isLocked && (
          <div
            className="transition-edge-handle left"
            onPointerDown={makeEdgePointerDown('start')}
            title={`Resize (min ${TRANSITION_MIN_DURATION}s, limited by spare footage)`}
          />
        )}

        <div className="transition-card-body">
          {/* Centre tick: the cut itself. Everything is symmetric about it. */}
          <div className="transition-cut-marker" />
          {widthPx > 46 && (
            <span className="transition-card-label">
              {isOrphan && <AlertTriangle size={10} className="transition-orphan-icon" />}
              {presetLabel}
            </span>
          )}
        </div>

        {!isLocked && (
          <div
            className="transition-edge-handle right"
            onPointerDown={makeEdgePointerDown('end')}
            title={`Resize (min ${TRANSITION_MIN_DURATION}s, limited by spare footage)`}
          />
        )}
      </div>

      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={closeCtxMenu} className="clip-context-menu" minWidth={160}>
          <button className="ctx-menu-item ctx-menu-row" onClick={handleDelete} disabled={isLocked || !onDeleteClip}>
            <span className="ctx-menu-label"><Trash2 size={12} /> Delete Transition</span>
            <span className="ctx-menu-hint">Del</span>
          </button>
        </ContextMenu>
      )}
    </>
  );
});