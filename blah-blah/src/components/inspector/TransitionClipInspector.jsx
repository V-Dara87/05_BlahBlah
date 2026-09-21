import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Maximize2, RotateCcw, Sparkles } from 'lucide-react';
import {
  FEATURED_TRANSITIONS,
  ALL_GL_TRANSITIONS,
  getTransitionPreset,
  startTransitionPreviewLoop,
} from '../../engine/glTransitions';
import { getTransitionClipComponent } from '../../engine/ecs';
import {
  TRANSITION_MIN_DURATION,
  buildMediaDurationsFromAssets,
  findTransitionNeighbours,
  getTransitionHandles,
  maxTransitionDuration,
  resizeTransitionAboutCut,
} from '../../engine/renderPipeline';
import { DragNumber } from '../shared/DragNumber';
import { TransitionPickerModal } from '../modals/TransitionPickerModal';
import { InspectorCardHeader } from './InspectorCardHeader';
import { OdinPropertyDrawer } from './OdinPropertyDrawer';
import './transition-inspector.css';
 
/**
 * Inspector for a TransitionClip (ecs.js createTransitionClipEntity): the
 * clip that blends the video before a cut into the video after it.
 *
 * It replaces the whole inspector body for that entity type. A TransitionClip
 * has no Transform, no renderer and nothing to attach a script to (it draws
 * nothing itself), so the usual Transform card and Add Component list would
 * only offer controls that do nothing. See UnityInspector.jsx.
 *
 * What it edits, and where each edit lands:
 *   - Preset + params  → the TransitionClipComponent (preset, params). The
 *     dropdown and the gallery (TransitionPickerModal) both go through the
 *     same `applyPreset`, so picking from either resets params to that
 *     preset's defaults exactly as the legacy TransitionInspector does.
 *   - Length           → the entity's own `duration`, resized ABOUT THE CUT
 *     (resizeTransitionAboutCut, the same helper the timeline's edge drag
 *     uses). The cut is `startTime + duration / 2`, and it is what ties the
 *     transition to its two neighbours; changing the length while keeping
 *     `startTime` would slide the cut off the join and orphan the clip. The
 *     ceiling is maxTransitionDuration, the same limit the timeline enforces,
 *     so a length typed here can never exceed the spare footage the timeline
 *     would have refused.
 *
 * Not offered here: a progress-easing curve. The resolver hands every
 * consumer (preview, export, audio crossfade) a strictly linear progress, and
 * the existing curve tools edit keyframe interpolation, which a transition
 * clip does not have. A curve control would store a value nothing reads.
 *
 * Props:
 *   entity         the selected TransitionClip
 *   entities       every clip in the project (to find the neighbours)
 *   mediaAssets    project media (for probed source durations → handle footage)
 *   onUpdateEntity (id, patch) — the inspector's shared entity updater
 *   isOpen/onToggle  foldout state, same as every other inspector card
 */
