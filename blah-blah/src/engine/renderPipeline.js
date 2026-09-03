/**
 * Shared render pipeline — the ONE implementation of "which entities are
 * active at time T and what do their Transforms look like", used by BOTH
 * the live preview (EntityRenderer.jsx) and frame-by-frame export
 * (exportRunner.js).
 *
 * Before this module existed, EntityRenderer.jsx's `computedEntities`
 * useMemo and exportRunner.js's `computeActiveEntitiesAtTime` were two
 * hand-duplicated copies of the same filtering + keyframe resolution +
 * motion-script execution logic (with drift: the preview copy hardcoded
 * fps: 30 while export took a real fps parameter). Both now call this one
 * function; each caller keeps only its own thin, output-specific layer on
 * top (React elements + gizmos for preview, canvas 2D drawing for export).
 *
 * Everything here is a pure function of an explicit `time` argument —
 * never wall-clock/rAF — so scrubbing and export stay deterministic
 * (roadmap P1 #11, Remotion-style).
 */
import { executeScriptComponent } from './scriptRunner.js';
import { resolveKeyframedComponents } from './keyframes.js';

/**
 * Same filtering + transform logic as EntityRenderer.jsx's former
 * `computedEntities` useMemo, as a plain function driven by an explicit
 * `time` instead of component state. Returns [{ entity, transform, localTime }].
 *
 * @param {{ entities: any[], tracks: any[], scripts?: any[], time: number, fps?: number }} args
 */
export function computeActiveEntitiesAtTime({ entities, tracks, scripts = [], time, fps = 30 }) {
  const activeEntities = entities.filter((entity) => {
    if (!entity.active) return false;
    if (time < entity.startTime || time >= entity.startTime + entity.duration) {
      return false;
    }
    const track = tracks.find((t) => t.id === entity.trackId);
    if (track && (!track.visible || track.locked)) return false;
    return true;
  });

  return activeEntities.map((entity) => {
    // GUI keyframing — resolve any Dopesheet keyframes at the current
    // local time BEFORE reading components. resolveKeyframedComponents is
    // a pure function of localTime (same determinism contract as
    // CanvasRenderer's onUpdate and the motion-script tween below), so
    // scrubbing/export stay deterministic. Everything downstream —
    // Transform, ReactRenderer/CanvasRenderer props, motion-script
    // publicValues — reads from this resolved entity instead of the raw
    // one. Keyframes apply first, then a motion script (if any) runs on
    // top of the keyframed Transform, so a keyframed field and a
    // script-driven field can coexist without fighting each other — the
    // script effectively layers over a GUI-keyframed base pose.
    const localTime = time - entity.startTime;
    const keyframedComponents = resolveKeyframedComponents(entity, localTime);
    const resolvedEntity =
      keyframedComponents === entity.components ? entity : { ...entity, components: keyframedComponents };

    let currentTransform = resolvedEntity.components.find((c) => c.type === 'Transform') || {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    };

    const scriptComp = resolvedEntity.components.find(
      (c) => (c.type === 'ScriptComponent' || c.type === 'MonoBehaviour') && c.enabled
    );

    if (scriptComp) {
      const scriptDef = scripts.find((s) => s.id === scriptComp.scriptId);
      if (scriptDef && scriptDef.code) {
        try {
          currentTransform = executeScriptComponent({
            scriptCode: scriptDef.code,
            transform: currentTransform,
            localTime,
            clipDuration: entity.duration,
            publicValues: scriptComp.props || {},
            frame: Math.round(localTime * fps),
            fps,
          });
        } catch (err) {
          // A broken motion script must not abort the whole preview or
          // export — fall back to the untransformed transform for this
          // frame, same containment principle as EntityErrorBoundary.
          console.warn(`Render: motion script error on "${entity.name}":`, err);
        }
      }
    }

    return { entity: resolvedEntity, transform: currentTransform, localTime };
  });
}