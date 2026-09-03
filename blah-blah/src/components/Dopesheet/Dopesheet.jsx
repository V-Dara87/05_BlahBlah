 
import { useRef, useState, useMemo, useCallback, useEffect, memo } from 'react';
import './dopesheet.css';
import {
  ChevronDown, ChevronRight, Sliders, Type, Square, FileCode, Sparkles, Boxes,
  ArrowRightToLine, Move, SlidersHorizontal, Repeat, Filter,
  ChevronsLeft, ChevronsRight, SkipBack, SkipForward, ZoomIn, ZoomOut, Spline
} from 'lucide-react';
import { TRANSFORM_FIELD_GROUPS } from '../inspector/InspectorField';
import { extractScriptProps, detectScriptKind } from '../../engine/scriptRunner';
import {
  trackKeyFor, getFieldKeyframes, setKeyframe, removeKeyframe, moveKeyframe,
} from '../../engine/keyframes';
import { formatTimecode } from '../../utils/timeFormat';
import { useEditorContext } from '../../dock/EditorContext';
 
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
  ReactRenderer: Sparkles,
  CanvasRenderer: Boxes,
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
  if (
    component.type === 'ReactRenderer' ||
    component.type === 'CanvasRenderer' ||
    component.type === 'ScriptComponent' ||
    component.type === 'MonoBehaviour'
  ) {
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
  const [shiftMode, setShiftMode] = useState(false);
  const [showOnlyKeyframed, setShowOnlyKeyframed] = useState(false);
  const [snapToKeyframe, setSnapToKeyframe] = useState(false);

  const localTime = selectedEntity ? Math.max(0, currentTime - selectedEntity.startTime) : 0;
  const clipDuration = selectedEntity?.duration ?? totalDuration;
 
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
 
  const timeToX = useCallback((t) => t * pixelsPerSecond, [pixelsPerSecond]);
  const xToTime = useCallback((x) => Math.max(0, x / pixelsPerSecond), [pixelsPerSecond]);
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
 
  const laneWidth = Math.max(clipDuration * pixelsPerSecond + 200, 600);
  const numTicks = Math.ceil(clipDuration / tickInterval) + 1;
 
  const handleRulerScrub = useCallback((e) => {
    if (!rulerRef.current || !selectedEntity) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const scrollLeft = lanesScrollRef.current?.scrollLeft || 0;
    const localX = e.clientX - rect.left + scrollLeft;
    let t = snapToFrame(xToTime(localX));
    t = snapToNearestKeyframe(t);
    onSeek(selectedEntity.startTime + t);
 
    const onMove = (moveEvent) => {
      const entity = selectedEntityRef.current;
      if (!entity) return;
      const mx = moveEvent.clientX - rect.left + (lanesScrollRef.current?.scrollLeft || 0);
      let mt = snapToFrame(xToTime(mx));
      mt = snapToNearestKeyframe(mt);
      onSeek(entity.startTime + mt);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [selectedEntity, xToTime, onSeek, snapToNearestKeyframe]);
 
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
 
        <div className="dopesheet-field-box current">
          <label>Current</label>
          <input readOnly value={localTime.toFixed(2)} />
        </div>
        <div className="dopesheet-field-box">
          <label>End</label>
          <input readOnly value={clipDuration.toFixed(2)} />
        </div>
 
        <div className="dopesheet-toolbar-spacer" />
 
        <div className="dopesheet-toolbar-group">
          <button className="dopesheet-tool-btn-icon" title="Zoom out" onClick={() => setPixelsPerSecond(Math.max(MIN_PPS, pixelsPerSecond - 15))}>
            <ZoomOut size={13} />
          </button>
          <button className="dopesheet-tool-btn-icon" title="Zoom in" onClick={() => setPixelsPerSecond(Math.min(MAX_PPS, pixelsPerSecond + 15))}>
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
              {Array.from({ length: numTicks }).map((_, i) => {
                const time = i * tickInterval;
                return (
                  <div key={i} className="dopesheet-ruler-tick" style={{ left: `${time * pixelsPerSecond}px` }}>
                    <span className="tick-label">{time.toFixed(tickInterval < 1 ? 1 : 0)}s</span>
                  </div>
                );
              }).filter((_, i) => (i * tickInterval) <= clipDuration)}
              <PlayheadLine x={timeToX(localTime)} height={24} handle />
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
              <PlayheadLine x={timeToX(localTime)} height="100%" />
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
 