/**
 * Entity Component System (ECS) & Prefab models for blahblah
 * Modern JavaScript & React Component Architecture
 */
 
import { CURRENT_SCHEMA_VERSION } from '../types.js';
 
// ─── Project schema versioning ───────────────────────────────────────────────
//
// project.json carries a top-level `schemaVersion` (see CURRENT_SCHEMA_VERSION
// in types.js). These helpers live here (not in projectFileSystem.js) so the
// load-time version gate is a pure, Node-importable function the same way
// migrateEntities is — projectFileSystem.js can't be imported by the Node
// test harness because of its Vite `?raw` SDK import.
 
/**
 * Schema-level migration placeholder. project.json loads run this AFTER the
 * version gate and BEFORE per-entity component migration, so future
 * structure-level migrations (tracks, resolution, scriptIndex, ...) chain
 * here stepwise from `fromVersion` to `toVersion`. There are none yet:
 * the only real migration so far — the script type/extension unification —
 * happens per-entity in migrateEntities below, which is exactly the
 * schemaVersion 0 → 1 change.
 */
export function migrateProjectSchema(project, fromVersion, toVersion) {
  void fromVersion;
  void toVersion;
  return project;
}
 
/**
 * A saved project's schemaVersion, or 0 when it has none  (projects saved
 * before schemaVersion was introduced — the 0 → 1 boundary). Non-numeric
 * values (e.g. a hand-typed string in a VS Code edit) also read as 0.
 */
export function readProjectSchemaVersion(project) {
  return Number.isFinite(project?.schemaVersion) ? project.schemaVersion : 0;
}
 
/**
 * Version gate: warn (without blocking the load) when a project was saved
 * by a NEWER build than this one understands. Returns the warning message
 * string when it warned, or null otherwise, so callers can surface it in
 * the UI (previously this only ever reached `console.warn` — a project
 * saved by a newer build could silently lose data on next save with no
 * way for the user to know short of opening devtools). Projects newer
 * than CURRENT_SCHEMA_VERSION usually still open — fields the newer
 * build added are simply unknown to this one and are left untouched on
 * the next save.
 */
export function warnIfSchemaVersionTooNew(project) {
  const version = readProjectSchemaVersion(project);
  if (version > CURRENT_SCHEMA_VERSION) {
    const message =
      `project.json schemaVersion ${version} is newer than this build of blahblah supports (${CURRENT_SCHEMA_VERSION}). ` +
      'This project was created with a newer version of blahblah — some features may not work correctly.';
    console.warn(message);
    return message;
  }
  return null;
}
 
/**
 * P0 #1/#2 — Renderer component factory.
 *
 * `EntityRenderer.jsx` is the single unified renderer (replacing the old
 * split SceneViewport / PreviewWindow components). It doesn't hardcode a
 * switch-per-type; instead every renderable component type is described by
 * a small descriptor created here, which EntityRenderer looks up by
 * `component.type`.
 *
 * Renderer descriptors are `dom`-kind markers + metadata for the built-in
 * DOM-based renderers (Text/Shape/Video/Audio). Script-driven visuals
 * (React components, Canvas components, motion scripts) are ALL one
 * component type — `ScriptComponent` — whose runtime behavior is
 * dispatched by the script's detected kind (see detectScriptKind in
 * engine/scriptRunner.js), not by separate component types. This keeps
 * "add a new renderer type" a one-place registration instead of a
 * hand-written branch duplicated across viewport components.
 */
export function createRendererComponent(type, config = {}) {
  return {
    type,
    kind: config.kind || 'dom', // 'dom' | 'canvas'
    ...config,
  };
}
 
export const RENDERER_REGISTRY = {
  TextRenderer: createRendererComponent('TextRenderer', { kind: 'dom', label: 'Text Component' }),
  ShapeRenderer: createRendererComponent('ShapeRenderer', { kind: 'dom', label: 'Shape Component' }),
  VideoRenderer: createRendererComponent('VideoRenderer', { kind: 'dom', label: 'Video Component' }),
  AudioSource: createRendererComponent('AudioSource', { kind: 'dom', label: 'Audio Component' }),
  TransitionComponent: createRendererComponent('TransitionComponent', { kind: 'gl', label: 'GL Transition' }),
  // Data-only — holds timed subtitle phrases (see engine/subtitleTrack.js).
  // Renders nothing itself; a CanvasRenderer script reads it via
  // EntityRef.getPhraseAt/getCurrentText (engine/referenceTypes.js).
  SubtitleTrack: createRendererComponent('SubtitleTrack', { kind: 'data', label: 'Subtitle Track' }),
};
 
