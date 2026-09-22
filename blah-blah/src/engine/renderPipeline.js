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
// ---------------------------------------------------------------------------
// PERF BASELINE -- active-entity resolution on a long project
// ---------------------------------------------------------------------------
// Recorded 2026-09-22 while moving the per-frame visibility work out of
// computeActiveEntitiesAtTime and into buildActiveEntityIndex (below). These
// are PURE-FUNCTION numbers from `npm run bench:index` (node, synthetic
// one-hour project: 3000 video clips + parented audio children = 3750
// entities, 6 tracks), NOT in-app frame times -- React/canvas/preview work is
// not included, so treat them as a lower bound on the win and the ratio as
// the meaningful part.
//
//   before (rebuild entityMap+trackMap, filter every entity, walk each
//           entity's parent chain, one new Set() per entity, every call):
//     0.312 ms/call linear playback, 0.336 ms/call random scrubbing
//   after  (index built once per project change; per call = binary search
//           plus a short backward walk):
//     0.001 ms/call playback, 0.001 ms/call scrubbing   (~230x / ~330x)
//   index build (one-off, per entities/tracks change): 4.4 ms
//
// At 60fps that removes roughly 0.31 ms of CPU per frame (about 19 ms of CPU
// per second of playback) plus ~3750 Map entries and ~3750 short-lived Sets
// per frame of allocation/GC pressure -- the allocation churn is likely the
// larger real-world effect. A 30-60 minute project with thousands of clips is
// exactly the case this was measured on.
//
// STILL TO MEASURE IN-APP (needs the one-hour test project, per the plan):
// CPU usage and frame timing during playback before/after, and that a re-
// export of the same project is byte-for-byte unchanged (export's call sites
// are untouched but share this refactor). Re-run `npm run bench:index` after
// any change here and update the numbers above.

import { executeScriptComponent, detectScriptKind } from './scriptRunner.js';
import { resolveKeyframedComponents } from './keyframes.js';
import { isScriptComponent, isVideoEntity, isTransitionClipEntity, getTransitionClipComponent } from './ecs.js';
 
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
    speed: childLocal.speed !== undefined ? childLocal.speed : (parentWorld.speed ?? 1),
  };
}
 
/**
 * Resolve ONE entity's LOCAL transform (keyframes + motion scripts) at its
 * own local time. Pure per-entity work, shared by every entity that is
 * scene-active at `time`.
 * Returns { entity: resolvedEntity, localTransform, localTime }.
 */
