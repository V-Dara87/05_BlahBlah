import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings } from 'lucide-react';
import { usePlaybackStore } from '../../hooks/PlaybackContext';
import { useTimelineView } from '../../dock/TimelineViewContext';
import { centerTimelineViewOnPlayhead } from '../../services/timelineViewControls';
import { getPieAction, PIE_PANEL_TITLES } from '../../services/pieActions';
import {
  PIE_SETTINGS_EVENT, PIE_SLOT_COUNT, PIE_START_ANGLE,
  loadPieSettings, formatHotkey, matchesHotkey, sliceIndexForPoint,
} from '../../services/pieMenuSettings';
import './pie-menu.css';

// ---- Geometry (wheel pixels; the wheel is a fixed SIZE box) ----------------
const SIZE = 420;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_OUT = 200;
const R_IN = 74;
const R_LABEL = (R_OUT + R_IN) / 2;
const HUB_DEAD_ZONE = 52;
// How far beyond the rim a flick still counts as a pick. Further out cancels.
const RIM_SLACK = 40;
const SLICE_STEP = 360 / PIE_SLOT_COUNT;
const GAP_DEG = 1.1;

const polar = (angleDeg, radius) => {
  const a = (angleDeg * Math.PI) / 180;
  return [CX + Math.cos(a) * radius, CY + Math.sin(a) * radius];
};

// A donut wedge between two angles, drawn as the slice's shape.
function wedgePath(a0, a1) {
  const start = a0 + GAP_DEG;
  const end = a1 - GAP_DEG;
  const [x0, y0] = polar(start, R_OUT);
  const [x1, y1] = polar(end, R_OUT);
  const [x2, y2] = polar(end, R_IN);
  const [x3, y3] = polar(start, R_IN);
  return [
    `M ${x0} ${y0}`,
    `A ${R_OUT} ${R_OUT} 0 0 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${R_IN} ${R_IN} 0 0 0 ${x3} ${y3}`,
    'Z',
  ].join(' ');
}

const clampCenter = (v, viewport) => {
  const half = SIZE / 2 + 4;
  return Math.min(Math.max(v, half), Math.max(half, viewport - half));
};

const isTypingTarget = (el) => !!(el && el.closest &&
  el.closest('input, textarea, select, [contenteditable="true"], .monaco-editor'));

// Any modal dialog open? Tab/Esc then belong to the dialog, not the wheel.
const isModalOpen = () => !!document.querySelector('.modal-overlay, .modal-backdrop, .pkg-modal-backdrop');

/**
 * Blender-style radial menu. The shortcut (Tab by default) drops a wheel at
 * the cursor; hovering picks a slice; it runs on release / click / hover
 * depending on the chosen mode. Esc cancels. Shortcut, mode and slices are
 * saved app-wide and edited in Settings -> Radial Menu.
 *
 * Mounted once in App.jsx, inside PlaybackProvider and TimelineViewProvider
 * (it needs both). App passes in the same handlers EditorPlaybackShortcuts
 * gets, plus a few app-level openers; `buildRunners` below maps each action id
 * from services/pieActions.js to what it actually does right now.
 */