export function TransitionClipInspector({
  entity,
  entities = [],
  mediaAssets = [],
  onUpdateEntity,
  isOpen = true,
  onToggle,
}) {
  const comp = getTransitionClipComponent(entity);
  const presetId = comp?.preset || 'crossfade';
  const preset = getTransitionPreset(presetId);
  const params = comp?.params || {};
  const enabled = comp?.enabled !== false;
  const hasCustomGlsl = Boolean(comp?.customGlsl);
 
  const [pickerOpen, setPickerOpen] = useState(false);
 
  // Live preview of the chosen shader (same helper the legacy inspector and
  // the gallery use). Params ride in a ref so dragging a slider updates the
  // running loop without tearing the WebGL context down on every change.
  const previewCanvasRef = useRef(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  useEffect(() => {
    if (!isOpen || !enabled || !previewCanvasRef.current) return undefined;
    return startTransitionPreviewLoop(previewCanvasRef.current, presetId, () => paramsRef.current);
  }, [isOpen, enabled, presetId]);
 
  // Neighbours + spare footage: the numbers behind both the length ceiling
  // and the status line. Edit-time durations come from the probed media
  // assets, the same stand-in the timeline block uses.
  const mediaDurations = useMemo(
    () => buildMediaDurationsFromAssets(entities, mediaAssets),
    [entities, mediaAssets],
  );
  const { a, b } = useMemo(() => findTransitionNeighbours(entity, entities), [entity, entities]);
  const hasPair = Boolean(a && b);
  const ceiling = hasPair ? maxTransitionDuration(a, b, mediaDurations) : Infinity;
  const handles = hasPair ? getTransitionHandles(a, b, mediaDurations) : null;
 
  const patchComponent = (updates) => {
    const components = (entity.components || []).map((c) =>
      c.type === comp?.type ? { ...c, ...updates } : c);
    onUpdateEntity(entity.id, { components });
  };
 
  const applyPreset = (nextPresetId, nextParams) => {
    const next = getTransitionPreset(nextPresetId);
    patchComponent({
      preset: nextPresetId,
      params: nextParams ?? { ...(next.defaultParams || {}) },
    });
  };
 
  const handleParamChange = (name, val) => patchComponent({ params: { ...params, [name]: val } });
  const handleResetParams = () => patchComponent({ params: { ...(preset.defaultParams || {}) } });
 
  // Length edit: keep the cut where it is and grow/shrink both sides equally.
  // resizeTransitionAboutCut treats "the pointer wants this edge at time X",
  // so ask for the END edge to sit half the wanted length past the cut.
  const handleLengthChange = (wanted) => {
    const origStart = entity.startTime || 0;
    const origDuration = entity.duration || 0;
    const cut = origStart + origDuration / 2;
    const { startTime, duration } = resizeTransitionAboutCut({
      edge: 'end',
      origStart,
      origDuration,
      rawEdgeTime: cut + wanted / 2,
      maxDuration: ceiling,
    });
    // Skip a no-op write so dragging against the ceiling does not spam undo
    // history with identical states.
    if (Math.abs(duration - origDuration) < 1e-6 && Math.abs(startTime - origStart) < 1e-6) return;
    onUpdateEntity(entity.id, { startTime, duration });
  };
 
  const lengthMax = Number.isFinite(ceiling) ? Math.max(TRANSITION_MIN_DURATION, ceiling) : 10;
  const lengthShown = Math.round((entity.duration || 0) * 100) / 100;
 
  // One status line, in plain words. The three cases are the ones the export
  // dialog also warns about (renderPipeline.js auditTransitionClips), so the
  // inspector and the export never contradict each other.
  let status;
  if (!hasPair) {
    status = {
      tone: 'bad',
      text: !a && !b
        ? 'Not on a cut. Move it onto the join between two clips or it will be skipped on export.'
        : !a
          ? 'No clip ends at this cut. It will be skipped on export.'
          : 'No clip starts at this cut. It will be skipped on export.',
    };
  } else if (handles.headBefore <= 0.02 || handles.tailAfter <= 0.02) {
    status = {
      tone: 'warn',
      text: 'One side has no spare footage past the cut, so it holds a single frame during the blend.',
    };
  } else {
    status = {
      tone: 'ok',
      text: `Blending "${a.name}" into "${b.name}".`,
    };
  }
  const StatusIcon = status.tone === 'ok' ? CheckCircle2 : AlertTriangle;
 
  return (
    <div className="inspector-card">
      <InspectorCardHeader
        icon={<Sparkles size={13} className="text-amber" />}
        title="Transition"
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen && (
        <div className="inspector-card-body transition-inspector-container">
          <div className={`transition-clip-status ${status.tone}`}>
            <StatusIcon size={12} />
            <span>{status.text}</span>
          </div>
 
          <div className="inspector-row">
            <span className="row-label">Enabled</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => patchComponent({ enabled: e.target.checked })}
            />
          </div>
 
          {enabled && (
            <>
              <div className="transition-preview-box">
                <div className="transition-preview-header">
                  <span className="preview-preset-title">{preset.name}</span>
                  <span className="preview-preset-cat">{preset.category}</span>
                </div>
                <div className="transition-canvas-wrapper">
                  <canvas
                    ref={previewCanvasRef}
                    width={160}
                    height={90}
                    className="transition-preview-canvas"
                  />
                </div>
                <p className="preview-desc">{preset.description}</p>
              </div>
 
              {hasCustomGlsl && (
                <div className="transition-clip-status warn">
                  <AlertTriangle size={12} />
                  <span>This clip has a custom shader that overrides the preset above.</span>
                  <button
                    type="button"
                    className="transition-clip-inline-btn"
                    onClick={() => patchComponent({ customGlsl: undefined })}
                    title="Remove the custom shader so the selected preset is used"
                  >
                    Use preset
                  </button>
                </div>
              )}
 
              <div className="inspector-row">
                <span className="row-label">Shader</span>
                <div className="preset-select-group">
                  <select
                    className="inspector-select"
                    value={presetId}
                    onChange={(e) => applyPreset(e.target.value)}
                  >
                    <optgroup label="Featured Presets">
                      {FEATURED_TRANSITIONS.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.category})</option>
                      ))}
                    </optgroup>
                    <optgroup label="All Transitions">
                      {ALL_GL_TRANSITIONS.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </optgroup>
                  </select>
                  <button
                    type="button"
                    className="gallery-open-btn"
                    title="Browse all transition presets visually"
                    onClick={() => setPickerOpen(true)}
                  >
                    <Maximize2 size={11} />
                  </button>
                </div>
              </div>
 
              <div className="inspector-row">
                <span className="row-label">Length</span>
                <DragNumber
                  label="s"
                  value={lengthShown}
                  onChange={handleLengthChange}
                  step={0.05}
                  min={TRANSITION_MIN_DURATION}
                  max={lengthMax}
                />
              </div>
              {Number.isFinite(ceiling) && (
                <div className="transition-clip-hint">
                  Up to {ceiling.toFixed(2)}s here, the most the spare footage around this cut allows.
                </div>
              )}
 
              <OdinPropertyDrawer
                paramsTypes={preset.paramsTypes || {}}
                defaultParams={preset.defaultParams || {}}
                values={params}
                onChange={handleParamChange}
                onResetAll={handleResetParams}
                title="Parameters"
              />
            </>
          )}
 
          <div className="transition-inspector-footer">
            <button
              type="button"
              className="transition-clip-quiet-link"
              onClick={handleResetParams}
              title="Reset shader parameters to this preset's defaults"
            >
              <RotateCcw size={11} />
              <span>Reset Parameters</span>
            </button>
          </div>
        </div>
      )}
 
      <TransitionPickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        targetSlot="in"
        currentPresetId={presetId}
        initialParams={params}
        onApplyPreset={(nextPresetId, _slot, nextParams) => applyPreset(nextPresetId, nextParams)}
      />
    </div>
  );
}
 