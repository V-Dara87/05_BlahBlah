/**
 * referenceTypes.js — Reference field resolution for the BlahBlah script system.
 *
 * Provides two reference types that can be declared in a script's `static props`:
 *
 *   static props = {
 *     target: { type: 'entity', label: 'Target Clip' },
 *     clip:   { type: 'asset',  label: 'Media Asset' },
 *   }
 *
 * In the Inspector these render as drag-drop slots (EntityRefSlot / AssetRefSlot).
 * The stored value is just an ID string. At script runtime, `resolveScriptProps`
 * walks all props, detects entity/asset types via the schema, and replaces each
 * ID string with the corresponding EntityRef or AssetRef object so scripts can
 * call `props.target.getTransform()` etc.
 *
 * TypeScript definitions for VS Code are exported as `REFERENCE_TYPES_DTS`.
 */
import { getPhraseContextAt } from './subtitleTrack.js';

// ─── EntityRef ────────────────────────────────────────────────────────────────

/**
 * Wraps a resolved entity so motion/canvas/react scripts can read live data
 * from other clips without importing anything.
 *
 * @param {object|null} entity  - The raw entity object from the project store.
 * @param {Array}       allEntities - All entities (used to compute world transform).
 * @returns {EntityRef}
 */
export function makeEntityRef(entity, allEntities = []) {
  if (!entity) {
    return {
      id: null,
      name: null,
      exists: () => false,
      getTransform: () => null,
      getComponent: () => null,
      getPhraseAt: () => null,
      getCurrentText: () => '',
    };
  }

  return {
    /** The entity's unique ID. */
    id: entity.id,

    /** The entity's display name on the timeline. */
    name: entity.name,

    /** Returns true when the referenced entity still exists in the project. */
    exists() {
      return allEntities.some((e) => e.id === entity.id);
    },

    /**
     * Returns a snapshot of the entity's Transform component values.
     * This is the raw local transform (not the resolved world transform).
     * @returns {{ x, y, rotation, scaleX, scaleY, opacity, speed }|null}
     */
    getTransform() {
      const t = entity.components?.find((c) => c.type === 'Transform');
      if (!t) return null;
      return {
        x: t.x ?? 0,
        y: t.y ?? 0,
        rotation: t.rotation ?? 0,
        scaleX: t.scaleX ?? 1,
        scaleY: t.scaleY ?? 1,
        opacity: t.opacity ?? 1,
        speed: t.speed ?? 1,
      };
    },

    /**
     * Returns the first component of the given type, or null.
     * e.g. getComponent('VideoRenderer'), getComponent('AudioSource')
     * @param {string} type
     * @returns {object|null}
     */
    getComponent(type) {
      return entity.components?.find((c) => c.type === type) ?? null;
    },

    /**
     * Subtitle read API — additive to getTransform/getComponent, per the
     * subtitle-track feature's read-only contract (scripts compute/read
     * per tick; they never write back to another entity's stored data —
     * see keyframes.js's determinism note and the absence of any
     * onUpdateEntity call anywhere in the script execution paths).
     *
     * Looks up the entity's SubtitleTrack component (if any) and returns
     * the full context a presentation script needs to animate a
     * transition between phrases, not just the current one: the active
     * phrase (or null during a gap between phrases — an explicit,
     * documented choice, not an accident; see subtitleTrack.js's
     * getPhraseContextAt), plus its neighbors.
     *
     * `time` is entity-LOCAL time in seconds (time since this clip's own
     * start), matching the convention every other per-tick script value
     * in this codebase uses (keyframes.js's evaluateField, canvasRunner's
     * localTime, etc.) — NOT the absolute timeline time.
     *
     * Returns null when the entity has no SubtitleTrack component at all,
     * or one with zero phrases. Otherwise returns:
     *   { text, index, phrase, prev, next }
     * where `phrase`/`index` are null and `text` is '' during a gap.
     *
     * @param {number} time
     * @returns {{ text: string, index: number|null, phrase: object|null, prev: object|null, next: object|null }|null}
     */
    getPhraseAt(time) {
      const track = entity.components?.find((c) => c.type === 'SubtitleTrack');
      if (!track) return null;
      return getPhraseContextAt(track, time);
    },

    /**
     * Convenience shorthand for scripts that just want the plain current
     * text with no surrounding context. Returns '' when there is no
     * SubtitleTrack, no phrases, or the given time falls in a gap
     * between phrases (see getPhraseAt above) — never null, so callers
     * can render this directly without a null-check.
     * @param {number} time
     * @returns {string}
     */
    getCurrentText(time) {
      const result = this.getPhraseAt(time);
      return result?.text || '';
    },

    /** startTime of the clip on the timeline (seconds). */
    get startTime() { return entity.startTime ?? 0; },

    /** Duration of the clip on the timeline (seconds). */
    get duration() { return entity.duration ?? 0; },

    /** The entity's parentId, or null if it has no parent. */
    get parentId() { return entity.parentId ?? null; },
  };
}