export function createTransitionComponent(config = {}) {
  return {
    type: 'TransitionComponent',
    enabled: config.enabled ?? true,
    ...config,
    transitionIn: {
      enabled: config.transitionIn?.enabled ?? true,
      preset: config.transitionIn?.preset ?? 'glitchMemories',
      duration: config.transitionIn?.duration ?? 0.8,
      params: config.transitionIn?.params ?? {},
    },
    transitionOut: {
      enabled: config.transitionOut?.enabled ?? false,
      preset: config.transitionOut?.preset ?? 'crossZoom',
      duration: config.transitionOut?.duration ?? 0.8,
      params: config.transitionOut?.params ?? {},
    },
  };
}
 
/**
 * True for any component that drives a script: motion scripts
 * (onStart/onUpdate against a transform), React components (a function
 * returning JSX), and Canvas components (onMount/onUpdate against a
 * container <div>) are all ONE component type, `ScriptComponent`.
 * `MonoBehaviour` is accepted here for backward compatibility with older
 * saved projects; project loading migrates those to `ScriptComponent`.
 * The script's contract is derived from its code at runtime via
 * detectScriptKind, never from the component type.
 */
export const isScriptComponent = (c) =>
  c?.type === 'ScriptComponent' || c?.type === 'MonoBehaviour';
 
/**
 * P0 #2 — single source of truth for "is this entity a video/audio clip".
 *
 * Previously this `entity.type === 'video' || components.some(VideoRenderer)`
 * check was hand-duplicated in EntityRenderer.jsx, ExportModal.jsx,
 * exportRunner.js, and Timeline/ClipItem.jsx. Duplicated checks like that
 * can silently drift (e.g. a VideoRenderer component gets removed but
 * `entity.type` is left stale as 'video', or vice versa) — different call
 * sites would then disagree about what an entity is. Route every check
 * through these two helpers instead.
 */
export const isVideoEntity = (entity) =>
  entity?.type === 'video' || Boolean(entity?.components?.some((c) => c.type === 'VideoRenderer'));
 
export const isAudioEntity = (entity) =>
  entity?.type === 'audio' || Boolean(entity?.components?.some((c) => c.type === 'AudioSource'));
 
// ─── TransitionClip (A → B transition placed on the cut between two clips) ──
 
/**
 * Component type carried by a TransitionClip entity. Holds the preset id,
 * optional custom GLSL and params. The entity's own `duration` is the
 * TOTAL transition length (half on each side of the cut).
 *
 * Deliberately a different component type from the legacy per-clip
 * `TransitionComponent` (createTransitionComponent above), which stays
 * untouched so existing projects render exactly as before.
 */
export const TRANSITION_CLIP_COMPONENT = 'TransitionClipComponent';
 
/** Entity `type` of a TransitionClip. NOT 'video' — see isTransitionClipEntity. */
export const TRANSITION_CLIP_TYPE = 'transition';
 
export function createTransitionClipComponent(config = {}) {
  return {
    type: TRANSITION_CLIP_COMPONENT,
    enabled: config.enabled ?? true,
    preset: config.preset ?? 'crossfade',
    customGlsl: config.customGlsl,
    params: config.params ?? {},
  };
}
 
/**
 * Build a TransitionClip entity. It is a plain timeline clip (id, trackId,
 * startTime, duration…) so the existing timeline/undo/save plumbing treats
 * it like any other entity, but it carries NO Transform and NO VideoRenderer:
 * it draws nothing itself and instead blends the clips on either side of its
 * cut (see resolveTransitionClipAtTime in renderPipeline.js).
 */
export function createTransitionClipEntity({
  name = 'Transition',
  trackId = 'track-1',
  startTime = 0,
  duration = 1,
  preset = 'crossfade',
  customGlsl,
  params = {},
  color = '#f59e0b',
} = {}) {
  return {
    id: `go-${crypto.randomUUID()}`,
    name,
    tag: 'Untagged',
    layer: 'Default',
    active: true,
    parentId: null,
    trackId,
    startTime,
    duration,
    type: TRANSITION_CLIP_TYPE,
    src: '',
    color,
    components: [createTransitionClipComponent({ preset, customGlsl, params })],
  };
}
 