function resolveEntityLocal({ entity, scripts, time, fps, allEntities = [], allAssets = [] }) {
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
        allEntities,
        allAssets,
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
 
// ---------------------------------------------------------------------------
// Active-entity index (playback performance)
// ---------------------------------------------------------------------------
//
// WHY THIS EXISTS. computeActiveEntitiesAtTime is called once per rendered
// frame by the live preview, and `time` changes every frame during playback,
// so ANY memo the caller wraps around it is guaranteed to miss: the old body
// therefore rebuilt an entityMap + trackMap from the whole entities/tracks
// arrays, ran a filter() that walked every entity's parent chain, and then
// resolved transforms — 60 times a second, for a project that may hold
// thousands of clips. Export has the same shape but only once per frame.
//
// None of the VISIBILITY work depends on `time`: an entity's own window and
// the intersection of that window with every ancestor's window (plus the
// active flag and each track's visible/locked state) are a function of
// entities + tracks alone. So they are computed here, once per project
// change, into:
//
//   - `windows`:   Map<entityId, { start, end }> — the intersected window,
//   - `entries`:   the same windows SORTED by start, plus a prefix-max of
//                  `end` so "which entities are live at T" is a binary search
//                  followed by a short backward walk that stops as soon as no
//                  entry at or before the cursor can still be live,
//   - `activeAt(time)`: the query, returning entities in their ORIGINAL
//                  entities-array order (the order the old filter produced,
//                  so paint/z-order in the preview cannot change).
//
// The result is memoized on the entities/tracks array reference. That identity
// check is sound for this codebase: every real mutation path replaces the
// array (`setEntities((prev) => prev.map(...))`, `.concat(...)`), so a new
// array reference always accompanies a change.

/** entities array -> { tracks, index }; weak, so nothing is retained. See
 * buildActiveEntityIndex. */
const indexCache = new WeakMap();

/**
 * Precompute per-entity active windows for a project. Pure; memoized on the
 * `entities`/`tracks` array references via a WeakMap (self-invalidating — a
 * new array is a new cache key, and nothing is retained past the arrays'
 * own lifetimes).
 *
 * Equivalent to the old per-call `isEntityVisible` walk, EXACTLY:
 *   - an entity is live at T iff it is not a TransitionClip, `active !== false`,
 *     its track is `visible` and not `locked`, T is inside its own
 *     [startTime, startTime + duration), and T is inside every ancestor's
 *     window too (an orphaned parentId ends the walk, as before),
 *   - a cycle in the parent chain stops the walk instead of looping,
 *   - a non-finite duration is treated as "unbounded" (the old `time >= start +
 *     undefined` comparison was false, i.e. the clip never expired),
 *   - a zero/negative-length window is never live.
 *
 * @returns {{
 *   entities: any[],
 *   tracks: any[],
 *   entityMap: Map<string, any>,
 *   trackMap: Map<string, any>,
 *   windows: Map<string, { start: number, end: number }>,
 *   entries: Array<{ id: string, entity: any, start: number, end: number, order: number }>,
 *   size: number,
 *   activeAt: (time: number) => any[],
 * }}
 */
export function buildActiveEntityIndex({ entities, tracks = [] }) {
  const list = entities || [];
  if (Array.isArray(list)) {
    const cached = indexCache.get(list);
    if (cached && cached.tracks === tracks) return cached.index;
  }

  const entityMap = new Map(list.map((e) => [e.id, e]));
  const trackMap = new Map((tracks || []).map((t) => [t.id, t]));

  const ownWindow = (e) => {
    if (!e || e.active === false) return null;
    const track = trackMap.get(e.trackId);
    if (track && (!track.visible || track.locked)) return null;
    const start = e.startTime || 0;
    const duration = e.duration;
    // NaN/undefined duration behaved as "never expires" in the old
    // comparison chain; Infinity preserves that here.
    const end = Number.isFinite(duration) ? start + duration : Infinity;
    return { start, end };
  };

  const windows = new Map();
  const entries = [];

  for (let i = 0; i < list.length; i++) {
    const entity = list[i];
    // Transition clips (ecs.js createTransitionClipEntity) are not drawable
    // entities: they have no Transform/renderer of their own and are resolved
    // by resolveTransitionClipAtTime below instead. Left in, they would come
    // back as ordinary active entities with identity transforms and show up
    // in the preview as phantom, selectable, empty layers.
    if (!entity || isTransitionClipEntity(entity)) continue;

    let start = -Infinity;
    let end = Infinity;
    let visible = true;
    const visited = new Set();
    let curr = entity;

    while (curr) {
      if (visited.has(curr.id)) break; // Cycle guard
      visited.add(curr.id);
      const win = ownWindow(curr);
      if (!win) {
        visible = false;
        break;
      }
      if (win.start > start) start = win.start;
      if (win.end < end) end = win.end;
      if (!curr.parentId) break;
      curr = entityMap.get(curr.parentId);
      if (!curr) break; // Orphaned child whose parent doesn't exist
    }

    if (!visible || start >= end) continue;
    windows.set(entity.id, { start, end });
    entries.push({ id: entity.id, entity, start, end, order: i });
  }

  entries.sort((a, b) => a.start - b.start || a.order - b.order);

  // starts[] for the binary search; prefixMaxEnd[i] is the largest `end` among
  // entries[0..i] — when it is <= T, no entry at or before i can still be live,
  // which terminates the backward walk early instead of scanning the prefix.
  const starts = new Float64Array(entries.length);
  const prefixMaxEnd = new Float64Array(entries.length);
  let maxEnd = -Infinity;
  for (let i = 0; i < entries.length; i++) {
    starts[i] = entries[i].start;
    if (entries[i].end > maxEnd) maxEnd = entries[i].end;
    prefixMaxEnd[i] = maxEnd;
  }

  const activeAt = (time) => {
    // Rightmost entry with start <= time. Entries at or before that index are
    // the only candidates (an entry starting after `time` cannot be live).
    let lo = 0;
    let hi = entries.length - 1;
    let last = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= time) {
        last = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (last < 0) return [];

    const hits = [];
    for (let i = last; i >= 0; i--) {
      if (prefixMaxEnd[i] <= time) break;
      if (entries[i].end > time) hits.push(entries[i]);
    }
    if (hits.length === 0) return [];
    // Restore the entities-array order the old full-array filter() produced,
    // so stacking/paint order for overlapping clips is unchanged.
    if (hits.length > 1) hits.sort((a, b) => a.order - b.order);
    return hits.map((h) => h.entity);
  };

  const index = {
    entities: list,
    tracks,
    entityMap,
    trackMap,
    windows,
    entries,
    size: entries.length,
    activeAt,
  };

  if (Array.isArray(list)) indexCache.set(list, { tracks, index });
  return index;
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
 * @param {{ entities: any[], tracks: any[], scripts?: any[], time: number, fps?: number, allAssets?: any[], index?: object }} args
 * @param {object} [args.index] A precomputed index from buildActiveEntityIndex for
 *   the SAME `entities`/`tracks` references. Optional: when omitted (export's
 *   per-frame calls, every test) one is built — and memoized — internally, so
 *   both routes share one visibility implementation. See buildActiveEntityIndex.
 */
export function computeActiveEntitiesAtTime({ entities, tracks = [], scripts = [], time, fps = 30, allAssets = [], index = null }) {
  // The visibility rule lives in ONE place: the index. Callers that already
  // hold an index for this exact entities/tracks pair (the live preview, which
  // rebuilds it only when the project changes — see EntityRenderer.jsx) skip
  // straight to transform resolution; everyone else gets the memoized index
  // built for them below. No parallel filter implementation exists to drift.
  const idx =
    index && index.entities === entities && index.tracks === tracks
      ? index
      : buildActiveEntityIndex({ entities, tracks });
 
  const activeEntities = idx.activeAt(time);
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
        allEntities: entities,
        allAssets,
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
 
    // Transition State resolution (TransitionComponent)
    const transComp = local.entity.components?.find((c) => c.type === 'TransitionComponent' && c.enabled !== false);
    let transitionState = null;
    if (transComp) {
      const { transitionIn, transitionOut } = transComp;
      const lt = local.localTime;
      const dur = local.entity.duration || 1;
 
      let inProgress = null;
      if (transitionIn?.enabled && transitionIn.duration > 0 && lt >= 0 && lt < transitionIn.duration) {
        inProgress = Math.max(0, Math.min(1, lt / transitionIn.duration));
      }
 
      let outProgress = null;
      if (transitionOut?.enabled && transitionOut.duration > 0) {
        const outStart = Math.max(0, dur - transitionOut.duration);
        if (lt >= outStart && lt <= dur) {
          outProgress = Math.max(0, Math.min(1, (lt - outStart) / transitionOut.duration));
        }
      }
 
      if (inProgress !== null || outProgress !== null) {
        transitionState = {
          type: inProgress !== null ? 'in' : 'out',
          progress: inProgress !== null ? inProgress : outProgress,
          presetId: inProgress !== null ? (transitionIn.preset || 'glitchMemories') : (transitionOut.preset || 'crossZoom'),
          customGlsl: inProgress !== null ? transitionIn.customGlsl : transitionOut.customGlsl,
          params: inProgress !== null ? transitionIn.params : transitionOut.params,
          inProgress,
          outProgress,
        };
      }
    }
 
    output.push({
      entity: local.entity,
      transform: worldTransform,
      localTransform: local.localTransform,
      localTime: local.localTime,
      depth,
      transitionState,
    });
  }
  return output;
}
 
// ---------------------------------------------------------------------------
// TransitionClip resolution (A → B transition placed on the cut between two
// back-to-back clips)
// ---------------------------------------------------------------------------
//
// computeActiveEntitiesAtTime above is intentionally NOT changed by this:
// it keeps returning a flat array of ordinary active entities, and all of its
// callers (EntityRenderer.jsx, exportRunner.js, ExportModal.jsx) keep working
// exactly as before. Transition clips are resolved by the separate functions
// below, so a project with no transition clips behaves identically.
//
// Geometry. A transition clip T is centred on a CUT:
//
//        A ends ─┐ ┌─ B starts
//   [ clip A ────┼─┼──── clip B ]
//        [   T   ]              T.start .. T.start + T.duration
//                └ cut = T.start + T.duration / 2
//
// While T is active, A and B are both drawn "as if they continued": A past
// its own end, B before its own start. That needs spare footage in each
// source file (the part outside the clip's in/out points, "handles"). When a
// side has none, it holds its first/last real frame instead of failing.
 
/** Two clip edges count as "the same cut" when they are within this many seconds. */
export const TRANSITION_CUT_TOLERANCE = 0.05;
 
/**
 * Media time (seconds into the source file) for `entity` at timeline `time`.
 * Same formula the preview (useMediaSync.js) and export (ExportModal.jsx)
 * already use for video: (time − startTime) × speed + mediaOffset, where
 * speed = VideoRenderer.speed × Transform.speed. `time` may lie OUTSIDE the
 * clip's own window — that is the whole point (handle footage).
 *
 * `transformSpeed` lets a caller pass the keyframe-resolved Transform.speed;
 * when omitted the raw component value is used.
 */
export function mediaTimeForClipAt(entity, time, transformSpeed) {
  const videoComp = entity?.components?.find((c) => c.type === 'VideoRenderer') || {};
  const rawTransformSpeed = entity?.components?.find((c) => c.type === 'Transform')?.speed;
  const speed = (videoComp.speed || 1) * (transformSpeed ?? rawTransformSpeed ?? 1);
  const offset = videoComp.mediaOffset || 0;
  return (time - (entity?.startTime || 0)) * speed + offset;
}
 
/**
 * Find the clips on either side of a transition clip's cut.
 *
 * A = a video clip on the SAME track whose end is at the cut.
 * B = a video clip on the SAME track whose start is at the cut.
 * Returns { a, b, cut }, where a/b are entities or null. Never throws.
 */
export function findTransitionNeighbours(transitionEntity, entities) {
  const cut = (transitionEntity?.startTime || 0) + (transitionEntity?.duration || 0) / 2;
  let a = null;
  let b = null;
  let bestA = Infinity;
  let bestB = Infinity;
 
  for (const e of entities || []) {
    if (!e || e.id === transitionEntity.id) continue;
    if (e.active === false) continue;
    if (e.trackId !== transitionEntity.trackId) continue;
    if (!isVideoEntity(e) || isTransitionClipEntity(e)) continue;
 
    const end = (e.startTime || 0) + (e.duration || 0);
    const start = e.startTime || 0;
 
    const gapA = Math.abs(end - cut);
    if (gapA <= TRANSITION_CUT_TOLERANCE && gapA < bestA) {
      a = e;
      bestA = gapA;
    }
    const gapB = Math.abs(start - cut);
    if (gapB <= TRANSITION_CUT_TOLERANCE && gapB < bestB) {
      b = e;
      bestB = gapB;
    }
  }
  return { a, b, cut };
}
 
/**
 * How much handle footage is available around a cut, in seconds of TIMELINE
 * time (already divided by the clip's speed). Used both to clamp a new
 * transition clip's length and to warn before export.
 *
 * `mediaDurations` is an optional { [entityId]: sourceFileDurationSeconds }.
 * Without it the tail handle of A is unknown (Infinity — assumed available).
 * B's head handle is always known: it is just its mediaOffset.
 */
export function getTransitionHandles(a, b, mediaDurations = {}) {
  const speedOf = (e) => {
    const vc = e?.components?.find((c) => c.type === 'VideoRenderer') || {};
    const ts = e?.components?.find((c) => c.type === 'Transform')?.speed;
    const sp = (vc.speed || 1) * (ts ?? 1);
    return sp > 0 ? sp : 1;
  };
 
  // Head of B: media before its in-point.
  let headBefore = 0;
  if (b) {
    const vc = b.components?.find((c) => c.type === 'VideoRenderer') || {};
    headBefore = Math.max(0, (vc.mediaOffset || 0) / speedOf(b));
  }
 
  // Tail of A: media after its out-point.
  let tailAfter = Infinity;
  if (a) {
    const total = mediaDurations[a.id];
    if (Number.isFinite(total) && total > 0) {
      const outPoint = mediaTimeForClipAt(a, (a.startTime || 0) + (a.duration || 0));
      tailAfter = Math.max(0, (total - outPoint) / speedOf(a));
    }
  }
  return { headBefore, tailAfter };
}
 
/**
 * { [clipId]: sourceFileSeconds } for every video clip whose media asset has a
 * probed duration. Clips find their asset by url — the same convention
 * ClipItem's isMissingSrc uses. This is the edit-time stand-in for the
 * `mediaDurations` map export builds from loaded <video> elements, and feeds
 * getTransitionHandles / planTransitionPlacement / maxTransitionDuration so
 * the timeline can measure A's tail handle without loading any video.
 */
export function buildMediaDurationsFromAssets(entities, mediaAssets) {
  const out = {};
  for (const e of entities || []) {
    if (!e || !isVideoEntity(e)) continue;
    const vc = e.components?.find((c) => c.type === 'VideoRenderer');
    const src = vc?.src || e.src;
    if (!src) continue;
    const asset = (mediaAssets || []).find((m) => m.url === src);
    if (asset && Number.isFinite(asset.duration) && asset.duration > 0) out[e.id] = asset.duration;
  }
  return out;
}
 
/** Shortest transition clip the timeline will create, in seconds. */
export const TRANSITION_MIN_DURATION = 0.1;
 
/** Default length for a new transition clip before handle clamping, in seconds. */
export const TRANSITION_DEFAULT_DURATION = 1;
 
/**
 * Pure planner for "add a transition at the cut between two clips".
 *
 * Shared by the timeline action (useEntityActions.handleAddTransitionClip),
 * the menu entry and the drop path, so the rules live in ONE place:
 *
 *   - Candidates are video clips on `trackId` (never transition clips,
 *     never inactive ones).
 *   - A cut is an (A, B) pair where B starts where A ends, within
 *     TRANSITION_CUT_TOLERANCE — the same tolerance findTransitionNeighbours
 *     uses, so anything planned here is guaranteed to resolve later.
 *   - With no `nearTime`, the cut closest to `referenceTime` (the playhead
 *     or the drop position) is used; ties go to the earlier cut.
 *   - The transition is centred on the cut and clamped so that half its
 *     length fits in each side's handle footage (getTransitionHandles),
 *     and to half of each neighbour's timeline length, so it can never
 *     reach past a clip's far edge.
 *   - A cut that already carries a transition clip is reported as
 *     'already-has-transition' rather than stacking a second one.
 *
 * Returns { ok: true, trackId, startTime, duration, cut, a, b, clamped }
 * or { ok: false, reason, message } — never throws. `clamped` is true when
 * the length was reduced below the requested one.
 *
 * `mediaDurations` is { [clipId]: sourceFileSeconds }; without an entry for A
 * its tail handle is treated as unknown/unlimited, exactly as in
 * getTransitionHandles.
 */
export function planTransitionPlacement({
  entities,
  trackId,
  referenceTime = 0,
  duration = TRANSITION_DEFAULT_DURATION,
  mediaDurations = {},
}) {
  const clipCount = (entities || []).filter(
    (e) => e && e.active !== false && e.trackId === trackId && isVideoEntity(e) && !isTransitionClipEntity(e),
  ).length;
  if (clipCount < 2) {
    return {
      ok: false,
      reason: 'no-pair',
      message: 'A transition needs two video clips that touch on the same track. Place the clips back to back first.',
    };
  }
 
  const pairs = listTransitionCuts(entities, trackId);
  if (pairs.length === 0) {
    return {
      ok: false,
      reason: 'no-pair',
      message: 'These clips do not touch. Move them so one ends exactly where the next begins, then add the transition.',
    };
  }
 
  pairs.sort((p, q) => Math.abs(p.cut - referenceTime) - Math.abs(q.cut - referenceTime) || p.cut - q.cut);
  const { a, b, cut } = pairs[0];
 
  const existing = (entities || []).some((e) => {
    if (!isTransitionClipEntity(e) || e.trackId !== trackId) return false;
    return Math.abs((e.startTime || 0) + (e.duration || 0) / 2 - cut) <= TRANSITION_CUT_TOLERANCE;
  });
  if (existing) {
    return { ok: false, reason: 'already-has-transition', message: 'This cut already has a transition.' };
  }
 
  const { headBefore, tailAfter } = getTransitionHandles(a, b, mediaDurations);
  // Half the transition extends past A's end (needs A's tail handle) and half
  // before B's start (needs B's head handle), so total = 2 × the smaller half.
  // Also never longer than the shorter neighbour, or it would cross a far edge.
  const halfLimit = Math.min(headBefore, tailAfter, (a.duration || 0) / 2, (b.duration || 0) / 2);
  const requested = Math.max(TRANSITION_MIN_DURATION, Number(duration) || TRANSITION_DEFAULT_DURATION);
  const finalDuration = Math.min(requested, 2 * halfLimit);
 
  // With no spare footage at all the transition is still allowed: each side
  // then holds its last/first frame (the resolver's hold flag). Use the
  // minimum length so it stays a short, deliberate freeze rather than nothing.
  const usable = finalDuration >= TRANSITION_MIN_DURATION;
  const length = usable ? finalDuration : Math.min(requested, TRANSITION_MIN_DURATION * 5, (a.duration || 0), (b.duration || 0));
 
  return {
    ok: true,
    trackId,
    startTime: Math.max(0, cut - length / 2),
    duration: length,
    cut,
    a,
    b,
    clamped: length < requested - 1e-9,
    noHandles: !usable,
  };
}
 
/**
 * Every cut on `trackId` that a transition could sit on: a list of
 * { cut, a, b } for each pair of video clips where B starts where A ends
 * (same tolerance as findTransitionNeighbours). Sorted by cut time.
 * Shared by the timeline (snap targets) and planTransitionPlacement's pairing
 * rule, so "is this a real cut" has one definition.
 */
export function listTransitionCuts(entities, trackId) {
  const clips = (entities || []).filter(
    (e) => e && e.active !== false && e.trackId === trackId && isVideoEntity(e) && !isTransitionClipEntity(e),
  );
  const endOf = (e) => (e.startTime || 0) + (e.duration || 0);
  const cuts = [];
  for (const a of clips) {
    for (const b of clips) {
      if (a.id === b.id) continue;
      if (Math.abs(endOf(a) - (b.startTime || 0)) <= TRANSITION_CUT_TOLERANCE) {
        cuts.push({ cut: (endOf(a) + (b.startTime || 0)) / 2, a, b });
      }
    }
  }
  return cuts.sort((p, q) => p.cut - q.cut);
}
 
/**
 * Longest a transition clip may be at `cut` between clips a and b, in
 * seconds: twice the smaller of {B's head handle, A's tail handle, half of
 * either neighbour's length}. This is the single ceiling used when dragging
 * a transition's edges, and matches what planTransitionPlacement grants at
 * creation. `mediaDurations` as in getTransitionHandles.
 */
export function maxTransitionDuration(a, b, mediaDurations = {}) {
  const { headBefore, tailAfter } = getTransitionHandles(a, b, mediaDurations);
  const half = Math.min(headBefore, tailAfter, (a?.duration || 0) / 2, (b?.duration || 0) / 2);
  return Math.max(0, 2 * half);
}
 
/**
 * Geometry of a transition clip after the user drags one of its edges.
 *
 * A transition is defined by its cut (centre) and total length, and the
 * resolver derives the cut as start + duration / 2, so an edge drag must keep
 * the CENTRE fixed and change the length symmetrically: dragging either edge
 * by d seconds changes the length by 2d. The length is clamped to
 * [TRANSITION_MIN_DURATION, maxDuration]; the start is recomputed from the
 * fixed centre, never allowed below 0.
 *
 *   edge   'start' | 'end'
 *   origStart, origDuration   the clip's geometry when the drag began
 *   rawEdgeTime   where the pointer wants that edge, in timeline seconds
 *   maxDuration   e.g. from maxTransitionDuration (Infinity = unbounded)
 *
 * Returns { startTime, duration }.
 */
export function resizeTransitionAboutCut({ edge, origStart, origDuration, rawEdgeTime, maxDuration = Infinity }) {
  const cut = origStart + origDuration / 2;
  const halfWanted = edge === 'start' ? cut - rawEdgeTime : rawEdgeTime - cut;
  const ceiling = Number.isFinite(maxDuration) ? Math.max(TRANSITION_MIN_DURATION, maxDuration) : Infinity;
  // Never let the (fixed-centre) start go below 0 either.
  const byZero = cut * 2;
  const duration = Math.max(TRANSITION_MIN_DURATION, Math.min(halfWanted * 2, ceiling, byZero));
  return { startTime: cut - duration / 2, duration };
}
 
/**
 * Where a transition clip lands after being moved. A transition only makes
 * sense ON a cut, so instead of following the pointer freely it snaps its
 * CENTRE to the nearest cut on the track (the track under the pointer).
 * Returns { startTime, cut, a, b } for the chosen cut with `duration` kept
 * as-is but re-clamped to that cut's handle footage, or null when the track
 * has no cut at all (caller then leaves the clip where it was).
 */
export function snapTransitionToCut({ entities, trackId, rawCentreTime, duration, mediaDurations = {} }) {
  const cuts = listTransitionCuts(entities, trackId);
  if (cuts.length === 0) return null;
  let best = cuts[0];
  for (const c of cuts) {
    if (Math.abs(c.cut - rawCentreTime) < Math.abs(best.cut - rawCentreTime)) best = c;
  }
  const ceiling = maxTransitionDuration(best.a, best.b, mediaDurations);
  const len = Math.max(TRANSITION_MIN_DURATION, Math.min(duration, ceiling > 0 ? ceiling : duration));
  return { startTime: Math.max(0, best.cut - len / 2), duration: len, cut: best.cut, a: best.a, b: best.b };
}
 
// ---------------------------------------------------------------------------
// Pre-export audit
// ---------------------------------------------------------------------------
 
/**
 * Seconds of slack allowed when comparing a transition's length with the
 * handle footage around its cut. Handles come from probed media durations and
 * mediaOffset arithmetic, so a transition placed at exactly the limit can be
 * a hair over after floating-point round trips; that must not raise a warning.
 */
export const TRANSITION_HANDLE_EPSILON = 0.02;
 
/**
 * Look at every transition clip a user could have in the project and report
 * the ones that will NOT render as the transition they see on the timeline,
 * so the export dialog can say so BEFORE rendering instead of silently
 * producing a hard cut (or a frozen frame) where a blend was expected.
 *
 * Which transitions count is decided exactly like the resolver and the audio
 * windows decide it (resolveTransitionClipAtTime, getTransitionAudioWindows):
 * a transition that is inactive, disabled, zero-length or on a hidden/locked
 * track contributes nothing to the export, so it is not audited either. A
 * warning about something the export ignores anyway would be noise.
 *
 * `exportRange` ({ in, out } seconds, either may be missing) skips transitions
 * that lie wholly outside the exported span, for the same reason.
 *
 * Each finding is
 *   { id, name, trackId, time, kind, message }
 * where `kind` is one of
 *   'no-pair'        neither neighbour: the clip is not on a cut at all
 *   'no-before'      nothing ends at the cut (clip A missing)
 *   'no-after'       nothing starts at the cut (clip B missing)
 *   'no-handles'     both neighbours exist but neither has spare footage, so
 *                    both sides freeze for the whole blend
 *   'short-handles'  some spare footage, but less than the transition needs,
 *                    so part of the blend freezes
 * and `time` is the cut position (or the clip's centre when there is no cut).
 *
 * Handle maths is getTransitionHandles / maxTransitionDuration, the same
 * numbers the timeline used to clamp the length when the clip was made, so the
 * dialog and the timeline can never disagree. `mediaDurations` is
 * { [clipId]: sourceSeconds }; a clip missing from it has an UNKNOWN tail
 * (treated as available, as everywhere else) rather than a warning, since
 * guessing "no footage" from missing data would cry wolf.
 *
 * Returns [] when the project has no transition clips, so it costs nothing
 * for existing projects. Never throws.
 */
export function auditTransitionClips({ entities, tracks = [], mediaDurations = {}, exportRange = null }) {
  const findings = [];
  const rangeIn = Number.isFinite(exportRange?.in) ? exportRange.in : -Infinity;
  const rangeOut = Number.isFinite(exportRange?.out) ? exportRange.out : Infinity;
 
  for (const t of entities || []) {
    if (!isTransitionClipEntity(t)) continue;
    if (t.active === false) continue;
 
    const start = t.startTime || 0;
    const duration = t.duration || 0;
    if (!(duration > 0)) continue;
 
    const track = (tracks || []).find((tr) => tr.id === t.trackId);
    if (track && (!track.visible || track.locked)) continue;
    const comp = getTransitionClipComponent(t);
    if (comp && comp.enabled === false) continue;
 
    const end = start + duration;
    if (end <= rangeIn || start >= rangeOut) continue;
 
    const name = t.name || 'Transition';
    const { a, b, cut } = findTransitionNeighbours(t, entities);
    const base = { id: t.id, name, trackId: t.trackId };
 
    if (!a || !b) {
      const kind = !a && !b ? 'no-pair' : !a ? 'no-before' : 'no-after';
      const message = kind === 'no-pair'
        ? `"${name}" is not on a cut between two clips, so it will be skipped and the clips play normally.`
        : kind === 'no-before'
          ? `"${name}" has no clip ending at its cut, so it will be skipped and the clip after it plays normally.`
          : `"${name}" has no clip starting at its cut, so it will be skipped and the clip before it plays normally.`;
      findings.push({ ...base, time: kind === 'no-pair' ? start + duration / 2 : cut, kind, message });
      continue;
    }
 
    // Both neighbours exist. Half the blend runs past A's end (A's tail) and
    // half before B's start (B's head); each side has its OWN limit, so the
    // usable blend is twice the smaller half, the same rule
    // planTransitionPlacement uses. Only the spare-footage limits matter
    // here: a clip being shorter than the transition is a layout question,
    // not a footage one, and is deliberately not reported.
    const { headBefore, tailAfter } = getTransitionHandles(a, b, mediaDurations);
    const usableHalf = Math.min(headBefore, tailAfter);
    const usable = 2 * usableHalf;
 
    if (usable <= TRANSITION_HANDLE_EPSILON) {
      findings.push({
        ...base,
        time: cut,
        kind: 'no-handles',
        message: `"${name}" has no spare footage past the cut, so both clips will freeze on a single frame during the blend.`,
      });
    } else if (usable < duration - TRANSITION_HANDLE_EPSILON) {
      findings.push({
        ...base,
        time: cut,
        kind: 'short-handles',
        message: `"${name}" is ${duration.toFixed(2)}s long but the spare footage around its cut only covers ${usable.toFixed(2)}s, so part of the blend will freeze on a single frame.`,
      });
    }
  }
 
  findings.sort((p, q) => p.time - q.time);
  return findings;
}
 
// ---------------------------------------------------------------------------
// Transition AUDIO (crossfade across the window)
// ---------------------------------------------------------------------------
//
// The picture blends A into B across the transition clip's window; the sound
// must do the same or the cut pops (both tracks at full level, doubled up) or
// clicks (one track cut off dead at the cut). Both the live preview
// (useMediaSync.js) and the export mixdown (exportRunner.js) read the SAME
// functions below, so what you hear scrubbing is what gets exported.
 
/**
 * Crossfade gain (0..1) for one side of a transition at `progress` (0..1
 * across the transition window). EQUAL-POWER, not linear: a linear fade of
 * two uncorrelated sources dips ~3 dB in the middle (a audible "hole" at the
 * cut); cos/sin keeps a*a + b*b = 1 so the combined loudness stays constant.
 * side 'from' (clip A) fades out, 'to' (clip B) fades in.
 */
export function transitionCrossfadeGain(side, progress) {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return side === 'from' ? Math.cos(p * Math.PI / 2) : Math.sin(p * Math.PI / 2);
}
 
/**
 * Combine the per-transition envelopes of ONE clip that sits on several
 * transitions (typically B of one cut and A of the next). Inside any
 * transition window that transition's envelope rules; outside all of them
 * the clip is untouched (1) provided it is in its "own" stretch, i.e. after
 * its fade-in windows and before its fade-out windows. Evaluated by finding
 * the window the time falls in, else the nearest window edge's held value,
 * so the result stays continuous and 0..1.
 */
function combineTransitionEnvelopes(parts) {
  const sorted = [...parts].sort((p, q) => p.start - q.start);
  return (time) => {
    for (const p of sorted) {
      if (time > p.start && time < p.end) return p.gainAt(time);
    }
    // Between/around windows: hold the value of the closest window boundary
    // that is at or before `time`, else at or after it (start of timeline).
    let before = null;
    let after = null;
    for (const p of sorted) {
      if (p.end <= time) before = p;
      else if (p.start >= time && !after) after = p;
    }
    if (before) return before.side === 'to' ? 1 : 0; // after a fade-in: full; after a fade-out: gone
    if (after) return after.side === 'from' ? 1 : 0; // before a fade-out: full; before a fade-in: not yet
    return 1;
  };
}
 
/**
 * For every clip that is the A or B side of a VALID transition clip (one
 * with both neighbours found), the audio envelope it needs. Returns a
 * Map<entityId, { start, end, gainAt(t) }>:
 *
 *   start / end   the transition window in timeline seconds — the clip must
 *                 stay AUDIBLE for all of it, including the part outside its
 *                 own [startTime, startTime + duration) (that is where A's
 *                 tail / B's head play under the blend; consumers UNION this
 *                 with the clip's own window).
 *   gainAt(t)     0..1 multiplier: 1 outside the window (so applying it to a
 *                 clip's whole audible range is harmless), the equal-power
 *                 fade across it.
 *
 * Empty Map when the project has no valid transition clips, so callers can
 * pass it unconditionally at no cost and existing projects are unchanged.
 *
 * If one clip is the B of one transition and the A of the next (two
 * transitions on consecutive cuts), the two envelopes are MULTIPLIED (the
 * clip fades in at the head and out at the tail), with a window spanning
 * both. Invalid transitions (missing neighbour) contribute nothing, exactly
 * like resolveTransitionFramePlan, so audio and picture agree about which
 * transitions are live.
 */
export function getTransitionAudioWindows({ entities, tracks = [] }) {
  const out = new Map();
  for (const t of entities || []) {
    if (!isTransitionClipEntity(t) || t.active === false) continue;
    const start = t.startTime || 0;
    const duration = t.duration || 0;
    if (!(duration > 0)) continue;
    const track = (tracks || []).find((tr) => tr.id === t.trackId);
    if (track && (!track.visible || track.locked)) continue;
    const comp = getTransitionClipComponent(t);
    if (comp && comp.enabled === false) continue;
 
    const { a, b } = findTransitionNeighbours(t, entities);
    if (!a || !b) continue;
    const end = start + duration;
 
    for (const [side, clip] of [['from', a], ['to', b]]) {
      // CONTINUOUS envelope: A is 1 before the window, fades to 0 across it,
      // and stays 0 after; B is 0 before, fades in across it, and is 1 after.
      // (An earlier version returned 1 outside the window for BOTH sides, so
      // B jumped 1 -> 0 the instant the window opened and the export ramp
      // started from full volume into silence: an audible pop, exactly what
      // this crossfade exists to prevent.) Being 0 where a clip is not
      // supposed to be heard costs nothing: consumers only audition a clip
      // over its own range UNIONED with this window, and outside both it is
      // not played at all.
      const gainAt = (time) => {
        if (time <= start) return side === 'from' ? 1 : 0;
        if (time >= end) return side === 'from' ? 0 : 1;
        return transitionCrossfadeGain(side, (time - start) / duration);
      };
 
      const prev = out.get(clip.id);
      if (!prev) {
        out.set(clip.id, { start, end, gainAt, _parts: [{ start, end, side, gainAt }] });
      } else {
        const parts = [...prev._parts, { start, end, side, gainAt }];
        out.set(clip.id, {
          start: Math.min(prev.start, start),
          end: Math.max(prev.end, end),
          gainAt: combineTransitionEnvelopes(parts),
          _parts: parts,
        });
      }
    }
  }
  return out;
}
 
/**
 * The audio envelope that applies to `entity`, or null. An AudioSource CHILD
 * clip (handleAddMediaToTimeline always pairs a video with an audio child)
 * is not itself a transition neighbour — its video PARENT is — so when the
 * entity has no envelope of its own the parent chain is checked, and the
 * audio fades with its picture. Cycle-safe.
 *
 * `windows` is getTransitionAudioWindows()'s Map (null/undefined/empty are
 * fine and return null); `entityMap` is Map<id, entity>.
 */
export function resolveTransitionAudioForEntity(entity, windows, entityMap) {
  if (!entity || !windows || windows.size === 0) return null;
  const seen = new Set();
  let curr = entity;
  while (curr && !seen.has(curr.id)) {
    seen.add(curr.id);
    const hit = windows.get(curr.id);
    if (hit) return hit;
    if (!curr.parentId) break;
    curr = entityMap?.get(curr.parentId);
  }
  return null;
}
 
/**
 * Resolve ONE transition clip at timeline `time`.
 *
 * Returns null when the transition clip is not active at `time` (or is
 * disabled / on a hidden or locked track). Otherwise:
 *
 *   {
 *     entity,            // the transition clip
 *     progress,          // 0..1 across the transition clip's own window
 *     presetId, customGlsl, params,
 *     valid,             // true only when BOTH neighbours were found
 *     reason,            // when !valid: 'no-a' | 'no-b' | 'no-neighbours'
 *     cut,
 *     from: { entity, mediaTime, hold } | null,   // clip A, extended past its end
 *     to:   { entity, mediaTime, hold } | null,   // clip B, extended before its start
 *   }
 *
 * `hold` is true when the requested media time fell outside the source file
 * (before 0, or past a known `mediaDurations` length); `mediaTime` is then
 * already clamped to the nearest real frame, so callers can seek to it
 * blindly and the side simply freezes.
 */
export function resolveTransitionClipAtTime({ transitionEntity, entities, tracks = [], time, mediaDurations = {} }) {
  if (!transitionEntity || !isTransitionClipEntity(transitionEntity)) return null;
  if (transitionEntity.active === false) return null;
 
  const start = transitionEntity.startTime || 0;
  const duration = transitionEntity.duration || 0;
  if (!(duration > 0)) return null;
  if (time < start || time >= start + duration) return null;
 
  const track = (tracks || []).find((t) => t.id === transitionEntity.trackId);
  if (track && (!track.visible || track.locked)) return null;
 
  const comp = getTransitionClipComponent(transitionEntity);
  if (comp && comp.enabled === false) return null;
 
  const progress = Math.max(0, Math.min(1, (time - start) / duration));
  const { a, b, cut } = findTransitionNeighbours(transitionEntity, entities);
 
  const side = (entity) => {
    if (!entity) return null;
    const raw = mediaTimeForClipAt(entity, time);
    let mediaTime = Math.max(0, raw);
    let hold = raw < 0;
    const total = mediaDurations[entity.id];
    if (Number.isFinite(total) && total > 0 && mediaTime > total) {
      mediaTime = total;
      hold = true;
    }
    return { entity, mediaTime, hold };
  };
 
  const valid = Boolean(a && b);
  let reason;
  if (!valid) reason = !a && !b ? 'no-neighbours' : !a ? 'no-a' : 'no-b';
 
  return {
    entity: transitionEntity,
    progress,
    presetId: comp?.preset || 'crossfade',
    customGlsl: comp?.customGlsl,
    params: comp?.params || {},
    valid,
    reason,
    cut,
    from: side(a),
    to: side(b),
  };
}
 
/**
 * Every transition clip active at `time`, resolved. Separate from
 * computeActiveEntitiesAtTime on purpose (see the note above): it returns [] when the project
 * has no transition clips, so calling it costs nothing for existing projects.
 */
export function computeActiveTransitionsAtTime({ entities, tracks = [], time, mediaDurations = {} }) {
  const out = [];
  for (const e of entities || []) {
    if (!isTransitionClipEntity(e)) continue;
    const resolved = resolveTransitionClipAtTime({ transitionEntity: e, entities, tracks, time, mediaDurations });
    if (resolved) out.push(resolved);
  }
  return out;
}
 
/**
 * The single answer to "which video elements must be seeked, and to what
 * media time, at this frame?" for every VALID transition clip active at
 * `time`. Both the export seek loop (ExportModal.jsx) and the draw pass
 * (exportRunner.js drawExportFrame) consume this, so the time a clip's
 * <video> is seeked to and the frame that is then drawn cannot drift.
 *
 * Returns:
 *   {
 *     transitions,            // resolved, VALID transitions only
 *     seekTimes,              // Map<entityId, { mediaTime, rate }> for every A and B
 *     suppressedIds,          // Set<entityId> of A/B: their NORMAL draw is replaced
 *   }
 *
 * `rate` is the effective playback rate (VideoRenderer.speed × Transform.speed).
 * When one clip is both the B of one transition and the A of the next (two
 * transitions on consecutive cuts), the first one listed wins the seek; the
 * windows only overlap when transitions are longer than the clip between them.
 * Invalid transitions (missing neighbour) contribute nothing: the clips they
 * would have blended are then drawn normally rather than vanishing.
 */
export function resolveTransitionFramePlan({ entities, tracks = [], time, mediaDurations = {} }) {
  const transitions = [];
  const seekTimes = new Map();
  const suppressedIds = new Set();
 
  for (const t of computeActiveTransitionsAtTime({ entities, tracks, time, mediaDurations })) {
    if (!t.valid) continue;
    transitions.push(t);
    for (const side of [t.from, t.to]) {
      if (!side) continue;
      suppressedIds.add(side.entity.id);
      if (seekTimes.has(side.entity.id)) continue;
      const vc = side.entity.components?.find((c) => c.type === 'VideoRenderer') || {};
      const ts = side.entity.components?.find((c) => c.type === 'Transform')?.speed;
      seekTimes.set(side.entity.id, { mediaTime: side.mediaTime, rate: (vc.speed || 1) * (ts ?? 1) });
    }
  }
  return { transitions, seekTimes, suppressedIds };
}