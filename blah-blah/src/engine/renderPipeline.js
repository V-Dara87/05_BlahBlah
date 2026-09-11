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
 *
 * Script dispatch: there is ONE script component type (`ScriptComponent`),
 * and each attached script runs according to its detected kind (see
 * detectScriptKind in scriptRunner.js) — 'motion' scripts mutate the
 * Transform here (this module), while 'react'/'canvas' scripts are visual
 * outputs rendered by the caller (EntityRenderer.jsx / exportRunner.js).
 *
 * Clip speed: Transform.speed (default 1, see TRANSFORM_FIELD_GROUPS in
 * InspectorField.jsx) is a clip-level rate multiplier. Motion-kind scripts
 * receive localTime × speed by default so a sped-up clip animates its
 * scripts faster too; a script can opt out with ignoreParentSpeed: true on
 * its ScriptComponent (pinned to raw timeline time). Media elements consume
 * the same speed as element.playbackRate in EntityRenderer.jsx /
 * exportRunner.js.
 *
 * Every entity is a flat timeline clip: its Transform IS its world pose
 * (there is no parent-child hierarchy, so no world/local composition —
 * `transform` and `localTransform` are the same value).
 */
import { executeScriptComponent, detectScriptKind } from './scriptRunner.js';
import { resolveKeyframedComponents } from './keyframes.js';
import { isScriptComponent } from './ecs.js';

const IDENTITY = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };

/** The Transform component values of an entity, or an identity default. */
function transformFromComponents(components) {
  return components?.find((c) => c.type === 'Transform') || { ...IDENTITY };
}

/**
 * 2D affine composition of a parent world transform and a child local transform.
 * Composes translation (scaled and rotated by parent), rotation, scale, and opacity.
 */