/**
 * True for a TransitionClip entity. Checked by component too (not only by
 * `type`) so a stale `type` cannot make the two disagree, the same reasoning
 * as isVideoEntity below. Must be tested BEFORE isVideoEntity wherever both
 * could apply, and a TransitionClip never has a VideoRenderer, so it is never
 * mistaken for a video clip.
 */
export const isTransitionClipEntity = (entity) =>
  entity?.type === TRANSITION_CLIP_TYPE ||
  Boolean(entity?.components?.some((c) => c.type === TRANSITION_CLIP_COMPONENT));
 
/** The TransitionClipComponent of a TransitionClip entity, or null. */
export const getTransitionClipComponent = (entity) =>
  entity?.components?.find((c) => c.type === TRANSITION_CLIP_COMPONENT) || null;

// ─── Camera (After Effects-style 3D Viewport Camera) ─────────────────────────

export const CAMERA_COMPONENT = 'Camera';
export const CAMERA_ENTITY_TYPE = 'camera';

export function createCameraComponent(config = {}) {
  return {
    type: CAMERA_COMPONENT,
    enabled: config.enabled ?? true,
    position: { x: 0, y: 0, z: -1000, ...(config.position || {}) },
    target: { x: 0, y: 0, z: 0, ...(config.target || {}) },
    fov: config.fov ?? 50,
    zoom: config.zoom ?? 1.0,
  };
}

export function createCameraEntity({
  name = 'Camera 1',
  trackId = 'track-1',
  startTime = 0,
  duration = 6,
  position = { x: 0, y: 0, z: -1000 },
  target = { x: 0, y: 0, z: 0 },
  fov = 50,
  zoom = 1.0,
  color = '#8b5cf6',
} = {}) {
  return {
    id: `go-${crypto.randomUUID()}`,
    name,
    tag: 'Untagged',
    layer: 'Default',
    active: true,
    parentId: null,
    trackId,
    startTime,
    duration,
    type: CAMERA_ENTITY_TYPE,
    src: '',
    color,
    components: [
      createDefaultTransform({ is3D: true }),
      createCameraComponent({ position, target, fov, zoom }),
    ],
  };
}

export const isCameraEntity = (entity) =>
  entity?.type === CAMERA_ENTITY_TYPE ||
  Boolean(entity?.components?.some((c) => c.type === CAMERA_COMPONENT));

export const getCameraComponent = (entity) =>
  entity?.components?.find((c) => c.type === CAMERA_COMPONENT) || null;
 
/**
 * Migrate a saved project's entities (and prefab component lists) to the
 * unified model: ReactRenderer/CanvasRenderer/MonoBehaviour components
 * become ScriptComponent, and keyframes keyed under the old component
 * types move to `script:<scriptId>` tracks. Idempotent — already-migrated
 * data passes through unchanged.
 *
 * Pure function (no Vite/`?raw` or browser dependencies), so it lives
 * here — ecs.js is Node-importable and unit-tested — and is called by
 * projectFileSystem.js on every project load.
 *
 * This is the schemaVersion 0 → 1 migration: projects predating
 * schemaVersion (treated as 0 by readProjectSchemaVersion) had these
 * component types and keyframe track keys; version 1+ projects never
 * contain them. Runs unconditionally on load because it is idempotent —
 * version 1 data passes through unchanged.
 */
export function migrateEntities(entities) {
  if (!Array.isArray(entities)) return entities || [];
 
  // P1 #5 — this used to always .map() every entity AND .map() every
  // component inside it, on every single project load, even for a
  // project that has nothing left to migrate (the overwhelmingly common
  // case once a project has been opened once with a build that has this
  // migration). That's wasted work that scales with project size on
  // every load. A single cheap pre-scan for any legacy component type
  // lets us skip straight back to the original array when nothing here
  // actually needs migrating.
  const needsMigration = entities.some((entity) =>
    Array.isArray(entity?.components) &&
    entity.components.some(
      (c) => c?.type === 'ReactRenderer' || c?.type === 'CanvasRenderer' || c?.type === 'MonoBehaviour'
    )
  );
  if (!needsMigration) return entities;
 
  return entities.map((entity) => {
    const comps = Array.isArray(entity?.components) ? entity.components : [];
    const trackKeyMap = {};
    let componentsChanged = false;
    const components = comps.map((c) => {
      if (c?.type === 'ReactRenderer' || c?.type === 'CanvasRenderer' || c?.type === 'MonoBehaviour') {
        trackKeyMap[c.type] = `script:${c.scriptId}`;
        componentsChanged = true;
        return { ...c, type: 'ScriptComponent', enabled: c.enabled !== undefined ? c.enabled : true };
      }
      return c;
    });
 
    if (!componentsChanged) return entity;
 
    let keyframes = entity.keyframes;
    if (keyframes && Object.keys(trackKeyMap).length > 0) {
      const next = {};
      for (const [key, byField] of Object.entries(keyframes)) {
        next[trackKeyMap[key] || key] = byField;
      }
      keyframes = next;
    }
    return { ...entity, components, keyframes };
  });
}
 
