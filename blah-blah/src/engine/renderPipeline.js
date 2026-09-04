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
 * Parent-child hierarchy: an entity whose `parentId` is set authorates its
 * Transform as LOCAL values relative to the parent's frame. World
 * Transforms are resolved here by composing down the chain (see
 * composeWorldTransform). Visibility is PARENT-GATED: a child is only
 * visible while its whole ancestor chain is present and playing at `time`
 * (each clip window must contain `time`). Timeline drags move children
 * together with parents (see ClipItem.jsx) so children stay inside their
 * parent's window by construction.
 */
import { executeScriptComponent, detectScriptKind } from './scriptRunner.js';
import { resolveKeyframedComponents } from './keyframes.js';
import { isScriptComponent, getAncestorChain } from './ecs.js';

// ─── Affine world/local transform helpers ───────────────────────────────────
//
// Transform hierarchy math. An entity WITHOUT a parentId uses its local
// Transform directly as its World Transform. An entity WITH a parentId has
// local Transform values authored relative to its parent's frame; its World
// Transform is composed by walking down the chain from the root ancestor,
// applying the 2D affine rules below at every level. Everything here is a
// pure function of explicit input values — no state, deterministic per
// frame — matching the module's scrubbing/export contract.

const IDENTITY = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/**
 * Compose a child's LOCAL transform onto its parent's WORLD transform.
 *
 * The child's local x/y offset is expressed in the parent's local frame:
 * it is scaled by the parent's world scale and rotated by the parent's
 * world rotation before being added to the parent's world position.
 * Rotation/scale/opacity accumulate down the chain as specified:
 *   worldRotation = parent.rotation + local.rotation
 *   worldScaleX   = parent.scaleX * local.scaleX      (same for Y)
 *   worldOpacity  = parent.opacity * local.opacity
 *   rad = parent.rotation * π/180
 *   worldX = parent.x + local.x*parent.scaleX*cos(rad) - local.y*parent.scaleY*sin(rad)
 *   worldY = parent.y + local.x*parent.scaleX*sin(rad) + local.y*parent.scaleY*cos(rad)
 */
export function composeWorldTransform(parentWorld, local) {
  const pw = { ...IDENTITY, ...parentWorld };
  const l = { ...IDENTITY, ...local };
  const rad = (num(pw.rotation, 0) * Math.PI) / 180;
  const sx = num(pw.scaleX, 1);
  const sy = num(pw.scaleY, 1);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    ...l,
    x: num(pw.x, 0) + num(l.x, 0) * sx * cos - num(l.y, 0) * sy * sin,
    y: num(pw.y, 0) + num(l.x, 0) * sx * sin + num(l.y, 0) * sy * cos,
    rotation: num(pw.rotation, 0) + num(l.rotation, 0),
    scaleX: sx * num(l.scaleX, 1),
    scaleY: sy * num(l.scaleY, 1),
    opacity: num(pw.opacity, 1) * num(l.opacity, 1),
    // Clip-level speed is per-entity (it scales the entity's own local
    // time), never composed with ancestors — carry the child's own value.
    speed: num(l.speed, 1),
  };
}

/**
 * Inverse of composeWorldTransform: given a desired child WORLD pose and
 * the parent's WORLD pose, return the child LOCAL transform that produces
 * that world pose. Used when re-parenting an entity in the Inspector so it
 * stays visually in place (Unity-style parenting).
 */
export function localTransformFromWorld(childWorld, parentWorld) {
  const pw = { ...IDENTITY, ...parentWorld };
  const w = { ...IDENTITY, ...childWorld };
  const rad = (num(pw.rotation, 0) * Math.PI) / 180;
  const sx = num(pw.scaleX, 1) || 1;
  const sy = num(pw.scaleY, 1) || 1;
  const dx = num(w.x, 0) - num(pw.x, 0);
  const dy = num(w.y, 0) - num(pw.y, 0);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    ...w,
    // Inverse of: dx = lx*sx*cos - ly*sy*sin ; dy = lx*sx*sin + ly*sy*cos
    x: (dx * cos + dy * sin) / sx,
    y: (-dx * sin + dy * cos) / sy,
    rotation: num(w.rotation, 0) - num(pw.rotation, 0),
    scaleX: num(w.scaleX, 1) / sx,
    scaleY: num(w.scaleY, 1) / sy,
    opacity: num(w.opacity, 1) / (num(pw.opacity, 1) || 1),
  };
}

/**
 * Best-effort WORLD pose of `entity` from its STATIC stored Transform
 * values only (no keyframe/motion-script evaluation at a time). Used as
 * the fallback when an entity isn't inside its active window at the
 * current playhead, so a world pose still exists to convert against.
 * Dangling parentIds are treated as roots (the entity stands alone).
 */
