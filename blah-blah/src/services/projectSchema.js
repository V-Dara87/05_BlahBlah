/**
 * Structural validation for project.json.
 *
 * project.json is deliberately hand-editable (the "VS Code ready" feature), so
 * whatever is on disk is untrusted input: a typo, a merge conflict marker or a
 * third-party tool can produce a file this app must not hand straight to the
 * renderer. This module checks the shape once, drops entries that cannot be
 * rendered, and reports what was dropped instead of throwing away the whole
 * project.
 *
 * It is intentionally tolerant about optional fields (newer/older projects)
 * and strict about the fields the runtime indexes on: ids, tracks, entity
 * timing, component/script references, parent links, keyframe ids and the
 * scriptIndex filename -> id map.
 */

/** Upper bound for a project.json read (64 MiB of text). */
export const MAX_PROJECT_JSON_BYTES = 64 * 1024 * 1024;
export const MAX_PROJECT_TRACKS = 500;
export const MAX_PROJECT_ENTITIES = 20000;
export const MAX_SCRIPT_INDEX_ENTRIES = 5000;
export const MAX_COMPONENTS_PER_ENTITY = 64;
export const MAX_KEYFRAMES_PER_ENTITY = 2000;
const MAX_STRING = 200;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const safeString = (value, fallback = '') =>
  typeof value === 'string' ? value.slice(0, MAX_STRING) : fallback;

/** A single path segment: no separators, no `.` / `..`, no drive prefix. */
function isPlainFileName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 260 &&
    name !== '.' &&
    name !== '..' &&
    !/[/\\\0]/.test(name) &&
    !/^[a-zA-Z]:/.test(name)
  );
}

function sanitizeTracks(candidate, warnings) {
  if (candidate === undefined || candidate === null) return [];
  if (!Array.isArray(candidate)) {
    warnings.push('tracks is not an array; using none.');
    return [];
  }
  const tracks = [];
  const seen = new Set();
  for (const raw of candidate.slice(0, MAX_PROJECT_TRACKS)) {
    if (!isObject(raw) || !safeString(raw.id)) {
      warnings.push('dropped a track without a valid id.');
      continue;
    }
    const id = safeString(raw.id);
    if (seen.has(id)) {
      warnings.push(`dropped duplicate track id "${id}".`);
      continue;
    }
    seen.add(id);
    tracks.push({
      ...Object.fromEntries(Object.entries(raw)),
      id,
      name: safeString(raw.name, id),
    });
  }
  if (candidate.length > MAX_PROJECT_TRACKS) {
    warnings.push(`project has more than ${MAX_PROJECT_TRACKS} tracks; the rest were dropped.`);
  }
  return tracks;
}

function sanitizeComponents(candidate, entityId, scriptIds, warnings) {
  const components = Array.isArray(candidate) ? candidate.filter(isObject) : [];
  if (components.length > MAX_COMPONENTS_PER_ENTITY) {
    warnings.push(
      `entity "${entityId}" has more than ${MAX_COMPONENTS_PER_ENTITY} components; the rest were dropped.`
    );
  }
  return components.slice(0, MAX_COMPONENTS_PER_ENTITY).map((component) => {
    if (
      component.type === 'ScriptComponent' &&
      component.scriptId !== undefined &&
      component.scriptId !== null
    ) {
      const scriptId = safeString(component.scriptId);
      // Only warn: an old project may reference a script that is currently
      // missing from scripts/ (the user can re-add the file), and dropping the
      // component here would silently detach it.
      if (scriptIds.size > 0 && !scriptIds.has(scriptId)) {
        warnings.push(`entity "${entityId}" references unknown script "${scriptId}".`);
      }
    }
    return component;
  });
}

/**
 * Validates one entity's keyframe map ({ trackKey: { field: [keyframe, ...] } }).
 * Keyframes are clamped/dropped rather than deleted wholesale so one bad entry
 * can't take an animation with it.
 */