export function createDefaultTransform(overrides = {}) {
  return {
    type: 'Transform',
    x: 0,
    y: 0,
    z: 0,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    opacity: 1,
    // 3D Layer switch (After Effects-style)
    is3D: false,
    autoOrient: false,
    // Pivot point in normalized space: 0 = center (default), -0.5 = left/top
    // edge, +0.5 = right/bottom edge — the same convention Unity uses.
    // Rotation and scale both happen around this point. Default (0, 0) is
    // center, which is what every existing entity was implicitly using, so
    // old projects with no pivot field render identically.
    pivotX: 0,
    pivotY: 0,
    ...overrides
  };
}
 
export function createGameObject({
  name = 'GameObject',
  trackId = 'track-1',
  startTime = 0,
  duration = 6,
  type = 'video',
  components = [],
  src = '',
  color = '#6366f1',
  parentId = null,
}) {
  const hasTransform = components.some(c => c.type === 'Transform');
  const finalComponents = hasTransform ? [...components] : [createDefaultTransform(), ...components];
 
  return {
    // P1 #3 — crypto.randomUUID() instead of Date.now()+Math.random(): the
    // old scheme had a non-zero collision chance on bulk create (multi-paste,
    // multi-drop landing in the same millisecond), and a collision here
    // silently corrupts parentId/reference lookups elsewhere rather than
    // erroring loudly.
    id: `go-${crypto.randomUUID()}`,
    name,
    tag: 'Untagged',
    layer: 'Default',
    active: true,
    parentId: parentId || null,
    trackId,
    startTime,
    duration,
    type,
    src,
    color,
    components: finalComponents,
  };
}
 
// ─── Entity removal helper ──────────────────────────────────────────────────
 
/**
 * Return a NEW entity array with the entities whose ids are in `idsToRemove`
 * removed. If any removed entity has children (entities with `parentId` pointing
 * to a doomed entity), they are cascadingly deleted as well to any depth.
 *
 * P0 #1 — guarded against `parentId` cycles: a cyclic parent graph can no
 * longer cause an infinite loop (see the visited check in the BFS below).
 *
 * P1 #4 — indexed cascade instead of an O(n²) repeated full-array scan.
 * The old version re-scanned every entity on every pass of a
 * `while (changed)` loop, so a deep or wide hierarchy meant a full pass
 * per level of depth. This builds a `parentId -> children[]` index once
 * (O(n)) and then walks it breadth-first starting from the ids to
 * remove, so the whole cascade resolves in roughly one pass over the
 * graph regardless of how deep it is. A cycle simply can't be
 * re-visited (the `doomed` set doubles as the visited set), so no
 * iteration cap is needed either.
 */
export function removeEntitiesByIds(entities, idsToRemove) {
  const list = entities || [];
 
  const childrenByParentId = new Map();
  for (const e of list) {
    if (e.parentId) {
      const siblings = childrenByParentId.get(e.parentId);
      if (siblings) siblings.push(e.id);
      else childrenByParentId.set(e.parentId, [e.id]);
    }
  }
 
  const doomed = new Set(idsToRemove);
  const queue = [...idsToRemove];
  while (queue.length > 0) {
    const id = queue.pop();
    const children = childrenByParentId.get(id);
    if (!children) continue;
    for (const childId of children) {
      if (!doomed.has(childId)) {
        doomed.add(childId);
        queue.push(childId);
      }
    }
  }
 
  return list.filter((e) => !doomed.has(e.id));
}
 
/**
 * Synchronize timeline instances of a prefab with its updated snapshots.
 * - Updates components, duration, name, and keyframes of existing instance clips.
 * - Spawns newly added child snapshots into existing instance groups.
 * - Removes any child clips whose source snapshot was deleted.
 * - Preserves timeline placement (startTime, trackId), instance links, and unrelated clips.
 */
