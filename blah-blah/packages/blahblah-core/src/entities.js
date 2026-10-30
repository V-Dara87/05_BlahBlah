import crypto from 'node:crypto';

export function createDefaultTransform(overrides = {}) {
  return {
    type: 'Transform',
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    pivotX: 0,
    pivotY: 0,
    ...overrides,
  };
}

export function listEntities(project) {
  return project.entities || [];
}

/**
 * Finds an entity by exact id, or else by case-insensitive name. When a name
 * matches several entities the lookup fails instead of silently editing the
 * first one: use the id in that case.
 */
export function findEntity(project, idOrName) {
  const entities = project.entities || [];
  const byId = entities.find((e) => e.id === idOrName);
  if (byId) return byId;

  const wanted = String(idOrName ?? '').toLowerCase();
  const byName = entities.filter((e) => typeof e.name === 'string' && e.name.toLowerCase() === wanted);
  if (byName.length > 1) {
    throw new Error(
      `Name "${idOrName}" matches ${byName.length} entities (${byName.map((e) => e.id).join(', ')}). Use the entity id.`
    );
  }
  return byName[0] || null;
}

/** Throws unless the project has a track with this id. Returns the track. */
export function requireTrack(project, trackId) {
  const track = (project.tracks || []).find((t) => t.id === trackId);
  if (!track) {
    const known = (project.tracks || []).map((t) => t.id).join(', ') || 'none';
    throw new Error(`Track "${trackId}" not found. Existing tracks: ${known}.`);
  }
  return track;
}

/** Validates and normalizes clip timing (seconds). */
function timing(startTime, duration) {
  const start = Number(startTime);
  const length = Number(duration);
  if (!Number.isFinite(start) || start < 0) {
    throw new Error(`startTime must be a number >= 0 (got ${JSON.stringify(startTime)}).`);
  }
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error(`duration must be a number > 0 (got ${JSON.stringify(duration)}).`);
  }
  return { startTime: start, duration: length };
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([^)]*\)|[a-z]+)$/i;

/**
 * Checks one prop value against its declared definition (as returned by
 * extractScriptPropsSchema). Returns an error message, or null when OK.
 * Types the checker does not know are accepted.
 */
export function validatePropValue(def, value) {
  if (!def || !def.type || def.type === 'unknown') return null;
  const t = def.type;
  const name = def.name;

  if (t === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `"${name}" expects a number, got ${JSON.stringify(value)}.`;
    }
    if (typeof def.min === 'number' && value < def.min) return `"${name}" must be >= ${def.min} (got ${value}).`;
    if (typeof def.max === 'number' && value > def.max) return `"${name}" must be <= ${def.max} (got ${value}).`;
    return null;
  }
  if (t === 'boolean') {
    return typeof value === 'boolean' ? null : `"${name}" expects true or false, got ${JSON.stringify(value)}.`;
  }
  if (t === 'string' || t === 'textarea' || t === 'font') {
    return typeof value === 'string' ? null : `"${name}" expects a string, got ${JSON.stringify(value)}.`;
  }
  if (t === 'color') {
    return typeof value === 'string' && COLOR_RE.test(value.trim())
      ? null
      : `"${name}" expects a color such as "#38bdf8", got ${JSON.stringify(value)}.`;
  }
  if (t === 'select') {
    if (!Array.isArray(def.options) || def.options.length === 0) return null;
    const allowed = def.options.map((o) => (o && typeof o === 'object' ? o.value : o));
    return allowed.includes(value)
      ? null
      : `"${name}" must be one of ${allowed.map((v) => JSON.stringify(v)).join(', ')} (got ${JSON.stringify(value)}).`;
  }
  if (t === 'entity' || t === 'asset') {
    return value === null || typeof value === 'string' ? null : `"${name}" expects an id string or null.`;
  }
  if (t === 'struct') {
    return value && typeof value === 'object' && !Array.isArray(value) ? null : `"${name}" expects an object.`;
  }
  if (t === 'struct[]' || t === 'array' || t.endsWith('[]')) {
    return Array.isArray(value) ? null : `"${name}" expects an array.`;
  }
  if (t === 'button') return `"${name}" is a button and holds no value.`;
  return null;
}

/**
 * Validates a whole props object against a schema from extractScriptPropsSchema.
 * Returns a list of error messages (empty when everything is fine). With no
 * declared props the script's props cannot be checked, so nothing is reported.
 */
