import { useRef, useState, useMemo, useCallback, memo } from 'react';
import './dopesheet.css';
import {
  ChevronDown, ChevronRight, Sliders, Type, Square, FileCode, Sparkles, Boxes,
  ArrowRightToLine, Move, SlidersHorizontal, Repeat
} from 'lucide-react';
import { TRANSFORM_FIELD_GROUPS } from '../inspector/InspectorField';
import { extractScriptProps, detectScriptKind } from '../../engine/scriptRunner';
import {
  trackKeyFor, getFieldKeyframes, setKeyframe, removeKeyframe, moveKeyframe,
} from '../../engine/keyframes';
import { formatTimecode } from '../../utils/timeFormat';
 
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
}) {
  const lanesScrollRef = useRef(null);
  const rulerRef = useRef(null);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(PIXELS_PER_SECOND);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [selectedKeyId, setSelectedKeyId] = useState(null);
  const [shiftMode, setShiftMode] = useState(false);
 
  const localTime = selectedEntity ? Math.max(0, currentTime - selectedEntity.startTime) : 0;
  const clipDuration = selectedEntity?.duration ?? totalDuration;
 
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
        const fields = fieldSchemaForComponent(component, scripts);
        return { trackKey, component, label: groupLabel(component, scripts), fields };
      })
      .filter((g) => g.fields.length > 0);
  }, [selectedEntity, scripts]);
 
  const toggleGroup = (trackKey) => {
    setCollapsedGroups((prev) => ({ ...prev, [trackKey]: !prev[trackKey] }));
  };
 
  const timeToX = useCallback((t) => t * pixelsPerSecond, [pixelsPerSecond]);
  const xToTime = useCallback((x) => Math.max(0, x / pixelsPerSecond), [pixelsPerSecond]);
  const snapToFrame = (t) => Math.round(t * 30) / 30; // 30fps snap, matches project default fps elsewhere in the engine
 
  const laneWidth = Math.max(clipDuration * pixelsPerSecond + 200, 600);
 
  const handleRulerScrub = useCallback((e) => {
    if (!rulerRef.current || !selectedEntity) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const scrollLeft = lanesScrollRef.current?.scrollLeft || 0;
    const localX = e.clientX - rect.left + scrollLeft;
    const t = snapToFrame(xToTime(localX));
    onSeek(selectedEntity.startTime + t);
 
    const onMove = (moveEvent) => {
      const mx = moveEvent.clientX - rect.left + (lanesScrollRef.current?.scrollLeft || 0);
      onSeek(selectedEntity.startTime + snapToFrame(xToTime(mx)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [selectedEntity, xToTime, onSeek]);
 
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
      const t = Math.max(0, snapToFrame(xToTime(moveEvent.clientX - rect.left + scrollLeft)));
      const keyframes = moveKeyframe(selectedEntity, trackKey, fieldName, keyId, t);
      onUpdateEntity(selectedEntity.id, { keyframes });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
 
  const numTicks = Math.ceil(laneWidth / pixelsPerSecond) + 1;
 
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
        </div>
 
        <div className="dopesheet-toolbar-divider" />
 
        <div className="dopesheet-field-box current">
          <label>Current</label>
          <input readOnly value={Math.round(localTime * 30)} />
        </div>
        <div className="dopesheet-field-box">
          <label>Loop Start</label>
          <input readOnly value={loopStart != null ? Math.round(loopStart * 30) : ''} placeholder="—" />
        </div>
        <div className="dopesheet-field-box">
          <label>End</label>
          <input readOnly value={loopEnd != null ? Math.round(loopEnd * 30) : Math.round(clipDuration * 30)} />
        </div>
 
        <div className="dopesheet-toolbar-spacer" />
 
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
              {Array.from({ length: numTicks }).map((_, i) => (
                <div key={i} className="dopesheet-ruler-tick" style={{ left: `${i * pixelsPerSecond}px` }}>
                  <span className="tick-label">{formatTimecode(i).slice(3)}</span>
                </div>
              ))}
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
 