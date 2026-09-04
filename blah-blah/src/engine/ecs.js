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
 * A saved project's schemaVersion, or 0 when it has none (projects saved
 * before schemaVersion was introduced — the 0 → 1 boundary). Non-numeric
 * values (e.g. a hand-typed string in a VS Code edit) also read as 0.
 */
export function readProjectSchemaVersion(project) {
  return Number.isFinite(project?.schemaVersion) ? project.schemaVersion : 0;
}

/**
 * Version gate: warn (without blocking the load) when a project was saved
 * by a NEWER build than this one understands. Returns true when it warned.
 * Projects newer than CURRENT_SCHEMA_VERSION usually still open — fields
 * the newer build added are simply unknown to this one and are left
 * untouched on the next save.
 */
export function warnIfSchemaVersionTooNew(project) {
  const version = readProjectSchemaVersion(project);
  if (version > CURRENT_SCHEMA_VERSION) {
    console.warn(
      `project.json schemaVersion ${version} is newer than this build of blahblah supports (${CURRENT_SCHEMA_VERSION}). ` +
        'This project was created with a newer version of blahblah — some features may not work correctly.'
    );
    return true;
  }
  return false;
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
};

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
 
/**
 * Libraries injected into CanvasRenderer scripts as `libs.<Name>`.
 * Loaded lazily (see engine/canvasLibs.js) from CDN globals the first time
 * a CanvasRenderer component actually needs one, so most projects never
 * pay the cost of unused libraries.
 *
 * NOTE: not every library supports seeking to an arbitrary time cleanly
 * (some GSAP/Three.js patterns keep their own internal clock) — verify
 * seek-to-time behavior per library before assuming scrubbing looks correct.
 */
export const CANVAS_LIB_SOURCES = {
  THREE: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  gsap: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js',
};
 
export function createDefaultTransform(overrides = {}) {
  return {
    type: 'Transform',
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
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
  color = '#6366f1'
}) {
  const hasTransform = components.some(c => c.type === 'Transform');
  const finalComponents = hasTransform ? [...components] : [createDefaultTransform(), ...components];
 
  return {
    id: `go-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    name,
    tag: 'Untagged',
    layer: 'Default',
    active: true,
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
 * Return a NEW entity array with the entities whose ids are in `rootIds`
 * removed (kept as a named helper for the delete paths; each clip is an
 * independent timeline entity, so removal is a flat id filter).
 */
export function filterOutSubtrees(entities, rootIds) {
  const doomed = new Set(rootIds);
  return (entities || []).filter((e) => !doomed.has(e.id));
}