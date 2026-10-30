import { useRef, useState, useMemo, useCallback, useEffect, memo } from 'react';
import './dopesheet.css';
import {
  ChevronDown, ChevronRight, Sliders, Type, Square, FileCode,
  Move, SlidersHorizontal, Filter,
  ChevronsLeft, ChevronsRight, SkipBack, SkipForward, ZoomIn, ZoomOut,
  Undo2, Redo2, Scissors, Trash2, Copy, Magnet,
  Activity, ClipboardPaste, Plus, Navigation, CornerDownRight,
  ArrowLeftRight, Clock, FastForward,
} from 'lucide-react';
import { TRANSFORM_FIELD_GROUPS, TEXT_RENDERER_FIELDS } from '../inspector/InspectorField';
import { extractScriptProps } from '../../engine/scriptRunner';
import {
  trackKeyFor, getFieldKeyframes, setKeyframe, removeKeyframe,
  removeKeyframesByIds, moveKeyframesDelta,
  QUICK_CURVE_PRESETS, setKeyframeCurve, evaluateField,
} from '../../engine/keyframes';
import { formatTimecode } from '../../utils/timeFormat';
import { useEditorContext } from '../../dock/EditorContext';
import { isScriptComponent } from '../../engine/ecs';
import { loadKeybindSettings } from '../../services/keybindSettings';
import { ContextMenu } from '../shared/ContextMenu';
import {
  copyKeyframesToClipboard, hasClipboardKeyframes, pasteKeyframesOntoEntity,
} from '../../utils/keyframeClipboard';