export function staticWorldTransform(entity, entities) {
  if (!entity) return { ...IDENTITY };
  const byId = new Map((entities || []).map((e) => [e?.id, e]));
  // Resolve top-down: walk the chain to its root ancestor first.
  const chain = [...getAncestorChain(entities, entity.id)].reverse();
  let world = { ...IDENTITY };
  for (const ancestorId of chain) {
    const ancestor = byId.get(ancestorId);
    if (!ancestor) break; // dangling parent → treat as root
    world = composeWorldTransform(world, transformFromComponents(ancestor.components));
  }
  return composeWorldTransform(world, transformFromComponents(entity.components));
}

/** The Transform component values of an entity, or an identity default. */
function transformFromComponents(components) {
  return components?.find((c) => c.type === 'Transform') || { ...IDENTITY };
}

/**
 * Resolve ONE entity's LOCAL transform (keyframes + motion scripts) at its
 * own local time. Pure per-entity work, shared by every entity that is
 * scene-active at `time` (including ancestors, which only contribute their
 * pose to children and render nothing themselves).
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
 * Same filtering + transform logic as EntityRenderer.jsx's former
 * `computedEntities` useMemo, as a plain function driven by an explicit
 * `time` instead of component state.
 *
 * Returns [{ entity, transform, localTransform, localTime, depth }] for
 * every entity actually visible at `time`:
 *   - the entity's own clip window must contain `time` (same rule as
 *     before), its track must be visible/unlocked, and it must be active;
 *   - PARENT-GATED: an entity with a parentId is only visible while its
 *     WHOLE ancestor chain is also present and playing at `time` (each
 *     ancestor's own clip window must contain `time`). Dragging a parent
 *     clip moves its children by the same time offset (see ClipItem.jsx)
 *     precisely so children stay inside their parent's window and this
 *     gate never surprises an author.
 *
 * `transform` is the resolved WORLD transform — callers (preview AND
 * export) must render with this. `localTransform` is the entity's own
 * local pose after keyframes + motion scripts. `depth` is the chain depth
 * (0 = root), used for deterministic draw ordering between parents and
 * children.
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

  if (activeEntities.length === 0) return [];

  // 1. LOCAL transforms for every scene-active entity (each resolved
  //    inside its own clip window at its own local time).
  const locals = new Map(); // entityId -> { entity, localTransform, localTime }
  for (const entity of activeEntities) {
    locals.set(entity.id, resolveEntityLocal({ entity, scripts, time, fps }));
  }

  // 2. Hierarchical WORLD transforms, top-down via memoized recursion.
  //    Parent-gated: an entity whose parent isn't scene-active at `time`
  //    is NOT visible and drops out of the result. A dangling parentId
  //    (hand-edited JSON referencing a deleted entity) is treated as a
  //    root — better to show the clip at its own pose than hide it.
  //    Cycles (shouldn't happen — the Inspector prevents them) degrade to
  //    the entity standing alone rather than hanging the render loop.
  const worldMemo = new Map(); // entityId -> worldTransform | null (null = not visible)

  const worldFor = (entityId, visiting = new Set()) => {
    if (worldMemo.has(entityId)) return worldMemo.get(entityId);
    if (visiting.has(entityId)) {
      // Cycle guard (only reachable from hand-edited project JSON — the
      // Inspector prevents circular parenting): treat the re-visited
      // entity as its own root rather than looping forever.
      return locals.get(entityId)?.localTransform || null;
    }
    const rec = locals.get(entityId);
    if (!rec) return null; // not scene-active at this time
    visiting.add(entityId);
    let world = rec.localTransform;
    if (rec.entity.parentId) {
      if (!locals.has(rec.entity.parentId)) {
        // Parent exists in the project but is NOT playing at this time —
        // parent-gated: the child is hidden while its parent clip is off.
        // If the parent doesn't exist at all (dangling id) the entity
        // stands alone instead.
        const parentExists = entities.some((e) => e.id === rec.entity.parentId);
        if (parentExists) {
          visiting.delete(entityId);
          return null;
        }
      } else {
        const parentWorld = worldFor(rec.entity.parentId, visiting);
        if (!parentWorld) {
          visiting.delete(entityId);
          return null;
        }
        world = composeWorldTransform(parentWorld, rec.localTransform);
      }
    }
    visiting.delete(entityId);
    worldMemo.set(entityId, world);
    return world;
  };

  const output = [];
  const entityById = new Map(entities.map((e) => [e.id, e]));
  for (const rec of locals.values()) {
    const world = worldFor(rec.entity.id);
    if (!world) continue;
    const { entity, localTransform, localTime } = rec;
    output.push({
      entity,
      transform: world,
      localTransform,
      localTime,
      depth: getAncestorChain(entityById, entity.id).length,
    });
  }
  return output;
}
