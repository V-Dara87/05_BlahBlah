 
import { useRef, useState, useMemo, useCallback, useEffect, memo } from 'react';
import './dopesheet.css';
import {
  ChevronDown, ChevronRight, Sliders, Type, Square, FileCode,
  ArrowRightToLine, Move, SlidersHorizontal, Repeat, Filter,
  ChevronsLeft, ChevronsRight, SkipBack, SkipForward, ZoomIn, ZoomOut, Spline,
  Undo2, Redo2, Scissors, Trash2, Copy, Magnet,
} from 'lucide-react';
import { TRANSFORM_FIELD_GROUPS } from '../inspector/InspectorField';
import { extractScriptProps, detectScriptKind } from '../../engine/scriptRunner';
import {
  trackKeyFor, getFieldKeyframes, setKeyframe, removeKeyframe, moveKeyframe,
} from '../../engine/keyframes';
import { formatTimecode } from '../../utils/timeFormat';
import { useEditorContext } from '../../dock/EditorContext';
import { isScriptComponent } from '../../engine/ecs';
import { loadKeybindSettings } from '../../services/keybindSettings';
 
/**
 * Dopesheet — GUI keyframing panel (roadmap P1 #6).
 *
 * Every row on this panel is sourced from the exact same field schema the
 * Inspector already renders (TRANSFORM_FIELD_GROUPS for Transform,
 * extractScriptProps for ReactRenderer / CanvasRenderer / ScriptComponent),
 * so any parameter exposed in the Inspector automatically gets a Dopesheet
 * row — nothing here hand-lists a field name. Adding a new `static props`
 * entry to a script, or a new field to TRANSFORM_FIELD_GROUPS, is
 * immediately keyframeable with no Dopesheet changes required.
 *
 * Layout mirrors Spine 2D's Dopesheet: teal group-header rows (one per
 * component instance) containing indented field rows (one per exposed
 * parameter), a top toolbar with Shift/Offset/Adjust tools plus
 * Current/Loop Start/End fields, and a cyan scrub playhead shared between
 * the ruler and the lanes.
 */
 
const GROUP_ICONS = {
  Transform: Move,
  ScriptComponent: FileCode,
  MonoBehaviour: FileCode,
  TextRenderer: Type,
  ShapeRenderer: Square,
};
 
const PIXELS_PER_SECOND = 60;
const MIN_PPS = 15;
const MAX_PPS = 240;
 
function fieldSchemaForComponent(component, scripts) {
  if (component.type === 'Transform') {
    return TRANSFORM_FIELD_GROUPS.flatMap((g) => g.fields);
  }
  if (isScriptComponent(component)) {
    const scriptDef = scripts.find((s) => s.id === component.scriptId);
    if (!scriptDef) return [];
    return extractScriptProps(scriptDef.code);
  }
  return [];
}
 
function groupLabel(component, scripts) {
  if (component.type === 'Transform') return 'Transform';
  if (component.scriptId) {
    const scriptDef = scripts.find((s) => s.id === component.scriptId);
    return component.scriptName || scriptDef?.name || component.type;
  }
  return component.type;
}
 