// ─── AssetRef ─────────────────────────────────────────────────────────────────

/**
 * Wraps a resolved media asset so scripts can use it as a value object.
 *
 * @param {object|null} asset - The raw media asset from the project's mediaAssets list.
 * @returns {AssetRef}
 */
export function makeAssetRef(asset) {
  if (!asset) {
    return {
      id: null,
      name: null,
      src: null,
      type: null,
      duration: null,
      exists: () => false,
    };
  }

  return {
    /** The asset's unique ID. */
    id: asset.id,

    /** The filename / display name of the asset. */
    name: asset.name,

    /**
     * The URL/path to the actual media file.
     * Pass this directly to a <video> or <audio> src, or fetch it for image data.
     */
    src: asset.src ?? asset.url ?? null,

    /** Media type: 'video' | 'audio' | 'image'. */
    type: asset.type ?? null,

    /** Duration in seconds (for video/audio), null for images. */
    duration: asset.duration ?? null,

    /** Returns true when the asset still exists in the project. */
    exists() {
      return !!asset.id;
    },
  };
}

// ─── resolveScriptProps ───────────────────────────────────────────────────────

/**
 * Resolves reference-typed props before passing them to a script.
 *
 * Walks `rawProps` (the plain object stored in `comp.props`), looks up each
 * field's type in `schema` (from `extractScriptProps`), and replaces any
 * `'entity'` or `'asset'` typed field whose value is an ID string with the
 * corresponding EntityRef / AssetRef wrapper.
 *
 * Fields of other types are passed through unchanged.
 *
 * @param {object} rawProps      - `comp.props` — { [fieldName]: value }
 * @param {Array}  schema        - Output of `extractScriptProps(scriptCode)`
 * @param {Array}  allEntities   - All entities from the project store
 * @param {Array}  allAssets     - All mediaAssets from the project
 * @returns {object}             - Resolved props ready for the script
 */
export function resolveScriptProps(rawProps, schema, allEntities = [], allAssets = []) {
  if (!rawProps || !schema || schema.length === 0) return rawProps || {};

  // Build a quick lookup: fieldName → field definition
  const schemaByName = {};
  for (const field of schema) {
    schemaByName[field.name] = field;
  }

  const resolved = { ...rawProps };

  for (const [key, value] of Object.entries(resolved)) {
    const fieldDef = schemaByName[key];
    if (!fieldDef) continue;

    if (fieldDef.type === 'entity') {
      // value is an entity ID string (or null)
      const entity = value ? allEntities.find((e) => e.id === value) : null;
      resolved[key] = makeEntityRef(entity, allEntities);
    } else if (fieldDef.type === 'asset') {
      // value is an asset ID string (or null)
      const asset = value ? allAssets.find((a) => a.id === value) : null;
      resolved[key] = makeAssetRef(asset);
    }
    // Other types pass through unchanged
  }

  return resolved;
}