export function PieMenu({
  selectedEntityId,
  selectedIds = [],
  canUndo,
  canRedo,
  exportRange,
  totalDuration,
  onSetExportRange,
  onSaveProject,
  onUndo,
  onRedo,
  onSplitSelected,
  onDeleteSelected,
  onDeleteMultiple,
  onRippleDeleteBefore,
  onRippleDeleteAfter,
  onDuplicateSelected,
  onCopySelected,
  onCutSelected,
  onPasteClips,
  onSelectAll,
  onClearSelection,
  onToggleSnapping,
  onAddTransition,
  onCutSilence,
  onNewProject,
  onOpenProject,
  onOpenExport,
  onOpenProjectJson,
  onOpenPackageManager,
  onOpenSettings,
  openOrFocusPanel,
}) {
  const store = usePlaybackStore();
  const { zoomIn, zoomOut } = useTimelineView();

  // Live settings: re-read whenever Settings -> Radial Menu saves a change.
  const [settings, setSettings] = useState(() => loadPieSettings());
  useEffect(() => {
    const onChanged = (e) => setSettings(e.detail || loadPieSettings());
    window.addEventListener(PIE_SETTINGS_EVENT, onChanged);
    return () => window.removeEventListener(PIE_SETTINGS_EVENT, onChanged);
  }, []);
  const { enabled, hotkey, mode, slots } = settings;
  const keyLabel = useMemo(() => formatHotkey(hotkey), [hotkey]);

  const hasSelection = selectedIds.length > 0 || !!selectedEntityId;
  const hasSingleAnchor = selectedIds.length <= 1 && !!selectedEntityId;

  // id -> { run, disabled }. Rebuilt when any handler or selection changes, so
  // a slice always acts on the current state.
  const runners = useMemo(() => {
    const runner = (run, disabled = false) => ({ run, disabled });
    const seekBy = (delta) => () => store.seek(store.getCurrentTime() + delta);
    const panel = (id) => runner(() => openOrFocusPanel?.(id, PIE_PANEL_TITLES[id]), !openOrFocusPanel);

    return {
      // Playback
      togglePlay: runner(() => store.togglePlay()),
      seekBack: runner(seekBy(-1 / 30)),
      seekForward: runner(seekBy(1 / 30)),
      jumpToStart: runner(() => store.seek(0)),
      jumpToEnd: runner(() => store.seek(totalDuration), !(totalDuration > 0)),

      // Timeline editing
      splitSelected: runner(() => onSplitSelected?.(), !hasSelection),
      deleteSelected: runner(
        () => (selectedIds.length > 1 ? onDeleteMultiple?.() : onDeleteSelected?.()),
        !hasSelection,
      ),
      rippleDeleteBefore: runner(() => onRippleDeleteBefore?.(selectedEntityId), !hasSingleAnchor),
      rippleDeleteAfter: runner(() => onRippleDeleteAfter?.(selectedEntityId), !hasSingleAnchor),
      cutSilence: runner(() => onCutSilence?.(selectedEntityId), !selectedEntityId),
      addTransition: runner(() => onAddTransition?.()),
      toggleSnapping: runner(() => onToggleSnapping?.()),
      zoomIn: runner(() => zoomIn()),
      zoomOut: runner(() => zoomOut()),
      centerOnPlayhead: runner(() => centerTimelineViewOnPlayhead()),
      setInPoint: runner(() => {
        const t = store.getCurrentTime();
        const out = exportRange?.out ?? totalDuration;
        const finalOut = t >= out ? Math.max(t + 1, totalDuration) : out;
        onSetExportRange?.({ in: t, out: finalOut });
      }, !onSetExportRange),
      setOutPoint: runner(() => {
        const t = store.getCurrentTime();
        const inp = exportRange?.in ?? 0;
        const finalIn = t <= inp ? Math.max(0, t - 1) : inp;
        onSetExportRange?.({ in: finalIn, out: t });
      }, !onSetExportRange),

      // Selection / clipboard
      selectAll: runner(() => onSelectAll?.()),
      clearSelection: runner(() => onClearSelection?.(), !hasSelection),
      duplicateSelected: runner(() => onDuplicateSelected?.(), !hasSelection),
      copySelected: runner(() => onCopySelected?.(), !hasSelection),
      cutSelected: runner(() => onCutSelected?.(), !hasSelection),
      pasteClips: runner(() => onPasteClips?.()),

      // Project
      saveProject: runner(() => onSaveProject?.()),
      undo: runner(() => onUndo?.(), !canUndo),
      redo: runner(() => onRedo?.(), !canRedo),
      newProject: runner(() => onNewProject?.()),
      openProject: runner(() => onOpenProject?.()),
      exportRender: runner(() => onOpenExport?.()),
      projectCode: runner(() => onOpenProjectJson?.()),
      packageManager: runner(() => onOpenPackageManager?.('all')),
      openSettings: runner(() => onOpenSettings?.()),

      // Windows
      'panel-inspector': panel('inspector'),
      'panel-preview': panel('preview'),
      'panel-project': panel('project'),
      'panel-timeline': panel('timeline'),
      'panel-dopesheet': panel('dopesheet'),
      'panel-curveEditor': panel('curveEditor'),
      'panel-silenceRemover': panel('silenceRemover'),
      'panel-mixer': panel('mixer'),
      'panel-console': panel('console'),
    };
  }, [
    store, zoomIn, zoomOut, totalDuration, exportRange, selectedEntityId, selectedIds,
    hasSelection, hasSingleAnchor, canUndo, canRedo, openOrFocusPanel,
    onSetExportRange, onSaveProject, onUndo, onRedo, onSplitSelected, onDeleteSelected,
    onDeleteMultiple, onRippleDeleteBefore, onRippleDeleteAfter, onDuplicateSelected,
    onCopySelected, onCutSelected, onPasteClips, onSelectAll, onClearSelection,
    onToggleSnapping, onAddTransition, onCutSilence, onNewProject, onOpenProject,
    onOpenExport, onOpenProjectJson, onOpenPackageManager, onOpenSettings,
  ]);

  // Resolve saved slot ids to drawable slices. A saved id whose action no
  // longer exists shows as an unavailable slice instead of breaking the wheel.
  const slices = useMemo(() => slots.map((id) => {
    if (!id) return null;
    const meta = getPieAction(id);
    const live = runners[id];
    if (!meta || !live) {
      return {
        id,
        label: 'Unavailable action',
        short: id,
        hint: 'This action no longer exists. Pick another one in Settings > Radial Menu.',
        icon: Settings,
        run: null,
        disabled: true,
      };
    }
    return { ...meta, run: live.run, disabled: live.disabled };
  }), [slots, runners]);

  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const returnFocusRef = useRef(null);
  // True when the wheel was opened with the shortcut, so releasing it over a
  // slice acts as a confirm (a flick).
  const openedByKeyRef = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    setActive(null);
  }, []);

  const openAt = useCallback((x, y, viaKey) => {
    openedByKeyRef.current = !!viaKey;
    returnFocusRef.current = document.activeElement;
    setAt({
      x: clampCenter(x, window.innerWidth),
      y: clampCenter(y, window.innerHeight),
    });
    setActive(null);
    setOpen(true);
  }, []);

  const run = useCallback((index) => {
    const slice = slices[index];
    if (!slice || slice.disabled || !slice.run) return false;
    setOpen(false);
    setActive(null);
    // Let the overlay unmount first so dialogs the action opens are not
    // covered by it, and so focus is handed back before the action runs.
    setTimeout(() => {
      try {
        const result = slice.run();
        if (result && typeof result.catch === 'function') {
          result.catch((e) => console.error('[pie] action failed:', e));
        }
      } catch (e) {
        console.error('[pie] action failed:', e);
      }
    }, 0);
    return true;
  }, [slices]);

  // Remember where the cursor is so the wheel opens under it.
  useEffect(() => {
    pointerRef.current = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const onMove = (e) => { pointerRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    return () => window.removeEventListener('pointermove', onMove, true);
  }, []);

  // Close if the window loses focus (Alt+Tab and friends) or the feature is
  // switched off while the wheel is up.
  useEffect(() => {
    if (!open) return undefined;
    const onBlur = () => close();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [open, close]);

  useEffect(() => {
    if (!enabled && open) close();
  }, [enabled, open, close]);

  // Keyboard. Capture phase, so while the wheel is up it can swallow keys
  // BEFORE EditorPlaybackShortcuts sees them (otherwise Space would play,
  // arrows would seek, Esc would deselect, Delete would delete behind it).
  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (e) => {
      const isTrigger = matchesHotkey(e, hotkey);

      if (!open) {
        if (!isTrigger) return;
        // The key keeps its normal job in text fields and dialogs.
        if (isTypingTarget(e.target) || isModalOpen()) return;
        // Prevent on auto-repeat too: holding Tab/F5 must not walk focus
        // around the UI while the wheel opens.
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        openAt(pointerRef.current.x, pointerRef.current.y, true);
        return;
      }

      // The wheel is modal: no key reaches the editor behind it.
      e.preventDefault();
      e.stopPropagation();

      if (isTrigger || e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;

      if (e.key === 'Escape') {
        close();
      } else if (e.key === 'Enter') {
        if (active != null) run(active);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setActive((i) => (i == null ? 0 : (i + 1) % PIE_SLOT_COUNT));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setActive((i) => (i == null ? PIE_SLOT_COUNT - 1 : (i - 1 + PIE_SLOT_COUNT) % PIE_SLOT_COUNT));
      } else if (/^[1-8]$/.test(e.key)) {
        run(Number(e.key) - 1);
      }
    };

    // Hold-to-show (release mode): the wheel exists only while the shortcut is
    // held. Letting go runs the slice under the cursor; letting go without one
    // closes the wheel. 'click' ignores the release; 'hover' already ran.
    const onKeyUp = (e) => {
      if (!open) return;
      if (String(e.key || '').toLowerCase() === hotkey.key) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (mode !== 'release' || !openedByKeyRef.current) return;
      if (String(e.key || '').toLowerCase() !== hotkey.key) return;
      if (active == null || !run(active)) close();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [enabled, open, active, run, close, openAt, hotkey, mode]);

  // Give focus back to wherever it was.
  useEffect(() => {
    if (open) return;
    const previous = returnFocusRef.current;
    returnFocusRef.current = null;
    previous?.focus?.();
  }, [open]);

  if (!enabled || !open) return null;

  // Pick by direction, like Blender: the slice under the cursor is the one the
  // cursor points at, not whichever SVG shape happens to be on top.
  const onPointerMove = (e) => {
    const dx = e.clientX - at.x;
    const dy = e.clientY - at.y;
    if (Math.hypot(dx, dy) > R_OUT + RIM_SLACK) {
      setActive(null);
      return;
    }
    const index = sliceIndexForPoint(dx, dy, slices.length, HUB_DEAD_ZONE);
    setActive(index);
    // Hover mode: entering a new slice runs it straight away. Disabled or
    // empty slices do nothing, so the wheel stays open and you can keep moving.
    if (mode === 'hover' && index != null && index !== active) run(index);
  };

  // One click handler for the whole wheel: run the highlighted slice, or
  // cancel when the cursor is in the hub / beyond the rim.
  const onClick = () => {
    if (active != null) run(active);
    else close();
  };

  const activeSlice = active != null ? slices[active] : null;
  const hubLabel = active == null
    ? 'Radial menu'
    : activeSlice ? (activeSlice.short || activeSlice.label) : 'Empty slice';
  const hubHint = active == null
    ? keyLabel
    : !activeSlice
      ? 'Pick an action in Settings > Radial Menu'
      : activeSlice.disabled
        ? 'Not available right now'
        : (activeSlice.hint || 'Click to run');

  return createPortal(
    <div
      className="pie-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Radial menu"
      onPointerMove={onPointerMove}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); close(); }}
    >
      <div
        className="pie-wheel"
        style={{ left: at.x - SIZE / 2, top: at.y - SIZE / 2, width: SIZE, height: SIZE }}
      >
        <svg
          className="pie-svg"
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          aria-hidden="true"
        >
          {slices.map((slice, i) => {
            const a0 = PIE_START_ANGLE + i * SLICE_STEP;
            const classes = [
              'pie-slice',
              !slice ? 'is-empty' : '',
              slice && slice.disabled ? 'is-disabled' : '',
              active === i ? 'is-active' : '',
            ].filter(Boolean).join(' ');
            return <path key={i} d={wedgePath(a0, a0 + SLICE_STEP)} className={classes} />;
          })}
        </svg>

        <div className="pie-hub">
          <span className="pie-hub-label">{hubLabel}</span>
          <span className="pie-hub-hint">{hubHint}</span>
        </div>

        {slices.map((slice, i) => {
          if (!slice) return null;
          const mid = PIE_START_ANGLE + (i + 0.5) * SLICE_STEP;
          const [x, y] = polar(mid, R_LABEL);
          const Icon = slice.icon || Settings;
          const classes = [
            'pie-label',
            active === i ? 'is-active' : '',
            slice.disabled ? 'is-disabled' : '',
          ].filter(Boolean).join(' ');
          return (
            <span key={i} className={classes} style={{ left: x, top: y }}>
              <Icon size={15} />
              <span className="pie-label-text">{slice.short || slice.label}</span>
            </span>
          );
        })}
      </div>

      <div className="pie-foot">
        {mode === 'hover'
          ? <span><kbd>move</kbd> run</span>
          : mode === 'release'
            ? <span><kbd>release</kbd> run or close</span>
            : <span><kbd>click</kbd> run</span>}
        <span><kbd>1</kbd>-<kbd>8</kbd> pick</span>
        <span><kbd>esc</kbd> cancel</span>
      </div>
    </div>,
    document.body
  );
}