export function validateEntityProps(schema, props = {}) {
  if (!schema || !schema.found || schema.props.length === 0) return [];
  const errors = [];
  const byName = new Map(schema.props.map((p) => [p.name, p]));
  for (const [key, value] of Object.entries(props)) {
    const def = byName.get(key);
    if (!def) {
      errors.push(`Unknown prop "${key}". Declared props: ${[...byName.keys()].join(', ')}.`);
      continue;
    }
    const message = validatePropValue(def, value);
    if (message) errors.push(message);
  }
  return errors;
}

export function addVideoClip(project, {
  name,
  trackId = 'track-1',
  audioTrackId = 'track-2',
  file = '',
  startTime = 0,
  duration = 5,
  includeAudio = true,
  color = '#6366f1',
} = {}) {
  const clipName = name || (file ? file.split(/[\\/]/).pop() : 'Video Clip');
  const videoId = `go-${crypto.randomUUID()}`;

  const videoEntity = {
    id: videoId,
    name: clipName,
    tag: 'Untagged',
    layer: 'Default',
    active: true,
    parentId: null,
    trackId,
    ...timing(startTime, duration),
    type: 'video',
    src: file,
    color,
    components: [
      createDefaultTransform(),
      {
        type: 'VideoRenderer',
        src: file,
        volume: 0, // Video sound owned by child audio clip
        speed: 1,
        mediaOffset: 0,
      },
    ],
    keyframes: {},
  };

  const added = [videoEntity];

  if (includeAudio) {
    const audioEntity = {
      id: `go-${crypto.randomUUID()}`,
      name: `${clipName} (Audio)`,
      tag: 'Untagged',
      layer: 'Default',
      active: true,
      parentId: videoId,
      trackId: audioTrackId,
      ...timing(startTime, duration),
      type: 'audio',
      src: file,
      color: '#38bdf8',
      components: [
        createDefaultTransform(),
        {
          type: 'AudioSource',
          src: file,
          volume: 1,
          speed: 1,
          mediaOffset: 0,
        },
      ],
      keyframes: {},
    };
    added.push(audioEntity);
  }

  project.entities = [...(project.entities || []), ...added];
  return { video: videoEntity, audio: added[1] || null };
}

export function addAudioClip(project, {
  name,
  trackId = 'track-3',
  file = '',
  startTime = 0,
  duration = 5,
  volume = 1,
  color = '#38bdf8',
} = {}) {
  const clipName = name || (file ? file.split(/[\\/]/).pop() : 'Audio Clip');
  const audioEntity = {
    id: `go-${crypto.randomUUID()}`,
    name: clipName,
    tag: 'Untagged',
    layer: 'Default',
    active: true,
    parentId: null,
    trackId,
    ...timing(startTime, duration),
    type: 'audio',
    src: file,
    color,
    components: [
      createDefaultTransform(),
      {
        type: 'AudioSource',
        src: file,
        volume: Number(volume),
        speed: 1,
        mediaOffset: 0,
      },
    ],
    keyframes: {},
  };

  project.entities = [...(project.entities || []), audioEntity];
  return audioEntity;
}

export function addScriptEntity(project, {
  name,
  scriptName,
  scriptId,
  trackId = 'track-1',
  startTime = 0,
  duration = 5,
  props = {},
  transform = {},
  color = '#ec4899',
} = {}) {
  const entityId = `go-${crypto.randomUUID()}`;
  const sName = (scriptName || name || 'Script').replace(/\.(jsx?|tsx?)$/i, '');
  const sId = scriptId || `script-${sName}`;
  const scriptFileName = `${sName}.jsx`;

  const scriptEntity = {
    id: entityId,
    name: name || sName,
    tag: 'Untagged',
    layer: 'Default',
    active: true,
    parentId: null,
    trackId,
    ...timing(startTime, duration),
    type: 'empty',
    src: '',
    color,
    components: [
      createDefaultTransform(transform),
      {
        type: 'ScriptComponent',
        scriptId: sId,
        scriptName: sName,
        enabled: true,
        props: { ...props },
      },
    ],
    keyframes: {},
  };

  // Register in scriptIndex if not already there
  const scriptIndex = project.scriptIndex || [];
  const existingIndex = scriptIndex.find((s) => s.name === scriptFileName || s.id === sId);
  if (!existingIndex) {
    project.scriptIndex = [...scriptIndex, { id: sId, name: scriptFileName, file: scriptFileName }];
  } else {
    existingIndex.id = sId;
    existingIndex.name = scriptFileName;
  }

  project.entities = [...(project.entities || []), scriptEntity];
  return scriptEntity;
}