// ─── VS Code / IDE Type Definitions ──────────────────────────────────────────

/**
 * JSDoc/TypeScript ambient declarations for the BlahBlah reference types.
 * Suitable for inclusion in a project's jsconfig.json or for registration
 * with Monaco's addExtraLib.
 */
export const REFERENCE_TYPES_DTS = `
/**
 * A single timed subtitle phrase, as read from a SubtitleTrack component.
 * See EntityRef.getPhraseAt / getCurrentText.
 */
declare interface SubtitlePhrase {
  readonly id: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly text: string;
  /** Word-level timing, only present when known (e.g. from transcription). */
  readonly words?: { word: string; start: number; end: number }[];
  /** Light styling hint a presentation script may use — not a style property. */
  readonly emphasis?: boolean;
  readonly language?: string;
}

/**
 * The result of EntityRef.getPhraseAt(time) — full context around the
 * active phrase (or lack thereof, during a gap between phrases).
 */
declare interface SubtitlePhraseContext {
  /** The active phrase's text, or '' during a gap. */
  readonly text: string;
  /** The active phrase's index, or null during a gap. */
  readonly index: number | null;
  /** The active phrase, or null during a gap between phrases. */
  readonly phrase: SubtitlePhrase | null;
  /** The previous phrase in time, if any. */
  readonly prev: SubtitlePhrase | null;
  /** The next phrase in time, if any. */
  readonly next: SubtitlePhrase | null;
}

/**
 * A reference to another clip/entity on the BlahBlah timeline.
 * Obtained when a script prop is declared with \`type: 'entity'\`.
 */
declare class EntityRef {
  /** The entity's unique ID string. */
  readonly id: string | null;
  /** The entity's display name on the timeline. */
  readonly name: string | null;
  /** Seconds at which the clip starts on the timeline. */
  readonly startTime: number;
  /** Duration of the clip in seconds. */
  readonly duration: number;
  /** Parent entity ID, or null. */
  readonly parentId: string | null;
  /** Returns true when the referenced entity exists in the current project. */
  exists(): boolean;
  /**
   * Returns the entity's raw local Transform values.
   * @returns {{ x: number, y: number, rotation: number, scaleX: number, scaleY: number, opacity: number, speed: number } | null}
   */
  getTransform(): { x: number; y: number; rotation: number; scaleX: number; scaleY: number; opacity: number; speed: number; } | null;
  /**
   * Returns the first component of the given type attached to the entity, or null.
   * Common types: 'VideoRenderer', 'AudioSource', 'TextRenderer', 'ShapeRenderer', 'SubtitleTrack'
   */
  getComponent(type: string): object | null;
  /**
   * Returns the active subtitle phrase (and its neighbors) at entity-LOCAL
   * time \`time\`, from this entity's SubtitleTrack component. Returns null
   * when the entity has no SubtitleTrack or it has zero phrases. During a
   * gap between phrases, \`phrase\`/\`index\` are null and \`text\` is ''.
   */
  getPhraseAt(time: number): SubtitlePhraseContext | null;
  /**
   * Convenience shorthand for the plain current subtitle text at
   * entity-LOCAL time \`time\`. Always a string — '' when there is no
   * SubtitleTrack, no phrases, or \`time\` falls in a gap.
   */
  getCurrentText(time: number): string;
}

/**
 * A reference to a media asset (video, audio, or image) in the BlahBlah project.
 * Obtained when a script prop is declared with \`type: 'asset'\`.
 */
declare class AssetRef {
  /** The asset's unique ID string. */
  readonly id: string | null;
  /** The filename / display name of the asset. */
  readonly name: string | null;
  /** URL or path to the actual media file. */
  readonly src: string | null;
  /** Media type: 'video', 'audio', or 'image'. */
  readonly type: 'video' | 'audio' | 'image' | null;
  /** Duration in seconds (video/audio), or null for images. */
  readonly duration: number | null;
  /** Returns true when the asset exists in the current project. */
  exists(): boolean;
}
`;