/**
 * Dopesheet — Professional GUI keyframing panel (Spine 2D / Blender style).
 *
 * Focuses exclusively on the selected entity's local clip time [0, clipDuration].
 * Supports:
 * - Multi-selection (Shift+Click, Ctrl+Click, Ctrl+A, Escape)
 * - Lasso / Marquee box-selection across all lanes
 * - Multi-keyframe synchronized dragging (retaining relative time spacing & clamped at t=0)
 * - Group-level summary keyframe selection and dragging
 * - Keyframe deletion via Delete/Backspace and toolbar
 * - Arrow-key frame nudging
 * - Zoom & pan navigation
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
  if (component.type === 'TextRenderer') {
    return TEXT_RENDERER_FIELDS;
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

  // Multi-selection state: Set of selected keyframe IDs
  const [selectedKeyIds, setSelectedKeyIds] = useState(() => new Set());
  const [localSelectedKeyId, setLocalSelectedKeyId] = useState(null);
  const selectedKeyId = selectedKeyIdProp !== undefined ? selectedKeyIdProp : localSelectedKeyId;
  const setSelectedKeyId = onSelectedKeyChange || setLocalSelectedKeyId;

  // Box (lasso) selection state: { startX, startY, endX, endY } in content coordinates
  const [boxSelect, setBoxSelect] = useState(null);

  // Right-click context menu state
  const [ctxMenu, setCtxMenu] = useState(null);

  const panelRef = useRef(null);
  const labelsScrollRef = useRef(null);
  const lanesScrollRef = useRef(null);
  const lanesInnerRef = useRef(null);
  const rulerRef = useRef(null);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(PIXELS_PER_SECOND);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const keybinds = useMemo(() => loadKeybindSettings(), []);
  const [showOnlyKeyframed, setShowOnlyKeyframed] = useState(false);
  const [snapToKeyframe, setSnapToKeyframe] = useState(false);

  // Local clip time [0, clipDuration]
  const localTime = selectedEntity ? Math.max(0, currentTime - selectedEntity.startTime) : 0;
  const clipDuration = selectedEntity?.duration ?? totalDuration ?? 10;

  // Ref to hold the latest entity prop during in-flight drag loops
  const selectedEntityRef = useRef(selectedEntity);
  useEffect(() => {
    selectedEntityRef.current = selectedEntity;
  }, [selectedEntity]);

  // Keep single selectedKeyId in sync if selectedKeyIds changes
  const updateSelectedKeyIds = useCallback((newSet) => {
    setSelectedKeyIds(newSet);
    if (newSet.size === 0) {
      setSelectedKeyId(null);
    } else {
      const arr = [...newSet];
      setSelectedKeyId(arr[arr.length - 1]);
    }
  }, [setSelectedKeyId]);

  // Sync external selectedKeyId change (e.g. from CurveEditor) into selectedKeyIds
  const [prevPropKeyId, setPrevPropKeyId] = useState(selectedKeyIdProp);
  if (selectedKeyIdProp !== prevPropKeyId) {
    setPrevPropKeyId(selectedKeyIdProp);
    if (selectedKeyIdProp && !selectedKeyIds.has(selectedKeyIdProp)) {
      setSelectedKeyIds(new Set([selectedKeyIdProp]));
    }
  }

  // Derived groups & fields from selected entity
  const groups = useMemo(() => {
    if (!selectedEntity) return [];
    return selectedEntity.components
      .filter((c) => c.type !== 'AudioSource' && c.type !== 'VideoRenderer')
      .map((component) => {
        const trackKey = trackKeyFor(component);
        let fields = fieldSchemaForComponent(component, scripts);
        
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

  // Screen-space conversions (strictly clip-local 0 to clipDuration)
  const timeToX = useCallback((t) => t * pixelsPerSecond, [pixelsPerSecond]);
  const xToTime = useCallback((x) => x / pixelsPerSecond, [pixelsPerSecond]);
  const snapToFrame = (t) => Math.round(t * 30) / 30; // 30fps frame snap

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
  const snapToNearestKeyframe = useCallback((t) => {
    if (!snapToKeyframe || allKeyframeTimes.length === 0) return t;
    const nearest = allKeyframeTimes.reduce((prev, curr) => {
      return Math.abs(curr - t) < Math.abs(prev - t) ? curr : prev;
    });
    return Math.abs(nearest - t) < 0.1 ? nearest : t;
  }, [snapToKeyframe, allKeyframeTimes]);

  // Tick interval calculation based on zoom level
  const tickInterval = useMemo(() => {
    if (pixelsPerSecond >= 200) return 0.1;
    if (pixelsPerSecond >= 120) return 0.25;
    if (pixelsPerSecond >= 60) return 0.5;
    if (pixelsPerSecond >= 30) return 1;
    return 2;
  }, [pixelsPerSecond]);

  const laneWidth = Math.max(clipDuration * pixelsPerSecond + 200, 600);
  const numTicks = Math.ceil(clipDuration / tickInterval) + 1;
  const tickPx = tickInterval * pixelsPerSecond;
  const labelStride = Math.max(1, Math.ceil(40 / Math.max(tickPx, 1)));
  const playheadX = timeToX(localTime);

  // Ruler scrubbing (directly in local time, clamped [0, clipDuration])
  const handleRulerScrub = useCallback((e) => {
    if (!rulerRef.current || !selectedEntity) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const scrollLeft = lanesScrollRef.current?.scrollLeft || 0;
    const localX = e.clientX - rect.left + scrollLeft;

    let t = Math.min(clipDuration, Math.max(0, snapToFrame(xToTime(localX))));
    t = snapToNearestKeyframe(t);
    onSeek(selectedEntity.startTime + t);

    const onMove = (moveEvent) => {
      const entity = selectedEntityRef.current;
      if (!entity) return;
      const mx = moveEvent.clientX - rect.left + (lanesScrollRef.current?.scrollLeft || 0);
      let mt = Math.min(clipDuration, Math.max(0, snapToFrame(xToTime(mx))));
      mt = snapToNearestKeyframe(mt);
      onSeek(entity.startTime + mt);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [selectedEntity, xToTime, onSeek, snapToNearestKeyframe, clipDuration]);

  // Ctrl/Cmd + wheel zoom centered on cursor
  const handleLanesWheel = useCallback((e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const container = lanesScrollRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const pointerX = e.clientX - rect.left + container.scrollLeft;
    const timeAtPointer = pointerX / pixelsPerSecond;

    const zoomFactor = Math.exp(-e.deltaY * 0.0015);
    const nextPps = Math.min(MAX_PPS, Math.max(MIN_PPS, pixelsPerSecond * zoomFactor));
    if (nextPps === pixelsPerSecond) return;

    setPixelsPerSecond(nextPps);

    requestAnimationFrame(() => {
      if (!lanesScrollRef.current) return;
      const newScrollLeft = timeAtPointer * nextPps - (e.clientX - rect.left);
      lanesScrollRef.current.scrollLeft = Math.max(0, newScrollLeft);
      if (rulerRef.current) rulerRef.current.scrollLeft = lanesScrollRef.current.scrollLeft;
    });
  }, [pixelsPerSecond]);

  // Synchronized scroll: keep ruler horizontal scroll and left labels vertical scroll strictly in lockstep
  const handleLanesScroll = useCallback((e) => {
    const { scrollLeft, scrollTop } = e.currentTarget;
    if (rulerRef.current) {
      rulerRef.current.scrollLeft = scrollLeft;
    }
    if (labelsScrollRef.current && labelsScrollRef.current.scrollTop !== scrollTop) {
      labelsScrollRef.current.scrollTop = scrollTop;
    }
  }, []);

  const handleLabelsWheel = useCallback((e) => {
    if (e.ctrlKey || e.metaKey) {
      handleLanesWheel(e);
      return;
    }
    if (lanesScrollRef.current) {
      lanesScrollRef.current.scrollTop += e.deltaY;
    }
  }, [handleLanesWheel]);

  // Add keyframe at playhead
  const handleAddKeyAtPlayhead = (trackKey, fieldName, defaultVal) => {
    if (!selectedEntity) return;
    const comp = selectedEntity.components.find((c) => trackKeyFor(c) === trackKey);
    const isTransform = comp?.type === 'Transform';
    const currentVal = isTransform ? comp?.[fieldName] : comp?.props?.[fieldName];
    const value = currentVal !== undefined ? currentVal : defaultVal;
    const keyframes = setKeyframe(selectedEntity, trackKey, fieldName, snapToFrame(localTime), value);
    onUpdateEntity(selectedEntity.id, { keyframes });
  };

  // Delete single keyframe
  const handleDeleteKey = (trackKey, fieldName, keyId) => {
    const keyframes = removeKeyframe(selectedEntity, trackKey, fieldName, keyId);
    onUpdateEntity(selectedEntity.id, { keyframes });
    setSelectedKeyIds((prev) => {
      const next = new Set(prev);
      next.delete(keyId);
      return next;
    });
    if (selectedKeyId === keyId) setSelectedKeyId(null);
  };

  // Delete all currently selected keyframes
  const handleDeleteSelectedKeyframes = useCallback(() => {
    const entity = selectedEntityRef.current;
    if (!entity) return;
    const idsToDelete = selectedKeyIds.size > 0 ? selectedKeyIds : (selectedKeyId ? new Set([selectedKeyId]) : null);
    if (!idsToDelete || idsToDelete.size === 0) return;

    const keyframes = removeKeyframesByIds(entity, idsToDelete);
    onUpdateEntity(entity.id, { keyframes });
    setSelectedKeyIds(new Set());
    setSelectedKeyId(null);
    setCtxMenu(null);
  }, [selectedKeyIds, selectedKeyId, onUpdateEntity, setSelectedKeyId]);

  // Copy selected keyframes to clipboard
  const handleCopySelected = useCallback(() => {
    const entity = selectedEntityRef.current;
    if (!entity) return;
    const targetIds = selectedKeyIds.size > 0 ? selectedKeyIds : (selectedKeyId ? new Set([selectedKeyId]) : new Set());
    if (targetIds.size === 0) return;
    copyKeyframesToClipboard(entity, targetIds);
    setCtxMenu(null);
  }, [selectedKeyIds, selectedKeyId]);

  // Cut selected keyframes
  const handleCutSelected = useCallback(() => {
    handleCopySelected();
    handleDeleteSelectedKeyframes();
    setCtxMenu(null);
  }, [handleCopySelected, handleDeleteSelectedKeyframes]);

  // Duplicate selected keyframes (shifted forward by 0.5s)
  const handleDuplicateSelected = useCallback(() => {
    const entity = selectedEntityRef.current;
    if (!entity?.keyframes) return;
    const targetIds = selectedKeyIds.size > 0 ? selectedKeyIds : (selectedKeyId ? new Set([selectedKeyId]) : new Set());
    if (targetIds.size === 0) return;

    const offset = 0.5;
    let nextKeyframes = JSON.parse(JSON.stringify(entity.keyframes));
    const newSelectedIds = new Set();

    for (const tk of Object.keys(entity.keyframes)) {
      const byField = entity.keyframes[tk];
      for (const fn of Object.keys(byField)) {
        for (const k of byField[fn] || []) {
          if (targetIds.has(k.id)) {
            const newTime = snapToFrame(k.time + offset);
            const newId = `kf-${tk}-${fn}-${newTime.toFixed(3)}-${Math.random().toString(36).slice(2, 7)}`;
            nextKeyframes[tk][fn] = nextKeyframes[tk][fn].filter(
              (existing) => Math.abs(existing.time - newTime) > 0.001
            );
            nextKeyframes[tk][fn].push({
              ...JSON.parse(JSON.stringify(k)),
              id: newId,
              time: newTime,
            });
            nextKeyframes[tk][fn].sort((a, b) => a.time - b.time);
            newSelectedIds.add(newId);
          }
        }
      }
    }

    onUpdateEntity(entity.id, { keyframes: nextKeyframes });
    updateSelectedKeyIds(newSelectedIds);
    setCtxMenu(null);
  }, [selectedKeyIds, selectedKeyId, onUpdateEntity, snapToFrame, updateSelectedKeyIds]);

  // Paste clipboard keyframes onto entity at targetTime
  const handlePasteAtTime = useCallback((targetTime, targetTrackKey = null, targetFieldName = null) => {
    const entity = selectedEntityRef.current;
    if (!entity || !hasClipboardKeyframes()) return;
    const nextKeyframes = pasteKeyframesOntoEntity(entity, targetTime, targetTrackKey, targetFieldName);
    onUpdateEntity(entity.id, { keyframes: nextKeyframes });
    setCtxMenu(null);
  }, [onUpdateEntity]);

  // Apply easing preset to all currently selected keyframes (or right-clicked keyframe)
  const handleApplyEasing = useCallback((cp1, cp2) => {
    const entity = selectedEntityRef.current;
    if (!entity?.keyframes) return;
    const targetIds = selectedKeyIds.size > 0
      ? selectedKeyIds
      : (ctxMenu?.keyframe ? new Set([ctxMenu.keyframe.id]) : (selectedKeyId ? new Set([selectedKeyId]) : new Set()));
    if (targetIds.size === 0) return;

    let currentKeyframes = entity.keyframes;
    for (const tk of Object.keys(entity.keyframes)) {
      const byField = entity.keyframes[tk];
      for (const fn of Object.keys(byField)) {
        for (const k of byField[fn] || []) {
          if (targetIds.has(k.id)) {
            currentKeyframes = setKeyframeCurve(
              { ...entity, keyframes: currentKeyframes },
              tk,
              fn,
              k.id,
              cp1,
              cp2
            );
          }
        }
      }
    }
    onUpdateEntity(entity.id, { keyframes: currentKeyframes });
    setCtxMenu(null);
  }, [selectedKeyIds, ctxMenu, selectedKeyId, onUpdateEntity]);

  // Select all keyframes in a specific track/field
  const handleSelectAllInTrack = useCallback((trackKey, fieldName) => {
    const entity = selectedEntityRef.current;
    if (!entity?.keyframes) return;
    const kfs = getFieldKeyframes(entity, trackKey, fieldName);
    const ids = new Set(kfs.map((k) => k.id));
    updateSelectedKeyIds(ids);
    setCtxMenu(null);
  }, [updateSelectedKeyIds]);

  // Clear all keyframes in a specific track/field
  const handleClearAllInTrack = useCallback((trackKey, fieldName) => {
    const entity = selectedEntityRef.current;
    if (!entity?.keyframes) return;
    const nextKeyframes = {
      ...entity.keyframes,
      [trackKey]: {
        ...(entity.keyframes[trackKey] || {}),
        [fieldName]: [],
      },
    };
    onUpdateEntity(entity.id, { keyframes: nextKeyframes });
    const kfs = getFieldKeyframes(entity, trackKey, fieldName);
    const deletedIds = new Set(kfs.map((k) => k.id));
    setSelectedKeyIds((prev) => {
      const next = new Set([...prev].filter((id) => !deletedIds.has(id)));
      return next;
    });
    setCtxMenu(null);
  }, [onUpdateEntity]);

  // Reverse (time invert) selected keyframes relative to their time bounds
  const handleReverseSelected = useCallback(() => {
    const entity = selectedEntityRef.current;
    if (!entity?.keyframes) return;
    const targetIds = selectedKeyIds.size > 0 ? selectedKeyIds : (selectedKeyId ? new Set([selectedKeyId]) : new Set());
    if (targetIds.size < 2) return;

    const targetKeys = [];
    for (const tk of Object.keys(entity.keyframes)) {
      const byF = entity.keyframes[tk];
      for (const fn of Object.keys(byF || {})) {
        for (const k of byF[fn] || []) {
          if (targetIds.has(k.id)) {
            targetKeys.push({ trackKey: tk, fieldName: fn, k });
          }
        }
      }
    }

    if (targetKeys.length < 2) return;
    const minTime = Math.min(...targetKeys.map((it) => it.k.time));
    const maxTime = Math.max(...targetKeys.map((it) => it.k.time));

    let nextKeyframes = JSON.parse(JSON.stringify(entity.keyframes));
    targetKeys.forEach(({ trackKey, fieldName, k }) => {
      const invertedTime = snapToFrame(minTime + maxTime - k.time);
      const list = nextKeyframes[trackKey][fieldName];
      const idx = list.findIndex((item) => item.id === k.id);
      if (idx !== -1) {
        list[idx] = { ...list[idx], time: invertedTime };
      }
    });

    for (const tk of Object.keys(nextKeyframes)) {
      for (const fn of Object.keys(nextKeyframes[tk])) {
        nextKeyframes[tk][fn].sort((a, b) => a.time - b.time);
      }
    }

    onUpdateEntity(entity.id, { keyframes: nextKeyframes });
    setCtxMenu(null);
  }, [selectedKeyIds, selectedKeyId, onUpdateEntity, snapToFrame]);

  // Scale / Retime selected keyframes relative to their first keyframe
  const handleScaleSelected = useCallback((scaleMultiplier) => {
    const entity = selectedEntityRef.current;
    if (!entity?.keyframes) return;
    const targetIds = selectedKeyIds.size > 0 ? selectedKeyIds : (selectedKeyId ? new Set([selectedKeyId]) : new Set());
    if (targetIds.size < 2) return;

    const targetKeys = [];
    for (const tk of Object.keys(entity.keyframes)) {
      const byF = entity.keyframes[tk];
      for (const fn of Object.keys(byF || {})) {
        for (const k of byF[fn] || []) {
          if (targetIds.has(k.id)) {
            targetKeys.push({ trackKey: tk, fieldName: fn, k });
          }
        }
      }
    }

    if (targetKeys.length < 2) return;
    const minTime = Math.min(...targetKeys.map((it) => it.k.time));

    let nextKeyframes = JSON.parse(JSON.stringify(entity.keyframes));
    targetKeys.forEach(({ trackKey, fieldName, k }) => {
      const scaledTime = snapToFrame(minTime + (k.time - minTime) * scaleMultiplier);
      const list = nextKeyframes[trackKey][fieldName];
      const idx = list.findIndex((item) => item.id === k.id);
      if (idx !== -1) {
        list[idx] = { ...list[idx], time: Math.max(0, scaledTime) };
      }
    });

    for (const tk of Object.keys(nextKeyframes)) {
      for (const fn of Object.keys(nextKeyframes[tk])) {
        nextKeyframes[tk][fn].sort((a, b) => a.time - b.time);
      }
    }

    onUpdateEntity(entity.id, { keyframes: nextKeyframes });
    setCtxMenu(null);
  }, [selectedKeyIds, selectedKeyId, onUpdateEntity, snapToFrame]);

  // Drag a keyframe (supports multi-keyframe synchronized drag & Alt+Drag duplication)
  const handleDragKey = (trackKey, fieldName, keyId, keyTime) => (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    let targetIds = new Set(selectedKeyIds);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (targetIds.has(keyId)) {
        targetIds.delete(keyId);
        updateSelectedKeyIds(targetIds);
        return;
      } else {
        targetIds.add(keyId);
        updateSelectedKeyIds(targetIds);
      }
    } else {
      if (!targetIds.has(keyId)) {
        targetIds = new Set([keyId]);
        updateSelectedKeyIds(targetIds);
      }
    }

    focusDockPanel?.('curveEditor', { onlyIfOpen: true });

    let initialEntity = selectedEntityRef.current;
    if (!initialEntity) return;

    // Alt + Drag: Duplicate in-place and drag the clones (Blender / AE style)
    let actualTargetIds = targetIds;
    if (e.altKey && initialEntity.keyframes) {
      const clonedKeyframes = JSON.parse(JSON.stringify(initialEntity.keyframes));
      const clonedIds = new Set();
      for (const tk of Object.keys(initialEntity.keyframes)) {
        const byF = initialEntity.keyframes[tk];
        for (const fn of Object.keys(byF || {})) {
          for (const k of byF[fn] || []) {
            if (targetIds.has(k.id)) {
              const cloneId = `kf-${tk}-${fn}-${k.time.toFixed(3)}-${Math.random().toString(36).slice(2, 7)}`;
              clonedKeyframes[tk][fn].push({
                ...JSON.parse(JSON.stringify(k)),
                id: cloneId,
              });
              clonedIds.add(cloneId);
            }
          }
        }
      }
      actualTargetIds = clonedIds;
      initialEntity = { ...initialEntity, keyframes: clonedKeyframes };
      updateSelectedKeyIds(clonedIds);
      onUpdateEntity(initialEntity.id, { keyframes: clonedKeyframes });
    }

    // Find the minimum time among all selected keyframes to clamp at t=0
    let minTime = Infinity;
    for (const tk of Object.keys(initialEntity.keyframes || {})) {
      const byF = initialEntity.keyframes[tk];
      for (const fn of Object.keys(byF || {})) {
        for (const k of byF[fn] || []) {
          if (actualTargetIds.has(k.id)) {
            if (k.time < minTime) minTime = k.time;
          }
        }
      }
    }
    if (!Number.isFinite(minTime)) minTime = keyTime;

    const startClientX = e.clientX;
    let hasMoved = false;

    const onMove = (moveEvent) => {
      const deltaPx = moveEvent.clientX - startClientX;
      if (!hasMoved && Math.abs(deltaPx) > 3) {
        hasMoved = true;
      }
      if (!hasMoved) return;

      const rawDeltaT = deltaPx / pixelsPerSecond;
      let effectiveDeltaT = snapToFrame(rawDeltaT);

      // Clamp so that no keyframe drops below t=0
      if (minTime + effectiveDeltaT < 0) {
        effectiveDeltaT = -minTime;
      }

      const nextKeyframes = moveKeyframesDelta(initialEntity, actualTargetIds, effectiveDeltaT, snapToFrame);
      onUpdateEntity(initialEntity.id, { keyframes: nextKeyframes });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);

      // If user clicked without dragging and without modifiers, select only this key
      if (!hasMoved && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && selectedKeyIds.size > 1) {
        updateSelectedKeyIds(new Set([keyId]));
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Group summary row interaction: select or drag all child keys at this timestamp
  const handleSummaryClickOrDrag = (group, summaryTime) => (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const childKeyIds = [];
    group.fields.forEach((field) => {
      const kfs = getFieldKeyframes(selectedEntityRef.current, group.trackKey, field.name);
      const match = kfs.find((k) => Math.abs(k.time - summaryTime) < 1 / 60);
      if (match) childKeyIds.push(match.id);
    });

    if (childKeyIds.length === 0) return;

    let targetIds;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      targetIds = new Set(selectedKeyIds);
      const allSelected = childKeyIds.every((id) => targetIds.has(id));
      if (allSelected) {
        childKeyIds.forEach((id) => targetIds.delete(id));
      } else {
        childKeyIds.forEach((id) => targetIds.add(id));
      }
    } else {
      targetIds = new Set(childKeyIds);
    }
    updateSelectedKeyIds(targetIds);

    const initialEntity = selectedEntityRef.current;
    if (!initialEntity) return;

    let minTime = Infinity;
    for (const tk of Object.keys(initialEntity.keyframes || {})) {
      const byF = initialEntity.keyframes[tk];
      for (const fn of Object.keys(byF || {})) {
        for (const k of byF[fn] || []) {
          if (targetIds.has(k.id)) {
            if (k.time < minTime) minTime = k.time;
          }
        }
      }
    }
    if (!Number.isFinite(minTime)) minTime = summaryTime;

    const startClientX = e.clientX;
    let hasMoved = false;

    const onMove = (moveEvent) => {
      const deltaPx = moveEvent.clientX - startClientX;
      if (!hasMoved && Math.abs(deltaPx) > 3) {
        hasMoved = true;
      }
      if (!hasMoved) return;

      const rawDeltaT = deltaPx / pixelsPerSecond;
      let effectiveDeltaT = snapToFrame(rawDeltaT);
      if (minTime + effectiveDeltaT < 0) {
        effectiveDeltaT = -minTime;
      }

      const nextKeyframes = moveKeyframesDelta(initialEntity, targetIds, effectiveDeltaT, snapToFrame);
      onUpdateEntity(initialEntity.id, { keyframes: nextKeyframes });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Lasso / Marquee selection handler starting on empty lane space
  const handleLanesPointerDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.dopesheet-keyframe-tick') || e.target.closest('.dopesheet-playhead-handle')) {
      return;
    }

    const innerEl = lanesInnerRef.current;
    if (!innerEl) return;
    const innerRect = innerEl.getBoundingClientRect();
    const startX = e.clientX - innerRect.left;
    const startY = e.clientY - innerRect.top;
    const isShift = e.shiftKey;
    const isCtrl = e.ctrlKey || e.metaKey;
    const baseSelectedIds = (isShift || isCtrl) ? new Set(selectedKeyIds) : new Set();
    let hasMoved = false;

    const onMove = (me) => {
      if (!lanesInnerRef.current) return;
      const curRect = lanesInnerRef.current.getBoundingClientRect();
      const endX = me.clientX - curRect.left;
      const endY = me.clientY - curRect.top;

      if (!hasMoved && (Math.abs(endX - startX) > 3 || Math.abs(endY - startY) > 3)) {
        hasMoved = true;
      }
      setBoxSelect({ startX, startY, endX, endY });

      if (hasMoved) {
        const minX = Math.min(startX, endX);
        const maxX = Math.max(startX, endX);
        const minY = Math.min(startY, endY);
        const maxY = Math.max(startY, endY);

        const hitIds = new Set(baseSelectedIds);
        const keyEls = lanesInnerRef.current.querySelectorAll('.dopesheet-keyframe-tick[data-key-id]');
        keyEls.forEach((el) => {
          const id = el.getAttribute('data-key-id');
          if (!id) return;
          const r = el.getBoundingClientRect();
          const elLeft = r.left - curRect.left;
          const elRight = r.right - curRect.left;
          const elTop = r.top - curRect.top;
          const elBottom = r.bottom - curRect.top;

          if (elLeft < maxX && elRight > minX && elTop < maxY && elBottom > minY) {
            hitIds.add(id);
          }
        });
        setSelectedKeyIds(hitIds);
        if (hitIds.size > 0) {
          const arr = [...hitIds];
          setSelectedKeyId(arr[arr.length - 1]);
        }
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setBoxSelect(null);

      if (!hasMoved) {
        // Plain click on empty space: clear selection and seek playhead
        if (!isShift && !isCtrl) {
          setSelectedKeyIds(new Set());
          setSelectedKeyId(null);
          const clickTime = Math.min(clipDuration, Math.max(0, snapToFrame(xToTime(startX))));
          onSeek(selectedEntity.startTime + clickTime);
        }
      } else {
        setSelectedKeyIds((latest) => {
          if (latest.size > 0) {
            const arr = [...latest];
            setSelectedKeyId(arr[arr.length - 1]);
          }
          return latest;
        });
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Keyboard navigation & shortcuts
  const handleKeyDown = useCallback((e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedKeyIds.size > 0 || selectedKeyId) {
        e.preventDefault();
        e.stopPropagation();
        handleDeleteSelectedKeyframes();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSelectedKeyIds(new Set());
      setSelectedKeyId(null);
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      const allIds = new Set();
      const entity = selectedEntityRef.current;
      if (entity?.keyframes) {
        for (const tk of Object.keys(entity.keyframes)) {
          const byF = entity.keyframes[tk];
          for (const fn of Object.keys(byF || {})) {
            for (const k of byF[fn] || []) {
              allIds.add(k.id);
            }
          }
        }
      }
      updateSelectedKeyIds(allIds);
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      handleCopySelected();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      handleCutSelected();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      handlePasteAtTime(localTime);
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      handleDuplicateSelected();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (selectedKeyIds.size > 0 || selectedKeyId) {
        e.preventDefault();
        const ids = selectedKeyIds.size > 0 ? selectedKeyIds : new Set([selectedKeyId]);
        const step = (e.shiftKey ? 10 : 1) * (1 / 30);
        const delta = e.key === 'ArrowLeft' ? -step : step;
        const nextKeyframes = moveKeyframesDelta(selectedEntityRef.current, ids, delta, snapToFrame);
        onUpdateEntity(selectedEntityRef.current.id, { keyframes: nextKeyframes });
      }
    }
  }, [
    handleDeleteSelectedKeyframes, handleCopySelected, handleCutSelected,
    handlePasteAtTime, handleDuplicateSelected, localTime,
    selectedKeyIds, selectedKeyId, onUpdateEntity, updateSelectedKeyIds, setSelectedKeyId, snapToFrame,
  ]);

  // Keyframe navigation helpers
  const goToFirstKeyframe = () => {
    if (allKeyframeTimes.length === 0) return;
    onSeek(selectedEntity.startTime + allKeyframeTimes[0]);
  };

  const goToLastKeyframe = () => {
    if (allKeyframeTimes.length === 0) return;
    onSeek(selectedEntity.startTime + allKeyframeTimes[allKeyframeTimes.length - 1]);
  };

  const goToPreviousKeyframe = () => {
    if (allKeyframeTimes.length === 0) return;
    const prevKey = allKeyframeTimes.filter((t) => t < localTime - 0.001).pop();
    if (prevKey !== undefined) {
      onSeek(selectedEntity.startTime + prevKey);
    }
  };

  const goToNextKeyframe = () => {
    if (allKeyframeTimes.length === 0) return;
    const nextKey = allKeyframeTimes.find((t) => t > localTime + 0.001);
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

  const hasSelectedKeys = selectedKeyIds.size > 0 || Boolean(selectedKeyId);

  return (
    <div
      className="dopesheet-panel"
      ref={panelRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ outline: 'none' }}
    >
      {/* Top Toolbar */}
      <div className="dopesheet-toolbar">
        <div className="dopesheet-toolbar-group">
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
            title="Snap to keyframes when scrubbing"
            onClick={() => setSnapToKeyframe((v) => !v)}
          >
            <SlidersHorizontal size={12} />
            <span>Snap Keys</span>
          </button>
        </div>

        <div className="dopesheet-toolbar-divider" />

        {/* Undo / Redo */}
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

        {/* Clip & Keyframe operations */}
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
            className={`dopesheet-tool-btn-icon ${hasSelectedKeys ? 'active' : ''}`}
            title={hasSelectedKeys ? 'Delete Selected Keyframe(s) (Delete)' : `Delete Clip (${keybinds.deleteSelected})`}
            onClick={hasSelectedKeys ? handleDeleteSelectedKeyframes : onDeleteSelected}
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
          <input readOnly value={localTime.toFixed(2)} />
        </div>
        <div className="dopesheet-field-box">
          <label>End</label>
          <input readOnly value={clipDuration.toFixed(2)} />
        </div>

        <div className="dopesheet-toolbar-spacer" />

        <div className="dopesheet-toolbar-group">
          <button
            className="dopesheet-tool-btn-icon"
            title={`Zoom out (${keybinds.zoomOut})`}
            onClick={() => setPixelsPerSecond(Math.max(MIN_PPS, pixelsPerSecond - 15))}
          >
            <ZoomOut size={13} />
          </button>
          <button
            className="dopesheet-tool-btn-icon"
            title={`Zoom in (${keybinds.zoomIn})`}
            onClick={() => setPixelsPerSecond(Math.min(MAX_PPS, pixelsPerSecond + 15))}
          >
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
      </div>

      <div className="dopesheet-body">
        {/* Left column: Row labels */}
        <div className="dopesheet-labels">
          <div className="dopesheet-labels-spacer" />
          <div className="dopesheet-labels-scroll" ref={labelsScrollRef} onWheel={handleLabelsWheel}>
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

        {/* Right column: Ruler & Lanes */}
        <div className="dopesheet-scroll-area" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          {/* Ruler */}
          <div
            className="dopesheet-ruler"
            ref={rulerRef}
            style={{ width: '100%', overflow: 'hidden' }}
            onPointerDown={handleRulerScrub}
            onWheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                handleLanesWheel(e);
              } else if (lanesScrollRef.current && e.deltaY !== 0) {
                lanesScrollRef.current.scrollTop += e.deltaY;
              }
            }}
          >
            <div style={{ position: 'relative', width: `${laneWidth}px` }}>
              {Array.from({ length: numTicks }).map((_, i) => {
                const time = i * tickInterval;
                const isMajor = i % labelStride === 0;
                return (
                  <div key={i} className={`dopesheet-ruler-tick ${isMajor ? 'major' : 'minor'}`} style={{ left: `${time * pixelsPerSecond}px` }}>
                    {isMajor && <span className="tick-label">{time.toFixed(tickInterval < 1 ? 1 : 0)}s</span>}
                  </div>
                );
              }).filter((_, i) => (i * tickInterval) <= clipDuration)}

              {/* Clip end boundary & out-of-range dead space */}
              <div
                className="dopesheet-out-of-range"
                style={{ left: `${timeToX(clipDuration)}px`, width: `${Math.max(0, laneWidth - timeToX(clipDuration))}px` }}
              />
              <div className="dopesheet-clip-end-line" style={{ left: `${timeToX(clipDuration)}px` }} />

              <PlayheadLine x={playheadX} height={24} handle label={localTime.toFixed(2)} />
            </div>
          </div>

          {/* Lanes */}
          <div
            className="dopesheet-lanes-scroll"
            ref={lanesScrollRef}
            onScroll={handleLanesScroll}
            onWheel={handleLanesWheel}
            onPointerDown={handleLanesPointerDown}
          >
            <div
              className="dopesheet-lanes-inner"
              ref={lanesInnerRef}
              style={{ width: `${laneWidth}px`, position: 'relative', minHeight: '100%' }}
            >
              {/* Background grid */}
              <div
                className="dopesheet-grid-pattern"
                style={{
                  backgroundSize: `${tickPx * labelStride}px 100%`,
                  backgroundPosition: '0 0',
                }}
              />

              {/* Marquee / Lasso selection rectangle */}
              {boxSelect && (
                <div
                  className="dopesheet-lasso-box"
                  style={{
                    left: `${Math.min(boxSelect.startX, boxSelect.endX)}px`,
                    top: `${Math.min(boxSelect.startY, boxSelect.endY)}px`,
                    width: `${Math.abs(boxSelect.endX - boxSelect.startX)}px`,
                    height: `${Math.abs(boxSelect.endY - boxSelect.startY)}px`,
                  }}
                />
              )}

              {/* Groups & Fields */}
              {groups.map((group) => {
                const isOpen = !collapsedGroups[group.trackKey];
                const allGroupKeyTimes = new Set();
                group.fields.forEach((f) => {
                  getFieldKeyframes(selectedEntity, group.trackKey, f.name).forEach((k) => allGroupKeyTimes.add(k.time));
                });

                return (
                  <div key={group.trackKey}>
                    {/* Summary row */}
                    <div className="dopesheet-group-lane">
                      {[...allGroupKeyTimes].sort((a, b) => a - b).map((t) => {
                        // Check if all child keys at this time are selected
                        const childKeysAtTime = [];
                        group.fields.forEach((f) => {
                          const kfs = getFieldKeyframes(selectedEntity, group.trackKey, f.name);
                          const m = kfs.find((k) => Math.abs(k.time - t) < 1 / 60);
                          if (m) childKeysAtTime.push(m.id);
                        });
                        const isAllSelected = childKeysAtTime.length > 0 && childKeysAtTime.every((id) => selectedKeyIds.has(id));

                        return (
                          <div
                            key={t}
                            className={`dopesheet-keyframe-tick group-summary ${isAllSelected ? 'selected' : ''}`}
                            style={{ left: `${timeToX(t)}px` }}
                            title={`Group Keyframes @ ${formatTimecode(t)}`}
                            onPointerDown={handleSummaryClickOrDrag(group, t)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (childKeysAtTime.length > 0) {
                                updateSelectedKeyIds(new Set(childKeysAtTime));
                              }
                              setCtxMenu({
                                x: e.clientX,
                                y: e.clientY,
                                type: 'summary',
                                group,
                                keyTime: t,
                              });
                            }}
                          />
                        );
                      })}
                    </div>

                    {/* Field rows */}
                    {isOpen && group.fields.map((field) => {
                      const kfs = getFieldKeyframes(selectedEntity, group.trackKey, field.name);
                      return (
                        <div
                          key={field.name}
                          className="dopesheet-field-lane"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            const lanesRect = lanesInnerRef.current?.getBoundingClientRect();
                            const clickX = e.clientX - (lanesRect?.left || 0);
                            const clickTime = Math.min(clipDuration, Math.max(0, snapToFrame(xToTime(clickX))));
                            const val = evaluateField(selectedEntity, group.trackKey, field.name, clickTime) ?? field.defaultVal;
                            const keyframes = setKeyframe(selectedEntity, group.trackKey, field.name, clickTime, val);
                            onUpdateEntity(selectedEntity.id, { keyframes });
                            const added = (keyframes[group.trackKey]?.[field.name] || []).find((k) => Math.abs(k.time - clickTime) < 0.001);
                            if (added) {
                              updateSelectedKeyIds(new Set([added.id]));
                            }
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const lanesRect = lanesInnerRef.current?.getBoundingClientRect();
                            const clickX = e.clientX - (lanesRect?.left || 0);
                            const clickTime = Math.min(clipDuration, Math.max(0, snapToFrame(xToTime(clickX))));
                            setCtxMenu({
                              x: e.clientX,
                              y: e.clientY,
                              type: 'lane',
                              trackKey: group.trackKey,
                              fieldName: field.name,
                              fieldLabel: field.label || field.name,
                              defaultVal: field.defaultVal,
                              clickTime,
                            });
                          }}
                        >
                          {/* Segment connector lines */}
                          {kfs.slice(0, -1).map((k, i) => (
                            <div
                              key={`seg-${k.id}`}
                              className="dopesheet-keyframe-segment"
                              style={{ left: `${timeToX(k.time)}px`, width: `${timeToX(kfs[i + 1].time) - timeToX(k.time)}px` }}
                            />
                          ))}

                          {/* Keyframe diamonds */}
                          {kfs.map((k) => {
                            const isSelected = selectedKeyIds.has(k.id) || selectedKeyId === k.id;
                            return (
                              <div
                                key={k.id}
                                data-key-id={k.id}
                                className={`dopesheet-keyframe-tick ${isSelected ? 'selected' : ''}`}
                                style={{ left: `${timeToX(k.time)}px` }}
                                title={`${field.label || field.name} @ ${formatTimecode(k.time)} = ${typeof k.value === 'number' ? k.value.toFixed(2) : k.value}`}
                                onPointerDown={handleDragKey(group.trackKey, field.name, k.id, k.time)}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteKey(group.trackKey, field.name, k.id);
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!selectedKeyIds.has(k.id)) {
                                    updateSelectedKeyIds(new Set([k.id]));
                                  }
                                  setCtxMenu({
                                    x: e.clientX,
                                    y: e.clientY,
                                    type: 'keyframe',
                                    trackKey: group.trackKey,
                                    fieldName: field.name,
                                    fieldLabel: field.label || field.name,
                                    keyframe: k,
                                    keyTime: k.time,
                                  });
                                }}
                              />
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Clip end boundary line & dead space shading */}
              <div
                className="dopesheet-out-of-range"
                style={{ left: `${timeToX(clipDuration)}px`, width: `${Math.max(0, laneWidth - timeToX(clipDuration))}px`, top: 0, bottom: 0, height: 'auto' }}
              />
              <div className="dopesheet-clip-end-line" style={{ left: `${timeToX(clipDuration)}px`, top: 0, bottom: 0, height: 'auto' }} />

              {/* Playhead scrub line */}
              <PlayheadLine x={playheadX} height="100%" />
            </div>
          </div>
        </div>
      </div>

      {/* Dopesheet Right-Click Context Menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          className="dopesheet-context-menu"
          minWidth={190}
        >
          {/* Header */}
          <div className="ctx-menu-header">
            {ctxMenu.type === 'keyframe' && `${ctxMenu.fieldLabel} @ ${formatTimecode(ctxMenu.keyTime)}`}
            {ctxMenu.type === 'summary' && `${ctxMenu.group.label} @ ${formatTimecode(ctxMenu.keyTime)}`}
            {ctxMenu.type === 'lane' && `${ctxMenu.fieldLabel} (${formatTimecode(ctxMenu.clickTime)})`}
          </div>
          <div className="ctx-menu-divider" />

          {/* Quick Curve Easing Presets */}
          {(ctxMenu.type === 'keyframe' || ctxMenu.type === 'summary') && (
            <>
              <div className="ctx-menu-header">Curve Easing</div>
              <div className="ctx-menu-preset-grid">
                {QUICK_CURVE_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    className="ctx-menu-preset-btn"
                    onClick={() => handleApplyEasing(preset.cp1, preset.cp2)}
                  >
                    <Activity size={10} />
                    <span>{preset.name}</span>
                  </button>
                ))}
              </div>
              <button
                className="ctx-menu-item ctx-menu-row"
                onClick={() => {
                  focusDockPanel?.('curveEditor');
                  setCtxMenu(null);
                }}
              >
                <span className="ctx-menu-label"><Activity size={12} /> Edit in Curves Tab</span>
              </button>
              <div className="ctx-menu-divider" />
            </>
          )}

          {/* Add Keyframe on Lane */}
          {ctxMenu.type === 'lane' && (
            <>
              <button
                className="ctx-menu-item ctx-menu-row"
                onClick={() => {
                  const val = evaluateField(selectedEntity, ctxMenu.trackKey, ctxMenu.fieldName, ctxMenu.clickTime) ?? ctxMenu.defaultVal;
                  const keyframes = setKeyframe(selectedEntity, ctxMenu.trackKey, ctxMenu.fieldName, ctxMenu.clickTime, val);
                  onUpdateEntity(selectedEntity.id, { keyframes });
                  setCtxMenu(null);
                }}
              >
                <span className="ctx-menu-label"><Plus size={12} /> Add Keyframe Here</span>
                <span className="ctx-menu-hint">{formatTimecode(ctxMenu.clickTime)}</span>
              </button>
              <button
                className="ctx-menu-item ctx-menu-row"
                onClick={() => {
                  handleAddKeyAtPlayhead(ctxMenu.trackKey, ctxMenu.fieldName, ctxMenu.defaultVal);
                  setCtxMenu(null);
                }}
              >
                <span className="ctx-menu-label"><Plus size={12} /> Add Keyframe at Playhead</span>
                <span className="ctx-menu-hint">{formatTimecode(localTime)}</span>
              </button>
              <div className="ctx-menu-divider" />
            </>
          )}

          {/* Clipboard Actions */}
          {(ctxMenu.type === 'keyframe' || ctxMenu.type === 'summary') && (
            <>
              <button className="ctx-menu-item ctx-menu-row" onClick={handleCopySelected}>
                <span className="ctx-menu-label"><Copy size={12} /> Copy</span>
                <span className="ctx-menu-hint">Ctrl+C</span>
              </button>
              <button className="ctx-menu-item ctx-menu-row" onClick={handleCutSelected}>
                <span className="ctx-menu-label"><Scissors size={12} /> Cut</span>
                <span className="ctx-menu-hint">Ctrl+X</span>
              </button>
              <button className="ctx-menu-item ctx-menu-row" onClick={handleDuplicateSelected}>
                <span className="ctx-menu-label"><Copy size={12} /> Duplicate</span>
                <span className="ctx-menu-hint">Ctrl+D</span>
              </button>
              {(selectedKeyIds.size >= 2 || ctxMenu.type === 'summary') && (
                <>
                  <div className="ctx-menu-divider" />
                  <div className="ctx-menu-header">Timing & Retime</div>
                  <button className="ctx-menu-item ctx-menu-row" onClick={handleReverseSelected}>
                    <span className="ctx-menu-label"><ArrowLeftRight size={12} /> Reverse Timing</span>
                  </button>
                  <button className="ctx-menu-item ctx-menu-row" onClick={() => handleScaleSelected(0.5)}>
                    <span className="ctx-menu-label"><FastForward size={12} /> Speed 2x (0.5x time)</span>
                  </button>
                  <button className="ctx-menu-item ctx-menu-row" onClick={() => handleScaleSelected(2.0)}>
                    <span className="ctx-menu-label"><Clock size={12} /> Slow 0.5x (2x time)</span>
                  </button>
                </>
              )}
            </>
          )}

          {/* Paste */}
          <button
            className="ctx-menu-item ctx-menu-row"
            disabled={!hasClipboardKeyframes()}
            onClick={() => {
              const pasteTime = ctxMenu.type === 'lane' ? ctxMenu.clickTime : (ctxMenu.keyTime ?? localTime);
              handlePasteAtTime(pasteTime, ctxMenu.trackKey, ctxMenu.fieldName);
            }}
          >
            <span className="ctx-menu-label"><ClipboardPaste size={12} /> Paste</span>
            <span className="ctx-menu-hint">Ctrl+V</span>
          </button>

          {/* Delete */}
          {(ctxMenu.type === 'keyframe' || ctxMenu.type === 'summary') && (
            <button className="ctx-menu-item ctx-menu-row danger" onClick={handleDeleteSelectedKeyframes}>
              <span className="ctx-menu-label"><Trash2 size={12} /> Delete Keyframe</span>
              <span className="ctx-menu-hint">Del</span>
            </button>
          )}

          <div className="ctx-menu-divider" />

          {/* Jump Playhead */}
          {(ctxMenu.type === 'keyframe' || ctxMenu.type === 'summary') && (
            <button
              className="ctx-menu-item ctx-menu-row"
              onClick={() => {
                onSeek(selectedEntity.startTime + ctxMenu.keyTime);
                setCtxMenu(null);
              }}
            >
              <span className="ctx-menu-label"><Navigation size={12} /> Jump Playhead Here</span>
            </button>
          )}

          {/* Track operations */}
          {ctxMenu.trackKey && ctxMenu.fieldName && (
            <>
              <button
                className="ctx-menu-item"
                onClick={() => handleSelectAllInTrack(ctxMenu.trackKey, ctxMenu.fieldName)}
              >
                Select All on This Track
              </button>
              <button
                className="ctx-menu-item danger"
                onClick={() => handleClearAllInTrack(ctxMenu.trackKey, ctxMenu.fieldName)}
              >
                Clear All on This Track
              </button>
            </>
          )}

          {/* Select All */}
          <button
            className="ctx-menu-item ctx-menu-row"
            onClick={() => {
              const allIds = new Set();
              const entity = selectedEntityRef.current;
              if (entity?.keyframes) {
                for (const tk of Object.keys(entity.keyframes)) {
                  const byF = entity.keyframes[tk];
                  for (const fn of Object.keys(byF || {})) {
                    for (const k of byF[fn] || []) {
                      allIds.add(k.id);
                    }
                  }
                }
              }
              updateSelectedKeyIds(allIds);
              setCtxMenu(null);
            }}
          >
            <span className="ctx-menu-label">Select All Keyframes</span>
            <span className="ctx-menu-hint">Ctrl+A</span>
          </button>
        </ContextMenu>
      )}
    </div>
  );
});

function PlayheadLine({ x, height, handle = false, label }) {
  return (
    <>
      {label !== undefined && (
        <div className="dopesheet-playhead-time-label" style={{ left: `${x}px` }}>
          {label}
        </div>
      )}
      <div className="dopesheet-playhead-line" style={{ left: `${x}px`, height: typeof height === 'number' ? `${height}px` : height }} />
      {handle && <div className="dopesheet-playhead-handle" style={{ left: `${x}px` }} />}
    </>
  );
}