export const Dopesheet = memo(function Dopesheet({
  selectedEntity,
  scripts = [],
  currentTime,
  totalDuration,
  loopStart,
  loopEnd,
  onSeek,
  onUpdateEntity,
  selectedKeyId: selectedKeyIdProp,
  onSelectedKeyChange,
  // Timeline-parity shortcuts — same actions EditorPlaybackShortcuts.jsx
  // wires globally, surfaced here too as toolbar buttons so the Dopesheet
  // doesn't require switching tabs back to Timeline to split/delete/undo
  // while keyframing. See DopesheetDockPanel in dock/panels.jsx for what
  // feeds these from EditorContext.
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSplitSelected,
  onDeleteSelected,
  onDuplicateSelected,
  onToggleSnapping,
  snappingEnabled,
}) {
  const { focusDockPanel } = useEditorContext();
 
  // Use shared state if provided, fall back to local state
  const [localSelectedKeyId, setLocalSelectedKeyId] = useState(null);
  const selectedKeyId = selectedKeyIdProp !== undefined ? selectedKeyIdProp : localSelectedKeyId;
  const setSelectedKeyId = onSelectedKeyChange || setLocalSelectedKeyId;
  const lanesScrollRef = useRef(null);
  const rulerRef = useRef(null);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(PIXELS_PER_SECOND);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  // Live keybind labels for the new toolbar buttons' tooltips — same
  // source of truth App.jsx's menu and EditorPlaybackShortcuts read from.
  // Read once on mount; a live rebind mid-session updating this tooltip
  // instantly isn't essential (menu bar already re-reads on the
  // 'blahblah:keybinds-changed' event if a user wants to check the
  // current binding there).
  const keybinds = useMemo(() => loadKeybindSettings(), []);
  const [shiftMode, setShiftMode] = useState(false);
  const [showOnlyKeyframed, setShowOnlyKeyframed] = useState(false);
  const [snapToKeyframe, setSnapToKeyframe] = useState(false);
 
  const localTime = selectedEntity ? Math.max(0, currentTime - selectedEntity.startTime) : 0;
  const clipDuration = selectedEntity?.duration ?? totalDuration;
  // View mode — 'entity' (default) shows only the selected clip's own
  // active window, exactly as before. 'timeline' shows the whole
  // project's duration instead, with the entity's active span drawn as
  // a highlighted band rather than clamping everything to it — useful
  // for lining keyframes up against other clips/events elsewhere on the
  // timeline while still editing this entity's own keyframes (which
  // stay in local clip-time in storage regardless of which view is
  // showing — see getFieldKeyframes/setKeyframe/moveKeyframe below,
  // none of that changes with viewMode).
  const [viewMode, setViewMode] = useState('entity');
  const isTimelineView = viewMode === 'timeline';
  // Offset ADDED to local clip-time before converting to on-screen x, and
  // the total span drawn. Entity mode: local time 0 already IS the left
  // edge, so offset 0 / span clipDuration (unchanged from before).
  // Timeline mode: the ruler now spans the whole project from absolute 0,
  // and a keyframe stored at local time t actually sits at absolute time
  // startTime + t — so local time 0 (entity start) must land at
  // x = startTime * pps, i.e. offset by +startTime — and the span is the
  // full project length.
  const viewOffset = isTimelineView ? (selectedEntity?.startTime ?? 0) : 0;
  const viewSpan = isTimelineView ? totalDuration : clipDuration;
 
  // handleDragKey / handleRulerScrub start a pointermove loop that runs for
  // many ticks against the SAME `selectedEntity` object captured when the
  // gesture began (closure). Each tick reads `entity.keyframes[...]` off
  // that snapshot before calling onUpdateEntity — but onUpdateEntity's
  // reducer already applied the *previous* tick's patch to the real store,
  // so re-deriving from the stale snapshot silently drops or overwrites
  // whatever changed in between. This ref always holds the latest prop, so
  // in-flight drag loops can read live data instead of a first-tick freeze.
  const selectedEntityRef = useRef(selectedEntity);
  useEffect(() => {
    selectedEntityRef.current = selectedEntity;
  }, [selectedEntity]);
 
  // Rows are derived fresh from the entity's live components every render —
  // this is what makes "every parameter exposed in the Inspector" true
  // without a separate registry: whatever the Inspector currently shows for
  // this entity IS the row list here, keyed identically (trackKeyFor).
  const groups = useMemo(() => {
    if (!selectedEntity) return [];
    return selectedEntity.components
      .filter((c) => c.type !== 'AudioSource' && c.type !== 'VideoRenderer')
      .map((component) => {
        const trackKey = trackKeyFor(component);
        let fields = fieldSchemaForComponent(component, scripts);
        
        // Filter to show only keyframed fields if the option is enabled
        if (showOnlyKeyframed) {
          fields = fields.filter((field) => {
            const kfs = getFieldKeyframes(selectedEntity, trackKey, field.name);
            return kfs.length > 0;
          });
        }
        
        return { trackKey, component, label: groupLabel(component, scripts), fields };
      })
      .filter((g) => g.fields.length > 0);
  }, [selectedEntity, scripts, showOnlyKeyframed]);
 
  const toggleGroup = (trackKey) => {
    setCollapsedGroups((prev) => ({ ...prev, [trackKey]: !prev[trackKey] }));
  };
 
  // Screen-space conversions apply viewOffset so keyframe positions shift
  // right by startTime in timeline view without changing how they're
  // stored (all keyframe times passed in/out here are still plain local
  // clip-time — see the header comment above for why that never changes).
  const timeToX = useCallback((t) => (t + viewOffset) * pixelsPerSecond, [pixelsPerSecond, viewOffset]);
  const xToTime = useCallback((x) => (x / pixelsPerSecond) - viewOffset, [pixelsPerSecond, viewOffset]);
  const snapToFrame = (t) => Math.round(t * 30) / 30; // 30fps snap, matches project default fps elsewhere in the engine
 
  // Get all keyframe times across all tracks for snapping
  const allKeyframeTimes = useMemo(() => {
    if (!selectedEntity) return [];
    const times = new Set();
    groups.forEach((group) => {
      group.fields.forEach((field) => {
        getFieldKeyframes(selectedEntity, group.trackKey, field.name).forEach((k) => {
          times.add(k.time);
        });
      });
    });
    return [...times].sort((a, b) => a - b);
  }, [selectedEntity, groups]);
 
  // Snap to nearest keyframe if enabled
  const snapToNearestKeyframe = (t) => {
    if (!snapToKeyframe || allKeyframeTimes.length === 0) return t;
    const nearest = allKeyframeTimes.reduce((prev, curr) => {
      return Math.abs(curr - t) < Math.abs(prev - t) ? curr : prev;
    });
    // Only snap if within reasonable distance (0.1 seconds)
    return Math.abs(nearest - t) < 0.1 ? nearest : t;
  };
 
  // Calculate tick interval based on zoom level for more detailed time indicators
  const tickInterval = useMemo(() => {
    if (pixelsPerSecond >= 200) return 0.1; // Show 0.1s intervals when very zoomed in
    if (pixelsPerSecond >= 120) return 0.25; // Show 0.25s intervals when zoomed in
    if (pixelsPerSecond >= 60) return 0.5; // Show 0.5s intervals
    if (pixelsPerSecond >= 30) return 1; // Show 1s intervals
    return 2; // Show 2s intervals when zoomed out
  }, [pixelsPerSecond]);
 
  const laneWidth = Math.max(viewSpan * pixelsPerSecond + 200, 600);
  const numTicks = Math.ceil(viewSpan / tickInterval) + 1;
  // Playhead x position — timeToX expects LOCAL clip-time (t + viewOffset,
  // where viewOffset is 0 in entity mode and -startTime in timeline mode;
  // see viewOffset above). localTime IS local clip-time already, so it's
  // correct as-is for entity mode, but for timeline mode we want the
  // playhead positioned by ABSOLUTE project time instead — feeding
  // localTime through the same viewOffset math there would double-count
  // the startTime subtraction. currentTime (absolute) fed through with
  // viewOffset=0 conceptually (i.e. just currentTime * pixelsPerSecond)
  // is what timeline mode actually wants, so compute it directly rather
  // than forcing it through timeToX's local-time contract.
  const playheadX = isTimelineView ? currentTime * pixelsPerSecond : timeToX(localTime);
 
  const handleRulerScrub = useCallback((e) => {
    if (!rulerRef.current || !selectedEntity) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const scrollLeft = lanesScrollRef.current?.scrollLeft || 0;
    const localX = e.clientX - rect.left + scrollLeft;
    // Clamp range depends on view mode: entity view clamps to the clip's
    // own [0, clipDuration] in LOCAL time (unchanged from before —
    // scrubbing past the lane's padded draw area, laneWidth's +200px of
    // dead space past the real clip end, used to let the playhead run
    // out past where the clip actually stops with nothing on screen
    // showing it had left valid range; the out-of-range overlay marks
    // that dead zone, this keeps the playhead out of it). Timeline view
    // clamps to the whole project's [0, totalDuration] in ABSOLUTE time
    // instead, since the ruler now represents the full timeline, not
    // just this one clip's span.
    if (isTimelineView) {
      let absT = Math.min(totalDuration, Math.max(0, snapToFrame(xToTime(localX))));
      onSeek(absT);
      const onMove = (moveEvent) => {
        const mx = moveEvent.clientX - rect.left + (lanesScrollRef.current?.scrollLeft || 0);
        let mAbsT = Math.min(totalDuration, Math.max(0, snapToFrame(xToTime(mx))));
        onSeek(mAbsT);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }
    let t = Math.min(clipDuration, snapToFrame(xToTime(localX)));
    t = snapToNearestKeyframe(t);
    onSeek(selectedEntity.startTime + t);
 
    const onMove = (moveEvent) => {
      const entity = selectedEntityRef.current;
      if (!entity) return;
      const mx = moveEvent.clientX - rect.left + (lanesScrollRef.current?.scrollLeft || 0);
      let mt = Math.min(clipDuration, snapToFrame(xToTime(mx)));
      mt = snapToNearestKeyframe(mt);
      onSeek(entity.startTime + mt);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [selectedEntity, xToTime, onSeek, snapToNearestKeyframe, clipDuration, isTimelineView, totalDuration]);
 
  const handleAddKeyAtPlayhead = (trackKey, fieldName, defaultVal) => {
    if (!selectedEntity) return;
    const comp = selectedEntity.components.find((c) => trackKeyFor(c) === trackKey);
    const isTransform = comp?.type === 'Transform';
    const currentVal = isTransform ? comp?.[fieldName] : comp?.props?.[fieldName];
    const value = currentVal !== undefined ? currentVal : defaultVal;
    const keyframes = setKeyframe(selectedEntity, trackKey, fieldName, snapToFrame(localTime), value);
    onUpdateEntity(selectedEntity.id, { keyframes });
  };
 
  const handleDeleteKey = (trackKey, fieldName, keyId) => {
    const keyframes = removeKeyframe(selectedEntity, trackKey, fieldName, keyId);
    onUpdateEntity(selectedEntity.id, { keyframes });
    setSelectedKeyId(null);
  };
 
  const handleDragKey = (trackKey, fieldName, keyId) => (e) => {
    e.stopPropagation();
    setSelectedKeyId(keyId);
    const rect = lanesScrollRef.current.getBoundingClientRect();
    const scrollLeft = lanesScrollRef.current.scrollLeft;
 
    const onMove = (moveEvent) => {
      const entity = selectedEntityRef.current;
      if (!entity) return;
      const t = Math.max(0, snapToFrame(xToTime(moveEvent.clientX - rect.left + scrollLeft)));
      const keyframes = moveKeyframe(entity, trackKey, fieldName, keyId, t);
      onUpdateEntity(entity.id, { keyframes });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
 
  // Keyframe navigation functions
  const goToFirstKeyframe = () => {
    if (allKeyframeTimes.length === 0) return;
    const firstTime = allKeyframeTimes[0];
    onSeek(selectedEntity.startTime + firstTime);
  };
 
  const goToLastKeyframe = () => {
    if (allKeyframeTimes.length === 0) return;
    const lastTime = allKeyframeTimes[allKeyframeTimes.length - 1];
    onSeek(selectedEntity.startTime + lastTime);
  };
 
  const goToPreviousKeyframe = () => {
    if (allKeyframeTimes.length === 0) return;
    const prevKey = allKeyframeTimes.filter((t) => t < localTime).pop();
    if (prevKey !== undefined) {
      onSeek(selectedEntity.startTime + prevKey);
    }
  };
 
  const goToNextKeyframe = () => {
    if (allKeyframeTimes.length === 0) return;
    const nextKey = allKeyframeTimes.find((t) => t > localTime);
    if (nextKey !== undefined) {
      onSeek(selectedEntity.startTime + nextKey);
    }
  };
 
  if (!selectedEntity) {
    return (
      <div className="dopesheet-panel">
        <div className="dopesheet-empty">
          <Sliders size={28} className="empty-icon" />
          <h4>Dopesheet</h4>
          <p>Select a clip to keyframe any of its exposed Inspector parameters — Transform, React/Canvas props, or Motion Script props.</p>
        </div>
      </div>
    );
  }
 
  return (
    <div className="dopesheet-panel">
      {/* Toolbar — mirrors Spine's Shift / Offset / Adjust + Current / Loop Start / End row */}
      <div className="dopesheet-toolbar">
        <div className="dopesheet-toolbar-group">
          <button
            className={`dopesheet-tool-btn ${shiftMode ? 'active' : ''}`}
            title="Shift selected keys in time"
            onClick={() => setShiftMode((v) => !v)}
          >
            <ArrowRightToLine size={12} />
            <span>Shift</span>
          </button>
          <button className="dopesheet-tool-btn" title="Offset keyframe values">
            <Move size={12} />
            <span>Offset</span>
          </button>
          <button className="dopesheet-tool-btn" title="Adjust keyframe curve">
            <SlidersHorizontal size={12} />
            <span>Adjust</span>
          </button>
          <button
            className={`dopesheet-tool-btn ${showOnlyKeyframed ? 'active' : ''}`}
            title="Show only keyframed parameters"
            onClick={() => setShowOnlyKeyframed((v) => !v)}
          >
            <Filter size={12} />
            <span>Keyframed Only</span>
          </button>
          <button
            className={`dopesheet-tool-btn ${snapToKeyframe ? 'active' : ''}`}
            title="Snap to keyframe when scrubbing timeline"
            onClick={() => setSnapToKeyframe((v) => !v)}
          >
            <SlidersHorizontal size={12} />
            <span>Snap</span>
          </button>
 
        </div>
 
        <div className="dopesheet-toolbar-divider" />
 
        {/* View range toggle — Entity (default) shows only this clip's own
            active window, clamped precisely to its start/end. Timeline
            shows the whole project instead, with this clip's active span
            drawn as a highlighted band so you can see keyframes relative
            to other clips/events on the timeline while still editing this
            entity's keyframes. */}
        <div className="dopesheet-toolbar-group">
          <button
            className={`dopesheet-tool-btn ${!isTimelineView ? 'active' : ''}`}
            title="Show only this clip's active window"
            onClick={() => setViewMode('entity')}
          >
            <span>Entity</span>
          </button>
          <button
            className={`dopesheet-tool-btn ${isTimelineView ? 'active' : ''}`}
            title="Show the whole project timeline"
            onClick={() => setViewMode('timeline')}
          >
            <span>Timeline</span>
          </button>
        </div>
 
        <div className="dopesheet-toolbar-divider" />
 
        {/* Timeline-parity shortcuts — Undo/Redo, Split/Delete/Duplicate,
            Toggle Snapping. Mirrors the same actions available from the
            Timeline toolbar / File+Edit menus / EditorPlaybackShortcuts'
            global keybinds, so those don't require switching tabs. */}
        <div className="dopesheet-toolbar-group">
          <button
            className="dopesheet-tool-btn-icon"
            title={`Undo (${keybinds.undo})`}
            onClick={onUndo}
            disabled={!canUndo}
          >
            <Undo2 size={13} />
          </button>
          <button
            className="dopesheet-tool-btn-icon"
            title={`Redo (${keybinds.redo})`}
            onClick={onRedo}
            disabled={!canRedo}
          >
            <Redo2 size={13} />
          </button>
        </div>
 
        <div className="dopesheet-toolbar-group">
          <button
            className="dopesheet-tool-btn-icon"
            title={`Split Clip (${keybinds.splitSelected})`}
            onClick={onSplitSelected}
            disabled={!selectedEntity}
          >
            <Scissors size={13} />
          </button>
          <button
            className="dopesheet-tool-btn-icon"
            title={`Delete Clip (${keybinds.deleteSelected})`}
            onClick={onDeleteSelected}
            disabled={!selectedEntity}
          >
            <Trash2 size={13} />
          </button>
          <button
            className="dopesheet-tool-btn-icon"
            title={`Duplicate Clip (${keybinds.duplicateSelected})`}
            onClick={onDuplicateSelected}
            disabled={!selectedEntity}
          >
            <Copy size={13} />
          </button>
        </div>
 
        <div className="dopesheet-toolbar-group">
          <button
            className={`dopesheet-tool-btn-icon ${snappingEnabled ? 'active' : ''}`}
            title={`Toggle Snapping (${keybinds.toggleSnapping})`}
            onClick={onToggleSnapping}
          >
            <Magnet size={13} />
          </button>
        </div>
 
        <div className="dopesheet-field-box current">
          <label>Current</label>
          <input readOnly value={(isTimelineView ? currentTime : localTime).toFixed(2)} />
        </div>
        <div className="dopesheet-field-box">
          <label>End</label>
          <input readOnly value={viewSpan.toFixed(2)} />
        </div>
 
        <div className="dopesheet-toolbar-spacer" />
 
        <div className="dopesheet-toolbar-group">
          <button className="dopesheet-tool-btn-icon" title={`Zoom out (${keybinds.zoomOut})`} onClick={() => setPixelsPerSecond(Math.max(MIN_PPS, pixelsPerSecond - 15))}>
            <ZoomOut size={13} />
          </button>
          <button className="dopesheet-tool-btn-icon" title={`Zoom in (${keybinds.zoomIn})`} onClick={() => setPixelsPerSecond(Math.min(MAX_PPS, pixelsPerSecond + 15))}>
            <ZoomIn size={13} />
          </button>
        </div>
 
        <div className="dopesheet-toolbar-group">
          <button className="dopesheet-tool-btn-icon" title="Go to first keyframe" onClick={goToFirstKeyframe}>
            <SkipBack size={13} />
          </button>
          <button className="dopesheet-tool-btn-icon" title="Go to previous keyframe" onClick={goToPreviousKeyframe}>
            <ChevronsLeft size={13} />
          </button>
          <button className="dopesheet-tool-btn-icon" title="Go to next keyframe" onClick={goToNextKeyframe}>
            <ChevronsRight size={13} />
          </button>
          <button className="dopesheet-tool-btn-icon" title="Go to last keyframe" onClick={goToLastKeyframe}>
            <SkipForward size={13} />
          </button>
        </div>
 
        <button
          className="dopesheet-tool-btn"
          title="Open Curves tab to edit keyframe easing"
          onClick={() => focusDockPanel('curveEditor')}
        >
          <Spline size={12} />
          <span>Curves</span>
        </button>
 
        <button className="dopesheet-tool-btn-icon" title="Toggle loop playback">
          <Repeat size={13} />
        </button>
      </div>
 
      <div className="dopesheet-body">
        {/* Left: row labels (component groups + their fields) */}
        <div className="dopesheet-labels">
          <div className="dopesheet-labels-spacer" />
          <div className="dopesheet-lanes-scroll" style={{ overflowX: 'hidden' }}>
            {groups.length === 0 && (
              <p className="hint-text-sm" style={{ padding: '10px' }}>
                This clip has no exposed parameters yet — add a component in the Inspector.
              </p>
            )}
            {groups.map((group) => {
              const Icon = GROUP_ICONS[group.component.type] || Sliders;
              const isOpen = !collapsedGroups[group.trackKey];
              return (
                <div key={group.trackKey}>
                  <div className="dopesheet-group-row" onClick={() => toggleGroup(group.trackKey)}>
                    <span className="group-chevron">
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                    <span className="group-icon"><Icon size={12} /></span>
                    <span className="group-name">{group.label}</span>
                  </div>
                  {isOpen && group.fields.map((field) => {
                    const kfs = getFieldKeyframes(selectedEntity, group.trackKey, field.name);
                    return (
                      <div key={field.name} className="dopesheet-field-row">
                        <span
                          className={`field-key-dot ${kfs.length > 0 ? 'has-keys' : ''}`}
                          title={kfs.length > 0 ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'}
                          onClick={() => {
                            const existing = kfs.find((k) => Math.abs(k.time - localTime) < 1 / 60);
                            if (existing) {
                              handleDeleteKey(group.trackKey, field.name, existing.id);
                            } else {
                              handleAddKeyAtPlayhead(group.trackKey, field.name, field.defaultVal);
                            }
                          }}
                        >
                          ◆
                        </span>
                        <span className="field-name">{field.label || field.name}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
 
        {/* Right: ruler + scrollable lanes with keyframe diamonds */}
        <div className="dopesheet-scroll-area" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <div
            className="dopesheet-ruler"
            ref={rulerRef}
            style={{ width: '100%', overflow: 'hidden' }}
            onPointerDown={handleRulerScrub}
          >
            <div style={{ position: 'relative', width: `${laneWidth}px`, marginLeft: -(lanesScrollRef.current?.scrollLeft || 0) }}>
              {/* Ruler tick times are in the CURRENT view's own time base:
                  local clip-time (0..clipDuration) in entity mode, or
                  absolute project time (0..totalDuration) in timeline
                  mode. Ticks are positioned with raw `time * pixelsPerSecond`
                  (not timeToX) because in entity mode that's identical to
                  timeToX with viewOffset=0 anyway, and in timeline mode the
                  tick's own "time" IS already the absolute x-axis value the
                  ruler should read at that pixel — it shouldn't additionally
                  get shifted by viewOffset the way a stored local-clip-time
                  keyframe does. */}
              {Array.from({ length: numTicks }).map((_, i) => {
                const time = i * tickInterval;
                return (
                  <div key={i} className="dopesheet-ruler-tick" style={{ left: `${time * pixelsPerSecond}px` }}>
                    <span className="tick-label">{time.toFixed(tickInterval < 1 ? 1 : 0)}s</span>
                  </div>
                );
              }).filter((_, i) => (i * tickInterval) <= viewSpan)}
              {isTimelineView ? (
                <>
                  {/* Timeline view: the entity's own active window is
                      highlighted as a band instead of everything outside
                      it being shaded dead space — the whole project is
                      valid range here, this clip just isn't active
                      everywhere in it. */}
                  <div
                    className="dopesheet-entity-active-band"
                    style={{
                      left: `${selectedEntity.startTime * pixelsPerSecond}px`,
                      width: `${clipDuration * pixelsPerSecond}px`,
                    }}
                  />
                  <div className="dopesheet-clip-end-line" style={{ left: `${selectedEntity.startTime * pixelsPerSecond}px` }} />
                  <div className="dopesheet-clip-end-line" style={{ left: `${(selectedEntity.startTime + clipDuration) * pixelsPerSecond}px` }} />
                </>
              ) : (
                <>
                  {/* Entity view: out-of-range shading — laneWidth pads
                      clipDuration*pixelsPerSecond with +200px of extra draw
                      space (see laneWidth above) so the lane doesn't
                      visually dead-end right at the last tick. Without this
                      overlay that padding looked identical to valid in-clip
                      space, so scrubbing/reading the ruler past the clip's
                      real end gave no indication anything had changed. */}
                  <div
                    className="dopesheet-out-of-range"
                    style={{ left: `${timeToX(clipDuration)}px`, width: `${Math.max(0, laneWidth - timeToX(clipDuration))}px` }}
                  />
                  <div className="dopesheet-clip-end-line" style={{ left: `${timeToX(clipDuration)}px` }} />
                </>
              )}
              <PlayheadLine x={playheadX} height={24} handle />
            </div>
          </div>
 
          <div
            className="dopesheet-lanes-scroll"
            ref={lanesScrollRef}
            onScroll={(e) => {
              if (rulerRef.current) rulerRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }}
          >
            <div className="dopesheet-lanes-inner" style={{ width: `${laneWidth}px` }}>
              {groups.map((group) => {
                const isOpen = !collapsedGroups[group.trackKey];
                const allGroupKeyTimes = new Set();
                group.fields.forEach((f) => {
                  getFieldKeyframes(selectedEntity, group.trackKey, f.name).forEach((k) => allGroupKeyTimes.add(k.time));
                });
 
                return (
                  <div key={group.trackKey}>
                    <div className="dopesheet-group-lane">
                      {[...allGroupKeyTimes].sort((a, b) => a - b).map((t) => (
                        <div
                          key={t}
                          className="dopesheet-keyframe group-summary"
                          style={{ left: `${timeToX(t)}px` }}
                          title={formatTimecode(t)}
                        />
                      ))}
                    </div>
                    {isOpen && group.fields.map((field) => {
                      const kfs = getFieldKeyframes(selectedEntity, group.trackKey, field.name);
                      return (
                        <div key={field.name} className="dopesheet-field-lane">
                          {kfs.slice(0, -1).map((k, i) => (
                            <div
                              key={`seg-${k.id}`}
                              className="dopesheet-keyframe-segment"
                              style={{ left: `${timeToX(k.time)}px`, width: `${timeToX(kfs[i + 1].time) - timeToX(k.time)}px` }}
                            />
                          ))}
                          {kfs.map((k) => (
                            <div
                              key={k.id}
                              className={`dopesheet-keyframe ${selectedKeyId === k.id ? 'selected' : ''}`}
                              style={{ left: `${timeToX(k.time)}px` }}
                              title={`${field.label || field.name} @ ${formatTimecode(k.time)} = ${typeof k.value === 'number' ? k.value.toFixed(2) : k.value}`}
                              onPointerDown={handleDragKey(group.trackKey, field.name, k.id)}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                handleDeleteKey(group.trackKey, field.name, k.id);
                              }}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {isTimelineView ? (
                <div
                  className="dopesheet-entity-active-band"
                  style={{
                    left: `${selectedEntity.startTime * pixelsPerSecond}px`,
                    width: `${clipDuration * pixelsPerSecond}px`,
                    top: 0,
                    bottom: 0,
                    height: 'auto',
                  }}
                />
              ) : (
                <>
                  <div
                    className="dopesheet-out-of-range"
                    style={{ left: `${timeToX(clipDuration)}px`, width: `${Math.max(0, laneWidth - timeToX(clipDuration))}px`, top: 0, bottom: 0, height: 'auto' }}
                  />
                  <div className="dopesheet-clip-end-line" style={{ left: `${timeToX(clipDuration)}px`, top: 0, bottom: 0, height: 'auto' }} />
                </>
              )}
              <PlayheadLine x={playheadX} height="100%" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
 
function PlayheadLine({ x, height, handle = false }) {
  return (
    <>
      <div className="dopesheet-playhead-line" style={{ left: `${x}px`, height: typeof height === 'number' ? `${height}px` : height }} />
      {handle && <div className="dopesheet-playhead-handle" style={{ left: `${x}px` }} />}
    </>
  );
}
 