export function syncPrefabInstances(entities, prefabAssetId, prefabSnapshots, rootId = null) {
  if (!Array.isArray(entities) || !prefabAssetId || !Array.isArray(prefabSnapshots) || prefabSnapshots.length === 0) {
    return entities;
  }
 
  const snapMap = new Map();
  prefabSnapshots.forEach((s) => snapMap.set(s.id, s));
  const snapRoot = (rootId ? snapMap.get(rootId) : null) ||
    prefabSnapshots.find((s) => !s.parentId) ||
    prefabSnapshots[0];
 
  const validSnapIds = new Set(prefabSnapshots.map((s) => s.id));
 
  // Group entities by prefabInstanceId (or fallback to entity.id)
  const instanceGroups = new Map();
  entities.forEach((e) => {
    if (e.prefabAssetId === prefabAssetId) {
      const key = e.prefabInstanceId || e.id;
      if (!instanceGroups.has(key)) instanceGroups.set(key, []);
      instanceGroups.get(key).push(e);
    }
  });
 
  if (instanceGroups.size === 0) return entities;
 
  const newEntities = [];
  const handledInstanceIds = new Set();
 
  for (const e of entities) {
    if (e.prefabAssetId !== prefabAssetId) {
      newEntities.push(e);
      continue;
    }
 
    const instId = e.prefabInstanceId || e.id;
    if (handledInstanceIds.has(instId)) {
      continue;
    }
    handledInstanceIds.add(instId);
 
    const groupClips = instanceGroups.get(instId) || [e];
    const rootClip = groupClips.find((c) => !c.parentId) || groupClips[0];
    const rootStartTime = rootClip.startTime || 0;
 
    // Map existing clips by snapId
    const existingBySnap = new Map();
    const clipIdBySnapId = new Map();
 
    groupClips.forEach((c) => {
      let snapId = c.prefabSourceSnapId;
      if (!snapId && c.id === rootClip.id && snapRoot) {
        snapId = snapRoot.id;
      }
      if (snapId && validSnapIds.has(snapId)) {
        existingBySnap.set(snapId, c);
        clipIdBySnapId.set(snapId, c.id);
      }
    });
 
    if (snapRoot && !clipIdBySnapId.has(snapRoot.id)) {
      clipIdBySnapId.set(snapRoot.id, rootClip.id);
    }
 
    // Allocate IDs for any new snapshots
    prefabSnapshots.forEach((snap) => {
      if (!clipIdBySnapId.has(snap.id)) {
        clipIdBySnapId.set(snap.id, `go-${crypto.randomUUID()}`);
      }
    });
 
    // Output synchronized clips for each snapshot in the prefab
    prefabSnapshots.forEach((snap) => {
      const existing = existingBySnap.get(snap.id);
      const isRoot = snap.id === (snapRoot ? snapRoot.id : null);
      const clipId = clipIdBySnapId.get(snap.id);
      const parentClipId = isRoot ? null : (snap.parentId ? (clipIdBySnapId.get(snap.parentId) || rootClip.id) : null);
 
      if (existing) {
        newEntities.push({
          ...existing,
          id: clipId,
          name: snap.name || existing.name,
          duration: snap.duration ?? existing.duration,
          parentId: parentClipId,
          components: JSON.parse(JSON.stringify(snap.components || [])),
          keyframes: snap.keyframes ? JSON.parse(JSON.stringify(snap.keyframes)) : existing.keyframes,
          prefabAssetId,
          prefabInstanceId: instId,
          prefabSourceSnapId: snap.id,
        });
      } else {
        // Newly added snapshot in Prefab: spawn child into this instance group
        newEntities.push({
          id: clipId,
          name: snap.name || 'Prefab Child',
          trackId: snap.trackId || rootClip.trackId,
          startTime: Math.max(0, rootStartTime + (snap.startTime || 0)),
          duration: snap.duration ?? 5,
          type: snap.type || 'video',
          src: snap.src || '',
          active: snap.active !== false,
          color: snap.color || rootClip.color,
          tag: snap.tag || 'Untagged',
          layer: snap.layer || 'Default',
          parentId: parentClipId,
          components: JSON.parse(JSON.stringify(snap.components || [])),
          keyframes: snap.keyframes ? JSON.parse(JSON.stringify(snap.keyframes)) : {},
          prefabAssetId,
          prefabInstanceId: instId,
          prefabSourceSnapId: snap.id,
        });
      }
    });
  }
 
  return newEntities;
}
 
 