export function addEmptyClip(project, {
  name = 'New Clip',
  trackId = 'track-1',
  startTime = 0,
  duration = 5,
  color = '#8b5cf6',
} = {}) {
  const entity = {
    id: `go-${crypto.randomUUID()}`,
    name,
    tag: 'Untagged',
    layer: 'Default',
    active: true,
    parentId: null,
    trackId,
    ...timing(startTime, duration),
    type: 'empty',
    src: '',
    color,
    components: [createDefaultTransform()],
    keyframes: {},
  };

  project.entities = [...(project.entities || []), entity];
  return entity;
}

export function addTransitionClip(project, {
  name = 'Transition',
  trackId = 'track-1',
  startTime = 0,
  duration = 1,
  preset = 'crossfade',
  params = {},
  color = '#f59e0b',
} = {}) {
  const entity = {
    id: `go-${crypto.randomUUID()}`,
    name,
    tag: 'Untagged',
    layer: 'Default',
    active: true,
    parentId: null,
    trackId,
    ...timing(startTime, duration),
    type: 'transition',
    src: '',
    color,
    components: [
      {
        type: 'TransitionClipComponent',
        enabled: true,
        preset,
        params,
      },
    ],
    keyframes: {},
  };

  project.entities = [...(project.entities || []), entity];
  return entity;
}

export function removeEntity(project, entityId) {
  const entities = project.entities || [];
  const target = entities.find((e) => e.id === entityId);
  if (!target) {
    throw new Error(`Entity "${entityId}" not found.`);
  }

  // Cascade delete child entities
  const toDelete = new Set([entityId]);
  let addedAny = true;
  while (addedAny) {
    addedAny = false;
    for (const e of entities) {
      if (e.parentId && toDelete.has(e.parentId) && !toDelete.has(e.id)) {
        toDelete.add(e.id);
        addedAny = true;
      }
    }
  }

  project.entities = entities.filter((e) => !toDelete.has(e.id));
  return { removedIds: Array.from(toDelete) };
}

export function setEntityProp(project, entityId, propName, propValue, { schema } = {}) {
  const entity = findEntity(project, entityId);
  if (!entity) {
    throw new Error(`Entity "${entityId}" not found.`);
  }

  const scriptComp = (entity.components || []).find((c) => c.type === 'ScriptComponent');
  if (!scriptComp) {
    throw new Error(`Entity "${entity.name}" does not have a ScriptComponent.`);
  }

  if (typeof propName !== 'string' || propName === '' || ['__proto__', 'constructor', 'prototype'].includes(propName)) {
    throw new Error(`"${propName}" is not a valid prop name.`);
  }
  if (schema) {
    const errors = validateEntityProps(schema, { [propName]: propValue });
    if (errors.length > 0) throw new Error(errors.join(' '));
  }

  scriptComp.props = scriptComp.props || {};
  scriptComp.props[propName] = propValue;
  return scriptComp.props;
}

export function setEntityTransform(project, entityId, transformUpdates = {}) {
  const entity = findEntity(project, entityId);
  if (!entity) {
    throw new Error(`Entity "${entityId}" not found.`);
  }

  let transform = (entity.components || []).find((c) => c.type === 'Transform');
  if (!transform) {
    transform = createDefaultTransform();
    entity.components = entity.components || [];
    entity.components.unshift(transform);
  }

  const allowed = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity', 'pivotX', 'pivotY'];
  for (const [key, value] of Object.entries(transformUpdates)) {
    if (!allowed.includes(key)) {
      throw new Error(`Unknown transform field "${key}". Use one of: ${allowed.join(', ')}.`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Transform "${key}" must be a finite number (got ${JSON.stringify(value)}).`);
    }
    if (key === 'opacity' && (value < 0 || value > 1)) {
      throw new Error(`Transform "opacity" must be between 0 and 1 (got ${value}).`);
    }
  }

  Object.assign(transform, transformUpdates);
  return transform;
}