function sanitizeKeyframes(candidate, entityId, warnings) {
  if (!isObject(candidate)) return {};
  const result = {};
  const seenIds = new Set();
  let keptCount = 0;
  let capWarned = false;

  for (const [rawTrackKey, fields] of Object.entries(candidate)) {
    const trackKey = safeString(rawTrackKey);
    if (!trackKey || !isObject(fields)) {
      warnings.push(`entity "${entityId}" has malformed keyframes for "${rawTrackKey}"; dropped.`);
      continue;
    }
    const keptFields = {};
    for (const [rawField, list] of Object.entries(fields)) {
      const field = safeString(rawField);
      if (!field || !Array.isArray(list)) {
        warnings.push(`entity "${entityId}" has a malformed keyframe list for "${rawField}"; dropped.`);
        continue;
      }
      const kept = [];
      for (const raw of list) {
        if (!isObject(raw)) continue;
        if (keptCount >= MAX_KEYFRAMES_PER_ENTITY) {
          if (!capWarned) {
            warnings.push(
              `entity "${entityId}" has more than ${MAX_KEYFRAMES_PER_ENTITY} keyframes; the rest were dropped.`
            );
            capWarned = true;
          }
          break;
        }
        const id = safeString(raw.id);
        if (id && seenIds.has(id)) {
          warnings.push(`dropped duplicate keyframe id "${id}" on entity "${entityId}".`);
          continue;
        }
        const time = finiteNumber(raw.time);
        if (time === null) {
          warnings.push(`dropped a keyframe without a valid time on entity "${entityId}".`);
          continue;
        }
        if (time < 0) {
          warnings.push(`keyframe on entity "${entityId}" has a negative time; using 0.`);
        }
        if (id) seenIds.add(id);
        kept.push({ ...raw, ...(id ? { id } : {}), time: time < 0 ? 0 : time });
        keptCount += 1;
      }
      if (kept.length > 0) keptFields[field] = kept;
    }
    if (Object.keys(keptFields).length > 0) result[trackKey] = keptFields;
  }
  return result;
}

function sanitizeEntities(candidate, trackIds, scriptIds, warnings) {
  if (candidate === undefined || candidate === null) return [];
  if (!Array.isArray(candidate)) {
    warnings.push('entities is not an array; using none.');
    return [];
  }
  const entities = [];
  const seen = new Set();
  for (const raw of candidate.slice(0, MAX_PROJECT_ENTITIES)) {
    if (!isObject(raw) || !safeString(raw.id)) {
      warnings.push('dropped an entity without a valid id.');
      continue;
    }
    const id = safeString(raw.id);
    if (seen.has(id)) {
      warnings.push(`dropped duplicate entity id "${id}".`);
      continue;
    }
    seen.add(id);

    const trackId = safeString(raw.trackId);
    if (!trackId) {
      warnings.push(`entity "${id}" has no track; dropped.`);
      continue;
    }
    if (trackIds.size > 0 && !trackIds.has(trackId)) {
      // Kept, not dropped: old projects and the fallback track list can both
      // legitimately reference a track that the saved tracks array omits.
      warnings.push(`entity "${id}" references unknown track "${trackId}".`);
    }

    // Timing is coerced rather than dropped, so one bad hand-edited number
    // cannot make a clip disappear from the timeline.
    const startTime = finiteNumber(raw.startTime);
    const duration = finiteNumber(raw.duration);
    if (startTime === null || startTime < 0) {
      warnings.push(`entity "${id}" has invalid startTime; using 0.`);
    }
    if (duration === null || duration <= 0) {
      warnings.push(`entity "${id}" has invalid duration; using 1s.`);
    }

    const parentId = raw.parentId === undefined || raw.parentId === null
      ? null
      : safeString(raw.parentId) || null;

    entities.push({
      ...Object.fromEntries(Object.entries(raw)),
      id,
      name: safeString(raw.name, id),
      trackId,
      parentId: parentId || undefined,
      startTime: startTime !== null && startTime >= 0 ? startTime : 0,
      duration: duration !== null && duration > 0 ? duration : 1,
      type: safeString(raw.type, 'Shape'),
      components: sanitizeComponents(raw.components, id, scriptIds, warnings),
      keyframes: sanitizeKeyframes(raw.keyframes, id, warnings),
    });
  }
  if (candidate.length > MAX_PROJECT_ENTITIES) {
    warnings.push(
      `project has more than ${MAX_PROJECT_ENTITIES} entities; the rest were dropped.`
    );
  }
  return entities;
}