export function composeTransform2D(parentWorld, childLocal) {
  const rad = ((parentWorld.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pScaleX = parentWorld.scaleX ?? 1;
  const pScaleY = parentWorld.scaleY ?? 1;
  const cX = childLocal.x || 0;
  const cY = childLocal.y || 0;
  const sx = cX * pScaleX;
  const sy = cY * pScaleY;

  return {
    ...childLocal,
    x: (parentWorld.x || 0) + (sx * cos - sy * sin),
    y: (parentWorld.y || 0) + (sx * sin + sy * cos),
    rotation: (parentWorld.rotation || 0) + (childLocal.rotation || 0),
    scaleX: pScaleX * (childLocal.scaleX ?? 1),
    scaleY: pScaleY * (childLocal.scaleY ?? 1),
    opacity: (parentWorld.opacity ?? 1) * (childLocal.opacity ?? 1),
  };
}

/**
 * Resolve ONE entity's LOCAL transform (keyframes + motion scripts) at its
 * own local time. Pure per-entity work, shared by every entity that is
 * scene-active at `time`.
 * Returns { entity: resolvedEntity, localTransform, localTime }.
 */
function resolveEntityLocal({ entity, scripts, time, fps }) {
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

  let currentTransform = transformFromComponents(resolvedEntity.components);

  // Clip-level rate (Transform.speed, default 1). Motion-kind scripts run
  // at localTime × speed by default, so a 2× clip makes its scripts play
  // through their animation twice as fast too — one "clip speed" knob
  // for both media and script motion. Captured ONCE here, from the
  // resolved (keyframe-applied) Transform, before any script runs; a
  // keyframed speed therefore animates this value, while a motion script
  // itself editing `.speed` on the transform only affects subsequent
  // sibling scripts — documented, not chased.
  const transformSpeed = resolvedEntity.components.find((c) => c.type === 'Transform')?.speed ?? 1;

  // Every attached script component runs per its detected kind. Only
  // 'motion' scripts affect the Transform here; React/Canvas scripts are
  // visual outputs — the caller renders those from the same script
  // components via detectScriptKind.
  const scriptComps = resolvedEntity.components.filter(
    (c) => isScriptComponent(c) && c.enabled !== false
  );

  for (const scriptComp of scriptComps) {
    const scriptDef = scripts.find((s) => s.id === scriptComp.scriptId);
    if (!scriptDef || !scriptDef.code) continue;
    if (detectScriptKind(scriptDef.code) !== 'motion') continue;
    // Per-script opt-out: ignoreParentSpeed keeps this script pinned to
    // raw timeline time while the clip (media + other scripts) runs at
    // Transform.speed. Absent = false, so the default follows speed.
    const scriptLocalTime = scriptComp.ignoreParentSpeed === true ? localTime : localTime * transformSpeed;
    try {
      currentTransform = executeScriptComponent({
        scriptCode: scriptDef.code,
        transform: currentTransform,
        localTime: scriptLocalTime,
        clipDuration: entity.duration,
        publicValues: scriptComp.props || {},
        frame: Math.round(scriptLocalTime * fps),
        fps,
      });
    } catch (err) {
      // A broken motion script must not abort the whole preview or
      // export — fall back to the untransformed transform for this
      // frame, same containment principle as EntityErrorBoundary.
      console.warn(`Render: motion script error on "${entity.name}":`, err);
    }
  }

  return { entity: resolvedEntity, localTransform: currentTransform, localTime };
}

/**
 * Filter and resolve entities visible at `time`.
 *
 * Visibility contract:
 *   - The entity itself must be active, within its clip window [startTime, startTime + duration),
 *     and on an unlocked, visible track.
 *   - Parent-Scoped Visibility: If `entity.parentId` is set, all ancestors must ALSO be active
 *     at `time` (active flag, track visible/unlocked, and within their respective clip windows).
 *
 * Transform contract:
 *   - `localTransform` is the entity's own pose after keyframes + motion scripts.
 *   - `transform` is the world pose, composed hierarchically from parent world transform + local transform.
 *   - `depth` represents the hierarchy depth (0 for root, 1 for child, etc.).
 *
 * @param {{ entities: any[], tracks: any[], scripts?: any[], time: number, fps?: number }} args
 */
export function computeActiveEntitiesAtTime({ entities, tracks, scripts = [], time, fps = 30 }) {
  const entityMap = new Map((entities || []).map((e) => [e.id, e]));
  const trackMap = new Map((tracks || []).map((t) => [t.id, t]));

  const isSelfActive = (e) => {
    if (!e || e.active === false) return false;
    if (time < e.startTime || time >= e.startTime + e.duration) return false;
    const track = trackMap.get(e.trackId);
    if (track && (!track.visible || track.locked)) return false;
    return true;
  };

  const isEntityVisible = (e) => {
    const visited = new Set();
    let curr = e;
    while (curr) {
      if (visited.has(curr.id)) break; // Cycle guard
      visited.add(curr.id);
      if (!isSelfActive(curr)) return false;
      if (!curr.parentId) break;
      curr = entityMap.get(curr.parentId);
      if (!curr) break; // Orphaned child whose parent doesn't exist
    }
    return true;
  };

  const activeEntities = (entities || []).filter(isEntityVisible);
  if (activeEntities.length === 0) return [];

  // Resolve local transforms for all scene-active entities
  const localMap = new Map();
  for (const entity of activeEntities) {
    localMap.set(
      entity.id,
      resolveEntityLocal({
        entity,
        scripts,
        time,
        fps,
      })
    );
  }

  // Compose world transforms hierarchically
  const worldMap = new Map();
  const depthMap = new Map();

  function resolveWorld(entityId, visited = new Set()) {
    if (worldMap.has(entityId)) return worldMap.get(entityId);
    const local = localMap.get(entityId);
    if (!local) return null;
    if (visited.has(entityId)) {
      // Break circular cycle
      worldMap.set(entityId, local.localTransform);
      depthMap.set(entityId, 0);
      return local.localTransform;
    }
    visited.add(entityId);

    const parentId = local.entity.parentId;
    if (!parentId || !localMap.has(parentId)) {
      worldMap.set(entityId, local.localTransform);
      depthMap.set(entityId, 0);
      return local.localTransform;
    }

    const parentWorld = resolveWorld(parentId, visited);
    const worldTransform = composeTransform2D(parentWorld, local.localTransform);
    const parentDepth = depthMap.get(parentId) || 0;
    worldMap.set(entityId, worldTransform);
    depthMap.set(entityId, parentDepth + 1);
    return worldTransform;
  }

  const output = [];
  for (const entity of activeEntities) {
    const local = localMap.get(entity.id);
    const worldTransform = resolveWorld(entity.id);
    const depth = depthMap.get(entity.id) || 0;
    output.push({
      entity: local.entity,
      transform: worldTransform,
      localTransform: local.localTransform,
      localTime: local.localTime,
      depth,
    });
  }
  return output;
}

