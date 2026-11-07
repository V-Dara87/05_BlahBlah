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
 * timing and the scriptIndex filename -> id map.
 */

export const MAX_PROJECT_TRACKS = 500;
export const MAX_PROJECT_ENTITIES = 20000;
export const MAX_SCRIPT_INDEX_ENTRIES = 5000;
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

function sanitizeEntities(candidate, trackIds, warnings) {
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

    entities.push({
      ...Object.fromEntries(Object.entries(raw)),
      id,
      name: safeString(raw.name, id),
      trackId,
      startTime: startTime !== null && startTime >= 0 ? startTime : 0,
      duration: duration !== null && duration > 0 ? duration : 1,
      type: safeString(raw.type, 'Shape'),
      components: Array.isArray(raw.components) ? raw.components.filter(isObject) : [],
      keyframes: isObject(raw.keyframes) ? raw.keyframes : {},
    });
  }
  if (candidate.length > MAX_PROJECT_ENTITIES) {
    warnings.push(
      `project has more than ${MAX_PROJECT_ENTITIES} entities; the rest were dropped.`
    );
  }
  return entities;
}

function sanitizeScriptIndex(candidate, warnings) {
  if (candidate === undefined || candidate === null) return [];
  if (!Array.isArray(candidate)) {
    warnings.push('scriptIndex is not an array; using none.');
    return [];
  }
  const index = [];
  const seen = new Set();
  for (const raw of candidate.slice(0, MAX_SCRIPT_INDEX_ENTRIES)) {
    if (!isObject(raw) || !isPlainFileName(raw.name) || !safeString(raw.id)) {
      warnings.push('dropped an invalid scriptIndex entry.');
      continue;
    }
    if (seen.has(raw.name)) {
      warnings.push(`dropped duplicate scriptIndex entry for "${raw.name}".`);
      continue;
    }
    seen.add(raw.name);
    index.push({
      name: raw.name,
      id: safeString(raw.id),
      description: typeof raw.description === 'string' ? raw.description.slice(0, 2000) : undefined,
      folder: typeof raw.folder === 'string' ? raw.folder.slice(0, MAX_STRING) : null,
      createdAt: finiteNumber(raw.createdAt) ?? null,
      origin: isObject(raw.origin) ? raw.origin : undefined,
    });
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

  return {
    project: {
      ...Object.fromEntries(Object.entries(parsed)),
      name: safeString(parsed.name),
      schemaVersion: finiteNumber(parsed.schemaVersion) ?? 0,
      lastModified: finiteNumber(parsed.lastModified) ?? 0,
      resolution: isObject(parsed.resolution) ? parsed.resolution : undefined,
      tracks,
      entities: sanitizeEntities(parsed.entities, trackIds, warnings),
      scriptIndex: sanitizeScriptIndex(parsed.scriptIndex, warnings),
    },
    warnings,
  };
}