/**
 * Drops parent links that point at an entity which did not survive validation.
 * Keeping them would make ordering/lookup code chase a non-existent parent.
 */
function validateParentReferences(entities, warnings) {
  const ids = new Set(entities.map((entity) => entity.id));
  for (const entity of entities) {
    if (!entity.parentId) continue;
    if (entity.parentId === entity.id || !ids.has(entity.parentId)) {
      warnings.push(
        `entity "${entity.id}" references unknown parent "${entity.parentId}"; parent cleared.`
      );
      delete entity.parentId;
    }
  }
}

function sanitizeScriptIndex(candidate, warnings) {
  if (candidate === undefined || candidate === null) return [];
  if (!Array.isArray(candidate)) {
    warnings.push('scriptIndex is not an array; using none.');
    return [];
  }
  const index = [];
  const seenNames = new Set();
  const seenIds = new Set();
  for (const raw of candidate.slice(0, MAX_SCRIPT_INDEX_ENTRIES)) {
    if (!isObject(raw) || !isPlainFileName(raw.name) || !safeString(raw.id)) {
      warnings.push('dropped an invalid scriptIndex entry.');
      continue;
    }
    const id = safeString(raw.id);
    if (seenNames.has(raw.name)) {
      warnings.push(`dropped duplicate scriptIndex entry for "${raw.name}".`);
      continue;
    }
    if (seenIds.has(id)) {
      warnings.push(`dropped scriptIndex entry "${raw.name}" with duplicate id "${id}".`);
      continue;
    }
    seenNames.add(raw.name);
    seenIds.add(id);
    index.push({
      name: raw.name,
      id,
      description: typeof raw.description === 'string' ? raw.description.slice(0, 2000) : undefined,
      folder: typeof raw.folder === 'string' ? raw.folder.slice(0, MAX_STRING) : null,
      createdAt: finiteNumber(raw.createdAt) ?? null,
      origin: isObject(raw.origin) ? raw.origin : undefined,
    });
  }
  if (candidate.length > MAX_SCRIPT_INDEX_ENTRIES) {
    warnings.push(
      `project has more than ${MAX_SCRIPT_INDEX_ENTRIES} scriptIndex entries; the rest were dropped.`
    );
  }
  return index;
}

/**
 * Validate a parsed project.json object.
 *
 * @param {unknown} parsed
 * @returns {{ project: object, warnings: string[] }}
 * @throws {Error} when the file is not a JSON object at all (nothing sensible
 *   can be recovered from that, and the caller must not overwrite it).
 */
export function validateProjectJson(parsed) {
  if (!isObject(parsed)) {
    throw new Error('project.json must contain a JSON object.');
  }

  const warnings = [];
  const tracks = sanitizeTracks(parsed.tracks, warnings);
  const trackIds = new Set(tracks.map((track) => track.id));
  const scriptIndex = sanitizeScriptIndex(parsed.scriptIndex, warnings);
  const scriptIds = new Set(scriptIndex.map((entry) => entry.id));
  const entities = sanitizeEntities(parsed.entities, trackIds, scriptIds, warnings);
  validateParentReferences(entities, warnings);

  return {
    project: {
      ...Object.fromEntries(Object.entries(parsed)),
      name: safeString(parsed.name),
      schemaVersion: finiteNumber(parsed.schemaVersion) ?? 0,
      lastModified: finiteNumber(parsed.lastModified) ?? 0,
      resolution: isObject(parsed.resolution) ? parsed.resolution : undefined,
      tracks,
      entities,
      scriptIndex,
    },
    warnings,
  };
}
