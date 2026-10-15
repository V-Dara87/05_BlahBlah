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

export function findEntity(project, idOrName) {
  const entities = project.entities || [];
  return (
    entities.find((e) => e.id === idOrName) ||
    entities.find((e) => e.name.toLowerCase() === String(idOrName).toLowerCase()) ||
    null
  );
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
    startTime: Number(startTime),
    duration: Number(duration),
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
      startTime: Number(startTime),
      duration: Number(duration),
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
    startTime: Number(startTime),
    duration: Number(duration),
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
    startTime: Number(startTime),
    duration: Number(duration),
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
    startTime: Number(startTime),
    duration: Number(duration),
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
    startTime: Number(startTime),
    duration: Number(duration),
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

export function setEntityProp(project, entityId, propName, propValue) {
  const entity = findEntity(project, entityId);
  if (!entity) {
    throw new Error(`Entity "${entityId}" not found.`);
  }

  const scriptComp = (entity.components || []).find((c) => c.type === 'ScriptComponent');
  if (!scriptComp) {
    throw new Error(`Entity "${entity.name}" does not have a ScriptComponent.`);
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
    entity.components.unshift(transform);
  }

  Object.assign(transform, transformUpdates);
  return transform;
}
